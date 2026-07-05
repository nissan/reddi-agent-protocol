import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ONBOARDING_ASSISTANT_READ_MODEL_SCHEMA_VERSION,
  ONBOARDING_ASSISTANT_STATES,
  ONBOARDING_BLOCKING_GATE_KEYS,
  ONBOARDING_OPERATOR_ONLY_TARGET_STATES,
  ONBOARDING_STATE_ACTOR_TYPES,
  ONBOARDING_STATE_MACHINE_GUARDRAILS,
  ONBOARDING_STATE_MACHINE_ISSUE,
  ONBOARDING_STATE_MACHINE_RELATED_ISSUES,
  ONBOARDING_STATE_MACHINE_SCHEMA_VERSION,
  ONBOARDING_STATE_REQUIRED_GATES,
  ONBOARDING_STATE_TRANSITION_EVENT_SCHEMA_VERSION,
  ONBOARDING_STATE_TRANSITION_GRAPH,
  applyOnboardingStateTransition,
  createOnboardingAssistantReadModel,
  listOnboardingStateTransitions,
  type OnboardingAssistantReadModel,
  type OnboardingAssistantState,
  type OnboardingStateTransitionError,
  type OnboardingStateTransitionEvent,
} from '../dist/index.js';

const T0 = '2026-07-06T00:00:00Z';
const SNAPSHOT_REF = 'fixtures/onboarding/state-machine-draft-1.json';
const READINESS_REF = 'draft-profile:state-machine-draft-1#readiness';

function newReadModel(): OnboardingAssistantReadModel {
  const created = createOnboardingAssistantReadModel({
    draftId: 'state-machine-draft-1',
    sourceSnapshotRef: SNAPSHOT_REF,
    readinessResultRef: READINESS_REF,
    readinessOverall: 'needs_operator_review',
    createdAt: T0,
  });
  assert.ok(created.ok, 'baseline read model must initialise');
  return created.readModel;
}

let eventCounter = 0;

function event(overrides: Partial<OnboardingStateTransitionEvent> & Pick<OnboardingStateTransitionEvent, 'to'>): OnboardingStateTransitionEvent {
  eventCounter += 1;
  return {
    schemaVersion: ONBOARDING_STATE_TRANSITION_EVENT_SCHEMA_VERSION,
    eventId: `event-${eventCounter}`,
    reason: `test transition to ${overrides.to}`,
    actorType: 'operator',
    occurredAt: '2026-07-06T01:00:00Z',
    sourceSnapshotRef: SNAPSHOT_REF,
    readinessResultRef: READINESS_REF,
    readinessOverall: 'needs_operator_review',
    blockingGates: [],
    ...overrides,
  };
}

function apply(readModel: OnboardingAssistantReadModel, overrides: Partial<OnboardingStateTransitionEvent> & Pick<OnboardingStateTransitionEvent, 'to'>): OnboardingAssistantReadModel {
  const result = applyOnboardingStateTransition(readModel, event(overrides));
  assert.ok(result.ok, `transition to ${overrides.to} must succeed: ${JSON.stringify(!result.ok ? result.errors : [])}`);
  return result.readModel;
}

function failCodes(readModel: OnboardingAssistantReadModel, overrides: Partial<OnboardingStateTransitionEvent> & Pick<OnboardingStateTransitionEvent, 'to'>): string[] {
  const result = applyOnboardingStateTransition(readModel, event(overrides));
  assert.ok(!result.ok, `transition to ${overrides.to} must fail closed`);
  assert.equal(result.failClosed, true);
  for (const error of result.errors) {
    assert.ok(error.code.length > 0 && error.path.startsWith('$') && error.message.length > 0, 'errors must be structured');
  }
  return [...new Set(result.errors.map((error: OnboardingStateTransitionError) => error.code))].sort();
}

