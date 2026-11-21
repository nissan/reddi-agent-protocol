//! Native SOL escrow: lock, release / claim, settle at actual cost, refund.
//!
//! The escrow record itself holds the locked lamports on top of its rent, so
//! paying out is a direct balance move from an account this program owns and
//! needs no cross-program call. Closing the record returns the rent and any
//! unused amount to the payer.
use {
    crate::{
        checks::{
            close, create_pda, credit, debit, derive, now, payout_outcome, program, refund_outcome,
            rent_exempt_minimum, signer, transfer, writable, Args,
        },
        consts::{
            escrow_windows_valid, protocol_fee, ESCROW_SEED, MAX_SOL_ESCROW_LAMPORTS,
            PROTOCOL_TREASURY, SYSTEM_PROGRAM_ID,
        },
        error::{
            fail, require, AccountNotEnoughKeys, AmountAboveCap, ConstraintHasOne, ConstraintSeeds,
            InvalidPayee, InvalidSettleAmount, InvalidTreasury, InvalidWindows, NotLocked,
            NotMetered, PayeeNotRentExempt, UnauthorisedSigner, ZeroAmount,
        },
        events::{Locked, Outcome, Settled},
        instructions::rating,
        state::{Record, SolEscrow, STATUS_LOCKED},
    },
    pinocchio::{
        cpi::{Seed, Signer},
        AccountView, Address, ProgramResult,
    },
};

