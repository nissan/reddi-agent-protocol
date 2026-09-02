import {
  OFFCHAIN_REPUTATION_PREVIEW_SCHEMA_VERSION,
  type OffchainReputationPreview,
} from './offchain-reputation-preview.js';
import {
  QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION,
  type QuasarRegistryCompatibilityReport,
} from './quasar-registry-compatibility.js';
import {
  RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION,
  type ReceiptEvidenceBinding,
} from './receipt-evidence-binding.js';
import type { RailNeutralPaymentReceipt } from './rail-neutral-payment-receipts.js';

/**
 * `reddi.quasar-reputation-intent.v2` — Quasar-backed reputation instruction
 * fixture gate (#443).
 *
 * v2 supersedes v1 for the post-job-binding current sources and is a breaking
 * record shape, so the identifier changes rather than being reinterpreted:
 * `deferredToInstructionBuilder` is now `{ instructionData, accountInputs }`
 * instead of a flat string list, every record carries a required
 * `escrowBinding` block, and `compactFields.commitment.preimageFields` keys on
 * `escrow_address` instead of the caller-supplied `job_id` the current ABI
 * dropped. A consumer keyed on the v1 identifier keeps rejecting these records
 * rather than reading a shape it cannot parse; nothing re-emits or reinterprets
 * v1.
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
export const QUASAR_REPUTATION_INTENT_SCHEMA_VERSION = 'reddi.quasar-reputation-intent.v2' as const;

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
export const QUASAR_REPUTATION_INTENT_COMPATIBILITY = {
  compatibilitySchemaVersion: QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION,
  compatibilityIssue: 390,
  promotionChecklistIssue: 441,
  deploymentsRef: 'config/quasar/deployments.json',
  boundariesDocRef: 'docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md',
  programs: {
    reputation: {
      lane: 'quasar-reputation',
      role: 'blind commit-reveal rating',
      instructionDiscriminators: { commit: 1, reveal: 2, expire: 3 },
    },
    attestation: {
      lane: 'quasar-attestation',
      role: 'judge attestation response',
      instructionDiscriminators: { attest: 1, confirm: 2, dispute: 3 },
    },
  },
  scoreRange: { min: 1, max: 10 },
  scoreSource: 'reputationEventDraft.rubricScore (0-100) scaled to 1-10',
  commitmentContract: 'sha256(score||salt||escrow_address||program_id)',
  jobBinding: 'escrow-address',
  onchainFieldNames: {
    commit: ['commitment', 'role'],
    reveal: ['score', 'salt'],
    confirm: [],
    dispute: [],
  },
  onchainAccountNames: {
    commit: ['escrow', 'rating', 'signer', 'system_program'],
    reveal: ['escrow', 'rating', 'signer', 'specialist_agent', 'consumer_agent'],
    attest: ['escrow', 'attestation', 'judge_agent', 'judge', 'system_program'],
    confirm: ['escrow', 'attestation', 'judge_agent', 'consumer'],
    dispute: ['escrow', 'attestation', 'judge_agent', 'consumer'],
  },
  pdaSeeds: {
    rating: ['rating', 'escrow_address'],
    attestation: ['attestation', 'escrow_address'],
  },
  /**
   * Source compatibility only. This block mirrors the current
   * `experiments/quasar-*` sources; it is NOT a statement about any deployed
   * program. See `recordedDevnetDeployment` below.
   */
  compatibilityScope: 'repository-sources-only',
  /**
   * The Quasar programs recorded in `config/quasar/deployments.json` predate the
   * job-binding rework described above and expect the older caller-supplied
   * `job_id` layout. They are incompatible with this contract and must not be
   * used. Source compatibility above is not deployment compatibility.
   */
  recordedDevnetDeployment: {
    status: 'incompatible-pre-job-binding',
    usable: false,
    reason:
      'Recorded devnet Quasar programs expect sha256(score||salt||job_id||program_id) with caller-supplied job_id/consumer_pk/specialist_pk and job_id-seeded PDAs. They predate the escrow-address job binding this contract describes.',
    remediation:
      'Exercise Quasar only on a local Surfpool lane against locally built current-source programs (npm run test:surfpool:quasar-critical). No redeploy is claimed.',
  },
  offchainFieldNames: [
    'bindingId',
    'receiptId',
    'evidenceId',
    'evidenceHash',
    'evidenceRef',
    'paymentProofRef',
    'attestationId',
    'reputationEventDraftId',
    'previewId',
    'compatibilityListingId',
  ],
} as const;

