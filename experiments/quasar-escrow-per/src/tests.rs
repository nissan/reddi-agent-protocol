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
    crate::state::CANCEL_WINDOW_SLOTS,
    quasar_lang::traits::HasSeeds,
    quasar_svm::{Account, AccountMeta, Instruction, Pubkey, QuasarSvm},
    std::{println, vec},
};

// ── Setup ─────────────────────────────────────────────────────────────────────

fn setup() -> QuasarSvm {
    let elf = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/target/deploy/quasar_escrow_per_poc.so"
    ))
    .expect(
        "build .so first: cargo build-sbf --manifest-path experiments/quasar-escrow-per/Cargo.toml",
    );
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
        &[
            <crate::state::UserEscrowCounter as HasSeeds>::SEED_PREFIX,
            payer.as_ref(),
        ],
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

fn agent_vault_pda(authority: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            <crate::state::AgentVault as HasSeeds>::SEED_PREFIX,
            authority.as_ref(),
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
    let mut data = vec![81, 80, 69, 82, 76, 79, 67, 75]; // QPERLOCK
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

fn release_ix(payer: Pubkey, payee: Pubkey, escrow: Pubkey, escrow_id: u64) -> Instruction {
    let mut data = vec![81, 80, 69, 82, 84, 65, 75, 69]; // QPERTAKE
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
    let mut data = vec![81, 80, 69, 82, 82, 69, 70, 68]; // QPERREFD
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

fn prepare_agent_vault_ix(payer: Pubkey, authority: Pubkey, vault: Pubkey) -> Instruction {
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(authority, false),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data: vec![81, 80, 69, 82, 86, 65, 76, 84], // QPERVALT
    }
}

fn take_to_agent_vault_ix(
    payer: Pubkey,
    escrow: Pubkey,
    vault: Pubkey,
    escrow_id: u64,
) -> Instruction {
    let mut data = vec![81, 80, 69, 82, 86, 84, 65, 75]; // QPERVTAK
    data.extend_from_slice(&escrow_id.to_le_bytes());
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(escrow, false),
            AccountMeta::new(vault, false),
        ],
        data,
    }
}

fn prepare_vault_credit_intent_ix(
    payer: Pubkey,
    escrow: Pubkey,
    authority: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    escrow_id: u64,
) -> Instruction {
    let mut data = vec![81, 80, 69, 82, 86, 73, 78, 84]; // QPERVINT
    data.extend_from_slice(&escrow_id.to_le_bytes());
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(escrow, false),
            AccountMeta::new_readonly(authority, false),
            AccountMeta::new_readonly(vault, false),
            AccountMeta::new(intent, false),
        ],
        data,
    }
}

fn private_take_to_agent_vault_ix(
    payer: Pubkey,
    authority: Pubkey,
    escrow: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    escrow_id: u64,
) -> Instruction {
    let mut data = vec![81, 80, 69, 82, 86, 80, 82, 86]; // QPERVPRV
    data.extend_from_slice(&escrow_id.to_le_bytes());
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(authority, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(intent, false),
        ],
        data,
    }
}

fn zeroed_program_account(address: Pubkey, lamports: u64, data_len: usize) -> Account {
    Account {
        address,
        lamports,
        data: vec![0; data_len],
        owner: crate::ID,
        executable: false,
    }
}

fn withdraw_agent_vault_ix(authority: Pubkey, vault: Pubkey, amount: u64) -> Instruction {
    let mut data = vec![81, 80, 69, 82, 86, 87, 68, 82]; // QPERVWDR
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new(vault, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn delegate_agent_vault_per_ix(
    authority: Pubkey,
    vault: Pubkey,
    permission: Pubkey,
    permission_program: Pubkey,
    delegation_program: Pubkey,
    owner_program: Pubkey,
    permission_delegate_buffer: Pubkey,
    permission_delegation_record: Pubkey,
    permission_delegation_metadata: Pubkey,
    vault_delegate_buffer: Pubkey,
    vault_delegation_record: Pubkey,
    vault_delegation_metadata: Pubkey,
    validator: Pubkey,
) -> Instruction {
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new(vault, false),
            AccountMeta::new(permission, false),
            AccountMeta::new_readonly(permission_program, false),
            AccountMeta::new_readonly(delegation_program, false),
            AccountMeta::new_readonly(owner_program, false),
            AccountMeta::new(permission_delegate_buffer, false),
            AccountMeta::new(permission_delegation_record, false),
            AccountMeta::new(permission_delegation_metadata, false),
            AccountMeta::new(vault_delegate_buffer, false),
            AccountMeta::new(vault_delegation_record, false),
            AccountMeta::new(vault_delegation_metadata, false),
            AccountMeta::new_readonly(validator, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data: vec![81, 80, 69, 82, 86, 68, 69, 76], // QPERVDEL
    }
}

fn commit_agent_vault_per_ix(
    authority: Pubkey,
    vault: Pubkey,
    permission: Pubkey,
    permission_program: Pubkey,
    magic_program: Pubkey,
    magic_context: Pubkey,
) -> Instruction {
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new(vault, false),
            AccountMeta::new(permission, false),
            AccountMeta::new_readonly(permission_program, false),
            AccountMeta::new_readonly(magic_program, false),
            AccountMeta::new(magic_context, false),
        ],
        data: vec![81, 80, 69, 82, 86, 67, 77, 84], // QPERVCMT
    }
}

