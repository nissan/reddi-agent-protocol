use anchor_lang::prelude::*;

use crate::constants::{AGENT_SEED, RATING_EXPIRE_PENALTY, RATING_EXPIRE_SLOTS, RATING_SEED};
use crate::error::EscrowError;
use crate::state::{AgentAccount, RatingAccount, RatingState};

/// Expire a rating where one party committed and the other timed out.
///
/// Callable by either party after RATING_EXPIRE_SLOTS slots have elapsed
/// from account creation.  Penalises the non-committing party's reputation.
pub fn expire_rating_handler(ctx: Context<ExpireRating>, _job_id: [u8; 16]) -> Result<()> {
    let clock = Clock::get()?;
    let rating = &mut ctx.accounts.rating;

    // Only Pending ratings can expire
    require!(
        rating.state == RatingState::Pending,
        EscrowError::AlreadyFinalised
    );

    // Time-lock: must have waited long enough
    let elapsed = clock.slot.saturating_sub(rating.created_slot);
    require!(elapsed >= RATING_EXPIRE_SLOTS, EscrowError::NotExpired);

    rating.state = RatingState::Expired;

    // Penalise the party that did NOT commit
    let consumer_committed = rating.consumer_commitment != [0u8; 32];
    let specialist_committed = rating.specialist_commitment != [0u8; 32];

    if consumer_committed && !specialist_committed {
        // Specialist ghosted — penalise specialist
        let specialist = &mut ctx.accounts.specialist_agent;
        specialist.reputation_score = specialist
            .reputation_score
            .saturating_sub(RATING_EXPIRE_PENALTY);
        specialist.jobs_failed = specialist.jobs_failed.saturating_add(1);
    } else if specialist_committed && !consumer_committed {
        // Consumer ghosted — penalise consumer
        let consumer = &mut ctx.accounts.consumer_agent;
        consumer.reputation_score = consumer
            .reputation_score
            .saturating_sub(RATING_EXPIRE_PENALTY);
        consumer.jobs_failed = consumer.jobs_failed.saturating_add(1);
    }
    // If somehow neither committed (shouldn't happen in Pending), no penalty

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct ExpireRating<'info> {
    #[account(
        mut,
        seeds = [RATING_SEED, job_id.as_ref()],
        bump = rating.bump,
    )]
    pub rating: Account<'info, RatingAccount>,

    /// Either consumer or specialist may trigger expiry
    pub caller: Signer<'info>,

    /// Specialist AgentAccount — may be penalised
    #[account(
        mut,
        seeds = [AGENT_SEED, rating.specialist.as_ref()],
        bump = specialist_agent.bump,
    )]
    pub specialist_agent: Account<'info, AgentAccount>,

    /// Consumer AgentAccount — may be penalised
    #[account(
        mut,
        seeds = [AGENT_SEED, rating.consumer.as_ref()],
        bump = consumer_agent.bump,
    )]
    pub consumer_agent: Account<'info, AgentAccount>,
}
