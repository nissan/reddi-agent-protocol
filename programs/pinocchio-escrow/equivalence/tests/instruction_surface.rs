//! The instruction set of the built Pinocchio program.
//!
//! Written for this program, not copied from the Anchor tests: the Anchor
//! default build answers the thirteen escrow and registry instructions only
//! (`archive/anchor-escrow/tests/instruction_surface.rs` holds it to that),
//! while this program's default build, the mainnet build, also answers the
//! six rating, four attestation, six delivery-check and thirteen pooled-budget
//! instructions. The two
//! PER tracking instructions are not part of V1: the default build must treat them as
//! unknown, and only a `per` build answers them.
//!
//! This is checked against the built program, not the source: each call is sent
//! with no accounts, so a known instruction fails on its missing accounts while
//! an unknown one fails with Anchor's "fallback not found" error.

use anchor_lang::solana_program::instruction::Instruction;
use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

/// The instructions the Anchor reference also has, with the same interface
/// for an escrow that is not rated.
const ESCROW_AND_REGISTRY_INSTRUCTIONS: [&str; 13] = [
    "lock_escrow",
    "lock_metered_escrow",
    "release_escrow",
    "settle_escrow",
    "cancel_escrow",
    "lock_token_escrow",
    "lock_metered_token_escrow",
    "release_token_escrow",
    "settle_token_escrow",
    "cancel_token_escrow",
    "register_agent",
    "update_agent",
    "deregister_agent",
];

const RATING_AND_ATTESTATION_INSTRUCTIONS: [&str; 10] = [
    "open_rating",
    "accept_rating",
    "commit_rating",
    "reveal_rating",
    "expire_rating",
    "close_rating",
    "attest_quality",
    "confirm_attestation",
    "dispute_attestation",
    "close_attestation",
];

const DELIVERY_INSTRUCTIONS: [&str; 6] = [
    "open_delivery",
    "record_delivery",
    "accept_delivery",
    "dispute_delivery",
    "resolve_delivery",
    "resolve_token_delivery",
];

const BUDGET_INSTRUCTIONS: [&str; 13] = [
    "open_budget",
    "open_token_budget",
    "reserve",
    "set_payout_account",
    "post_final",
    "waive",
    "dispute",
    "close_budget",
    "close_token_budget",
    "payout_budget",
    "payout_token_budget",
    "resolve_budget",
    "resolve_token_budget",
];

const PER_INSTRUCTIONS: [&str; 2] = ["delegate_escrow", "release_escrow_per"];

/// Anchor's InstructionFallbackNotFound.
const UNKNOWN_INSTRUCTION: &str = "Custom(101)";
/// Anchor's AccountNotEnoughKeys.
const NOT_ENOUGH_ACCOUNTS: &str = "Custom(3005)";

fn call_with(name: &str, args: &[u8]) -> String {
    let mut svm = LiteSVM::new();
    svm.add_program(
        escrow::id(),
        include_bytes!("../../target/deploy/pinocchio_escrow.so"),
    )
    .unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let digest = Sha256::digest(format!("global:{name}").as_bytes());
    let mut data = digest[..8].to_vec();
    data.extend_from_slice(args);
    let ix = Instruction::new_with_bytes(escrow::id(), &data, vec![]);
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    format!(
        "{:?}",
        svm.send_transaction(tx)
            .expect_err("a call with no accounts can never succeed")
            .err
    )
}

fn call(name: &str) -> String {
    call_with(name, &[])
}

#[test]
fn default_build_answers_the_thirteen_escrow_and_registry_instructions() {
    for name in ESCROW_AND_REGISTRY_INSTRUCTIONS {
        let err = call(name);
        assert!(
            !err.contains(UNKNOWN_INSTRUCTION),
            "{name} must be part of the default build, got: {err}"
        );
    }
}

#[test]
fn default_build_answers_the_rating_and_attestation_instructions() {
    for name in RATING_AND_ATTESTATION_INSTRUCTIONS {
        // With enough argument bytes for any of them, each one gets as far as
        // counting its accounts.
        let err = call_with(name, &[1; 64]);
        assert!(
            err.contains(NOT_ENOUGH_ACCOUNTS),
            "{name} must be part of the default build, got: {err}"
        );
    }
}

#[test]
fn default_build_answers_the_delivery_check_instructions() {
    for name in DELIVERY_INSTRUCTIONS {
        let err = call_with(name, &[1; 64]);
        assert!(
            err.contains(NOT_ENOUGH_ACCOUNTS),
            "{name} must be part of the default build, got: {err}"
        );
    }
}

#[test]
fn default_build_answers_the_pooled_budget_instructions() {
    for name in BUDGET_INSTRUCTIONS {
        // The open carries 249 bytes of terms; every other one fewer.
        let err = call_with(name, &[1; 256]);
        assert!(
            err.contains(NOT_ENOUGH_ACCOUNTS),
            "{name} must be part of the default build, got: {err}"
        );
    }
}

#[cfg(not(feature = "per"))]
#[test]
fn default_build_does_not_answer_the_per_instructions() {
    for name in PER_INSTRUCTIONS {
        for args in [&[][..], &[1; 64][..]] {
            let err = call_with(name, args);
            assert!(
                err.contains(UNKNOWN_INSTRUCTION),
                "{name} must not be part of the default build, got: {err}"
            );
        }
    }
}

#[cfg(feature = "per")]
#[test]
fn per_build_answers_the_per_instructions() {
    for name in PER_INSTRUCTIONS {
        let err = call_with(name, &[1; 64]);
        assert!(
            err.contains(NOT_ENOUGH_ACCOUNTS),
            "{name} must be part of the per build, got: {err}"
        );
    }
}

#[test]
fn an_arbitrary_instruction_is_unknown() {
    assert!(call("withdraw_everything").contains(UNKNOWN_INSTRUCTION));
}
