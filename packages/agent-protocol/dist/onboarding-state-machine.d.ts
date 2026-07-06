/**
 * Onboarding assistant state-machine read model (#510).
 *
 * Defines the backend/read-model state machine for AI onboarding assistant
 * drafts. It projects analyser outputs (#509 handoff contracts) and operator
 * decisions into a local, append-only audit history without UI, publication
 * side effects, or live execution.
 *
 * Twelve states are supported:
 *
 *   draft -> probe_failed / needs_provider_input / payment_setup_required
 *         -> dry_run_required -> risk_review_required
 *         -> pending_operator_approval -> approved_unpublished
 *         -> published_candidate (INTERNAL candidate only)
 *   plus changes_requested, rejected (terminal), and suspended.
 *
 * This module is PURE and offline-only. It performs no network fetch, hosted
 * registry write, public catalog write, trust or reputation mutation, payment
 * activation, endpoint invocation, wallet/RPC call, secret read, or command
 * execution. Every transition is a local/read-model event: it only re-shapes
 * an in-memory read model the caller already holds. Timestamps are
 * caller-supplied so replays are deterministic.
 *
 * `published_candidate` is an internal candidate state only. Reaching it never
 * writes hosted registry output, public catalog output, trust/reputation
 * mutations, or payment activation; those remain gated behind #395 publication
 * surfaces outside this module.
 */
export declare const ONBOARDING_STATE_MACHINE_SCHEMA_VERSION: "reddi.onboarding-state-machine.v1";
export declare const ONBOARDING_STATE_TRANSITION_EVENT_SCHEMA_VERSION: "reddi.onboarding-state-transition-event.v1";
export declare const ONBOARDING_ASSISTANT_READ_MODEL_SCHEMA_VERSION: "reddi.onboarding-assistant-read-model.v1";
/** Issue anchors so downstream implementations can trace contract ownership. */
export declare const ONBOARDING_STATE_MACHINE_ISSUE: 510;
export declare const ONBOARDING_STATE_MACHINE_RELATED_ISSUES: Readonly<{
    readonly onboardingAssistantEpic: 370;
    readonly guidedWorkflowFeature: 374;
    readonly discoverabilityPackageFeature: 376;
    readonly publicationGateFeature: 395;
    readonly analyserHandoffContracts: 509;
}>;
/**
 * Hard no-live boundary. Every guardrail is `false` by construction and every
 * read model carries this object so downstream consumers can assert the
 * boundary instead of trusting prose.
 */
export declare const ONBOARDING_STATE_MACHINE_GUARDRAILS: Readonly<{
    readonly hostedRegistryWriteAllowed: false;
    readonly publicCatalogWriteAllowed: false;
    readonly trustMutationAllowed: false;
    readonly reputationMutationAllowed: false;
    readonly paymentActivationAllowed: false;
    readonly endpointInvocationAllowed: false;
    readonly walletOrRpcAllowed: false;
    readonly networkFetchAllowed: false;
    readonly hostedWriteAllowed: false;
    readonly publicationAllowed: false;
    readonly secretReadAllowed: false;
    readonly liveExecutionAllowed: false;
}>;
export type OnboardingStateMachineGuardrails = typeof ONBOARDING_STATE_MACHINE_GUARDRAILS;
export type OnboardingAssistantState = 'draft' | 'probe_failed' | 'needs_provider_input' | 'payment_setup_required' | 'dry_run_required' | 'risk_review_required' | 'pending_operator_approval' | 'approved_unpublished' | 'changes_requested' | 'rejected' | 'suspended' | 'published_candidate';
export declare const ONBOARDING_ASSISTANT_STATES: readonly OnboardingAssistantState[];
/**
 * Allowed transitions. Anything not listed here fails closed. `rejected` is
 * terminal: a rejected draft can only be re-onboarded as a brand new draft
 * with a fresh intake, never mutated back into the flow.
 */
