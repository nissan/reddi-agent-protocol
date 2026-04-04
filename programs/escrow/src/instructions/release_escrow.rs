use anchor_lang::prelude::*;

use crate::constants::ESCROW_SEED;
use crate::error::EscrowError;
use crate::state::{EscrowAccount, EscrowStatus};

/// Release locked SOL to the payee.
/// Can only be called by the payer (Agent A) once goods/services are delivered.
/// Closes the PDA and returns rent to the payer.
pub fn release_escrow_handler(ctx: Context<ReleaseEscrow>) -> Result<()> {
    require!(
        ctx.accounts.escrow.status == EscrowStatus::Locked,
        EscrowError::NotLocked
    );

    let amount = ctx.accounts.escrow.amount;

    // Transfer lamports from escrow PDA to payee
    **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.payee.try_borrow_mut_lamports()? += amount;

    // Mark released (account will be closed by `close = payer` constraint)
    ctx.accounts.escrow.status = EscrowStatus::Released;

    msg!(
        "Escrow released: payee={}, amount={}",
        ctx.accounts.payee.key(),
        amount,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, payer.key().as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump,
        has_one = payer @ EscrowError::UnauthorisedSigner,
        has_one = payee,
        close = payer,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Payee receives funds — validated by has_one constraint on escrow
    #[account(mut)]
    pub payee: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
