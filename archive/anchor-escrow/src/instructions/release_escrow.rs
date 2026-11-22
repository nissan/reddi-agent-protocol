use anchor_lang::prelude::*;

use crate::constants::{protocol_fee, ESCROW_SEED, PROTOCOL_TREASURY};
use crate::error::EscrowError;
use crate::events::{EscrowSettled, SettlementOutcome};
use crate::instructions::cancel_escrow::payout_outcome;
use crate::state::{EscrowAccount, EscrowStatus};

/// Pay locked SOL to the payee, less the protocol fee, and close the escrow,
/// returning rent to the payer.
///
/// Signed by the payer at any time (release), or by the payee once the claim
/// window has elapsed (claim). Whichever of `payer` and `payee` signed is the
/// authority, and the payer is preferred when both did.
pub fn release_escrow_handler(ctx: Context<ReleaseEscrow>) -> Result<()> {
    let authority = signing_party(&ctx.accounts.payer, &ctx.accounts.payee)?;
    let escrow = &ctx.accounts.escrow;
    let outcome = payout_outcome(
        &authority,
        &escrow.payer,
        &escrow.payee,
        escrow.created_slot,
        Clock::get()?.slot,
        escrow.claim_window_slots,
    )?;
    let amount = escrow.amount;
    pay_out(ctx.accounts, amount, outcome)
}

/// Settle a locked SOL escrow at its actual cost. The payee receives `actual`
/// less the protocol fee, the treasury receives the fee, and everything else in
/// the escrow (the unused part of the authorised maximum, plus rent) returns to
/// the payer when the account closes.
///
/// Only the payee may settle, and only a metered escrow. The payer never
/// chooses a smaller amount: the payer's ways out are a full release, or a
/// refund once the refund window has elapsed.
pub fn settle_escrow_handler(ctx: Context<ReleaseEscrow>, actual: u64) -> Result<()> {
    require!(
        ctx.accounts.payee.is_signer,
        EscrowError::UnauthorisedSigner
    );
    let escrow = &ctx.accounts.escrow;
    require!(
        actual > 0 && actual <= escrow.amount,
        EscrowError::InvalidSettleAmount
    );
    require!(escrow.metered, EscrowError::NotMetered);
    pay_out(ctx.accounts, actual, SettlementOutcome::SettledActual)
}

fn signing_party(payer: &UncheckedAccount, payee: &UncheckedAccount) -> Result<Pubkey> {
    if payer.is_signer {
        Ok(payer.key())
    } else if payee.is_signer {
        Ok(payee.key())
    } else {
        err!(EscrowError::UnauthorisedSigner)
    }
}

/// Move `paid` lamports out of the escrow: the fee to the treasury and the rest
/// to the payee. The account closes to the payer afterwards (`close = payer`),
/// which returns rent and any unused amount.
fn pay_out(accounts: &mut ReleaseEscrow, paid: u64, outcome: SettlementOutcome) -> Result<()> {
    require!(
        accounts.escrow.status == EscrowStatus::Locked,
        EscrowError::NotLocked
    );
    let fee = protocol_fee(paid, true, Clock::get()?.unix_timestamp);
    let to_payee = paid.checked_sub(fee).ok_or(EscrowError::Overflow)?;
    let refunded = accounts
        .escrow
        .amount
        .checked_sub(paid)
        .ok_or(EscrowError::Overflow)?;

    let escrow_info = accounts.escrow.to_account_info();
    **escrow_info.try_borrow_mut_lamports()? -= paid;
    **accounts.payee.try_borrow_mut_lamports()? += to_payee;
    **accounts.treasury.try_borrow_mut_lamports()? += fee;

    // Mark released and clear any PER delegation (L1 fallback path)
    // If delegated_to_per was true, this serves as the fallback when the TEE
    // is unreachable or the PER TTL has expired.
    let escrow = &mut accounts.escrow;
    escrow.status = EscrowStatus::Released;
    escrow.delegated_to_per = false;
    escrow.per_session_key = None;

    emit!(EscrowSettled {
        escrow: escrow.key(),
        payer: accounts.payer.key(),
        payee: accounts.payee.key(),
        mint: None,
        amount: to_payee,
        nonce: escrow.nonce,
        outcome,
        slot: Clock::get()?.slot,
        fee,
        refunded,
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

    /// CHECK: The protocol fee treasury, fixed by address.
    #[account(mut, address = PROTOCOL_TREASURY @ EscrowError::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
