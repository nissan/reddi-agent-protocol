//! Reddi Agent Protocol escrow and agent registry, built with Pinocchio.
//!
//! One program, twenty-three instructions in the default (V1) build:
//!
//! - SOL escrow: `lock_escrow`, `lock_metered_escrow`, `release_escrow`,
//!   `settle_escrow`, `cancel_escrow`
//! - token escrow (USDC, AUDD, PYUSD, USDG): `lock_token_escrow`,
//!   `lock_metered_token_escrow`, `release_token_escrow`,
//!   `settle_token_escrow`, `cancel_token_escrow`
//! - registry: `register_agent`, `update_agent`, `deregister_agent`
//! - ratings of jobs paid through escrow: `open_rating`, `accept_rating`,
//!   `commit_rating`, `reveal_rating`, `expire_rating`, `close_rating`
//! - judge attestations: `attest_quality`, `confirm_attestation`,
//!   `dispute_attestation`, `close_attestation`
//!
//! The `per` feature adds two more that are not part of V1 and are never
//! built for mainnet: `delegate_escrow` and `release_escrow_per`, which track
//! a MagicBlock PER delegation (unfinished; see `instructions/per.rs`).
//!
//! For the first thirteen, on an escrow that is not opted into rating, it is
//! interchangeable with the Anchor program in `archive/anchor-escrow` from
//! the outside: the same instruction selectors, account order, account
//! layouts, program-derived addresses, events and error numbers. The other
//! ten, and the exits of a rated escrow, have no counterpart there; their
//! interface is written down in the README. Inside it is a different program:
//! no framework, no heap, no serialisation layer. Instructions validate their accounts by hand, read
//! and write account bytes in place, and build events and cross-program calls
//! on the stack.
#![no_std]

pub mod checks;
pub mod consts;
pub mod error;
pub mod events;
pub mod instructions;
pub mod log;
pub mod state;
pub mod token;

use {
    consts::discriminator,
    error::{fail, InstructionFallbackNotFound},
    instructions::{attestation, rating, registry, sol_escrow, token_escrow},
    pinocchio::{
        no_allocator, nostd_panic_handler, program_entrypoint, AccountView, Address, ProgramResult,
    },
};

solana_address::declare_id!("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");

// The largest instruction takes ten accounts (a token payout of a rated
// escrow: its nine, then the rating account); anything past that is ignored.
program_entrypoint!(process_instruction, 10);
// Nothing in the program allocates, so there is no heap to set up.
no_allocator!();
nostd_panic_handler!();

/// Instruction selectors: the first eight bytes of sha256("global:<name>"),
/// read as a little-endian integer.
pub mod selector {
    use super::discriminator;

    const fn of(name: &str) -> u64 {
        u64::from_le_bytes(discriminator(name))
    }

    pub const LOCK_ESCROW: u64 = of("global:lock_escrow");
    pub const LOCK_METERED_ESCROW: u64 = of("global:lock_metered_escrow");
    pub const RELEASE_ESCROW: u64 = of("global:release_escrow");
    pub const SETTLE_ESCROW: u64 = of("global:settle_escrow");
    pub const CANCEL_ESCROW: u64 = of("global:cancel_escrow");
    pub const LOCK_TOKEN_ESCROW: u64 = of("global:lock_token_escrow");
    pub const LOCK_METERED_TOKEN_ESCROW: u64 = of("global:lock_metered_token_escrow");
    pub const RELEASE_TOKEN_ESCROW: u64 = of("global:release_token_escrow");
    pub const SETTLE_TOKEN_ESCROW: u64 = of("global:settle_token_escrow");
    pub const CANCEL_TOKEN_ESCROW: u64 = of("global:cancel_token_escrow");
    pub const REGISTER_AGENT: u64 = of("global:register_agent");
    pub const UPDATE_AGENT: u64 = of("global:update_agent");
    pub const DEREGISTER_AGENT: u64 = of("global:deregister_agent");

