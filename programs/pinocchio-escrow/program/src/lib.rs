//! Reddi Agent Protocol escrow and agent registry, built with Pinocchio.
//!
//! One program, thirteen instructions in the default (V1) build:
//!
//! - SOL escrow: `lock_escrow`, `lock_metered_escrow`, `release_escrow`,
//!   `settle_escrow`, `cancel_escrow`
//! - token escrow (USDC, AUDD, PYUSD, USDG): `lock_token_escrow`,
//!   `lock_metered_token_escrow`, `release_token_escrow`,
//!   `settle_token_escrow`, `cancel_token_escrow`
//! - registry: `register_agent`, `update_agent`, `deregister_agent`
//!
//! The `extended` feature adds eight more that are not part of V1: blind
//! commit-reveal ratings, judge attestations, and PER delegation tracking.
//!
//! It is designed to be interchangeable with the Anchor program in
//! `archive/anchor-escrow` from the outside: the same instruction selectors,
//! account order, account layouts, program-derived addresses, events and
//! error numbers. Inside it is a different program: no framework, no heap, no
//! serialisation layer. Instructions validate their accounts by hand, read
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
    instructions::{registry, sol_escrow, token_escrow},
    pinocchio::{
        no_allocator, nostd_panic_handler, program_entrypoint, AccountView, Address, ProgramResult,
    },
};

solana_address::declare_id!("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");

// The largest instruction takes nine accounts; anything past that is ignored.
program_entrypoint!(process_instruction, 9);
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

    /// Selectors of the `extended` build.
    #[cfg(feature = "extended")]
    pub mod extended {
        use super::of;

        pub const COMMIT_RATING: u64 = of("global:commit_rating");
        pub const REVEAL_RATING: u64 = of("global:reveal_rating");
        pub const EXPIRE_RATING: u64 = of("global:expire_rating");
        pub const DELEGATE_ESCROW: u64 = of("global:delegate_escrow");
        pub const RELEASE_ESCROW_PER: u64 = of("global:release_escrow_per");
        pub const ATTEST_QUALITY: u64 = of("global:attest_quality");
        pub const CONFIRM_ATTESTATION: u64 = of("global:confirm_attestation");
        pub const DISPUTE_ATTESTATION: u64 = of("global:dispute_attestation");
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
        #[cfg(feature = "extended")]
        other => extended(program_id, accounts, other, data),
        #[cfg(not(feature = "extended"))]
        _ => Err(fail(&InstructionFallbackNotFound)),
    }
}

/// The eight instructions outside V1: ratings, attestations and PER.
#[cfg(feature = "extended")]
fn extended(
    program_id: &Address,
    accounts: &mut [AccountView],
    selector: u64,
    data: &[u8],
) -> ProgramResult {
    use {
        instructions::{attestation, per, rating},
        selector::extended as ix,
    };
    match selector {
        ix::COMMIT_RATING => rating::commit(program_id, accounts, data),
        ix::REVEAL_RATING => rating::reveal(program_id, accounts, data),
        ix::EXPIRE_RATING => rating::expire(program_id, accounts, data),
        ix::DELEGATE_ESCROW => per::delegate(program_id, accounts, data),
        ix::RELEASE_ESCROW_PER => per::release(program_id, accounts, data),
        ix::ATTEST_QUALITY => attestation::attest(program_id, accounts, data),
        ix::CONFIRM_ATTESTATION => attestation::resolve(program_id, accounts, data, true),
        ix::DISPUTE_ATTESTATION => attestation::resolve(program_id, accounts, data, false),
        _ => Err(fail(&InstructionFallbackNotFound)),
    }
}
