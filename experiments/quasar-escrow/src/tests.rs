/// QuasarSVM tests for the SOL-native escrow POC.
///
/// Covers:
///   1. lock → release (happy path)
///   2. lock → cancel / refund (happy path)
///   3. unauthorized release — wrong payer (auth failure)
///   4. zero amount rejected
///   5. release on closed (cancelled) escrow rejected
extern crate std;

use {
    quasar_lang::traits::HasSeeds,
    crate::state::{EscrowStatus, CANCEL_WINDOW_SLOTS},
    quasar_svm::{Account, AccountMeta, Instruction, Pubkey, QuasarSvm},
    std::{println, vec},
};

// ── Setup ─────────────────────────────────────────────────────────────────────

fn setup() -> QuasarSvm {
    let elf = std::fs::read(
        concat!(env!("CARGO_MANIFEST_DIR"), "/target/deploy/quasar_escrow_poc.so"),
    )
    .expect("build .so first: cargo build-sbf --manifest-path experiments/quasar-escrow/Cargo.toml");
    QuasarSvm::new().with_program(&crate::ID, &elf)
}

fn funded(address: Pubkey) -> Account {
    quasar_svm::token::create_keyed_system_account(&address, 5_000_000_000)
}

fn empty(address: Pubkey) -> Account {
    Account {
        address,
        lamports: 0,
        data: vec![],
        owner: quasar_svm::system_program::ID,
        executable: false,
    }
}

fn counter_pda(payer: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[<crate::state::UserEscrowCounter as HasSeeds>::SEED_PREFIX, payer.as_ref()],
        &crate::ID,
    )
    .0
}

fn escrow_pda(payer: &Pubkey, escrow_id: u64) -> Pubkey {
    let escrow_id_bytes = escrow_id.to_le_bytes();
    Pubkey::find_program_address(
        &[
            <crate::state::EscrowAccount as HasSeeds>::SEED_PREFIX,
            payer.as_ref(),
            &escrow_id_bytes,
        ],
        &crate::ID,
    )
    .0
}

// ── Instruction builders ──────────────────────────────────────────────────────

fn lock_ix(
    payer: Pubkey,
    payee: Pubkey,
    counter: Pubkey,
    escrow: Pubkey,
    amount: u64,
    escrow_id: u64,
) -> Instruction {
    let mut data = vec![0u8]; // discriminator = 0
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&escrow_id.to_le_bytes());
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(payee, true),
            AccountMeta::new(counter, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

/// `lock` with the payee marked as a non-signer — the pre-consent shape, kept
/// only so the consent regression can attempt it.
fn lock_ix_unsigned_payee(
    payer: Pubkey,
    payee: Pubkey,
    counter: Pubkey,
    escrow: Pubkey,
    amount: u64,
    escrow_id: u64,
) -> Instruction {
    let mut ix = lock_ix(payer, payee, counter, escrow, amount, escrow_id);
    ix.accounts[1] = AccountMeta::new_readonly(payee, false);
    ix
}

/// `EscrowAccountZc` layout after the 1-byte discriminator:
/// payer[32] + payee[32] + escrow_id[8] + amount[8] + status[1]
const ESCROW_STATUS_OFFSET: usize = 1 + 32 + 32 + 8 + 8; // 81

/// Asserts the escrow survived settlement with the expected status and a
/// balance at or above rent-exemption.
///
/// This is the CRITICAL-4 property, so it is asserted directly rather than
/// inferred: if the account is ever destroyed or drops below rent-exemption,
/// `quasar-reputation::commit` starts failing `IllegalOwner` for whichever party
/// has not yet committed, and the settlement race is back.
fn assert_escrow_survived(
    result: &quasar_svm::ExecutionResult,
    escrow: &Pubkey,
    expected_status: u8,
    context: &str,
) {
    let acct = result
        .account(escrow)
        .unwrap_or_else(|| panic!("{}: escrow account no longer exists", context));
    assert!(
        acct.lamports > 0,
        "{}: escrow has zero lamports — it will be garbage-collected",
        context,
    );
    assert!(
        !acct.data.is_empty(),
        "{}: escrow data was zeroed",
        context,
    );
    assert_eq!(
        acct.data[ESCROW_STATUS_OFFSET], expected_status,
        "{}: unexpected escrow status",
        context,
    );
    // 99-byte account: comfortably above any plausible rent-exempt minimum for
    // this size on any cluster, and non-zero is the property that matters.
    assert!(
        acct.lamports >= 1_000_000,
        "{}: escrow balance {} looks below rent-exemption",
        context,
        acct.lamports,
    );
}

fn release_ix(payer: Pubkey, payee: Pubkey, escrow: Pubkey, escrow_id: u64) -> Instruction {
    let mut data = vec![1u8]; // discriminator = 1
    data.extend_from_slice(&escrow_id.to_le_bytes());
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(payee, false),
            AccountMeta::new(escrow, false),
        ],
        data,
    }
}