fn owned_account(mut account: Account, owner: Pubkey) -> Account {
    account.owner = owner;
    account
}

fn system_prefunded_account(address: Pubkey, lamports: u64) -> Account {
    Account {
        address,
        lamports,
        data: vec![],
        owner: quasar_svm::system_program::ID,
        executable: false,
    }
}

fn undelegate_callback_ix(authority: Pubkey, vault: Pubkey, buffer: Pubkey) -> Instruction {
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(vault, false),
            AccountMeta::new(buffer, false),
            AccountMeta::new(authority, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data: crate::magicblock::constants::UNDELEGATE_CALLBACK_DISCRIMINATOR.to_vec(),
    }
}

fn delegate_buffer_pda(vault: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"buffer", vault.as_ref()], &crate::ID).0
}

fn undelegate_buffer_pda(vault: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"undelegate-buffer", vault.as_ref()],
        &crate::magicblock::constants::DELEGATION_PROGRAM_ID,
    )
    .0
}

/// Test 9: MagicBlock undelegate callback validates committed agent-vault bytes.
#[test]
fn test_magicblock_undelegate_callback_validates_agent_vault_buffer() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);
    let buffer = undelegate_buffer_pda(&vault);

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[funded(payer), funded(agent), empty(vault)],
    );
    prepare_result.assert_success();
    let restored_vault = prepare_result.account(&vault).unwrap().clone();

    let mut delegated_vault = restored_vault.clone();
    delegated_vault.data.clear();
    delegated_vault.owner = quasar_svm::system_program::ID;

    let mut delegation_buffer = restored_vault.clone();
    delegation_buffer.address = buffer;
    delegation_buffer.owner = crate::magicblock::constants::DELEGATION_PROGRAM_ID;

    let result = svm.process_instruction(
        &undelegate_callback_ix(agent, vault, buffer),
        &[
            delegated_vault,
            delegation_buffer,
            prepare_result.account(&agent).unwrap().clone(),
        ],
    );
    result.assert_success();

    let vault_after = result.account(&vault).unwrap();
    assert_eq!(vault_after.owner, crate::ID);
    assert_eq!(vault_after.data, restored_vault.data);
}

/// Test 9b: MagicBlock undelegate callback rejects the SDK delegate-buffer PDA.
#[test]
fn test_magicblock_undelegate_callback_rejects_delegate_buffer_pda() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);
    let buffer = delegate_buffer_pda(&vault);
    assert_ne!(buffer, undelegate_buffer_pda(&vault));

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[funded(payer), funded(agent), empty(vault)],
    );
    prepare_result.assert_success();
    let restored_vault = prepare_result.account(&vault).unwrap().clone();

    let mut delegated_vault = restored_vault.clone();
    delegated_vault.data.clear();
    delegated_vault.owner = quasar_svm::system_program::ID;

    let mut delegation_buffer = restored_vault.clone();
    delegation_buffer.address = buffer;
    delegation_buffer.owner = crate::magicblock::constants::DELEGATION_PROGRAM_ID;

    let result = svm.process_instruction(
        &undelegate_callback_ix(agent, vault, buffer),
        &[
            delegated_vault,
            delegation_buffer,
            prepare_result.account(&agent).unwrap().clone(),
        ],
    );
    assert!(
        result.is_err(),
        "delegate-buffer PDA must not be accepted by public callback"
    );
}

/// Test 10: MagicBlock undelegate callback requires the exact discriminator.
#[test]
fn test_magicblock_undelegate_callback_rejects_wrong_discriminator() {
    let mut svm = setup();
    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);
    let buffer = undelegate_buffer_pda(&vault);
    let mut ix = undelegate_callback_ix(agent, vault, buffer);
    ix.data[0] ^= 0xff;

    let result = svm.process_instruction(
        &ix,
        &[
            owned_account(
                system_prefunded_account(vault, 1_301_520),
                quasar_svm::system_program::ID,
            ),
            owned_account(
                zeroed_program_account(buffer, 1_301_520, 59),
                crate::magicblock::constants::DELEGATION_PROGRAM_ID,
            ),
            funded(agent),
        ],
    );
    assert!(
        result.is_err(),
        "wrong MagicBlock callback discriminator must fail"
    );
}

