//! Error codes. The numbers are the wire contract: custom codes start at 6000
//! in the order the Anchor program declares them, and account/constraint
//! failures use the codes Anchor's framework returns, so a client that maps
//! codes with the published IDL reads this program the same way.
//!
//! Each failure also logs one line in the shape Anchor clients parse
//! (`AnchorError occurred. Error Code: … Error Number: … Error Message: …`).
//! The lines are static strings, so reporting an error allocates nothing.
use pinocchio::error::ProgramError;

pub struct Fault {
    pub code: u32,
    line: &'static str,
}

macro_rules! faults {
    ($($name:ident = $code:literal, $msg:literal;)*) => {
        $(
            #[allow(non_upper_case_globals)]
            pub static $name: Fault = Fault {
                code: $code,
                line: concat!(
                    "AnchorError occurred. Error Code: ", stringify!($name),
                    ". Error Number: ", stringify!($code),
                    ". Error Message: ", $msg, "."
                ),
            };
        )*
    };
}

faults! {
    // Framework-level codes (same numbers as anchor-lang 1.1.2).
    InstructionFallbackNotFound = 101, "Fallback functions are not supported";
    InstructionDidNotDeserialize = 102, "The program could not deserialize the given instruction";
    ConstraintMut = 2000, "A mut constraint was violated";
    ConstraintHasOne = 2001, "A has one constraint was violated";
    ConstraintSeeds = 2006, "A seeds constraint was violated";
    ConstraintAddress = 2012, "An address constraint was violated";
    ConstraintDuplicateMutableAccount = 2040, "A duplicate mutable account constraint was violated";
    AccountDiscriminatorNotFound = 3001, "No discriminator was found on the account";
    AccountDiscriminatorMismatch = 3002, "Account discriminator did not match what was expected";
    AccountDidNotDeserialize = 3003, "Failed to deserialize the account";
    AccountNotEnoughKeys = 3005, "Not enough account keys given to the instruction";
    AccountOwnedByWrongProgram = 3007, "The given account is owned by a different program than expected";
    InvalidProgramId = 3008, "Program ID was not as expected";
    AccountNotSigner = 3010, "The given account did not sign";
    AccountNotInitialized = 3012, "The program expected this account to be already initialized";

    // Program codes of the escrow and registry instructions. The gaps belong
    // to the rating, attestation and PER codes below, or are unused.
    UnauthorisedSigner = 6000, "Unauthorised signer — only the payer can cancel";
    NotLocked = 6002, "Escrow is not in Locked state";
    ZeroAmount = 6004, "Amount must be greater than zero";
    Overflow = 6005, "Arithmetic overflow";
    CancelWindowNotElapsed = 6006, "Cancel window not elapsed: the payer cannot refund yet";
    InvalidPayee = 6007, "Invalid payee";
    ModelTooLong = 6008, "Model string exceeds maximum length";
    InvalidTokenAccount = 6023, "Invalid token mint, account, or authority";
    InvalidTokenAmount = 6024, "Token balance change did not match the escrow transfer";
    AmountAboveCap = 6025, "Amount exceeds the per-escrow cap";
    MintNotAllowed = 6026, "Token mint is not on the escrow allowlist";
    ClaimWindowNotElapsed = 6027, "Claim window not elapsed: the payee cannot claim yet";
    InvalidSettleAmount = 6028, "Settled amount must be above zero and at most the locked amount";
    NotMetered = 6029, "Only a metered escrow can be settled by the payee before the claim window";
    InvalidTreasury = 6030, "Fee must go to the protocol treasury";
    InvalidWindows = 6031, "Invalid windows: the claim window must be at least one slot, no later than the refund window, and the refund window at most 30 days";
    PayeeNotRentExempt = 6032, "Payee account would be left below the rent-exempt minimum: fund the payee first, or lock a larger amount";
}

