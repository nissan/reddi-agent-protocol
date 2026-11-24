//! Delivery-checked escrow: the payee is paid only after it has put a
//! delivery on record and the payer has had a set time to check it.
//!
//! The payer opts a locked escrow in with `open_delivery`, in the slot of the
//! lock, naming a judge and two windows. That creates the delivery account
//! (`["delivery", escrow]`) and sets bit `0x04` of the escrow's flags. From
//! then on every exit of the escrow takes the delivery account, after the
//! rating account when there is one, and:
//!
//! - the payee's settle or claim needs a recorded delivery whose verify
//!   window has ended, or that the payer accepted, and is refused while the
//!   delivery is disputed;
//! - the payer's release and the payee's decline are unchanged;
//! - the payer's refund, besides the escrow's own cancel window, waits until
//!   the payee can first collect (the verify window's end, or a fixed-price
//!   escrow's claim window if later) and a day more once a delivery is
//!   recorded, and for the judge's window once it is disputed.
//!
//! A disputed escrow is ended by its judge (`resolve_delivery`,
//! `resolve_token_delivery`), who names what the payee is paid, or after the
//! judge's window by the payer's refund. The chain cannot fetch a file: the
//! delivery account holds what the payee says it delivered (units, bytes,
//! sha256), and the payer's agent or the judge checks the file itself.
//!
//! Every delivery instruction names its job by the slot the delivery account
//! was opened in, which is the escrow's lock slot, so nothing signed for one
//! job can act on a later escrow at the same address.
use {
    crate::{
        checks::{at_seeds, create_pda, derive, now, program, signer, writable, Args},
        consts::{
            delivery_windows_valid, AGENT_SEED, DELIVERY_COLLECT_SLOTS, DELIVERY_SEED,
            SYSTEM_PROGRAM_ID,
        },
        error::{
            fail, require, AccountNotEnoughKeys, AlreadyDeliveryChecked, ConstraintSeeds,
            DeliveryAccountRequired, DeliveryAlreadyAccepted, DeliveryAlreadyRecorded,
            DeliveryDeadlinePassed, DeliveryDisputed, DeliveryEscrowNotDelegable,
            DeliveryJobMismatch, DeliveryNotRecorded, DeliveryOptInClosed, DeliveryRefundNotOpen,
            EscrowJustLocked, InvalidDelivery, InvalidDeliveryAccount, InvalidDeliveryTerms,
            InvalidJudge, InvalidPayee, JudgeNotActive, NotAttestationAgent, NotLocked,
            UnauthorisedSigner, VerifyWindowClosed, VerifyWindowOpen,
        },
        events::{DeliveryChanged, DeliveryRecorded},
        state::{
            AgentHead, AnyEscrow, Delivery, Record, DELIVERY_ACCEPTED, DELIVERY_AWAITING,
            DELIVERY_DELIVERED, DELIVERY_DISPUTED, STATUS_LOCKED,
        },
    },
    pinocchio::{
        cpi::{Seed, Signer},
        error::ProgramError,
        AccountView, Address, ProgramResult,
    },
};

/// What the delivery instructions need to know about the escrow.
struct Job {
    payer: Address,
    payee: Address,
    status: u8,
    created_slot: u64,
    cancel_window_slots: u64,
    delivery_checked: bool,
    delegated: bool,
}

impl Job {
    fn of(record: &AnyEscrow) -> Self {
        match record {
            AnyEscrow::Sol(record) => Self {
                payer: record.payer,
                payee: record.payee,
                status: record.status,
                created_slot: record.created_slot(),
                cancel_window_slots: record.cancel_window_slots(),
                delivery_checked: record.delivery_checked(),
                delegated: record.delegated(),
            },
            AnyEscrow::Token(record) => Self {
                payer: record.payer,
                payee: record.payee,
                status: record.status,
                created_slot: record.created_slot(),
                cancel_window_slots: record.cancel_window_slots(),
                delivery_checked: record.delivery_checked(),
                delegated: false,
            },
        }
    }
}

