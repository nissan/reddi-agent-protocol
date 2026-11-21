//! Quality attestations by judge agents (`extended` builds only).
//!
//! A registered judge records five quality scores for a job. The job's
//! consumer then confirms the attestation, which rewards the judge, or
//! disputes it, which costs the judge reputation.
use {
    crate::{
        checks::{at_seeds, create_pda, derive, now, program, signer, writable, Args},
        consts::{
            AGENT_SEED, ATTESTATION_CONFIRM_WEIGHT, ATTESTATION_SEED, RATING_EXPIRE_PENALTY,
            SYSTEM_PROGRAM_ID,
        },
        error::{
            fail, require, AccountNotEnoughKeys, AttestationAlreadyResolved,
            AttestationScoreOutOfRange, ConstraintSeeds, NotAttestationAgent, UnauthorisedSigner,
        },
        state::{AgentHead, Attestation},
    },
    pinocchio::{
        cpi::{Seed, Signer},
        AccountView, Address, ProgramResult,
    },
};

/// `attest_quality`: record a judge's scores for a job. One per job.
///
/// Accounts: `[w] attestation`, `[] judge_agent`, `[w, s] judge`,
/// `[] system_program`.
/// Data: `job_id: [u8; 16]`, `scores: [u8; 5]` (1 to 10 each),
/// `consumer: address`.
///
/// The judge must be registered as an attestation agent (type 1 or 2).
pub fn attest(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut args = Args(data);
    let job_id: [u8; 16] = args.array()?;
    let scores: [u8; 5] = args.array()?;
    let consumer: [u8; 32] = args.array()?;
    let [attestation, judge_agent, judge, system_program, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let (head, _, terms) = AgentHead::load_full(judge_agent, program_id)?;
    signer(judge)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;

    let (address, bump) = derive(&[ATTESTATION_SEED, &job_id], program_id);
    require(attestation.address() == &address, &ConstraintSeeds)?;
    let bump = [bump];
    let seeds = [
        Seed::from(ATTESTATION_SEED),
        Seed::from(&job_id),
        Seed::from(&bump),
    ];
    create_pda(
        judge,
        attestation,
        Attestation::LEN,
        program_id,
        &Signer::from(&seeds),
    )?;
    at_seeds(
        judge_agent,
        &[AGENT_SEED, judge.address().as_ref(), &[terms.bump()]],
        program_id,
    )?;
    writable(judge)?;

    require(head.agent_type() != 0, &NotAttestationAgent)?;
    require(
        scores.iter().all(|score| (1..=10).contains(score)),
        &AttestationScoreOutOfRange,
    )?;
    Attestation {
        job_id,
        judge: *judge.address(),
        consumer: Address::new_from_array(consumer),
        scores,
        confirmed: None,
        created_at: now()?.1,
        bump: bump[0],
    }
    .store(attestation)
}

/// `confirm_attestation` (`confirmed` true) and `dispute_attestation`.
///
/// Accounts: `[w] attestation`, `[w] judge_agent`, `[s] consumer`.
/// Data: `job_id: [u8; 16]`.
///
/// Only the consumer named in the attestation may resolve it, once.
/// Confirming raises the judge's attestation accuracy and folds a top score
/// into its reputation. Disputing takes reputation away.
pub fn resolve(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
    confirmed: bool,
) -> ProgramResult {
    let job_id: [u8; 16] = Args(data).array()?;
    let [attestation, judge_agent, consumer, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let mut record = Attestation::load(attestation, program_id)?;
    let (_, model_len, mut terms) = AgentHead::load_full(judge_agent, program_id)?;
    signer(consumer)?;

    at_seeds(
        attestation,
        &[ATTESTATION_SEED, &job_id, &[record.bump]],
        program_id,
    )?;
    writable(attestation)?;
    at_seeds(
        judge_agent,
        &[AGENT_SEED, record.judge.as_ref(), &[terms.bump()]],
        program_id,
    )?;
    writable(judge_agent)?;

    require(consumer.address() == &record.consumer, &UnauthorisedSigner)?;
    require(record.confirmed.is_none(), &AttestationAlreadyResolved)?;
    record.confirmed = Some(confirmed);
    if confirmed {
        terms.raise_accuracy(ATTESTATION_CONFIRM_WEIGHT);
        terms.fold_rating(10);
    } else {
        terms.penalise(RATING_EXPIRE_PENALTY);
    }
    record.store(attestation)?;
    AgentHead::store_terms(judge_agent, model_len, &terms)
}
