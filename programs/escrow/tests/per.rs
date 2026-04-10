/// Phase 5 — MagicBlock PER (Private Ephemeral Rollup) integration tests.
///
/// These tests cover the on-chain state management for PER delegation.
/// Full TEE execution (mempool-private settlement) requires a live
/// `devnet-tee.magicblock.app` connection — those are marked `#[ignore]`
/// and documented in the Phase 5 README.
///
/// Compat note: `ephemeral-rollups-sdk` v0.10.5 is incompatible with
/// Anchor 1.0.0 (Pubkey type mismatch, missing realloc API).  Delegation
/// is handled TypeScript-side via `packages/per-client/`.  These tests
/// cover the on-chain `delegate_escrow` and `release_escrow_per` instructions
/// that track delegation state.
use {
    anchor_lang::{
        solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    escrow::{
        accounts::{DelegateEscrow, LockEscrow, ReleaseEscrow, ReleaseEscrowPer},
        constants::ESCROW_SEED,
        instruction,
        state::{EscrowAccount, EscrowStatus},
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

type Pk = anchor_lang::prelude::Pubkey;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn make_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/escrow.so");
    svm.add_program(escrow::id(), bytes).unwrap();
    svm
}

fn send_ok(svm: &mut LiteSVM, ix: Instruction, signers: &[&Keypair]) {
    let payer = signers[0].pubkey();
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).expect("tx should succeed");
}

fn send_err(svm: &mut LiteSVM, ix: Instruction, signers: &[&Keypair]) -> String {
    let payer = signers[0].pubkey();
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    match svm.send_transaction(tx) {
        Ok(_) => panic!("expected failure but tx succeeded"),
        Err(e) => format!("{:?}", e),
    }
}

fn escrow_pda(payer: &Pk, nonce: &[u8; 16]) -> (Pk, u8) {
    Pk::find_program_address(
        &[ESCROW_SEED, payer.as_ref(), nonce.as_ref()],
        &escrow::id(),
    )
}

fn fetch_escrow(svm: &LiteSVM, pk: &Pk) -> EscrowAccount {
    let raw = svm.get_account(pk).expect("escrow must exist");
    EscrowAccount::try_deserialize(&mut raw.data.as_slice()).expect("deser EscrowAccount")
}

/// Lock an escrow and return its PDA.
fn lock_escrow(svm: &mut LiteSVM, payer: &Keypair, payee: Pk, nonce: [u8; 16]) -> Pk {
    let (pda, _) = escrow_pda(&payer.pubkey(), &nonce);
    let ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::LockEscrow {
            amount: 1_000_000,
            nonce,
        }
        .data(),
        LockEscrow {
            escrow: pda,
            payer: payer.pubkey(),
            payee,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );
    send_ok(svm, ix, &[payer]);
    pda
}

fn delegate_ix(escrow_pda: Pk, payer: &Keypair, session_key: Pk) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::DelegateEscrow { session_key }.data(),
        DelegateEscrow {
            escrow: escrow_pda,
            payer: payer.pubkey(),
        }
        .to_account_metas(None),
    )
}