/// Test 10b: MagicBlock undelegate callback rejects wrong vault PDA seeds.
#[test]
fn test_magicblock_undelegate_callback_rejects_wrong_vault_seed() {
    let mut svm = setup();
    let agent = Pubkey::new_unique();
    let wrong_vault = Pubkey::new_unique();
    let buffer = undelegate_buffer_pda(&wrong_vault);

    let result = svm.process_instruction(
        &undelegate_callback_ix(agent, wrong_vault, buffer),
        &[
            owned_account(
                system_prefunded_account(wrong_vault, 1_301_520),
                quasar_svm::system_program::ID,
            ),
            owned_account(
                zeroed_program_account(buffer, 1_301_520, 59),
                crate::magicblock::constants::DELEGATION_PROGRAM_ID,
            ),
            funded(agent),
        ],
    );
    assert!(result.is_err(), "wrong vault PDA seed must fail");
}

/// Test 10c: MagicBlock undelegate callback requires the deterministic buffer PDA.
#[test]
fn test_magicblock_undelegate_callback_rejects_wrong_buffer_pda() {
    let mut svm = setup();
    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);
    let buffer = Pubkey::new_unique();

    let result = svm.process_instruction(
        &undelegate_callback_ix(agent, vault, buffer),
        &[
            owned_account(
                system_prefunded_account(vault, 1_301_520),
                quasar_svm::system_program::ID,
            ),
            owned_account(
                zeroed_program_account(buffer, 1_301_520, 59),
                crate::magicblock::constants::DELEGATION_PROGRAM_ID,
            ),
            funded(agent),
        ],
    );
    assert!(result.is_err(), "wrong buffer PDA must fail");
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

    let escrow_lamports = lock_result
        .account(&escrow)
        .expect("escrow exists")
        .lamports;
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

    let payee_after = release_result
        .account(&payee)
        .map(|a| a.lamports)
        .unwrap_or(0);
    assert!(payee_after >= payee_before + amount, "payee received funds");
    let escrow_after = release_result.account(&escrow);
    assert!(
        escrow_after.map(|a| a.lamports).unwrap_or(0) < escrow_lamports,
        "escrow PDA should no longer hold the locked amount after release"
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
    assert!(
        cancel_result
            .account(&escrow)
            .map(|a| a.lamports)
            .unwrap_or(0)
            == 0,
        "escrow PDA should be closed (lamports=0) after cancel"
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
    assert!(
        cancel_result
            .account(&escrow)
            .map(|a| a.lamports)
            .unwrap_or(0)
            == 0,
        "escrow should be closed after cancel"
    );

    // Try release on closed/nonexistent escrow
    let release_result = svm.process_instruction(
        &release_ix(payer, payee, escrow, escrow_id),
        &[
            cancel_result.account(&payer).unwrap().clone(),
            cancel_result
                .account(&payee)
                .cloned()
                .unwrap_or(empty(payee)),
            cancel_result
                .account(&escrow)
                .cloned()
                .unwrap_or(empty(escrow)), // closed
        ],
    );

    assert!(
        release_result.is_err(),
        "release on closed escrow should fail"
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
        &[
            funded(payer),
            empty(payee_a),
            empty(counter),
            empty(escrow0),
        ],
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

/// Test 11: self-custodied agent vault settlement model.
#[test]
fn test_agent_vault_credit_and_withdraw() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow_id = 0u64;
    let escrow = escrow_pda(&payer, escrow_id);
    let vault = agent_vault_pda(&agent);
    let amount: u64 = 1_000_000_000;

    let lock_result = svm.process_instruction(
        &lock_ix(payer, agent, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(agent), empty(counter), empty(escrow)],
    );
    lock_result.assert_success();

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[
            lock_result.account(&payer).unwrap().clone(),
            lock_result.account(&agent).cloned().unwrap_or(empty(agent)),
            empty(vault),
        ],
    );
    prepare_result.assert_success();

    let vault_before_credit = prepare_result.account(&vault).unwrap().lamports;
    let credit_result = svm.process_instruction(
        &take_to_agent_vault_ix(payer, escrow, vault, escrow_id),
        &[
            prepare_result.account(&payer).unwrap().clone(),
            lock_result.account(&escrow).unwrap().clone(),
            prepare_result.account(&vault).unwrap().clone(),
        ],
    );
    credit_result.assert_success();

    let vault_after_credit = credit_result.account(&vault).unwrap().lamports;
    assert!(
        vault_after_credit >= vault_before_credit + amount,
        "agent vault received escrowed funds"
    );

    let agent_before_withdraw = credit_result
        .account(&agent)
        .map(|a| a.lamports)
        .unwrap_or(0);
    let withdraw_result = svm.process_instruction(
        &withdraw_agent_vault_ix(agent, vault, amount),
        &[
            credit_result
                .account(&agent)
                .cloned()
                .unwrap_or(empty(agent)),
            credit_result.account(&vault).unwrap().clone(),
        ],
    );
    withdraw_result.assert_success();

    let agent_after_withdraw = withdraw_result.account(&agent).unwrap().lamports;
    assert!(
        agent_after_withdraw >= agent_before_withdraw + amount,
        "agent wallet withdrew from self-custodied vault"
    );
}

/// Test 12: wrong agent vault cannot receive an escrow credit.
#[test]
fn test_agent_vault_wrong_authority_rejected() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let wrong_agent = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow_id = 0u64;
    let escrow = escrow_pda(&payer, escrow_id);
    let wrong_vault = agent_vault_pda(&wrong_agent);
    let amount: u64 = 500_000_000;

    let lock_result = svm.process_instruction(
        &lock_ix(payer, agent, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(agent), empty(counter), empty(escrow)],
    );
    lock_result.assert_success();

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, wrong_agent, wrong_vault),
        &[
            lock_result.account(&payer).unwrap().clone(),
            empty(wrong_agent),
            empty(wrong_vault),
        ],
    );
    prepare_result.assert_success();

    let credit_result = svm.process_instruction(
        &take_to_agent_vault_ix(payer, escrow, wrong_vault, escrow_id),
        &[
            prepare_result.account(&payer).unwrap().clone(),
            lock_result.account(&escrow).unwrap().clone(),
            prepare_result.account(&wrong_vault).unwrap().clone(),
        ],
    );

    assert!(
        credit_result.is_err(),
        "wrong agent vault must not be credited"
    );
}

