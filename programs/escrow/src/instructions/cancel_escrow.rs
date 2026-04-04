use anchor_lang::prelude::*;

use crate::constants::ESCROW_SEED;
use crate::error::EscrowError;
use crate::state::{EscrowAccount, EscrowStatus};

/// Cancel an escrow and refund the payer.
/// Can only be called by the payer (Agent A).
/// Closes the PDA and returns rent + locked funds to payer.
pub fn cancel_escrow_handler(ctx: Context<CancelEscrow>) -> Result<()> {
    require!(
        ctx.accounts.escrow.status == EscrowStatus::Locked,
        EscrowError::NotLocked
    );

    let amount = ctx.accounts.escrow.amount;

    // Transfer lamports from escrow PDA back to payer
    **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.payer.try_borrow_mut_lamports()? += amount;

    // Mark cancelled (account will be closed by `close = payer` constraint)
    ctx.accounts.escrow.status = EscrowStatus::Cancelled;

    msg!(
        "Escrow cancelled: payer={}, refund={}",
        ctx.accounts.payer.key(),
        amount,
    );

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

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
