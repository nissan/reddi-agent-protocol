use anchor_lang::prelude::*;

use crate::constants::{AGENT_SEED, ATTESTATION_SEED};
use crate::error::EscrowError;
use crate::state::{AgentAccount, AgentType, AttestationAccount};

/// Create an attestation record for a completed job.
///
/// Only agents registered as `Attestation` or `Both` may call this.
/// Creates an `AttestationAccount` PDA; duplicate attestations on the same
/// job_id are rejected via Anchor's `init` constraint.
pub fn attest_quality_handler(
    ctx: Context<AttestQuality>,
    _job_id: [u8; 16],
    scores: [u8; 5],
    consumer: Pubkey,
) -> Result<()> {
    // Validate agent type
    let agent_type = &ctx.accounts.judge_agent.agent_type;
    require!(
        *agent_type == AgentType::Attestation || *agent_type == AgentType::Both,
        EscrowError::NotAttestationAgent
    );

    // Validate all scores 1-10
    for &s in scores.iter() {
        require!(s >= 1 && s <= 10, EscrowError::AttestationScoreOutOfRange);
    }

    let attestation = &mut ctx.accounts.attestation;
    attestation.job_id = _job_id;
    attestation.judge = ctx.accounts.judge.key();
    attestation.consumer = consumer;
    attestation.scores = scores;
    attestation.confirmed = None;
    attestation.created_at = Clock::get()?.unix_timestamp;
    attestation.bump = ctx.bumps.attestation;

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct AttestQuality<'info> {
    /// Attestation PDA — init enforces one-per-job dedup
    #[account(
        init,
        payer = judge,
        space = AttestationAccount::LEN,
        seeds = [ATTESTATION_SEED, job_id.as_ref()],
        bump,
    )]
    pub attestation: Account<'info, AttestationAccount>,

    /// Judge's AgentAccount — must be Attestation or Both
    #[account(
        seeds = [AGENT_SEED, judge.key().as_ref()],
        bump = judge_agent.bump,
    )]
    pub judge_agent: Account<'info, AgentAccount>,

    #[account(mut)]
    pub judge: Signer<'info>,

    pub system_program: Program<'info, System>,
}
