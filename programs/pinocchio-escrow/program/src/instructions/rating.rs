//! Ratings of jobs that were paid through escrow.
//!
//! The payer of a locked escrow opts the job into rating with `open_rating`,
//! in the slot of the lock. That creates the rating account, which is the
//! job's record: it names the escrow, the two parties and an optional judge.
//! Every exit of a rated escrow takes that account. A paid exit (release,
//! claim, settle) that the specialist agreed to writes the paid amount, mint
//! and slot onto it and opens the rating. The specialist agrees by being the
//! authority of that exit or with `accept_rating` beforehand. A release without that
//! agreement, a refund and a decline close the rating account.
//!
//! An escrow address can be used again once its escrow has ended, and the
//! rating address with it. What tells one job from the next at the same
//! address is the slot its rating was opened in: a rated escrow cannot end in
//! that slot, so no two ratings at one address share it. `accept_rating`,
//! the commitments and `attest_quality` all name that slot, so nothing signed
//! for one job can be used on a later one.
//!
//! Once the job is paid, each party commits to
//! sha256(rating address, opened slot, signer, score, salt) without seeing the other's
//! score, then each reveals. When both have revealed, each score is folded
//! into the other party's registry record. Both phases have a deadline, and
//! `expire_rating` gives every unfinished rating a final result after it.
use {
    crate::{
        checks::{
            at_seeds, close, create_pda, derive, now, program, sha256, signer, writable, Args,
        },
        consts::{
            AGENT_SEED, RATING_COMMIT_SLOTS, RATING_EXPIRE_PENALTY, RATING_REVEAL_SLOTS,
            RATING_SEED, SYSTEM_PROGRAM_ID,
        },
        error::{
            fail, require, AccountNotEnoughKeys, AlreadyCommitted, AlreadyFinalised, AlreadyRated,
            AlreadyRevealed, BothMustCommitFirst, CommitDeadlinePassed, CommitmentMismatch,
            ConstraintDuplicateMutableAccount, ConstraintSeeds, EmptyCommitment, InvalidJudge,
            InvalidPayee, InvalidRatingAccount, InvalidScore, JobNotPaid, NotExpired, NotLocked,
            RatedEscrowNotDelegable, RatingAccountRequired, RatingAlreadyAccepted,
            RatingJobMismatch, RatingJustOpened, RatingNotAwaitingSettlement, RatingNotFinal,
            RatingOptInClosed, RevealDeadlinePassed, UnauthorisedSigner,
        },
        state::{
            AgentHead, AgentTerms, AnyEscrow, Rating, Record, RATING_AWAITING_SETTLEMENT,
            RATING_BOTH_COMMITTED, RATING_EXPIRED, RATING_OPEN, RATING_REVEALED, STATUS_LOCKED,
        },
    },
    pinocchio::{
        cpi::{Seed, Signer},
        error::ProgramError,
        AccountView, Address, ProgramResult,
    },
};

const UNSET: [u8; 32] = [0; 32];