    pub const OPEN_RATING: u64 = of("global:open_rating");
    pub const ACCEPT_RATING: u64 = of("global:accept_rating");
    pub const CLOSE_ATTESTATION: u64 = of("global:close_attestation");
    pub const COMMIT_RATING: u64 = of("global:commit_rating");
    pub const REVEAL_RATING: u64 = of("global:reveal_rating");
    pub const EXPIRE_RATING: u64 = of("global:expire_rating");
    pub const CLOSE_RATING: u64 = of("global:close_rating");
    pub const ATTEST_QUALITY: u64 = of("global:attest_quality");
    pub const CONFIRM_ATTESTATION: u64 = of("global:confirm_attestation");
    pub const DISPUTE_ATTESTATION: u64 = of("global:dispute_attestation");

    /// Selectors of the `per` build.
    #[cfg(feature = "per")]
    pub mod per {
        use super::of;

        pub const DELEGATE_ESCROW: u64 = of("global:delegate_escrow");
        pub const RELEASE_ESCROW_PER: u64 = of("global:release_escrow_per");
    }
}

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let Some((selector, data)) = instruction_data.split_first_chunk::<8>() else {
        return Err(fail(&InstructionFallbackNotFound));
    };
    match u64::from_le_bytes(*selector) {
        selector::LOCK_ESCROW => sol_escrow::lock(program_id, accounts, data, false),
        selector::LOCK_METERED_ESCROW => sol_escrow::lock(program_id, accounts, data, true),
        selector::RELEASE_ESCROW => sol_escrow::pay_out(program_id, accounts, None),
        selector::SETTLE_ESCROW => {
            let actual = checks::Args(data).u64()?;
            sol_escrow::pay_out(program_id, accounts, Some(actual))
        }
        selector::CANCEL_ESCROW => sol_escrow::cancel(program_id, accounts),
        selector::LOCK_TOKEN_ESCROW => token_escrow::lock(program_id, accounts, data, false),
        selector::LOCK_METERED_TOKEN_ESCROW => token_escrow::lock(program_id, accounts, data, true),
        selector::RELEASE_TOKEN_ESCROW => token_escrow::pay_out(program_id, accounts, None),
        selector::SETTLE_TOKEN_ESCROW => {
            let actual = checks::Args(data).u64()?;
            token_escrow::pay_out(program_id, accounts, Some(actual))
        }
        selector::CANCEL_TOKEN_ESCROW => token_escrow::cancel(program_id, accounts),
        selector::REGISTER_AGENT => registry::register(program_id, accounts, data),
        selector::UPDATE_AGENT => registry::update(program_id, accounts, data),
        selector::DEREGISTER_AGENT => registry::deregister(program_id, accounts),
        selector::OPEN_RATING => rating::open(program_id, accounts, data),
        selector::ACCEPT_RATING => rating::accept(program_id, accounts),
        selector::CLOSE_ATTESTATION => attestation::close_resolved(program_id, accounts),
        selector::COMMIT_RATING => rating::commit(program_id, accounts, data),
        selector::REVEAL_RATING => rating::reveal(program_id, accounts, data),
        selector::EXPIRE_RATING => rating::expire(program_id, accounts),
        selector::CLOSE_RATING => rating::close_final(program_id, accounts),
        selector::ATTEST_QUALITY => attestation::attest(program_id, accounts, data),
        selector::CONFIRM_ATTESTATION => attestation::resolve(program_id, accounts, true),
        selector::DISPUTE_ATTESTATION => attestation::resolve(program_id, accounts, false),
        #[cfg(feature = "per")]
        selector::per::DELEGATE_ESCROW => instructions::per::delegate(program_id, accounts, data),
        #[cfg(feature = "per")]
        selector::per::RELEASE_ESCROW_PER => instructions::per::release(program_id, accounts, data),
        _ => Err(fail(&InstructionFallbackNotFound)),
    }
}