// Rating and attestation. The first nine keep the numbers the archived Anchor
// program declares for them; the rest are new and follow 6032.
faults! {
    AlreadyCommitted = 6010, "Rating commitment already submitted";
    BothMustCommitFirst = 6011, "Cannot reveal until both parties commit";
    CommitmentMismatch = 6012, "Commitment hash mismatch";
    InvalidScore = 6013, "Score must be 1-10";
    NotExpired = 6014, "Rating has not expired";
    AlreadyFinalised = 6015, "Rating already finalised";
    NotAttestationAgent = 6016, "Agent type does not permit attestation";
    AttestationAlreadyResolved = 6018, "Attestation already resolved";
    AttestationScoreOutOfRange = 6019, "Score must be between 1 and 10";
    RatingAccountRequired = 6033, "This escrow is rated: pass its rating account, writable, after the usual accounts";
    InvalidRatingAccount = 6034, "Rating account does not belong to this escrow";
    RatingNotAwaitingSettlement = 6035, "Rating account is not awaiting the settlement of its escrow";
    RatingOptInClosed = 6036, "An escrow can be opted into rating only in the slot it was locked";
    AlreadyRated = 6037, "Escrow is already opted into rating";
    InvalidJudge = 6038, "The judge must be neither the payer nor the payee";
    JobNotPaid = 6039, "The escrow of this rating has not been paid out yet";
    CommitDeadlinePassed = 6040, "Commit deadline has passed";
    RevealDeadlinePassed = 6041, "Reveal deadline has passed";
    AlreadyRevealed = 6042, "Rating score already revealed";
    EmptyCommitment = 6043, "Commitment must not be all zero";
    RatingNotFinal = 6044, "Rating has no final result yet";
    RatedEscrowNotDelegable = 6045, "A rated escrow cannot be delegated to PER, and a delegated escrow cannot be rated";
    RatingAlreadyAccepted = 6046, "The specialist has already accepted this rating";
    AttestationNotClosable = 6047, "An unresolved attestation can be closed only after its resolution window";
    AlreadyAttested = 6048, "This job has already been attested";
    JudgeNotActive = 6049, "The judge's agent record is not active";
    RatingJustOpened = 6050, "A rated escrow cannot end in the slot its rating was opened";
    RatingJobMismatch = 6051, "The opened slot given does not match this rating: it is a different job";
    EscrowJustLocked = 6052, "An escrow cannot end in the slot it was locked in";
    EscrowInstanceMismatch = 6053, "The lock slot given does not match this escrow: it is a different escrow at the same address";
}

// Delivery check. New, after 6053.
faults! {
    DeliveryAccountRequired = 6054, "This escrow is delivery-checked: pass its delivery account, writable, after the rating account if any";
    InvalidDeliveryAccount = 6055, "Delivery account does not belong to this escrow";
    DeliveryOptInClosed = 6056, "An escrow can be opted into the delivery check only in the slot it was locked";
    AlreadyDeliveryChecked = 6057, "Escrow is already opted into the delivery check";
    InvalidDeliveryTerms = 6058, "Invalid delivery terms: the verify window must be 150 to 1512000 slots and the resolve window 1500 to 3024000";
    DeliveryJobMismatch = 6059, "The opened slot given does not match this delivery: it is a different job";
    DeliveryAlreadyRecorded = 6060, "A delivery has already been recorded for this job";
    DeliveryNotRecorded = 6061, "No delivery has been recorded: the payee cannot be paid yet";
    VerifyWindowOpen = 6062, "The payer's verify window is still open: the payee cannot be paid yet";
    DeliveryDisputed = 6063, "The delivery is disputed: only the judge can end this escrow now, or the payer after the judge's window";
    VerifyWindowClosed = 6064, "The verify window has closed: the delivery can no longer be disputed";
    DeliveryNotDisputed = 6065, "The delivery is not disputed";
    ResolveWindowClosed = 6066, "The judge's window has closed: the payer may refund";
    DeliveryDeadlinePassed = 6067, "A delivery must be recorded before the escrow's refund window opens";
    InvalidDelivery = 6068, "A delivery must name at least one unit and one byte";
    DeliveryAlreadyAccepted = 6069, "The payer has already accepted this delivery";
    DeliveryRefundNotOpen = 6070, "A delivery was recorded: the payer can refund only after the verify window and the payee's time to collect, or after the judge's window";
    InvalidResolution = 6071, "The judge's payout must be at most the locked amount";
    DeliveryEscrowNotDelegable = 6072, "A delivery-checked escrow cannot be delegated to PER";
}

// PER tracking (`per` builds only), with the archived Anchor program's numbers.
#[cfg(feature = "per")]
faults! {
    NotDelegatedToPer = 6020, "Escrow is not delegated to PER";
    PerSessionKeyMismatch = 6021, "PER session key mismatch";
    AlreadyDelegated = 6022, "Escrow is already delegated to PER";
}

/// Log the error line and turn the fault into the error the runtime reports.
#[cold]
#[inline(never)]
pub fn fail(fault: &'static Fault) -> ProgramError {
    crate::log::message(fault.line);
    ProgramError::Custom(fault.code)
}

/// `Err(fault)` unless `condition` holds.
#[inline(always)]
pub fn require(condition: bool, fault: &'static Fault) -> Result<(), ProgramError> {
    if condition {
        Ok(())
    } else {
        Err(fail(fault))
    }
}