/** Drive the happy path up to a given state with fully-cleared gates. */
function readModelAt(state: OnboardingAssistantState): OnboardingAssistantReadModel {
  let model = newReadModel();
  if (state === 'draft') return model;
  const path: Array<Partial<OnboardingStateTransitionEvent> & Pick<OnboardingStateTransitionEvent, 'to'>> = [
    {
      to: 'payment_setup_required',
      eventId: 'happy-path-1',
      actorType: 'analyser',
      occurredAt: '2026-07-06T01:00:00Z',
      blockingGates: [{ gate: 'payment_setup', reasonCodes: ['missing_payment_metadata'] }],
    },
    {
      to: 'dry_run_required',
      eventId: 'happy-path-2',
      actorType: 'provider',
      occurredAt: '2026-07-06T02:00:00Z',
      blockingGates: [{ gate: 'dry_run', reasonCodes: ['dry_run_receipt_required'] }],
    },
    {
      to: 'risk_review_required',
      eventId: 'happy-path-3',
      actorType: 'analyser',
      occurredAt: '2026-07-06T03:00:00Z',
      blockingGates: [{ gate: 'risk_review', reasonCodes: ['risk_review_pending'] }],
    },
    {
      to: 'pending_operator_approval',
      eventId: 'happy-path-4',
      actorType: 'analyser',
      occurredAt: '2026-07-06T04:00:00Z',
      blockingGates: [{ gate: 'operator_approval', reasonCodes: ['operator_approval_pending'] }],
    },
    {
      to: 'approved_unpublished',
      eventId: 'happy-path-5',
      actorType: 'operator',
      actorRef: 'operator:reviewer-1',
      reason: 'operator approved after review of readiness result and gates',
      occurredAt: '2026-07-06T05:00:00Z',
      blockingGates: [],
    },
    {
      to: 'published_candidate',
      eventId: 'happy-path-6',
      actorType: 'operator',
      actorRef: 'operator:reviewer-1',
      reason: 'operator marked draft as internal publication candidate',
      occurredAt: '2026-07-06T06:00:00Z',
      blockingGates: [],
    },
  ];
  for (const step of path) {
    model = apply(model, step);
    if (model.state === state) return model;
  }
  assert.fail(`state ${state} is not on the happy path`);
}

