#![allow(clippy::diverging_sub_expression)] // Anchor #[program] macro false positive

pub mod classic_token;
pub mod constants;
pub mod error;
pub mod instructions;
pub mod magicblock_cpi;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD");

#[program]
pub mod escrow {
    use super::*;

    // ── Phase 2: Escrow ──────────────────────────────────────────────────────

    pub fn lock_escrow(ctx: Context<LockEscrow>, amount: u64, nonce: [u8; 16]) -> Result<()> {
        instructions::lock_escrow::lock_escrow_handler(ctx, amount, nonce)
    }

    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        instructions::release_escrow::release_escrow_handler(ctx)
    }

    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        instructions::cancel_escrow::cancel_escrow_handler(ctx)
    }

    pub fn lock_token_escrow(
        ctx: Context<LockTokenEscrow>,
        amount: u64,
        nonce: [u8; 16],
    ) -> Result<()> {
        instructions::token_escrow::lock_token_escrow_handler(ctx, amount, nonce)
    }

    pub fn release_token_escrow(ctx: Context<SettleTokenEscrow>) -> Result<()> {
        instructions::token_escrow::settle_token_escrow_handler(ctx, false)
    }

    pub fn cancel_token_escrow(ctx: Context<SettleTokenEscrow>) -> Result<()> {
        instructions::token_escrow::settle_token_escrow_handler(ctx, true)
    }

    // ── Phase 3: Agent Registry ──────────────────────────────────────────────

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        agent_type: AgentType,
        model: String,
        rate_lamports: u64,
        min_reputation: u8,
    ) -> Result<()> {
        instructions::register_agent::register_agent_handler(
            ctx,
            agent_type,
            model,
            rate_lamports,
            min_reputation,
        )
    }

    pub fn update_agent(
        ctx: Context<UpdateAgent>,
        rate_lamports: u64,
        min_reputation: u8,
        active: bool,
    ) -> Result<()> {
        instructions::update_agent::update_agent_handler(ctx, rate_lamports, min_reputation, active)
    }

    pub fn deregister_agent(ctx: Context<DeregisterAgent>) -> Result<()> {
        instructions::deregister_agent::deregister_agent_handler(ctx)
    }

    // ── Phase 4: Reputation ───────────────────────────────────────────────────

    pub fn commit_rating(
        ctx: Context<CommitRating>,
        job_id: [u8; 16],
        commitment: [u8; 32],
        role: RatingRole,
        consumer_pk: Pubkey,
        specialist_pk: Pubkey,
    ) -> Result<()> {
        instructions::commit_rating::commit_rating_handler(
            ctx,
            job_id,
            commitment,
            role,
            consumer_pk,
            specialist_pk,
        )
    }

    pub fn reveal_rating(
        ctx: Context<RevealRating>,
        job_id: [u8; 16],
        score: u8,
        salt: [u8; 32],
    ) -> Result<()> {
        instructions::reveal_rating::reveal_rating_handler(ctx, job_id, score, salt)
    }

    pub fn expire_rating(ctx: Context<ExpireRating>, job_id: [u8; 16]) -> Result<()> {
        instructions::expire_rating::expire_rating_handler(ctx, job_id)
    }

    // ── Phase 5: MagicBlock PER ────────────────────────────────────────────────

    /// Mark a locked escrow as delegated to a MagicBlock PER session.
    /// TypeScript client calls Permission/Delegation Programs then calls this
    /// to record the TEE-issued session key on-chain.
    pub fn delegate_escrow(ctx: Context<DelegateEscrow>, session_key: Pubkey) -> Result<()> {
        instructions::delegate_escrow::delegate_escrow_handler(ctx, session_key)
    }

    /// Release an escrow via the PER path (routed through TEE by the TS client).
    /// Validates the session key and clears delegation state on success.
    pub fn release_escrow_per(ctx: Context<ReleaseEscrowPer>, session_key: Pubkey) -> Result<()> {
        instructions::release_escrow_per::release_escrow_per_handler(ctx, session_key)
    }

    // ── Phase 4b: Attestation Judges ─────────────────────────────────────────

    pub fn attest_quality(
        ctx: Context<AttestQuality>,
        job_id: [u8; 16],
        scores: [u8; 5],
        consumer: Pubkey,
    ) -> Result<()> {
        instructions::attest_quality::attest_quality_handler(ctx, job_id, scores, consumer)
    }

    pub fn confirm_attestation(ctx: Context<ConfirmAttestation>, job_id: [u8; 16]) -> Result<()> {
        instructions::confirm_attestation::confirm_attestation_handler(ctx, job_id)
    }

    pub fn dispute_attestation(ctx: Context<DisputeAttestation>, job_id: [u8; 16]) -> Result<()> {
        instructions::dispute_attestation::dispute_attestation_handler(ctx, job_id)
    }
}