export declare const ONBOARDING_STATE_TRANSITION_GRAPH: Readonly<Record<OnboardingAssistantState, readonly OnboardingAssistantState[]>>;
export type OnboardingStateActorType = 'operator' | 'provider' | 'analyser' | 'system';
export declare const ONBOARDING_STATE_ACTOR_TYPES: readonly OnboardingStateActorType[];
/**
 * Target states an operator must drive. Approval, rejection, change requests,
 * suspension, reinstatement out of suspension, and internal candidate
 * publication are review decisions — they are recorded as local/read-model
 * events only and never invoke any external system.
 */
export declare const ONBOARDING_OPERATOR_ONLY_TARGET_STATES: readonly OnboardingAssistantState[];
export type OnboardingBlockingGateKey = 'probe' | 'provider_input' | 'payment_setup' | 'dry_run' | 'risk_review' | 'operator_approval' | 'readiness';
export declare const ONBOARDING_BLOCKING_GATE_KEYS: readonly OnboardingBlockingGateKey[];
/**
 * Gate reason codes. The first eight mirror the #509 fail-closed reasons so
 * readiness lane output can be projected directly onto blocking gates; the
 * rest are state-machine-native reasons.
 */
export type OnboardingGateReasonCode = 'private_url_blocked' | 'credential_leakage_rejected' | 'command_execution_rejected' | 'paid_call_rejected' | 'wallet_rpc_rejected' | 'missing_payment_metadata' | 'missing_evidence' | 'untrusted_imported_content_rejected' | 'probe_failure_recorded' | 'provider_input_required' | 'dry_run_receipt_required' | 'risk_review_pending' | 'operator_approval_pending' | 'readiness_blocked';
export type OnboardingBlockingGate = {
    gate: OnboardingBlockingGateKey;
    reasonCodes: OnboardingGateReasonCode[];
    note?: string;
};
/** Gate that must still be open when entering each gate-shaped state. */
export declare const ONBOARDING_STATE_REQUIRED_GATES: Readonly<Partial<Record<OnboardingAssistantState, OnboardingBlockingGateKey>>>;
/**
 * Readiness summary carried on every transition. Mirrors the #509
 * `OnboardingOverallReadiness` union; re-declared locally so this module stays
 * import-free while remaining structurally compatible.
 */
export type OnboardingStateReadinessSummary = 'blocked' | 'needs_operator_review' | 'publish_ready';
export type OnboardingStateTransitionErrorCode = 'malformed_transition_event' | 'malformed_read_model' | 'unknown_state' | 'invalid_transition' | 'terminal_state' | 'missing_audit_reason' | 'invalid_actor_type' | 'operator_action_required' | 'invalid_timestamp' | 'timestamp_regression' | 'missing_source_snapshot_ref' | 'missing_readiness_result_ref' | 'blocked_readiness' | 'missing_blocking_gate' | 'unresolved_blocking_gates' | 'publication_side_effect_rejected';
export type OnboardingStateTransitionError = {
    code: OnboardingStateTransitionErrorCode;
    path: string;
    message: string;
};
/**
 * A requested transition. Every transition carries the audit reason, actor
 * type, caller-supplied timestamp, source snapshot reference, readiness result
 * reference, and the blocking gates that remain open after the transition.
 *
 * `requestedSideEffects` exists only so imported/queued events that ask for a
 * live side effect (hosted write, publication, payment activation, wallet/RPC,
 * endpoint invocation, trust/reputation mutation, ...) can be rejected fail-
 * closed. This module never executes any side effect.
 */