/// Test 13: PER/private vault credit accepts MagicBlock's zeroed delegated mirrors.
#[test]
fn test_private_take_to_agent_vault_accepts_zeroed_delegated_mirrors() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let escrow_id = 0u64;
    let counter = counter_pda(&payer);
    let escrow = escrow_pda(&payer, escrow_id);
    let vault = agent_vault_pda(&agent);
    let intent = Pubkey::new_unique();
    let amount: u64 = 1_000_000;
    let escrow_rent: u64 = 1_579_920;
    let vault_rent: u64 = 1_301_520;

    let lock_result = svm.process_instruction(
        &lock_ix(payer, agent, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(agent), empty(counter), empty(escrow)],
    );
    lock_result.assert_success();
    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[
            lock_result.account(&payer).unwrap().clone(),
            lock_result.account(&agent).cloned().unwrap_or(empty(agent)),
            empty(vault),
        ],
    );
    prepare_result.assert_success();
    let intent_result = svm.process_instruction(
        &prepare_vault_credit_intent_ix(payer, escrow, agent, vault, intent, escrow_id),
        &[
            prepare_result.account(&payer).unwrap().clone(),
            lock_result.account(&escrow).unwrap().clone(),
            prepare_result
                .account(&agent)
                .cloned()
                .unwrap_or(empty(agent)),
            prepare_result.account(&vault).unwrap().clone(),
            zeroed_program_account(intent, 1_000_000, 145),
        ],
    );
    intent_result.assert_success();

    let credit_result = svm.process_instruction(
        &private_take_to_agent_vault_ix(payer, agent, escrow, vault, intent, escrow_id),
        &[
            intent_result.account(&payer).unwrap().clone(),
            empty(agent),
            zeroed_program_account(escrow, escrow_rent + amount, 99),
            zeroed_program_account(vault, vault_rent, 59),
            intent_result.account(&intent).unwrap().clone(),
        ],
    );
    credit_result.assert_success();

    let escrow_after = credit_result.account(&escrow).unwrap();
    let vault_after = credit_result.account(&vault).unwrap();
    assert_eq!(escrow_after.lamports, escrow_rent);
    assert_eq!(vault_after.lamports, vault_rent + amount);
    assert_eq!(vault_after.data[0], 11, "vault discriminator restored");
    assert_eq!(&vault_after.data[1..33], agent.as_ref());
    assert_eq!(
        u64::from_le_bytes(vault_after.data[33..41].try_into().unwrap()),
        amount,
        "private credit updates vault balance bytes"
    );
}

/// Test 14: PER/private vault credit rejects the wrong authority/vault PDA.
#[test]
fn test_private_take_to_agent_vault_rejects_wrong_authority_vault() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let wrong_agent = Pubkey::new_unique();
    let escrow_id = 0u64;
    let counter = counter_pda(&payer);
    let escrow = escrow_pda(&payer, escrow_id);
    let vault = agent_vault_pda(&agent);
    let wrong_vault = agent_vault_pda(&wrong_agent);
    let intent = Pubkey::new_unique();
    let amount: u64 = 1_000_000;

    let lock_result = svm.process_instruction(
        &lock_ix(payer, agent, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(agent), empty(counter), empty(escrow)],
    );
    lock_result.assert_success();
    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[
            lock_result.account(&payer).unwrap().clone(),
            lock_result.account(&agent).cloned().unwrap_or(empty(agent)),
            empty(vault),
        ],
    );
    prepare_result.assert_success();
    let intent_result = svm.process_instruction(
        &prepare_vault_credit_intent_ix(payer, escrow, agent, vault, intent, escrow_id),
        &[
            prepare_result.account(&payer).unwrap().clone(),
            lock_result.account(&escrow).unwrap().clone(),
            prepare_result
                .account(&agent)
                .cloned()
                .unwrap_or(empty(agent)),
            prepare_result.account(&vault).unwrap().clone(),
            zeroed_program_account(intent, 1_000_000, 145),
        ],
    );
    intent_result.assert_success();

    let credit_result = svm.process_instruction(
        &private_take_to_agent_vault_ix(payer, agent, escrow, wrong_vault, intent, escrow_id),
        &[
            intent_result.account(&payer).unwrap().clone(),
            empty(agent),
            zeroed_program_account(escrow, 2_579_920, 99),
            zeroed_program_account(wrong_vault, 1_301_520, 59),
            intent_result.account(&intent).unwrap().clone(),
        ],
    );

    assert!(
        credit_result.is_err(),
        "wrong authority/vault PDA must be rejected before private credit"
    );
}

