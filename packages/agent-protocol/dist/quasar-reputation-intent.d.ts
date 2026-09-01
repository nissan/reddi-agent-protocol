import { type OffchainReputationPreview } from './offchain-reputation-preview.js';
import { QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION, type QuasarRegistryCompatibilityReport } from './quasar-registry-compatibility.js';
import { type ReceiptEvidenceBinding } from './receipt-evidence-binding.js';
import type { RailNeutralPaymentReceipt } from './rail-neutral-payment-receipts.js';
/**
 * `reddi.quasar-reputation-intent.v1` — Quasar-backed reputation instruction
 * fixture gate (#443).
 *
 * Deterministic, fixture-level mapping from eligible reputation/attestation
 * records (a validated `reddi.receipt-evidence-binding.v1` plus the #390
 * `reddi.quasar-registry-compatibility.v1` report, optionally cross-checked
 * against the #394 `reddi.offchain-reputation-preview.v1` read-model) to
 * commit / reveal / confirm / dispute INTENT records for the Quasar
 * reputation and attestation program lanes.
 *
 * These are plain data records, never senders. Every record carries
 * `instructionBuilt: false` and `signable: false`; nothing in this module
 * touches a wallet, an RPC endpoint's client, a program deploy path, a live
 * payment, or reputation state. Values that only a later checklist-gated
 * builder issue may produce (salt, the commitment hash, `u8` encodings, the
 * verified escrow address, and the escrow-seeded PDA/signer accounts) are
 * named in `deferredToInstructionBuilder` — split into `instructionData` and
 * `accountInputs` — and are never fabricated here; see
 * `docs/QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md` (#441).
 *
 * Field-split discipline (#390 / `docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`):
 * intent records carry compact on-chain argument shapes only; rich RAP/ARD
 * metadata (evidence, attestation, preview, payment proof) stays off-chain
 * and is referenced by id in `offchainRefs`.
 */
export declare const QUASAR_REPUTATION_INTENT_SCHEMA_VERSION: "reddi.quasar-reputation-intent.v1";
/**
 * Compact-field contract for the two Quasar program lanes this gate maps
 * into, mirroring the parity ports under `experiments/quasar-reputation` and
 * `experiments/quasar-attestation`. Documentation only: the discriminators
 * and argument names describe the target interface; nothing here encodes,
 * serializes, or dispatches them. `deploymentsRef` is a repo-relative
 * pointer, not a deployment claim by this module.
 *
 * Source compatibility is tracked separately from deployment compatibility:
 * the field/account/commitment shape describes the current repository sources,
 * while `recordedDevnetDeployment` records that the deployment named by
 * `deploymentsRef` is pre-job-binding and unusable.
 */
