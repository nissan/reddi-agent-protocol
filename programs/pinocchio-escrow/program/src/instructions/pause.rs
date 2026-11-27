//! Emergency pause: a brake on new money coming in and on payouts to
//! providers, which never stops anyone getting their own money back.
//!
//! One account, `["pause"]` (`PAUSE_ADDRESS`), records a guardian key and the
//! slot a pause runs until. The guardian can pause at once; a pause lasts
//! `PAUSE_SLOTS` (about 7 days); the guardian cannot extend it, so one pause
//! by a lost key lasts no longer, but it can pause again, so the admin names a
//! new guardian before unpausing. Only the admin (`PAUSE_ADMIN`, the Squads
//! vault on mainnet) can unpause, extend a pause or name a new guardian.
//!
//! While paused (see `process_instruction` for the full list):
//!
//! - refused: every lock and budget open, `reserve`, every escrow release,
//!   claim and settle;
//! - refused unless the provider is paid nothing: the judge's resolves and
//!   the budget payouts, so a refund, a ruling of 0 and a judge's timeout
//!   still go ahead;
//! - unchanged: every cancel and refund, budget closes, disputes, waives,
//!   posts, ratings, attestations, the registry and the delivery record.
//!
//! The instructions that can be refused take the pause account as one more
//! account. Clients put it last, after any rating, delivery or memo account,
//! but the entry point finds it anywhere and takes it out of the list before
//! the instruction sees its accounts, so every account list is otherwise
//! unchanged: the instruction sees exactly what it would see had the pause
//! account not been passed. Refunds never need it: an instruction that is
//! never refused ignores it when given and runs as before without it.
use {
    crate::{
        checks::{create_pda, now, program, signer, writable, Args},
        consts::{
            PAUSE_ADDRESS, PAUSE_ADMIN, PAUSE_BUMP, PAUSE_SEED, PAUSE_SLOTS, SYSTEM_PROGRAM_ID,
        },
        error::{
            fail, require, AccountNotEnoughKeys, AlreadyPaused, ConstraintSeeds, InvalidGuardian,
            NotPauseAuthority, PauseAccountRequired,
        },
        events::PauseChanged,
        state::{PauseState, Record},
    },
    pinocchio::{
        cpi::{Seed, Signer},
        error::ProgramError,
        AccountView, Address, ProgramResult,
    },
};

/// Whether the trailing pause account is required.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Need {
    /// Refused without it.
    Required,
    /// Without it, counted as paused: the instruction may still refund.
    Optional,
}

/// Move the first pause account in `accounts` to the end, keeping the order
/// of the others. Returns whether there was one.
#[inline(never)]
fn to_end(accounts: &mut [AccountView]) -> bool {
    match accounts
        .iter()
        .position(|account| account.address() == &PAUSE_ADDRESS)
    {
        Some(at) => {
            // `rotate_left(1)` on `accounts[at..]`, without its general code.
            for i in at..accounts.len() - 1 {
                accounts.swap(i, i + 1);
            }
            true
        }
        None => false,
    }
}

/// Take the pause account out of `accounts`: on return the first `n` of them
/// are the instruction's own accounts in their order, and the result says
/// whether the protocol is paused now.
///
/// Absent: `Required` fails with `PauseAccountRequired`; `Optional` counts as
/// paused. Present but not created yet, or not this program's: fails, so a
/// build deployed before `init_pause` takes no locks or payouts.
#[inline(never)]
pub fn gate(
    program_id: &Address,
    accounts: &mut [AccountView],
    need: Need,
) -> Result<(usize, bool), ProgramError> {
    if to_end(accounts) {
        let n = accounts.len() - 1;
        let state = PauseState::load(&accounts[n], program_id)?;
        let (slot, _) = now()?;
        return Ok((n, state.paused(slot)));
    }
    require(need == Need::Optional, &PauseAccountRequired)?;
    Ok((accounts.len(), true))
}