fn release_per_ix(escrow_pda: Pk, payer: &Keypair, payee: Pk, session_key: Pk) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::ReleaseEscrowPer { session_key }.data(),
        ReleaseEscrowPer {
            escrow: escrow_pda,
            payer: payer.pubkey(),
            payee,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

fn release_l1_ix(escrow_pda: Pk, payer: &Keypair, payee: Pk) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::ReleaseEscrow {}.data(),
        ReleaseEscrow {
            escrow: escrow_pda,
            payer: payer.pubkey(),
            payee,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Test 1 (BDD happy path): lock → delegate → release_escrow_per.
/// Verifies delegation state is set and then cleared on PER release.
#[test]
fn test_delegate_and_release_per() {
    let mut svm = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    svm.airdrop(&payer.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000).unwrap();

    let nonce = [1u8; 16];
    let session_key = Keypair::new().pubkey();
    let escrow_pk = lock_escrow(&mut svm, &payer, payee.pubkey(), nonce);

    // Delegate to PER
    send_ok(
        &mut svm,
        delegate_ix(escrow_pk, &payer, session_key),
        &[&payer],
    );

    let escrow = fetch_escrow(&svm, &escrow_pk);
    assert!(escrow.delegated_to_per, "escrow should be delegated");
    assert_eq!(escrow.per_session_key, Some(session_key));
    assert_eq!(escrow.status, EscrowStatus::Locked);

    let payee_before = svm
        .get_account(&payee.pubkey())
        .map(|a| a.lamports)
        .unwrap_or(0);

    // Release via PER path
    send_ok(
        &mut svm,
        release_per_ix(escrow_pk, &payer, payee.pubkey(), session_key),
        &[&payer],
    );

    // PDA should be closed
    assert!(
        svm.get_account(&escrow_pk).is_none(),
        "escrow PDA should be closed after release"
    );

    // Payee received funds
    let payee_after = svm
        .get_account(&payee.pubkey())
        .map(|a| a.lamports)
        .unwrap_or(0);
    assert!(
        payee_after > payee_before,
        "payee should receive funds via PER path"
    );
}

/// Test 2 (BDD TTL expired / PER unavailable — L1 fallback):
/// lock → delegate → release via standard release_escrow → clears PER flag.
#[test]
fn test_delegate_then_l1_fallback() {
    let mut svm = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    svm.airdrop(&payer.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000).unwrap();

    let nonce = [2u8; 16];
    let session_key = Keypair::new().pubkey();
    let escrow_pk = lock_escrow(&mut svm, &payer, payee.pubkey(), nonce);

    send_ok(
        &mut svm,
        delegate_ix(escrow_pk, &payer, session_key),
        &[&payer],
    );

    let escrow = fetch_escrow(&svm, &escrow_pk);
    assert!(escrow.delegated_to_per, "should be delegated");

    let payee_before = svm
        .get_account(&payee.pubkey())
        .map(|a| a.lamports)
        .unwrap_or(0);

    // L1 fallback — works even when delegated
    send_ok(
        &mut svm,
        release_l1_ix(escrow_pk, &payer, payee.pubkey()),
        &[&payer],
    );

    assert!(
        svm.get_account(&escrow_pk).is_none(),
        "escrow PDA should be closed after L1 release"
    );
    let payee_after = svm
        .get_account(&payee.pubkey())
        .map(|a| a.lamports)
        .unwrap_or(0);
    assert!(
        payee_after > payee_before,
        "payee should receive funds via L1 fallback"
    );
}

/// Test 3: release_escrow_per rejected if wrong session key (PerSessionKeyMismatch).
#[test]
fn test_per_wrong_session_key_rejected() {
    let mut svm = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    svm.airdrop(&payer.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000).unwrap();

    let nonce = [3u8; 16];
    let session_key = Keypair::new().pubkey();
    let wrong_key = Keypair::new().pubkey();
    let escrow_pk = lock_escrow(&mut svm, &payer, payee.pubkey(), nonce);

    send_ok(
        &mut svm,
        delegate_ix(escrow_pk, &payer, session_key),
        &[&payer],
    );

    // Try to release with wrong session key
    let err = send_err(
        &mut svm,
        release_per_ix(escrow_pk, &payer, payee.pubkey(), wrong_key),
        &[&payer],
    );

    assert!(
        err.contains("PerSessionKeyMismatch") || err.contains("6022"),
        "expected PerSessionKeyMismatch, got: {err}"
    );
}

/// Test 4: release_escrow_per rejected when not delegated (NotDelegatedToPer).
#[test]
fn test_per_release_requires_delegation() {
    let mut svm = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    svm.airdrop(&payer.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&payee.pubkey(), 1_000_000).unwrap();

    let nonce = [4u8; 16];
    let session_key = Keypair::new().pubkey();
    // Lock but do NOT delegate
    let escrow_pk = lock_escrow(&mut svm, &payer, payee.pubkey(), nonce);

    let err = send_err(
        &mut svm,
        release_per_ix(escrow_pk, &payer, payee.pubkey(), session_key),
        &[&payer],
    );

    assert!(
        err.contains("NotDelegatedToPer") || err.contains("6021"),
        "expected NotDelegatedToPer, got: {err}"
    );
}

/// Test 5: duplicate delegate_escrow rejected (AlreadyDelegated).
#[test]
fn test_double_delegate_rejected() {
    let mut svm = make_svm();
    let payer = Keypair::new();
    let payee = Keypair::new();
    svm.airdrop(&payer.pubkey(), 2_000_000_000).unwrap();

    let nonce = [5u8; 16];
    let session_key = Keypair::new().pubkey();
    let escrow_pk = lock_escrow(&mut svm, &payer, payee.pubkey(), nonce);

    // First delegation succeeds
    send_ok(
        &mut svm,
        delegate_ix(escrow_pk, &payer, session_key),
        &[&payer],
    );

    // Second delegation rejected — use a different session key to avoid AlreadyProcessed
    let session_key2 = Keypair::new().pubkey();
    let err = send_err(
        &mut svm,
        delegate_ix(escrow_pk, &payer, session_key2),
        &[&payer],
    );

    assert!(
        err.contains("AlreadyDelegated") || err.contains("6023"),
        "expected AlreadyDelegated, got: {err}"
    );
}

// ── Devnet TEE integration tests (require live endpoint) ─────────────────────
// Run with: cargo test --test per -- --ignored
// Requires: SOLANA_KEYPAIR env var and devnet-tee.magicblock.app connectivity.

/// Skipped: full TEE private settlement requires devnet-tee.magicblock.app.
/// This would send release_escrow_per to the TEE RPC, execute privately,
/// and verify mainnet settlement — hidden from public mempool while in-flight.
#[test]
#[ignore = "requires devnet-tee.magicblock.app — run with --ignored"]
fn test_tee_private_settlement_devnet() {
    // Full integration test:
    // 1. Deploy escrow to devnet
    // 2. lock_escrow (payer → payee)
    // 3. delegate_escrow (record session key)
    // 4. Send release_escrow_per to devnet-tee.magicblock.app
    // 5. Verify payee receives funds (mainnet settlement)
    // 6. Verify tx is NOT visible on public explorer during in-flight window
    unimplemented!("devnet TEE test not yet wired — see Phase 5 README");
}