/// `open_delivery`: opt a locked escrow into the delivery check.
///
/// Accounts: `[w] delivery`, `[w] escrow` (SOL or token), `[w, s] payer`,
/// `[] judge_agent` (the judge's registry record), `[] system_program`.
/// Data: `judge: address`, `verify_window_slots: u64`,
/// `resolve_window_slots: u64`.
///
/// Only the escrow's payer, only in the slot the escrow was locked, and only
/// once, so a payee that read the escrow after that slot sees the final
/// terms before doing any work. The judge must be a registered, active
/// attestation agent and neither party. The payer funds the delivery
/// account's rent and gets it back whenever the escrow ends.
pub fn open(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut args = Args(data);
    let judge = Address::new_from_array(args.array()?);
    let verify_window_slots = args.u64()?;
    let resolve_window_slots = args.u64()?;
    let [delivery, escrow, payer, judge_agent, system_program, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let record = AnyEscrow::load(escrow, program_id)?;
    let job = Job::of(&record);
    signer(payer)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;
    writable(delivery)?;
    writable(escrow)?;
    writable(payer)?;

    require(payer.address() == &job.payer, &UnauthorisedSigner)?;
    require(job.status == STATUS_LOCKED, &NotLocked)?;
    require(!job.delivery_checked, &AlreadyDeliveryChecked)?;
    let slot = now()?.0;
    require(slot == job.created_slot, &DeliveryOptInClosed)?;
    // The PER release (`per` builds, not part of V1) knows nothing of the
    // delivery account, so a delegated escrow is never delivery-checked.
    require(!job.delegated, &DeliveryEscrowNotDelegable)?;
    require(
        delivery_windows_valid(verify_window_slots, resolve_window_slots),
        &InvalidDeliveryTerms,
    )?;

    let (address, bump) = derive(&[DELIVERY_SEED, escrow.address().as_ref()], program_id);
    require(delivery.address() == &address, &ConstraintSeeds)?;
    require(
        job.payee != job.payer && &job.payee != delivery.address(),
        &InvalidPayee,
    )?;
    // A judge that is a party would rule on its own job.
    require(judge != job.payer && judge != job.payee, &InvalidJudge)?;
    let (head, _, terms) = AgentHead::load_full(judge_agent, program_id)?;
    at_seeds(
        judge_agent,
        &[AGENT_SEED, judge.as_ref(), &[terms.bump()]],
        program_id,
    )?;
    require(head.owner == judge, &InvalidJudge)?;
    require(head.agent_type() != 0, &NotAttestationAgent)?;
    require(terms.active(), &JudgeNotActive)?;

    let bump = [bump];
    let seeds = [
        Seed::from(DELIVERY_SEED),
        Seed::from(escrow.address().as_ref()),
        Seed::from(&bump),
    ];
    // Fails if an account already exists at this address.
    create_pda(
        payer,
        delivery,
        Delivery::LEN,
        program_id,
        &Signer::from(&seeds),
    )?;
    Delivery::new(
        escrow.address(),
        &judge,
        slot,
        verify_window_slots,
        resolve_window_slots,
        bump[0],
    )
    .store(delivery)?;
    match &record {
        AnyEscrow::Sol(record) => record.set_delivery_checked(escrow),
        AnyEscrow::Token(record) => record.set_delivery_checked(escrow),
    }
}

/// The delivery account and escrow of a delivery instruction, checked to be
/// one locked job: the account belongs to the escrow, and both it and the
/// caller name the escrow's lock slot.
fn load_job(
    program_id: &Address,
    delivery: &AccountView,
    escrow: &AccountView,
    opened_slot: u64,
) -> Result<(Delivery, Job), ProgramError> {
    let record = Delivery::load_checked(delivery, program_id)?;
    writable(delivery)?;
    require(escrow.address() == &record.escrow, &InvalidDeliveryAccount)?;
    let job = Job::of(&AnyEscrow::load(escrow, program_id)?);
    require(job.status == STATUS_LOCKED, &NotLocked)?;
    require(
        job.delivery_checked && record.opened_slot() == job.created_slot,
        &InvalidDeliveryAccount,
    )?;
    require(opened_slot == record.opened_slot(), &DeliveryJobMismatch)?;
    Ok((record, job))
}

/// `record_delivery`: the payee states what it delivered.
///
/// Accounts: `[w] delivery`, `[] escrow`, `[s] payee`.
/// Data: `opened_slot: u64`, `units: u64`, `bytes: u64`, `sha256: [u8; 32]`.
///
/// Once per job, after the lock slot and before the escrow's refund window
/// opens, so a late delivery cannot push the payer's refund out. Recording
/// is the payee's acceptance of the judge and windows it read on the
/// delivery account.
pub fn record(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut args = Args(data);
    let opened_slot = args.u64()?;
    let units = args.u64()?;
    let bytes = args.u64()?;
    let sha256: [u8; 32] = args.array()?;
    let [delivery, escrow, payee, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let (mut record, job) = load_job(program_id, delivery, escrow, opened_slot)?;
    signer(payee)?;
    require(payee.address() == &job.payee, &UnauthorisedSigner)?;
    require(record.state == DELIVERY_AWAITING, &DeliveryAlreadyRecorded)?;
    require(units > 0 && bytes > 0, &InvalidDelivery)?;
    let slot = now()?.0;
    require(slot > job.created_slot, &EscrowJustLocked)?;
    require(
        slot < job.created_slot.saturating_add(job.cancel_window_slots),
        &DeliveryDeadlinePassed,
    )?;
    record.record(slot, units, bytes, sha256);
    record.store(delivery)?;
    DeliveryRecorded {
        escrow: escrow.address(),
        units,
        bytes,
        sha256: &record.sha256,
        slot,
    }
    .emit();
    Ok(())
}

/// `accept_delivery` (`accept` true) and `dispute_delivery`: the payer's
/// answer to a recorded delivery.
///
/// Accounts: `[w] delivery`, `[] escrow`, `[s] payer`.
/// Data: `opened_slot: u64`.
///
/// Accepting lets the payee be paid at once. Disputing is possible only
/// while the verify window is open, and leaves the escrow to the judge.
/// Either is possible only on a delivered job that is neither accepted nor
/// disputed.
pub fn answer(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
    accept: bool,
) -> ProgramResult {
    let opened_slot = Args(data).u64()?;
    let [delivery, escrow, payer, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let (mut record, job) = load_job(program_id, delivery, escrow, opened_slot)?;
    signer(payer)?;
    require(payer.address() == &job.payer, &UnauthorisedSigner)?;
    match record.state {
        DELIVERY_DELIVERED => {}
        DELIVERY_AWAITING => return Err(fail(&DeliveryNotRecorded)),
        DELIVERY_ACCEPTED => return Err(fail(&DeliveryAlreadyAccepted)),
        _ => return Err(fail(&DeliveryDisputed)),
    }
    let slot = now()?.0;
    if accept {
        record.accept();
    } else {
        require(slot < record.verify_ends(), &VerifyWindowClosed)?;
        record.dispute(slot);
    }
    record.store(delivery)?;
    DeliveryChanged {
        escrow: escrow.address(),
        state: record.state,
        slot,
    }
    .emit();
    Ok(())
}

/// The delivery account an exit of the delivery-checked escrow at `escrow`,
/// locked in slot `created`, must be given: the first of `trailing`, the
/// accounts after the instruction's own and its rating account.
///
/// It must be writable, be the delivery account derived from this escrow,
/// and have been opened in the escrow's lock slot.
pub fn for_exit<'a>(
    program_id: &Address,
    escrow: &Address,
    created: u64,
    trailing: &'a mut [AccountView],
) -> Result<(&'a mut AccountView, Delivery), ProgramError> {
    let Some(account) = trailing.first_mut() else {
        return Err(fail(&DeliveryAccountRequired));
    };
    let record = Delivery::load_checked(account, program_id)?;
    writable(account)?;
    require(
        &record.escrow == escrow && record.opened_slot() == created,
        &InvalidDeliveryAccount,
    )?;
    Ok((account, record))
}

/// Whether a payout may go ahead. The payer's release always may. The
/// payee's settle or claim needs a delivery that was accepted, or whose
/// verify window has ended without a dispute.
pub fn check_payout(record: &Delivery, by_payee: bool, slot: u64) -> ProgramResult {
    if !by_payee {
        return Ok(());
    }
    match record.state {
        DELIVERY_ACCEPTED => Ok(()),
        DELIVERY_DELIVERED => require(slot >= record.verify_ends(), &VerifyWindowOpen),
        DELIVERY_AWAITING => Err(fail(&DeliveryNotRecorded)),
        _ => Err(fail(&DeliveryDisputed)),
    }
}

/// Whether a refund may go ahead, on top of the escrow's own rules. The
/// payee's decline always may. The payer's refund, with no delivery
/// recorded, follows the cancel window alone. With a delivery recorded or
/// accepted it waits until the payee can first collect (the end of the
/// verify window, or `claim_opens` if later: the slot a fixed-price
/// escrow's claim opens, 0 for a metered escrow, which the payee settles)
/// and then a day for the payee to collect; with a dispute, for the judge's
/// window.
pub fn check_refund(
    record: &Delivery,
    by_payer: bool,
    slot: u64,
    claim_opens: u64,
) -> ProgramResult {
    if !by_payer {
        return Ok(());
    }
    let opens = match record.state {
        DELIVERY_AWAITING => return Ok(()),
        DELIVERY_DISPUTED => record.resolve_ends(),
        _ => record
            .verify_ends()
            .max(claim_opens)
            .saturating_add(DELIVERY_COLLECT_SLOTS),
    };
    require(slot >= opens, &DeliveryRefundNotOpen)
}

/// Split `trailing` into the rating account's place (one account when the
/// escrow is rated, none otherwise) and what follows it. A rated escrow given
/// no trailing accounts gets an empty rating place, which the rating check
/// refuses.
pub fn split_trailing(
    trailing: &mut [AccountView],
    rated: bool,
) -> (&mut [AccountView], &mut [AccountView]) {
    let at = usize::from(rated).min(trailing.len());
    trailing.split_at_mut(at)
}
