use anchor_lang::prelude::*;

use crate::constants::ESCROW_SEED;
use crate::error::EscrowError;
use crate::events::EscrowSettled;
use crate::instructions::cancel_escrow::payout_outcome;
use crate::state::{EscrowAccount, EscrowStatus};

/// Pay locked SOL to the payee and close the escrow, returning rent to the payer.
///
/// Signed by the payer at any time (release), or by the payee once the claim
/// window has elapsed (claim). The account list is unchanged from earlier
/// versions: whichever of `payer` and `payee` signed is the authority, and the
/// payer is preferred when both did.
pub fn release_escrow_handler(ctx: Context<ReleaseEscrow>) -> Result<()> {
    require!(
        ctx.accounts.escrow.status == EscrowStatus::Locked,
        EscrowError::NotLocked
    );

    let authority = if ctx.accounts.payer.is_signer {
        ctx.accounts.payer.key()
    } else if ctx.accounts.payee.is_signer {
        ctx.accounts.payee.key()
    } else {
        return err!(EscrowError::UnauthorisedSigner);
    };
    let slot = Clock::get()?.slot;
    let outcome = payout_outcome(
        &authority,
        &ctx.accounts.escrow.payer,
        &ctx.accounts.escrow.payee,
        ctx.accounts.escrow.created_slot,
        slot,
    )?;

    let amount = ctx.accounts.escrow.amount;

    // Transfer lamports from escrow PDA to payee
    **ctx
        .accounts
        .escrow
        .to_account_info()
        .try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.payee.try_borrow_mut_lamports()? += amount;

    // Mark released and clear any PER delegation (L1 fallback path)
    // If delegated_to_per was true, this serves as the fallback when the TEE
    // is unreachable or the PER TTL has expired.
    ctx.accounts.escrow.status = EscrowStatus::Released;
    ctx.accounts.escrow.delegated_to_per = false;
    ctx.accounts.escrow.per_session_key = None;

    emit!(EscrowSettled {
        escrow: ctx.accounts.escrow.key(),
        payer: ctx.accounts.payer.key(),
        payee: ctx.accounts.payee.key(),
        mint: None,
        amount,
        nonce: ctx.accounts.escrow.nonce,
        outcome,
        slot,
    });

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

    /// CHECK: The recorded payer, bound by the escrow seeds and `has_one`. Receives
    /// the rent. Signs to release; the handler checks who signed.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,

    /// CHECK: Payee receives funds — validated by has_one constraint on escrow.
    /// Signs to claim after the claim window; the handler checks who signed.
    #[account(mut)]
    pub payee: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
