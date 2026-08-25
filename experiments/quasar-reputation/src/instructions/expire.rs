/// expire_rating — Quasar parity port of Anchor `expire_rating_handler`.
///
/// Parity with Anchor version:
/// - Only Pending ratings can expire
/// - Time-lock: must have waited >= RATING_EXPIRE_SLOTS from creation slot
/// - Penalises the party that did NOT commit (reputation decrease + jobs_failed++)
/// - Either party (consumer or specialist) can trigger expiry
///
/// Job binding (see `docs/QUASAR-JOB-BINDING-DESIGN-2026-08-24.md`):
/// - The rating PDA is seeded by the escrow address, so `escrow` is passed here
///   purely as a seed and is never dereferenced. `quasar-escrow` closes the
///   escrow on release or cancel, so by expiry time the account is usually gone.
///
/// Residual risk — CRITICAL-4 is mitigated, not eliminated. `quasar-escrow::lock`
/// accepts an unsigned, unchecked `payee`, so a payer can name a wallet that
/// never consented and open a rating against it. Binding raises the cost of the
/// grief from rating rent (~1500 lamports) to a real locked escrow held for the
/// full expiry window, but does not remove it. Closing it needs payee consent at
/// lock time or a two-signature rating open — tracked in the design doc.
///
/// Quasar deltas vs Anchor:
/// - Clock acquired via `Clock::get()` syscall (same semantic as Anchor)
/// - Penalty applied via `saturating_sub` on `u16` score (identical to Anchor)
use {
    crate::state::{AgentAccount, RatingAccount, RatingState, RATING_EXPIRE_PENALTY, RATING_EXPIRE_SLOTS},
    quasar_lang::{
        prelude::*,
        pod::{PodU16, PodU64},
        sysvars::{clock::Clock, Sysvar as _},
    },
};

#[derive(Accounts)]
pub struct Expire<'info> {
    /// Escrow address this rating is bound to — used only as a PDA seed.
    /// CHECK: not dereferenced; the `seeds`/`bump` constraint on `rating` proves
    /// this is the escrow the rating was bound to at commit time.
    pub escrow: &'info UncheckedAccount,

    #[account(
        mut,
        seeds = RatingAccount::seeds(escrow),
        bump = rating.bump,
    )]
    pub rating: &'info mut Account<RatingAccount>,

    /// Either consumer or specialist may trigger expiry.
    pub caller: &'info Signer,

    /// Specialist AgentAccount — may be penalised.
    #[account(
        mut,
        seeds = AgentAccount::seeds(rating.specialist),
        bump = specialist_agent.bump,
    )]
    pub specialist_agent: &'info mut Account<AgentAccount>,

    /// Consumer AgentAccount — may be penalised.
    #[account(
        mut,
        seeds = AgentAccount::seeds(rating.consumer),
        bump = consumer_agent.bump,
    )]
    pub consumer_agent: &'info mut Account<AgentAccount>,
}

impl<'info> Expire<'info> {
    #[inline(always)]
    pub fn expire(&mut self) -> Result<(), ProgramError> {
        let clock = Clock::get()?;

        // Guard: only Pending ratings can expire
        if self.rating.rating_state() != RatingState::Pending {
            return Err(ProgramError::InvalidArgument); // AlreadyFinalised
        }

        // Guard: only one of the recorded parties may trigger expiry.
        let caller_addr = *self.caller.address();
        if caller_addr != self.rating.consumer && caller_addr != self.rating.specialist {
            return Err(ProgramError::InvalidArgument);
        }

        // Time-lock: must have waited at least RATING_EXPIRE_SLOTS
        let elapsed = clock.slot.get().saturating_sub(self.rating.created_slot.get());
        if elapsed < RATING_EXPIRE_SLOTS {
            return Err(ProgramError::InvalidArgument); // NotExpired
        }

        self.rating.state = RatingState::Expired as u8;

        let consumer_committed = self.rating.consumer_committed();
        let specialist_committed = self.rating.specialist_committed();

        if consumer_committed && !specialist_committed {
            // Specialist ghosted — penalise specialist
            let new_rep = self.specialist_agent.reputation_score.get()
                .saturating_sub(RATING_EXPIRE_PENALTY);
            self.specialist_agent.reputation_score = PodU16::from(new_rep);
            let new_failed = self.specialist_agent.jobs_failed.get().saturating_add(1);
            self.specialist_agent.jobs_failed = PodU64::from(new_failed);
        } else if specialist_committed && !consumer_committed {
            // Consumer ghosted — penalise consumer
            let new_rep = self.consumer_agent.reputation_score.get()
                .saturating_sub(RATING_EXPIRE_PENALTY);
            self.consumer_agent.reputation_score = PodU16::from(new_rep);
            let new_failed = self.consumer_agent.jobs_failed.get().saturating_add(1);
            self.consumer_agent.jobs_failed = PodU64::from(new_failed);
        }
        // If neither committed (shouldn't happen in Pending state), no penalty.

        Ok(())
    }
}