export type OnboardingStateTransitionEvent = {
    schemaVersion: typeof ONBOARDING_STATE_TRANSITION_EVENT_SCHEMA_VERSION;
    eventId: string;
    to: OnboardingAssistantState;
    /** Human-auditable reason for the transition. Required, non-empty. */
    reason: string;
    actorType: OnboardingStateActorType;
    /** Opaque local reference to the acting operator/provider/analyser. */
    actorRef?: string;
    /** RFC3339 UTC timestamp, caller-supplied for deterministic replay. */
    occurredAt: string;
    /** Reference to the static source snapshot backing this transition. */
    sourceSnapshotRef: string;
    /** Reference to the #509 readiness result backing this transition. */
    readinessResultRef: string;
    /** Overall readiness recorded on the referenced readiness result. */
    readinessOverall: OnboardingStateReadinessSummary;
    /** Gates still blocking after this transition. */
    blockingGates: OnboardingBlockingGate[];
    requestedSideEffects?: string[];
};
/** An applied transition as recorded in the read-model audit history. */
export type OnboardingStateTransitionRecord = {
    sequence: number;
    from: OnboardingAssistantState;
    to: OnboardingAssistantState;
    eventId: string;
    reason: string;
    actorType: OnboardingStateActorType;
    actorRef?: string;
    occurredAt: string;
    sourceSnapshotRef: string;
    readinessResultRef: string;
    readinessOverall: OnboardingStateReadinessSummary;
    blockingGates: OnboardingBlockingGate[];
    /** Every recorded action is a local/read-model event only. */
    scope: 'local_read_model_only';
};
export type OnboardingAssistantReadModel = {
    schemaVersion: typeof ONBOARDING_ASSISTANT_READ_MODEL_SCHEMA_VERSION;
    stateMachineVersion: typeof ONBOARDING_STATE_MACHINE_SCHEMA_VERSION;
    draftId: string;
    state: OnboardingAssistantState;
    /** Timestamp of the event that produced the current state. */
    stateSince: string;
    sourceSnapshotRef: string;
    readinessResultRef: string;
    readinessOverall: OnboardingStateReadinessSummary;
    blockingGates: OnboardingBlockingGate[];
    history: OnboardingStateTransitionRecord[];
    /**
     * `published_candidate` (and every other state) stays internal: nothing in
     * this read model is a hosted, public, trusted, or payable surface.
     */
    internalCandidateOnly: true;
    /** Side-effect ledger. Every entry is hard-coded false by construction. */
    publication: {
        hostedRegistryWritePerformed: false;
        publicCatalogWritePerformed: false;
        trustMutationPerformed: false;
        reputationMutationPerformed: false;
        paymentActivationPerformed: false;
        endpointInvocationPerformed: false;
        walletOrRpcCallPerformed: false;
    };
    guardrails: OnboardingStateMachineGuardrails;
    localReadModelOnly: true;
    staticOnly: true;
};
export type OnboardingStateTransitionResult = {
    ok: true;
    readModel: OnboardingAssistantReadModel;
    record: OnboardingStateTransitionRecord;
} | {
    ok: false;
    failClosed: true;
    errors: OnboardingStateTransitionError[];
};
export type OnboardingReadModelInitResult = {
    ok: true;
    readModel: OnboardingAssistantReadModel;
} | {
    ok: false;
    failClosed: true;
    errors: OnboardingStateTransitionError[];
};
export type OnboardingReadModelInit = {
    draftId: string;
    sourceSnapshotRef: string;
    readinessResultRef: string;
    readinessOverall: OnboardingStateReadinessSummary;
    /** RFC3339 UTC timestamp, caller-supplied for deterministic replay. */
    createdAt: string;
    blockingGates?: OnboardingBlockingGate[];
};
/**
 * Create a read model for a new onboarding draft. Drafts always start in
 * `draft`; there is no way to construct a read model already approved or
 * published.
 */
export declare function createOnboardingAssistantReadModel(init: unknown): OnboardingReadModelInitResult;
/**
 * Apply a transition event to a read model. Pure and deterministic: the input
 * read model is never mutated; a new read model with the appended audit record
 * is returned. Invalid transitions fail closed with structured reasons and no
 * state change.
 */
export declare function applyOnboardingStateTransition(readModel: OnboardingAssistantReadModel, event: unknown): OnboardingStateTransitionResult;
/**
 * List the allowed target states from a given state. Useful for read-model
 * consumers (UI lanes in #384/#385/#386) that need to render next actions
 * without re-encoding the graph.
 */
export declare function listOnboardingStateTransitions(from: OnboardingAssistantState): readonly OnboardingAssistantState[];
