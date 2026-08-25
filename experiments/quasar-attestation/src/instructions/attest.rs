/// attest_quality — Quasar port of Anchor `attest_quality_handler`, hardened
/// with escrow job binding.
///
/// # What changed and why
///
/// The pre-binding version let a judge pick any `job_id` and write any address
/// into `attestation.consumer`. That is CRITICAL-2 (the judge names an address
/// they control, then "confirms" their own attestation for the accuracy reward)
/// and CRITICAL-3 (any eligible judge can create an attestation for any job id,
/// squatting real ones) in
/// `docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md`.
///
/// This version implements the audit's recommended fix:
/// - the attestation PDA is seeded by the **escrow account address**;
/// - the escrow is passed as an `InterfaceAccount<EscrowRef>`, so the framework
///   rejects any account not owned by `quasar-escrow` with `IllegalOwner`;
/// - `consumer` is **read from** `escrow.payer`, and the judge-supplied
///   `consumer` argument is removed;
/// - `job_id` is derived from `escrow.escrow_id`.
///
/// Attestation creation is therefore bounded by escrows actually locked, at real
/// lamport cost, and the confirming party is fixed by the job rather than chosen
/// by the judge.
///
/// Parity retained from the Anchor version:
/// - `init` enforces one attestation per job (now per escrow)
/// - judge agent type must be `Attestation` or `Both` (NotAttestationAgent)
/// - all scores in range 1-10 (AttestationScoreOutOfRange)
///
/// Quasar deltas vs Anchor:
/// - `confirmed: u8` (sentinel) instead of `Option<bool>`.
/// - `judge_agent` derived from the judge signer in seeds; read-only.
use {
    crate::state::{AgentAccount, AttestationAccount, AttestationAccountInner, AttestationStatus},
    quasar_escrow_ref::EscrowRef,
    quasar_lang::{
        prelude::*,
        sysvars::{clock::Clock, Sysvar as _},
    },
};

#[derive(Accounts)]
pub struct Attest<'info> {
    /// The `quasar-escrow` escrow account — the canonical job record.
    ///
    /// Read-only. `InterfaceAccount` validates the owner against
    /// `EscrowRef::owners()` (the pinned `quasar-escrow` program ID) and the
    /// discriminator via `AccountCheck`, so a look-alike account the judge owns
    /// is rejected before any field is read.
    pub escrow: &'info InterfaceAccount<EscrowRef>,

    /// Attestation PDA — `init` enforces one-per-job dedup, and the escrow seed
    /// means "per job" is now anchored to a real escrow.
    #[account(
        init,
        payer = judge,
        seeds = AttestationAccount::seeds(escrow),
        bump,
    )]
    pub attestation: &'info mut Account<AttestationAccount>,

    /// Judge's AgentAccount — must be Attestation or Both.
    /// Read-only; no mutation during attest.
    #[account(
        seeds = AgentAccount::seeds(judge),
        bump,
    )]
    pub judge_agent: &'info Account<AgentAccount>,

    pub judge: &'info mut Signer,

    pub system_program: &'info Program<System>,
}

impl<'info> Attest<'info> {
    #[inline(always)]
    pub fn attest(&mut self, scores: [u8; 5], bumps: &AttestBumps) -> Result<(), ProgramError> {
        // Guard: judge must be Attestation or Both
        if !self.judge_agent.is_attestation_eligible() {
            return Err(ProgramError::InvalidArgument); // NotAttestationAgent parity
        }

        // Guard: all scores must be in range 1-10
        for &s in scores.iter() {
            if !(1..=10).contains(&s) {
                return Err(ProgramError::InvalidArgument); // AttestationScoreOutOfRange parity
            }
        }

        // The consumer comes from the escrow, never from the judge. This is the
        // job binding, and it is what closes CRITICAL-2: the judge can no longer
        // nominate the address that will confirm their work.
        let judge_addr = *self.judge.address();
        let consumer = self.escrow.payer;
        let specialist = self.escrow.payee;

        // Defence in depth, retained from the pre-binding remediation: a judge
        // must never be the party who confirms their own attestation.
        if consumer == judge_addr {
            return Err(ProgramError::InvalidArgument);
        }

        // A judge must not grade their own work either — now checkable, because
        // the escrow tells us who performed the job.
        if specialist == judge_addr {
            return Err(ProgramError::InvalidArgument);
        }

        // Guard: a self-dealt escrow is not a job (mirrors quasar-reputation).
        if consumer == specialist {
            return Err(ProgramError::InvalidArgument);
        }

        let clock = Clock::get()?;
        let job_id = self.escrow.escrow_id.get() as u128;

        self.attestation.set_inner(AttestationAccountInner {
            escrow: *self.escrow.to_account_view().address(),
            job_id: job_id.to_le_bytes(),
            judge: judge_addr,
            consumer,
            scores,
            confirmed: AttestationStatus::Pending as u8,
            created_at: clock.unix_timestamp.get(),
            bump: bumps.attestation,
            _pad: [0u8; 7],
        });

        Ok(())
    }
}
