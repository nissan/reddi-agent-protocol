import { ERC8004_EXPORT_SCHEMA_VERSION, evaluateErc8004SourceEligibility, exportReceiptToErc8004, } from './erc8004-export.js';
import { verifyReputationCredential, } from './reputation-credential-export.js';
/**
 * `reddi.erc8004-export-conformance.v1` — NO-LIVE conformance surface for the
 * `reddi.erc8004-export.v1` spec (#562).
 *
 * Proves the round-trip the issue asks for, entirely offline and
 * deterministically: RAP source (receipt / attestation / portable reputation
 * credential) → ERC-8004 registry entry shapes → verified field-by-field back
 * against the source. No chain access, no RPC, no live calls anywhere; chain
 * refs in fixtures are placeholders marked unverified.
 *
 * Also fixes the exclusion rules as executable fixtures: probe-only
 * rail-neutral receipts, rail-neutral binding candidates that have not bridged
 * into `reddi.receipt.v1`, dry-run receipts without payment proof refs,
 * failure-final receipts (attestationStatus failed/rejected), non-final or
 * non-passed attestations, and malformed chain hints all fail closed and never
 * export.
 */
export const ERC8004_CONFORMANCE_SCHEMA_VERSION = 'reddi.erc8004-export-conformance.v1';
const EXPECTED_TOP_LEVEL_KEYS = new Set([
    'schemaVersion',
    'draft',
    'externalStandard',
    'exportIntent',
    'targetChainHint',
    'identity',
    'reputation',
    'validation',
    'reasonCodes',
    'crossReference',
    'guardrails',
    'notes',
]);
const CHAIN_HINT_PATTERN = /^eip155:\d+$/;
/**
 * Verify an exported ERC-8004 bundle FIELD-BY-FIELD against the RAP source it
 * was projected from — the offline "round-trip" of #562. Deterministic and
 * pure: every check recomputes the expected value from the source and compares
 * it to the emitted bundle; any tampering with either side fails a check.
 *
 * A blocked bundle never round-trips (there is nothing to verify against the
 * source) — callers asserting exclusion lanes should check reason codes instead.
 */
