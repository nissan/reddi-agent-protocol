//! Agent registry: one record per owner wallet.
use {
    crate::{
        checks::{close, create_pda, derive, now, program, signer, transfer, writable, Args},
        consts::{
            AGENT_FEE_BURN_ADDRESS, AGENT_MODEL_MAX_LEN, AGENT_REGISTRATION_FEE, AGENT_SEED,
            SYSTEM_PROGRAM_ID,
        },
        error::{
            fail, require, AccountNotEnoughKeys, ConstraintAddress, ConstraintSeeds,
            InstructionDidNotDeserialize, ModelTooLong,
        },
        state::AgentHead,
    },
    pinocchio::{
        cpi::{Seed, Signer},
        AccountView, Address, ProgramResult,
    },
};

/// `register_agent`: create the caller's registry record and burn the
/// registration fee.
///
/// Accounts: `[w] agent`, `[w, s] owner`, `[w] fee_collector` (the
/// incinerator), `[] system_program`.
/// Data: `agent_type: u8` (0 primary, 1 attestation, 2 both), `model: string`
/// (u32 length, then UTF-8), `rate_lamports: u64`, `min_reputation: u8`.
pub fn register(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut args = Args(data);
    let agent_type = args.u8()?;
    let model_len = args.u32()? as usize;
    let model = args.bytes(model_len)?;
    let rate_lamports = args.u64()?;
    let min_reputation = args.u8()?;
    if agent_type > 2 || core::str::from_utf8(model).is_err() {
        return Err(fail(&InstructionDidNotDeserialize));
    }

    let [agent, owner, fee_collector, system_program, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    signer(owner)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;

    let (address, bump) = derive(&[AGENT_SEED, owner.address().as_ref()], program_id);
    require(agent.address() == &address, &ConstraintSeeds)?;
    let bump = [bump];
    let seeds = [
        Seed::from(AGENT_SEED),
        Seed::from(owner.address().as_ref()),
        Seed::from(&bump),
    ];
    create_pda(
        owner,
        agent,
        <AgentHead as crate::state::Record>::LEN,
        program_id,
        &Signer::from(&seeds),
    )?;
    writable(owner)?;
    writable(fee_collector)?;
    require(
        fee_collector.address() == &AGENT_FEE_BURN_ADDRESS,
        &ConstraintAddress,
    )?;

    require(model.len() <= AGENT_MODEL_MAX_LEN, &ModelTooLong)?;
    transfer(owner, fee_collector, AGENT_REGISTRATION_FEE)?;
    AgentHead::create(
        agent,
        owner.address(),
        agent_type,
        model,
        rate_lamports,
        min_reputation,
        now()?.1,
        bump[0],
    )
}

/// The record at `agent`, checked to be `owner`'s. Returns the length of its
/// model name.
fn owned_record(
    program_id: &Address,
    agent: &AccountView,
    owner: &AccountView,
) -> Result<usize, pinocchio::error::ProgramError> {
    let (head, model_len) = AgentHead::load_checked(agent, program_id)?;
    signer(owner)?;
    // The record address commits to its owner.
    require(owner.address() == &head.owner, &ConstraintSeeds)?;
    writable(agent)?;
    Ok(model_len)
}

/// `update_agent`: change the price, the reputation floor and the active flag.
///
/// Accounts: `[w] agent`, `[s] owner`.
/// Data: `rate_lamports: u64`, `min_reputation: u8`, `active: bool`.
pub fn update(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut args = Args(data);
    let rate_lamports = args.u64()?;
    let min_reputation = args.u8()?;
    let active = args.bool()?;
    let [agent, owner, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let model_len = owned_record(program_id, agent, owner)?;
    AgentHead::set_terms(agent, model_len, rate_lamports, min_reputation, active)
}

/// `deregister_agent`: close the record and return its rent to the owner.
///
/// Accounts: `[w] agent`, `[w, s] owner`.
pub fn deregister(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [agent, owner, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    owned_record(program_id, agent, owner)?;
    writable(owner)?;
    close(agent, owner)
}