fn cancel_ix(payer: Pubkey, escrow: Pubkey, escrow_id: u64) -> Instruction {
    let mut data = vec![2u8]; // discriminator = 2
    data.extend_from_slice(&escrow_id.to_le_bytes());
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(escrow, false),
        ],
        data,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Test 1: lock → release happy path.
#[test]
fn test_lock_and_release() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let payee = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow_id = 0u64;
    let escrow = escrow_pda(&payer, escrow_id);
    let amount: u64 = 1_000_000_000;

    // --- Lock ---
    let lock_result = svm.process_instruction(
        &lock_ix(payer, payee, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(payee), empty(counter), empty(escrow)],
    );

    lock_result.assert_success();
    println!("  LOCK CU:    {}", lock_result.compute_units_consumed);

    let escrow_lamports = lock_result.account(&escrow).expect("escrow exists").lamports;
    assert!(escrow_lamports >= amount, "escrow holds locked lamports");

    // --- Release ---
    let payee_before = lock_result.account(&payee).map(|a| a.lamports).unwrap_or(0);

    let release_result = svm.process_instruction(
        &release_ix(payer, payee, escrow, escrow_id),
        &[
            lock_result.account(&payer).unwrap().clone(),
            lock_result.account(&payee).cloned().unwrap_or(empty(payee)),
            lock_result.account(&escrow).unwrap().clone(),
        ],
    );

    release_result.assert_success();
    println!("  RELEASE CU: {}", release_result.compute_units_consumed);

    let payee_after = release_result.account(&payee).map(|a| a.lamports).unwrap_or(0);
    assert!(payee_after >= payee_before + amount, "payee received funds");
    // CRITICAL-4: the escrow is deliberately NOT closed. It is the durable job
    // record that lets either party rate the other after settlement.
    assert_escrow_survived(
        &release_result,
        &escrow,
        EscrowStatus::Released as u8,
        "after release",
    );
}

/// Test 2: lock → cancel (refund) happy path.
#[test]
fn test_lock_and_cancel() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let payee = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow_id = 0u64;
    let escrow = escrow_pda(&payer, escrow_id);
    let amount: u64 = 500_000_000;

    let lock_result = svm.process_instruction(
        &lock_ix(payer, payee, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(payee), empty(counter), empty(escrow)],
    );
    lock_result.assert_success();

    let payer_after_lock = lock_result.account(&payer).unwrap().lamports;

    svm.sysvars.warp_to_slot(CANCEL_WINDOW_SLOTS + 1);

    let cancel_result = svm.process_instruction(
        &cancel_ix(payer, escrow, escrow_id),
        &[
            lock_result.account(&payer).unwrap().clone(),
            lock_result.account(&escrow).unwrap().clone(),
        ],
    );

    cancel_result.assert_success();
    println!("  CANCEL CU:  {}", cancel_result.compute_units_consumed);

    let payer_after_cancel = cancel_result.account(&payer).unwrap().lamports;
    assert!(
        payer_after_cancel > payer_after_lock,
        "payer refunded after cancel"
    );
    // CRITICAL-4: same on the cancel path — a cancel-shaped settlement race
    // would otherwise work identically, just gated behind the cancel window.
    assert_escrow_survived(
        &cancel_result,
        &escrow,
        EscrowStatus::Cancelled as u8,
        "after cancel",
    );
}

