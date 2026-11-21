//! Account checks and helpers shared by every instruction.
use {
    crate::{
        error::{
            fail, require, AccountNotSigner, CancelWindowNotElapsed, ClaimWindowNotElapsed,
            ConstraintMut, InstructionDidNotDeserialize, InvalidProgramId, Overflow,
            UnauthorisedSigner,
        },
        events::Outcome,
    },
    pinocchio::{
        cpi::Signer,
        error::ProgramError,
        sysvars::{clock::Clock, rent::Rent, Sysvar},
        AccountView, Address, ProgramResult,
    },
    pinocchio_system::instructions::{Allocate, Assign, CreateAccount, Transfer},
};

#[inline(always)]
pub fn signer(account: &AccountView) -> ProgramResult {
    require(account.is_signer(), &AccountNotSigner)
}

#[inline(always)]
pub fn writable(account: &AccountView) -> ProgramResult {
    require(account.is_writable(), &ConstraintMut)
}

#[inline(always)]
pub fn program(account: &AccountView, id: &Address) -> ProgramResult {
    require(account.address() == id, &InvalidProgramId)
}

/// Who may end a locked escrow by refunding the payer, and why.
///
/// - The payee may decline at any time.
/// - The payer may refund itself once the escrow's own cancel window has elapsed.
/// - Nobody else may refund.
pub fn refund_outcome(
    authority: &Address,
    payer: &Address,
    payee: &Address,
    created_slot: u64,
    current_slot: u64,
    cancel_window_slots: u64,
) -> Result<Outcome, ProgramError> {
    if authority == payee {
        return Ok(Outcome::DeclinedByPayee);
    }
    require(authority == payer, &UnauthorisedSigner)?;
    require(
        current_slot.saturating_sub(created_slot) >= cancel_window_slots,
        &CancelWindowNotElapsed,
    )?;
    Ok(Outcome::RefundedAfterWindow)
}

/// Who may end a locked escrow by paying the payee, and why.
///
/// - The payer may release at any time.
/// - The payee may claim once the escrow's own claim window has elapsed.
/// - Nobody else may pay out.
pub fn payout_outcome(
    authority: &Address,
    payer: &Address,
    payee: &Address,
    created_slot: u64,
    current_slot: u64,
    claim_window_slots: u64,
) -> Result<Outcome, ProgramError> {
    if authority == payer {
        return Ok(Outcome::Released);
    }
    require(authority == payee, &UnauthorisedSigner)?;
    require(
        current_slot.saturating_sub(created_slot) >= claim_window_slots,
        &ClaimWindowNotElapsed,
    )?;
    Ok(Outcome::ClaimedByPayee)
}

/// Create the program-derived account `account`, rent-exempt for `space`
/// bytes and owned by `owner`, paid for by `payer`.
///
/// Anyone can send lamports to an address before it exists. A plain
/// `CreateAccount` would then fail and the address could never be used, so a
/// prefunded address is topped up, allocated and assigned instead. An address
/// that already holds data or belongs to a program is refused by the System
/// program either way ("already in use").
pub fn create_pda(
    payer: &AccountView,
    account: &AccountView,
    space: usize,
    owner: &Address,
    signer: &Signer,
) -> ProgramResult {
    let rent = rent_exempt_minimum(space)?;
    let signers = core::slice::from_ref(signer);
    let held = account.lamports();
    if held == 0 {
        return CreateAccount {
            from: payer,
            to: account,
            lamports: rent,
            space: space as u64,
            owner,
        }
        .invoke_signed(signers);
    }
    if rent > held {
        transfer(payer, account, rent - held)?;
    }
    Allocate {
        account,
        space: space as u64,
    }
    .invoke_signed(signers)?;
    Assign { account, owner }.invoke_signed(signers)
}

/// The balance an account holding `space` bytes needs to be rent-exempt.
#[inline(never)]
pub fn rent_exempt_minimum(space: usize) -> Result<u64, ProgramError> {
    Rent::get()?.try_minimum_balance(space)
}

/// System transfer out of a wallet that signed the transaction.
#[inline(never)]
pub fn transfer(from: &AccountView, to: &AccountView, lamports: u64) -> ProgramResult {
    Transfer { from, to, lamports }.invoke()
}

