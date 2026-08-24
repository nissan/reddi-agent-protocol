use quasar_lang::prelude::*;

// ── Constants ─────────────────────────────────────────────────────────────────

/// PDA seed prefix for AgentAccount — mirrors Anchor `AGENT_SEED = b"agent"`
pub const AGENT_SEED: &[u8] = b"agent";

/// PDA seed prefix for RatingAccount — mirrors Anchor `RATING_SEED = b"rating"`
pub const RATING_SEED: &[u8] = b"rating";

/// Registration fee in lamports (0.01 SOL) — burned to Solana incinerator.
pub const AGENT_REGISTRATION_FEE: u64 = 10_000_000;

/// Max model string byte length.
pub const AGENT_MODEL_MAX_LEN: usize = 64;

/// Solana incinerator address — fee destination matches Anchor canonical.
pub const AGENT_FEE_BURN_ADDRESS: Address =
    address!("1nc1nerator11111111111111111111111111111111");

/// Slots before a pending rating expires (~7 days at 400ms/slot).
/// Mirrors Anchor `RATING_EXPIRE_SLOTS`.
pub const RATING_EXPIRE_SLOTS: u64 = 1_512_000;

/// Reputation penalty deducted on rating expiry (5.00 points = 500 in 0-10000 scale).
/// Mirrors Anchor `RATING_EXPIRE_PENALTY`.
pub const RATING_EXPIRE_PENALTY: u16 = 500;

// ── Agent type ────────────────────────────────────────────────────────────────

/// Marketplace role supported by a registered agent.
/// Mirrors Anchor `AgentType` enum byte representation.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AgentType {
    Primary = 0,
    Attestation = 1,
    Both = 2,
}

impl AgentType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Primary),
            1 => Some(Self::Attestation),
            2 => Some(Self::Both),
            _ => None,
        }
    }
}

// ── Rating state ──────────────────────────────────────────────────────────────

/// Lifecycle state of a blind commit-reveal rating.
///
/// Mirrors Anchor `RatingState` enum, encoded as u8.
/// 0 = Pending, 1 = BothCommitted, 2 = Revealed, 3 = Expired
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RatingState {
    /// Awaiting one or both commitments.
    Pending = 0,
    /// Both parties committed; neither has revealed.
    BothCommitted = 1,
    /// Both parties revealed their scores.
    Revealed = 2,
    /// One party committed; the other timed out.
    Expired = 3,
}

impl RatingState {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Pending),
            1 => Some(Self::BothCommitted),
            2 => Some(Self::Revealed),
            3 => Some(Self::Expired),
            _ => None,
        }
    }
}

/// Which party is submitting a commitment.
/// Mirrors Anchor `RatingRole` enum.
/// 0 = Consumer, 1 = Specialist
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RatingRole {
    Consumer = 0,
    Specialist = 1,
}

impl RatingRole {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Consumer),
            1 => Some(Self::Specialist),
            _ => None,
        }
    }
}

// ── AgentAccount ──────────────────────────────────────────────────────────────

/// On-chain registry record for a discoverable agent.
///
/// Layout matches `quasar-registry` AgentAccount exactly — discriminator 20,
/// same field order, same padding.
///
/// PDA seeds: `[b"agent", owner]`
#[account(discriminator = 20, set_inner)]
#[seeds(b"agent", owner: Address)]
pub struct AgentAccount {
    pub owner: Address,
    pub agent_type: u8,
    pub model_len: u8,
    pub _pad: [u8; 6],
    pub rate_lamports: u64,
    pub min_reputation: u8,
    pub _pad2: u8,
    pub reputation_score: u16,
    pub _pad3: [u8; 4],
    pub jobs_completed: u64,
    pub jobs_failed: u64,
    pub created_at: i64,
    pub active: u8,
    pub bump: u8,
    pub _pad4: [u8; 6],
    pub model: [u8; 64],
}

impl AgentAccount {
    pub fn is_active(&self) -> bool {
        self.active != 0
    }
}

// ── RatingAccount ─────────────────────────────────────────────────────────────

