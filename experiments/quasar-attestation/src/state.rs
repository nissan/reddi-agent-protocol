use quasar_lang::prelude::*;

// ── Constants ─────────────────────────────────────────────────────────────────

/// PDA seed prefix for AgentAccount — mirrors Anchor `AGENT_SEED = b"agent"`
pub const AGENT_SEED: &[u8] = b"agent";

/// PDA seed prefix for AttestationAccount — mirrors Anchor `ATTESTATION_SEED = b"attestation"`
pub const ATTESTATION_SEED: &[u8] = b"attestation";

/// Registration fee in lamports (0.01 SOL) — burned to Solana incinerator.
pub const AGENT_REGISTRATION_FEE: u64 = 10_000_000;

/// Max model string byte length.
pub const AGENT_MODEL_MAX_LEN: usize = 64;

/// Solana incinerator address — fee destination matches Anchor canonical.
pub const AGENT_FEE_BURN_ADDRESS: Address =
    address!("1nc1nerator11111111111111111111111111111111");

/// Reputation penalty deducted on attestation dispute (5.00 points = 500 in 0-10000 scale).
/// Reuses Anchor `RATING_EXPIRE_PENALTY` — same constant until penalties diverge.
pub const RATING_EXPIRE_PENALTY: u16 = 500;

/// Weight applied to `attestation_accuracy` on confirmation (10.00 points).
/// Mirrors Anchor `ATTESTATION_CONFIRM_WEIGHT = 1000`.
pub const ATTESTATION_CONFIRM_WEIGHT: u16 = 1000;

// ── AttestationStatus ─────────────────────────────────────────────────────────

/// Resolution state of an attestation record.
///
/// Quasar parity delta vs Anchor:
/// - Anchor: `confirmed: Option<bool>` — 2 bytes (tag + value)
/// - Quasar: `confirmed: u8` — 1 byte sentinel
///   0 = Pending (None), 1 = Confirmed (Some(true)), 2 = Disputed (Some(false))
///
/// Score range 1-10 means 0 is always invalid, making the sentinel unambiguous.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AttestationStatus {
    Pending = 0,
    Confirmed = 1,
    Disputed = 2,
}

impl AttestationStatus {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Pending),
            1 => Some(Self::Confirmed),
            2 => Some(Self::Disputed),
            _ => None,
        }
    }
}

// ── AgentType ─────────────────────────────────────────────────────────────────

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

// ── AgentAccount ──────────────────────────────────────────────────────────────

/// On-chain registry record for a discoverable agent.
///
/// Layout extends `quasar-registry` / `quasar-reputation` AgentAccount to add
/// `attestation_accuracy: u16` — required for confirm/dispute reward/penalty flows.
///
/// Discriminator 20 — same as quasar-registry and quasar-reputation for
/// cross-module layout compatibility.
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
    pub attestation_accuracy: u16,
    pub _pad4: [u8; 4],
    pub model: [u8; 64],
}

impl AgentAccount {
    pub fn is_attestation_eligible(&self) -> bool {
        let t = AgentType::from_u8(self.agent_type);
        matches!(t, Some(AgentType::Attestation) | Some(AgentType::Both))
    }

    pub fn is_active(&self) -> bool {
        self.active != 0
    }
}

// ── AttestationAccount ────────────────────────────────────────────────────────

/// On-chain attestation record created by a judge agent.
///
/// # Job binding
///
/// The attestation is keyed by the **escrow account address**, not by a
/// judge-chosen `job_id`, and `consumer` is read from `escrow.payer` rather than
/// supplied by the judge. That closes CRITICAL-2 (judge self-confirmation) and
/// CRITICAL-3 (unbounded attestation creation): an attestation cannot exist
/// without a real escrow, there is exactly one per job, and the judge cannot
/// name the party who will confirm their own work. See
/// `docs/QUASAR-JOB-BINDING-DESIGN-2026-08-24.md`.
///
/// Parity notes vs Anchor `AttestationAccount`:
/// - `confirmed: u8` instead of `Option<bool>` (1 byte vs 2 bytes; see AttestationStatus)
/// - `job_id` is derived from `escrow.escrow_id`, not passed by the caller
/// - `created_at` populated via `Clock::get()` as in Anchor
///
/// PDA seeds: `[b"attestation", escrow_address]`
#[account(discriminator = 40, set_inner)]
#[seeds(b"attestation", escrow: Address)]
pub struct AttestationAccount {
    /// The `quasar-escrow` account this attestation is bound to — the canonical
    /// job record, and the PDA seed.
    pub escrow: Address,
    /// Job identifier — derived from `escrow.escrow_id`, not judge-supplied
    pub job_id: [u8; 16],
    /// The judge agent's wallet
    pub judge: Address,
    /// The consumer who hired (and can confirm/dispute)
    pub consumer: Address,
    /// Quality scores: [accuracy, completeness, relevance, format, latency] each 1-10
    pub scores: [u8; 5],
    /// Resolution state: 0=Pending, 1=Confirmed, 2=Disputed
    pub confirmed: u8,
    /// Unix timestamp when account was created
    pub created_at: i64,
    /// PDA bump seed
    pub bump: u8,
    /// Alignment padding
    pub _pad: [u8; 7],
}

impl AttestationAccount {
    /// Returns the current attestation status.
    #[inline(always)]
    pub fn status(&self) -> AttestationStatus {
        AttestationStatus::from_u8(self.confirmed).unwrap_or(AttestationStatus::Pending)
    }

    /// Returns true if this attestation has been resolved (confirmed or disputed).
    #[inline(always)]
    pub fn is_resolved(&self) -> bool {
        self.confirmed != AttestationStatus::Pending as u8
    }
}
