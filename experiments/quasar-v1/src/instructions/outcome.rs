//! Who may end a locked escrow, and how. Same rules as the Anchor
//! `refund_outcome` and `payout_outcome`.
use {
    crate::{
        constants::{CANCEL_WINDOW_SLOTS, CLAIM_WINDOW_SLOTS},
        error::EscrowError,
        events::*,
    },
    quasar_lang::prelude::*,
};

/// The payee may decline at any time. The payer may refund itself once the
/// cancel window has elapsed. Nobody else may refund.
#[inline(always)]
pub fn refund_outcome(
    authority: &Address,
    payer: &Address,
    payee: &Address,
    created_slot: u64,
    current_slot: u64,
) -> Result<u64, ProgramError> {
    if authority == payee {
        return Ok(OUTCOME_DECLINED_BY_PAYEE);
    }
    require!(authority == payer, EscrowError::UnauthorisedSigner);
    require!(
        current_slot.saturating_sub(created_slot) >= CANCEL_WINDOW_SLOTS,
        EscrowError::CancelWindowNotElapsed
    );
    Ok(OUTCOME_REFUNDED_AFTER_WINDOW)
}

/// The payer may release at any time. The payee may claim once the claim
/// window has elapsed. Nobody else may pay out.
#[inline(always)]
pub fn payout_outcome(
    authority: &Address,
    payer: &Address,
    payee: &Address,
    created_slot: u64,
    current_slot: u64,
) -> Result<u64, ProgramError> {
    if authority == payer {
        return Ok(OUTCOME_RELEASED);
    }
    require!(authority == payee, EscrowError::UnauthorisedSigner);
    require!(
        current_slot.saturating_sub(created_slot) >= CLAIM_WINDOW_SLOTS,
        EscrowError::ClaimWindowNotElapsed
    );
    Ok(OUTCOME_CLAIMED_BY_PAYEE)
}

/// Outcome of a settle at `actual`: the payee may settle only a metered escrow.
#[inline(always)]
pub fn settle_outcome(
    authority: &Address,
    payer: &Address,
    amount: u64,
    metered: bool,
    actual: u64,
) -> Result<u64, ProgramError> {
    require!(
        actual > 0 && actual <= amount,
        EscrowError::InvalidSettleAmount
    );
    if authority != payer {
        require!(metered, EscrowError::NotMetered);
    }
    Ok(if actual == amount && authority == payer {
        OUTCOME_RELEASED
    } else {
        OUTCOME_SETTLED_ACTUAL
    })
}
