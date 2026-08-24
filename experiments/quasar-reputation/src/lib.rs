#![no_std]
//! Quasar SOL-native blind commit-reveal reputation
//!
//! Parity port of `programs/escrow/` reputation handlers for
//! benchmark comparison against the Anchor implementation.
//!
//! Instruction map:
//! | Disc | Anchor name     | Quasar name |
//! |------|-----------------|-------------|
//! | 0    | register_agent  | register    | (test-support: used to set up AgentAccounts)
//! | 1    | commit_rating   | commit      |
//! | 2    | reveal_rating   | reveal      |
//! | 3    | expire_rating   | expire      |
//!
//! Parity guarantees:
//! - `commit`  — init_if_needed PDA, role/signer guard, duplicate commit guard, finality guard
//! - `reveal`  — BothCommitted guard, score range 1-10, sha256 commitment verify, rolling avg update
//! - `expire`  — Pending-only guard, slot-based time-lock, penalty on non-committing party
//!
//! Known parity deltas (documented in QUASAR-REPUTATION-PARITY-REPORT.md):
//! 1. `job_id` passed as `u128` (LE bytes of [u8;16]) for seed compatibility.
//! 2. `consumer_score`/`specialist_score` use `u8` sentinel (0=unrevealed) vs Anchor `Option<u8>`.
//! 3. `RatingRole`/`RatingState` passed as `u8` vs typed enums.
//! 4. Error codes are `ProgramError::InvalidArgument` (stdlib) vs custom Anchor error codes.
//! 5. `Clock` is now used for reputation (unlike registry which omitted it).

use quasar_lang::prelude::*;

pub mod escrow_ref;
mod instructions;
pub mod state;

use instructions::*;

#[cfg(test)]
mod tests;

declare_id!("nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6");

#[program]
mod quasar_reputation {
    use super::*;

    /// Register a new agent — for test setup.
    /// Discriminator 0.
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

    /// Submit a blind commitment for a job rating.
    ///
    /// First call creates the RatingAccount PDA and records both party pubkeys.
    /// Second call fills in the remaining commitment.
    /// Discriminator 1.
    #[instruction(discriminator = 1)]
    pub fn commit(
        ctx: Ctx<Commit>,
        job_id: u128,
        commitment: [u8; 32],
        role: u8,
        consumer_pk: [u8; 32],
        specialist_pk: [u8; 32],
    ) -> Result<(), ProgramError> {
        let consumer_addr = Address::new_from_array(consumer_pk);
        let specialist_addr = Address::new_from_array(specialist_pk);
        ctx.accounts
            .commit(job_id, commitment, role, consumer_addr, specialist_addr, &ctx.bumps)
    }

    /// Reveal a committed rating score.
    ///
    /// Verifies sha256 commitment, records score, and — once both parties have
    /// revealed — applies rolling reputation updates to both AgentAccounts.
    /// Discriminator 2.
    #[instruction(discriminator = 2)]
    pub fn reveal(
        ctx: Ctx<Reveal>,
        job_id: u128,
        score: u8,
        salt: [u8; 32],
    ) -> Result<(), ProgramError> {
        ctx.accounts.reveal(job_id, score, salt)
    }

    /// Expire a rating where one party committed and the other timed out.
    ///
    /// Callable by either party after RATING_EXPIRE_SLOTS slots have elapsed.
    /// Penalises the non-committing party's reputation.
    /// Discriminator 3.
    #[instruction(discriminator = 3)]
    pub fn expire(ctx: Ctx<Expire>, job_id: u128) -> Result<(), ProgramError> {
        ctx.accounts.expire(job_id)
    }
}