export declare const QUASAR_REPUTATION_INTENT_COMPATIBILITY: {
    readonly compatibilitySchemaVersion: "reddi.quasar-registry-compatibility.v1";
    readonly compatibilityIssue: 390;
    readonly promotionChecklistIssue: 441;
    readonly deploymentsRef: "config/quasar/deployments.json";
    readonly boundariesDocRef: "docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md";
    readonly programs: {
        readonly reputation: {
            readonly lane: "quasar-reputation";
            readonly role: "blind commit-reveal rating";
            readonly instructionDiscriminators: {
                readonly commit: 1;
                readonly reveal: 2;
                readonly expire: 3;
            };
        };
        readonly attestation: {
            readonly lane: "quasar-attestation";
            readonly role: "judge attestation response";
            readonly instructionDiscriminators: {
                readonly attest: 1;
                readonly confirm: 2;
                readonly dispute: 3;
            };
        };
    };
    readonly scoreRange: {
        readonly min: 1;
        readonly max: 10;
    };
    readonly scoreSource: "reputationEventDraft.rubricScore (0-100) scaled to 1-10";
    readonly commitmentContract: "sha256(score||salt||escrow_address||program_id)";
    readonly jobBinding: "escrow-address";
    readonly onchainFieldNames: {
        readonly commit: readonly ["commitment", "role"];
        readonly reveal: readonly ["score", "salt"];
        readonly confirm: readonly [];
        readonly dispute: readonly [];
    };
    readonly onchainAccountNames: {
        readonly commit: readonly ["escrow", "rating", "signer", "system_program"];
        readonly reveal: readonly ["escrow", "rating", "signer", "specialist_agent", "consumer_agent"];
        readonly attest: readonly ["escrow", "attestation", "judge_agent", "judge", "system_program"];
        readonly confirm: readonly ["escrow", "attestation", "judge_agent", "consumer"];
        readonly dispute: readonly ["escrow", "attestation", "judge_agent", "consumer"];
    };
    readonly pdaSeeds: {
        readonly rating: readonly ["rating", "escrow_address"];
        readonly attestation: readonly ["attestation", "escrow_address"];
    };
    /**
     * Source compatibility only. This block mirrors the current
     * `experiments/quasar-*` sources; it is NOT a statement about any deployed
     * program. See `recordedDevnetDeployment` below.
     */
    readonly compatibilityScope: "repository-sources-only";
    /**
     * The Quasar programs recorded in `config/quasar/deployments.json` predate the
     * job-binding rework described above and expect the older caller-supplied
     * `job_id` layout. They are incompatible with this contract and must not be
     * used. Source compatibility above is not deployment compatibility.
     */
    readonly recordedDevnetDeployment: {
        readonly status: "incompatible-pre-job-binding";
        readonly usable: false;
        readonly reason: "Recorded devnet Quasar programs expect sha256(score||salt||job_id||program_id) with caller-supplied job_id/consumer_pk/specialist_pk and job_id-seeded PDAs. They predate the escrow-address job binding this contract describes.";
        readonly remediation: "Exercise Quasar only on a local Surfpool lane against locally built current-source programs (npm run test:surfpool:quasar-critical). No redeploy is claimed.";
    };
    readonly offchainFieldNames: readonly ["bindingId", "receiptId", "evidenceId", "evidenceHash", "evidenceRef", "paymentProofRef", "attestationId", "reputationEventDraftId", "previewId", "compatibilityListingId"];
};
export type QuasarReputationIntentKind = 'commit' | 'reveal' | 'confirm' | 'dispute';
export type QuasarReputationIntentStatus = 'intent_ready' | 'blocked';
export type QuasarReputationIntentReasonCode = 'intent_ready' | 'fixture_intent_only' | 'instruction_not_built' | 'buyer_facing_claim_disabled' | 'missing_intent_id' | 'malformed_intent' | 'malformed_binding' | 'malformed_source_metadata' | 'missing_source_ref' | 'unsafe_live_guardrail' | 'missing_quasar_compatibility' | 'quasar_compatibility_blocked' | 'compatibility_subject_mismatch' | 'policy_denied' | 'payment_preflight_denied' | 'missing_payment_proof' | 'missing_evidence' | 'missing_attestation' | 'non_final_state_excluded' | 'failure_final_excluded' | 'attestation_state_excluded' | 'probe_only_receipt_excluded' | 'rail_neutral_bridge_required' | 'unsupported_network_asset' | 'preview_not_ready' | 'preview_mismatch' | 'missing_reputation_draft' | 'no_eligible_intent';
/**
 * One fixture-level intent record: the compact Quasar-side argument shape for
 * a single instruction lane, plus by-reference pointers to the off-chain
 * evidence that justifies it. Never a sender, never signable.
 */