/// On-chain blind commit-reveal rating record.
///
/// PDA seeds: `[b"rating", escrow_address]`
///
/// # Job binding
///
/// The rating is keyed by the **escrow account address**, not by a
/// caller-chosen `job_id`. `commit` reads `consumer` and `specialist` from that
/// escrow rather than accepting them as arguments, which is what closes
/// CRITICAL-1 (rating-PDA squatting): a rating cannot exist without a real
/// escrow, and an attacker cannot name themselves a party to someone else's
/// job. See `docs/QUASAR-JOB-BINDING-DESIGN-2026-08-24.md`.
///
/// Quasar parity notes vs Anchor:
/// - `job_id` is stored as `[u8; 16]` but is no longer an instruction argument.
///   It is derived from `escrow.escrow_id` widened to `u128`, so it identifies
///   the job without being caller-controlled. The PDA seed is the escrow
///   address; `job_id` is retained for parity with the Anchor reference and for
///   off-chain indexers that key jobs by id.
/// - `consumer_score` / `specialist_score` are `u8` with sentinel 0 = not set.
///   Anchor uses `Option<u8>` (2 bytes each); Quasar uses 1 byte each with 0 as None.
///   Scores 1-10 are valid; 0 is unambiguously "not revealed". Space saved: 2 bytes.
/// - `state` is encoded as `u8` (0=Pending, 1=BothCommitted, 2=Revealed, 3=Expired).
///   Anchor uses `RatingState` enum via AnchorSerialize (1 byte). Functionally identical.
/// - `created_at` and `created_slot` are populated using `Clock::get()` — unlike the
///   registry (which omitted Clock), reputation requires timestamps for expiry.
#[account(discriminator = 30, set_inner)]
#[seeds(b"rating", escrow: Address)]
pub struct RatingAccount {
    /// The `quasar-escrow` account this rating is bound to — the canonical job
    /// record, and the PDA seed. Recorded on-chain so a reader can walk from a
    /// rating back to its job without inverting the PDA.
    pub escrow: Address,
    /// Job identifier — derived from `escrow.escrow_id`, not caller-supplied
    pub job_id: [u8; 16],
    /// The hiring party (consumer)
    pub consumer: Address,
    /// The hired party (specialist)
    pub specialist: Address,
    /// sha256(consumer_score || consumer_salt || escrow_address || program_id)
    pub consumer_commitment: [u8; 32],
    /// sha256(specialist_score || specialist_salt || escrow_address || program_id)
    pub specialist_commitment: [u8; 32],
    /// Consumer's revealed score (0 = not set, 1-10 = valid)
    pub consumer_score: u8,
    /// Specialist's revealed score (0 = not set, 1-10 = valid)
    pub specialist_score: u8,
    /// Lifecycle state as u8 (see RatingState)
    pub state: u8,
    /// Padding
    pub _pad: u8,
    /// Unix timestamp when account was created
    pub created_at: i64,
    /// Slot when account was created (for expiry enforcement)
    pub created_slot: u64,
    /// PDA bump seed
    pub bump: u8,
    /// Alignment padding
    pub _pad2: [u8; 7],
}

impl RatingAccount {
    /// Returns whether the consumer commitment is set (non-zero).
    #[inline(always)]
    pub fn consumer_committed(&self) -> bool {
        self.consumer_commitment != [0u8; 32]
    }

    /// Returns whether the specialist commitment is set (non-zero).
    #[inline(always)]
    pub fn specialist_committed(&self) -> bool {
        self.specialist_commitment != [0u8; 32]
    }

    /// Returns whether the consumer score has been revealed.
    #[inline(always)]
    pub fn consumer_revealed(&self) -> bool {
        self.consumer_score != 0
    }

    /// Returns whether the specialist score has been revealed.
    #[inline(always)]
    pub fn specialist_revealed(&self) -> bool {
        self.specialist_score != 0
    }

    /// Returns the current state as a RatingState enum.
    #[inline(always)]
    pub fn rating_state(&self) -> RatingState {
        RatingState::from_u8(self.state).unwrap_or(RatingState::Pending)
    }
}

/// Rolling average update — mirrors Anchor `apply_reputation_update`.
///
/// Formula: `new_score = (old_score * 9 + new_rating_scaled) / 10`
/// where `rating_1_10` is scaled to 0-10000 as `rating * 1000`.
///
/// Quasar note: integer account fields are Pod types (PodU16, PodU64) in the Zc
/// struct. Use `.get()` to read native values and direct assignment to write back.
#[inline(always)]
pub fn apply_reputation_update(agent: &mut Account<AgentAccount>, rating_1_10: u8) {
    let new_scaled = (rating_1_10 as u32) * 1000;
    let old = agent.reputation_score.get() as u32; // PodU16 → u16 → u32
    let updated = (old * 9 + new_scaled) / 10;
    agent.reputation_score = PodU16::from(updated.min(10000) as u16);
    let completed = agent.jobs_completed.get().saturating_add(1);
    agent.jobs_completed = PodU64::from(completed);
}
