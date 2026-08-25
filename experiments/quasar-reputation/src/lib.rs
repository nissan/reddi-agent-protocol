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
//! Job binding (2026-08-24, closes CRITICAL-1): ratings are keyed by the
//! `quasar-escrow` escrow account address, and the parties are read from that
//! escrow. There is no caller-supplied `job_id`, `consumer_pk` or
//! `specialist_pk` anywhere in this program. See
//! `docs/QUASAR-JOB-BINDING-DESIGN-2026-08-24.md`.
//!
//! Known parity deltas (documented in QUASAR-REPUTATION-PARITY-REPORT.md):
//! 1. `job_id` is derived from `escrow.escrow_id`, not passed by the caller.
//! 2. `consumer_score`/`specialist_score` use `u8` sentinel (0=unrevealed) vs Anchor `Option<u8>`.
//! 3. `RatingRole`/`RatingState` passed as `u8` vs typed enums.
//! 4. Error codes are `ProgramError::InvalidArgument` (stdlib) vs custom Anchor error codes.
//! 5. `Clock` is now used for reputation (unlike registry which omitted it).

use quasar_lang::prelude::*;

/// Shared, owner-checked mirror of the `quasar-escrow` escrow account.
/// Re-exported so the binding primitive has one canonical definition across
/// `quasar-reputation` and `quasar-attestation`.
pub use quasar_escrow_ref as escrow_ref;

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
    /// Requires the job's `quasar-escrow` escrow account. The rating PDA is
    /// seeded by the escrow address and both parties are read from
    /// `escrow.payer` / `escrow.payee` — there are no caller-supplied party
    /// pubkeys and no caller-chosen `job_id` (closes CRITICAL-1).
    ///
    /// First call creates the RatingAccount PDA; the second fills in the
    /// remaining commitment.
    /// Discriminator 1.
    #[instruction(discriminator = 1)]
    pub fn commit(
        ctx: Ctx<Commit>,
        commitment: [u8; 32],
        role: u8,
    ) -> Result<(), ProgramError> {
        ctx.accounts.commit(commitment, role, &ctx.bumps)
    }

    /// Reveal a committed rating score.
    ///
    /// Verifies sha256 commitment, records score, and — once both parties have
    /// revealed — applies rolling reputation updates to both AgentAccounts.
    /// Discriminator 2.
    #[instruction(discriminator = 2)]
    pub fn reveal(ctx: Ctx<Reveal>, score: u8, salt: [u8; 32]) -> Result<(), ProgramError> {
        ctx.accounts.reveal(score, salt)
    }

    /// Expire a rating where one party committed and the other timed out.
    ///
    /// Callable by either party after RATING_EXPIRE_SLOTS slots have elapsed.
    /// Penalises the non-committing party's reputation.
    /// Discriminator 3.
    #[instruction(discriminator = 3)]
    pub fn expire(ctx: Ctx<Expire>) -> Result<(), ProgramError> {
        ctx.accounts.expire()
    }
}
