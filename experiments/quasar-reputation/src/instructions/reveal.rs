/// reveal_rating — Quasar parity port of Anchor `reveal_rating_handler`.
///
/// Parity with Anchor version:
/// - Must be in BothCommitted state
/// - Score must be 1-10
/// - Verifies the domain-separated sha256 commitment matches the stored one
/// - Records revealed score
/// - When both parties have revealed: finalises rating, applies rolling reputation update
///
/// Job binding (see `docs/QUASAR-JOB-BINDING-DESIGN-2026-08-24.md`):
/// - The rating PDA is seeded by the escrow address, so `escrow` is passed here
///   purely as a seed. It is an `UncheckedAccount`, not an
///   `InterfaceAccount<EscrowRef>`, because `quasar-escrow::release` closes the
///   escrow on settlement — by reveal time the account is usually gone. No trust
///   is placed in it: the PDA constraint proves the passed address is the one
///   this rating was bound to at commit time, and `rating.escrow` records it.
/// - The commitment pre-image is domain-separated on the **escrow address**
///   rather than a caller-chosen `job_id`. The escrow address is globally unique
///   and unforgeable, so commitments cannot be replayed across jobs.
///
/// Quasar deltas vs Anchor:
/// - `consumer_score`/`specialist_score` use `u8` sentinel (0=unrevealed) instead of `Option<u8>`
/// - `sha2` crate used for SHA-256 (same as Anchor)
/// - `Clock` sysvar not required for reveal (matching Anchor)
use {
    crate::state::{apply_reputation_update, AgentAccount, RatingAccount, RatingState},
    quasar_lang::prelude::*,
    sha2::{Digest, Sha256},
};

#[derive(Accounts)]
pub struct Reveal<'info> {
    /// Escrow address this rating is bound to — used only as a PDA seed.
    /// CHECK: not dereferenced. The `seeds`/`bump` constraint on `rating` below
    /// proves this is the escrow the rating was bound to at commit time; the
    /// account itself is typically closed by then.
    pub escrow: &'info UncheckedAccount,

    #[account(
        mut,
        seeds = RatingAccount::seeds(escrow),
        bump = rating.bump,
    )]
    pub rating: &'info mut Account<RatingAccount>,

    pub signer: &'info Signer,

    /// Specialist AgentAccount — receives consumer's rating score
    #[account(
        mut,
        seeds = AgentAccount::seeds(rating.specialist),
        bump = specialist_agent.bump,
    )]
    pub specialist_agent: &'info mut Account<AgentAccount>,

    /// Consumer AgentAccount — receives specialist's rating score
    #[account(
        mut,
        seeds = AgentAccount::seeds(rating.consumer),
        bump = consumer_agent.bump,
    )]
    pub consumer_agent: &'info mut Account<AgentAccount>,
}

impl<'info> Reveal<'info> {
    #[inline(always)]
    pub fn reveal(&mut self, score: u8, salt: [u8; 32]) -> Result<(), ProgramError> {
        let signer_addr = *self.signer.address();

        // Guard: must be in BothCommitted state
        if self.rating.rating_state() != RatingState::BothCommitted {
            return Err(ProgramError::InvalidArgument); // BothMustCommitFirst
        }

        // Guard: score must be 1-10
        if score < 1 || score > 10 {
            return Err(ProgramError::InvalidArgument); // InvalidScore
        }

        // Domain-separated commitment: score || salt || escrow_address || program_id.
        // Seeding the pre-image on the escrow address (rather than a caller-chosen
        // job_id) makes cross-job commitment reuse impossible — the address is
        // unique per job and cannot be chosen by an attacker. The program id keeps
        // commitments from being replayed against a different deployment.
        let mut hasher = Sha256::new();
        hasher.update([score]);
        hasher.update(salt);
        hasher.update(self.escrow.to_account_view().address().as_ref());
        hasher.update(crate::ID.as_ref());
        let computed: [u8; 32] = hasher.finalize().into();

        let is_consumer = signer_addr == self.rating.consumer;
        let is_specialist = signer_addr == self.rating.specialist;

        if is_consumer {
            if computed != self.rating.consumer_commitment {
                return Err(ProgramError::InvalidArgument); // CommitmentMismatch
            }
            self.rating.consumer_score = score;
        } else if is_specialist {
            if computed != self.rating.specialist_commitment {
                return Err(ProgramError::InvalidArgument); // CommitmentMismatch
            }
            self.rating.specialist_score = score;
        } else {
            return Err(ProgramError::InvalidArgument); // UnauthorisedSigner
        }

        // Both revealed → finalise and apply reputation updates
        if self.rating.consumer_revealed() && self.rating.specialist_revealed() {
            self.rating.state = RatingState::Revealed as u8;

            // Update specialist's reputation based on consumer's score
            let consumer_given = self.rating.consumer_score;
            apply_reputation_update(self.specialist_agent, consumer_given);

            // Update consumer's reputation based on specialist's score
            let specialist_given = self.rating.specialist_score;
            apply_reputation_update(self.consumer_agent, specialist_given);
        }

        Ok(())
    }
}
