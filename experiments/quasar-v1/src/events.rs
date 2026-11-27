use quasar_lang::prelude::*;

/// `outcome` values of `EscrowSettled`, same meaning and order as the Anchor
/// `SettlementOutcome` enum.
pub const OUTCOME_RELEASED: u64 = 0;
pub const OUTCOME_DECLINED_BY_PAYEE: u64 = 1;
pub const OUTCOME_REFUNDED_AFTER_WINDOW: u64 = 2;
pub const OUTCOME_CLAIMED_BY_PAYEE: u64 = 3;
pub const OUTCOME_SETTLED_ACTUAL: u64 = 4;

#[event(discriminator = 1)]
pub struct EscrowLocked {
    pub escrow: Address,
    pub payer: Address,
    pub payee: Address,
    /// The all-zero address for native SOL.
    pub mint: Address,
    pub amount: u64,
    /// The 16 nonce bytes (little-endian integer, so the same bytes on the wire).
    pub nonce: u128,
    pub created_slot: u64,
}

#[event(discriminator = 2)]
pub struct EscrowSettled {
    pub escrow: Address,
    pub payer: Address,
    pub payee: Address,
    /// The all-zero address for native SOL.
    pub mint: Address,
    pub amount: u64,
    /// The 16 nonce bytes (little-endian integer, so the same bytes on the wire).
    pub nonce: u128,
    /// One of the `OUTCOME_*` values. A u64 because Quasar events are copied
    /// straight from memory and may not contain padding.
    pub outcome: u64,
    pub slot: u64,
    pub fee: u64,
    pub refunded: u64,
}
