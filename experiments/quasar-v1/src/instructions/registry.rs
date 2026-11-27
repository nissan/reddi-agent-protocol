use {
    crate::{constants::*, error::EscrowError, state::*},
    quasar_lang::{prelude::*, sysvars::Sysvar as _},
};

#[derive(Accounts)]
pub struct RegisterAgent {
    #[account(mut, init, payer = owner, address = AgentAccount::seeds(owner.address()))]
    pub agent: Account<AgentAccount>,
    #[account(mut)]
    pub owner: Signer,
    /// The Solana incinerator: the registration fee is burned.
    #[account(mut, address = AGENT_FEE_BURN_ADDRESS)]
    pub fee_collector: UncheckedAccount,
    pub system_program: Program<SystemProgram>,
}

impl RegisterAgent {
    #[inline(always)]
    pub fn register(
        &mut self,
        agent_type: u8,
        model: &str,
        rate_lamports: u64,
        min_reputation: u8,
        bumps: &RegisterAgentBumps,
    ) -> Result<(), ProgramError> {
        require!(
            agent_type <= AGENT_TYPE_MAX,
            ProgramError::InvalidInstructionData
        );
        require!(
            model.len() <= AGENT_MODEL_MAX_LEN,
            EscrowError::ModelTooLong
        );

        self.system_program
            .transfer(&self.owner, &self.fee_collector, AGENT_REGISTRATION_FEE)
            .invoke()?;

        let agent = &mut *self.agent;
        agent.owner = *self.owner.address();
        agent.agent_type = agent_type;
        agent.rate_lamports = rate_lamports.into();
        agent.min_reputation = min_reputation;
        agent.reputation_score = 0.into();
        agent.jobs_completed = 0.into();
        agent.jobs_failed = 0.into();
        agent.created_at = Clock::get()?.unix_timestamp;
        agent.active = true.into();
        agent.attestation_accuracy = 0.into();
        agent.bump = bumps.agent;
        require!(agent.model.set(model), EscrowError::ModelTooLong);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct UpdateAgent {
    #[account(mut, has_one(owner), address = AgentAccount::seeds(owner.address()))]
    pub agent: Account<AgentAccount>,
    pub owner: Signer,
}

impl UpdateAgent {
    #[inline(always)]
    pub fn update(
        &mut self,
        rate_lamports: u64,
        min_reputation: u8,
        active: bool,
    ) -> Result<(), ProgramError> {
        self.agent.rate_lamports = rate_lamports.into();
        self.agent.min_reputation = min_reputation;
        self.agent.active = active.into();
        Ok(())
    }
}

#[derive(Accounts)]
pub struct DeregisterAgent {
    #[account(
        mut,
        has_one(owner),
        close(dest = owner),
        address = AgentAccount::seeds(owner.address())
    )]
    pub agent: Account<AgentAccount>,
    #[account(mut)]
    pub owner: Signer,
}

impl DeregisterAgent {
    #[inline(always)]
    pub fn deregister(&self) -> Result<(), ProgramError> {
        Ok(())
    }
}