/// Test 3: unauthorized release — wrong payer cannot release.
/// Seeds constraint rejects attacker because escrow seeds include payer pubkey.
#[test]
fn test_unauthorized_release_fails() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let payee = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow_id = 0u64;
    let escrow = escrow_pda(&payer, escrow_id);
    let amount: u64 = 1_000_000_000;

    // Lock as legitimate payer
    let lock_result = svm.process_instruction(
        &lock_ix(payer, payee, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(payee), empty(counter), empty(escrow)],
    );
    lock_result.assert_success();

    // Attacker passes correct escrow PDA but wrong payer —
    // has_one = payer constraint rejects this.
    let attack_result = svm.process_instruction(
        &release_ix(attacker, payee, escrow, escrow_id),
        &[
            funded(attacker),
            lock_result.account(&payee).cloned().unwrap_or(empty(payee)),
            lock_result.account(&escrow).unwrap().clone(),
        ],
    );

    assert!(
        attack_result.is_err(),
        "unauthorized release should fail, but succeeded"
    );
}

/// Test 4: zero amount is rejected by the program guard.
#[test]
fn test_zero_amount_rejected() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let payee = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow = escrow_pda(&payer, 0);

    let result = svm.process_instruction(
        &lock_ix(payer, payee, counter, escrow, 0, 0),
        &[funded(payer), empty(payee), empty(counter), empty(escrow)],
    );

    assert!(result.is_err(), "zero amount lock should be rejected");
}

/// Test 5: release after cancel — double-spend attempt fails.
/// The escrow PDA is closed after cancel so a subsequent release has no account to load.
#[test]
fn test_release_after_cancel_fails() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let payee = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow_id = 0u64;
    let escrow = escrow_pda(&payer, escrow_id);
    let amount: u64 = 1_000_000_000;

    let lock_result = svm.process_instruction(
        &lock_ix(payer, payee, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(payee), empty(counter), empty(escrow)],
    );
    lock_result.assert_success();

    svm.sysvars.warp_to_slot(CANCEL_WINDOW_SLOTS + 1);

    let cancel_result = svm.process_instruction(
        &cancel_ix(payer, escrow, escrow_id),
        &[
            lock_result.account(&payer).unwrap().clone(),
            lock_result.account(&escrow).unwrap().clone(),
        ],
    );
    cancel_result.assert_success();
    assert_escrow_survived(
        &cancel_result,
        &escrow,
        EscrowStatus::Cancelled as u8,
        "after cancel",
    );

    // The escrow still exists, so this now tests the thing it was always meant
    // to test: the status guard, rather than the account merely being absent.
    let release_result = svm.process_instruction(
        &release_ix(payer, payee, escrow, escrow_id),
        &[
            cancel_result.account(&payer).unwrap().clone(),
            cancel_result.account(&payee).cloned().unwrap_or(empty(payee)),
            cancel_result.account(&escrow).unwrap().clone(),
        ],
    );

    assert!(
        release_result.is_err(),
        "release on a Cancelled escrow should fail the status guard"
    );
    // And the failed release must not have altered it.
    assert_escrow_survived(
        &cancel_result,
        &escrow,
        EscrowStatus::Cancelled as u8,
        "after rejected release",
    );
}

/// Test 6: payer can open multiple concurrent escrows via u64 counter ids.
#[test]
fn test_multiple_escrows_per_payer() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let payee_a = Pubkey::new_unique();
    let payee_b = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow0 = escrow_pda(&payer, 0);
    let escrow1 = escrow_pda(&payer, 1);

    let first = svm.process_instruction(
        &lock_ix(payer, payee_a, counter, escrow0, 100_000_000, 0),
        &[funded(payer), empty(payee_a), empty(counter), empty(escrow0)],
    );
    first.assert_success();

    let second = svm.process_instruction(
        &lock_ix(payer, payee_b, counter, escrow1, 200_000_000, 1),
        &[
            first.account(&payer).unwrap().clone(),
            empty(payee_b),
            first.account(&counter).unwrap().clone(),
            empty(escrow1),
        ],
    );
    second.assert_success();

    assert!(second.account(&escrow0).is_some(), "escrow #0 still exists");
    assert!(second.account(&escrow1).is_some(), "escrow #1 exists");
}

