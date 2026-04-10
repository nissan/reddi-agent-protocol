use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::ESCROW_SEED;
use crate::error::EscrowError;
use crate::state::{EscrowAccount, EscrowStatus};

/// Lock SOL into an escrow PDA.
/// Called by Agent A (payer) to initiate a payment to Agent B (payee).
///
/// PDA: seeds = [b"escrow", payer, nonce]
/// This prevents duplicate nonces for the same payer.
pub fn lock_escrow_handler(ctx: Context<LockEscrow>, amount: u64, nonce: [u8; 16]) -> Result<()> {
    require!(amount > 0, EscrowError::ZeroAmount);

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

    // Transfer lamports from payer to escrow PDA
    // Anchor 1.0.0: CpiContext::new takes Pubkey as first arg (not AccountInfo)
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

    msg!(
        "Escrow locked: payer={}, payee={}, amount={}, nonce={:?}",
        ctx.accounts.payer.key(),
        ctx.accounts.payee.key(),
        amount,
        nonce,
    );

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
