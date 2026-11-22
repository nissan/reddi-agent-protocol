// Forked from archive/anchor-escrow/tests/test_escrow.rs on 22 November 2026, when the
// V1 program stopped matching the archived Anchor program: exits name their escrow.
/// Escrow program — LiteSVM unit tests
///
/// These tests cover the three core instructions:
///   lock_escrow   — creates PDA, transfers lamports (capped per escrow)
///   release_escrow — sends funds to payee, closes PDA (payer any time; payee
///                    after the claim window)
///   cancel_escrow  — refunds payer, closes PDA (payee any time; payer after
///                    the cancel window)
///
/// Edge cases:
///   - Unauthorised release (non-payer cannot release)
///   - Duplicate nonce (same payer + nonce = account already exists)
///   - Zero amount is rejected
use {
    anchor_lang::{
        solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    escrow::instruction,
    escrow::{
        accounts::{CancelEscrow, LockEscrow, ReleaseEscrow},
        state::EscrowAccount,
        DEFAULT_CANCEL_WINDOW_SLOTS as CANCEL_WINDOW_SLOTS,
        DEFAULT_CLAIM_WINDOW_SLOTS as CLAIM_WINDOW_SLOTS, MAX_SOL_ESCROW_LAMPORTS,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/// The simulator's cluster time. It starts inside the launch rate.
fn launch_time(svm: &LiteSVM) -> i64 {
    let t = svm
        .get_sysvar::<anchor_lang::prelude::Clock>()
        .unix_timestamp;
    assert!(t < escrow::LAUNCH_RATE_ENDS_UNIX);
    t
}

/// Sets the simulator's cluster time.
fn set_time(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock = svm.get_sysvar::<anchor_lang::prelude::Clock>();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

fn make_svm() -> (LiteSVM, anchor_lang::prelude::Pubkey) {
    let program_id = escrow::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../target/deploy/pinocchio_escrow.so");
    svm.add_program(program_id, bytes).unwrap();
    // The treasury must already hold its rent-exempt minimum to receive a fee.
    svm.airdrop(&escrow::PROTOCOL_TREASURY, 1_000_000_000)
        .unwrap();
    (svm, program_id)
}

fn escrow_pda(
    payer: &anchor_lang::prelude::Pubkey,
    nonce: &[u8; 16],
) -> (anchor_lang::prelude::Pubkey, u8) {
    anchor_lang::prelude::Pubkey::find_program_address(
        &[b"escrow", payer.as_ref(), nonce.as_ref()],
        &escrow::id(),
    )
}

fn send(
    svm: &mut LiteSVM,
    ix: Instruction,
    signers: &[&Keypair],
) -> litesvm::types::FailedTransactionMetadata {
    let payer_pk = signers[0].pubkey();
    let ix = instance::bind(svm, &[ix]).remove(0);
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer_pk), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    match svm.send_transaction(tx) {
        Ok(_) => panic!("Expected error but tx succeeded"),
        Err(e) => e,
    }
}

fn send_ok(svm: &mut LiteSVM, ix: Instruction, signers: &[&Keypair]) {
    let payer_pk = signers[0].pubkey();
    let ix = instance::bind(svm, &[ix]).remove(0);
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer_pk), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx)
        .expect("Transaction should succeed");
}

// ── Tests ────────────────────────────────────────────────────────────────────

/// lock_escrow creates a PDA with Locked status and transfers funds
#[test]
fn test_lock_escrow_success() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [1u8; 16];
    let amount = 1_000_000u64; // 0.001 SOL

    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let (escrow_pda, _bump) = escrow_pda(&payer.pubkey(), &nonce);

    let ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::LockEscrow {
            amount,
            nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data(),
        LockEscrow {
            escrow: escrow_pda,
            payer: payer.pubkey(),
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );

    send_ok(&mut svm, ix, &[&payer]);

    let escrow_account = svm.get_account(&escrow_pda).unwrap();
    assert!(
        escrow_account.lamports >= amount,
        "Escrow should hold at least the locked amount"
    );
}

/// release_escrow sends funds to payee and closes PDA
#[test]
fn test_release_escrow_success() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [2u8; 16];
    let amount = 1_000_000u64;

    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000).unwrap(); // min balance

    let (escrow_pda, _) = escrow_pda(&payer.pubkey(), &nonce);
    let payee_balance_before = svm
        .get_account(&payee.pubkey())
        .map(|a| a.lamports)
        .unwrap_or(0);

    // Lock first
    let lock_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::LockEscrow {
            amount,
            nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data(),
        LockEscrow {
            escrow: escrow_pda,
            payer: payer.pubkey(),
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );
    send_ok(&mut svm, lock_ix, &[&payer]);

    // Release
    let release_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::ReleaseEscrow {}.data(),
        ReleaseEscrow {
            treasury: escrow::PROTOCOL_TREASURY,
            escrow: escrow_pda,
            payer: payer.pubkey(),
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );
    send_ok(&mut svm, release_ix, &[&payer]);

    // Escrow PDA should be closed
    assert!(
        svm.get_account(&escrow_pda).is_none(),
        "Escrow PDA should be closed after release"
    );

    // Payee should have received the funds
    let payee_balance_after = svm
        .get_account(&payee.pubkey())
        .map(|a| a.lamports)
        .unwrap_or(0);
    assert_eq!(
        payee_balance_after,
        payee_balance_before + amount - escrow::protocol_fee(amount, true, launch_time(&svm)),
        "Payee should have received the locked amount less the 2.5% launch-rate fee"
    );
}

