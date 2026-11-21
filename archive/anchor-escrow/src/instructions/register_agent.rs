use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::{
    AGENT_FEE_BURN_ADDRESS, AGENT_MODEL_MAX_LEN, AGENT_REGISTRATION_FEE, AGENT_SEED,
};
use crate::error::EscrowError;
use crate::state::{AgentAccount, AgentType};

pub fn register_agent_handler(
    ctx: Context<RegisterAgent>,
    agent_type: AgentType,
    model: String,
    rate_lamports: u64,
    min_reputation: u8,
) -> Result<()> {
    require!(
        model.len() <= AGENT_MODEL_MAX_LEN,
        EscrowError::ModelTooLong
    );

    // Burn registration fee to Solana incinerator address.
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.fee_collector.to_account_info(),
            },
        ),
        AGENT_REGISTRATION_FEE,
    )?;

    let agent = &mut ctx.accounts.agent;
    agent.owner = ctx.accounts.owner.key();
    agent.agent_type = agent_type;
    agent.model = model;
    agent.rate_lamports = rate_lamports;
    agent.min_reputation = min_reputation;
    agent.reputation_score = 0;
    agent.jobs_completed = 0;
    agent.jobs_failed = 0;
    agent.created_at = Clock::get()?.unix_timestamp;
    agent.active = true;
    agent.bump = ctx.bumps.agent;

    Ok(())
}

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = owner,
        space = AgentAccount::LEN,
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump,
    )]
    pub agent: Account<'info, AgentAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: Hard-coded to Solana incinerator for fee burn.
    #[account(mut, address = AGENT_FEE_BURN_ADDRESS)]
    pub fee_collector: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