/// Audit regression: HIGH-1 — payer cannot cancel before the seven-day window.
#[test]
fn test_audit_cancel_before_window_rejected() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let payee = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow_id = 0u64;
    let escrow = escrow_pda(&payer, escrow_id);
    let amount: u64 = 250_000_000;

    let lock_result = svm.process_instruction(
        &lock_ix(payer, payee, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(payee), empty(counter), empty(escrow)],
    );
    lock_result.assert_success();

    let cancel_result = svm.process_instruction(
        &cancel_ix(payer, escrow, escrow_id),
        &[
            lock_result.account(&payer).unwrap().clone(),
            lock_result.account(&escrow).unwrap().clone(),
        ],
    );

    assert!(
        cancel_result.is_err(),
        "audit HIGH-1 regression: cancel before CANCEL_WINDOW_SLOTS must fail"
    );
}

/// Consent regression (2026-08-25): `lock` must reject an unsigned payee.
///
/// This is the load-bearing test for the last CRITICAL-4 grief path. Before the
/// consent requirement, a payer could lock an escrow naming any wallet, then use
/// that escrow to open a rating against a victim who had never agreed to the job
/// and let it expire to deduct their reputation.
///
/// It also underwrites the job binding in `quasar-reputation` and
/// `quasar-attestation`. Those programs read the parties from an escrow and
/// trust it purely because `quasar-escrow` owns it. That trust is only sound if
/// an escrow cannot exist without both parties consenting — which is exactly
/// what this test pins.
///
/// Paired with a positive control on the same fixtures so the rejection cannot
/// pass for an incidental reason.
#[test]
fn test_audit_lock_without_payee_signature_rejected() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let victim = Pubkey::new_unique();
    let amount = 1_000_000u64;
    let escrow_id = 0u64;
    let counter = counter_pda(&payer);
    let escrow = escrow_pda(&payer, escrow_id);

    // The payer names a wallet that never agreed to the job.
    let griefed = svm.process_instruction(
        &lock_ix_unsigned_payee(payer, victim, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(victim), empty(counter), empty(escrow)],
    );
    assert!(
        griefed.is_err(),
        "CRITICAL-4 closure: lock must reject a payee that has not signed"
    );

    // Positive control: the identical lock succeeds once the payee consents.
    let consented = svm.process_instruction(
        &lock_ix(payer, victim, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(victim), empty(counter), empty(escrow)],
    );
    consented.assert_success();
}

/// CRITICAL-4 structural guard: no instruction in this program may destroy an
/// escrow account.
///
/// The whole fix rests on the escrow being permanent. That is a property of the
/// *absence* of code, which no behavioural test can fully cover — a future
/// instruction could reintroduce a closing path and every existing test would
/// still pass. This scans the instruction sources at compile time instead.
///
/// It exists specifically because `close = payer` is not the only way to destroy
/// an account: `quasar-escrow-per::release` closes via a raw
/// `close_unchecked()`, which a grep for the attribute would miss entirely.
///
/// If this fails, do not weaken it — a new closing path means the settlement
/// race is back. See `docs/QUASAR-C4-DURABLE-JOB-RECORD-DESIGN-2026-08-26.md`.
#[test]
fn test_audit_critical4_no_instruction_closes_an_escrow() {
    // Every instruction in this program, pulled in at compile time so a new
    // file must be added here deliberately.
    const SOURCES: &[(&str, &str)] = &[
        ("lock.rs", include_str!("instructions/lock.rs")),
        ("release.rs", include_str!("instructions/release.rs")),
        ("cancel.rs", include_str!("instructions/cancel.rs")),
    ];

    // Constructs that destroy, empty, or hand away an account.
    const DESTRUCTIVE: &[&str] = &[
        "close = ",
        "close_unchecked",
        ".close(",
        "assign(",
        "realloc_account",
    ];

    for (name, src) in SOURCES {
        for line in src.lines() {
            // Skip doc comments and comments — these files discuss the removed
            // `close = payer` at length, and that prose is the point.
            let trimmed = line.trim_start();
            if trimmed.starts_with("//") {
                continue;
            }
            for needle in DESTRUCTIVE {
                assert!(
                    !line.contains(needle),
                    "CRITICAL-4 regression: `{}` in {} can destroy an escrow — \
                     the settlement race depends on the escrow being permanent",
                    needle,
                    name,
                );
            }
        }
    }
}
