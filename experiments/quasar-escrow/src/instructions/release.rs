/// release_escrow — port of Anchor release_escrow_handler
///
/// Parity:
/// - `has_one = payer` enforcement
/// - locked-state guard
/// - lamports escrow -> payee
/// - close escrow to payer (rent returned)
///
/// CRITICAL-4 (2026-08-26): this instruction no longer closes the escrow.
///
/// It used to carry `close = payer`, which destroyed the account on settlement.
/// Because `quasar-reputation::commit` needs a live escrow to read the job's
/// parties while `expire` needs only its address as a PDA seed, a payer could
/// commit, release in the same transaction, and permanently lock the payee out
/// of rating them — then expire the rating for the penalty. See
/// `docs/QUASAR-C4-DURABLE-JOB-RECORD-DESIGN-2026-08-26.md`.
///
/// The escrow is now a durable job record: it survives settlement, so neither
/// party can deny the other the ability to rate them. The cost is the
/// rent-exempt minimum, which stays in the account permanently instead of being
/// swept to the payer.
///
/// Quasar changes:
/// - lamport transfer via `set_lamports` (same pattern as vault withdraw)
/// - status update before close
use {
    crate::{
        events::EscrowReleased,
        state::{EscrowAccount, EscrowStatus},
    },
    quasar_lang::{
        prelude::*,
        sysvars::{rent::Rent, Sysvar as _},
    },
};

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct Release<'info> {
    /// Only payer can release — `has_one = payer` enforced by Quasar
    pub payer: &'info mut Signer,
    /// Payee receives funds — validated by has_one on escrow
    /// CHECK: payee is stored in escrow.payee and validated via constraint
    pub payee: &'info mut UncheckedAccount,
    #[account(
        mut,
        has_one = payer,
        has_one = payee,
        seeds = EscrowAccount::seeds(payer, escrow_id),
        bump = escrow.bump,
    )]
    pub escrow: &'info mut Account<EscrowAccount>,
}

impl<'info> Release<'info> {
    #[inline(always)]
    pub fn release(&mut self, escrow_id: u64) -> Result<(), ProgramError> {
        if self.escrow.escrow_id != escrow_id {
            return Err(ProgramError::InvalidArgument);
        }

        if self.escrow.status != EscrowStatus::Locked as u8 {
            return Err(ProgramError::InvalidAccountData);
        }

        let amount = u64::from(self.escrow.amount);

        // Move lamports escrow -> payee via direct lamport manipulation
        // (escrow is PDA, can't be a system transfer signer without invoke_signed)
        let escrow_view = self.escrow.to_account_view();
        let payee_view = self.payee.to_account_view();

        let new_escrow_lamports = escrow_view
            .lamports()
            .checked_sub(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        let new_payee_lamports = payee_view
            .lamports()
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // The whole CRITICAL-4 fix rests on this account continuing to exist.
        // An account that drops below rent-exemption is garbage-collected, which
        // would silently restore the settlement race with every test green.
        //
        // `lock` funds the escrow as rent-exempt-minimum + amount, so paying out
        // `amount` leaves exactly the minimum — but that is an invariant of
        // `lock`, not something this instruction may assume. Assert it.
        let rent = Rent::get()?;
        let minimum = rent.try_minimum_balance(escrow_view.data_len())?;
        if new_escrow_lamports < minimum {
            return Err(ProgramError::InsufficientFunds);
        }

        set_lamports(escrow_view, new_escrow_lamports);
        set_lamports(payee_view, new_payee_lamports);

        // Mark released. The account is deliberately NOT closed — see the
        // CRITICAL-4 note above.
        self.escrow.status = EscrowStatus::Released as u8;

        emit!(EscrowReleased {
            escrow: *self.escrow.address(),
            payee: *self.payee.address(),
            amount,
        }); // amount is already u64 here

        Ok(())
    }
}