/// Test 15: PER/private vault credit rejects an intent prepared for another escrow.
#[test]
fn test_private_take_to_agent_vault_rejects_same_amount_wrong_escrow_intent() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent_one = Pubkey::new_unique();
    let agent_two = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow_one_id = 0u64;
    let escrow_two_id = 1u64;
    let escrow_one = escrow_pda(&payer, escrow_one_id);
    let escrow_two = escrow_pda(&payer, escrow_two_id);
    let vault_one = agent_vault_pda(&agent_one);
    let intent_one = Pubkey::new_unique();
    let amount: u64 = 1_000_000;
    let escrow_rent: u64 = 1_579_920;
    let vault_rent: u64 = 1_301_520;

    let lock_one_result = svm.process_instruction(
        &lock_ix(payer, agent_one, counter, escrow_one, amount, escrow_one_id),
        &[
            funded(payer),
            empty(agent_one),
            empty(counter),
            empty(escrow_one),
        ],
    );
    lock_one_result.assert_success();

    let lock_two_result = svm.process_instruction(
        &lock_ix(payer, agent_two, counter, escrow_two, amount, escrow_two_id),
        &[
            lock_one_result.account(&payer).unwrap().clone(),
            empty(agent_two),
            lock_one_result.account(&counter).unwrap().clone(),
            empty(escrow_two),
        ],
    );
    lock_two_result.assert_success();

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent_one, vault_one),
        &[
            lock_two_result.account(&payer).unwrap().clone(),
            lock_one_result
                .account(&agent_one)
                .cloned()
                .unwrap_or(empty(agent_one)),
            empty(vault_one),
        ],
    );
    prepare_result.assert_success();

    let intent_result = svm.process_instruction(
        &prepare_vault_credit_intent_ix(
            payer,
            escrow_one,
            agent_one,
            vault_one,
            intent_one,
            escrow_one_id,
        ),
        &[
            prepare_result.account(&payer).unwrap().clone(),
            lock_one_result.account(&escrow_one).unwrap().clone(),
            prepare_result
                .account(&agent_one)
                .cloned()
                .unwrap_or(empty(agent_one)),
            prepare_result.account(&vault_one).unwrap().clone(),
            zeroed_program_account(intent_one, 1_000_000, 145),
        ],
    );
    intent_result.assert_success();

    let credit_result = svm.process_instruction(
        &private_take_to_agent_vault_ix(
            payer,
            agent_one,
            escrow_two,
            vault_one,
            intent_one,
            escrow_two_id,
        ),
        &[
            intent_result.account(&payer).unwrap().clone(),
            empty(agent_one),
            zeroed_program_account(escrow_two, escrow_rent + amount, 99),
            zeroed_program_account(vault_one, vault_rent, 59),
            intent_result.account(&intent_one).unwrap().clone(),
        ],
    );

    assert!(
        credit_result.is_err(),
        "intent prepared for escrow_one must not authorize same-amount escrow_two"
    );
}

/// Test 16: wrong signer cannot withdraw from an agent vault.
#[test]
fn test_agent_vault_wrong_withdraw_signer_rejected() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let wrong_agent = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow_id = 0u64;
    let escrow = escrow_pda(&payer, escrow_id);
    let vault = agent_vault_pda(&agent);
    let amount: u64 = 250_000_000;

    let lock_result = svm.process_instruction(
        &lock_ix(payer, agent, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(agent), empty(counter), empty(escrow)],
    );
    lock_result.assert_success();

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[
            lock_result.account(&payer).unwrap().clone(),
            lock_result.account(&agent).cloned().unwrap_or(empty(agent)),
            empty(vault),
        ],
    );
    prepare_result.assert_success();

    let credit_result = svm.process_instruction(
        &take_to_agent_vault_ix(payer, escrow, vault, escrow_id),
        &[
            prepare_result.account(&payer).unwrap().clone(),
            lock_result.account(&escrow).unwrap().clone(),
            prepare_result.account(&vault).unwrap().clone(),
        ],
    );
    credit_result.assert_success();

    let withdraw_result = svm.process_instruction(
        &withdraw_agent_vault_ix(wrong_agent, vault, 1),
        &[
            empty(wrong_agent),
            credit_result.account(&vault).unwrap().clone(),
        ],
    );

    assert!(
        withdraw_result.is_err(),
        "wrong signer must not withdraw from another agent's vault"
    );
}