export type QuasarReputationIntentKind = 'commit' | 'reveal' | 'confirm' | 'dispute';
export type QuasarReputationIntentStatus = 'intent_ready' | 'blocked';

export type QuasarReputationIntentReasonCode =
  | 'intent_ready'
  | 'fixture_intent_only'
  | 'instruction_not_built'
  | 'buyer_facing_claim_disabled'
  | 'missing_intent_id'
  | 'malformed_intent'
  | 'malformed_binding'
  | 'malformed_source_metadata'
  | 'missing_source_ref'
  | 'unsafe_live_guardrail'
  | 'missing_quasar_compatibility'
  | 'quasar_compatibility_blocked'
  | 'compatibility_subject_mismatch'
  | 'policy_denied'
  | 'payment_preflight_denied'
  | 'missing_payment_proof'
  | 'missing_evidence'
  | 'missing_attestation'
  | 'non_final_state_excluded'
  | 'failure_final_excluded'
  | 'attestation_state_excluded'
  | 'probe_only_receipt_excluded'
  | 'rail_neutral_bridge_required'
  | 'unsupported_network_asset'
  | 'preview_not_ready'
  | 'preview_mismatch'
  | 'missing_reputation_draft'
  | 'no_eligible_intent';

/** Reason codes that always block the whole plan (fail-closed). */
const BLOCKING_REASON_CODES: readonly QuasarReputationIntentReasonCode[] = [
  'missing_intent_id',
  'malformed_intent',
  'malformed_binding',
  'malformed_source_metadata',
  'missing_source_ref',
  'unsafe_live_guardrail',
  'missing_quasar_compatibility',
  'quasar_compatibility_blocked',
  'compatibility_subject_mismatch',
  'policy_denied',
  'payment_preflight_denied',
  'missing_payment_proof',
  'missing_evidence',
  'missing_attestation',
  'non_final_state_excluded',
  'failure_final_excluded',
  'attestation_state_excluded',
  'probe_only_receipt_excluded',
  'rail_neutral_bridge_required',
  'unsupported_network_asset',
  'preview_not_ready',
  'preview_mismatch',
  'no_eligible_intent',
];

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
    /**
     * Instruction-data arguments of the current source ABI, in declaration order:
     * `commit(commitment, role)`, `reveal(score, salt)`, and empty for the argument-less
     * `confirm`/`dispute`. A builder may serialize this list positionally.
     */
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

export type QuasarReputationIntentResult =
  | { ok: true; plan: QuasarReputationIntentPlan }
  | { ok: false; plan: QuasarReputationIntentPlan };

export type QuasarReputationIntentSource =
  | { kind: 'receipt-evidence-binding'; binding: ReceiptEvidenceBinding }
  | { kind: 'rail-neutral'; receipt: RailNeutralPaymentReceipt };

export type QuasarReputationIntentSourceEligibility = {
  eligible: boolean;
  reasonCodes: QuasarReputationIntentReasonCode[];
};

const GUARDRAILS: QuasarReputationIntentPlan['guardrails'] = {
  quasarInstructionBuilt: false,
  walletSigning: false,
  rpcCall: false,
  programDeploy: false,
  livePaymentExecuted: false,
  reputationMutated: false,
  hostedRegistryWrite: false,
  marketplacePublished: false,
};

/**
 * Fail-closed pre-flight eligibility gate (mirrors the #562/#589
 * `evaluateErc8004SourceEligibility` precedent). Rail-neutral receipts never
 * qualify directly: probe-only receipts are excluded outright and binding
 * candidates must bridge into `reddi.receipt.v1` via the proof chain first.
 */