/// The current slot and Unix time.
#[inline(never)]
pub fn now() -> Result<(u64, i64), ProgramError> {
    let clock = Clock::get()?;
    Ok((clock.slot, clock.unix_timestamp))
}

/// The address derived from `seeds` under `program_id`, with its bump.
#[inline(never)]
pub fn derive(seeds: &[&[u8]], program_id: &Address) -> (Address, u8) {
    Address::find_program_address(seeds, program_id)
}

/// Move `lamports` out of an account this program owns.
#[inline(always)]
pub fn debit(account: &mut AccountView, lamports: u64) -> ProgramResult {
    let left = account
        .lamports()
        .checked_sub(lamports)
        .ok_or_else(|| fail(&Overflow))?;
    account.set_lamports(left);
    Ok(())
}

/// Add `lamports` to any writable account.
#[inline(always)]
pub fn credit(account: &mut AccountView, lamports: u64) -> ProgramResult {
    let total = account
        .lamports()
        .checked_add(lamports)
        .ok_or_else(|| fail(&Overflow))?;
    account.set_lamports(total);
    Ok(())
}

/// Close a record this program owns, sending everything it still holds
/// (rent, plus any unused amount) to `to`.
pub fn close(account: &mut AccountView, to: &mut AccountView) -> ProgramResult {
    credit(to, account.lamports())?;
    account.close()
}

/// Instruction arguments, read front to back. Trailing bytes are ignored.
pub struct Args<'a>(pub &'a [u8]);

/// The job an exit of a rated escrow names: the `opened_slot` of its rating,
/// as the 8 bytes (little-endian) after the exit's own data. An exit of an
/// escrow that is not rated ignores anything after its own data, as the
/// Anchor program does, so its wire format is unchanged.
#[inline(always)]
pub fn job(rest: &[u8]) -> Option<u64> {
    rest.first_chunk::<8>()
        .map(|bytes| u64::from_le_bytes(*bytes))
}

impl<'a> Args<'a> {
    #[inline(always)]
    pub fn array<const N: usize>(&mut self) -> Result<[u8; N], ProgramError> {
        let Some((head, rest)) = self.0.split_first_chunk::<N>() else {
            return Err(fail(&InstructionDidNotDeserialize));
        };
        self.0 = rest;
        Ok(*head)
    }

    pub fn bytes(&mut self, len: usize) -> Result<&'a [u8], ProgramError> {
        let Some((head, rest)) = self.0.split_at_checked(len) else {
            return Err(fail(&InstructionDidNotDeserialize));
        };
        self.0 = rest;
        Ok(head)
    }

    pub fn u8(&mut self) -> Result<u8, ProgramError> {
        Ok(self.array::<1>()?[0])
    }

    pub fn u32(&mut self) -> Result<u32, ProgramError> {
        Ok(u32::from_le_bytes(self.array()?))
    }

    pub fn u64(&mut self) -> Result<u64, ProgramError> {
        Ok(u64::from_le_bytes(self.array()?))
    }

    pub fn bool(&mut self) -> Result<bool, ProgramError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(fail(&InstructionDidNotDeserialize)),
        }
    }
}

/// Require `account` to be the program-derived address of `seeds`, the last
/// seed being a stored bump.
#[inline(never)]
pub fn at_seeds(account: &AccountView, seeds: &[&[u8]], program_id: &Address) -> ProgramResult {
    match Address::create_program_address(seeds, program_id) {
        Ok(address) if &address == account.address() => Ok(()),
        _ => Err(fail(&crate::error::ConstraintSeeds)),
    }
}

/// sha256 over the concatenation of `parts`.
pub fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    #[cfg_attr(not(target_os = "solana"), allow(unused_mut))]
    let mut hash = [0u8; 32];
    #[cfg(target_os = "solana")]
    // SAFETY: `parts` is a valid array of slices and `hash` holds 32 bytes.
    unsafe {
        pinocchio::syscalls::sol_sha256(
            parts.as_ptr() as *const u8,
            parts.len() as u64,
            hash.as_mut_ptr(),
        );
    }
    #[cfg(not(target_os = "solana"))]
    core::hint::black_box(parts);
    hash
}