/// `lock_escrow` / `lock_metered_escrow`.
///
/// Accounts: `[w] escrow`, `[w, s] payer`, `[] payee`, `[] system_program`.
/// Data: `amount: u64`, `nonce: [u8; 16]`, `claim_window_slots: u64`,
/// `cancel_window_slots: u64`.
///
/// For a metered lock the amount is the buyer's authorised maximum.
pub fn lock(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
    metered: bool,
) -> ProgramResult {
    let mut args = Args(data);
    let amount = args.u64()?;
    let nonce: [u8; 16] = args.array()?;
    let claim_window_slots = args.u64()?;
    let cancel_window_slots = args.u64()?;
    let [escrow, payer, payee, system_program, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    signer(payer)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;

    // One escrow per (payer, nonce): the address is derived from both, and
    // creating it twice fails.
    let (address, bump) = derive(&[ESCROW_SEED, payer.address().as_ref(), &nonce], program_id);
    require(escrow.address() == &address, &ConstraintSeeds)?;
    let bump = [bump];
    let seeds = [
        Seed::from(ESCROW_SEED),
        Seed::from(payer.address().as_ref()),
        Seed::from(&nonce),
        Seed::from(&bump),
    ];
    create_pda(
        payer,
        escrow,
        SolEscrow::LEN,
        program_id,
        &Signer::from(&seeds),
    )?;
    writable(payer)?;

    require(amount > 0, &ZeroAmount)?;
    require(amount <= MAX_SOL_ESCROW_LAMPORTS, &AmountAboveCap)?;
    require(
        escrow_windows_valid(claim_window_slots, cancel_window_slots),
        &InvalidWindows,
    )?;
    // A payer paying themselves, or the escrow account itself, is never a real job.
    require(payee.address() != payer.address(), &InvalidPayee)?;
    require(payee.address() != escrow.address(), &InvalidPayee)?;
    // The runtime refuses a payout that leaves the payee's account holding
    // something but less than its rent-exempt minimum, which would block
    // release, claim and settle alike. A fixed-price escrow pays the amount
    // less the fee, so that is counted. A metered escrow pays whatever the
    // payee reports, so its payee must already hold the minimum.
    let certain = if metered {
        0
    } else {
        amount - protocol_fee(amount, true)
    };
    require(
        payee.lamports().saturating_add(certain) >= rent_exempt_minimum(payee.data_len())?,
        &PayeeNotRentExempt,
    )?;

    let (slot, unix_timestamp) = now()?;
    SolEscrow::new(
        payer.address(),
        payee.address(),
        amount,
        nonce,
        unix_timestamp,
        slot,
        claim_window_slots,
        cancel_window_slots,
        bump[0],
        metered,
    )
    .store(escrow)?;
    transfer(payer, escrow, amount)?;

    Locked {
        escrow: escrow.address(),
        payer: payer.address(),
        payee: payee.address(),
        mint: None,
        amount,
        nonce: &nonce,
        created_slot: slot,
    }
    .emit();
    Ok(())
}

/// `release_escrow` (`actual` is `None`) and `settle_escrow`.
///
/// Accounts: `[w] escrow`, `[w] payer`, `[w] payee`, `[w] treasury`,
/// `[] system_program`, and for a rated escrow `[w] rating`.
///
/// Release pays the whole locked amount: the payer may at any time, the payee
/// once the claim window has elapsed. Whichever of the two signed is the
/// authority, and the payer is preferred when both did. Settle pays `actual`,
/// at most the locked amount: only the payee may settle, and only a metered
/// escrow. The payer never chooses a smaller amount: the payer's ways out are
/// a full release, or a refund once the refund window has elapsed. Either way
/// the payee receives the paid amount less the protocol fee, the treasury
/// receives the fee, and the rest returns to the payer with the rent.
///
/// A rated escrow's rating account records the paid amount and the slot, and
/// the rating opens, when the payee is the authority of this call (it claims
/// or settles) or accepted the rating earlier. Otherwise the money moves the
/// same way and the rating account is closed, its rent returning to the
/// payer. On a release the payer authorises, the payee's signature elsewhere
/// in the transaction (as fee payer, or for another instruction) is not
/// agreement. The token escrow has the same rule.
pub fn pay_out(
    program_id: &Address,
    accounts: &mut [AccountView],
    actual: Option<u64>,
) -> ProgramResult {
    let [escrow, payer, payee, treasury, system_program, trailing @ ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let record = SolEscrow::load_checked(escrow, program_id)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;

    // The escrow address commits to its payer, so a record whose payer is not
    // the account given here is not the escrow these seeds describe.
    require(payer.address() == &record.payer, &ConstraintSeeds)?;
    writable(escrow)?;
    require(payee.address() == &record.payee, &ConstraintHasOne)?;
    writable(payer)?;
    writable(payee)?;
    writable(treasury)?;
    require(treasury.address() == &PROTOCOL_TREASURY, &InvalidTreasury)?;

    let slot = now()?.0;
    let (paid, outcome, payee_is_authority) = match actual {
        None => {
            let authority = if payer.is_signer() {
                &record.payer
            } else if payee.is_signer() {
                &record.payee
            } else {
                return Err(fail(&UnauthorisedSigner));
            };
            (
                record.amount(),
                payout_outcome(
                    authority,
                    &record.payer,
                    &record.payee,
                    record.created_slot(),
                    slot,
                    record.claim_window_slots(),
                )?,
                !payer.is_signer(),
            )
        }
        Some(actual) => {
            // Only the payee names the amount. The payer's signature counts
            // for nothing here.
            require(payee.is_signer(), &UnauthorisedSigner)?;
            require(
                actual > 0 && actual <= record.amount(),
                &InvalidSettleAmount,
            )?;
            require(record.metered(), &NotMetered)?;
            (actual, Outcome::SettledActual, true)
        }
    };
    require(record.status == STATUS_LOCKED, &NotLocked)?;
    let rated = if record.rated() {
        Some(rating::for_exit(program_id, escrow.address(), trailing)?)
    } else {
        None
    };

    let fee = protocol_fee(paid, true);
    let to_payee = paid - fee;
    debit(escrow, paid)?;
    credit(payee, to_payee)?;
    credit(treasury, fee)?;
    close(escrow, payer)?;
    if let Some((account, job)) = rated {
        rating::settle_exit(account, job, payee_is_authority, paid, None, slot, payer)?;
    }

    Settled {
        escrow: escrow.address(),
        payer: &record.payer,
        payee: &record.payee,
        mint: None,
        amount: to_payee,
        nonce: &record.nonce,
        outcome,
        slot,
        fee,
        refunded: record.amount() - paid,
    }
    .emit();
    Ok(())
}

/// `cancel_escrow`: refund a locked SOL escrow to its payer and close it.
///
/// Accounts: `[w] escrow`, `[s] authority`, `[w] payer`, `[] system_program`,
/// and for a rated escrow `[w] rating`.
/// The authority is the payee (declining, at any time) or the payer (after the
/// cancel window). The payer receives the refund and does not need to sign.
/// A rated escrow's rating account is closed and its rent returns to the
/// payer too: a job that was not paid is not rated.
pub fn cancel(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [escrow, authority, payer, system_program, trailing @ ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let record = SolEscrow::load_checked(escrow, program_id)?;
    signer(authority)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;

    require(payer.address() == &record.payer, &ConstraintSeeds)?;
    writable(escrow)?;
    writable(payer)?;

    require(record.status == STATUS_LOCKED, &NotLocked)?;
    let slot = now()?.0;
    let outcome = refund_outcome(
        authority.address(),
        &record.payer,
        &record.payee,
        record.created_slot(),
        slot,
        record.cancel_window_slots(),
    )?;
    if record.rated() {
        let (account, _) = rating::for_exit(program_id, escrow.address(), trailing)?;
        close(account, payer)?;
    }
    close(escrow, payer)?;

    Settled {
        escrow: escrow.address(),
        payer: &record.payer,
        payee: &record.payee,
        mint: None,
        amount: record.amount(),
        nonce: &record.nonce,
        outcome,
        slot,
        fee: 0,
        refunded: 0,
    }
    .emit();
    Ok(())
}