export type QuasarReputationIntentRecord = {
    schemaVersion: typeof QUASAR_REPUTATION_INTENT_SCHEMA_VERSION;
    kind: QuasarReputationIntentKind;
    program: {
        lane: 'quasar-reputation' | 'quasar-attestation';
        /** Repo-relative pointer to the deployment inventory; not a deployment claim. */
        deploymentsRef: typeof QUASAR_REPUTATION_INTENT_COMPATIBILITY.deploymentsRef;
        instructionName: QuasarReputationIntentKind;
        discriminator: 1 | 2 | 3;
    };
    /**
     * Compact instruction-data values that are derivable from the eligible
     * records today. Everything else is named in `deferredToInstructionBuilder`.
     */
    compactFields: {
        /**
         * Off-chain RAP correlation only, never an instruction argument: the
         * post-job-binding programs dropped the caller-supplied `job_id`. On-chain
         * job identity lives in `escrowBinding`.
         */
        jobIdRef: string;
        /** Rating party for commit intents (the `role: u8` mapping is deferred). */
        role?: 'consumer';
        /** 1-10 score scaled from the reputation event draft rubric score. */
        score?: number;
        /** Commitment described by contract only — nothing is computed here. */
        commitment?: {
            algorithm: 'sha256';
            preimageFields: readonly ['score', 'salt', 'escrow_address', 'program_id'];
            state: 'not_computed';
        };
    };
    /**
     * On-chain job identity under the current sources. There is no
     * caller-supplied job id: the escrow account address *is* the job key, it
     * must come from a verified escrow that `quasar-escrow::lock` actually
     * created, and each lane PDA is seeded by it. This module resolves nothing
     * here — the address is a builder input listed in
     * `deferredToInstructionBuilder.accountInputs`.
     */
    escrowBinding: {
        source: 'verified-lock-created-escrow';
        /** Lane PDA seeds, keyed on the escrow address rather than a job id. */
        pdaSeeds: readonly ['rating' | 'attestation', 'escrow_address'];
        state: 'not_resolved';
    };
    /**
     * Inputs a later Surfpool-checklist-gated issue (#441 boundary) must produce
     * before any instruction exists, split by where they land in a transaction.
     * This module never fabricates them.
     */
    deferredToInstructionBuilder: {
        /** Instruction-data arguments of the current source ABI. */
        instructionData: readonly string[];
        /** Account and signer inputs, mirroring `onchainAccountNames`. */
        accountInputs: readonly string[];
    };
    /** Rich RAP/ARD metadata stays off-chain; referenced by id only. */
    offchainRefs: {
        bindingId: string;
        receiptId: string;
        evidenceId: string;
        evidenceHash: string;
        evidenceRef: string;
        paymentProofRef: string;
        attestationId: string;
        reputationEventDraftId?: string;
        previewId?: string;
        compatibilityListingId?: string;
    };
    instructionBuilt: false;
    signable: false;
};
export type QuasarReputationIntentLaneState = {
    kind: QuasarReputationIntentKind;
    eligible: boolean;
    reasonCodes: QuasarReputationIntentReasonCode[];
};
export type QuasarReputationIntentPlan = {
    schemaVersion: typeof QUASAR_REPUTATION_INTENT_SCHEMA_VERSION;
    id: string;
    status: QuasarReputationIntentStatus;
    subject: OffchainReputationPreview['subject'];
    source: ReceiptEvidenceBinding['source'];
    compatibility: {
        schemaVersion: typeof QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION;
        issue: 390;
        registrationStatus?: QuasarRegistryCompatibilityReport['registrationStatus'];
        listingId?: string;
    };
    lanes: QuasarReputationIntentLaneState[];
    /** Eligible intent records only; empty whenever the plan is blocked. */
    intents: QuasarReputationIntentRecord[];
    evidenceSummary: {
        bindingId: string;
        receiptId: string;
        evidenceId: string;
        evidenceHash: string;
        evidenceRef: string;
        paymentProofRef: string;
        attestationId?: string;
        reputationEventDraftId?: string;
        previewId?: string;
    };
    display: {
        label: 'Quasar intent fixtures ready' | 'Blocked';
        explanation: string;
        buyerFacingClaimAllowed: false;
    };
    reasonCodes: QuasarReputationIntentReasonCode[];
    guardrails: {
        quasarInstructionBuilt: false;
        walletSigning: false;
        rpcCall: false;
        programDeploy: false;
        livePaymentExecuted: false;
        reputationMutated: false;
        hostedRegistryWrite: false;
        marketplacePublished: false;
    };
    createdAt: string;
};
export type QuasarReputationIntentInput = {
    id: string;
    binding: ReceiptEvidenceBinding;
    /** The #390 compatibility report for the same listing/profile — required. */
    compatibility: QuasarRegistryCompatibilityReport | undefined;
    /** Optional #394 read-model cross-check; when supplied it must match. */
    preview?: OffchainReputationPreview;
    subject?: QuasarReputationIntentPlan['subject'];
    createdAt: string;
};
export type QuasarReputationIntentResult = {
    ok: true;
    plan: QuasarReputationIntentPlan;
} | {
    ok: false;
    plan: QuasarReputationIntentPlan;
};
export type QuasarReputationIntentSource = {
    kind: 'receipt-evidence-binding';
    binding: ReceiptEvidenceBinding;
} | {
    kind: 'rail-neutral';
    receipt: RailNeutralPaymentReceipt;
};
export type QuasarReputationIntentSourceEligibility = {
    eligible: boolean;
    reasonCodes: QuasarReputationIntentReasonCode[];
};
/**
 * Fail-closed pre-flight eligibility gate (mirrors the #562/#589
 * `evaluateErc8004SourceEligibility` precedent). Rail-neutral receipts never
 * qualify directly: probe-only receipts are excluded outright and binding
 * candidates must bridge into `reddi.receipt.v1` via the proof chain first.
 */
export declare function evaluateQuasarReputationIntentSourceEligibility(source: QuasarReputationIntentSource): QuasarReputationIntentSourceEligibility;
/**
 * Derive the fixture-level intent plan for an eligible reputation/attestation
 * record set. Pure, synchronous, deterministic: the same inputs always
 * produce the same plan, and a plan is data only — nothing is encoded,
 * dispatched, or mutated anywhere.
 */
export declare function deriveQuasarReputationIntentPlan(input: QuasarReputationIntentInput): QuasarReputationIntentResult;
