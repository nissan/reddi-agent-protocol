use anchor_lang::prelude::*;

use crate::constants::ESCROW_SEED;
use crate::error::EscrowError;
use crate::state::{EscrowAccount, EscrowStatus};

/// Release an escrow via the MagicBlock PER path.
///
/// Mirrors `release_escrow` but:
///   - Requires `delegated_to_per == true`
///   - Validates the session key matches the one stored at delegation time
///   - Clears the delegation state on success
///
/// The TypeScript client (`packages/per-client/`) routes this transaction to
/// `devnet-tee.magicblock.app` rather than the public RPC, keeping settlement
/// hidden from the mempool while in-flight. The TEE then undelegates, finalising
/// on Solana mainnet.
///
/// Called by the payer (same auth as `release_escrow`).
pub fn release_escrow_per_handler(
    ctx: Context<ReleaseEscrowPer>,
    session_key: Pubkey,
) -> Result<()> {
    require!(
        ctx.accounts.escrow.status == EscrowStatus::Locked,
        EscrowError::NotLocked
    );
    require!(
        ctx.accounts.escrow.delegated_to_per,
        EscrowError::NotDelegatedToPer
    );
    require!(
        ctx.accounts.escrow.per_session_key == Some(session_key),
        EscrowError::PerSessionKeyMismatch
    );

    let amount = ctx.accounts.escrow.amount;
    let payee_key = ctx.accounts.payee.key();

    // Transfer lamports from escrow PDA to payee
    **ctx
        .accounts
        .escrow
        .to_account_info()
        .try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.payee.try_borrow_mut_lamports()? += amount;

    // Mark released and clear delegation state
    let escrow = &mut ctx.accounts.escrow;
    escrow.status = EscrowStatus::Released;
    escrow.delegated_to_per = false;
    escrow.per_session_key = None;

    msg!(
        "Escrow released via PER: payee={}, amount={}",
        payee_key,
        amount,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ReleaseEscrowPer<'info> {
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