describe('onboarding assistant state-machine read model (#510)', () => {
  it('anchors the state machine to its issue map', () => {
    assert.equal(ONBOARDING_STATE_MACHINE_ISSUE, 510);
    assert.equal(ONBOARDING_STATE_MACHINE_RELATED_ISSUES.onboardingAssistantEpic, 370);
    assert.equal(ONBOARDING_STATE_MACHINE_RELATED_ISSUES.guidedWorkflowFeature, 374);
    assert.equal(ONBOARDING_STATE_MACHINE_RELATED_ISSUES.discoverabilityPackageFeature, 376);
    assert.equal(ONBOARDING_STATE_MACHINE_RELATED_ISSUES.publicationGateFeature, 395);
    assert.equal(ONBOARDING_STATE_MACHINE_RELATED_ISSUES.analyserHandoffContracts, 509);
    assert.equal(ONBOARDING_STATE_MACHINE_SCHEMA_VERSION, 'reddi.onboarding-state-machine.v1');
    assert.equal(ONBOARDING_STATE_TRANSITION_EVENT_SCHEMA_VERSION, 'reddi.onboarding-state-transition-event.v1');
    assert.equal(ONBOARDING_ASSISTANT_READ_MODEL_SCHEMA_VERSION, 'reddi.onboarding-assistant-read-model.v1');
  });

  it('keeps every no-live guardrail explicitly false', () => {
    const values = Object.values(ONBOARDING_STATE_MACHINE_GUARDRAILS);
    assert.ok(values.length >= 12);
    for (const value of values) {
      assert.equal(value, false);
    }
    assert.equal(ONBOARDING_STATE_MACHINE_GUARDRAILS.hostedRegistryWriteAllowed, false);
    assert.equal(ONBOARDING_STATE_MACHINE_GUARDRAILS.publicCatalogWriteAllowed, false);
    assert.equal(ONBOARDING_STATE_MACHINE_GUARDRAILS.trustMutationAllowed, false);
    assert.equal(ONBOARDING_STATE_MACHINE_GUARDRAILS.reputationMutationAllowed, false);
    assert.equal(ONBOARDING_STATE_MACHINE_GUARDRAILS.paymentActivationAllowed, false);
    assert.equal(ONBOARDING_STATE_MACHINE_GUARDRAILS.endpointInvocationAllowed, false);
    assert.equal(ONBOARDING_STATE_MACHINE_GUARDRAILS.walletOrRpcAllowed, false);
  });

  describe('states and transition graph', () => {
    it('supports exactly the twelve required states', () => {
      assert.deepEqual([...ONBOARDING_ASSISTANT_STATES], [
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
      assert.equal(ONBOARDING_ASSISTANT_STATES.length, 12);
    });

    it('defines a graph entry for every state and only known target states', () => {
      assert.deepEqual(Object.keys(ONBOARDING_STATE_TRANSITION_GRAPH).sort(), [...ONBOARDING_ASSISTANT_STATES].sort());
      for (const [from, targets] of Object.entries(ONBOARDING_STATE_TRANSITION_GRAPH)) {
        for (const target of targets) {
          assert.ok(ONBOARDING_ASSISTANT_STATES.includes(target), `${from} -> ${target} must target a known state`);
          assert.notEqual(target, from, `${from} must not self-transition`);
        }
        assert.deepEqual(listOnboardingStateTransitions(from as OnboardingAssistantState), targets);
      }
    });

    it('keeps rejected terminal and published_candidate internal-recall-only', () => {
      assert.deepEqual([...ONBOARDING_STATE_TRANSITION_GRAPH.rejected], []);
      assert.deepEqual([...ONBOARDING_STATE_TRANSITION_GRAPH.published_candidate].sort(), ['changes_requested', 'suspended']);
      assert.equal(ONBOARDING_BLOCKING_GATE_KEYS.length, 7);
      assert.equal(ONBOARDING_STATE_ACTOR_TYPES.length, 4);
    });
  });

  describe('read model construction', () => {
    it('initialises a draft read model with a caller-supplied timestamp', () => {
      const model = newReadModel();
      assert.equal(model.schemaVersion, ONBOARDING_ASSISTANT_READ_MODEL_SCHEMA_VERSION);
      assert.equal(model.stateMachineVersion, ONBOARDING_STATE_MACHINE_SCHEMA_VERSION);
      assert.equal(model.state, 'draft');
      assert.equal(model.stateSince, T0);
      assert.equal(model.sourceSnapshotRef, SNAPSHOT_REF);
      assert.equal(model.readinessResultRef, READINESS_REF);
      assert.deepEqual(model.history, []);
      assert.equal(model.localReadModelOnly, true);
      assert.equal(model.staticOnly, true);
      assert.equal(model.internalCandidateOnly, true);
      assert.deepEqual(model.guardrails, ONBOARDING_STATE_MACHINE_GUARDRAILS);
    });

    it('fails closed on malformed init input', () => {
      const missing = createOnboardingAssistantReadModel({});
      assert.ok(!missing.ok);
      const codes = new Set(missing.errors.map((error) => error.code));
      assert.ok(codes.has('malformed_read_model'));
      assert.ok(codes.has('missing_source_snapshot_ref'));
      assert.ok(codes.has('missing_readiness_result_ref'));
      assert.ok(codes.has('invalid_timestamp'));

      const badTimestamp = createOnboardingAssistantReadModel({
        draftId: 'x',
        sourceSnapshotRef: SNAPSHOT_REF,
        readinessResultRef: READINESS_REF,
        readinessOverall: 'needs_operator_review',
        createdAt: 'yesterday around noon',
      });
      assert.ok(!badTimestamp.ok);
      assert.ok(badTimestamp.errors.some((error) => error.code === 'invalid_timestamp'));
    });
  });

  describe('valid transitions', () => {
    it('walks the full happy path to published_candidate with a complete audit trail', () => {
      const model = readModelAt('published_candidate');
      assert.equal(model.state, 'published_candidate');
      assert.equal(model.history.length, 6);
      assert.deepEqual(
        model.history.map((record) => [record.from, record.to]),
        [
          ['draft', 'payment_setup_required'],
          ['payment_setup_required', 'dry_run_required'],
          ['dry_run_required', 'risk_review_required'],
          ['risk_review_required', 'pending_operator_approval'],
          ['pending_operator_approval', 'approved_unpublished'],
          ['approved_unpublished', 'published_candidate'],
        ],
      );
      model.history.forEach((record, index) => {
        assert.equal(record.sequence, index + 1);
        assert.ok(record.reason.length > 0, 'every transition carries an audit reason');
        assert.ok(ONBOARDING_STATE_ACTOR_TYPES.includes(record.actorType), 'every transition carries an actor type');
        assert.match(record.occurredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        assert.equal(record.sourceSnapshotRef, SNAPSHOT_REF);
        assert.equal(record.readinessResultRef, READINESS_REF);
        assert.ok(Array.isArray(record.blockingGates), 'every transition carries blocking gates');
        assert.equal(record.scope, 'local_read_model_only');
      });
      assert.equal(model.stateSince, '2026-07-06T06:00:00Z');
    });

    it('supports remediation loops: probe_failed and needs_provider_input back to draft', () => {
      let model = newReadModel();
      model = apply(model, {
        to: 'probe_failed',
        actorType: 'analyser',
        occurredAt: '2026-07-06T01:00:00Z',
        blockingGates: [{ gate: 'probe', reasonCodes: ['probe_failure_recorded'], note: 'static probe evidence recorded a failing check' }],
      });
      assert.equal(model.state, 'probe_failed');
      model = apply(model, {
        to: 'needs_provider_input',
        actorType: 'system',
        occurredAt: '2026-07-06T02:00:00Z',
        blockingGates: [{ gate: 'provider_input', reasonCodes: ['provider_input_required'] }],
      });
      assert.equal(model.state, 'needs_provider_input');
      model = apply(model, {
        to: 'draft',
        actorType: 'provider',
        occurredAt: '2026-07-06T03:00:00Z',
        reason: 'provider supplied the missing descriptor fields',
      });
      assert.equal(model.state, 'draft');
      assert.equal(model.history.length, 3);
    });

    it('supports changes_requested loops back through review', () => {
      let model = readModelAt('pending_operator_approval');
      model = apply(model, {
        to: 'changes_requested',
        actorType: 'operator',
        occurredAt: '2026-07-06T05:00:00Z',
        reason: 'operator requested pricing description changes',
      });
      assert.equal(model.state, 'changes_requested');
      model = apply(model, {
        to: 'pending_operator_approval',
        actorType: 'provider',
        occurredAt: '2026-07-06T06:00:00Z',
        blockingGates: [{ gate: 'operator_approval', reasonCodes: ['operator_approval_pending'] }],
      });
      assert.equal(model.state, 'pending_operator_approval');
    });

    it('does not mutate the input read model', () => {
      const model = newReadModel();
      const before = JSON.stringify(model);
      const result = applyOnboardingStateTransition(model, event({
        to: 'payment_setup_required',
        actorType: 'analyser',
        blockingGates: [{ gate: 'payment_setup', reasonCodes: ['missing_payment_metadata'] }],
      }));
      assert.ok(result.ok);
      assert.equal(JSON.stringify(model), before);
      assert.equal(model.state, 'draft');
    });

    it('is deterministic: replaying the same events produces identical read models', () => {
      assert.deepEqual(readModelAt('published_candidate'), readModelAt('published_candidate'));
    });
  });

  describe('invalid transitions fail closed with structured reasons', () => {
    it('rejects edges not present in the graph', () => {
      assert.deepEqual(failCodes(newReadModel(), { to: 'published_candidate' }), ['invalid_transition']);
      assert.deepEqual(failCodes(newReadModel(), { to: 'approved_unpublished' }), ['invalid_transition']);
      assert.deepEqual(
        failCodes(readModelAt('published_candidate'), { to: 'approved_unpublished', occurredAt: '2026-07-06T07:00:00Z' }),
        ['invalid_transition'],
      );
      assert.deepEqual(
        failCodes(readModelAt('approved_unpublished'), { to: 'draft', occurredAt: '2026-07-06T06:00:00Z' }),
        ['invalid_transition'],
      );
    });

    it('rejects unknown target states', () => {
      const result = applyOnboardingStateTransition(newReadModel(), {
        ...event({ to: 'draft' }),
        to: 'published',
      });
      assert.ok(!result.ok);
      assert.ok(result.errors.some((error) => error.code === 'unknown_state'));
    });

    it('rejects malformed transition events without state change', () => {
      const model = newReadModel();
      const result = applyOnboardingStateTransition(model, { schemaVersion: 'nope' });
      assert.ok(!result.ok);
      assert.equal(result.failClosed, true);
      assert.ok(result.errors.length >= 5);
      assert.equal(model.state, 'draft');
    });

    it('rejects transitions missing the source snapshot or readiness result reference', () => {
      const codes = failCodes(newReadModel(), {
        to: 'payment_setup_required',
        actorType: 'analyser',
        sourceSnapshotRef: '',
        readinessResultRef: '  ',
        blockingGates: [{ gate: 'payment_setup', reasonCodes: ['missing_payment_metadata'] }],
      });
      assert.deepEqual(codes, ['missing_readiness_result_ref', 'missing_source_snapshot_ref']);
    });

    it('rejects gate states entered without their open blocking gate', () => {
      assert.deepEqual(
        failCodes(newReadModel(), { to: 'payment_setup_required', actorType: 'analyser', blockingGates: [] }),
        ['missing_blocking_gate'],
      );
      assert.deepEqual(
        failCodes(newReadModel(), { to: 'risk_review_required', actorType: 'analyser', blockingGates: [{ gate: 'probe', reasonCodes: [] }] }),
        ['missing_blocking_gate'],
      );
      assert.equal(Object.keys(ONBOARDING_STATE_REQUIRED_GATES).length, 6);
    });

    it('rejects caller timestamps that are malformed or regress', () => {
      assert.deepEqual(
        failCodes(newReadModel(), { to: 'suspended', occurredAt: '06/07/2026 10:00' }),
        ['invalid_timestamp'],
      );
      assert.deepEqual(
        failCodes(newReadModel(), { to: 'suspended', occurredAt: '2026-07-05T23:59:59Z' }),
        ['timestamp_regression'],
      );
    });
  });

  describe('operator approval discipline', () => {
    it('fails closed on a missing approval reason', () => {
      const codes = failCodes(readModelAt('pending_operator_approval'), {
        to: 'approved_unpublished',
        actorType: 'operator',
        reason: '   ',
        occurredAt: '2026-07-06T05:00:00Z',
      });
      assert.deepEqual(codes, ['missing_audit_reason']);
    });

    it('fails closed on approval while readiness is blocked', () => {
      const codes = failCodes(readModelAt('pending_operator_approval'), {
        to: 'approved_unpublished',
        actorType: 'operator',
        occurredAt: '2026-07-06T05:00:00Z',
        readinessOverall: 'blocked',
      });
      assert.deepEqual(codes, ['blocked_readiness']);
    });

    it('fails closed on approval while blocking gates remain open', () => {
      const codes = failCodes(readModelAt('pending_operator_approval'), {
        to: 'approved_unpublished',
        actorType: 'operator',
        occurredAt: '2026-07-06T05:00:00Z',
        blockingGates: [{ gate: 'payment_setup', reasonCodes: ['missing_payment_metadata'] }],
      });
      assert.deepEqual(codes, ['unresolved_blocking_gates']);
    });

    it('requires an operator actor for review decisions', () => {
      for (const target of ONBOARDING_OPERATOR_ONLY_TARGET_STATES) {
        assert.ok(['approved_unpublished', 'changes_requested', 'rejected', 'suspended', 'published_candidate'].includes(target));
      }
      const codes = failCodes(readModelAt('pending_operator_approval'), {
        to: 'approved_unpublished',
        actorType: 'analyser',
        occurredAt: '2026-07-06T05:00:00Z',
      });
      assert.deepEqual(codes, ['operator_action_required']);
      assert.deepEqual(
        failCodes(newReadModel(), { to: 'rejected', actorType: 'system' }),
        ['operator_action_required'],
      );
    });
  });

  describe('rejected state', () => {
    it('records an operator rejection with reason and refs', () => {
      const model = apply(readModelAt('pending_operator_approval'), {
        to: 'rejected',
        actorType: 'operator',
        actorRef: 'operator:reviewer-1',
        reason: 'capability descriptions conflict with the source snapshot',
        occurredAt: '2026-07-06T05:00:00Z',
      });
      assert.equal(model.state, 'rejected');
      const record = model.history[model.history.length - 1];
      assert.ok(record);
      assert.equal(record.actorType, 'operator');
      assert.equal(record.reason, 'capability descriptions conflict with the source snapshot');
      assert.equal(record.sourceSnapshotRef, SNAPSHOT_REF);
      assert.equal(record.readinessResultRef, READINESS_REF);
    });

    it('is terminal: every outgoing transition fails closed', () => {
      const model = apply(newReadModel(), {
        to: 'rejected',
        actorType: 'operator',
        reason: 'operator rejected the draft outright',
      });
      for (const target of ONBOARDING_ASSISTANT_STATES.filter((state) => state !== 'rejected')) {
        const codes = failCodes(model, {
          to: target,
          actorType: 'operator',
          occurredAt: '2026-07-06T09:00:00Z',
          blockingGates: [],
        });
        assert.ok(codes.includes('terminal_state'), `rejected -> ${target} must be terminal`);
      }
    });
  });

  describe('suspended state', () => {
    it('suspends from active states and reinstates to draft via an operator', () => {
      let model = readModelAt('published_candidate');
      model = apply(model, {
        to: 'suspended',
        actorType: 'operator',
        reason: 'operator suspended the candidate pending re-review',
        occurredAt: '2026-07-06T07:00:00Z',
      });
      assert.equal(model.state, 'suspended');
      assert.deepEqual(
        failCodes(model, { to: 'draft', actorType: 'provider', occurredAt: '2026-07-06T08:00:00Z' }),
        ['operator_action_required'],
      );
      model = apply(model, {
        to: 'draft',
        actorType: 'operator',
        reason: 'operator reinstated the draft for a fresh review pass',
        occurredAt: '2026-07-06T08:00:00Z',
      });
      assert.equal(model.state, 'draft');
    });

    it('only allows reinstatement or rejection out of suspension', () => {
      const model = apply(newReadModel(), {
        to: 'suspended',
        actorType: 'operator',
        reason: 'operator suspended the draft',
      });
      assert.deepEqual([...ONBOARDING_STATE_TRANSITION_GRAPH.suspended].sort(), ['draft', 'rejected']);
      assert.deepEqual(
        failCodes(model, { to: 'published_candidate', actorType: 'operator', occurredAt: '2026-07-06T02:00:00Z' }),
        ['invalid_transition'],
      );
    });
  });

  describe('published_candidate stays internal-only', () => {
    it('never records any hosted write, catalog write, trust/reputation mutation, or payment activation', () => {
      const model = readModelAt('published_candidate');
      assert.equal(model.state, 'published_candidate');
      assert.equal(model.internalCandidateOnly, true);
      assert.equal(model.localReadModelOnly, true);
      assert.equal(model.staticOnly, true);
      assert.deepEqual(model.publication, {
        hostedRegistryWritePerformed: false,
        publicCatalogWritePerformed: false,
        trustMutationPerformed: false,
        reputationMutationPerformed: false,
        paymentActivationPerformed: false,
        endpointInvocationPerformed: false,
        walletOrRpcCallPerformed: false,
      });
      assert.deepEqual(model.guardrails, ONBOARDING_STATE_MACHINE_GUARDRAILS);
      for (const record of model.history) {
        assert.equal(record.scope, 'local_read_model_only');
      }
    });

    it('rejects any requested live side effect fail-closed', () => {
      for (const effect of [
        'hosted_registry_write',
        'public_catalog_write',
        'trust_mutation',
        'reputation_mutation',
        'payment_activation',
        'endpoint_invocation',
        'wallet_rpc',
        'network_fetch',
        'totally_unknown_side_effect',
      ]) {
        const codes = failCodes(readModelAt('approved_unpublished'), {
          to: 'published_candidate',
          actorType: 'operator',
          occurredAt: '2026-07-06T06:00:00Z',
          requestedSideEffects: [effect],
        });
        assert.ok(codes.includes('publication_side_effect_rejected'), `${effect} must be rejected`);
      }
    });
  });

  describe('forbidden import / no-live route-graph guard', () => {
    it('is offline-only: the state machine module imports nothing and references no network/fs/exec/payment surface', () => {
      const sourcePath = fileURLToPath(new URL('../src/onboarding-state-machine.ts', import.meta.url));
      const source = readFileSync(sourcePath, 'utf8');
      assert.ok(!/^\s*import\s/m.test(source), 'state machine module must have zero imports');
      assert.ok(!/\brequire\s*\(/.test(source), 'state machine module must not use require()');
      for (const banned of [
        'node:http',
        'node:https',
        'node:net',
        'node:fs',
        'node:child_process',
        'child_process',
        'fetch(',
        'XMLHttpRequest',
        'WebSocket',
        '@solana/web3.js',
        'Connection(',
        'sendTransaction',
        'signTransaction',
        'ethers',
        'viem',
        'process.env',
        'localStorage',
        'indexedDB',
      ]) {
        assert.ok(!source.includes(banned), `state machine module must not reference ${banned}`);
      }
      assert.ok(!/\basync\b/.test(source), 'state machine module must not contain async code');
      assert.ok(!/\bawait\b/.test(source), 'state machine module must not contain await');
    });
  });
});
