export declare const SPL_TRANSFER_CHECKED_OBSERVATION_SCHEMA_VERSION: "reddi.svm-spl-transfer-checked-observation.v1";
export declare const SPL_TRANSFER_CHECKED_OBSERVER_VERSION: "reddi.x402-solana.spl-transfer-checked-observer.v1";
export declare const SPL_TOKEN_PROGRAM_ID: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export declare const TOKEN_2022_PROGRAM_ID: "TokenzQdBNbLqP5VEhdkAS6EP8pNJGvvnzQ74d7Gkwb";
export declare const SPL_MEMO_PROGRAM_ID: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export type SplTransferCheckedCommitment = 'confirmed' | 'finalized';
export type SplTransferCheckedObservationFailureReason = 'malformed_expected_payment' | 'missing_transaction' | 'failed_transaction' | 'missing_confirmation_metadata' | 'wrong_signature' | 'no_transfer_checked' | 'wrong_token_program' | 'wrong_mint' | 'wrong_amount' | 'wrong_payee' | 'wrong_destination' | 'wrong_decimals' | 'wrong_authority' | 'duplicate_matching_transfer' | 'missing_memo' | 'memo_mismatch' | 'replay_detected';
export type SplTransferCheckedExpectedPayment = {
    network: string;
    signature: string;
    mint: string;
    tokenProgram: string;
    payTo: string;
    amountBaseUnits: string;
    destinationTokenAccount?: string;
    authority?: string;
    decimals?: number;
    memo?: string;
    memoRequired?: boolean;
    paymentIntentId?: string;
};
export type SplTransferCheckedObservation = {
    schemaVersion: typeof SPL_TRANSFER_CHECKED_OBSERVATION_SCHEMA_VERSION;
    verifierVersion: typeof SPL_TRANSFER_CHECKED_OBSERVER_VERSION | string;
    network: string;
    signature: string;
    slot: number;
    blockTime: number;
    commitment: SplTransferCheckedCommitment;
    instructionIndex: string;
    innerInstruction: boolean;
    sourceTokenAccount?: string;
    destinationTokenAccount: string;
    destinationOwner: string;
    authority?: string;
    mint: string;
    tokenProgram: string;
    amountBaseUnits: string;
    decimals?: number;
    memo?: string;
    paymentIntentId?: string;
    evidence: {
        source: 'parsed-transaction-fixture' | 'parsed-rpc-transaction';
        grantEligible: false | 'pending_partner_acceptance' | true;
    };
};
export type SplTransferReplayStore = {
    checkAndStore(key: string): boolean | Promise<boolean>;
};
export type VerifySplTransferCheckedObservationInput = {
    parsedTransaction: unknown;
    expected: SplTransferCheckedExpectedPayment;
    commitment: SplTransferCheckedCommitment;
    replayStore?: SplTransferReplayStore;
    evidenceSource?: SplTransferCheckedObservation['evidence']['source'];
    grantEligible?: SplTransferCheckedObservation['evidence']['grantEligible'];
    verifierVersion?: string;
};
export type VerifySplTransferCheckedObservationResult = {
    ok: true;
    observation: SplTransferCheckedObservation;
} | {
    ok: false;
    reason: SplTransferCheckedObservationFailureReason;
    message: string;
    expected?: unknown;
    actual?: unknown;
};
export declare function verifySplTransferCheckedObservation(input: VerifySplTransferCheckedObservationInput): Promise<VerifySplTransferCheckedObservationResult>;
