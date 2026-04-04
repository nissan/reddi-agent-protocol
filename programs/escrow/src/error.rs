use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Unauthorised signer — only the payer can cancel")]
    UnauthorisedSigner,

    #[msg("Duplicate nonce — escrow with this nonce already exists")]
    DuplicateNonce,

    #[msg("Escrow is not in Locked state")]
    NotLocked,

    #[msg("Escrow is already closed")]
    AlreadyClosed,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Arithmetic overflow")]
    Overflow,
}