/// Test 14: agent cannot withdraw before the vault has been credited.
#[test]
fn test_agent_vault_withdraw_before_credit_rejected() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[funded(payer), empty(agent), empty(vault)],
    );
    prepare_result.assert_success();

    let withdraw_result = svm.process_instruction(
        &withdraw_agent_vault_ix(agent, vault, 1),
        &[
            prepare_result
                .account(&agent)
                .cloned()
                .unwrap_or(empty(agent)),
            prepare_result.account(&vault).unwrap().clone(),
        ],
    );

    assert!(
        withdraw_result.is_err(),
        "uncredited vault must reject withdrawals"
    );
}

/// Test 15: agent cannot double-withdraw beyond vault balance.
#[test]
fn test_agent_vault_double_withdraw_rejected() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let counter = counter_pda(&payer);
    let escrow_id = 0u64;
    let escrow = escrow_pda(&payer, escrow_id);
    let vault = agent_vault_pda(&agent);
    let amount: u64 = 250_000_000;

    let lock_result = svm.process_instruction(
        &lock_ix(payer, agent, counter, escrow, amount, escrow_id),
        &[funded(payer), empty(agent), empty(counter), empty(escrow)],
    );
    lock_result.assert_success();

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[
            lock_result.account(&payer).unwrap().clone(),
            lock_result.account(&agent).cloned().unwrap_or(empty(agent)),
            empty(vault),
        ],
    );
    prepare_result.assert_success();

    let credit_result = svm.process_instruction(
        &take_to_agent_vault_ix(payer, escrow, vault, escrow_id),
        &[
            prepare_result.account(&payer).unwrap().clone(),
            lock_result.account(&escrow).unwrap().clone(),
            prepare_result.account(&vault).unwrap().clone(),
        ],
    );
    credit_result.assert_success();

    let first_withdraw = svm.process_instruction(
        &withdraw_agent_vault_ix(agent, vault, amount),
        &[
            credit_result
                .account(&agent)
                .cloned()
                .unwrap_or(empty(agent)),
            credit_result.account(&vault).unwrap().clone(),
        ],
    );
    first_withdraw.assert_success();

    let second_withdraw = svm.process_instruction(
        &withdraw_agent_vault_ix(agent, vault, 1),
        &[
            first_withdraw.account(&agent).unwrap().clone(),
            first_withdraw.account(&vault).unwrap().clone(),
        ],
    );

    assert!(second_withdraw.is_err(), "double-withdraw must be rejected");
}

/// Test 16: vault delegation rejects an unpinned Permission Program before PDA signing.
#[test]
fn test_delegate_agent_vault_per_rejects_wrong_permission_program() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);
    let permission = Pubkey::new_unique();
    let wrong_permission_program = Pubkey::new_unique();
    let permission_delegate_buffer = Pubkey::new_unique();
    let permission_delegation_record = Pubkey::new_unique();
    let permission_delegation_metadata = Pubkey::new_unique();
    let vault_delegate_buffer = Pubkey::new_unique();
    let vault_delegation_record = Pubkey::new_unique();
    let vault_delegation_metadata = Pubkey::new_unique();

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[funded(payer), empty(agent), empty(vault)],
    );
    prepare_result.assert_success();

    let result = svm.process_instruction(
        &delegate_agent_vault_per_ix(
            agent,
            vault,
            permission,
            wrong_permission_program,
            crate::magicblock::constants::DELEGATION_PROGRAM_ID,
            crate::ID,
            permission_delegate_buffer,
            permission_delegation_record,
            permission_delegation_metadata,
            vault_delegate_buffer,
            vault_delegation_record,
            vault_delegation_metadata,
            crate::magicblock::constants::DEVNET_TEE_VALIDATOR_ID,
        ),
        &[
            prepare_result
                .account(&agent)
                .cloned()
                .unwrap_or(empty(agent)),
            prepare_result.account(&vault).unwrap().clone(),
            empty(permission),
            empty(wrong_permission_program),
            empty(crate::magicblock::constants::DELEGATION_PROGRAM_ID),
            empty(crate::ID),
            empty(permission_delegate_buffer),
            empty(permission_delegation_record),
            empty(permission_delegation_metadata),
            empty(vault_delegate_buffer),
            empty(vault_delegation_record),
            empty(vault_delegation_metadata),
            empty(crate::magicblock::constants::DEVNET_TEE_VALIDATOR_ID),
        ],
    );

    assert!(
        result.is_err(),
        "wrong Permission Program must be rejected before vault PDA signing"
    );
}

