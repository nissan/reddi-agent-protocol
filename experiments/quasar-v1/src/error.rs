//! Same variants, in the same order, as `EscrowError` in the Anchor program, so
//! each failure returns the same custom error code as the Anchor program
//! (6000 upwards).
use quasar_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    UnauthorisedSigner = 6000,
    DuplicateNonce,
    NotLocked,
    AlreadyClosed,
    ZeroAmount,
    Overflow,
    CancelWindowNotElapsed,
    InvalidPayee,
    ModelTooLong,
    AgentNotActive,
    AlreadyCommitted,
    BothMustCommitFirst,
    CommitmentMismatch,
    InvalidScore,
    NotExpired,
    AlreadyFinalised,
    NotAttestationAgent,
    AttestationAlreadyExists,
    AttestationAlreadyResolved,
    AttestationScoreOutOfRange,
    NotDelegatedToPer,
    PerSessionKeyMismatch,
    AlreadyDelegated,
    InvalidTokenAccount,
    InvalidTokenAmount,
    AmountAboveCap,
    MintNotAllowed,
    ClaimWindowNotElapsed,
    InvalidSettleAmount,
    NotMetered,
    InvalidTreasury,
}
