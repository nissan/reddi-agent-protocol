use anchor_lang::prelude::*;

use crate::constants::AGENT_SEED;
use crate::state::AgentAccount;

pub fn update_agent_handler(
    ctx: Context<UpdateAgent>,
    rate_lamports: u64,
    min_reputation: u8,
    active: bool,
) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    agent.rate_lamports = rate_lamports;
    agent.min_reputation = min_reputation;
    agent.active = active;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateAgent<'info> {
    #[account(
        mut,
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump = agent.bump,
        has_one = owner,
    )]
    pub agent: Account<'info, AgentAccount>,

    pub owner: Signer<'info>,
}