/// For the instructions a pause never refuses: take out a pause account if
/// one was given, and return how many accounts remain.
#[inline(never)]
pub fn without(accounts: &mut [AccountView]) -> usize {
    if to_end(accounts) {
        accounts.len() - 1
    } else {
        accounts.len()
    }
}

fn check_guardian(guardian: &Address) -> ProgramResult {
    require(
        guardian != &Address::default() && guardian != &PAUSE_ADMIN,
        &InvalidGuardian,
    )
}

/// The pause account, checked and writable.
fn load(program_id: &Address, pause: &AccountView) -> Result<PauseState, ProgramError> {
    require(pause.address() == &PAUSE_ADDRESS, &ConstraintSeeds)?;
    writable(pause)?;
    PauseState::load(pause, program_id)
}

fn emit(state: &PauseState, slot: u64) {
    PauseChanged {
        guardian: &state.guardian,
        by: &state.last_by,
        paused_until_slot: if state.paused(slot) {
            state.paused_until_slot()
        } else {
            0
        },
        slot,
    }
    .emit();
}

/// `init_pause`: create the pause account, not paused, naming the guardian.
/// Once only.
///
/// Accounts: `[w] pause`, `[s] admin`, `[w, s] payer` (pays the rent; may be
/// the admin), `[] system_program`. Data: `guardian: [u8; 32]`.
pub fn init(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let guardian = Address::new_from_array(Args(data).array::<32>()?);
    let [pause, admin, payer, system_program, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    signer(admin)?;
    require(admin.address() == &PAUSE_ADMIN, &NotPauseAuthority)?;
    signer(payer)?;
    writable(payer)?;
    writable(pause)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;
    require(pause.address() == &PAUSE_ADDRESS, &ConstraintSeeds)?;
    check_guardian(&guardian)?;
    let bump = [PAUSE_BUMP];
    let seeds = [Seed::from(PAUSE_SEED), Seed::from(&bump)];
    create_pda(
        payer,
        pause,
        PauseState::LEN,
        program_id,
        &Signer::from(&seeds),
    )?;
    let state = PauseState::new(&guardian, admin.address(), PAUSE_BUMP);
    state.store(pause)?;
    emit(&state, now()?.0);
    Ok(())
}

/// `pause`: pause the protocol for `PAUSE_SLOTS` from now.
///
/// The guardian may pause only when it is not paused already. The admin may
/// pause at any time, which also extends a running pause to `PAUSE_SLOTS`
/// from now.
///
/// Accounts: `[w] pause`, `[s] signer` (the guardian or the admin).
pub fn pause(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [pause, by, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let mut state = load(program_id, pause)?;
    signer(by)?;
    let (slot, _) = now()?;
    if by.address() != &PAUSE_ADMIN {
        require(by.address() == &state.guardian, &NotPauseAuthority)?;
        require(!state.paused(slot), &AlreadyPaused)?;
    }
    state.set_paused(slot, slot.saturating_add(PAUSE_SLOTS), by.address());
    state.store(pause)?;
    emit(&state, slot);
    Ok(())
}

/// `unpause`: end a pause now. Admin only; also fine when not paused.
///
/// Accounts: `[w] pause`, `[s] admin`.
pub fn unpause(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [pause, admin, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let mut state = load(program_id, pause)?;
    signer(admin)?;
    require(admin.address() == &PAUSE_ADMIN, &NotPauseAuthority)?;
    state.clear(admin.address());
    state.store(pause)?;
    emit(&state, now()?.0);
    Ok(())
}

/// `set_guardian`: name a new guardian. Admin only; a running pause is left
/// as it is.
///
/// Accounts: `[w] pause`, `[s] admin`. Data: `guardian: [u8; 32]`.
pub fn set_guardian(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let guardian = Address::new_from_array(Args(data).array::<32>()?);
    let [pause, admin, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let mut state = load(program_id, pause)?;
    signer(admin)?;
    require(admin.address() == &PAUSE_ADMIN, &NotPauseAuthority)?;
    check_guardian(&guardian)?;
    state.guardian = guardian;
    state.last_by = *admin.address();
    state.store(pause)?;
    emit(&state, now()?.0);
    Ok(())
}
