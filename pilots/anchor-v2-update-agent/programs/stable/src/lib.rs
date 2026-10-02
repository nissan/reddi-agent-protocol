use anchor_lang::prelude::*;

declare_id!("794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD");

const AGENT_SEED: &[u8] = b"agent";

#[program]
pub mod stable_update_agent {
    use super::*;

    pub fn update_agent(
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

#[account]
pub struct AgentAccount {
    pub owner: Pubkey,
    pub agent_type: AgentType,
    pub model: String,
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum AgentType {
    Primary,
    Attestation,
    Both,
}
