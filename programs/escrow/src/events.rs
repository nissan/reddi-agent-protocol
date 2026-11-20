//! Structured settlement records. Settled escrows are closed, so these events
//! are the durable on-chain trace of what happened to each one.
use anchor_lang::prelude::*;

/// How a locked escrow ended.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum SettlementOutcome {
    /// Paid to the payee by the payer's release.
    Released,
    /// Refunded to the payer because the payee declined.
    DeclinedByPayee,
    /// Refunded to the payer, by the payer, after the cancel window.
    RefundedAfterWindow,
    /// Paid to the payee by the payee's own claim after the claim window.
    ClaimedByPayee,
}

#[event]
pub struct EscrowLocked {
    pub escrow: Pubkey,
    pub payer: Pubkey,
    pub payee: Pubkey,
    /// `None` for native SOL.
    pub mint: Option<Pubkey>,
    pub amount: u64,
    pub nonce: [u8; 16],
    pub created_slot: u64,
}

#[event]
pub struct EscrowSettled {
    pub escrow: Pubkey,
    pub payer: Pubkey,
    pub payee: Pubkey,
    /// `None` for native SOL.
    pub mint: Option<Pubkey>,
    /// Amount moved to the beneficiary, including any swept vault surplus.
    pub amount: u64,
    pub nonce: [u8; 16],
    pub outcome: SettlementOutcome,
    pub slot: u64,
}