export function verifyErc8004ExportAgainstSource(bundle, source) {
    const checks = [];
    const check = (id, ok, detail) => {
        checks.push({ id, ok, detail });
    };
    const receipt = source.receipt;
    const attestation = source.attestation;
    check('export_not_blocked', bundle?.exportIntent !== 'blocked', 'a blocked bundle has no source round-trip; exclusion lanes are asserted via reason codes');
    if (bundle?.exportIntent === 'blocked') {
        return { schemaVersion: ERC8004_CONFORMANCE_SCHEMA_VERSION, ok: false, checks };
    }
    check('schema_version', bundle.schemaVersion === ERC8004_EXPORT_SCHEMA_VERSION, `schemaVersion must be ${ERC8004_EXPORT_SCHEMA_VERSION}`);
    check('spec_promoted_external_standard_honest', bundle.draft === false
        && bundle.externalStandard?.fieldShapesVerified === false
        && bundle.externalStandard?.deploymentClaim === false, 'RAP-side spec is promoted (draft:false) while ERC-8004 field shapes stay marked unverified with no deployment claim');
    check('no_unknown_top_level_keys', Object.keys(bundle).every((key) => EXPECTED_TOP_LEVEL_KEYS.has(key)), 'bundle must not invent fields outside the reddi.erc8004-export.v1 spec');
    check('guardrails_all_false', bundle.guardrails.minted === false
        && bundle.guardrails.onchainWrite === false
        && bundle.guardrails.signerInvoked === false
        && bundle.guardrails.rpcCall === false
        && bundle.guardrails.evidencePayloadInlined === false
        && bundle.guardrails.liveSignatureVerified === false
        && bundle.guardrails.trustImported === false, 'no guardrail may imply an on-chain write, live verification, or trust import');
    // Cross-reference block reconstructs from the receipt alone.
    const expectedNetworkAsset = `${receipt.payment.network}:${String(receipt.payment.asset).trim().toUpperCase()}`;
    const expectedSolanaRef = `${receipt.payment.network}/${receipt.specialist.id}`;
    check('cross_reference_network_asset', bundle.crossReference.solanaNetworkAsset === expectedNetworkAsset, `crossReference.solanaNetworkAsset must recompute to ${expectedNetworkAsset}`);
    check('cross_reference_solana_ref', bundle.crossReference.solanaAgentRef === expectedSolanaRef, `crossReference.solanaAgentRef must recompute to ${expectedSolanaRef}`);
    // Chain hints are fixture placeholders: CAIP-2 shaped and never a deployment claim.
    if (bundle.targetChainHint !== undefined) {
        check('chain_hint_placeholder_unverified', CHAIN_HINT_PATTERN.test(bundle.targetChainHint)
            && bundle.crossReference.evmChainHint === bundle.targetChainHint
            && bundle.externalStandard.deploymentClaim === false, 'targetChainHint must be a CAIP-2 eip155:* fixture placeholder with no deployment claim');
    }
    // Identity registry entry reconstructs from the receipt.
    if (bundle.identity === null) {
        check('identity_present', false, 'a non-blocked bundle must carry an identity payload');
    }
    else {
        check('identity_name_matches_specialist', bundle.identity.registrationFile.name === receipt.specialist.id, 'registrationFile.name must equal receipt.specialist.id');
        check('identity_endpoint_matches', bundle.identity.registrationFile.endpoint === receipt.specialist.endpoint, 'registrationFile.endpoint must equal receipt.specialist.endpoint');
        check('identity_protocol_matches', bundle.identity.registrationFile.protocol.name === receipt.protocol.name
            && bundle.identity.registrationFile.protocol.version === receipt.protocol.version, 'registrationFile.protocol must equal receipt.protocol');
        check('identity_solana_ref_reconstructs', bundle.identity.registrationFile.solanaAgentRef === expectedSolanaRef, 'registrationFile.solanaAgentRef must recompute from receipt payment network + specialist id');
        const expectedMetadata = [
            { key: 'reddi.protocol', value: `${receipt.protocol.name}@${receipt.protocol.version}` },
            { key: 'reddi.specialistId', value: receipt.specialist.id },
            { key: 'reddi.solanaAgentRef', value: expectedSolanaRef },
            ...(typeof receipt.job.type === 'string' && receipt.job.type.trim().length > 0
                ? [{ key: 'reddi.jobType', value: receipt.job.type }]
                : []),
        ];
        check('identity_metadata_derivable', JSON.stringify(bundle.identity.metadata) === JSON.stringify(expectedMetadata), 'every identity metadata entry must recompute from the receipt with no invented keys');
    }
    // Reputation registry entry reconstructs from the attestation + receipt.
    if (bundle.reputation !== null) {
        if (attestation === undefined) {
            check('reputation_requires_source_attestation', false, 'bundle carries a reputation payload but the source has no attestation');
        }
        else {
            const expectedScore = Math.max(0, Math.min(100, Math.round(attestation.confidence)));
            const reconstructed = Number(bundle.reputation.value) / 10 ** bundle.reputation.valueDecimals;
            check('reputation_value_reconstructs', reconstructed === expectedScore, `value/10^valueDecimals must reconstruct the attestation confidence (${expectedScore})`);
            check('reputation_tag1_is_verdict', bundle.reputation.tag1 === attestation.verdict, 'tag1 must equal the attestation verdict');
            const allowedTag2 = new Set([attestation.rubric?.dimensions?.[0]?.id, receipt.job.type, 'unspecified'].filter((v) => typeof v === 'string'));
            check('reputation_tag2_from_source_vocabulary', allowedTag2.has(bundle.reputation.tag2), 'tag2 must come from the rubric dimension ids or the receipt job type');
            check('reputation_evidence_matches', bundle.reputation.payloadURI === attestation.evidenceRef && bundle.reputation.payloadHash === attestation.evidenceHash, 'payloadURI/payloadHash must equal the attestation evidenceRef/evidenceHash (URI + hash only, never the raw payload)');
            check('reputation_endpoint_matches', bundle.reputation.endpointURI === receipt.specialist.endpoint, 'endpointURI must equal receipt.specialist.endpoint');
            check('reputation_source_is_final', receipt.attestationStatus === 'attested' && attestation.verdict === 'passed' && attestation.workStatus === 'completed' && attestation.receiptId === receipt.job.id, 'an exported reputation entry must be backed by an attested receipt and a passed+completed attestation referencing it');
        }
        // Composition with the portable reputation credential (#565): reference, not duplication.
        if (bundle.reputation.credentialRef !== undefined) {
            const credential = source.reputationCredential;
            const verified = verifyReputationCredential(credential);
            const ref = bundle.reputation.credentialRef;
            check('credential_ref_source_verifies_offline', verified.ok, 'the source portable credential must verify offline (ed25519 over the canonical body)');
            if (verified.ok) {
                check('credential_ref_matches_source', ref.credentialId === verified.credential.credential.id
                    && ref.subjectId === verified.credential.credential.subject.id
                    && ref.subjectId === receipt.specialist.id
                    && ref.score === verified.credential.credential.reputation.score
                    && JSON.stringify(ref.evidenceHashes) === JSON.stringify(verified.credential.credential.evidence.map((e) => e.evidenceHash))
                    && ref.proof.publicKey === verified.credential.proof.publicKey, 'credentialRef must reference the verified credential (id, subject, score, evidence hashes, public key) without duplicating its signature');
                check('credential_ref_binds_attestation_evidence', attestation !== undefined && ref.evidenceHashes.includes(attestation.evidenceHash), 'the credential evidence hashes must include the attestation evidence hash backing the reputation entry');
                check('credential_ref_no_signature_duplicated', !JSON.stringify(ref).includes(verified.credential.proof.signature), 'the portable credential signature must not be duplicated into the ERC-8004 payload');
            }
        }
        else if (source.reputationCredential !== undefined) {
            check('credential_ref_present_when_supplied', false, 'a verified credential was supplied to the export but no credentialRef was emitted');
        }
    }
    else if (attestation !== undefined) {
        // Source had an attestation but nothing exported: the bundle must say why.
        const exclusionCodes = [
            'attestation_state_excluded',
            'attestation_receipt_mismatch',
            'attestation_malformed',
        ];
        check('reputation_exclusion_recorded', bundle.reasonCodes.some((code) => exclusionCodes.includes(code)), 'when a supplied attestation does not export, the bundle must record the exclusion reason code');
    }
    // Validation registry entry reconstructs from the receipt + attestation.
    if (bundle.validation !== null) {
        if (attestation === undefined) {
            check('validation_requires_source_attestation', false, 'bundle carries a validation payload but the source has no attestation');
        }
        else {
            const expectedScore = Math.max(0, Math.min(100, Math.round(attestation.confidence)));
            check('validation_matches_source', bundle.validation.requestHash === receipt.requestHash
                && bundle.validation.hash === receipt.responseHash
                && bundle.validation.responseURI === receipt.evidenceRef
                && bundle.validation.response === expectedScore
                && bundle.validation.tag === attestation.verdict
                && bundle.validation.experimental === true, 'validation payload must reconstruct from receipt request/response/evidence refs and the attestation score, and stay flagged experimental');
            check('validation_flagged_in_reason_codes', bundle.reasonCodes.includes('validation_registry_experimental'), 'emitting a validation payload must be flagged with validation_registry_experimental');
        }
    }
    const ok = checks.every((entry) => entry.ok);
    return { schemaVersion: ERC8004_CONFORMANCE_SCHEMA_VERSION, ok, checks };
}
function fixturePolicyDecision() {
    return {
        schemaVersion: 'reddi.policy-decision.v1',
        allowed: true,
        reasonCodes: ['allowed'],
        quotedAmount: { amount: '2500000', asset: 'AUDD', network: 'solana-devnet' },
        asset: 'AUDD',
        network: 'solana-devnet',
        approvalState: 'approved',
        auditNotes: ['conformance fixture policy decision'],
    };
}
function fixtureReceipt(overrides = {}) {
    return {
        schemaVersion: 'reddi.receipt.v1',
        job: { id: 'job:conformance:562', type: 'summarize' },
        source: { id: 'source:conformance:ai-catalog' },
        payer: { id: 'payer:conformance:orchestrator' },
        specialist: { id: 'specialist:conformance:research-agent', endpoint: 'https://agents.example/research' },
        protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
        payment: {
            network: 'solana-devnet',
            asset: 'AUDD',
            amount: '2500000',
            paymentProofRef: 'evidence:payment:conformance-562',
        },
        requestHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        responseHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        evidenceRef: 'https://evidence.example/receipts/conformance-562.json',
        policyDecision: fixturePolicyDecision(),
        attestationStatus: 'attested',
        createdAt: '2026-07-06T00:00:00.000Z',
        ...overrides,
    };
}
function fixtureAttestation(overrides = {}) {
    return {
        schemaVersion: 'reddi.attestation.v1',
        id: 'attestation:conformance:562',
        receiptId: 'job:conformance:562',
        evidenceId: 'evidence:conformance:562',
        evidenceRef: 'https://evidence.example/attestations/conformance-562.json',
        evidenceHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        attestor: { id: 'attestor:conformance:reddi', type: 'reddi' },
        trustBoundary: 'reddi_attested',
        verdict: 'passed',
        workStatus: 'completed',
        confidence: 95,
        rubric: {
            dimensions: [
                { id: 'evidence_integrity', score: 96, weight: 3, summary: 'evidence intact', reasonCodes: ['evidence_attached'] },
                { id: 'policy_compliance', score: 94, weight: 2, summary: 'policy respected', reasonCodes: ['policy_ok'] },
                { id: 'delivery_quality', score: 95, weight: 2, summary: 'delivered well', reasonCodes: ['delivery_ok'] },
            ],
        },
        createdAt: '2026-07-06T00:00:00.000Z',
        ...overrides,
    };
}
function railNeutralGuardrails() {
    return {
        fixtureOnly: true,
        livePaymentExecuted: false,
        walletSigning: false,
        rpcCall: false,
        providerCall: false,
        hostedRegistryWrite: false,
        marketplacePublication: false,
        trustUpgrade: false,
        reputationMutation: false,
        settlementProof: false,
        custodyClaim: false,
    };
}
/**
 * Probe-only rail-neutral receipt fixture (mirrors the #580/#588 Airwallex
 * shape). Probe-only receipts NEVER export to ERC-8004.
 */