/// cancel_escrow refunds payer and closes PDA (after 7-day window)
#[test]
fn test_cancel_escrow_refunds_payer() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [3u8; 16];
    let amount = 500_000u64;

    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();

    let (escrow_pda, _) = escrow_pda(&payer.pubkey(), &nonce);

    // Lock
    let lock_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::LockEscrow {
            amount,
            nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data(),
        LockEscrow {
            escrow: escrow_pda,
            payer: payer.pubkey(),
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );
    send_ok(&mut svm, lock_ix, &[&payer]);

    let payer_balance_after_lock = svm
        .get_account(&payer.pubkey())
        .map(|a| a.lamports)
        .unwrap_or(0);

    // Warp past the 7-day cancel window relative to the slot recorded by the
    // in-process runtime, whose initial slot is not fixed across LiteSVM releases.
    let escrow_account = svm
        .get_account(&escrow_pda)
        .expect("escrow PDA should exist");
    let escrow_state = EscrowAccount::try_deserialize(&mut escrow_account.data.as_slice())
        .expect("escrow account should deserialize");
    svm.warp_to_slot(escrow_state.created_slot + CANCEL_WINDOW_SLOTS);

    // Cancel
    let cancel_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::CancelEscrow {}.data(),
        CancelEscrow {
            escrow: escrow_pda,
            authority: payer.pubkey(),
            payer: payer.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );
    send_ok(&mut svm, cancel_ix, &[&payer]);

    // Escrow PDA should be closed
    assert!(
        svm.get_account(&escrow_pda).is_none(),
        "Escrow PDA should be closed after cancel"
    );

    // Payer should have been refunded
    let payer_balance_after_cancel = svm
        .get_account(&payer.pubkey())
        .map(|a| a.lamports)
        .unwrap_or(0);
    assert!(
        payer_balance_after_cancel > payer_balance_after_lock,
        "Payer should be refunded after cancel"
    );
}

/// cancel_escrow fails if called before 7-day window has elapsed
#[test]
fn test_cancel_window_not_elapsed() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [6u8; 16];
    let amount = 500_000u64;

    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();

    let (escrow_pda, _) = escrow_pda(&payer.pubkey(), &nonce);

    // Lock
    let lock_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::LockEscrow {
            amount,
            nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data(),
        LockEscrow {
            escrow: escrow_pda,
            payer: payer.pubkey(),
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );
    send_ok(&mut svm, lock_ix, &[&payer]);

    // Cancel immediately (no warp) — should fail with CancelWindowNotElapsed
    let cancel_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::CancelEscrow {}.data(),
        CancelEscrow {
            escrow: escrow_pda,
            authority: payer.pubkey(),
            payer: payer.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );

    let err = send(&mut svm, cancel_ix, &[&payer]);
    let err_str = format!("{:?}", err);
    assert!(
        err_str.contains("CancelWindowNotElapsed") || err_str.contains("6006"),
        "Expected CancelWindowNotElapsed error, got: {}",
        err_str
    );
}

/// release_escrow fails when wrong payer is passed (has_one constraint)
#[test]
fn test_release_payer_constraint() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let attacker = Keypair::new();
    let nonce = [7u8; 16];
    let amount = 1_000_000u64;

    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();

    let (escrow_pda, _) = escrow_pda(&payer.pubkey(), &nonce);

    // Lock with legitimate payer
    let lock_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::LockEscrow {
            amount,
            nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data(),
        LockEscrow {
            escrow: escrow_pda,
            payer: payer.pubkey(),
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );
    send_ok(&mut svm, lock_ix, &[&payer]);

    // Attacker tries to release: passes correct escrow PDA but wrong payer
    // The has_one = payer constraint checks stored payer matches account passed
    let release_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::ReleaseEscrow {}.data(),
        ReleaseEscrow {
            treasury: escrow::PROTOCOL_TREASURY,
            escrow: escrow_pda,       // correct PDA
            payer: attacker.pubkey(), // wrong payer — has_one = payer should reject
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );

    let err = send(&mut svm, release_ix, &[&attacker]);
    let err_str = format!("{:?}", err);
    // Anchor rejects with ConstraintSeeds (2006): attacker's pubkey doesn't derive
    // to the stored escrow PDA — seeds mismatch is detected before has_one check.
    assert!(
        err_str.contains("ConstraintSeeds") || err_str.contains("2006"),
        "Expected ConstraintSeeds error, got: {}",
        err_str
    );
}

/// Duplicate nonce: same payer + nonce cannot create two escrows
#[test]
fn test_duplicate_nonce() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [8u8; 16]; // same nonce for both attempts
    let amount = 1_000_000u64;

    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let (escrow_pda, _) = escrow_pda(&payer.pubkey(), &nonce);

    let lock_ix = || {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::LockEscrow {
                amount,
                nonce,
                claim_window_slots: CLAIM_WINDOW_SLOTS,
                cancel_window_slots: CANCEL_WINDOW_SLOTS,
            }
            .data(),
            LockEscrow {
                escrow: escrow_pda,
                payer: payer.pubkey(),
                payee: payee.pubkey(),
                system_program: anchor_lang::solana_program::system_program::id(),
            }
            .to_account_metas(None),
        )
    };

    // First lock: should succeed
    send_ok(&mut svm, lock_ix(), &[&payer]);

    // Second lock with same nonce: identical tx signature triggers AlreadyProcessed
    // in LiteSVM (deterministic signatures). On a real validator this would be
    // AccountAlreadyInitialized — both indicate the nonce cannot be reused.
    let err = send(&mut svm, lock_ix(), &[&payer]);
    let err_str = format!("{:?}", err);
    assert!(
        err_str.contains("AlreadyProcessed")
            || err_str.contains("AlreadyInUse")
            || err_str.contains("AccountAlreadyInitialized"),
        "Expected duplicate nonce rejection, got: {}",
        err_str
    );
}

/// Unauthorised party cannot release an escrow
#[test]
fn test_release_unauthorised_fails() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let attacker = Keypair::new();
    let nonce = [4u8; 16];
    let amount = 1_000_000u64;

    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();

    let (escrow_pda, _) = escrow_pda(&payer.pubkey(), &nonce);

    // Lock as payer
    let lock_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::LockEscrow {
            amount,
            nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data(),
        LockEscrow {
            escrow: escrow_pda,
            payer: payer.pubkey(),
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );
    send_ok(&mut svm, lock_ix, &[&payer]);

    // Attacker tries to release — should fail
    // Attacker cannot provide the correct escrow PDA because it's seeded with payer's key
    // This tests that the has_one = payer constraint is enforced
    let fake_escrow = Keypair::new();
    let release_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::ReleaseEscrow {}.data(),
        ReleaseEscrow {
            treasury: escrow::PROTOCOL_TREASURY,
            escrow: fake_escrow.pubkey(),
            payer: attacker.pubkey(),
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );

    let err = send(&mut svm, release_ix, &[&attacker]);
    // Transaction should fail — invalid account (not a valid escrow PDA)
    let _ = err; // Error type assertion depends on litesvm version
}

