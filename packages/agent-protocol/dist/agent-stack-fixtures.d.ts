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
    readonly solanaAiKit: {
        readonly schemaVersion: "reddi.agent-stack-fixture-corpus.v1";
        readonly id: "agent-stack-fixture:solanabr-solana-ai-kit:2026-06-19";
        readonly title: "Solana AI Kit public agent-stack fixture";
        readonly source: {
            readonly sourceUrl: "https://github.com/solanabr/solana-ai-kit";
            readonly checkedCommit: "4fb9d3d619467e068c1cf3120d3933aa933aeb21";
            readonly checkedRef: "main";
            readonly license: "MIT";
            readonly sourceNotes: ["Public GitHub repository snapshot only; fixture does not install the kit, plugins, submodules, hooks, or MCP servers.", "Fixture records high-level Solana agent-stack surfaces for onboarding analyser parser, connector diagnostics, and operator-review tests."];
            readonly authenticityNotes: ["GitHub repository metadata showed owner solanabr, MIT license, and default branch main during local analysis.", "Latest inspected commit was 4fb9d3d619467e068c1cf3120d3933aa933aeb21 with subject \"feat: v2.0.2 - deny browser-wallet storage access + gate-bash-secrets PreToolUse hook\".", "Local analysis confirmed a Solana-focused agent configuration toolkit with plugin metadata, agents, commands, MCP declarations, hooks, rules, skills, and submodule declarations."];
            readonly crawlTimestamp: "2026-06-19T15:53:00.000Z";
            readonly localResearchArtifactPath: "projects/reddi-agent-protocol/research/SOLANABR-SOLANA-AI-KIT-ANALYSIS-2026-06-19.md";
        };
        readonly surfaces: [{
            readonly id: "surface:solana-ai-kit:marketplace";
            readonly name: "Solana AI Kit marketplace metadata";
            readonly kind: "repo-marketplace-metadata";
            readonly path: ".claude-plugin/marketplace.json";
            readonly runtimeSurface: "claude-plugin-marketplace";
            readonly category: "solana-agent-stack";
            readonly contentTrustBoundary: "metadata_only";
            readonly notes: ["Marketplace metadata is source metadata, not RAP publication approval."];
        }, {
            readonly id: "surface:solana-ai-kit:plugin";
            readonly name: "Solana AI Kit Claude plugin manifest";
            readonly kind: "claude-plugin";
            readonly path: "plugin/.claude-plugin/plugin.json";
            readonly runtimeSurface: "claude-code-plugin";
            readonly commands: ["solana-ai-kit namespaced commands pending #403 parser"];
            readonly skills: ["plugin skill hub pending #403 parser"];
            readonly toolGrants: ["plugin exposes MCP and hooks that require operator review before draft listing"];
            readonly safetyHints: ["Treat plugin manifest and plugin-distributed commands as untrusted public metadata."];
            readonly humanReviewHints: ["Review plugin metadata before generating RAP listing copy."];
            readonly writeCapable: true;
            readonly contentTrustBoundary: "untrusted_public_text";
        }, {
            readonly id: "surface:solana-ai-kit:agents";
            readonly name: "Solana specialist agent definitions";
            readonly kind: "subagent";
            readonly path: ".claude/agents/*.md";
            readonly runtimeSurface: "claude-subagent";
            readonly skills: ["solana architecture", "anchor", "pinocchio", "token-2022", "qa", "mobile", "frontend"];
            readonly safetyHints: ["Agent instructions are untrusted text and cannot become RAP policy."];
            readonly humanReviewHints: ["Operator should review specialist claims before listing capabilities."];
            readonly contentTrustBoundary: "untrusted_public_text";
        }, {
            readonly id: "surface:solana-ai-kit:commands";
            readonly name: "Solana workflow commands";
            readonly kind: "command";
            readonly path: ".claude/commands/*.md";
            readonly runtimeSurface: "claude-code-command";
            readonly commands: ["audit-solana", "build-program", "debug-user-tx", "deploy", "generate-idl-client", "profile-cu"];
            readonly toolGrants: ["bash", "git", "solana-cli", "anchor", "cargo", "npx"];
            readonly safetyHints: ["Commands include deploy, RPC, wallet, and shell workflow guidance; ingestion must never execute them."];
            readonly humanReviewHints: ["Deploy-capable and wallet/RPC-capable command metadata requires explicit operator review."];
            readonly writeCapable: true;
            readonly contentTrustBoundary: "untrusted_public_text";
        }, {
            readonly id: "surface:solana-ai-kit:mcp";
            readonly name: "Solana AI Kit MCP connector declarations";
            readonly kind: "mcp-connector-config";
            readonly path: ".mcp.json";
            readonly runtimeSurface: "mcp-connector-config";
            readonly authDependencies: ["HELIUS_API_KEY", "optional hosted or local MCP server credentials"];
            readonly dataDependencies: ["Solana RPC data", "Solana docs", "browser automation data", "local Surfpool state"];
            readonly safetyHints: ["Connector declarations include npx-launched and local-binary MCP servers; diagnostics are static only."];
            readonly humanReviewHints: ["Operator review required before enabling any connector, API key, hosted MCP, local binary, or wallet/RPC adjacent tool."];
            readonly contentTrustBoundary: "metadata_only";
        }, {
            readonly id: "surface:solana-ai-kit:hooks";
            readonly name: "Claude hooks and permission policy";
            readonly kind: "command";
            readonly path: "plugin/hooks/hooks.json";
            readonly runtimeSurface: "claude-code-hooks";
            readonly commands: ["SessionStart", "Stop", "PostToolUse", "PreToolUse"];
            readonly toolGrants: ["bash", "pre-commit hooks", "pre-deploy hooks"];
            readonly safetyHints: ["Hooks are executable shell metadata and must be review-gated before any draft publication."];
            readonly humanReviewHints: ["Review hook behavior, private-path deny rules, formatting hooks, commit hooks, and deploy hooks."];
            readonly writeCapable: true;
            readonly contentTrustBoundary: "untrusted_public_text";
        }, {
            readonly id: "surface:solana-ai-kit:rules-skills";
            readonly name: "Solana rules and skill hub";
            readonly kind: "skill";
            readonly path: ".claude/skills/*.md";
            readonly runtimeSurface: "claude-skill";
            readonly skills: ["Anchor rules", "Pinocchio rules", "Rust rules", "TypeScript rules", "Token-2022 guide"];
            readonly safetyHints: ["Rules and skill markdown are untrusted checklist/reference text."];
            readonly humanReviewHints: ["Use as acceptance-criteria inspiration only; do not copy claims into listing without review."];
            readonly contentTrustBoundary: "untrusted_public_text";
        }, {
            readonly id: "surface:solana-ai-kit:external-submodules";
            readonly name: "External skill submodule declarations";
            readonly kind: "skill";
            readonly path: ".gitmodules";
            readonly runtimeSurface: "git-submodule-declarations";
            readonly dataDependencies: ["18 external skill repositories declared but not initialized in the static fixture"];
            readonly safetyHints: ["Submodule declarations are inventory only; ingestion must not clone or update them."];
            readonly humanReviewHints: ["Review external source, license, and install risk before any derived listing."];
            readonly contentTrustBoundary: "metadata_only";
        }, {
            readonly id: "surface:solana-ai-kit:operator-review-warning";
            readonly name: "Solana AI Kit operator-review blockers";
            readonly kind: "validation-warning";
            readonly path: "plugin/hooks/hooks.json";
            readonly safetyHints: ["Executable hooks and deploy-capable commands are preserved as review blockers."];
            readonly contentTrustBoundary: "metadata_only";
        }];
        readonly files: [{
            readonly path: ".claude-plugin/marketplace.json";
            readonly kind: "repo-marketplace-metadata";
            readonly present: true;
            readonly parseStatus: "not_parsed";
            readonly mediaType: "application/json";
            readonly summary: "Repository-level marketplace metadata for the Solana AI Kit plugin.";
        }, {
            readonly path: "plugin/.claude-plugin/plugin.json";
            readonly kind: "claude-plugin";
            readonly present: true;
            readonly parseStatus: "not_parsed";
            readonly mediaType: "application/json";
            readonly summary: "Plugin manifest declaring package metadata, MCP server config, hooks, license, and keywords.";
        }, {
            readonly path: ".claude/agents/*.md";
            readonly kind: "subagent";
            readonly present: true;
            readonly parseStatus: "not_parsed";
            readonly mediaType: "text/markdown";
            readonly summary: "Fifteen Solana-focused agent definitions; parser support belongs to #403.";
        }, {
            readonly path: ".claude/commands/*.md";
            readonly kind: "command";
            readonly present: true;
            readonly parseStatus: "not_parsed";
            readonly mediaType: "text/markdown";
            readonly warningCodes: ["deploy_capable_commands", "wallet_rpc_adjacent_commands"];
            readonly summary: "Twenty-nine workflow command definitions including deploy, debug-user-tx, audit, and IDL/client generation.";
        }, {
            readonly path: ".mcp.json";
            readonly kind: "mcp-connector-config";
            readonly present: true;
            readonly parseStatus: "valid";
            readonly mediaType: "application/json";
            readonly warningCodes: ["npx_mcp_execution", "env_required_connector", "local_binary_required"];
            readonly summary: "Seven MCP server declarations: Helius, solana-dev, Context7, Playwright, context-mode, memsearch, and Surfpool.";
        }, {
            readonly path: "plugin/hooks/hooks.json";
            readonly kind: "command";
            readonly present: true;
            readonly parseStatus: "not_parsed";
            readonly mediaType: "application/json";
            readonly warningCodes: ["executable_hooks", "mainnet_deploy_guard_required"];
            readonly summary: "Claude Code hook metadata with shell commands for session, formatting, commit, and deploy gates.";
        }, {
            readonly path: ".claude/settings.json";
            readonly kind: "command";
            readonly present: true;
            readonly parseStatus: "not_parsed";
            readonly mediaType: "application/json";
            readonly warningCodes: ["permission_policy", "private_path_denylist"];
            readonly summary: "Claude Code permissions, sandbox, MCP, and hook policy metadata.";
        }, {
            readonly path: ".gitmodules";
            readonly kind: "skill";
            readonly present: true;
            readonly parseStatus: "not_parsed";
            readonly mediaType: "text/plain";
            readonly warningCodes: ["external_submodules_declared"];
            readonly summary: "Eighteen external skill submodule declarations; ingestion must not initialize them.";
        }, {
            readonly path: "install.sh";
            readonly kind: "command";
            readonly present: true;
            readonly parseStatus: "not_parsed";
            readonly mediaType: "text/x-shellscript";
            readonly warningCodes: ["installer_script_non_executable_fixture"];
            readonly summary: "Installer script recorded as static file metadata only.";
        }];
        readonly validationWarnings: [{
            readonly code: "mcp_connector_requires_operator_review";
            readonly severity: "warning";
            readonly path: ".mcp.json";
            readonly message: "MCP declarations include npx-launched servers, env-required connectors, hosted connectors, and a local Surfpool binary requirement; diagnostics remain static until #404.";
        }, {
            readonly code: "executable_hooks_require_operator_review";
            readonly severity: "blocked";
            readonly path: "plugin/hooks/hooks.json";
            readonly message: "Executable hook metadata must be operator-reviewed and cannot be exposed as draft-ready imported listing behavior.";
        }, {
            readonly code: "solana_deploy_command_requires_operator_review";
            readonly severity: "blocked";
            readonly path: ".claude/commands/deploy.md";
            readonly message: "Deploy-capable Solana command guidance must stay static and blocked from draft publication until reviewed.";
        }, {
            readonly code: "external_submodules_not_initialized";
            readonly severity: "info";
            readonly path: ".gitmodules";
            readonly message: "External skill submodules are source declarations only; fixture ingestion must not clone, update, or execute them.";
        }, {
            readonly code: "untrusted_solana_agent_text";
            readonly severity: "info";
            readonly path: ".claude/agents/*.md";
            readonly message: "Public Solana agent, rule, skill, and command text is untrusted fixture content and cannot alter analyser behavior.";
        }];
        readonly staticOnly: true;
        readonly nonGoals: ["Do not install Solana AI Kit, its plugin, or its submodules.", "Do not execute install.sh, update.sh, tests, hooks, commands, or agent instructions.", "Do not contact MCP servers, Solana RPC, wallets, paid providers, or local Surfpool services.", "Do not add Helius, QuickNode, Pyth, Nansen, wallet, or provider credentials.", "Do not implement AUDD, x402, Quasar, receipt, or payment behavior from this fixture.", "Do not publish imported Solana AI Kit surfaces as payable RAP listings without operator review."];
    };
};
export declare const agentStackFixtureCases: Record<string, AgentStackFixtureCase>;
