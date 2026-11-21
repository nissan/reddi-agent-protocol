//! `per` builds only (not part of V1): rating and PER delegation never meet.
//! A rated escrow cannot be delegated and a delegated escrow cannot be opted
//! into rating, so the PER release never has a rating account to settle.
//!
//! Needs the Pinocchio program built with `--features per`.
mod support;

use {
    anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas},
    escrow::{accounts, instruction},
    solana_signer::Signer,
    support::*,
};

fn delegate(
    escrow: anchor_lang::prelude::Pubkey,
    payer: anchor_lang::prelude::Pubkey,
    session_key: anchor_lang::prelude::Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::DelegateEscrow { session_key }.data(),
        accounts::DelegateEscrow { escrow, payer }.to_account_metas(None),
    )
}

#[test]
fn a_rated_escrow_cannot_be_delegated() {
    let mut world = World::new();
    let (payer, payee) = (world.wallet(1), world.wallet(2));
    let (a, b) = (payer.pubkey(), payee.pubkey());
    let escrow = sol_escrow(&a, nonce(1));
    world.ok(
        "lock",
        sol_lock(&a, &b, 1_000_000, nonce(1), false),
        &[&payer],
    );
    world.ok("open_rating", open_rating(&escrow, &a, None), &[&payer]);
    world.refused(
        "delegate a rated escrow",
        delegate(escrow, a, key(9).pubkey()),
        &[&payer],
        RATED_ESCROW_NOT_DELEGABLE,
    );
    // It still ends as a rated escrow does.
    world.ok(
        "accept",
        accept_rating(&world, &rating_address(&escrow), &b),
        &[&payee],
    );
    world.ok(
        "release",
        with_rating(sol_payout(&a, &b, nonce(1), &a, None), &escrow),
        &[&payer],
    );
    assert_eq!(world.rating(&rating_address(&escrow)).state, OPEN);
}

#[test]
fn a_delegated_escrow_cannot_be_opted_into_rating() {
    let mut world = World::new();
    let (payer, payee) = (world.wallet(1), world.wallet(2));
    let (a, b) = (payer.pubkey(), payee.pubkey());
    let escrow = sol_escrow(&a, nonce(1));
    world.ok(
        "lock",
        sol_lock(&a, &b, 1_000_000, nonce(1), true),
        &[&payer],
    );
    world.ok("delegate", delegate(escrow, a, key(9).pubkey()), &[&payer]);
    let before = world.data(&escrow);
    // Same slot as the lock, so only the delegation stands in the way.
    world.refused(
        "opt in a delegated escrow",
        open_rating(&escrow, &a, None),
        &[&payer],
        RATED_ESCROW_NOT_DELEGABLE,
    );
    assert_eq!(world.data(&escrow), before);
    assert!(!world.exists(&rating_address(&escrow)));
}
