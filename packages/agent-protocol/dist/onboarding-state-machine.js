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
export const ONBOARDING_STATE_MACHINE_SCHEMA_VERSION = 'reddi.onboarding-state-machine.v1';
export const ONBOARDING_STATE_TRANSITION_EVENT_SCHEMA_VERSION = 'reddi.onboarding-state-transition-event.v1';
export const ONBOARDING_ASSISTANT_READ_MODEL_SCHEMA_VERSION = 'reddi.onboarding-assistant-read-model.v1';
/** Issue anchors so downstream implementations can trace contract ownership. */
export const ONBOARDING_STATE_MACHINE_ISSUE = 510;
export const ONBOARDING_STATE_MACHINE_RELATED_ISSUES = Object.freeze({
    onboardingAssistantEpic: 370,
    guidedWorkflowFeature: 374,
    discoverabilityPackageFeature: 376,
    publicationGateFeature: 395,
    analyserHandoffContracts: 509,
});
/**
 * Hard no-live boundary. Every guardrail is `false` by construction and every
 * read model carries this object so downstream consumers can assert the
 * boundary instead of trusting prose.
 */
export const ONBOARDING_STATE_MACHINE_GUARDRAILS = Object.freeze({
    hostedRegistryWriteAllowed: false,
    publicCatalogWriteAllowed: false,
    trustMutationAllowed: false,
    reputationMutationAllowed: false,
    paymentActivationAllowed: false,
    endpointInvocationAllowed: false,
    walletOrRpcAllowed: false,
    networkFetchAllowed: false,
    hostedWriteAllowed: false,
    publicationAllowed: false,
    secretReadAllowed: false,
    liveExecutionAllowed: false,
});
export const ONBOARDING_ASSISTANT_STATES = Object.freeze([
    'draft',
    'probe_failed',
    'needs_provider_input',
    'payment_setup_required',
    'dry_run_required',
    'risk_review_required',
    'pending_operator_approval',
    'approved_unpublished',
    'changes_requested',
    'rejected',
    'suspended',
    'published_candidate',
]);
/**
 * Allowed transitions. Anything not listed here fails closed. `rejected` is
 * terminal: a rejected draft can only be re-onboarded as a brand new draft
 * with a fresh intake, never mutated back into the flow.
 */
export const ONBOARDING_STATE_TRANSITION_GRAPH = Object.freeze({
    draft: [
        'probe_failed',
        'needs_provider_input',
        'payment_setup_required',
        'dry_run_required',
        'risk_review_required',
        'pending_operator_approval',
        'rejected',
        'suspended',
    ],
    probe_failed: ['draft', 'needs_provider_input', 'rejected', 'suspended'],
    needs_provider_input: ['draft', 'payment_setup_required', 'rejected', 'suspended'],
    payment_setup_required: ['draft', 'dry_run_required', 'rejected', 'suspended'],
    dry_run_required: ['probe_failed', 'risk_review_required', 'pending_operator_approval', 'rejected', 'suspended'],
    risk_review_required: ['pending_operator_approval', 'changes_requested', 'rejected', 'suspended'],
    pending_operator_approval: ['approved_unpublished', 'changes_requested', 'rejected', 'suspended'],
    approved_unpublished: ['published_candidate', 'changes_requested', 'suspended'],
    changes_requested: ['draft', 'pending_operator_approval', 'rejected', 'suspended'],
    rejected: [],
    suspended: ['draft', 'rejected'],
    published_candidate: ['changes_requested', 'suspended'],
});
export const ONBOARDING_STATE_ACTOR_TYPES = Object.freeze([
    'operator',
    'provider',
    'analyser',
    'system',
]);
/**
 * Target states an operator must drive. Approval, rejection, change requests,
 * suspension, reinstatement out of suspension, and internal candidate
 * publication are review decisions — they are recorded as local/read-model
 * events only and never invoke any external system.
 */