export function evaluateQuasarReputationIntentSourceEligibility(
  source: QuasarReputationIntentSource,
): QuasarReputationIntentSourceEligibility {
  if (!source || (source.kind !== 'receipt-evidence-binding' && source.kind !== 'rail-neutral')) {
    return { eligible: false, reasonCodes: ['malformed_source_metadata'] };
  }

  if (source.kind === 'rail-neutral') {
    const supportState = source.receipt?.supportState;
    if (supportState === 'probe_only') {
      return { eligible: false, reasonCodes: ['probe_only_receipt_excluded'] };
    }
    if (supportState === 'unsupported_receipt_v1_network') {
      return { eligible: false, reasonCodes: ['unsupported_network_asset', 'rail_neutral_bridge_required'] };
    }
    // receipt_binding_candidate (and anything else) must bridge first.
    return { eligible: false, reasonCodes: ['rail_neutral_bridge_required'] };
  }

  const reasonCodes = bindingGateReasonCodes(source.binding);
  return { eligible: reasonCodes.length === 0, reasonCodes };
}

/**
 * Derive the fixture-level intent plan for an eligible reputation/attestation
 * record set. Pure, synchronous, deterministic: the same inputs always
 * produce the same plan, and a plan is data only — nothing is encoded,
 * dispatched, or mutated anywhere.
 */
