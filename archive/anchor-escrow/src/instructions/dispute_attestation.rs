use anchor_lang::prelude::*;

use crate::constants::{AGENT_SEED, ATTESTATION_SEED, RATING_EXPIRE_PENALTY};
use crate::error::EscrowError;
use crate::state::{AgentAccount, AttestationAccount};

/// Consumer disagrees with the judge's assessment.
///
/// - Marks `attestation.confirmed = Some(false)`
/// - Penalises the judge: decrement `reputation_score` by `RATING_EXPIRE_PENALTY`
pub fn dispute_attestation_handler(
    ctx: Context<DisputeAttestation>,
    _job_id: [u8; 16],
) -> Result<()> {
    let attestation = &mut ctx.accounts.attestation;

    // Only the job consumer can dispute
    require!(
        ctx.accounts.consumer.key() == attestation.consumer,
        EscrowError::UnauthorisedSigner
    );

    // Cannot resolve twice
    require!(
        attestation.confirmed.is_none(),
        EscrowError::AttestationAlreadyResolved
    );

    attestation.confirmed = Some(false);

    // Penalise judge's reputation
    let judge = &mut ctx.accounts.judge_agent;
    judge.reputation_score = judge.reputation_score.saturating_sub(RATING_EXPIRE_PENALTY);

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct DisputeAttestation<'info> {
    #[account(
        mut,
        seeds = [ATTESTATION_SEED, job_id.as_ref()],
        bump = attestation.bump,
    )]
    pub attestation: Account<'info, AttestationAccount>,

    /// Judge's AgentAccount — receives the penalty
    #[account(
        mut,
        seeds = [AGENT_SEED, attestation.judge.as_ref()],
        bump = judge_agent.bump,
    )]
    pub judge_agent: Account<'info, AgentAccount>,

    /// The job consumer (must match attestation.consumer)
    pub consumer: Signer<'info>,
}
