use quasar_lang::prelude::*;

/// `status` values. Settled escrows are closed, so only `LOCKED` is ever stored.
pub const STATUS_LOCKED: u8 = 0;
pub const STATUS_RELEASED: u8 = 1;
pub const STATUS_CANCELLED: u8 = 2;

/// `agent_type` values.
pub const AGENT_TYPE_MAX: u8 = 2; // Primary = 0, Attestation = 1, Both = 2

/// SOL escrow. PDA: [b"escrow", payer, nonce].
#[account(discriminator = 1, set_inner)]
#[seeds(b"escrow", payer: Address, nonce: [u8; 16])]
pub struct EscrowAccount {
    pub payer: Address,
    pub payee: Address,
    pub amount: u64,
    /// The 16 nonce bytes, little-endian.
    pub nonce: [u8; 16],
    pub status: u8,
    pub created_at: i64,
    pub created_slot: u64,
    /// MagicBlock PER fields. Unused in the V1 build, kept for the same state shape.
    pub delegated_to_per: bool,
    pub per_session_key: Address,
    pub bump: u8,
    pub metered: bool,
}

/// Token escrow. PDA: [b"token-escrow", payer, nonce]; vault: [b"token-vault", escrow].
#[account(discriminator = 2, set_inner)]
#[seeds(b"token-escrow", payer: Address, nonce: [u8; 16])]
pub struct TokenEscrowAccount {
    pub payer: Address,
    pub payee: Address,
    pub mint: Address,
    pub source: Address,
    pub recipient: Address,
    pub amount: u64,
    pub nonce: [u8; 16],
    pub status: u8,
    pub created_slot: u64,
    pub bump: u8,
    pub metered: bool,
}

#[derive(Seeds)]
#[seeds(b"token-vault", escrow: Address)]
pub struct TokenVaultPda;

/// Registry record. PDA: [b"agent", owner].
#[account(discriminator = 3, set_inner, fixed_capacity)]
#[seeds(b"agent", owner: Address)]
pub struct AgentAccount {
    pub owner: Address,
    pub agent_type: u8,
    pub rate_lamports: u64,
    pub min_reputation: u8,
    pub reputation_score: u16,
    pub jobs_completed: u64,
    pub jobs_failed: u64,
    pub created_at: i64,
    pub active: bool,
    pub attestation_accuracy: u16,
    pub bump: u8,
    pub model: String<64>,
}