export const ONBOARDING_OPERATOR_ONLY_TARGET_STATES = Object.freeze([
    'approved_unpublished',
    'changes_requested',
    'rejected',
    'suspended',
    'published_candidate',
]);
export const ONBOARDING_BLOCKING_GATE_KEYS = Object.freeze([
    'probe',
    'provider_input',
    'payment_setup',
    'dry_run',
    'risk_review',
    'operator_approval',
    'readiness',
]);
const GATE_REASON_CODES = [
    'private_url_blocked',
    'credential_leakage_rejected',
    'command_execution_rejected',
    'paid_call_rejected',
    'wallet_rpc_rejected',
    'missing_payment_metadata',
    'missing_evidence',
    'untrusted_imported_content_rejected',
    'probe_failure_recorded',
    'provider_input_required',
    'dry_run_receipt_required',
    'risk_review_pending',
    'operator_approval_pending',
    'readiness_blocked',
];
/** Gate that must still be open when entering each gate-shaped state. */
export const ONBOARDING_STATE_REQUIRED_GATES = Object.freeze({
    probe_failed: 'probe',
    needs_provider_input: 'provider_input',
    payment_setup_required: 'payment_setup',
    dry_run_required: 'dry_run',
    risk_review_required: 'risk_review',
    pending_operator_approval: 'operator_approval',
});
const READINESS_SUMMARIES = [
    'blocked',
    'needs_operator_review',
    'publish_ready',
];
// ---------------------------------------------------------------------------
// Validation internals
// ---------------------------------------------------------------------------
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
function transitionError(code, path, message) {
    return { code, path, message };
}
function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function isKnownState(value) {
    return ONBOARDING_ASSISTANT_STATES.includes(value);
}
function parseUtcMillis(timestamp) {
    return new Date(timestamp).getTime();
}
function validateBlockingGates(value, path, errors) {
    if (!Array.isArray(value)) {
        errors.push(transitionError('malformed_transition_event', path, 'blockingGates must be an array'));
        return [];
    }
    const gates = [];
    value.forEach((entry, index) => {
        const entryPath = `${path}[${index}]`;
        if (!isPlainObject(entry)) {
            errors.push(transitionError('malformed_transition_event', entryPath, 'blocking gate must be an object'));
            return;
        }
        if (!ONBOARDING_BLOCKING_GATE_KEYS.includes(entry.gate)) {
            errors.push(transitionError('malformed_transition_event', `${entryPath}.gate`, 'blocking gate key is unsupported'));
            return;
        }
        if (!Array.isArray(entry.reasonCodes)
            || !entry.reasonCodes.every((code) => GATE_REASON_CODES.includes(code))) {
            errors.push(transitionError('malformed_transition_event', `${entryPath}.reasonCodes`, 'reasonCodes must be an array of recognised gate reason codes'));
            return;
        }
        if (entry.note !== undefined && !isNonEmptyString(entry.note)) {
            errors.push(transitionError('malformed_transition_event', `${entryPath}.note`, 'note must be a non-empty string when present'));
            return;
        }
        gates.push({
            gate: entry.gate,
            reasonCodes: [...entry.reasonCodes],
            ...(entry.note !== undefined ? { note: entry.note } : {}),
        });
    });
    return gates;
}
function validateTransitionEventShape(input, errors) {
    if (!isPlainObject(input)) {
        errors.push(transitionError('malformed_transition_event', '$', 'transition event must be a plain object'));
        return undefined;
    }
    if (input.schemaVersion !== ONBOARDING_STATE_TRANSITION_EVENT_SCHEMA_VERSION) {
        errors.push(transitionError('malformed_transition_event', '$.schemaVersion', `expected ${ONBOARDING_STATE_TRANSITION_EVENT_SCHEMA_VERSION}`));
    }
    if (!isNonEmptyString(input.eventId)) {
        errors.push(transitionError('malformed_transition_event', '$.eventId', 'eventId must be a non-empty string'));
    }
    if (!isKnownState(input.to)) {
        errors.push(transitionError('unknown_state', '$.to', 'target state is not one of the twelve onboarding assistant states'));
    }
    if (!isNonEmptyString(input.reason)) {
        errors.push(transitionError('missing_audit_reason', '$.reason', 'every transition must carry a non-empty audit reason'));
    }
    if (!ONBOARDING_STATE_ACTOR_TYPES.includes(input.actorType)) {
        errors.push(transitionError('invalid_actor_type', '$.actorType', 'actorType must be operator, provider, analyser, or system'));
    }
    if (input.actorRef !== undefined && !isNonEmptyString(input.actorRef)) {
        errors.push(transitionError('malformed_transition_event', '$.actorRef', 'actorRef must be a non-empty string when present'));
    }
    if (!isNonEmptyString(input.occurredAt) || !RFC3339_UTC_PATTERN.test(input.occurredAt)) {
        errors.push(transitionError('invalid_timestamp', '$.occurredAt', 'occurredAt must be a caller-supplied RFC3339 UTC timestamp'));
    }
    if (!isNonEmptyString(input.sourceSnapshotRef)) {
        errors.push(transitionError('missing_source_snapshot_ref', '$.sourceSnapshotRef', 'every transition must reference the static source snapshot'));
    }
    if (!isNonEmptyString(input.readinessResultRef)) {
        errors.push(transitionError('missing_readiness_result_ref', '$.readinessResultRef', 'every transition must reference the readiness result backing it'));
    }
    if (!READINESS_SUMMARIES.includes(input.readinessOverall)) {
        errors.push(transitionError('malformed_transition_event', '$.readinessOverall', 'readinessOverall must be blocked, needs_operator_review, or publish_ready'));
    }
    const blockingGates = validateBlockingGates(input.blockingGates, '$.blockingGates', errors);
    if (input.requestedSideEffects !== undefined) {
        if (!Array.isArray(input.requestedSideEffects) || !input.requestedSideEffects.every((item) => typeof item === 'string')) {
            errors.push(transitionError('malformed_transition_event', '$.requestedSideEffects', 'requestedSideEffects must be a string array when present'));
        }
        else {
            input.requestedSideEffects.forEach((effect, index) => {
                errors.push(transitionError('publication_side_effect_rejected', `$.requestedSideEffects[${index}]`, `requested side effect "${effect}" is rejected fail-closed: transitions are local/read-model events only`));
            });
        }
    }
    if (errors.length > 0)
        return undefined;
    return {
        eventId: input.eventId,
        to: input.to,
        reason: input.reason,
        actorType: input.actorType,
        ...(input.actorRef !== undefined ? { actorRef: input.actorRef } : {}),
        occurredAt: input.occurredAt,
        sourceSnapshotRef: input.sourceSnapshotRef,
        readinessResultRef: input.readinessResultRef,
        readinessOverall: input.readinessOverall,
        blockingGates,
    };
}
const READ_MODEL_PUBLICATION_LEDGER = Object.freeze({
    hostedRegistryWritePerformed: false,
    publicCatalogWritePerformed: false,
    trustMutationPerformed: false,
    reputationMutationPerformed: false,
    paymentActivationPerformed: false,
    endpointInvocationPerformed: false,
    walletOrRpcCallPerformed: false,
});
/**
 * Create a read model for a new onboarding draft. Drafts always start in
 * `draft`; there is no way to construct a read model already approved or
 * published.
 */
