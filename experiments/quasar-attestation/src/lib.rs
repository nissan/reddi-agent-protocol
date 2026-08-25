#![no_std]
//! Quasar SOL-native attestation judges
//!
//! Parity port of `programs/escrow/` attestation handlers for
//! benchmark comparison against the Anchor implementation.
//!
//! Instruction map:
//! | Disc | Anchor name            | Quasar name  |
//! |------|------------------------|--------------|
//! | 0    | register_agent         | register     | (test-support: sets up AgentAccounts)
//! | 1    | attest_quality         | attest       |
//! | 2    | confirm_attestation    | confirm      |
//! | 3    | dispute_attestation    | dispute      |
//!
//! Parity guarantees:
//! - `attest`   — init PDA (dedup), agent_type guard (Attestation/Both), score range 1-10
//! - `confirm`  — consumer-only auth, double-resolve guard, accuracy reward + rep bump
//! - `dispute`  — consumer-only auth, double-resolve guard, reputation penalty
//!
//! Job binding (2026-08-24, closes CRITICAL-2 and CRITICAL-3): attestations are
//! keyed by the `quasar-escrow` escrow account address, and the confirming
//! consumer is read from that escrow. There is no judge-supplied `consumer` or
//! `job_id` anywhere in this program. See
//! `docs/QUASAR-JOB-BINDING-DESIGN-2026-08-24.md`.
//!
//! Known parity deltas (documented in QUASAR-ATTESTATION-PARITY-REPORT.md):
//! 1. `job_id` is derived from `escrow.escrow_id`, not passed by the caller.
//! 2. `confirmed: u8` sentinel (0=Pending, 1=Confirmed, 2=Disputed) vs Anchor `Option<bool>`.
//! 3. Error codes are `ProgramError::InvalidArgument` (stdlib) vs custom Anchor error codes.
//! 4. `attestation_accuracy: u16` field added to AgentAccount (extends quasar-reputation layout).

use quasar_lang::prelude::*;

mod instructions;
pub mod state;

use instructions::*;

#[cfg(test)]
mod tests;

declare_id!("CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex");

#[program]
mod quasar_attestation {
    use super::*;

    /// Register a new agent — for test setup.
    /// Owner = signer (payer). Discriminator 0.
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

    /// Create an attestation record for a completed job.
    ///
    /// Requires the job's `quasar-escrow` escrow account. The attestation PDA is
    /// seeded by the escrow address and `consumer` is read from `escrow.payer` —
    /// there is no judge-supplied `consumer` and no judge-chosen `job_id`
    /// (closes CRITICAL-2 and CRITICAL-3).
    ///
    /// Only agents registered as `Attestation` or `Both` may call this.
    /// `init` deduplicates: a second attestation on the same escrow is rejected.
    /// Discriminator 1.
    #[instruction(discriminator = 1)]
    pub fn attest(ctx: Ctx<Attest>, scores: [u8; 5]) -> Result<(), ProgramError> {
        ctx.accounts.attest(scores, &ctx.bumps)
    }

    /// Consumer agrees with the judge's assessment.
    ///
    /// Rewards judge: `attestation_accuracy += ATTESTATION_CONFIRM_WEIGHT` + reputation bump.
    /// Discriminator 2.
    #[instruction(discriminator = 2)]
    pub fn confirm(ctx: Ctx<Confirm>) -> Result<(), ProgramError> {
        ctx.accounts.confirm()
    }

    /// Consumer disagrees with the judge's assessment.
    ///
    /// Penalises judge: `reputation_score -= RATING_EXPIRE_PENALTY` (saturating).
    /// Discriminator 3.
    #[instruction(discriminator = 3)]
    pub fn dispute(ctx: Ctx<Dispute>) -> Result<(), ProgramError> {
        ctx.accounts.dispute()
    }
}
