use anchor_lang::prelude::*;

use crate::constants::{AGENT_SEED, ATTESTATION_CONFIRM_WEIGHT, ATTESTATION_SEED};
use crate::error::EscrowError;
use crate::state::{AgentAccount, AttestationAccount};

/// Consumer agrees with the judge's assessment.
///
/// - Marks `attestation.confirmed = Some(true)`
/// - Rewards the judge: rolling average on `reputation_score` and
///   increment of `attestation_accuracy`
pub fn confirm_attestation_handler(
    ctx: Context<ConfirmAttestation>,
    _job_id: [u8; 16],
) -> Result<()> {
    let attestation = &mut ctx.accounts.attestation;

    // Only the job consumer can confirm
    require!(
        ctx.accounts.consumer.key() == attestation.consumer,
        EscrowError::UnauthorisedSigner
    );

    // Cannot resolve twice
    require!(
        attestation.confirmed.is_none(),
        EscrowError::AttestationAlreadyResolved
    );

    attestation.confirmed = Some(true);

    // Reward judge's attestation_accuracy
    let judge = &mut ctx.accounts.judge_agent;
    judge.attestation_accuracy = judge
        .attestation_accuracy
        .saturating_add(ATTESTATION_CONFIRM_WEIGHT)
        .min(10_000);

    // Rolling average reputation bump: treat confirmation as score=10 (max quality)
    let new_scaled: u32 = 10_000; // 10 * 1000
    let old = judge.reputation_score as u32;
    let updated = (old * 9 + new_scaled) / 10;
    judge.reputation_score = updated.min(10_000) as u16;

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct ConfirmAttestation<'info> {
    #[account(
        mut,
        seeds = [ATTESTATION_SEED, job_id.as_ref()],
        bump = attestation.bump,
    )]
    pub attestation: Account<'info, AttestationAccount>,

    /// Judge's AgentAccount — receives the reward
    #[account(
        mut,
        seeds = [AGENT_SEED, attestation.judge.as_ref()],
        bump = judge_agent.bump,
    )]
    pub judge_agent: Account<'info, AgentAccount>,

    /// The job consumer (must match attestation.consumer)
    pub consumer: Signer<'info>,
}
