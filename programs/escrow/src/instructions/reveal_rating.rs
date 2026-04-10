use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::constants::{AGENT_SEED, RATING_SEED};
use crate::error::EscrowError;
use crate::state::{AgentAccount, RatingAccount, RatingState};

/// Reveal a committed rating score.
///
/// Verifies the sha256 commitment, records the score, and — once both
/// parties have revealed — applies a rolling reputation update to both
/// AgentAccounts.
pub fn reveal_rating_handler(
    ctx: Context<RevealRating>,
    _job_id: [u8; 16],
    score: u8,
    salt: [u8; 32],
) -> Result<()> {
    let signer = ctx.accounts.signer.key();

    // Must be in BothCommitted state
    require!(
        ctx.accounts.rating.state == RatingState::BothCommitted,
        EscrowError::BothMustCommitFirst
    );

    // Score range check
    require!(score >= 1 && score <= 10, EscrowError::InvalidScore);

    // Compute sha256(score || salt)
    let mut hasher = Sha256::new();
    hasher.update([score]);
    hasher.update(salt);
    let computed_bytes: [u8; 32] = hasher.finalize().into();

    let rating = &mut ctx.accounts.rating;

    // Determine role and verify commitment
    let is_consumer = signer == rating.consumer;
    let is_specialist = signer == rating.specialist;

    if is_consumer {
        require!(
            computed_bytes == rating.consumer_commitment,
            EscrowError::CommitmentMismatch
        );
        rating.consumer_score = Some(score);
    } else if is_specialist {
        require!(
            computed_bytes == rating.specialist_commitment,
            EscrowError::CommitmentMismatch
        );
        rating.specialist_score = Some(score);
    } else {
        // Signer is neither party — reject
        return err!(EscrowError::UnauthorisedSigner);
    }

    // Both revealed → finalize
    if rating.consumer_score.is_some() && rating.specialist_score.is_some() {
        rating.state = RatingState::Revealed;

        // Update specialist's reputation based on consumer's score
        if let Some(consumer_given) = rating.consumer_score {
            let specialist = &mut ctx.accounts.specialist_agent;
            apply_reputation_update(specialist, consumer_given);
        }

        // Update consumer's reputation based on specialist's score
        if let Some(specialist_given) = rating.specialist_score {
            let consumer = &mut ctx.accounts.consumer_agent;
            apply_reputation_update(consumer, specialist_given);
        }
    }

    Ok(())
}

/// Rolling average: new_score = (old_score * 9 + new_rating_scaled) / 10
/// `rating_1_10` is 1-10 → scale to 0-10000 as `rating * 1000`
fn apply_reputation_update(agent: &mut Account<AgentAccount>, rating_1_10: u8) {
    let new_scaled = (rating_1_10 as u32) * 1000;
    let old = agent.reputation_score as u32;
    let updated = (old * 9 + new_scaled) / 10;
    agent.reputation_score = updated.min(10000) as u16;
    agent.jobs_completed = agent.jobs_completed.saturating_add(1);
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct RevealRating<'info> {
    #[account(
        mut,
        seeds = [RATING_SEED, job_id.as_ref()],
        bump = rating.bump,
    )]
    pub rating: Account<'info, RatingAccount>,

    pub signer: Signer<'info>,

    /// Specialist AgentAccount — receives consumer's rating
    #[account(
        mut,
        seeds = [AGENT_SEED, rating.specialist.as_ref()],
        bump = specialist_agent.bump,
    )]
    pub specialist_agent: Account<'info, AgentAccount>,

    /// Consumer AgentAccount — receives specialist's rating
    #[account(
        mut,
        seeds = [AGENT_SEED, rating.consumer.as_ref()],
        bump = consumer_agent.bump,
    )]
    pub consumer_agent: Account<'info, AgentAccount>,
}
