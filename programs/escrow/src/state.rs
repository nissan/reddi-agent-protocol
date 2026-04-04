use anchor_lang::prelude::*;

/// State of an escrow PDA
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowStatus {
    /// Funds locked, awaiting release or cancellation
    Locked,
    /// Funds released to payee
    Released,
    /// Funds returned to payer (cancelled)
    Cancelled,
}

/// On-chain escrow account.
/// PDA seeds: [b"escrow", payer, nonce]
#[account]
pub struct EscrowAccount {
    /// Payer (Agent A — the buyer)
    pub payer: Pubkey,
    /// Payee (Agent B — the seller)
    pub payee: Pubkey,
    /// Amount in lamports locked in this escrow
    pub amount: u64,
    /// Unique nonce scoped to payer — prevents duplicate escrows
    pub nonce: [u8; 16],
    /// Current state of the escrow
    pub status: EscrowStatus,
    /// Unix timestamp when escrow was created
    pub created_at: i64,
    /// PDA bump seed
    pub bump: u8,
}

impl EscrowAccount {
    /// Account discriminator (8) + all fields
    pub const LEN: usize = 8   // discriminator
        + 32   // payer
        + 32   // payee
        + 8    // amount
        + 16   // nonce
        + 1    // status (enum variant)
        + 8    // created_at
        + 1;   // bump
}
