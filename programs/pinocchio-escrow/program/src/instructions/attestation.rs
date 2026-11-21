//! Quality attestations by judge agents.
//!
//! The consumer of a rated job may name a judge when it opens the rating.
//! Once the job is paid, that judge, and nobody else, records five quality
//! scores for it. The consumer then confirms the attestation, which rewards
//! the judge, or disputes it, which costs the judge reputation.
use {
    crate::{
        checks::{at_seeds, close, create_pda, derive, now, program, signer, writable, Args},
        consts::{
            AGENT_SEED, ATTESTATION_CONFIRM_WEIGHT, ATTESTATION_SEED, RATING_COMMIT_SLOTS,
            RATING_EXPIRE_PENALTY, SYSTEM_PROGRAM_ID,
        },
        error::{
            fail, require, AccountNotEnoughKeys, AlreadyAttested, AttestationAlreadyResolved,
            AttestationNotClosable, AttestationScoreOutOfRange, ConstraintSeeds, JobNotPaid,
            NotAttestationAgent, UnauthorisedSigner,
        },
        instructions::rating::Party,
        state::{
            AgentHead, Attestation, Rating, Record, ATTESTATION_CONFIRMED, ATTESTATION_DISPUTED,
            ATTESTATION_PENDING, RATING_AWAITING_SETTLEMENT,
        },
    },
    pinocchio::{
        cpi::{Seed, Signer},
        AccountView, Address, ProgramResult,
    },
};

/// `attest_quality`: record the named judge's scores for a paid job. One per
/// job.
///
/// Accounts: `[w] attestation`, `[w] rating`, `[] judge_agent`,
/// `[w, s] judge`, `[] system_program`.
/// Data: `scores: [u8; 5]` (1 to 10 each).
///
/// The job and its consumer are taken from the rating account. The signer
/// must be the judge that account names and be registered as an attestation
/// agent (type 1 or 2). The rating account remembers that the job was
/// attested, so closing the attestation does not allow another.
pub fn attest(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let scores: [u8; 5] = Args(data).array()?;
    let [attestation, rating, judge_agent, judge, system_program, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let mut job = Rating::load_checked(rating, program_id)?;
    let (head, _, terms) = AgentHead::load_full(judge_agent, program_id)?;
    signer(judge)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;
    writable(attestation)?;
    writable(rating)?;
    writable(judge)?;

    require(
        job.has_judge() && judge.address() == &job.judge,
        &UnauthorisedSigner,
    )?;
    require(job.state != RATING_AWAITING_SETTLEMENT, &JobNotPaid)?;
    require(!job.attested(), &AlreadyAttested)?;
    at_seeds(
        judge_agent,
        &[AGENT_SEED, judge.address().as_ref(), &[terms.bump()]],
        program_id,
    )?;
    require(head.agent_type() != 0, &NotAttestationAgent)?;
    require(
        scores.iter().all(|score| (1..=10).contains(score)),
        &AttestationScoreOutOfRange,
    )?;

    let (address, bump) = derive(&[ATTESTATION_SEED, job.escrow.as_ref()], program_id);
    require(attestation.address() == &address, &ConstraintSeeds)?;
    let bump = [bump];
    let seeds = [
        Seed::from(ATTESTATION_SEED),
        Seed::from(job.escrow.as_ref()),
        Seed::from(&bump),
    ];
    create_pda(
        judge,
        attestation,
        Attestation::LEN,
        program_id,
        &Signer::from(&seeds),
    )?;
    Attestation::new(
        &job.escrow,
        judge.address(),
        &job.consumer,
        scores,
        now()?.0,
        bump[0],
    )
    .store(attestation)?;
    job.set_attested();
    job.store(rating)
}

/// `confirm_attestation` (`confirmed` true) and `dispute_attestation`.
///
/// Accounts: `[w] attestation`, `[w] judge_agent`, `[s] consumer`.
/// No data.
///
/// Only the consumer named in the attestation may resolve it, once.
/// Confirming raises the judge's attestation accuracy and folds a top score
/// into its reputation. Disputing takes reputation away. `judge_agent` is
/// the agent address derived from the judge; if the judge is no longer
/// registered there, the resolution is recorded and no record is updated.
pub fn resolve(
    program_id: &Address,
    accounts: &mut [AccountView],
    confirmed: bool,
) -> ProgramResult {
    let [attestation, judge_agent, consumer, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let mut record = Attestation::load_checked(attestation, program_id)?;
    signer(consumer)?;
    writable(attestation)?;
    let mut judge = Party::load(judge_agent, &record.judge, program_id)?;

    require(consumer.address() == &record.consumer, &UnauthorisedSigner)?;
    require(
        record.resolution == ATTESTATION_PENDING,
        &AttestationAlreadyResolved,
    )?;
    if confirmed {
        record.resolution = ATTESTATION_CONFIRMED;
        judge.update(|terms| {
            terms.raise_accuracy(ATTESTATION_CONFIRM_WEIGHT);
            terms.fold_rating(10);
        });
    } else {
        record.resolution = ATTESTATION_DISPUTED;
        judge.update(|terms| terms.penalise(RATING_EXPIRE_PENALTY));
    }
    record.store(attestation)?;
    judge.store()
}

/// `close_attestation`: close an attestation and return its rent to the
/// judge, who paid it.
///
/// Accounts: `[w] attestation`, `[w, s] judge`.
/// No data.
///
/// Allowed once the consumer has resolved it, or, while it is unresolved,
/// after `RATING_COMMIT_SLOTS` from the slot it was made in.
pub fn close_resolved(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [attestation, judge, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let record = Attestation::load_checked(attestation, program_id)?;
    signer(judge)?;
    writable(attestation)?;
    writable(judge)?;
    require(judge.address() == &record.judge, &UnauthorisedSigner)?;
    require(
        record.resolution != ATTESTATION_PENDING
            || now()?.0 > record.created_slot().saturating_add(RATING_COMMIT_SLOTS),
        &AttestationNotClosable,
    )?;
    close(attestation, judge)
}