export function deriveQuasarReputationIntentPlan(input: QuasarReputationIntentInput): QuasarReputationIntentResult {
  const binding = input.binding;
  const preview = input.preview;
  const reasonCodes: QuasarReputationIntentReasonCode[] = [];

  if (!isNonEmptyString(input.id)) reasonCodes.push('missing_intent_id');
  if (!isNonEmptyString(input.createdAt) || Number.isNaN(Date.parse(input.createdAt))) {
    reasonCodes.push('malformed_intent');
  }

  reasonCodes.push(...bindingGateReasonCodes(binding));
  reasonCodes.push(...compatibilityGateReasonCodes(input.compatibility, binding));
  reasonCodes.push(...previewGateReasonCodes(preview, binding));

  const lanes = laneStatesFor(binding, unique(reasonCodes));
  if (lanes.every((lane) => !lane.eligible) && !reasonCodes.some(isBlockingReasonCode)) {
    reasonCodes.push('no_eligible_intent');
  }

  const blocked = reasonCodes.some(isBlockingReasonCode);
  const status: QuasarReputationIntentStatus = blocked ? 'blocked' : 'intent_ready';
  const evidenceSummary = evidenceSummaryFor(input, binding, preview);

  const intents = blocked
    ? []
    : lanes
        .filter((lane) => lane.eligible)
        .map((lane) => intentRecordFor(lane.kind, binding, preview, input.compatibility));

  const normalizedReasonCodes = unique([
    ...(status === 'intent_ready' ? (['intent_ready'] as const) : []),
    ...reasonCodes,
    'fixture_intent_only' as const,
    'instruction_not_built' as const,
    'buyer_facing_claim_disabled' as const,
  ]);

  const plan: QuasarReputationIntentPlan = {
    schemaVersion: QUASAR_REPUTATION_INTENT_SCHEMA_VERSION,
    id: input.id,
    status,
    subject: input.subject ?? inferSubject(binding),
    source: binding?.source ?? { kind: 'static-fixture', sourceId: 'unknown', fixtureRef: 'unknown' },
    compatibility: {
      schemaVersion: QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION,
      issue: 390,
      registrationStatus: input.compatibility?.registrationStatus,
      listingId: input.compatibility?.listingId,
    },
    lanes,
    intents,
    evidenceSummary,
    display: {
      label: status === 'intent_ready' ? 'Quasar intent fixtures ready' : 'Blocked',
      explanation:
        status === 'intent_ready'
          ? 'Fixture-level Quasar intent records are ready for review. No instruction was built, nothing was dispatched or made signable, and reputation state is unchanged.'
          : 'A fail-closed gate rejected this record set; no Quasar intent records were produced.',
      buyerFacingClaimAllowed: false,
    },
    reasonCodes: normalizedReasonCodes,
    guardrails: GUARDRAILS,
    createdAt: input.createdAt,
  };

  return status === 'intent_ready' ? { ok: true, plan } : { ok: false, plan };
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function bindingGateReasonCodes(binding: ReceiptEvidenceBinding | undefined): QuasarReputationIntentReasonCode[] {
  const reasonCodes: QuasarReputationIntentReasonCode[] = [];

  if (!binding || binding.schemaVersion !== RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION || !bindingHasCoreShape(binding)) {
    reasonCodes.push('malformed_binding');
    return reasonCodes;
  }
  if (!isNonEmptyString(binding.id) || !isNonEmptyString(binding.createdAt) || Number.isNaN(Date.parse(binding.createdAt))) {
    reasonCodes.push('malformed_source_metadata');
  }
  if (!hasSourceRef(binding)) reasonCodes.push('missing_source_ref');
  if (!bindingGuardrailsAreSafe(binding)) reasonCodes.push('unsafe_live_guardrail');
  if (binding.receipt?.policyDecision?.allowed !== true) reasonCodes.push('policy_denied');
  if (binding.payment?.preflightAllowed !== true) reasonCodes.push('payment_preflight_denied');
  if (
    !isNonEmptyString(binding.payment?.paymentProofRef)
    || binding.payment?.paymentProofRef !== binding.receipt?.paymentProofRef
  ) {
    reasonCodes.push('missing_payment_proof');
  }
  if (!bindingEvidenceIsComplete(binding)) reasonCodes.push('missing_evidence');

  if (!binding.attestation) {
    reasonCodes.push('missing_attestation');
    return reasonCodes;
  }

  const attestationStatus = binding.receipt?.attestationStatus;
  const verdict = binding.attestation.verdict;
  if (attestationStatus === 'pending' || attestationStatus === 'not_requested') {
    reasonCodes.push('non_final_state_excluded');
  } else if (attestationStatus === 'failed') {
    reasonCodes.push('failure_final_excluded');
  } else if (attestationStatus === 'attested') {
    if (verdict !== 'passed') reasonCodes.push('attestation_state_excluded');
  } else if (attestationStatus === 'rejected') {
    // Only a consumer dispute maps onto the attestation program's dispute
    // lane; failed/refunded verdicts have no intent mapping in v1.
    if (verdict !== 'disputed') reasonCodes.push('attestation_state_excluded');
  } else {
    reasonCodes.push('malformed_source_metadata');
  }

  return reasonCodes;
}

function compatibilityGateReasonCodes(
  compatibility: QuasarRegistryCompatibilityReport | undefined,
  binding: ReceiptEvidenceBinding | undefined,
): QuasarReputationIntentReasonCode[] {
  const reasonCodes: QuasarReputationIntentReasonCode[] = [];

  if (!compatibility || compatibility.schemaVersion !== QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION) {
    reasonCodes.push('missing_quasar_compatibility');
    return reasonCodes;
  }
  if (!compatibilityGuardrailsAreSafe(compatibility)) reasonCodes.push('unsafe_live_guardrail');
  if (compatibility.registrationStatus === 'blocked') reasonCodes.push('quasar_compatibility_blocked');
  if (!compatibilitySubjectMatchesBinding(compatibility, binding)) reasonCodes.push('compatibility_subject_mismatch');

  return reasonCodes;
}

function previewGateReasonCodes(
  preview: OffchainReputationPreview | undefined,
  binding: ReceiptEvidenceBinding | undefined,
): QuasarReputationIntentReasonCode[] {
  if (preview === undefined) return [];
  const reasonCodes: QuasarReputationIntentReasonCode[] = [];

  if (preview.schemaVersion !== OFFCHAIN_REPUTATION_PREVIEW_SCHEMA_VERSION || !preview.evidenceSummary) {
    reasonCodes.push('preview_mismatch');
    return reasonCodes;
  }
  if (!previewGuardrailsAreSafe(preview)) reasonCodes.push('unsafe_live_guardrail');
  if (preview.status !== 'preview_ready') reasonCodes.push('preview_not_ready');
  if (!previewEvidenceMatchesBinding(preview, binding)) reasonCodes.push('preview_mismatch');

  return reasonCodes;
}

// ---------------------------------------------------------------------------
// Lane mapping
// ---------------------------------------------------------------------------

function laneStatesFor(
  binding: ReceiptEvidenceBinding | undefined,
  gateReasonCodes: QuasarReputationIntentReasonCode[],
): QuasarReputationIntentLaneState[] {
  const blocked = gateReasonCodes.some(isBlockingReasonCode);
  const attestationStatus = binding?.receipt?.attestationStatus;
  const verdict = binding?.attestation?.verdict;
  const score = ratingScoreFor(binding);

  const lane = (
    kind: QuasarReputationIntentKind,
    eligible: boolean,
    ineligibleReason: QuasarReputationIntentReasonCode,
  ): QuasarReputationIntentLaneState => ({
    kind,
    eligible: !blocked && eligible,
    reasonCodes: blocked
      ? ['fixture_intent_only']
      : eligible
        ? ['intent_ready', 'fixture_intent_only']
        : [ineligibleReason, 'fixture_intent_only'],
  });

  const ratingLanesEligible = score !== undefined;
  const ratingLaneReason: QuasarReputationIntentReasonCode = binding?.reputationEventDraft
    ? 'malformed_source_metadata'
    : 'missing_reputation_draft';

  return [
    lane('commit', ratingLanesEligible, ratingLaneReason),
    lane('reveal', ratingLanesEligible, ratingLaneReason),
    lane('confirm', attestationStatus === 'attested' && verdict === 'passed', 'attestation_state_excluded'),
    lane('dispute', attestationStatus === 'rejected' && verdict === 'disputed', 'attestation_state_excluded'),
  ];
}

function intentRecordFor(
  kind: QuasarReputationIntentKind,
  binding: ReceiptEvidenceBinding,
  preview: OffchainReputationPreview | undefined,
  compatibility: QuasarRegistryCompatibilityReport | undefined,
): QuasarReputationIntentRecord {
  const jobIdRef = binding.receipt.id;
  const score = ratingScoreFor(binding);

  const base = {
    schemaVersion: QUASAR_REPUTATION_INTENT_SCHEMA_VERSION,
    kind,
    offchainRefs: {
      bindingId: binding.id,
      receiptId: binding.receipt.id,
      evidenceId: binding.evidence.id,
      evidenceHash: binding.evidence.evidenceHash,
      evidenceRef: binding.evidence.evidenceRef,
      paymentProofRef: binding.payment.paymentProofRef,
      attestationId: binding.attestation?.id ?? '',
      reputationEventDraftId: binding.reputationEventDraft?.id,
      previewId: preview?.id,
      compatibilityListingId: compatibility?.listingId,
    },
    instructionBuilt: false as const,
    signable: false as const,
  };

  if (kind === 'commit') {
    return {
      ...base,
      program: reputationProgramLane('commit', 1),
      compactFields: {
        jobIdRef,
        role: 'consumer',
        commitment: {
          algorithm: 'sha256',
          preimageFields: ['score', 'salt', 'escrow_address', 'program_id'],
          state: 'not_computed',
        },
      },
      escrowBinding: escrowBindingFor('rating'),
      deferredToInstructionBuilder: {
        instructionData: ['commitment_hash', 'role_u8_encoding'],
        accountInputs: QUASAR_REPUTATION_INTENT_COMPATIBILITY.onchainAccountNames.commit,
      },
    };
  }

  if (kind === 'reveal') {
    return {
      ...base,
      program: reputationProgramLane('reveal', 2),
      compactFields: { jobIdRef, score },
      escrowBinding: escrowBindingFor('rating'),
      deferredToInstructionBuilder: {
        instructionData: ['score_u8_encoding', 'salt'],
        accountInputs: QUASAR_REPUTATION_INTENT_COMPATIBILITY.onchainAccountNames.reveal,
      },
    };
  }

  if (kind === 'confirm') {
    return {
      ...base,
      program: attestationProgramLane('confirm', 2),
      compactFields: { jobIdRef },
      escrowBinding: escrowBindingFor('attestation'),
      // `confirm` takes no instruction data under the current sources; the
      // consumer is authorised by signer identity against `attestation.consumer`.
      deferredToInstructionBuilder: {
        instructionData: [],
        accountInputs: QUASAR_REPUTATION_INTENT_COMPATIBILITY.onchainAccountNames.confirm,
      },
    };
  }

  return {
    ...base,
    program: attestationProgramLane('dispute', 3),
    compactFields: { jobIdRef },
    escrowBinding: escrowBindingFor('attestation'),
    // `dispute` is likewise argument-less; see the `confirm` note above.
    deferredToInstructionBuilder: {
      instructionData: [],
      accountInputs: QUASAR_REPUTATION_INTENT_COMPATIBILITY.onchainAccountNames.dispute,
    },
  };
}

/**
 * The escrow-address job binding for one lane. Always `not_resolved`: the
 * address only exists once a real `quasar-escrow::lock` has created the
 * escrow, which no fixture-level record may assert.
 */
function escrowBindingFor(
  lane: 'rating' | 'attestation',
): QuasarReputationIntentRecord['escrowBinding'] {
  return {
    source: 'verified-lock-created-escrow',
    pdaSeeds: [lane, 'escrow_address'],
    state: 'not_resolved',
  };
}

function reputationProgramLane(
  instructionName: 'commit' | 'reveal',
  discriminator: 1 | 2,
): QuasarReputationIntentRecord['program'] {
  return {
    lane: 'quasar-reputation',
    deploymentsRef: QUASAR_REPUTATION_INTENT_COMPATIBILITY.deploymentsRef,
    instructionName,
    discriminator,
  };
}

function attestationProgramLane(
  instructionName: 'confirm' | 'dispute',
  discriminator: 2 | 3,
): QuasarReputationIntentRecord['program'] {
  return {
    lane: 'quasar-attestation',
    deploymentsRef: QUASAR_REPUTATION_INTENT_COMPATIBILITY.deploymentsRef,
    instructionName,
    discriminator,
  };
}

/**
 * Scale the 0-100 reputation event draft rubric score onto the program's
 * 1-10 rating range. Deterministic; undefined whenever the draft is missing
 * or its rubric score is not an integer in range.
 */
function ratingScoreFor(binding: ReceiptEvidenceBinding | undefined): number | undefined {
  const rubricScore = binding?.reputationEventDraft?.rubricScore;
  if (typeof rubricScore !== 'number' || !Number.isInteger(rubricScore) || rubricScore < 0 || rubricScore > 100) {
    return undefined;
  }
  return Math.min(
    QUASAR_REPUTATION_INTENT_COMPATIBILITY.scoreRange.max,
    Math.max(QUASAR_REPUTATION_INTENT_COMPATIBILITY.scoreRange.min, Math.round(rubricScore / 10)),
  );
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

function bindingHasCoreShape(binding: ReceiptEvidenceBinding | undefined): boolean {
  return Boolean(
    binding?.receipt
    && binding.evidence
    && binding.payment
    && binding.guardrails
    && typeof binding.receipt === 'object'
    && typeof binding.evidence === 'object'
    && typeof binding.payment === 'object'
    && typeof binding.guardrails === 'object',
  );
}

function bindingEvidenceIsComplete(binding: ReceiptEvidenceBinding): boolean {
  return isNonEmptyString(binding.receipt?.id)
    && isNonEmptyString(binding.evidence?.id)
    && isNonEmptyString(binding.evidence?.evidenceHash)
    && isNonEmptyString(binding.evidence?.evidenceRef)
    && isNonEmptyString(binding.receipt?.evidenceRef)
    && binding.evidence.evidenceRef === binding.receipt.evidenceRef
    && binding.evidence.receiptId === binding.receipt.id;
}

function bindingGuardrailsAreSafe(binding: ReceiptEvidenceBinding | undefined): boolean {
  if (!binding?.guardrails) return false;
  return binding.guardrails.rawPromptStored === false
    && binding.guardrails.rawOutputStored === false
    && binding.guardrails.livePaymentExecuted === false
    && binding.guardrails.walletSigning === false
    && binding.guardrails.rpcCall === false
    && binding.guardrails.hostedRegistryRequired === false
    && binding.guardrails.reputationMutated === false;
}

function compatibilityGuardrailsAreSafe(compatibility: QuasarRegistryCompatibilityReport): boolean {
  const guardrails = compatibility.guardrails;
  if (!guardrails) return false;
  return guardrails.instructionBuilt === false
    && guardrails.walletSigning === false
    && guardrails.rpcCall === false
    && guardrails.programDeploy === false
    && guardrails.livePaymentExecuted === false
    && guardrails.richMetadataOnchain === false
    && guardrails.auddCustodyOnchain === false
    && guardrails.endpointOnchain === false
    && guardrails.evidencePayloadOnchain === false
    && guardrails.trustBadgeOnchain === false;
}

function previewGuardrailsAreSafe(preview: OffchainReputationPreview): boolean {
  if (!preview.guardrails || preview.display?.buyerFacingClaimAllowed !== false) return false;
  return preview.guardrails.reputationMutated === false
    && preview.guardrails.quasarInstructionBuilt === false
    && preview.guardrails.walletSigning === false
    && preview.guardrails.rpcCall === false
    && preview.guardrails.hostedRegistryWrite === false
    && preview.guardrails.marketplacePublished === false
    && preview.guardrails.livePaymentExecuted === false;
}

function compatibilitySubjectMatchesBinding(
  compatibility: QuasarRegistryCompatibilityReport,
  binding: ReceiptEvidenceBinding | undefined,
): boolean {
  if (!binding?.source) return false;
  if (isNonEmptyString(binding.source.listingId)) return compatibility.listingId === binding.source.listingId;
  if (isNonEmptyString(binding.source.profileId)) return compatibility.profileId === binding.source.profileId;
  return false;
}

function previewEvidenceMatchesBinding(
  preview: OffchainReputationPreview,
  binding: ReceiptEvidenceBinding | undefined,
): boolean {
  if (!preview.evidenceSummary || !bindingHasCoreShape(binding)) return false;
  return preview.evidenceSummary.bindingId === binding?.id
    && preview.evidenceSummary.receiptId === binding.receipt.id
    && preview.evidenceSummary.evidenceId === binding.evidence.id
    && preview.evidenceSummary.evidenceHash === binding.evidence.evidenceHash
    && preview.evidenceSummary.evidenceRef === binding.receipt.evidenceRef
    && preview.evidenceSummary.paymentProofRef === binding.receipt.paymentProofRef
    && preview.evidenceSummary.attestationId === binding.attestation?.id;
}

function hasSourceRef(binding: ReceiptEvidenceBinding | undefined): boolean {
  if (!binding?.source?.sourceId) return false;
  return [
    binding.source.catalogRef,
    binding.source.fixtureRef,
    binding.source.listingId,
    binding.source.profileId,
    binding.source.rawSnapshotRef,
  ].some(isNonEmptyString);
}

function evidenceSummaryFor(
  input: QuasarReputationIntentInput,
  binding: ReceiptEvidenceBinding | undefined,
  preview: OffchainReputationPreview | undefined,
): QuasarReputationIntentPlan['evidenceSummary'] {
  return {
    bindingId: binding?.id ?? input.id,
    receiptId: binding?.receipt?.id ?? '',
    evidenceId: binding?.evidence?.id ?? '',
    evidenceHash: binding?.evidence?.evidenceHash ?? '',
    evidenceRef: binding?.receipt?.evidenceRef ?? '',
    paymentProofRef: binding?.receipt?.paymentProofRef ?? '',
    attestationId: binding?.attestation?.id,
    reputationEventDraftId: binding?.reputationEventDraft?.id,
    previewId: preview?.id,
  };
}

function inferSubject(binding: ReceiptEvidenceBinding | undefined): QuasarReputationIntentPlan['subject'] {
  const draft = binding?.reputationEventDraft;
  if (draft?.subjectId) {
    return { id: draft.subjectId, type: binding?.source?.listingId ? 'listing' : 'specialist' };
  }
  if (binding?.source?.listingId) return { id: binding.source.listingId, type: 'listing' };
  if (binding?.source?.profileId) return { id: binding.source.profileId, type: 'specialist' };
  return { id: 'unknown', type: 'specialist' };
}

function isBlockingReasonCode(code: QuasarReputationIntentReasonCode): boolean {
  return BLOCKING_REASON_CODES.includes(code);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
