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

    #[msg("Cancel window not elapsed (7 days required)")]
    CancelWindowNotElapsed,

    #[msg("Invalid payee")]
    InvalidPayee,

    #[msg("Model string exceeds maximum length")]
    ModelTooLong,

    #[msg("Agent is not active")]
    AgentNotActive,

    #[msg("Rating commitment already submitted")]
    AlreadyCommitted,

    #[msg("Cannot reveal until both parties commit")]
    BothMustCommitFirst,

    #[msg("Commitment hash mismatch")]
    CommitmentMismatch,

    #[msg("Score must be 1-10")]
    InvalidScore,

    #[msg("Rating has not expired")]
    NotExpired,

    #[msg("Rating already finalised")]
    AlreadyFinalised,
}