/// `open_rating`: opt a locked escrow into rating.
///
/// Accounts: `[w] rating`, `[w] escrow` (SOL or token), `[w, s] payer`,
/// `[] system_program`.
/// Data: `judge: address` (all zero for no judge).
///
/// Only the escrow's payer, and only in the slot the escrow was locked, so a
/// payee that read the escrow after that slot can rely on what it saw. The
/// payer funds the rating account's rent and gets it back when the rating is
/// closed (`close_rating`) or the escrow is refunded.
pub fn open(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let judge: [u8; 32] = Args(data).array()?;
    let [rating, escrow, payer, system_program, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let record = AnyEscrow::load(escrow, program_id)?;
    signer(payer)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;
    writable(rating)?;
    writable(escrow)?;
    writable(payer)?;

    let (consumer, specialist, status, created_slot, rated, delegated) = match &record {
        AnyEscrow::Sol(record) => (
            record.payer,
            record.payee,
            record.status,
            record.created_slot(),
            record.rated(),
            record.delegated(),
        ),
        AnyEscrow::Token(record) => (
            record.payer,
            record.payee,
            record.status,
            record.created_slot(),
            record.rated(),
            false,
        ),
    };
    require(payer.address() == &consumer, &UnauthorisedSigner)?;
    require(status == STATUS_LOCKED, &NotLocked)?;
    require(!rated, &AlreadyRated)?;
    let slot = now()?.0;
    require(slot == created_slot, &RatingOptInClosed)?;
    // The PER release (`per` builds, not part of V1) does not settle a rating
    // account, so a delegated escrow is never rated.
    require(!delegated, &RatedEscrowNotDelegable)?;

    let (address, bump) = derive(&[RATING_SEED, escrow.address().as_ref()], program_id);
    require(rating.address() == &address, &ConstraintSeeds)?;
    // The two parties rate each other, so they must be two wallets, and the
    // rating account itself is never one of them.
    require(
        specialist != consumer && &specialist != rating.address(),
        &InvalidPayee,
    )?;
    // A judge that is a party would be assessing its own job.
    require(
        judge != consumer.to_bytes() && judge != specialist.to_bytes(),
        &InvalidJudge,
    )?;

    let bump = [bump];
    let seeds = [
        Seed::from(RATING_SEED),
        Seed::from(escrow.address().as_ref()),
        Seed::from(&bump),
    ];
    // Fails if a rating already exists at this address: an earlier job under
    // the same escrow address whose rating was never closed.
    create_pda(
        payer,
        rating,
        Rating::LEN,
        program_id,
        &Signer::from(&seeds),
    )?;
    Rating::new(
        escrow.address(),
        &consumer,
        &specialist,
        &judge,
        slot,
        bump[0],
    )
    .store(rating)?;
    match &record {
        AnyEscrow::Sol(record) => record.set_rated(escrow),
        AnyEscrow::Token(record) => record.set_rated(escrow),
    }
}

/// `accept_rating`: the specialist agrees to the job being rated.
///
/// Accounts: `[w] rating`, `[s] specialist`.
/// Data: `opened_slot: u64`, the slot the rating was opened in, as read from
/// the rating account.
///
/// The slot names the job the specialist is agreeing to. If that job ended
/// and the payer locked another at the same address, this call is refused
/// for the new one: the specialist has not seen its amount or its judge.
///
/// A rating opens only with the specialist's agreement, so that nobody can
/// move an agent's record with a job the agent took no part in. Agreeing is
/// this call, while the escrow is still locked, or being the authority of
/// the paid exit (settle or claim). A release by the payer of a job the specialist never
/// agreed to pays as usual and closes the rating unrated.
pub fn accept(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let opened_slot = Args(data).u64()?;
    let [rating, specialist, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let mut record = Rating::load_checked(rating, program_id)?;
    signer(specialist)?;
    writable(rating)?;
    require(
        specialist.address() == &record.specialist,
        &UnauthorisedSigner,
    )?;
    require(opened_slot == record.opened_slot(), &RatingJobMismatch)?;
    require(
        record.state == RATING_AWAITING_SETTLEMENT,
        &RatingNotAwaitingSettlement,
    )?;
    require(!record.accepted(), &RatingAlreadyAccepted)?;
    record.accept();
    record.store(rating)
}

/// What a paid exit does with the rating account of its escrow.
///
/// With the specialist's agreement the job is recorded and the rating opens.
/// The specialist agrees by being the authority of this exit (`by_specialist`:
/// it claims or settles) or by accepting earlier. Its signature on a
/// transaction whose exit the payer authorises is not agreement. Without
/// agreement the job is paid but not rated: the rating account is closed and
/// its lamports go to `payer`, the escrow's payer, who funded it. The same
/// happens when nothing was paid (`paid` 0, possible only for a Token-2022
/// escrow whose vault the issuer emptied): there is no paid job to rate.
pub fn settle_exit(
    account: &mut AccountView,
    mut record: Rating,
    by_specialist: bool,
    paid: u64,
    mint: Option<&Address>,
    slot: u64,
    payer: &mut AccountView,
) -> ProgramResult {
    if (by_specialist || record.accepted()) && paid > 0 {
        record.settle(paid, mint, slot);
        record.store(account)
    } else {
        close(account, payer)
    }
}

/// The rating account an exit of the rated escrow at `escrow` must be given:
/// the first of `trailing`, the accounts after the instruction's own.
///
/// It must be writable, be the rating derived from this escrow, and still be
/// waiting for the escrow to end. The exit must come after the slot the
/// rating was opened in (`slot` is the current one), so that a later job at
/// the same address always has a different opening slot, and it must name
/// that slot (`job`, from the exit's data). So an exit signed for one job,
/// a seller's settle or claim in particular, which opens the rating, cannot
/// end a later job at the same address.
pub fn for_exit<'a>(
    program_id: &Address,
    escrow: &Address,
    trailing: &'a mut [AccountView],
    slot: u64,
    job: Option<u64>,
) -> Result<(&'a mut AccountView, Rating), ProgramError> {
    let Some(account) = trailing.first_mut() else {
        return Err(fail(&RatingAccountRequired));
    };
    let record = Rating::load_checked(account, program_id)?;
    writable(account)?;
    require(&record.escrow == escrow, &InvalidRatingAccount)?;
    require(
        record.state == RATING_AWAITING_SETTLEMENT,
        &RatingNotAwaitingSettlement,
    )?;
    require(slot > record.opened_slot(), &RatingJustOpened)?;
    require(job == Some(record.opened_slot()), &RatingJobMismatch)?;
    Ok((account, record))
}

/// `commit_rating`: record the caller's commitment.
///
/// Accounts: `[w] rating`, `[s] signer`.
/// Data: `commitment: [u8; 32]`, which is
/// sha256(rating address ‖ opened slot, 8 bytes little-endian ‖ signer
/// address ‖ score byte ‖ 32-byte salt), then `opened_slot: u64`, the slot
/// the rating was opened in. A commitment sent for an earlier job at the
/// same address is refused before anything is stored, so it cannot take the
/// one place the signer has for this job's commitment.
///
/// The signer is the rating's consumer or its specialist; which one is taken
/// from the signer. Each commits once, within `RATING_COMMIT_SLOTS` of the
/// paid settlement.
pub fn commit(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut args = Args(data);
    let commitment: [u8; 32] = args.array()?;
    let opened_slot = args.u64()?;
    let [rating, caller, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let mut record = Rating::load_checked(rating, program_id)?;
    signer(caller)?;
    writable(rating)?;

    let is_consumer = caller.address() == &record.consumer;
    require(
        is_consumer || caller.address() == &record.specialist,
        &UnauthorisedSigner,
    )?;
    require(opened_slot == record.opened_slot(), &RatingJobMismatch)?;
    require(record.state != RATING_AWAITING_SETTLEMENT, &JobNotPaid)?;
    require(!record.is_final(), &AlreadyFinalised)?;
    let slot = now()?.0;
    let deadline = record.settled_slot().saturating_add(RATING_COMMIT_SLOTS);
    let mine = if is_consumer {
        &mut record.consumer_commitment
    } else {
        &mut record.specialist_commitment
    };
    require(*mine == UNSET, &AlreadyCommitted)?;
    require(slot <= deadline, &CommitDeadlinePassed)?;
    require(commitment != UNSET, &EmptyCommitment)?;
    *mine = commitment;
    if record.consumer_committed() && record.specialist_committed() {
        record.state = RATING_BOTH_COMMITTED;
        record.set_committed_slot(slot);
    }
    record.store(rating)
}

/// The registry record of one party to a rating, or of a judge, if it has
/// one.
pub(crate) struct Party<'a> {
    account: &'a mut AccountView,
    /// Length of the model name and the fields after it; `None` when the
    /// party is not a registered agent.
    record: Option<(usize, AgentTerms)>,
}

impl<'a> Party<'a> {
    /// `account` must be the agent address derived from `owner`. A party that
    /// is not registered there (never was, or deregistered) is left alone.
    pub(crate) fn load(
        account: &'a mut AccountView,
        owner: &Address,
        program_id: &Address,
    ) -> Result<Self, ProgramError> {
        writable(account)?;
        let record = if account.owned_by(program_id) {
            let (_, model_len, terms) = AgentHead::load_full(account, program_id)?;
            at_seeds(
                account,
                &[AGENT_SEED, owner.as_ref(), &[terms.bump()]],
                program_id,
            )?;
            Some((model_len, terms))
        } else {
            // Nothing is stored, so there is no bump to check against.
            let (address, _) = derive(&[AGENT_SEED, owner.as_ref()], program_id);
            require(account.address() == &address, &ConstraintSeeds)?;
            None
        };
        Ok(Self { account, record })
    }

    pub(crate) fn update(&mut self, change: impl FnOnce(&mut AgentTerms)) {
        if let Some((_, terms)) = &mut self.record {
            change(terms);
        }
    }

    pub(crate) fn store(self) -> ProgramResult {
        match &self.record {
            Some((model_len, terms)) => AgentHead::store_terms(self.account, *model_len, terms),
            None => Ok(()),
        }
    }
}

/// A rating and the registry records of its two parties, checked.
struct Rated<'a> {
    rating: &'a mut AccountView,
    record: Rating,
    specialist: Party<'a>,
    consumer: Party<'a>,
}