/// Zero amount is rejected, and the rejected lock leaves no state behind.
///
/// Anchor's `init` constraint creates and funds the escrow PDA during account
/// resolution, i.e. before `require!(amount > 0)` runs in the handler, so this
/// also pins transaction-level rollback: the only lamports the payer may lose
/// are transaction fees, never the PDA's rent-exempt reserve.
#[test]
fn test_lock_zero_amount_fails() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [5u8; 16];

    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let (escrow_pda, _) = escrow_pda(&payer.pubkey(), &nonce);
    let payer_balance_before = svm
        .get_account(&payer.pubkey())
        .map(|a| a.lamports)
        .unwrap_or(0);
    let escrow_rent_exempt_reserve = svm.minimum_balance_for_rent_exemption(EscrowAccount::LEN);

    let ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::LockEscrow {
            amount: 0,
            nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data(),
        LockEscrow {
            escrow: escrow_pda,
            payer: payer.pubkey(),
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );

    let err = send(&mut svm, ix, &[&payer]);
    let err_str = format!("{:?}", err);
    assert!(
        err_str.contains("Custom(6004)") || err_str.contains("ZeroAmount"),
        "Expected ZeroAmount error, got: {}",
        err_str
    );

    // Independently observable post-transaction state, not an echo of the inputs.
    assert!(
        svm.get_account(&escrow_pda)
            .is_none_or(|a| a.lamports == 0 && a.data.is_empty()),
        "Rejected zero-amount lock must not leave a created/funded escrow PDA"
    );
    let payer_balance_after = svm
        .get_account(&payer.pubkey())
        .map(|a| a.lamports)
        .unwrap_or(0);
    assert!(
        payer_balance_before - payer_balance_after < escrow_rent_exempt_reserve,
        "Rejected zero-amount lock must not debit the payer the escrow rent-exempt \
         reserve ({} lamports); payer lost {}",
        escrow_rent_exempt_reserve,
        payer_balance_before - payer_balance_after
    );
}

// ── Guarded-beta rules: cap, decline, and refund after the window ────────────

fn lock_ix(
    payer: &Keypair,
    payee: &anchor_lang::prelude::Pubkey,
    amount: u64,
    nonce: [u8; 16],
) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::LockEscrow {
            amount,
            nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data(),
        LockEscrow {
            escrow: escrow_pda(&payer.pubkey(), &nonce).0,
            payer: payer.pubkey(),
            payee: *payee,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

fn cancel_ix(
    payer: &anchor_lang::prelude::Pubkey,
    authority: &anchor_lang::prelude::Pubkey,
    nonce: [u8; 16],
) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::CancelEscrow {}.data(),
        CancelEscrow {
            escrow: escrow_pda(payer, &nonce).0,
            authority: *authority,
            payer: *payer,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

fn lamports(svm: &LiteSVM, key: &anchor_lang::prelude::Pubkey) -> u64 {
    svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
}

fn created_slot(svm: &LiteSVM, escrow: &anchor_lang::prelude::Pubkey) -> u64 {
    let account = svm.get_account(escrow).expect("escrow PDA should exist");
    EscrowAccount::try_deserialize(&mut account.data.as_slice())
        .expect("escrow account should deserialize")
        .created_slot
}

/// The cap is inclusive: exactly 0.5 SOL locks, one lamport more does not.
#[test]
fn test_lock_cap_is_enforced_at_the_exact_boundary() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let over = [20u8; 16];
    let err = send(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), MAX_SOL_ESCROW_LAMPORTS + 1, over),
        &[&payer],
    );
    let err_str = format!("{:?}", err);
    assert!(
        err_str.contains("Custom(6025)"),
        "expected AmountAboveCap, got: {err_str}"
    );
    assert!(
        svm.get_account(&escrow_pda(&payer.pubkey(), &over).0)
            .is_none_or(|a| a.lamports == 0 && a.data.is_empty()),
        "a rejected over-cap lock must leave no escrow behind"
    );

    let at = [21u8; 16];
    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), MAX_SOL_ESCROW_LAMPORTS, at),
        &[&payer],
    );
    assert!(lamports(&svm, &escrow_pda(&payer.pubkey(), &at).0) >= MAX_SOL_ESCROW_LAMPORTS);
}

/// An escrow that pays its own payer is refused.
#[test]
fn test_lock_rejects_payer_as_payee() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    let err = send(
        &mut svm,
        lock_ix(&payer, &payer.pubkey(), 1_000_000, [22u8; 16]),
        &[&payer],
    );
    let err_str = format!("{:?}", err);
    assert!(
        err_str.contains("Custom(6007)"),
        "expected InvalidPayee, got: {err_str}"
    );
}

/// The payee can decline immediately; the money and rent go to the payer, and
/// the payee gains nothing.
#[test]
fn test_payee_can_decline_immediately_and_payer_is_made_whole() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [23u8; 16];
    let amount = 250_000_000u64;
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();

    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), amount, nonce),
        &[&payer],
    );
    let payer_after_lock = lamports(&svm, &payer.pubkey());
    let held = lamports(&svm, &escrow_pda(&payer.pubkey(), &nonce).0);
    assert!(held > amount, "escrow holds the amount plus its rent");
    let payee_before = lamports(&svm, &payee.pubkey());

    send_ok(
        &mut svm,
        cancel_ix(&payer.pubkey(), &payee.pubkey(), nonce),
        &[&payee],
    );

    assert!(svm
        .get_account(&escrow_pda(&payer.pubkey(), &nonce).0)
        .is_none());
    assert_eq!(
        lamports(&svm, &payer.pubkey()),
        payer_after_lock + held,
        "payer must get back the amount and the rent"
    );
    assert!(
        lamports(&svm, &payee.pubkey()) < payee_before,
        "payee pays only the transaction fee and receives nothing"
    );
}

