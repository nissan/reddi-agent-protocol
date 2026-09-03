/// Focused Mollusk execution checks for the legacy Anchor escrow SBF artifact.
///
/// LiteSVM covers transaction-level flows across the suite. This file keeps a
/// single-instruction Mollusk assertion so the deterministic runtime lane also
/// exercises Mollusk's Agave 4 SVM surface and its compute-unit checker.
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
fn mollusk_lock_escrow_zero_amount_fails_without_state_mutation_and_reports_compute_units() {
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

    let payer_account = Account::new(1_000_000_000, 0, &system_program::id());
    let escrow_account = Account::new(0, 0, &system_program::id());
    let payee_account = Account::new(0, 0, &system_program::id());
    let mollusk = Mollusk::new(&escrow::id(), "escrow");

    let result = mollusk.process_and_validate_instruction(
        &ix,
        &[
            (escrow_pda, escrow_account),
            (payer.pubkey(), payer_account.clone()),
            (payee.pubkey(), payee_account.clone()),
            keyed_account_for_system_program(),
        ],
        &[Check::err(anchor_lang::prelude::ProgramError::Custom(6004))],
    );

    assert!(
        result.compute_units_consumed > 0 && result.compute_units_consumed <= 1_400_000,
        "Mollusk should report bounded compute units for the failed instruction, got {}",
        result.compute_units_consumed,
    );
    assert_eq!(
        result
            .get_account(&payer.pubkey())
            .expect("payer account should be returned")
            .lamports,
        payer_account.lamports,
        "failing zero-amount lock must not debit payer lamports",
    );
    assert_eq!(
        result
            .get_account(&escrow_pda)
            .expect("escrow account should be returned")
            .lamports,
        0,
        "failing zero-amount lock must not create/fund the escrow PDA",
    );
}
