export declare const AI_CATALOG_SCHEMA_VERSION: "ai-catalog.v1";
export type AiCatalogResourceType = string;
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
    mediaType: string;
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
        readonly specVersion: "1.0";
        readonly host: {
            readonly identifier: "reddi.tech";
            readonly displayName: "Reddi";
        };
        readonly entries: readonly [{
            readonly identifier: "urn:ai:reddi.tech:specialists:code-review";
            readonly mediaType: "application/mcp-server-card+json";
            readonly displayName: "Code Review Specialist";
            readonly description: "Reviews pull requests and emits RAP-compatible evidence.";
            readonly url: "https://agents.reddi.tech/code-review/mcp.json";
            readonly metadata: {
                readonly capabilities: readonly ["code_review", "risk_analysis"];
                readonly rap: {
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
                };
            };
            readonly trustManifest: {
                readonly identity: "urn:ai:reddi.tech:specialists:code-review";
                readonly signature: {
                    readonly format: "dsse";
                    readonly status: "claimed";
                };
            };
        }, {
            readonly identifier: "urn:ai:reddi.tech:apis:receipt-validator";
            readonly mediaType: "application/openapi+json";
            readonly displayName: "Receipt Validator API";
            readonly url: "https://agents.reddi.tech/apis/receipt-validator";
            readonly metadata: {
                readonly capabilities: readonly ["receipt_validation"];
            };
        }];
    };
    readonly nestedCatalog: {
        readonly specVersion: "1.0";
        readonly host: {
            readonly displayName: "Reddi";
            readonly identifier: "reddi.tech";
        };
        readonly entries: readonly [{
            readonly identifier: "urn:ai:reddi.tech:catalogs:local-specialists";
            readonly mediaType: "application/ai-catalog+json";
            readonly displayName: "Local Specialists Catalog";
            readonly url: "https://agents.reddi.tech/.well-known/local-specialists.ai-catalog.json";
        }];
    };
    readonly localhostFixture: {
        readonly specVersion: "1.0";
        readonly host: "localhost";
        readonly entries: readonly [{
            readonly identifier: "urn:ai:localhost:fixtures:demo-specialist";
            readonly mediaType: "application/mcp-server-card+json";
            readonly displayName: "Demo MCP Specialist";
            readonly url: "http://localhost:4317/mcp";
        }];
    };
};
export declare const aiCatalogFixtureCases: Record<string, AiCatalogFixtureCase>;