/// Test 17: vault delegation rejects an unpinned TEE validator before PDA signing.
#[test]
fn test_delegate_agent_vault_per_rejects_wrong_validator() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);
    let permission = Pubkey::new_unique();
    let wrong_validator = Pubkey::new_unique();
    let permission_delegate_buffer = Pubkey::new_unique();
    let permission_delegation_record = Pubkey::new_unique();
    let permission_delegation_metadata = Pubkey::new_unique();
    let vault_delegate_buffer = Pubkey::new_unique();
    let vault_delegation_record = Pubkey::new_unique();
    let vault_delegation_metadata = Pubkey::new_unique();

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[funded(payer), empty(agent), empty(vault)],
    );
    prepare_result.assert_success();

    let result = svm.process_instruction(
        &delegate_agent_vault_per_ix(
            agent,
            vault,
            permission,
            crate::magicblock::constants::PERMISSION_PROGRAM_ID,
            crate::magicblock::constants::DELEGATION_PROGRAM_ID,
            crate::ID,
            permission_delegate_buffer,
            permission_delegation_record,
            permission_delegation_metadata,
            vault_delegate_buffer,
            vault_delegation_record,
            vault_delegation_metadata,
            wrong_validator,
        ),
        &[
            prepare_result
                .account(&agent)
                .cloned()
                .unwrap_or(empty(agent)),
            prepare_result.account(&vault).unwrap().clone(),
            empty(permission),
            empty(crate::magicblock::constants::PERMISSION_PROGRAM_ID),
            empty(crate::magicblock::constants::DELEGATION_PROGRAM_ID),
            empty(crate::ID),
            empty(permission_delegate_buffer),
            empty(permission_delegation_record),
            empty(permission_delegation_metadata),
            empty(vault_delegate_buffer),
            empty(vault_delegation_record),
            empty(vault_delegation_metadata),
            empty(wrong_validator),
        ],
    );

    assert!(
        result.is_err(),
        "wrong TEE validator must be rejected before vault PDA signing"
    );
}

/// Test 18: vault delegation rejects an unpinned Delegation Program before ownership transfer.
#[test]
fn test_delegate_agent_vault_per_rejects_wrong_delegation_program() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);
    let permission = Pubkey::new_unique();
    let wrong_delegation_program = Pubkey::new_unique();
    let permission_delegate_buffer = Pubkey::new_unique();
    let permission_delegation_record = Pubkey::new_unique();
    let permission_delegation_metadata = Pubkey::new_unique();
    let vault_delegate_buffer = Pubkey::new_unique();
    let vault_delegation_record = Pubkey::new_unique();
    let vault_delegation_metadata = Pubkey::new_unique();

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[funded(payer), empty(agent), empty(vault)],
    );
    prepare_result.assert_success();

    let result = svm.process_instruction(
        &delegate_agent_vault_per_ix(
            agent,
            vault,
            permission,
            crate::magicblock::constants::PERMISSION_PROGRAM_ID,
            wrong_delegation_program,
            crate::ID,
            permission_delegate_buffer,
            permission_delegation_record,
            permission_delegation_metadata,
            vault_delegate_buffer,
            vault_delegation_record,
            vault_delegation_metadata,
            crate::magicblock::constants::DEVNET_TEE_VALIDATOR_ID,
        ),
        &[
            prepare_result
                .account(&agent)
                .cloned()
                .unwrap_or(empty(agent)),
            prepare_result.account(&vault).unwrap().clone(),
            empty(permission),
            empty(crate::magicblock::constants::PERMISSION_PROGRAM_ID),
            empty(wrong_delegation_program),
            empty(crate::ID),
            empty(permission_delegate_buffer),
            empty(permission_delegation_record),
            empty(permission_delegation_metadata),
            empty(vault_delegate_buffer),
            empty(vault_delegation_record),
            empty(vault_delegation_metadata),
            empty(crate::magicblock::constants::DEVNET_TEE_VALIDATOR_ID),
        ],
    );

    assert!(
        result.is_err(),
        "wrong Delegation Program must be rejected before vault ownership transfer"
    );
}

/// Test 19: vault delegation rejects a spoofed owner program before PDA signing.
#[test]
fn test_delegate_agent_vault_per_rejects_wrong_owner_program() {
    let mut svm = setup();

    let payer = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);
    let permission = Pubkey::new_unique();
    let wrong_owner_program = Pubkey::new_unique();
    let permission_delegate_buffer = Pubkey::new_unique();
    let permission_delegation_record = Pubkey::new_unique();
    let permission_delegation_metadata = Pubkey::new_unique();
    let vault_delegate_buffer = Pubkey::new_unique();
    let vault_delegation_record = Pubkey::new_unique();
    let vault_delegation_metadata = Pubkey::new_unique();

    let prepare_result = svm.process_instruction(
        &prepare_agent_vault_ix(payer, agent, vault),
        &[funded(payer), empty(agent), empty(vault)],
    );
    prepare_result.assert_success();

    let result = svm.process_instruction(
        &delegate_agent_vault_per_ix(
            agent,
            vault,
            permission,
            crate::magicblock::constants::PERMISSION_PROGRAM_ID,
            crate::magicblock::constants::DELEGATION_PROGRAM_ID,
            wrong_owner_program,
            permission_delegate_buffer,
            permission_delegation_record,
            permission_delegation_metadata,
            vault_delegate_buffer,
            vault_delegation_record,
            vault_delegation_metadata,
            crate::magicblock::constants::DEVNET_TEE_VALIDATOR_ID,
        ),
        &[
            prepare_result
                .account(&agent)
                .cloned()
                .unwrap_or(empty(agent)),
            prepare_result.account(&vault).unwrap().clone(),
            empty(permission),
            empty(crate::magicblock::constants::PERMISSION_PROGRAM_ID),
            empty(crate::magicblock::constants::DELEGATION_PROGRAM_ID),
            empty(wrong_owner_program),
            empty(permission_delegate_buffer),
            empty(permission_delegation_record),
            empty(permission_delegation_metadata),
            empty(vault_delegate_buffer),
            empty(vault_delegation_record),
            empty(vault_delegation_metadata),
            empty(crate::magicblock::constants::DEVNET_TEE_VALIDATOR_ID),
        ],
    );

    assert!(
        result.is_err(),
        "wrong owner program must be rejected before vault PDA signing"
    );
}

