use anchor_lang::prelude::*;

/// State of an escrow PDA
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
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
    /// Slot number when escrow was created (for 7-day cancel window)
    pub created_slot: u64,
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
        + 8    // created_slot
        + 1; // bump
}

/// Type of work an agent supports in the marketplace.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum AgentType {
    Primary,
    Attestation,
    Both,
}

/// On-chain registry record for a discoverable agent.
/// PDA seeds: [b"agent", owner]
#[account]
pub struct AgentAccount {
    /// Wallet that registered this agent
    pub owner: Pubkey,
    /// Marketplace role supported by this agent
    pub agent_type: AgentType,
    /// Human-readable model identifier (max 64 chars)
    pub model: String,
    /// Per-call price in lamports
    pub rate_lamports: u64,
    /// Minimum caller reputation required (0 = open access)
    pub min_reputation: u8,
    /// Running reputation score, 0..10000 == 0.00..100.00
    pub reputation_score: u16,
    /// Successful jobs fulfilled
    pub jobs_completed: u64,
    /// Failed jobs
    pub jobs_failed: u64,
    /// Unix timestamp when registered
    pub created_at: i64,
    /// Whether this agent can currently accept jobs
    pub active: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl AgentAccount {
    /// 8 (discriminator) + 32 + 1 + 68 (4+64 string) + 8 + 1 + 2 + 8 + 8 + 8 + 1 + 1
    pub const LEN: usize = 148;
}

/// Blind commit-reveal rating account.
/// PDA seeds: [b"rating", job_id.as_ref()]
#[account]
pub struct RatingAccount {
    /// Unique job identifier (UUID bytes)
    pub job_id: [u8; 16],
    /// The hiring party
    pub consumer: Pubkey,
    /// The hired party
    pub specialist: Pubkey,
    /// sha256(consumer_score as u8 || consumer_salt as [u8;32])
    pub consumer_commitment: [u8; 32],
    /// sha256(specialist_score as u8 || specialist_salt as [u8;32])
    pub specialist_commitment: [u8; 32],
    /// Revealed score from consumer (1-10), None until revealed
    pub consumer_score: Option<u8>,
    /// Revealed score from specialist (1-10), None until revealed
    pub specialist_score: Option<u8>,
    /// Current lifecycle state
    pub state: RatingState,
    /// Unix timestamp when account was created
    pub created_at: i64,
    /// Slot when account was created (for expiry enforcement)
    pub created_slot: u64,
    /// PDA bump seed
    pub bump: u8,
}

impl RatingAccount {
    // 8  discriminator
    // 16  job_id
    // 32  consumer
    // 32  specialist
    // 32  consumer_commitment
    // 32  specialist_commitment
    // 2   consumer_score  (Option<u8>: 1 discriminant + 1 value)
    // 2   specialist_score
    // 1   state (enum variant)
    // 8   created_at
    // 8   created_slot
    // 1   bump
    // = 175
    pub const LEN: usize = 175;
}

/// Lifecycle state of a blind commit-reveal rating.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum RatingState {
    /// Awaiting one or both commitments
    Pending,
    /// Both parties have committed; neither has revealed
    BothCommitted,
    /// Both parties have revealed their scores
    Revealed,
    /// One party committed; the other timed out
    Expired,
}

/// Which party is submitting a commitment or reveal.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum RatingRole {
    Consumer,
    Specialist,
}
