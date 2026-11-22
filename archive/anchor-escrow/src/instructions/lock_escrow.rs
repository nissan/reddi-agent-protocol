use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::{
    escrow_windows_valid, max_protocol_fee, ESCROW_SEED, MAX_SOL_ESCROW_LAMPORTS,
};
use crate::error::EscrowError;
use crate::events::EscrowLocked;
use crate::state::{EscrowAccount, EscrowStatus};

/// Lock SOL into an escrow PDA.
/// Called by Agent A (payer) to initiate a payment to Agent B (payee).
///
/// PDA: seeds = [b"escrow", payer, nonce]
/// This prevents duplicate nonces for the same payer.
pub fn lock_escrow_handler(
    ctx: Context<LockEscrow>,
    amount: u64,
    nonce: [u8; 16],
    claim_window_slots: u64,
    cancel_window_slots: u64,
    metered: bool,
) -> Result<()> {
    require!(amount > 0, EscrowError::ZeroAmount);
    require!(
        amount <= MAX_SOL_ESCROW_LAMPORTS,
        EscrowError::AmountAboveCap
    );
    require!(
        escrow_windows_valid(claim_window_slots, cancel_window_slots),
        EscrowError::InvalidWindows
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
    // The runtime refuses a payout that leaves the payee's account holding
    // something but less than its rent-exempt minimum, which would block
    // release, claim and settle alike. A fixed-price escrow pays the amount
    // less the fee, so that is counted, at the standard rate because the
    // payout may come after the launch rate ends. A metered escrow pays
    // whatever the payee reports, so its payee must already hold the minimum.
    let certain = if metered {
        0
    } else {
        amount - max_protocol_fee(amount, true)
    };
    let payee = ctx.accounts.payee.to_account_info();
    require!(
        payee.lamports().saturating_add(certain) >= Rent::get()?.minimum_balance(payee.data_len()),
        EscrowError::PayeeNotRentExempt
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
    escrow.claim_window_slots = claim_window_slots;
    escrow.cancel_window_slots = cancel_window_slots;
    escrow.bump = ctx.bumps.escrow;
    escrow.metered = metered;

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
