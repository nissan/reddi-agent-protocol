/// Focused Mollusk execution checks for the legacy Anchor escrow SBF artifact.
///
/// LiteSVM covers transaction-level flows across the suite, including rollback
/// of a rejected lock. This file keeps a single-instruction Mollusk assertion so
/// the deterministic runtime lane also exercises Mollusk's Agave 4 SVM surface
/// and its compute-unit meter.
///
/// Scope note: on a failed instruction Mollusk returns the caller-supplied input
/// accounts verbatim, so its result cannot witness rollback. Account-state
/// atomicity for this path is asserted in `test_escrow.rs` against LiteSVM's
/// independently observable post-transaction state.
use {
    anchor_lang::{InstructionData, ToAccountMetas},
    escrow::{accounts::LockEscrow, instruction},
    mollusk_svm::{program::keyed_account_for_system_program, result::Check, Mollusk},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_sdk_ids::system_program,
    solana_signer::Signer,
};

fn escrow_pda(
    payer: &anchor_lang::prelude::Pubkey,
    nonce: &[u8; 16],
) -> (anchor_lang::prelude::Pubkey, u8) {
    anchor_lang::prelude::Pubkey::find_program_address(
        &[b"escrow", payer.as_ref(), nonce.as_ref()],
        &escrow::id(),
    )
}

#[test]
fn mollusk_lock_escrow_zero_amount_returns_zero_amount_error_and_consumes_compute_units() {
    let sbf_out_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy");
    std::env::set_var("SBF_OUT_DIR", sbf_out_dir);

    let payer = Keypair::new();
    let payee = Keypair::new();
    let nonce = [42u8; 16];
    let (escrow_pda, _) = escrow_pda(&payer.pubkey(), &nonce);

    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        escrow::id(),
        &instruction::LockEscrow { amount: 0, nonce }.data(),
        LockEscrow {
            escrow: escrow_pda,
            payer: payer.pubkey(),
            payee: payee.pubkey(),
            system_program: system_program::id(),
        }
        .to_account_metas(None),
    );

    let mollusk = Mollusk::new(&escrow::id(), "escrow");

    let result = mollusk.process_and_validate_instruction(
        &ix,
        &[
            (escrow_pda, Account::new(0, 0, &system_program::id())),
            (
                payer.pubkey(),
                Account::new(1_000_000_000, 0, &system_program::id()),
            ),
            (payee.pubkey(), Account::new(0, 0, &system_program::id())),
            keyed_account_for_system_program(),
        ],
        &[Check::err(anchor_lang::prelude::ProgramError::Custom(6004))],
    );

    assert!(
        result.compute_units_consumed > 0,
        "the escrow SBF artifact must actually execute under the Mollusk runtime, \
         but no compute units were metered",
    );
}