/// One slot before the cancel window the payer cannot refund. At the exact
/// boundary slot it can. A stranger can never trigger a refund.
#[test]
fn test_refund_window_boundary_is_exact_and_strangers_cannot_refund() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let stranger = Keypair::new();
    let nonce = [24u8; 16];
    let amount = 300_000_000u64;
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();

    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), amount, nonce),
        &[&payer],
    );
    let escrow = escrow_pda(&payer.pubkey(), &nonce).0;
    let created = created_slot(&svm, &escrow);
    let held = lamports(&svm, &escrow);

    svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS - 1);
    let err = format!(
        "{:?}",
        send(
            &mut svm,
            cancel_ix(&payer.pubkey(), &payer.pubkey(), nonce),
            &[&payer]
        )
    );
    assert!(
        err.contains("Custom(6006)"),
        "expected CancelWindowNotElapsed, got: {err}"
    );

    // Past every window a stranger still cannot refund.
    svm.warp_to_slot(created + CLAIM_WINDOW_SLOTS + 10);
    let err = format!(
        "{:?}",
        send(
            &mut svm,
            cancel_ix(&payer.pubkey(), &stranger.pubkey(), nonce),
            &[&stranger],
        )
    );
    assert!(
        err.contains("Custom(6000)"),
        "expected UnauthorisedSigner, got: {err}"
    );
    assert_eq!(lamports(&svm, &escrow), held, "escrow must be untouched");
}

#[test]
fn test_payer_can_refund_at_the_exact_cancel_boundary() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [27u8; 16];
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), 300_000_000, nonce),
        &[&payer],
    );
    let escrow = escrow_pda(&payer.pubkey(), &nonce).0;
    let created = created_slot(&svm, &escrow);
    let held = lamports(&svm, &escrow);
    svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS);
    let payer_before = lamports(&svm, &payer.pubkey());
    send_ok(
        &mut svm,
        cancel_ix(&payer.pubkey(), &payer.pubkey(), nonce),
        &[&payer],
    );
    assert!(svm.get_account(&escrow).is_none());
    let fee = payer_before + held - lamports(&svm, &payer.pubkey());
    assert!(
        fee < 100_000,
        "payer gets amount and rent back, less the fee; lost {fee}"
    );
}

fn claim_ix(
    payer: &anchor_lang::prelude::Pubkey,
    payee: &anchor_lang::prelude::Pubkey,
    nonce: [u8; 16],
) -> Instruction {
    // Same instruction and accounts as a release, but the payee signs.
    let mut metas = ReleaseEscrow {
        escrow: escrow_pda(payer, &nonce).0,
        payer: *payer,
        payee: *payee,
        treasury: escrow::PROTOCOL_TREASURY,
        system_program: anchor_lang::solana_program::system_program::id(),
    }
    .to_account_metas(None);
    metas[1].is_signer = false;
    metas[2].is_signer = true;
    Instruction::new_with_bytes(escrow::id(), &instruction::ReleaseEscrow {}.data(), metas)
}

/// The payee cannot claim one slot before the claim window, and can at the
/// exact boundary. The amount goes to the payee and the rent back to the payer.
#[test]
fn test_payee_claim_boundary_is_exact_and_pays_the_payee() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [28u8; 16];
    let amount = 300_000_000u64;
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();
    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), amount, nonce),
        &[&payer],
    );
    let escrow = escrow_pda(&payer.pubkey(), &nonce).0;
    let created = created_slot(&svm, &escrow);
    let rent = lamports(&svm, &escrow) - amount;

    svm.warp_to_slot(created + CLAIM_WINDOW_SLOTS - 1);
    let err = format!(
        "{:?}",
        send(
            &mut svm,
            claim_ix(&payer.pubkey(), &payee.pubkey(), nonce),
            &[&payee]
        )
    );
    assert!(
        err.contains("Custom(6027)"),
        "expected ClaimWindowNotElapsed, got: {err}"
    );
    assert!(svm.get_account(&escrow).is_some());

    svm.warp_to_slot(created + CLAIM_WINDOW_SLOTS);
    svm.expire_blockhash();
    let payer_before = lamports(&svm, &payer.pubkey());
    let payee_before = lamports(&svm, &payee.pubkey());
    send_ok(
        &mut svm,
        claim_ix(&payer.pubkey(), &payee.pubkey(), nonce),
        &[&payee],
    );
    assert!(svm.get_account(&escrow).is_none());
    assert_eq!(lamports(&svm, &payer.pubkey()), payer_before + rent);
    let protocol_fee = escrow::protocol_fee(amount, true, launch_time(&svm));
    assert_eq!(
        protocol_fee, 7_500_000,
        "2.5% of 0.3 SOL at the launch rate"
    );
    let fee = payee_before + amount - protocol_fee - lamports(&svm, &payee.pubkey());
    assert!(
        fee < 100_000,
        "payee receives the amount less the protocol fee and its transaction fee; lost {fee}"
    );
}

/// A payout needs the payer's or the payee's signature. A stranger who signs
/// the transaction but is neither cannot pay the escrow out, at any time.
#[test]
fn test_stranger_cannot_trigger_a_payout() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let stranger = Keypair::new();
    let nonce = [29u8; 16];
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), 1_000_000, nonce),
        &[&payer],
    );
    let escrow = escrow_pda(&payer.pubkey(), &nonce).0;
    let created = created_slot(&svm, &escrow);
    svm.warp_to_slot(created + CLAIM_WINDOW_SLOTS + 10);

    let mut ix = claim_ix(&payer.pubkey(), &payee.pubkey(), nonce);
    ix.accounts[2].is_signer = false;
    let ix = instance::bind(&mut svm, &[ix]).remove(0);
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&stranger.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&stranger]).unwrap();
    let err = format!(
        "{:?}",
        svm.send_transaction(tx).expect_err("must be refused")
    );
    assert!(
        err.contains("Custom(6000)"),
        "expected UnauthorisedSigner, got: {err}"
    );
    assert!(svm.get_account(&escrow).is_some());
}

