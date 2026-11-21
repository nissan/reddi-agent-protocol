//! The V1 escrow and registry program written in Quasar.
//!
//! Outcome-equivalent to `programs/escrow` (default features): the same 13
//! instructions, the same rules, fund flows, fee, caps, windows and allowlist.
//! It is written the way Quasar wants programs written (one-byte
//! discriminators, zero-copy fixed layouts), so it is not wire-compatible with
//! the Anchor program. See README.md.
#![no_std]

use quasar_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
mod instructions;
pub mod state;
pub mod token;

use instructions::*;

declare_id!("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");

#[program]
mod rap_quasar_v1 {
    use super::*;

    #[instruction(discriminator = 0)]
    pub fn lock_escrow(ctx: Ctx<LockEscrow>, amount: u64, nonce: [u8; 16]) -> Result<(), ProgramError> {
        ctx.accounts.lock(amount, nonce, false, &ctx.bumps)
    }

    #[instruction(discriminator = 1)]
    pub fn lock_metered_escrow(
        ctx: Ctx<LockEscrow>,
        amount: u64,
        nonce: [u8; 16],
    ) -> Result<(), ProgramError> {
        ctx.accounts.lock(amount, nonce, true, &ctx.bumps)
    }

    #[instruction(discriminator = 2)]
    pub fn release_escrow(ctx: Ctx<ReleaseEscrow>) -> Result<(), ProgramError> {
        ctx.accounts.release()
    }

    #[instruction(discriminator = 3)]
    pub fn settle_escrow(ctx: Ctx<ReleaseEscrow>, actual: u64) -> Result<(), ProgramError> {
        ctx.accounts.settle(actual)
    }

    #[instruction(discriminator = 4)]
    pub fn cancel_escrow(ctx: Ctx<CancelEscrow>) -> Result<(), ProgramError> {
        ctx.accounts.cancel()
    }

    #[instruction(discriminator = 5)]
    pub fn lock_token_escrow(
        ctx: Ctx<LockTokenEscrow>,
        amount: u64,
        nonce: [u8; 16],
    ) -> Result<(), ProgramError> {
        ctx.accounts.lock(amount, nonce, false, &ctx.bumps)
    }

    #[instruction(discriminator = 6)]
    pub fn lock_metered_token_escrow(
        ctx: Ctx<LockTokenEscrow>,
        amount: u64,
        nonce: [u8; 16],
    ) -> Result<(), ProgramError> {
        ctx.accounts.lock(amount, nonce, true, &ctx.bumps)
    }

    #[instruction(discriminator = 7)]
    pub fn release_token_escrow(ctx: Ctx<ReleaseTokenEscrow>) -> Result<(), ProgramError> {
        ctx.accounts.release()
    }

    #[instruction(discriminator = 8)]
    pub fn settle_token_escrow(
        ctx: Ctx<ReleaseTokenEscrow>,
        actual: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.settle(actual)
    }

    #[instruction(discriminator = 9)]
    pub fn cancel_token_escrow(ctx: Ctx<CancelTokenEscrow>) -> Result<(), ProgramError> {
        ctx.accounts.cancel()
    }

    #[instruction(discriminator = 10)]
    pub fn register_agent(
        ctx: Ctx<RegisterAgent>,
        agent_type: u8,
        rate_lamports: u64,
        min_reputation: u8,
        model: String<255>,
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .register(agent_type, model, rate_lamports, min_reputation, &ctx.bumps)
    }

    #[instruction(discriminator = 11)]
    pub fn update_agent(
        ctx: Ctx<UpdateAgent>,
        rate_lamports: u64,
        min_reputation: u8,
        active: bool,
    ) -> Result<(), ProgramError> {
        ctx.accounts.update(rate_lamports, min_reputation, active)
    }

    #[instruction(discriminator = 12)]
    pub fn deregister_agent(ctx: Ctx<DeregisterAgent>) -> Result<(), ProgramError> {
        ctx.accounts.deregister()
    }
}
