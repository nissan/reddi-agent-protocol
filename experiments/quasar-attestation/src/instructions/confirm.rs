/// confirm_attestation — Quasar parity port of Anchor `confirm_attestation_handler`.
///
/// Parity with Anchor version:
/// - Only the job consumer can confirm (UnauthorisedSigner parity)
/// - Cannot resolve twice (AttestationAlreadyResolved parity via is_resolved check)
/// - Sets `confirmed = Confirmed` (Some(true) in Anchor)
/// - Rewards judge: `attestation_accuracy += ATTESTATION_CONFIRM_WEIGHT` (capped at 10_000)
/// - Rolling average reputation bump treating confirmation as score=10:
///   `new = (old * 9 + 10_000) / 10` — mirrors Anchor formula exactly
///
/// Job binding: the attestation PDA is seeded by the escrow address, so
/// `escrow` is passed as a seed-only account. The consumer authorised to
/// resolve is `attestation.consumer`, which `attest` read from `escrow.payer`
/// — a judge can no longer nominate who confirms their work (CRITICAL-2).
///
/// Quasar deltas vs Anchor:
/// - `confirmed: u8` sentinel instead of `Option<bool>`.
/// - `attestation_accuracy: u16` accessed via PodU16 `.get()` / `PodU16::from()`.
/// - `reputation_score: u16` similarly.
use {
    crate::state::{AttestationAccount, AttestationStatus, AgentAccount, ATTESTATION_CONFIRM_WEIGHT},
    quasar_lang::prelude::*,
};

#[derive(Accounts)]
pub struct Confirm<'info> {
    /// Escrow address this attestation is bound to — used only as a PDA seed.
    /// CHECK: not dereferenced. The `seeds` constraint on `attestation` proves
    /// this is the escrow the attestation was bound to at attest time;
    /// `quasar-escrow` closes the escrow on settlement, so the account itself is
    /// typically gone by now.
    pub escrow: &'info UncheckedAccount,

    #[account(
        mut,
        seeds = AttestationAccount::seeds(escrow),
        bump,
    )]
    pub attestation: &'info mut Account<AttestationAccount>,

    /// Judge's AgentAccount — receives the accuracy reward and reputation bump.
    #[account(
        mut,
        seeds = AgentAccount::seeds(attestation.judge),
        bump,
    )]
    pub judge_agent: &'info mut Account<AgentAccount>,

    /// The job consumer (must match attestation.consumer)
    pub consumer: &'info Signer,
}

impl<'info> Confirm<'info> {
    #[inline(always)]
    pub fn confirm(&mut self) -> Result<(), ProgramError> {
        // Guard: only the registered consumer can confirm
        if *self.consumer.address() != self.attestation.consumer {
            return Err(ProgramError::InvalidArgument); // UnauthorisedSigner parity
        }

        // Guard: cannot resolve twice
        if self.attestation.is_resolved() {
            return Err(ProgramError::InvalidArgument); // AttestationAlreadyResolved parity
        }

        // Mark as confirmed
        self.attestation.confirmed = AttestationStatus::Confirmed as u8;

        // Reward judge's attestation_accuracy
        let old_acc = self.judge_agent.attestation_accuracy.get();
        let new_acc = old_acc.saturating_add(ATTESTATION_CONFIRM_WEIGHT).min(10_000);
        self.judge_agent.attestation_accuracy = PodU16::from(new_acc);

        // Rolling average reputation bump: confirmation treated as score=10 (10_000 scaled)
        let new_scaled: u32 = 10_000; // 10 * 1000
        let old_rep = self.judge_agent.reputation_score.get() as u32;
        let updated_rep = (old_rep * 9 + new_scaled) / 10;
        self.judge_agent.reputation_score =
            PodU16::from(updated_rep.min(10_000) as u16);

        Ok(())
    }
}
