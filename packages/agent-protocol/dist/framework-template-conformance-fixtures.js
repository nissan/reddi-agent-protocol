import { listFrameworkTemplateFixtures, validateFrameworkTemplateContract, } from './framework-template-contract.js';
import { listFrameworkTemplateConformanceCases, runFrameworkTemplateNoLiveConformanceCheck, } from './framework-template-conformance.js';
import { createLangGraphRapTemplateFixture, validateLangGraphRapTemplate } from './langgraph-rap-template.js';
import { createAdkRapTemplateFixture, validateAdkRapTemplate } from './adk-rap-template.js';
import { createStrandsRapTemplateFixture, validateStrandsRapTemplate } from './strands-rap-template.js';
export const FRAMEWORK_TEMPLATE_CONFORMANCE_FIXTURES_VERSION = 'reddi.framework-template-conformance-fixtures.v1';
/**
 * The four framework templates that have landed on the shared #552/#553 contract lane. `generic`
 * is the framework-neutral #552 lifecycle fixture set itself; `langgraph`, `adk`, and `strands`
 * are the #544/#546/#545 templates that consume it without redefining any RAP semantics.
 */
export const LANDED_FRAMEWORK_TEMPLATE_IDS = ['generic', 'langgraph', 'adk', 'strands'];
const REQUIRED_LIFECYCLE = [
    'discovery',
    'quote',
    'preflight',
    'operator-approval',
    'invocation',
    'receipt-evidence',
    'denial',
    'failure',
];
function cloneContract(contract) {
    return structuredClone(contract);
}
function addUnique(items, item) {
    if (!items.includes(item))
        items.push(item);
}
function lifecycleContractsFromFixtures(fixtures) {
    const map = {};
    for (const fixture of fixtures) {
        map[fixture.kind] = cloneContract(fixture.contract);
    }
    return map;
}
function fixturesFromContractMap(contracts) {
    return REQUIRED_LIFECYCLE.map((kind) => ({
        kind,
        description: `${kind} lifecycle contract`,
        contract: cloneContract(contracts[kind]),
        expectedValid: true,
        expectedReasonCodes: ['framework_template_contract_valid'],
    }));
}
function computeLiveBoundary(contracts) {
    let livePaymentApproved = false;
    let walletRpcProviderCalls = false;
    let custodySupported = false;
    let settlementFinalityClaimed = false;
    for (const kind of REQUIRED_LIFECYCLE) {
        const metadata = contracts[kind].supportStateMetadata;
        if (metadata.livePaymentApproved)
            livePaymentApproved = true;
        if (metadata.walletRpcProviderCalls)
            walletRpcProviderCalls = true;
        if (metadata.custodySupported)
            custodySupported = true;
        if (metadata.settlementFinalityClaimed)
            settlementFinalityClaimed = true;
    }
    return {
        livePaymentApproved,
        walletRpcProviderCalls,
        custodySupported,
        settlementFinalityClaimed,
        allFalse: !livePaymentApproved && !walletRpcProviderCalls && !custodySupported && !settlementFinalityClaimed,
    };
}
function buildFixture(input) {
    const conformanceCases = listFrameworkTemplateConformanceCases({
        lifecycleFixtures: fixturesFromContractMap(input.lifecycleContracts),
    });
    const conformance = runFrameworkTemplateNoLiveConformanceCheck({ cases: conformanceCases });
    return {
        framework: input.framework,
        description: input.description,
        templateValid: input.templateValid,
        templateReasonCodes: input.templateReasonCodes,
        lifecycleContracts: input.lifecycleContracts,
        conformanceCases,
        conformanceValid: conformance.valid,
        conformanceReasonCodes: conformance.reasonCodes,
        liveBoundary: computeLiveBoundary(input.lifecycleContracts),
    };
}
function genericFixture() {
    const lifecycleContracts = lifecycleContractsFromFixtures(listFrameworkTemplateFixtures());
    const contractReasonCodes = [];
    let templateValid = true;
    for (const kind of REQUIRED_LIFECYCLE) {
        const result = validateFrameworkTemplateContract(lifecycleContracts[kind]);
        if (!result.valid)
            templateValid = false;
        for (const reason of result.reasonCodes)
            addUnique(contractReasonCodes, reason);
    }
    return buildFixture({
        framework: 'generic',
        description: 'Framework-neutral #552 lifecycle fixtures consumed as-is (no framework wrapper).',
        templateValid,
        templateReasonCodes: contractReasonCodes,
        lifecycleContracts,
    });
}
function langGraphFixture() {
    const template = createLangGraphRapTemplateFixture();
    const validation = validateLangGraphRapTemplate(template);
    return buildFixture({
        framework: 'langgraph',
        description: 'LangGraph graph-node RAP template (#544) consuming the shared lifecycle contracts.',
        templateValid: validation.valid,
        templateReasonCodes: validation.reasonCodes,
        lifecycleContracts: template.contracts,
    });
}
function adkFixture() {
    const template = createAdkRapTemplateFixture();
    const validation = validateAdkRapTemplate(template);
    return buildFixture({
        framework: 'adk',
        description: 'ADK A2A Agent Card RAP template (#546) consuming the shared lifecycle contracts.',
        templateValid: validation.valid,
        templateReasonCodes: validation.reasonCodes,
        lifecycleContracts: template.contracts,
    });
}
function strandsFixture() {
    const template = createStrandsRapTemplateFixture();
    const validation = validateStrandsRapTemplate(template);
    return buildFixture({
        framework: 'strands',
        description: 'Strands tool-plugin RAP template (#545) consuming the shared lifecycle contracts.',
        templateValid: validation.valid,
        templateReasonCodes: validation.reasonCodes,
        lifecycleContracts: template.contracts,
    });
}
/**
 * Builds one conformance fixture per landed framework template. Each fixture runs the shared #553
 * no-live conformance checker against the template's own lifecycle contracts, so uniformity across
 * frameworks is proven from each template's real embedded contracts rather than a shared shortcut.
 */
