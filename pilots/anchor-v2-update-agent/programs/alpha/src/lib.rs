extern crate alloc;

use anchor_lang::prelude::*;

declare_id!("794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD");

const AGENT_SEED: &[u8] = b"agent";

#[program]
pub mod alpha_update_agent {
    use super::*;

    pub fn update_agent(
        ctx: &mut Context<UpdateAgent>,
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
}

#[derive(Accounts)]
pub struct UpdateAgent {
    #[account(
        mut,
        seeds = [AGENT_SEED, owner.address().as_ref()],
        bump = agent.bump,
    )]
    pub agent: BorshAccount<AgentAccount>,
    #[account(address = agent.owner)]
    pub owner: Signer,
}

#[account(borsh)]
pub struct AgentAccount {
    pub owner: Address,
    pub agent_type: AgentType,
    pub model: alloc::string::String,
    pub rate_lamports: u64,
    pub min_reputation: u8,
    pub reputation_score: u16,
    pub jobs_completed: u64,
    pub jobs_failed: u64,
    pub created_at: i64,
    pub active: bool,
    pub attestation_accuracy: u16,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, IdlType, Clone, PartialEq, Eq, Debug)]
pub enum AgentType {
    Primary,
    Attestation,
    Both,
}
