use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::{ESCROW_SEED, MAX_SOL_ESCROW_LAMPORTS};
use crate::error::EscrowError;
use crate::events::EscrowLocked;
use crate::state::{EscrowAccount, EscrowStatus};

/// Lock SOL into an escrow PDA.
/// Called by Agent A (payer) to initiate a payment to Agent B (payee).
///
/// PDA: seeds = [b"escrow", payer, nonce]
/// This prevents duplicate nonces for the same payer.
pub fn lock_escrow_handler(ctx: Context<LockEscrow>, amount: u64, nonce: [u8; 16]) -> Result<()> {
    require!(amount > 0, EscrowError::ZeroAmount);
    require!(
        amount <= MAX_SOL_ESCROW_LAMPORTS,
        EscrowError::AmountAboveCap
    );
    // A payer paying themselves, or the escrow account itself, is never a real job.
    require_keys_neq!(
        ctx.accounts.payee.key(),
        ctx.accounts.payer.key(),
        EscrowError::InvalidPayee
    );
    require_keys_neq!(
        ctx.accounts.payee.key(),
        ctx.accounts.escrow.key(),
        EscrowError::InvalidPayee
    );

    let escrow = &mut ctx.accounts.escrow;
    escrow.payer = ctx.accounts.payer.key();
    escrow.payee = ctx.accounts.payee.key();
    escrow.amount = amount;
    escrow.nonce = nonce;
    escrow.status = EscrowStatus::Locked;
    let clock = Clock::get()?;
    escrow.created_at = clock.unix_timestamp;
    escrow.created_slot = clock.slot;
    escrow.bump = ctx.bumps.escrow;

    // Transfer lamports from payer to escrow PDA.
    // Anchor 1.x on the Agave 3.x baseline expects the program id here.
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            },
        ),
        amount,
    )?;

    emit!(EscrowLocked {
        escrow: ctx.accounts.escrow.key(),
        payer: ctx.accounts.payer.key(),
        payee: ctx.accounts.payee.key(),
        mint: None,
        amount,
        nonce,
        created_slot: clock.slot,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(amount: u64, nonce: [u8; 16])]
pub struct LockEscrow<'info> {
    #[account(
        init,
        payer = payer,
        space = EscrowAccount::LEN,
        seeds = [ESCROW_SEED, payer.key().as_ref(), nonce.as_ref()],
        bump,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Payee is just a recipient address — validated off-chain via x402 header
    pub payee: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
