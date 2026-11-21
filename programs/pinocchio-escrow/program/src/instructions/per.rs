//! MagicBlock PER state tracking for SOL escrows (`per` builds only).
//!
//! Not part of V1. This is unfinished work kept for after the launch (issue
//! #839): `release_escrow_per` takes no protocol fee and emits no settlement
//! event yet, so the feature is off by default and is never enabled for a
//! mainnet build. A rated escrow cannot be delegated, and a delegated escrow
//! cannot be opted into rating, so the two never meet.
//!
//! Delegation to a private ephemeral rollup session is done by the client
//! against MagicBlock's programs. These two instructions only record it: the
//! payer marks a locked escrow as delegated under a session key, and may then
//! release it by presenting that key.
use {
    crate::{
        checks::{close, credit, debit, program, signer, writable, Args},
        consts::SYSTEM_PROGRAM_ID,
        error::{
            fail, require, AccountNotEnoughKeys, AlreadyDelegated, ConstraintHasOne,
            ConstraintSeeds, NotDelegatedToPer, NotLocked, PerSessionKeyMismatch,
            RatedEscrowNotDelegable,
        },
        log::Line,
        state::{SolEscrow, STATUS_LOCKED},
    },
    pinocchio::{AccountView, Address, ProgramResult},
};

/// `delegate_escrow`: record that a locked escrow is delegated to a session.
///
/// Accounts: `[w] escrow`, `[w, s] payer`.
/// Data: `session_key: address`.
pub fn delegate(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let session_key: [u8; 32] = Args(data).array()?;
    let [escrow, payer, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let record = SolEscrow::load_checked(escrow, program_id)?;
    signer(payer)?;

    // The escrow address commits to its payer.
    require(payer.address() == &record.payer, &ConstraintSeeds)?;
    writable(escrow)?;
    writable(payer)?;

    require(record.status == STATUS_LOCKED, &NotLocked)?;
    require(!record.delegated(), &AlreadyDelegated)?;
    // The exits of a rated escrow settle its rating account; this path does
    // not, so the two are kept apart.
    require(!record.rated(), &RatedEscrowNotDelegable)?;
    record.delegate(escrow, &session_key)?;
    Line::new()
        .text("Escrow delegated to PER: escrow=")
        .address(escrow.address().as_array())
        .text(", session_key=")
        .address(&session_key)
        .emit();
    Ok(())
}

/// `release_escrow_per`: the payer releases a delegated escrow to the payee.
///
/// Accounts: `[w] escrow`, `[w, s] payer`, `[w] payee`, `[] system_program`.
/// Data: `session_key: address`, which must be the key recorded at delegation.
///
/// The payee receives the whole locked amount and the payer the rent. Unlike
/// `release_escrow`, this path takes no protocol fee and emits no settlement
/// event; that is the behaviour of the program it mirrors.
pub fn release(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let session_key: [u8; 32] = Args(data).array()?;
    let [escrow, payer, payee, system_program, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let record = SolEscrow::load_checked(escrow, program_id)?;
    signer(payer)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;

    require(payer.address() == &record.payer, &ConstraintSeeds)?;
    writable(escrow)?;
    require(payee.address() == &record.payee, &ConstraintHasOne)?;
    writable(payer)?;
    writable(payee)?;

    require(record.status == STATUS_LOCKED, &NotLocked)?;
    require(record.delegated(), &NotDelegatedToPer)?;
    // Cannot happen: neither instruction lets a rated escrow be delegated.
    require(!record.rated(), &RatedEscrowNotDelegable)?;
    require(
        record.session_key(escrow)? == Some(session_key),
        &PerSessionKeyMismatch,
    )?;
    let amount = record.amount();
    debit(escrow, amount)?;
    credit(payee, amount)?;
    close(escrow, payer)?;
    Line::new()
        .text("Escrow released via PER: payee=")
        .address(payee.address().as_array())
        .text(", amount=")
        .number(amount)
        .emit();
    Ok(())
}
