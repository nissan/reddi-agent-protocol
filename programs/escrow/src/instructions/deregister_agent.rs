use anchor_lang::prelude::*;

use crate::constants::AGENT_SEED;
use crate::state::AgentAccount;

pub fn deregister_agent_handler(_ctx: Context<DeregisterAgent>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct DeregisterAgent<'info> {
    #[account(
        mut,
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump = agent.bump,
        has_one = owner,
        close = owner,
    )]
    pub agent: Account<'info, AgentAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
}