export function createOnboardingAssistantReadModel(init) {
    const errors = [];
    if (!isPlainObject(init)) {
        return { ok: false, failClosed: true, errors: [transitionError('malformed_read_model', '$', 'read model init must be a plain object')] };
    }
    if (!isNonEmptyString(init.draftId)) {
        errors.push(transitionError('malformed_read_model', '$.draftId', 'draftId must be a non-empty string'));
    }
    if (!isNonEmptyString(init.sourceSnapshotRef)) {
        errors.push(transitionError('missing_source_snapshot_ref', '$.sourceSnapshotRef', 'sourceSnapshotRef must be a non-empty string'));
    }
    if (!isNonEmptyString(init.readinessResultRef)) {
        errors.push(transitionError('missing_readiness_result_ref', '$.readinessResultRef', 'readinessResultRef must be a non-empty string'));
    }
    if (!READINESS_SUMMARIES.includes(init.readinessOverall)) {
        errors.push(transitionError('malformed_read_model', '$.readinessOverall', 'readinessOverall must be blocked, needs_operator_review, or publish_ready'));
    }
    if (!isNonEmptyString(init.createdAt) || !RFC3339_UTC_PATTERN.test(init.createdAt)) {
        errors.push(transitionError('invalid_timestamp', '$.createdAt', 'createdAt must be a caller-supplied RFC3339 UTC timestamp'));
    }
    const blockingGates = init.blockingGates === undefined
        ? []
        : validateBlockingGates(init.blockingGates, '$.blockingGates', errors);
    if (errors.length > 0) {
        return { ok: false, failClosed: true, errors };
    }
    return {
        ok: true,
        readModel: {
            schemaVersion: ONBOARDING_ASSISTANT_READ_MODEL_SCHEMA_VERSION,
            stateMachineVersion: ONBOARDING_STATE_MACHINE_SCHEMA_VERSION,
            draftId: init.draftId,
            state: 'draft',
            stateSince: init.createdAt,
            sourceSnapshotRef: init.sourceSnapshotRef,
            readinessResultRef: init.readinessResultRef,
            readinessOverall: init.readinessOverall,
            blockingGates,
            history: [],
            internalCandidateOnly: true,
            publication: { ...READ_MODEL_PUBLICATION_LEDGER },
            guardrails: ONBOARDING_STATE_MACHINE_GUARDRAILS,
            localReadModelOnly: true,
            staticOnly: true,
        },
    };
}
// ---------------------------------------------------------------------------
// Transition application
// ---------------------------------------------------------------------------
/**
 * Apply a transition event to a read model. Pure and deterministic: the input
 * read model is never mutated; a new read model with the appended audit record
 * is returned. Invalid transitions fail closed with structured reasons and no
 * state change.
 */
