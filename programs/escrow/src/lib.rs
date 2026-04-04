#![allow(clippy::diverging_sub_expression)] // Anchor #[program] macro false positive

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

// Program ID placeholder — will be replaced after first `anchor build` + keypair generation.
// TODO: Run `anchor keys sync` after generating a fresh deploy keypair for devnet.
declare_id!("BaDZtpgWpDx6H1y8Dga2cfyxs3RXj5y2fkBo7HoT2pdv");

#[program]
pub mod escrow {
    use super::*;

    /// Lock SOL into a trustless escrow PDA.
    /// Called by Agent A (payer) to pay Agent B (payee) via x402.
    ///
    /// # Arguments
    /// * `amount` — lamports to lock
    /// * `nonce` — 16-byte unique identifier scoped to the payer (prevents duplicate escrows)
    pub fn lock_escrow(ctx: Context<LockEscrow>, amount: u64, nonce: [u8; 16]) -> Result<()> {
        instructions::lock_escrow::lock_escrow_handler(ctx, amount, nonce)
    }

    /// Release locked SOL to the payee.
    /// Called by Agent A (payer) once services are delivered.
    /// Closes the PDA and returns rent to payer.
    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        instructions::release_escrow::release_escrow_handler(ctx)
    }

    /// Cancel escrow and refund the payer.
    /// Called by Agent A (payer) — e.g. timeout or service refused.
    /// Closes the PDA and returns rent + funds to payer.
    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        instructions::cancel_escrow::cancel_escrow_handler(ctx)
    }
}
