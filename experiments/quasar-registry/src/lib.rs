#![no_std]
//! Quasar SOL-native agent registry
//!
//! Parity port of `archive/anchor-escrow/` registry handlers for
//! benchmark comparison against the Anchor implementation.
//!
//! Instruction map:
//! | Discriminator | Anchor name       | Quasar name |
//! |---------------|-------------------|-------------|
//! | 0             | register_agent    | register    |
//! | 1             | update_agent      | update      |
//! | 2             | deregister_agent  | deregister  |
//!
//! Parity guarantees:
//! - `register` — burns 0.01 SOL fee, creates AgentAccount PDA, validates model len
//! - `update`   — owner-only guard (`has_one = owner`), updates rate/min_rep/active fields
//! - `deregister` — owner-only guard, closes PDA (`close = owner`), returns rent to owner
//!
//! Known parity deltas (fully documented in QUASAR-REGISTRY-PARITY-REPORT.md):
//! 1. `model` stored as fixed-length `[u8; 64]` + `model_len: u8` instead of Anchor `String`.
//! 2. `created_at` hardcoded to 0 (Clock sysvar omitted for benchmark purity).

use quasar_lang::prelude::*;

mod events;
mod instructions;
mod state;

use instructions::*;

#[cfg(test)]
mod tests;

declare_id!("Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU");

#[program]
mod quasar_registry {
    use super::*;

    /// Register a new agent in the on-chain directory.
    ///
    /// Quasar equivalent of Anchor `register_agent(agent_type, model, rate_lamports, min_reputation)`.
    /// `model` and `model_len` use fixed-size encoding to avoid dynamic instruction-arg complexity.
    #[instruction(discriminator = 0)]
    pub fn register(
        ctx: Ctx<Register>,
        agent_type: u8,
        model_len: u8,
        model_data: [u8; 64],
        rate_lamports: u64,
        min_reputation: u8,
    ) -> Result<(), ProgramError> {
        let len = model_len as usize;
        if len > 64 {
            return Err(ProgramError::InvalidArgument);
        }
        ctx.accounts
            .register(agent_type, &model_data[..len], rate_lamports, min_reputation, &ctx.bumps)
    }

    /// Update mutable fields on an existing agent registration.
    ///
    /// Quasar equivalent of Anchor `update_agent(rate_lamports, min_reputation, active)`.
    #[instruction(discriminator = 1)]
    pub fn update(
        ctx: Ctx<Update>,
        rate_lamports: u64,
        min_reputation: u8,
        active: bool,
    ) -> Result<(), ProgramError> {
        ctx.accounts.update(rate_lamports, min_reputation, active)
    }

    /// Deregister an agent and close its PDA, returning rent to owner.
    ///
    /// Quasar equivalent of Anchor `deregister_agent()`.
    #[instruction(discriminator = 2)]
    pub fn deregister(ctx: Ctx<Deregister>) -> Result<(), ProgramError> {
        ctx.accounts.deregister()
    }
}