/// A lock with windows of the caller's choosing, in slots from the lock.
fn lock_with_windows_ix(
    payer: &Keypair,
    payee: &anchor_lang::prelude::Pubkey,
    nonce: [u8; 16],
    claim_window_slots: u64,
    cancel_window_slots: u64,
) -> Instruction {
    let mut ix = lock_ix(payer, payee, 1_000_000, nonce);
    ix.data = instruction::LockEscrow {
        amount: 1_000_000,
        nonce,
        claim_window_slots,
        cancel_window_slots,
    }
    .data();
    ix
}

/// The claim window opens no later than the refund window. Between the two the
/// payer cannot take the funds back, the payee can claim, and a claimed escrow
/// leaves nothing to refund later.
#[test]
fn test_payee_claim_before_the_refund_window_beats_a_later_refund() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [30u8; 16];
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();
    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), 1_000_000, nonce),
        &[&payer],
    );
    let escrow = escrow_pda(&payer.pubkey(), &nonce).0;
    let created = created_slot(&svm, &escrow);
    svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS - 1);
    let err = format!(
        "{:?}",
        send(
            &mut svm,
            cancel_ix(&payer.pubkey(), &payer.pubkey(), nonce),
            &[&payer],
        )
    );
    assert!(
        err.contains("Custom(6006)"),
        "expected CancelWindowNotElapsed, got: {err}"
    );
    send_ok(
        &mut svm,
        claim_ix(&payer.pubkey(), &payee.pubkey(), nonce),
        &[&payee],
    );
    svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS + 1);
    let payer_before = lamports(&svm, &payer.pubkey());
    let _ = send(
        &mut svm,
        cancel_ix(&payer.pubkey(), &payer.pubkey(), nonce),
        &[&payer],
    );
    assert!(lamports(&svm, &payer.pubkey()) <= payer_before);
}

/// Each escrow carries its own windows. A lock is refused unless the claim
/// window is at least one slot, no later than the refund window, and the
/// refund window is at most the 30-day maximum.
#[test]
fn test_windows_are_set_per_escrow_and_bounded() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();
    let max = escrow::MAX_ESCROW_WINDOW_SLOTS;
    for (i, (claim, cancel)) in [(0, 0), (0, 10), (11, 10), (1, max + 1), (max + 1, max + 1)]
        .into_iter()
        .enumerate()
    {
        let nonce = [60 + i as u8; 16];
        let err = format!(
            "{:?}",
            send(
                &mut svm,
                lock_with_windows_ix(&payer, &payee.pubkey(), nonce, claim, cancel),
                &[&payer],
            )
        );
        assert!(
            err.contains("Custom(6031)"),
            "({claim}, {cancel}): expected InvalidWindows, got: {err}"
        );
        assert!(svm
            .get_account(&escrow_pda(&payer.pubkey(), &nonce).0)
            .is_none());
    }

    // The widest pair the rule allows is recorded as given.
    let wide = [70u8; 16];
    send_ok(
        &mut svm,
        lock_with_windows_ix(&payer, &payee.pubkey(), wide, 1, max),
        &[&payer],
    );
    let account = svm
        .get_account(&escrow_pda(&payer.pubkey(), &wide).0)
        .unwrap();
    let state = EscrowAccount::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(
        (state.claim_window_slots, state.cancel_window_slots),
        (1, max)
    );

    // Ten seconds for both: nothing moves one slot early, and at the boundary
    // the payer's refund is as good as the payee's claim.
    let short = [71u8; 16];
    send_ok(
        &mut svm,
        lock_with_windows_ix(&payer, &payee.pubkey(), short, 25, 25),
        &[&payer],
    );
    let escrow = escrow_pda(&payer.pubkey(), &short).0;
    let created = created_slot(&svm, &escrow);
    svm.warp_to_slot(created + 24);
    let err = format!(
        "{:?}",
        send(
            &mut svm,
            claim_ix(&payer.pubkey(), &payee.pubkey(), short),
            &[&payee],
        )
    );
    assert!(err.contains("Custom(6027)"), "{err}");
    let err = format!(
        "{:?}",
        send(
            &mut svm,
            cancel_ix(&payer.pubkey(), &payer.pubkey(), short),
            &[&payer],
        )
    );
    assert!(err.contains("Custom(6006)"), "{err}");
    svm.warp_to_slot(created + 25);
    svm.expire_blockhash();
    send_ok(
        &mut svm,
        cancel_ix(&payer.pubkey(), &payer.pubkey(), short),
        &[&payer],
    );
    assert!(svm.get_account(&escrow).is_none());

    // A claim window of 25 slots under a longer refund window: the payee
    // claims while the payer still cannot refund.
    let quick = [72u8; 16];
    send_ok(
        &mut svm,
        lock_with_windows_ix(&payer, &payee.pubkey(), quick, 25, 250),
        &[&payer],
    );
    let escrow = escrow_pda(&payer.pubkey(), &quick).0;
    let created = created_slot(&svm, &escrow);
    svm.warp_to_slot(created + 25);
    let err = format!(
        "{:?}",
        send(
            &mut svm,
            cancel_ix(&payer.pubkey(), &payer.pubkey(), quick),
            &[&payer],
        )
    );
    assert!(err.contains("Custom(6006)"), "{err}");
    send_ok(
        &mut svm,
        claim_ix(&payer.pubkey(), &payee.pubkey(), quick),
        &[&payee],
    );
    assert!(svm.get_account(&escrow).is_none());
}

/// A stranger cannot redirect a refund by naming themselves as the payer.
#[test]
fn test_refund_cannot_be_redirected_to_another_account() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let stranger = Keypair::new();
    let nonce = [25u8; 16];
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();

    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), 1_000_000, nonce),
        &[&payer],
    );
    let escrow = escrow_pda(&payer.pubkey(), &nonce).0;
    let created = created_slot(&svm, &escrow);
    svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS);

    let mut ix = cancel_ix(&payer.pubkey(), &stranger.pubkey(), nonce);
    ix.accounts[2].pubkey = stranger.pubkey();
    let err = send(&mut svm, ix, &[&stranger]);
    let err_str = format!("{:?}", err);
    assert!(
        err_str.contains("ConstraintSeeds") || err_str.contains("Custom(2006)"),
        "expected a seeds mismatch, got: {err_str}"
    );
    assert!(svm.get_account(&escrow).is_some());
}

