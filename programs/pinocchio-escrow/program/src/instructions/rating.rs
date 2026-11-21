//! Blind commit-reveal ratings (`extended` builds only).
//!
//! After a job, each party commits to sha256(score, salt) without seeing the
//! other's score. Once both have committed, each reveals. When both have
//! revealed, each party's score is folded into the other's reputation. If
//! one side never commits, the rating can be expired after a week and the
//! silent side loses reputation.
use {
    crate::{
        checks::{at_seeds, create_pda, derive, now, program, sha256, signer, writable, Args},
        consts::{
            AGENT_SEED, RATING_EXPIRE_PENALTY, RATING_EXPIRE_SLOTS, RATING_SEED, SYSTEM_PROGRAM_ID,
        },
        error::{
            fail, require, AccountNotEnoughKeys, AlreadyCommitted, AlreadyFinalised,
            BothMustCommitFirst, CommitmentMismatch, ConstraintDuplicateMutableAccount,
            ConstraintSeeds, InstructionDidNotDeserialize, InvalidScore, NotExpired,
            UnauthorisedSigner,
        },
        state::{AgentHead, AgentTerms, Rating},
    },
    pinocchio::{
        cpi::{Seed, Signer},
        error::ProgramError,
        AccountView, Address, ProgramResult,
    },
};

const UNSET: [u8; 32] = [0; 32];

/// `commit_rating`: record the caller's commitment for a job.
///
/// Accounts: `[w] rating`, `[w, s] signer`, `[] system_program`.
/// Data: `job_id: [u8; 16]`, `commitment: [u8; 32]`, `role: u8` (0 consumer,
/// 1 specialist), `consumer: address`, `specialist: address`.
///
/// The first commitment for a job creates the rating and records who the two
/// parties are; the caller must be the party its role names. The second
/// commitment fills in the other side.
pub fn commit(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut args = Args(data);
    let job_id: [u8; 16] = args.array()?;
    let commitment: [u8; 32] = args.array()?;
    let role = args.u8()?;
    let consumer: [u8; 32] = args.array()?;
    let specialist: [u8; 32] = args.array()?;
    if role > 1 {
        return Err(fail(&InstructionDidNotDeserialize));
    }
    let [rating, caller, system_program, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    signer(caller)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;

    let (address, bump) = derive(&[RATING_SEED, &job_id], program_id);
    require(rating.address() == &address, &ConstraintSeeds)?;
    let mut record = if rating.owned_by(&SYSTEM_PROGRAM_ID) {
        let bump = [bump];
        let seeds = [
            Seed::from(RATING_SEED),
            Seed::from(&job_id),
            Seed::from(&bump),
        ];
        create_pda(
            caller,
            rating,
            Rating::LEN,
            program_id,
            &Signer::from(&seeds),
        )?;
        Rating::EMPTY
    } else {
        Rating::load(rating, program_id)?
    };
    writable(rating)?;
    writable(caller)?;

    require(
        record.state != Rating::REVEALED && record.state != Rating::EXPIRED,
        &AlreadyFinalised,
    )?;
    // A rating whose creation time is unset has not recorded its parties yet.
    if record.created_at == 0 {
        let (slot, unix_time) = now()?;
        record.job_id = job_id;
        record.consumer = Address::new_from_array(consumer);
        record.specialist = Address::new_from_array(specialist);
        record.created_at = unix_time;
        record.created_slot = slot;
        record.state = Rating::PENDING;
        record.bump = bump;
    }
    let (party, slot) = if role == 0 {
        (&record.consumer, &mut record.consumer_commitment)
    } else {
        (&record.specialist, &mut record.specialist_commitment)
    };
    require(caller.address() == party, &UnauthorisedSigner)?;
    require(*slot == UNSET, &AlreadyCommitted)?;
    *slot = commitment;
    if record.consumer_commitment != UNSET && record.specialist_commitment != UNSET {
        record.state = Rating::BOTH_COMMITTED;
    }
    record.store(rating)
}

/// A rating and the registry records of its two parties, checked.
struct Rated<'a> {
    rating: &'a mut AccountView,
    record: Rating,
    specialist: Party<'a>,
    consumer: Party<'a>,
}

struct Party<'a> {
    account: &'a mut AccountView,
    model_len: usize,
    terms: AgentTerms,
}

impl<'a> Party<'a> {
    /// The registry record at `account`, which must be the one derived from
    /// `owner`.
    fn load(account: &'a mut AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let (_, model_len, terms) = AgentHead::load_full(account, program_id)?;
        Ok(Self {
            account,
            model_len,
            terms,
        })
    }

    fn check(&self, owner: &Address, program_id: &Address) -> ProgramResult {
        at_seeds(
            self.account,
            &[AGENT_SEED, owner.as_ref(), &[self.terms.bump()]],
            program_id,
        )?;
        writable(self.account)
    }

