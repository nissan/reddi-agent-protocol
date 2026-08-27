#![no_std]
//! Quasar SOL-native escrow POC
//!
//! Parity port of `programs/escrow/` hot path (lock/release/cancel) for
//! benchmark comparison against the Anchor implementation.
//!
//! Instruction map:
//! | Discriminator | Anchor name     | Quasar name |
//! |---------------|-----------------|-------------|
//! | 0             | lock_escrow     | make        |
//! | 1             | release_escrow  | take        |
//! | 2             | cancel_escrow   | refund      |

use quasar_lang::prelude::*;

#[cfg(feature = "debug")]
extern crate alloc;

mod events;
mod instructions;
/// Public so `quasar-escrow-ref` can assert its mirror of `EscrowAccount`
/// against the real generated layout. Without this the mirror's layout test is
/// circular — it can only compare the mirror to itself.
pub mod state;

use instructions::*;

#[cfg(test)]
mod tests;

declare_id!("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");

#[program]
mod quasar_escrow_poc {
    use super::*;

    /// Lock SOL into escrow.
    ///
    /// Quasar equivalent of Anchor `lock_escrow(amount, nonce)`.
    #[instruction(discriminator = 0)]
    pub fn make(
        ctx: Ctx<Lock>,
        amount: u64,
        escrow_id: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.lock(amount, escrow_id, &ctx.bumps)
    }

    /// Release escrowed SOL to payee.
    ///
    /// Quasar equivalent of Anchor `release_escrow()`.
    #[instruction(discriminator = 1)]
    pub fn take(
        ctx: Ctx<Release>,
        escrow_id: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.release(escrow_id)
    }

    /// Cancel escrow and refund payer.
    ///
    /// Quasar equivalent of Anchor `cancel_escrow()`. 
    /// Note: 7-day window guard from Anchor omitted — benchmarked separately.
    #[instruction(discriminator = 2)]
    pub fn refund(
        ctx: Ctx<Cancel>,
        escrow_id: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.cancel(escrow_id)
    }
}