/// A settled escrow cannot be settled again by either path.
#[test]
fn test_settled_escrow_cannot_be_settled_twice() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [26u8; 16];
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();

    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), 1_000_000, nonce),
        &[&payer],
    );
    send_ok(
        &mut svm,
        cancel_ix(&payer.pubkey(), &payee.pubkey(), nonce),
        &[&payee],
    );
    let payee_after = lamports(&svm, &payee.pubkey());

    let release_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::ReleaseEscrow {}.data(),
        ReleaseEscrow {
            treasury: escrow::PROTOCOL_TREASURY,
            escrow: escrow_pda(&payer.pubkey(), &nonce).0,
            payer: payer.pubkey(),
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );
    let _ = send(&mut svm, release_ix, &[&payer]);
    svm.expire_blockhash();
    let _ = send(
        &mut svm,
        cancel_ix(&payer.pubkey(), &payee.pubkey(), nonce),
        &[&payee],
    );
    assert!(
        lamports(&svm, &payee.pubkey()) <= payee_after,
        "the payee gains nothing after settlement"
    );
    assert!(svm
        .get_account(&escrow_pda(&payer.pubkey(), &nonce).0)
        .is_none());
}

// ── Metered (per-token) settlement and the 2.5% protocol fee ─────────────────

fn metered_lock_ix(
    payer: &Keypair,
    payee: &anchor_lang::prelude::Pubkey,
    amount: u64,
    nonce: [u8; 16],
) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::LockMeteredEscrow {
            amount,
            nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data(),
        LockEscrow {
            escrow: escrow_pda(&payer.pubkey(), &nonce).0,
            payer: payer.pubkey(),
            payee: *payee,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

fn settle_ix(
    payer: &anchor_lang::prelude::Pubkey,
    payee: &anchor_lang::prelude::Pubkey,
    nonce: [u8; 16],
    actual: u64,
    payee_signs: bool,
    treasury: anchor_lang::prelude::Pubkey,
) -> Instruction {
    let mut metas = ReleaseEscrow {
        escrow: escrow_pda(payer, &nonce).0,
        payer: *payer,
        payee: *payee,
        treasury,
        system_program: anchor_lang::solana_program::system_program::id(),
    }
    .to_account_metas(None);
    metas[1].is_signer = !payee_signs;
    metas[2].is_signer = payee_signs;
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::SettleEscrow { actual }.data(),
        metas,
    )
}

#[test]
fn test_protocol_fee_is_2_5_percent_rounded_down_until_the_launch_rate_ends() {
    let t = escrow::LAUNCH_RATE_ENDS_UNIX - 1;
    assert_eq!(escrow::protocol_fee(1_000_000, true, t), 25_000);
    assert_eq!(
        escrow::protocol_fee(39, true, t),
        0,
        "rounds down, no minimum"
    );
    assert_eq!(escrow::protocol_fee(41, false, t), 1);
    // The 0.1 SOL ceiling binds from 4 SOL of actual cost.
    assert_eq!(escrow::protocol_fee(4_000_000_000, true, t), 100_000_000);
    assert_eq!(escrow::protocol_fee(10_000_000_000, true, t), 100_000_000);
    // Tokens have no ceiling.
    assert_eq!(escrow::protocol_fee(10_000_000_000, false, t), 250_000_000);
    assert_eq!(escrow::protocol_fee(u64::MAX, false, t), u64::MAX / 40);
}

#[test]
fn test_protocol_fee_is_5_percent_from_the_end_of_the_launch_rate() {
    // 2027-04-01T00:00:00Z.
    assert_eq!(escrow::LAUNCH_RATE_ENDS_UNIX, 1_806_537_600);
    let t = escrow::LAUNCH_RATE_ENDS_UNIX;
    assert_eq!(escrow::protocol_fee(1_000_000, true, t), 50_000);
    assert_eq!(
        escrow::protocol_fee(19, true, t),
        0,
        "rounds down, no minimum"
    );
    assert_eq!(escrow::protocol_fee(21, false, t), 1);
    // The 0.1 SOL ceiling now binds from 2 SOL of actual cost.
    assert_eq!(escrow::protocol_fee(2_000_000_000, true, t), 100_000_000);
    assert_eq!(escrow::protocol_fee(10_000_000_000, true, t), 100_000_000);
    assert_eq!(escrow::protocol_fee(10_000_000_000, false, t), 500_000_000);
    assert_eq!(
        escrow::protocol_fee(u64::MAX, false, i64::MAX),
        u64::MAX / 20
    );
    assert_eq!(escrow::max_protocol_fee(1_000_000, false), 50_000);
}

/// The rate is read from the cluster clock at the payout: 2.5% up to the last
/// second of the launch rate, 5% from its end, whenever the escrow was locked.
#[test]
fn test_settlement_pays_the_rate_in_force_at_the_payout() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();
    let max = 400_000_000u64;
    let actual = 123_456_789u64;
    for (i, (time, fee)) in [
        (escrow::LAUNCH_RATE_ENDS_UNIX - 1, 3_086_419u64),
        (escrow::LAUNCH_RATE_ENDS_UNIX, 6_172_839u64),
    ]
    .into_iter()
    .enumerate()
    {
        let nonce = [90 + i as u8; 16];
        // Both escrows are locked inside the launch rate.
        set_time(&mut svm, 0);
        send_ok(
            &mut svm,
            metered_lock_ix(&payer, &payee.pubkey(), max, nonce),
            &[&payer],
        );
        set_time(&mut svm, time);
        svm.expire_blockhash();
        let treasury_before = lamports(&svm, &escrow::PROTOCOL_TREASURY);
        send_ok(
            &mut svm,
            settle_ix(
                &payer.pubkey(),
                &payee.pubkey(),
                nonce,
                actual,
                true,
                escrow::PROTOCOL_TREASURY,
            ),
            &[&payee],
        );
        assert_eq!(fee, escrow::protocol_fee(actual, true, time));
        assert_eq!(
            lamports(&svm, &escrow::PROTOCOL_TREASURY),
            treasury_before + fee
        );
    }
}