impl<'a> Rated<'a> {
    /// Accounts: `[w] rating`, `[s] caller`, `[w] specialist_agent`,
    /// `[w] consumer_agent`. Returns the caller with them.
    fn open(
        program_id: &Address,
        accounts: &'a mut [AccountView],
    ) -> Result<(Self, &'a AccountView), ProgramError> {
        let [rating, caller, specialist_agent, consumer_agent, ..] = accounts else {
            return Err(fail(&AccountNotEnoughKeys));
        };
        let record = Rating::load_checked(rating, program_id)?;
        signer(caller)?;
        writable(rating)?;
        // Each party's record is updated on its own, so one account cannot
        // stand in for both.
        require(
            specialist_agent.address() != consumer_agent.address(),
            &ConstraintDuplicateMutableAccount,
        )?;
        let specialist = Party::load(specialist_agent, &record.specialist, program_id)?;
        let consumer = Party::load(consumer_agent, &record.consumer, program_id)?;
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

/// `reveal_rating`: reveal the caller's score.
///
/// Accounts: `[w] rating`, `[s] signer`, `[w] specialist_agent`,
/// `[w] consumer_agent` (the agent addresses derived from the rating's
/// specialist and consumer, registered or not).
/// Data: `score: u8` (1 to 10), `salt: [u8; 32]`.
///
/// Both parties must have committed, and the reveal must land within
/// `RATING_REVEAL_SLOTS` of the second commitment. When the second party
/// reveals, each score is folded into the other party's reputation and both
/// job counts go up by one.
pub fn reveal(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut args = Args(data);
    let score = args.u8()?;
    let salt: [u8; 32] = args.array()?;
    let (mut rated, caller) = Rated::open(program_id, accounts)?;
    let rating_address = *rated.rating.address();
    let record = &mut rated.record;

    let is_consumer = caller.address() == &record.consumer;
    require(
        is_consumer || caller.address() == &record.specialist,
        &UnauthorisedSigner,
    )?;
    require(record.state != RATING_AWAITING_SETTLEMENT, &JobNotPaid)?;
    require(record.state != RATING_OPEN, &BothMustCommitFirst)?;
    require(!record.is_final(), &AlreadyFinalised)?;
    require(
        now()?.0 <= record.committed_slot().saturating_add(RATING_REVEAL_SLOTS),
        &RevealDeadlinePassed,
    )?;
    require((1..=10).contains(&score), &InvalidScore)?;
    let opened_slot = record.opened_slot().to_le_bytes();
    let (commitment, revealed) = if is_consumer {
        (&record.consumer_commitment, &mut record.consumer_score)
    } else {
        (&record.specialist_commitment, &mut record.specialist_score)
    };
    require(*revealed == 0, &AlreadyRevealed)?;
    // The rating's address and opening slot and the signer are part of what
    // was committed to, so a commitment copied from the other party, from
    // another job, or from an earlier job at this address, cannot be opened
    // by replaying that reveal.
    let hash = sha256(&[
        rating_address.as_ref(),
        &opened_slot,
        caller.address().as_ref(),
        &[score],
        &salt,
    ]);
    require(&hash == commitment, &CommitmentMismatch)?;
    *revealed = score;

    let (from_consumer, from_specialist) = (record.consumer_score, record.specialist_score);
    if from_consumer != 0 && from_specialist != 0 {
        record.state = RATING_REVEALED;
        rated.specialist.update(|terms| {
            terms.fold_rating(from_consumer);
            terms.count_completed();
        });
        rated.consumer.update(|terms| {
            terms.fold_rating(from_specialist);
            terms.count_completed();
        });
    }
    rated.store()
}

/// `expire_rating`: give an unfinished rating its final result after the
/// deadline of the phase it stopped in.
///
/// Accounts: `[w] rating`, `[s] caller` (anyone), `[w] specialist_agent`,
/// `[w] consumer_agent` (as for `reveal_rating`).
/// No data.
///
/// Stopped before both committed, after the commit deadline:
/// - nobody committed: no reputation change;
/// - one side committed: the silent side loses reputation and gains a failed
///   job.
///
/// Stopped after both committed, after the reveal deadline:
/// - one side revealed: its score counts for the other party, the side that
///   withheld loses reputation and its own score is never counted, and both
///   job counts go up by one;
/// - nobody revealed: no reputation change.
pub fn expire(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let (mut rated, _) = Rated::open(program_id, accounts)?;
    let record = &mut rated.record;

    let slot = now()?.0;
    require(record.state != RATING_AWAITING_SETTLEMENT, &JobNotPaid)?;
    require(!record.is_final(), &AlreadyFinalised)?;
    if record.state == RATING_BOTH_COMMITTED {
        require(
            slot > record.committed_slot().saturating_add(RATING_REVEAL_SLOTS),
            &NotExpired,
        )?;
        let (from_consumer, from_specialist) = (record.consumer_score, record.specialist_score);
        // In this state at most one score is set.
        let withheld = if from_consumer != 0 {
            Some((&mut rated.specialist, &mut rated.consumer, from_consumer))
        } else if from_specialist != 0 {
            Some((&mut rated.consumer, &mut rated.specialist, from_specialist))
        } else {
            None
        };
        if let Some((withholder, revealer, score)) = withheld {
            withholder.update(|terms| {
                terms.fold_rating(score);
                terms.penalise(RATING_EXPIRE_PENALTY);
                terms.count_completed();
            });
            revealer.update(AgentTerms::count_completed);
        }
    } else {
        require(
            slot > record.settled_slot().saturating_add(RATING_COMMIT_SLOTS),
            &NotExpired,
        )?;
        let silent = match (record.consumer_committed(), record.specialist_committed()) {
            (true, false) => Some(&mut rated.specialist),
            (false, true) => Some(&mut rated.consumer),
            _ => None,
        };
        if let Some(silent) = silent {
            silent.update(|terms| {
                terms.penalise(RATING_EXPIRE_PENALTY);
                terms.count_failed();
            });
        }
    }
    record.state = RATING_EXPIRED;
    rated.store()
}

/// `close_rating`: close a rating that has its final result and return its
/// rent to the consumer, who paid it.
///
/// Accounts: `[w] rating`, `[w, s] consumer`.
/// No data.
pub fn close_final(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [rating, consumer, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let record = Rating::load_checked(rating, program_id)?;
    signer(consumer)?;
    writable(rating)?;
    writable(consumer)?;
    require(consumer.address() == &record.consumer, &UnauthorisedSigner)?;
    require(record.is_final(), &RatingNotFinal)?;
    close(rating, consumer)
}
