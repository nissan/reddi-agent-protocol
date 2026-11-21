use anchor_lang::prelude::*;

use crate::constants::RATING_SEED;
use crate::error::EscrowError;
use crate::state::{RatingAccount, RatingRole, RatingState};

/// Submit a blind commitment for a job rating.
///
/// The first caller (either consumer or specialist) creates the `RatingAccount`
/// PDA and records **both** party pubkeys.  This means both agent addresses must
/// be known at job start — which is always the case: the consumer knows who they
/// hired, and the specialist knows who hired them.  Recording both pubkeys upfront
/// ensures `expire_rating` can always load both `AgentAccount` PDAs, even when
/// one party later ghosts.
///
/// The second caller just fills in their commitment hash.
pub fn commit_rating_handler(
    ctx: Context<CommitRating>,
    _job_id: [u8; 16],
    commitment: [u8; 32],
    role: RatingRole,
    consumer_pk: Pubkey,
    specialist_pk: Pubkey,
) -> Result<()> {
    let rating = &mut ctx.accounts.rating;
    let clock = Clock::get()?;
    let signer = ctx.accounts.signer.key();

    // Reject if already finalised
    require!(
        rating.state != RatingState::Revealed && rating.state != RatingState::Expired,
        EscrowError::AlreadyFinalised
    );

    // On first commit: initialise metadata and store both party pubkeys
    if rating.created_at == 0 {
        rating.job_id = _job_id;
        rating.consumer = consumer_pk;
        rating.specialist = specialist_pk;
        rating.created_at = clock.unix_timestamp;
        rating.created_slot = clock.slot;
        rating.state = RatingState::Pending;
        rating.bump = ctx.bumps.rating;
    }

    match role {
        RatingRole::Consumer => {
            require!(signer == rating.consumer, EscrowError::UnauthorisedSigner);
            require!(
                rating.consumer_commitment == [0u8; 32],
                EscrowError::AlreadyCommitted
            );
            rating.consumer_commitment = commitment;
        }
        RatingRole::Specialist => {
            require!(signer == rating.specialist, EscrowError::UnauthorisedSigner);
            require!(
                rating.specialist_commitment == [0u8; 32],
                EscrowError::AlreadyCommitted
            );
            rating.specialist_commitment = commitment;
        }
    }

    // Advance to BothCommitted when both commitments are set
    if rating.consumer_commitment != [0u8; 32] && rating.specialist_commitment != [0u8; 32] {
        rating.state = RatingState::BothCommitted;
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct CommitRating<'info> {
    #[account(
        init_if_needed,
        payer = signer,
        space = RatingAccount::LEN,
        seeds = [RATING_SEED, job_id.as_ref()],
        bump,
    )]
    pub rating: Account<'info, RatingAccount>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