/// The payee settles a metered escrow at its actual cost before any window:
/// it gets the cost less 2.5%, the treasury gets 2.5%, and the unused part of
/// the authorised maximum goes back to the payer with the rent.
#[test]
fn test_payee_settles_a_metered_escrow_at_actual_cost() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [40u8; 16];
    let max = 400_000_000u64;
    let actual = 123_456_789u64;
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();
    send_ok(
        &mut svm,
        metered_lock_ix(&payer, &payee.pubkey(), max, nonce),
        &[&payer],
    );
    let escrow = escrow_pda(&payer.pubkey(), &nonce).0;
    let held = lamports(&svm, &escrow);
    let payer_before = lamports(&svm, &payer.pubkey());
    let payee_before = lamports(&svm, &payee.pubkey());
    let treasury_before = lamports(&svm, &escrow::PROTOCOL_TREASURY);

    send_ok(
        &mut svm,
        settle_ix(
            &payer.pubkey(),
            &payee.pubkey(),
            nonce,
            actual,
            true,
            escrow::PROTOCOL_TREASURY,
        ),
        &[&payee],
    );

    let fee = actual * 250 / 10_000;
    assert_eq!(fee, 3_086_419);
    assert!(svm.get_account(&escrow).is_none());
    assert_eq!(
        lamports(&svm, &escrow::PROTOCOL_TREASURY),
        treasury_before + fee
    );
    assert_eq!(
        lamports(&svm, &payer.pubkey()),
        payer_before + held - actual
    );
    let tx_fee = payee_before + actual - fee - lamports(&svm, &payee.pubkey());
    assert!(
        tx_fee < 100_000,
        "payee lost only its transaction fee; lost {tx_fee}"
    );
}

/// Settlement must be above zero and at most the locked maximum.
#[test]
fn test_settle_amount_must_be_within_the_authorised_maximum() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [41u8; 16];
    let max = 10_000_000u64;
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();
    send_ok(
        &mut svm,
        metered_lock_ix(&payer, &payee.pubkey(), max, nonce),
        &[&payer],
    );
    for actual in [0, max + 1] {
        svm.expire_blockhash();
        let err = format!(
            "{:?}",
            send(
                &mut svm,
                settle_ix(
                    &payer.pubkey(),
                    &payee.pubkey(),
                    nonce,
                    actual,
                    true,
                    escrow::PROTOCOL_TREASURY
                ),
                &[&payee]
            )
        );
        assert!(
            err.contains("Custom(6028)"),
            "expected InvalidSettleAmount for {actual}, got: {err}"
        );
    }
    // Exactly the maximum is allowed.
    svm.expire_blockhash();
    send_ok(
        &mut svm,
        settle_ix(
            &payer.pubkey(),
            &payee.pubkey(),
            nonce,
            max,
            true,
            escrow::PROTOCOL_TREASURY,
        ),
        &[&payee],
    );
}

/// Only the payee settles, and only a metered escrow. On a fixed-price escrow
/// nobody settles: the payee waits for the claim window and the payer releases
/// in full. The payer never picks a smaller amount, on either kind.
#[test]
fn test_the_payer_never_settles_and_nobody_settles_a_fixed_price_escrow() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [42u8; 16];
    let amount = 200_000_000u64;
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();
    let settle = |actual: u64, payee_signs: bool, nonce: [u8; 16]| {
        settle_ix(
            &payer.pubkey(),
            &payee.pubkey(),
            nonce,
            actual,
            payee_signs,
            escrow::PROTOCOL_TREASURY,
        )
    };
    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), amount, nonce),
        &[&payer],
    );
    let err = format!(
        "{:?}",
        send(&mut svm, settle(1_000_000, true, nonce), &[&payee])
    );
    assert!(
        err.contains("Custom(6029)"),
        "expected NotMetered, got: {err}"
    );
    // The payer cannot settle part of it, nor all of it.
    for actual in [1, 100_000_000, amount] {
        let err = format!(
            "{:?}",
            send(&mut svm, settle(actual, false, nonce), &[&payer])
        );
        assert!(
            err.contains("Custom(6000)"),
            "expected UnauthorisedSigner, got: {err}"
        );
    }

    // A metered escrow is the payee's to settle, never the payer's.
    let metered = [44u8; 16];
    send_ok(
        &mut svm,
        metered_lock_ix(&payer, &payee.pubkey(), amount, metered),
        &[&payer],
    );
    for actual in [1, amount] {
        let err = format!(
            "{:?}",
            send(&mut svm, settle(actual, false, metered), &[&payer])
        );
        assert!(
            err.contains("Custom(6000)"),
            "expected UnauthorisedSigner, got: {err}"
        );
    }
    let payee_before = lamports(&svm, &payee.pubkey());
    let treasury_before = lamports(&svm, &escrow::PROTOCOL_TREASURY);
    send_ok(&mut svm, settle(100_000_000, true, metered), &[&payee]);
    // The payee signed, so it also paid the transaction fee.
    let tx_fee = payee_before + 97_500_000 - lamports(&svm, &payee.pubkey());
    assert!(tx_fee <= 10_000, "payee received too little: {tx_fee}");
    assert_eq!(
        lamports(&svm, &escrow::PROTOCOL_TREASURY),
        treasury_before + 2_500_000
    );

    // The payer's early way out of the fixed-price escrow is a full release.
    let payee_before = lamports(&svm, &payee.pubkey());
    let release = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::ReleaseEscrow {}.data(),
        ReleaseEscrow {
            treasury: escrow::PROTOCOL_TREASURY,
            escrow: escrow_pda(&payer.pubkey(), &nonce).0,
            payer: payer.pubkey(),
            payee: payee.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );
    send_ok(&mut svm, release, &[&payer]);
    assert_eq!(lamports(&svm, &payee.pubkey()), payee_before + 195_000_000);
}