/// Test 20: vault commit rejects an unpinned Permission Program before PDA signing.
#[test]
fn test_commit_agent_vault_per_rejects_wrong_permission_program() {
    let mut svm = setup();

    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);
    let permission = Pubkey::new_unique();
    let wrong_permission_program = Pubkey::new_unique();
    let magic_program = Pubkey::new_unique();
    let magic_context = Pubkey::new_unique();

    let result = svm.process_instruction(
        &commit_agent_vault_per_ix(
            agent,
            vault,
            permission,
            wrong_permission_program,
            magic_program,
            magic_context,
        ),
        &[
            funded(agent),
            empty(vault),
            empty(permission),
            empty(wrong_permission_program),
            empty(magic_program),
            empty(magic_context),
        ],
    );

    assert!(
        result.is_err(),
        "wrong Permission Program must be rejected before vault commit PDA signing"
    );
}

/// Test 21: vault commit is pinned to the authority-derived AgentVault PDA.
#[test]
fn test_commit_agent_vault_per_rejects_wrong_vault_pda() {
    let mut svm = setup();

    let agent = Pubkey::new_unique();
    let wrong_vault = Pubkey::new_unique();
    let permission = Pubkey::new_unique();
    let magic_program = Pubkey::new_unique();
    let magic_context = Pubkey::new_unique();

    let result = svm.process_instruction(
        &commit_agent_vault_per_ix(
            agent,
            wrong_vault,
            permission,
            crate::magicblock::constants::PERMISSION_PROGRAM_ID,
            magic_program,
            magic_context,
        ),
        &[
            funded(agent),
            empty(wrong_vault),
            empty(permission),
            empty(crate::magicblock::constants::PERMISSION_PROGRAM_ID),
            empty(magic_program),
            empty(magic_context),
        ],
    );

    assert!(
        result.is_err(),
        "vault commit must reject a vault PDA not derived from the authority"
    );
}

/// Test 22: vault commit rejects an unpinned MagicBlock program before PDA signing.
#[test]
fn test_commit_agent_vault_per_rejects_wrong_magic_program() {
    let mut svm = setup();

    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);
    let permission = Pubkey::new_unique();
    let wrong_magic_program = Pubkey::new_unique();

    let result = svm.process_instruction(
        &commit_agent_vault_per_ix(
            agent,
            vault,
            permission,
            crate::magicblock::constants::PERMISSION_PROGRAM_ID,
            wrong_magic_program,
            crate::magicblock::constants::MAGIC_CONTEXT_ID,
        ),
        &[
            funded(agent),
            empty(vault),
            empty(permission),
            empty(crate::magicblock::constants::PERMISSION_PROGRAM_ID),
            empty(wrong_magic_program),
            empty(crate::magicblock::constants::MAGIC_CONTEXT_ID),
        ],
    );

    assert!(
        result.is_err(),
        "wrong MagicBlock program must be rejected before vault commit PDA signing"
    );
}

/// Test 23: vault commit rejects an unpinned MagicBlock context before PDA signing.
#[test]
fn test_commit_agent_vault_per_rejects_wrong_magic_context() {
    let mut svm = setup();

    let agent = Pubkey::new_unique();
    let vault = agent_vault_pda(&agent);
    let permission = Pubkey::new_unique();
    let wrong_magic_context = Pubkey::new_unique();

    let result = svm.process_instruction(
        &commit_agent_vault_per_ix(
            agent,
            vault,
            permission,
            crate::magicblock::constants::PERMISSION_PROGRAM_ID,
            crate::magicblock::constants::MAGIC_PROGRAM_ID,
            wrong_magic_context,
        ),
        &[
            funded(agent),
            empty(vault),
            empty(permission),
            empty(crate::magicblock::constants::PERMISSION_PROGRAM_ID),
            empty(crate::magicblock::constants::MAGIC_PROGRAM_ID),
            empty(wrong_magic_context),
        ],
    );

    assert!(
        result.is_err(),
        "wrong MagicBlock context must be rejected before vault commit PDA signing"
    );
}