export function applyOnboardingStateTransition(readModel, event) {
    if (!isPlainObject(readModel) || !isKnownState(readModel.state)) {
        return {
            ok: false,
            failClosed: true,
            errors: [transitionError('malformed_read_model', '$.readModel.state', 'read model must carry a known onboarding assistant state')],
        };
    }
    const errors = [];
    const core = validateTransitionEventShape(event, errors);
    if (!core) {
        return { ok: false, failClosed: true, errors };
    }
    const from = readModel.state;
    const allowed = ONBOARDING_STATE_TRANSITION_GRAPH[from];
    if (allowed.length === 0) {
        errors.push(transitionError('terminal_state', '$.to', `state "${from}" is terminal; a rejected draft must be re-onboarded as a new draft`));
    }
    else if (!allowed.includes(core.to)) {
        errors.push(transitionError('invalid_transition', '$.to', `transition ${from} -> ${core.to} is not allowed by the onboarding state machine`));
    }
    const operatorRequired = ONBOARDING_OPERATOR_ONLY_TARGET_STATES.includes(core.to) || from === 'suspended';
    if (operatorRequired && core.actorType !== 'operator') {
        errors.push(transitionError('operator_action_required', '$.actorType', `transition ${from} -> ${core.to} is an operator review decision and must be recorded by an operator actor`));
    }
    const requiredGate = ONBOARDING_STATE_REQUIRED_GATES[core.to];
    if (requiredGate && !core.blockingGates.some((gate) => gate.gate === requiredGate)) {
        errors.push(transitionError('missing_blocking_gate', '$.blockingGates', `entering ${core.to} requires the open "${requiredGate}" blocking gate to be carried on the transition`));
    }
    if (core.to === 'approved_unpublished' || core.to === 'published_candidate') {
        if (core.readinessOverall === 'blocked') {
            errors.push(transitionError('blocked_readiness', '$.readinessOverall', `cannot enter ${core.to} while the referenced readiness result is blocked`));
        }
        if (core.blockingGates.length > 0) {
            errors.push(transitionError('unresolved_blocking_gates', '$.blockingGates', `cannot enter ${core.to} while blocking gates remain open: ${core.blockingGates.map((gate) => gate.gate).join(', ')}`));
        }
    }
    if (RFC3339_UTC_PATTERN.test(core.occurredAt)
        && parseUtcMillis(core.occurredAt) < parseUtcMillis(readModel.stateSince)) {
        errors.push(transitionError('timestamp_regression', '$.occurredAt', 'occurredAt must not be earlier than the timestamp of the current state'));
    }
    if (errors.length > 0) {
        return { ok: false, failClosed: true, errors };
    }
    const record = {
        sequence: readModel.history.length + 1,
        from,
        to: core.to,
        eventId: core.eventId,
        reason: core.reason,
        actorType: core.actorType,
        ...(core.actorRef !== undefined ? { actorRef: core.actorRef } : {}),
        occurredAt: core.occurredAt,
        sourceSnapshotRef: core.sourceSnapshotRef,
        readinessResultRef: core.readinessResultRef,
        readinessOverall: core.readinessOverall,
        blockingGates: core.blockingGates.map((gate) => ({ ...gate, reasonCodes: [...gate.reasonCodes] })),
        scope: 'local_read_model_only',
    };
    return {
        ok: true,
        readModel: {
            ...readModel,
            state: core.to,
            stateSince: core.occurredAt,
            sourceSnapshotRef: core.sourceSnapshotRef,
            readinessResultRef: core.readinessResultRef,
            readinessOverall: core.readinessOverall,
            blockingGates: record.blockingGates.map((gate) => ({ ...gate, reasonCodes: [...gate.reasonCodes] })),
            history: [...readModel.history, record],
            internalCandidateOnly: true,
            publication: { ...READ_MODEL_PUBLICATION_LEDGER },
            guardrails: ONBOARDING_STATE_MACHINE_GUARDRAILS,
            localReadModelOnly: true,
            staticOnly: true,
        },
        record,
    };
}
/**
 * List the allowed target states from a given state. Useful for read-model
 * consumers (UI lanes in #384/#385/#386) that need to render next actions
 * without re-encoding the graph.
 */
export function listOnboardingStateTransitions(from) {
    return ONBOARDING_STATE_TRANSITION_GRAPH[from] ?? Object.freeze([]);
}