function probeOnlyRailNeutralReceiptFixture() {
    return {
        schemaVersion: 'reddi.rail-neutral-payment-receipt.v1',
        rail: 'airwallex-hosted-checkout',
        case: 'airwallex_webhook_probe_only',
        supportState: 'probe_only',
        source: { kind: 'static-fixture', sourceId: 'source:conformance:probe-only-fixture' },
        payment: {
            network: 'fiat-aud',
            asset: 'AUD',
            amount: '2500',
            unit: 'fiat-minor-units',
            paymentProofRef: 'fixture:webhook-event:conformance-562',
        },
        bindingRefs: {
            evidenceRef: 'fixture:evidence:conformance-562',
            requestHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
            responseHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            recipientRef: 'fixture:recipient:conformance-562',
            nonceRef: 'fixture:nonce:conformance-562',
            operatorApprovalRef: 'fixture:operator-approval:conformance-562',
        },
        policy: { allowed: true, reasonCodes: ['allowed'], auditNotes: ['conformance fixture'] },
        bindingIntegration: {
            schemaVersion: 'reddi.receipt-evidence-binding.v1',
            compatible: false,
            requiredReceiptSchemaVersion: 'reddi.receipt.v1',
            incompatibilityReasons: ['probe_only cap: revocable rail with no receipt-v1 revoked/contested state (#338 gap, #588 cap)'],
        },
        claimBoundary: ['fixture only; no custody, settlement finality, or live payment claim'],
        guardrails: railNeutralGuardrails(),
    };
}
/** Binding-candidate rail-neutral fixture — must bridge to reddi.receipt.v1 first. */
function bindingCandidateRailNeutralReceiptFixture() {
    return {
        ...probeOnlyRailNeutralReceiptFixture(),
        rail: 'pay-sh-sandbox',
        case: 'pay_sh_sandbox_binding_candidate',
        supportState: 'receipt_binding_candidate',
        payment: {
            network: 'solana-devnet',
            asset: 'USDC',
            amount: '2500000',
            unit: 'microusd',
            paymentProofRef: 'fixture:sandbox-payment:conformance-562',
        },
        bindingIntegration: {
            schemaVersion: 'reddi.receipt-evidence-binding.v1',
            compatible: true,
            requiredReceiptSchemaVersion: 'reddi.receipt.v1',
        },
    };
}
/**
 * The #562 conformance fixture set. Deterministic, self-describing, and
 * executable via `runErc8004ConformanceSuite()`. Chain refs are CAIP-2 fixture
 * placeholders; nothing here touches a chain, RPC, or live service.
 */