    fn store(self) -> ProgramResult {
        AgentHead::store_terms(self.account, self.model_len, &self.terms)
    }
}

impl<'a> Rated<'a> {
    /// Accounts: `[w] rating`, `[s] caller`, `[w] specialist_agent`,
    /// `[w] consumer_agent`. Returns the caller with them.
    fn open(
        program_id: &Address,
        accounts: &'a mut [AccountView],
        job_id: &[u8; 16],
    ) -> Result<(Self, &'a AccountView), ProgramError> {
        let [rating, caller, specialist_agent, consumer_agent, ..] = accounts else {
            return Err(fail(&AccountNotEnoughKeys));
        };
        let record = Rating::load(rating, program_id)?;
        signer(caller)?;
        let specialist = Party::load(specialist_agent, program_id)?;
        let consumer = Party::load(consumer_agent, program_id)?;
        // Each party's record is updated on its own, so one record cannot
        // stand in for both.
        require(
            specialist.account.address() != consumer.account.address(),
            &ConstraintDuplicateMutableAccount,
        )?;

        at_seeds(rating, &[RATING_SEED, job_id, &[record.bump]], program_id)?;
        writable(rating)?;
        specialist.check(&record.specialist, program_id)?;
        consumer.check(&record.consumer, program_id)?;
        Ok((
            Self {
                rating,
                record,
                specialist,
                consumer,
            },
            caller,
        ))
    }

    fn store(self) -> ProgramResult {
        self.record.store(self.rating)?;
        self.specialist.store()?;
        self.consumer.store()
    }
}

/// `reveal_rating`: reveal the caller's score for a job.
///
/// Accounts: `[w] rating`, `[s] signer`, `[w] specialist_agent`,
/// `[w] consumer_agent`.
/// Data: `job_id: [u8; 16]`, `score: u8` (1 to 10), `salt: [u8; 32]`.
///
/// Both parties must have committed. The score and salt must hash to the
/// caller's commitment. When the second party reveals, each score is folded
/// into the other party's reputation and both job counts go up by one.
pub fn reveal(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut args = Args(data);
    let job_id: [u8; 16] = args.array()?;
    let score = args.u8()?;
    let salt: [u8; 32] = args.array()?;
    let (mut rated, caller) = Rated::open(program_id, accounts, &job_id)?;
    let record = &mut rated.record;

    require(record.state == Rating::BOTH_COMMITTED, &BothMustCommitFirst)?;
    require((1..=10).contains(&score), &InvalidScore)?;
    let hash = sha256(&[&[score], &salt]);
    let (commitment, revealed) = if caller.address() == &record.consumer {
        (&record.consumer_commitment, &mut record.consumer_score)
    } else if caller.address() == &record.specialist {
        (&record.specialist_commitment, &mut record.specialist_score)
    } else {
        return Err(fail(&UnauthorisedSigner));
    };
    require(&hash == commitment, &CommitmentMismatch)?;
    *revealed = Some(score);

    if let (Some(from_consumer), Some(from_specialist)) =
        (record.consumer_score, record.specialist_score)
    {
        record.state = Rating::REVEALED;
        rated.specialist.terms.fold_rating(from_consumer);
        rated.specialist.terms.count_completed();
        rated.consumer.terms.fold_rating(from_specialist);
        rated.consumer.terms.count_completed();
    }
    rated.store()
}

/// `expire_rating`: close out a rating one side never committed to.
///
/// Accounts: `[w] rating`, `[s] caller`, `[w] specialist_agent`,
/// `[w] consumer_agent`.
/// Data: `job_id: [u8; 16]`.
///
/// Anyone may call it once the expiry period has passed since the rating was
/// created. The party that did not commit loses reputation and gains a failed
/// job.
pub fn expire(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let job_id: [u8; 16] = Args(data).array()?;
    let (mut rated, _) = Rated::open(program_id, accounts, &job_id)?;
    let record = &mut rated.record;

    let slot = now()?.0;
    require(record.state == Rating::PENDING, &AlreadyFinalised)?;
    require(
        slot.saturating_sub(record.created_slot) >= RATING_EXPIRE_SLOTS,
        &NotExpired,
    )?;
    record.state = Rating::EXPIRED;

    let consumer_committed = record.consumer_commitment != UNSET;
    let specialist_committed = record.specialist_commitment != UNSET;
    let silent = match (consumer_committed, specialist_committed) {
        (true, false) => Some(&mut rated.specialist.terms),
        (false, true) => Some(&mut rated.consumer.terms),
        _ => None,
    };
    if let Some(terms) = silent {
        terms.penalise(RATING_EXPIRE_PENALTY);
        terms.count_failed();
    }
    rated.store()
}