export function listLandedFrameworkTemplateConformanceFixtures() {
    return [genericFixture(), langGraphFixture(), adkFixture(), strandsFixture()];
}
function boundariesEqual(a, b) {
    return a.livePaymentApproved === b.livePaymentApproved
        && a.walletRpcProviderCalls === b.walletRpcProviderCalls
        && a.custodySupported === b.custodySupported
        && a.settlementFinalityClaimed === b.settlementFinalityClaimed
        && a.allFalse === b.allFalse;
}
/**
 * Asserts that ALL landed framework templates pass the shared conformance checker uniformly:
 * every framework is present, valid, and produces the same conformance reason codes and the same
 * all-false no-live boundary. Fails closed with machine-readable reason codes otherwise.
 */
export function runUniformFrameworkTemplateConformance() {
    const fixtures = listLandedFrameworkTemplateConformanceFixtures();
    const reasonCodes = [];
    const auditNotes = [];
    for (const framework of LANDED_FRAMEWORK_TEMPLATE_IDS) {
        if (!fixtures.some((fixture) => fixture.framework === framework)) {
            addUnique(reasonCodes, 'missing_landed_framework_template');
            auditNotes.push(`Denied: landed framework template ${framework} is missing from the fixtures set.`);
        }
    }
    for (const fixture of fixtures) {
        if (!fixture.conformanceValid) {
            addUnique(reasonCodes, 'framework_template_not_conformant');
            auditNotes.push(`Denied: ${fixture.framework} template failed #553 conformance: ${fixture.conformanceReasonCodes.join(',')}.`);
        }
        if (!fixture.templateValid) {
            addUnique(reasonCodes, 'framework_template_invalid');
            auditNotes.push(`Denied: ${fixture.framework} template failed its own validation: ${fixture.templateReasonCodes.join(',')}.`);
        }
        if (!fixture.liveBoundary.allFalse) {
            addUnique(reasonCodes, 'live_boundary_not_false');
            auditNotes.push(`Denied: ${fixture.framework} template has a non-false no-live boundary.`);
        }
    }
    const reference = fixtures[0];
    if (reference) {
        for (const fixture of fixtures) {
            if (JSON.stringify(fixture.conformanceReasonCodes) !== JSON.stringify(reference.conformanceReasonCodes)) {
                addUnique(reasonCodes, 'non_uniform_conformance_reason_codes');
                auditNotes.push(`Denied: ${fixture.framework} conformance reason codes diverge from ${reference.framework}.`);
            }
            if (!boundariesEqual(fixture.liveBoundary, reference.liveBoundary)) {
                addUnique(reasonCodes, 'non_uniform_live_boundary');
                auditNotes.push(`Denied: ${fixture.framework} no-live boundary diverges from ${reference.framework}.`);
            }
        }
    }
    const valid = reasonCodes.length === 0;
    return {
        version: FRAMEWORK_TEMPLATE_CONFORMANCE_FIXTURES_VERSION,
        issue: 547,
        valid,
        reasonCodes: valid ? ['framework_templates_uniformly_conformant'] : reasonCodes,
        frameworks: [...LANDED_FRAMEWORK_TEMPLATE_IDS],
        sharedConformanceReasonCodes: reference ? reference.conformanceReasonCodes : [],
        liveBoundary: reference
            ? reference.liveBoundary
            : { livePaymentApproved: false, walletRpcProviderCalls: false, custodySupported: false, settlementFinalityClaimed: false, allFalse: true },
        fixtures,
        auditNotes: valid
            ? ['Allowed: all landed framework templates pass #553 conformance uniformly with an all-false no-live boundary.']
            : auditNotes,
    };
}