export function listErc8004ConformanceFixtures() {
    return [
        {
            kind: 'export',
            case: 'full_export_round_trip',
            description: 'attested receipt + passed attestation exports Identity/Reputation/Validation entries that verify field-by-field against the source; eip155:8453 is a fixture placeholder, not a deployment claim',
            receipt: fixtureReceipt(),
            attestation: fixtureAttestation(),
            options: { includeValidation: true, targetChainHint: 'eip155:8453' },
            expected: {
                exportIntent: 'exportable',
                reasonCodes: ['erc8004_export_ok', 'validation_registry_experimental'],
                roundTrip: true,
            },
        },
        {
            kind: 'export',
            case: 'metadata_only_no_attestation',
            description: 'a valid attested receipt without a supplied attestation exports identity metadata only',
            receipt: fixtureReceipt(),
            expected: {
                exportIntent: 'metadata_only',
                reasonCodes: ['erc8004_export_ok', 'attestation_missing'],
                roundTrip: true,
            },
        },
        {
            kind: 'export',
            case: 'dry_run_missing_payment_proof_excluded',
            description: 'a receipt without a payment proof ref (dry-run / unproven) never exports',
            receipt: fixtureReceipt({
                payment: { network: 'solana-devnet', asset: 'AUDD', amount: '2500000', paymentProofRef: '' },
            }),
            attestation: fixtureAttestation(),
            expected: {
                exportIntent: 'blocked',
                reasonCodes: ['payment_proof_missing_excluded'],
                roundTrip: false,
            },
        },
        {
            kind: 'export',
            case: 'failure_final_receipt_excluded',
            description: 'a receipt whose attestationStatus is rejected (failure-final) never exports, even with a passed attestation supplied',
            receipt: fixtureReceipt({ attestationStatus: 'rejected' }),
            attestation: fixtureAttestation(),
            expected: {
                exportIntent: 'blocked',
                reasonCodes: ['non_final_receipt_excluded'],
                roundTrip: false,
            },
        },
        {
            kind: 'export',
            case: 'pending_receipt_attestation_excluded',
            description: 'a pending (non-final) receipt exports identity metadata at most; the supplied attestation is excluded',
            receipt: fixtureReceipt({ attestationStatus: 'pending' }),
            attestation: fixtureAttestation(),
            expected: {
                exportIntent: 'metadata_only',
                reasonCodes: ['erc8004_export_ok', 'attestation_state_excluded'],
                roundTrip: true,
            },
        },
        {
            kind: 'export',
            case: 'disputed_attestation_excluded',
            description: 'a disputed attestation never becomes an ERC-8004 feedback entry (negative-feedback export is out of v1 scope)',
            receipt: fixtureReceipt(),
            attestation: fixtureAttestation({ verdict: 'disputed', workStatus: 'disputed' }),
            expected: {
                exportIntent: 'metadata_only',
                reasonCodes: ['erc8004_export_ok', 'attestation_state_excluded'],
                roundTrip: true,
            },
        },
        {
            kind: 'export',
            case: 'mismatched_attestation_excluded',
            description: 'an attestation that does not reference this receipt is excluded fail-closed',
            receipt: fixtureReceipt(),
            attestation: fixtureAttestation({ receiptId: 'job:other:999' }),
            expected: {
                exportIntent: 'metadata_only',
                reasonCodes: ['erc8004_export_ok', 'attestation_receipt_mismatch'],
                roundTrip: true,
            },
        },
        {
            kind: 'export',
            case: 'unsupported_chain_hint_blocked',
            description: 'a non-CAIP-2 (non-eip155) chain hint fails closed; hints are placeholders, never deployments',
            receipt: fixtureReceipt(),
            attestation: fixtureAttestation(),
            options: { targetChainHint: 'solana:mainnet' },
            expected: {
                exportIntent: 'blocked',
                reasonCodes: ['unsupported_chain_hint'],
                roundTrip: false,
            },
        },
        {
            kind: 'eligibility',
            case: 'probe_only_rail_neutral_excluded',
            description: 'probe-only rail-neutral receipts (#580/#588 cap) never export to ERC-8004',
            source: { kind: 'rail-neutral', receipt: probeOnlyRailNeutralReceiptFixture() },
            expected: { eligible: false, reasonCodes: ['probe_only_receipt_excluded'] },
        },
        {
            kind: 'eligibility',
            case: 'rail_neutral_binding_candidate_requires_bridge',
            description: 'rail-neutral binding candidates must bridge into reddi.receipt.v1 via the proof chain before ERC-8004 export — never exported directly',
            source: { kind: 'rail-neutral', receipt: bindingCandidateRailNeutralReceiptFixture() },
            expected: { eligible: false, reasonCodes: ['rail_neutral_bridge_required'] },
        },
    ];
}
/**
 * Execute every conformance fixture offline and verify its expectation:
 * export fixtures assert intent + exact reason codes (+ full source round-trip
 * where expected); eligibility fixtures assert the exclusion gate. Pure and
 * deterministic — safe to run anywhere, no chain or RPC access.
 */
