/// commit_rating — Quasar port of Anchor `commit_rating_handler`, hardened with
/// escrow job binding.
///
/// # What changed and why
///
/// The pre-binding version took `job_id`, `consumer_pk` and `specialist_pk` as
/// caller-supplied arguments and seeded the rating PDA on `job_id` alone. That
/// let anyone create a rating naming any two parties — CRITICAL-1 (rating-PDA
/// squatting) and, in combination with `expire`, CRITICAL-4 (reputation grief)
/// in `docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md`.
///
/// This version implements the audit's recommended strong fix:
/// - the rating PDA is seeded by the **escrow account address**;
/// - the escrow is passed as an `InterfaceAccount<EscrowRef>`, so the framework
///   rejects any account not owned by `quasar-escrow` with `IllegalOwner`;
/// - `consumer` and `specialist` are **read from** `escrow.payer` / `escrow.payee`;
/// - the `job_id`, `consumer_pk` and `specialist_pk` arguments are gone entirely,
///   so there is no caller-controlled job identity left to forge.
///
/// A rating therefore cannot exist without a real escrow, and a signer can only
/// take the role that the escrow already assigns them.
///
/// # Ordering
///
/// `quasar-escrow::release` and `::cancel` both close the escrow account, so the
/// escrow only exists while `Locked`. Commits are therefore made against a live
/// escrow — lock → commit → release → reveal. `reveal` and `expire` need the
/// escrow address only as a PDA seed, not as a live account.
///
/// Other Quasar deltas vs Anchor:
/// - `init_if_needed` supported natively; first-call detection via a zero `escrow` field.
/// - `RatingRole` passed as `u8` (0=Consumer, 1=Specialist) instead of an enum.
use {
    crate::{
        escrow_ref::EscrowRef,
        state::{RatingAccount, RatingAccountInner, RatingState},
    },
    quasar_lang::{
        prelude::*,
        sysvars::{clock::Clock, Sysvar as _},
    },
};

#[derive(Accounts)]
pub struct Commit<'info> {
    /// The `quasar-escrow` escrow account — the canonical job record.
    ///
    /// Read-only. `InterfaceAccount` validates the owner against
    /// `EscrowRef::owners()` (the pinned `quasar-escrow` program ID) and the
    /// discriminator via `AccountCheck`, so a self-owned look-alike is rejected
    /// before any field is read.
    pub escrow: &'info InterfaceAccount<EscrowRef>,

    /// Rating PDA — created on first call, reused on the second.
    /// Seeded by the escrow address, so exactly one rating exists per job.
    #[account(
        init_if_needed,
        payer = signer,
        seeds = RatingAccount::seeds(escrow),
        bump,
    )]
    pub rating: &'info mut Account<RatingAccount>,

    /// Must be the escrow's payer (role 0) or payee (role 1).
    pub signer: &'info mut Signer,

    pub system_program: &'info Program<System>,
}

impl<'info> Commit<'info> {
    #[inline(always)]
    pub fn commit(
        &mut self,
        commitment: [u8; 32],
        role: u8, // 0 = Consumer, 1 = Specialist
        bumps: &CommitBumps,
    ) -> Result<(), ProgramError> {
        let signer_addr = *self.signer.address();
        let clock = Clock::get()?;

        // Guard: reject role values other than 0/1
        if role > 1 {
            return Err(ProgramError::InvalidArgument);
        }

        // Guard: zero commitment is the uncommitted sentinel in RatingAccount.
        // Accepting it lets a user believe they committed while expiry logic
        // still treats them as absent.
        if commitment == [0u8; 32] {
            return Err(ProgramError::InvalidArgument);
        }

        // Parties come from the escrow, never from the caller. This is the
        // job binding: `escrow` has already been owner- and discriminator-checked
        // by `InterfaceAccount`, so these are the real job's parties.
        let consumer_addr = self.escrow.payer;
        let specialist_addr = self.escrow.payee;

        // Guard: a self-dealt escrow is not a job. Cheap partial mitigation of
        // HIGH-3 (reputation laundering) — it does not stop a payer using a
        // second wallet they control, which needs an economic answer.
        if consumer_addr == specialist_addr {
            return Err(ProgramError::InvalidArgument);
        }

        // Guard: reject if already finalised (Revealed or Expired)
        let current_state = self.rating.rating_state();
        if current_state == RatingState::Revealed || current_state == RatingState::Expired {
            return Err(ProgramError::InvalidArgument); // AlreadyFinalised
        }

        // On first commit: initialise metadata from the escrow.
        // Detection: `escrow` is all-zero only when `init_if_needed` has just
        // allocated the account. A real escrow address is never all-zero.
        let zero_addr = Address::new_from_array([0u8; 32]);
        if self.rating.escrow == zero_addr {
            let job_id = self.escrow.escrow_id.get() as u128;
            self.rating.set_inner(RatingAccountInner {
                escrow: *self.escrow.to_account_view().address(),
                job_id: job_id.to_le_bytes(),
                consumer: consumer_addr,
                specialist: specialist_addr,
                consumer_commitment: [0u8; 32],
                specialist_commitment: [0u8; 32],
                consumer_score: 0,
                specialist_score: 0,
                state: RatingState::Pending as u8,
                _pad: 0,
                created_at: clock.unix_timestamp.get(),
                created_slot: clock.slot.get(),
                bump: bumps.rating,
                _pad2: [0u8; 7],
            });
        }

        // Apply the commitment for the given role. The signer must hold that
        // role on the escrow — an attacker cannot elect themselves specialist.
        match role {
            // Consumer
            0 => {
                if signer_addr != self.rating.consumer {
                    return Err(ProgramError::InvalidArgument); // UnauthorisedSigner
                }
                if self.rating.consumer_committed() {
                    return Err(ProgramError::InvalidArgument); // AlreadyCommitted
                }
                self.rating.consumer_commitment = commitment;
            }
            // Specialist
            1 => {
                if signer_addr != self.rating.specialist {
                    return Err(ProgramError::InvalidArgument); // UnauthorisedSigner
                }
                if self.rating.specialist_committed() {
                    return Err(ProgramError::InvalidArgument); // AlreadyCommitted
                }
                self.rating.specialist_commitment = commitment;
            }
            _ => unreachable!(),
        }

        // Advance to BothCommitted when both commitments are set
        if self.rating.consumer_committed() && self.rating.specialist_committed() {
            self.rating.state = RatingState::BothCommitted as u8;
        }

        Ok(())
    }
}
