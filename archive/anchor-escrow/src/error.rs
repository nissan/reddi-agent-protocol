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

    #[msg("Cancel window not elapsed: the payer cannot refund yet")]
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

    #[msg("Agent type does not permit attestation")]
    NotAttestationAgent,

    #[msg("Attestation already exists for this job")]
    AttestationAlreadyExists,

    #[msg("Attestation already resolved")]
    AttestationAlreadyResolved,

    #[msg("Score must be between 1 and 10")]
    AttestationScoreOutOfRange,

    #[msg("Escrow is not delegated to PER")]
    NotDelegatedToPer,

    #[msg("PER session key mismatch")]
    PerSessionKeyMismatch,

    #[msg("Escrow is already delegated to PER")]
    AlreadyDelegated,
    #[msg("Invalid token mint, account, or authority")]
    InvalidTokenAccount,

    #[msg("Token balance change did not match the escrow transfer")]
    InvalidTokenAmount,

    // New codes are appended so existing numbers never change.
    #[msg("Amount exceeds the per-escrow cap")]
    AmountAboveCap,

    #[msg("Token mint is not on the escrow allowlist")]
    MintNotAllowed,

    #[msg("Claim window not elapsed: the payee cannot claim yet")]
    ClaimWindowNotElapsed,

    #[msg("Settled amount must be above zero and at most the locked amount")]
    InvalidSettleAmount,

    #[msg("Only a metered escrow can be settled by the payee before the claim window")]
    NotMetered,

    #[msg("Fee must go to the protocol treasury")]
    InvalidTreasury,

    #[msg("Invalid windows: the claim window must be at least one slot, no later than the refund window, and the refund window at most 30 days")]
    InvalidWindows,
}
