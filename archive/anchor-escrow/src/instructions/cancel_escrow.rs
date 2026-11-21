use anchor_lang::prelude::*;

use crate::constants::ESCROW_SEED;
use crate::error::EscrowError;
use crate::events::{EscrowSettled, SettlementOutcome};
use crate::state::{EscrowAccount, EscrowStatus};

/// Who may end a locked escrow by refunding the payer, and why.
///
/// - The payee may decline at any time.
/// - The payer may refund itself once the cancel window has elapsed, for as long
///   as the payee has not claimed. The window is the escrow's own, set at lock.
/// - Nobody else may refund.
pub fn refund_outcome(
    authority: &Pubkey,
    payer: &Pubkey,
    payee: &Pubkey,
    created_slot: u64,
    current_slot: u64,
    cancel_window_slots: u64,
) -> Result<SettlementOutcome> {
    if authority == payee {
        return Ok(SettlementOutcome::DeclinedByPayee);
    }
    require_keys_eq!(*authority, *payer, EscrowError::UnauthorisedSigner);
    require!(
        current_slot.saturating_sub(created_slot) >= cancel_window_slots,
        EscrowError::CancelWindowNotElapsed
    );
    Ok(SettlementOutcome::RefundedAfterWindow)
}

/// Who may end a locked escrow by paying the payee, and why.
///
/// - The payer may release at any time.
/// - The payee may claim once the claim window has elapsed, for as long as the
///   payer has not refunded.
/// - Nobody else may pay out.
pub fn payout_outcome(
    authority: &Pubkey,
    payer: &Pubkey,
    payee: &Pubkey,
    created_slot: u64,
    current_slot: u64,
    claim_window_slots: u64,
) -> Result<SettlementOutcome> {
    if authority == payer {
        return Ok(SettlementOutcome::Released);
    }
    require_keys_eq!(*authority, *payee, EscrowError::UnauthorisedSigner);
    require!(
        current_slot.saturating_sub(created_slot) >= claim_window_slots,
        EscrowError::ClaimWindowNotElapsed
    );
    Ok(SettlementOutcome::ClaimedByPayee)
}

/// Refund a locked SOL escrow to its payer and close it.
pub fn cancel_escrow_handler(ctx: Context<CancelEscrow>) -> Result<()> {
    require!(
        ctx.accounts.escrow.status == EscrowStatus::Locked,
        EscrowError::NotLocked
    );

    let slot = Clock::get()?.slot;
    let outcome = refund_outcome(
        &ctx.accounts.authority.key(),
        &ctx.accounts.escrow.payer,
        &ctx.accounts.escrow.payee,
        ctx.accounts.escrow.created_slot,
        slot,
        ctx.accounts.escrow.cancel_window_slots,
    )?;

    let amount = ctx.accounts.escrow.amount;

    // Transfer lamports from escrow PDA back to payer
    **ctx
        .accounts
        .escrow
        .to_account_info()
        .try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.payer.try_borrow_mut_lamports()? += amount;

    // Mark cancelled (account will be closed by `close = payer` constraint)
    ctx.accounts.escrow.status = EscrowStatus::Cancelled;

    emit!(EscrowSettled {
        escrow: ctx.accounts.escrow.key(),
        payer: ctx.accounts.payer.key(),
        payee: ctx.accounts.escrow.payee,
        mint: None,
        amount,
        nonce: ctx.accounts.escrow.nonce,
        outcome,
        slot,
        fee: 0,
        refunded: 0,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, payer.key().as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump,
        has_one = payer @ EscrowError::UnauthorisedSigner,
        close = payer,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    /// The payee (to decline at any time) or the payer (after the cancel
    /// window).
    pub authority: Signer<'info>,

    /// CHECK: The recorded payer, bound by the escrow seeds and `has_one`. Receives
    /// the refund and the rent; does not need to sign.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