export function runErc8004ConformanceSuite() {
    const cases = [];
    for (const fixture of listErc8004ConformanceFixtures()) {
        const failures = [];
        if (fixture.kind === 'eligibility') {
            const eligibility = evaluateErc8004SourceEligibility(fixture.source);
            if (eligibility.eligible !== fixture.expected.eligible) {
                failures.push(`expected eligible=${fixture.expected.eligible}, got ${eligibility.eligible}`);
            }
            for (const code of fixture.expected.reasonCodes) {
                if (!eligibility.reasonCodes.includes(code))
                    failures.push(`missing expected reason code ${code}`);
            }
            cases.push({ case: fixture.case, kind: 'eligibility', pass: failures.length === 0, failures });
            continue;
        }
        const bundle = exportReceiptToErc8004(fixture.receipt, fixture.attestation, fixture.options ?? {});
        if (bundle.exportIntent !== fixture.expected.exportIntent) {
            failures.push(`expected exportIntent=${fixture.expected.exportIntent}, got ${bundle.exportIntent}`);
        }
        if (JSON.stringify([...bundle.reasonCodes].sort()) !== JSON.stringify([...fixture.expected.reasonCodes].sort())) {
            failures.push(`expected reasonCodes ${fixture.expected.reasonCodes.join(',')}, got ${bundle.reasonCodes.join(',')}`);
        }
        if (bundle.exportIntent === 'blocked' && (bundle.identity !== null || bundle.reputation !== null || bundle.validation !== null)) {
            failures.push('blocked bundle must carry null payloads');
        }
        let roundTrip;
        if (fixture.expected.roundTrip) {
            roundTrip = verifyErc8004ExportAgainstSource(bundle, {
                receipt: fixture.receipt,
                attestation: fixture.attestation,
            });
            if (!roundTrip.ok) {
                for (const failed of roundTrip.checks.filter((entry) => !entry.ok)) {
                    failures.push(`round-trip check ${failed.id} failed: ${failed.detail}`);
                }
            }
        }
        cases.push({ case: fixture.case, kind: 'export', pass: failures.length === 0, failures, roundTrip });
    }
    return {
        schemaVersion: ERC8004_CONFORMANCE_SCHEMA_VERSION,
        ok: cases.every((entry) => entry.pass),
        cases,
    };
}
