export declare const AGENT_STACK_FIXTURE_CORPUS_SCHEMA_VERSION: "reddi.agent-stack-fixture-corpus.v1";
export declare const STATIC_AGENT_STACK_INGESTION_RESULT_SCHEMA_VERSION: "reddi.static-agent-stack-ingestion-result.v1";
export type AgentStackFixtureSurfaceKind = 'repo-marketplace-metadata' | 'claude-plugin' | 'managed-agent-cookbook' | 'mcp-connector-config' | 'skill' | 'command' | 'subagent' | 'partner-plugin' | 'vertical-plugin' | 'validation-warning';
export type AgentStackFixtureValidationErrorCode = 'malformed_fixture_corpus' | 'invalid_source_reference' | 'credential_leakage_rejected' | 'invalid_commit_ref' | 'invalid_timestamp' | 'unsafe_url' | 'corpus_too_large';
export type AgentStackFixtureValidationError = {
    code: AgentStackFixtureValidationErrorCode;
    path: string;
    message: string;
};
export type AgentStackFixtureSource = {
    sourceUrl: string;
    checkedCommit: string;
    checkedRef?: string;
    license?: string;
    sourceNotes: string[];
    authenticityNotes: string[];
    crawlTimestamp: string;
    localResearchArtifactPath?: string;
};
export type AgentStackFixtureFile = {
    path: string;
    kind: AgentStackFixtureSurfaceKind;
    present: boolean;
    parseStatus: 'valid' | 'malformed' | 'not_parsed' | 'missing';
    mediaType?: string;
    summary?: string;
    warningCodes?: string[];
};
export type AgentStackFixtureSurface = {
    id: string;
    name: string;
    kind: AgentStackFixtureSurfaceKind;
    path: string;
    category?: string;
    runtimeSurface?: string;
    commands?: string[];
    skills?: string[];
    toolGrants?: string[];
    authDependencies?: string[];
    dataDependencies?: string[];
    safetyHints?: string[];
    humanReviewHints?: string[];
    writeCapable?: boolean;
    contentTrustBoundary: 'untrusted_public_text' | 'metadata_only';
    notes?: string[];
};
export type AgentStackFixtureValidationWarning = {
    code: string;
    severity: 'info' | 'warning' | 'blocked';
    path: string;
    message: string;
};
export type AgentStackFixtureCorpus = {
    schemaVersion: typeof AGENT_STACK_FIXTURE_CORPUS_SCHEMA_VERSION;
    id: string;
    title: string;
    source: AgentStackFixtureSource;
    surfaces: AgentStackFixtureSurface[];
    files: AgentStackFixtureFile[];
    validationWarnings: AgentStackFixtureValidationWarning[];
    staticOnly: true;
    nonGoals: string[];
};
export type AgentStackFixtureValidationSuccess = {
    ok: true;
    corpus: AgentStackFixtureCorpus;
    warnings: AgentStackFixtureValidationWarning[];
};
export type AgentStackFixtureValidationFailure = {
    ok: false;
    errors: AgentStackFixtureValidationError[];
};
export type AgentStackFixtureValidationResult = AgentStackFixtureValidationSuccess | AgentStackFixtureValidationFailure;
export type AgentStackFixtureValidationOptions = {
    maxBytes?: number;
};
export type AgentStackFixtureCase = {
    description: string;
    corpus: unknown;
    expectedValid: boolean;
    expectedErrorCodes: AgentStackFixtureValidationErrorCode[];
};
export type StaticAgentStackIngestionStatus = 'ready_for_draft' | 'partial_success' | 'blocked';
export type StaticAgentStackInventoryEntry = {
    id: string;
    name: string;
    kind: AgentStackFixtureSurfaceKind;
    sourcePath: string;
    runtimeSurface?: string;
    category?: string;
    commands: string[];
    skills: string[];
    toolGrants: string[];
    authDependencies: string[];
    dataDependencies: string[];
    safetyHints: string[];
    humanReviewHints: string[];
    writeCapable: boolean;
    contentTrustBoundary: AgentStackFixtureSurface['contentTrustBoundary'];
};
export type StaticAgentStackConnectorDiagnostic = {
    path: string;
    parseStatus: AgentStackFixtureFile['parseStatus'];
    severity: AgentStackFixtureValidationWarning['severity'];
    warningCodes: string[];
    message: string;
};
export type StaticAgentStackRejectedEntry = {
    path: string;
    reasonCode: string;
    message: string;
};
export type StaticAgentStackDraftPayloadReadiness = {
    status: 'ready' | 'needs_review' | 'blocked';
    blockers: string[];
    payloadRefs: string[];
};
export type StaticAgentStackIngestionResult = {
    schemaVersion: typeof STATIC_AGENT_STACK_INGESTION_RESULT_SCHEMA_VERSION;
    corpusId: string;
    title: string;
    source: AgentStackFixtureSource;
    status: StaticAgentStackIngestionStatus;
    inventory: StaticAgentStackInventoryEntry[];
    connectorDiagnostics: StaticAgentStackConnectorDiagnostic[];
    rejectedEntries: StaticAgentStackRejectedEntry[];
    warnings: AgentStackFixtureValidationWarning[];
    draftPayloadReadiness: StaticAgentStackDraftPayloadReadiness;
    staticOnly: true;
    nonGoals: string[];
};
export declare function validateAgentStackFixtureCorpus(input: unknown, options?: AgentStackFixtureValidationOptions): AgentStackFixtureValidationResult;
export declare function createAgentStackFixtureCorpus(input: unknown, options?: AgentStackFixtureValidationOptions): AgentStackFixtureCorpus;
export declare function createStaticAgentStackIngestionResult(input: unknown, options?: AgentStackFixtureValidationOptions): StaticAgentStackIngestionResult;
export declare const agentStackFixtureCorpora: {
    readonly anthropicFinancialServices: {
        readonly schemaVersion: "reddi.agent-stack-fixture-corpus.v1";
        readonly id: "agent-stack-fixture:anthropic-financial-services:2026-06-18";
        readonly title: "Anthropic financial-services agent stack public fixture";
        readonly source: {
            readonly sourceUrl: "https://github.com/anthropics/financial-services";
            readonly checkedCommit: "4bbabc7cd1a474c1667fa05a2bfe58e411dcf9c1";
            readonly checkedRef: "main";
            readonly license: "Apache-2.0";
            readonly sourceNotes: ["Public GitHub repository snapshot only; fixture does not install plugins or execute repository commands.", "Fixture records high-level manifest surfaces for onboarding analyser parser and diagnostics tests."];
            readonly authenticityNotes: ["GitHub organization was verified for anthropic.com during local analysis.", "Anthropic public financial-services announcement linked to the repository during local analysis.", "Latest inspected main commit was GitHub-signature verified in the local analysis artifact."];
            readonly crawlTimestamp: "2026-06-18T10:50:00.000Z";
            readonly localResearchArtifactPath: "projects/reddi-agent-protocol/research/ANTHROPIC-FINANCIAL-SERVICES-REPO-ANALYSIS-2026-06-18.md";
        };
        readonly surfaces: [{
            readonly id: "surface:anthropic-financial-services:marketplace";
            readonly name: "Claude plugin marketplace metadata";
            readonly kind: "repo-marketplace-metadata";
            readonly path: ".claude-plugin/marketplace.json";
            readonly runtimeSurface: "claude-plugin-marketplace";
            readonly category: "financial-services";
            readonly contentTrustBoundary: "metadata_only";
            readonly notes: ["Marketplace metadata is source metadata, not RAP publication approval."];
        }, {
            readonly id: "surface:anthropic-financial-services:plugins";
            readonly name: "Financial services Claude plugins";
            readonly kind: "claude-plugin";
            readonly path: "plugins/";
            readonly runtimeSurface: "claude-code-plugin";
            readonly commands: ["statically discovered command metadata pending #403 parser"];
            readonly skills: ["statically discovered skill metadata pending #403 parser"];
            readonly toolGrants: ["read", "write-capable grants must be parsed and reviewed before publication"];
            readonly safetyHints: ["Treat plugin prompts and skills as untrusted public text."];
            readonly humanReviewHints: ["Review write-capable commands before draft RAP listing publication."];
            readonly writeCapable: true;
            readonly contentTrustBoundary: "untrusted_public_text";
        }, {
            readonly id: "surface:anthropic-financial-services:managed-agents";
            readonly name: "Claude managed-agent cookbooks";
            readonly kind: "managed-agent-cookbook";
            readonly path: "managed-agents/";
            readonly runtimeSurface: "claude-managed-agent";
            readonly authDependencies: ["third-party connector credentials may be required by recipes"];
            readonly dataDependencies: ["financial workspace documents", "Microsoft 365 or partner data sources"];
            readonly safetyHints: ["Managed-agent YAML is static input only until #403/#405 produce reviewable inventories."];
            readonly humanReviewHints: ["Operator review is required before imported recipes become payable listings."];
            readonly contentTrustBoundary: "untrusted_public_text";
        }, {
            readonly id: "surface:anthropic-financial-services:mcp-connectors";
            readonly name: "MCP connector configurations";
            readonly kind: "mcp-connector-config";
            readonly path: "plugins/vertical-plugins/financial-analysis/.mcp.json";
            readonly runtimeSurface: "mcp-connector-config";
            readonly authDependencies: ["box", "egnyte", "microsoft-365", "partner connectors"];
            readonly safetyHints: ["Connector config validation is static only and must not contact MCP servers."];
            readonly humanReviewHints: ["Malformed connector config should block only affected connector readiness, not unrelated metadata ingestion."];
            readonly contentTrustBoundary: "metadata_only";
        }, {
            readonly id: "surface:anthropic-financial-services:known-warning";
            readonly name: "Known malformed financial-analysis MCP config";
            readonly kind: "validation-warning";
            readonly path: "plugins/vertical-plugins/financial-analysis/.mcp.json";
            readonly safetyHints: ["Known invalid JSON is preserved as a regression fixture for #404."];
            readonly contentTrustBoundary: "metadata_only";
        }];
        readonly files: [{
            readonly path: ".claude-plugin/marketplace.json";
            readonly kind: "repo-marketplace-metadata";
            readonly present: true;
            readonly parseStatus: "not_parsed";
            readonly mediaType: "application/json";
            readonly summary: "Repository-level marketplace metadata for Claude plugin distribution.";
        }, {
            readonly path: "plugins/**/plugin.json";
            readonly kind: "claude-plugin";
            readonly present: true;
            readonly parseStatus: "not_parsed";
            readonly mediaType: "application/json";
            readonly summary: "Plugin manifests for horizontal, vertical, and partner packages.";
        }, {
            readonly path: "managed-agents/**/agent.yaml";
            readonly kind: "managed-agent-cookbook";
            readonly present: true;
            readonly parseStatus: "not_parsed";
            readonly mediaType: "application/yaml";
            readonly summary: "Managed-agent cookbook metadata; parser support belongs to #403.";
        }, {
            readonly path: "plugins/vertical-plugins/financial-analysis/.mcp.json";
            readonly kind: "mcp-connector-config";
            readonly present: true;
            readonly parseStatus: "malformed";
            readonly mediaType: "application/json";
            readonly warningCodes: ["malformed_mcp_json"];
            readonly summary: "Known malformed connector manifest from local analysis; full diagnostics belong to #404.";
        }];
        readonly validationWarnings: [{
            readonly code: "malformed_mcp_json";
            readonly severity: "warning";
            readonly path: "plugins/vertical-plugins/financial-analysis/.mcp.json";
            readonly message: "Known malformed JSON should fail closed for connector diagnostics while preserving partial static ingestion.";
        }, {
            readonly code: "untrusted_prompt_text";
            readonly severity: "info";
            readonly path: "plugins/";
            readonly message: "Public prompt, skill, and command text is untrusted fixture content and cannot alter analyser behavior.";
        }];
        readonly staticOnly: true;
        readonly nonGoals: ["Do not install Claude plugins.", "Do not execute repository scripts, commands, managed agents, or MCP servers.", "Do not fetch paid/provider data or require credentials.", "Do not publish imported surfaces as payable RAP listings without operator review."];
    };
};
export declare const agentStackFixtureCases: Record<string, AgentStackFixtureCase>;