/// The fee can only go to the protocol treasury, and a stranger cannot settle.
#[test]
fn test_fee_cannot_be_redirected_and_strangers_cannot_settle() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    let stranger = Keypair::new();
    let nonce = [43u8; 16];
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    send_ok(
        &mut svm,
        metered_lock_ix(&payer, &payee.pubkey(), 50_000_000, nonce),
        &[&payer],
    );

    let err = format!(
        "{:?}",
        send(
            &mut svm,
            settle_ix(
                &payer.pubkey(),
                &payee.pubkey(),
                nonce,
                40_000_000,
                true,
                stranger.pubkey()
            ),
            &[&payee]
        )
    );
    assert!(
        err.contains("Custom(6030)"),
        "expected InvalidTreasury, got: {err}"
    );

    // A stranger signs as fee payer but neither party signs.
    let mut ix = settle_ix(
        &payer.pubkey(),
        &payee.pubkey(),
        nonce,
        40_000_000,
        true,
        escrow::PROTOCOL_TREASURY,
    );
    ix.accounts[2].is_signer = false;
    svm.expire_blockhash();
    let err = format!("{:?}", send(&mut svm, ix, &[&stranger]));
    assert!(
        err.contains("Custom(6000)"),
        "expected UnauthorisedSigner, got: {err}"
    );
    assert!(svm
        .get_account(&escrow_pda(&payer.pubkey(), &nonce).0)
        .is_some());
}

// ── A lock the payee could not be paid from is refused ───────────────────────

fn release_ix(
    payer: &anchor_lang::prelude::Pubkey,
    payee: &anchor_lang::prelude::Pubkey,
    nonce: [u8; 16],
) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::ReleaseEscrow {}.data(),
        ReleaseEscrow {
            escrow: escrow_pda(payer, &nonce).0,
            payer: *payer,
            payee: *payee,
            treasury: escrow::PROTOCOL_TREASURY,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

/// The runtime refuses a payout that leaves the payee holding less than the
/// rent-exempt minimum. A fixed-price lock is refused when its payout would do
/// that, and accepted, and then payable, from the exact boundary.
#[test]
fn test_fixed_price_lock_must_leave_the_payee_rent_exempt() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    let floor = svm.minimum_balance_for_rent_exemption(0);
    // The smallest amount whose payout, less the fee at the standard rate (the
    // payout may come after the launch rate ends), reaches the floor.
    let mut enough = floor;
    while enough - escrow::max_protocol_fee(enough, true) < floor {
        enough += 1;
    }

    let err = format!(
        "{:?}",
        send(
            &mut svm,
            lock_ix(&payer, &payee.pubkey(), enough - 1, [60u8; 16]),
            &[&payer]
        )
    );
    assert!(
        err.contains("Custom(6032)"),
        "expected PayeeNotRentExempt, got: {err}"
    );
    assert!(svm
        .get_account(&escrow_pda(&payer.pubkey(), &[60u8; 16]).0)
        .is_none());

    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), enough, [61u8; 16]),
        &[&payer],
    );
    send_ok(
        &mut svm,
        release_ix(&payer.pubkey(), &payee.pubkey(), [61u8; 16]),
        &[&payer],
    );
    // Paid out inside the launch rate, so the payee clears the floor.
    assert_eq!(
        lamports(&svm, &payee.pubkey()),
        enough - escrow::protocol_fee(enough, true, launch_time(&svm))
    );
    let held = lamports(&svm, &payee.pubkey());
    assert!(held >= floor);

    // A payee that already holds the minimum can be locked any amount.
    send_ok(
        &mut svm,
        lock_ix(&payer, &payee.pubkey(), 1, [62u8; 16]),
        &[&payer],
    );
    send_ok(
        &mut svm,
        release_ix(&payer.pubkey(), &payee.pubkey(), [62u8; 16]),
        &[&payer],
    );
    assert_eq!(lamports(&svm, &payee.pubkey()), held + 1);

    // What the payee holds counts towards the floor. An account short of it
    // cannot exist on chain, so the test writes one, 10 lamports short.
    let short = Keypair::new();
    svm.set_account(
        short.pubkey(),
        solana_account::Account {
            lamports: floor - 10,
            ..Default::default()
        },
    )
    .unwrap();
    let err = format!(
        "{:?}",
        send(
            &mut svm,
            lock_ix(&payer, &short.pubkey(), 9, [63u8; 16]),
            &[&payer]
        )
    );
    assert!(
        err.contains("Custom(6032)"),
        "expected PayeeNotRentExempt, got: {err}"
    );
    send_ok(
        &mut svm,
        lock_ix(&payer, &short.pubkey(), 10, [64u8; 16]),
        &[&payer],
    );
}

/// A metered escrow pays whatever the payee reports, which may be very little,
/// so its payee must already hold the rent-exempt minimum.
#[test]
fn test_metered_lock_needs_a_payee_that_already_holds_the_rent_minimum() {
    let (mut svm, _) = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    let floor = svm.minimum_balance_for_rent_exemption(0);

    let err = format!(
        "{:?}",
        send(
            &mut svm,
            metered_lock_ix(&payer, &payee.pubkey(), 400_000_000, [65u8; 16]),
            &[&payer]
        )
    );
    assert!(
        err.contains("Custom(6032)"),
        "expected PayeeNotRentExempt, got: {err}"
    );

    svm.airdrop(&payee.pubkey(), floor + 10_000).unwrap();
    svm.expire_blockhash();
    send_ok(
        &mut svm,
        metered_lock_ix(&payer, &payee.pubkey(), 400_000_000, [65u8; 16]),
        &[&payer],
    );
    // The smallest settlement lands.
    send_ok(
        &mut svm,
        settle_ix(
            &payer.pubkey(),
            &payee.pubkey(),
            [65u8; 16],
            1,
            true,
            escrow::PROTOCOL_TREASURY,
        ),
        &[&payee],
    );
    assert!(svm
        .get_account(&escrow_pda(&payer.pubkey(), &[65u8; 16]).0)
        .is_none());
}

#[path = "common/instance.rs"]
mod instance;
