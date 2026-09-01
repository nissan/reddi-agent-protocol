use anchor_lang::prelude::*;

use crate::constants::ESCROW_SEED;
use crate::error::EscrowError;
use crate::state::{EscrowAccount, EscrowStatus};

/// Mark an escrow as delegated to a MagicBlock PER session.
///
/// Delegation itself remains handled TypeScript-side via `@magicblock-labs/ephemeral-rollups-sdk`.
/// The Anchor 1.1.2 stable upgrade does not move MagicBlock SDK ownership into Rust;
/// requalify that separately before changing the PER architecture.
/// This instruction records the delegation state and the session key issued by
/// the TEE so downstream instructions can validate the PER path.
///
/// Callable only by the payer (same auth as `release_escrow`).
/// Escrow must be Locked; already-delegated escrows are rejected.
pub fn delegate_escrow_handler(ctx: Context<DelegateEscrow>, session_key: Pubkey) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;

    require!(
        escrow.status == EscrowStatus::Locked,
        EscrowError::NotLocked
    );

    require!(!escrow.delegated_to_per, EscrowError::AlreadyDelegated);

    escrow.delegated_to_per = true;
    escrow.per_session_key = Some(session_key);

    msg!(
        "Escrow delegated to PER: escrow={}, session_key={}",
        ctx.accounts.escrow.key(),
        session_key,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct DelegateEscrow<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, payer.key().as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump,
        has_one = payer @ EscrowError::UnauthorisedSigner,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,
}
