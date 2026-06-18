export declare const AI_CATALOG_SCHEMA_VERSION: "ai-catalog.v1";
export type AiCatalogResourceType = 'agent' | 'api' | 'mcp_server' | 'mcp-server' | 'skill' | 'tool' | 'catalog' | 'a2a_agent' | 'a2a-agent';
export type AiCatalogValidationErrorCode = 'malformed_catalog' | 'unsupported_resource_type' | 'invalid_identifier' | 'invalid_reference' | 'unsafe_url' | 'nested_catalog_boundary' | 'credential_leakage_rejected' | 'catalog_too_large';
export type AiCatalogValidationError = {
    code: AiCatalogValidationErrorCode;
    path: string;
    message: string;
};
export type AiCatalogPublisherSnapshot = {
    id: string;
    name?: string;
    domain?: string;
};
export type AiCatalogResourceSnapshot = {
    id: string;
    type: AiCatalogResourceType;
    name: string;
    description?: string;
    url?: string;
    endpoint?: string;
    catalogUrl?: string;
    trustManifest?: unknown;
    capabilities?: unknown;
    payment?: unknown;
    auth?: unknown;
    raw: unknown;
};
export type AiCatalogSnapshot = {
    schemaVersion: typeof AI_CATALOG_SCHEMA_VERSION;
    publisher: AiCatalogPublisherSnapshot;
    resources: AiCatalogResourceSnapshot[];
    rawSnapshotRef?: string;
};
export type AiCatalogValidationSuccess = {
    ok: true;
    catalog: AiCatalogSnapshot;
    warnings: AiCatalogValidationError[];
};
export type AiCatalogValidationFailure = {
    ok: false;
    errors: AiCatalogValidationError[];
};
export type AiCatalogValidationResult = AiCatalogValidationSuccess | AiCatalogValidationFailure;
export type AiCatalogValidationOptions = {
    rawSnapshotRef?: string;
    maxBytes?: number;
};
export type AiCatalogFixtureCase = {
    description: string;
    catalog: unknown;
    expectedValid: boolean;
    expectedErrorCodes: AiCatalogValidationErrorCode[];
};
export declare function validateAiCatalog(input: unknown, options?: AiCatalogValidationOptions): AiCatalogValidationResult;
export declare function createAiCatalogSnapshot(input: unknown, options?: AiCatalogValidationOptions): AiCatalogSnapshot;
export declare const aiCatalogFixtures: {
    readonly happyPath: {
        readonly publisher: {
            readonly id: "reddi.tech";
            readonly name: "Reddi";
            readonly domain: "reddi.tech";
        };
        readonly resources: readonly [{
            readonly id: "urn:ai:reddi.tech:specialists:code-review";
            readonly type: "agent";
            readonly name: "Code Review Specialist";
            readonly description: "Reviews pull requests and emits RAP-compatible evidence.";
            readonly endpoint: "https://agents.reddi.tech/code-review";
            readonly capabilities: readonly ["code_review", "risk_analysis"];
            readonly trustManifest: {
                readonly url: "https://agents.reddi.tech/.well-known/trust/code-review.json";
                readonly signature: {
                    readonly format: "dsse";
                    readonly status: "claimed";
                };
            };
            readonly payment: {
                readonly protocol: "rap";
                readonly quoteMode: "preflight";
                readonly assets: readonly [{
                    readonly asset: "AUDD";
                    readonly network: "solana-devnet";
                }];
            };
            readonly auth: {
                readonly type: "oauth";
                readonly scopes: readonly ["repo:read"];
            };
        }, {
            readonly id: "urn:ai:reddi.tech:apis:receipt-validator";
            readonly type: "api";
            readonly name: "Receipt Validator API";
            readonly url: "https://agents.reddi.tech/apis/receipt-validator";
            readonly capabilities: readonly ["receipt_validation"];
        }];
    };
    readonly nestedCatalog: {
        readonly publisher: "reddi.tech";
        readonly resources: readonly [{
            readonly id: "urn:ai:reddi.tech:catalogs:local-specialists";
            readonly type: "catalog";
            readonly name: "Local Specialists Catalog";
            readonly catalogUrl: "https://agents.reddi.tech/.well-known/local-specialists.ai-catalog.json";
        }];
    };
    readonly localhostFixture: {
        readonly publisher: "localhost";
        readonly resources: readonly [{
            readonly id: "urn:ai:localhost:fixtures:demo-specialist";
            readonly type: "mcp_server";
            readonly name: "Demo MCP Specialist";
            readonly endpoint: "http://localhost:4317/mcp";
        }];
    };
};
export declare const aiCatalogFixtureCases: Record<string, AiCatalogFixtureCase>;
