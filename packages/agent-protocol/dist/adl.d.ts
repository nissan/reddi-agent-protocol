export declare const ADL_V03_API_VERSION = "reddiagent.dev/v0.3";
export declare const ADL_V03_RECEIPT_FORMAT = "reddi.receipt.v2";
export declare const ADL_V03_LIVE_RAIL = "solana";
/** The protocol fee: 5% of the amount actually paid. */
export declare const ADL_V03_PROTOCOL_FEE_BPS = 500;
/** The launch rate: 2.5% for payouts before `endsAt`. */
export declare const ADL_V03_LAUNCH_RATE: Readonly<{
    bps: 250;
    endsAt: "2027-04-01T00:00:00Z";
}>;
export declare const ADL_V03_PROTOCOL_FEE_SOL_CAP = "0.1";
/** Mints the escrow program accepts on Solana mainnet-beta. Devnet mints are the operator's choice. */
export declare const ADL_V03_MAINNET_MINTS: Readonly<Record<string, string>>;
/** The largest ADL document the parser accepts, in UTF-8 bytes. */
export declare const ADL_MAX_DOCUMENT_BYTES: number;
export type AdlDocument = Record<string, unknown>;
export type AdlLevel = 0 | 1 | 2 | 3 | 4;
export interface AdlSchemaDiagnostic {
    path: string;
    message: string;
}
export interface AdlConformanceReport {
    agent: string;
    apiVersion: typeof ADL_V03_API_VERSION;
    requestedLevel: number;
    /** -1 when the document fails the schema. */
    achievedLevel: number;
    status: "pass" | "fail";
    schemaDiagnostics: AdlSchemaDiagnostic[];
    missingFieldsByLevel: Record<string, string[]>;
    forbiddenCapabilitiesByLevel: Record<string, string[]>;
    payment: {
        mode: string | null;
        paymentMade: false;
        liveRailDeclared: boolean;
    };
}
export type AdlParseResult = {
    ok: true;
    document: AdlDocument;
} | {
    ok: false;
    message: string;
};
/**
 * Reads an ADL document from YAML or JSON text. YAML 1.1 rules, as the lab's
 * PyYAML reads it. Refuses documents over `ADL_MAX_DOCUMENT_BYTES`, aliases
 * beyond a small bound, duplicate keys and a top level that is not a mapping.
 */
export declare function parseAdlDocument(text: string): AdlParseResult;
/** The document as YAML text, for publishing. */
export declare function formatAdlDocument(document: AdlDocument): string;
/**
 * Checks an ADL v0.3 document against the schema and every conformance level
 * up to the requested one (the option, else `conformance.requestedLevel`,
 * else 0). The same verdict as the lab's `adl_v03_conformance.py`.
 */
export declare function checkAdlConformance(doc: AdlDocument, options?: {
    requestedLevel?: AdlLevel;
}): AdlConformanceReport;
/** Every problem in a report, one line each, schema problems first. */
export declare function adlProblems(report: AdlConformanceReport): string[];
export type AdlNetwork = "solana-devnet" | "solana-mainnet-beta";
/** A listed price as ADL writes it: decimal strings in the asset. */
export type AdlPrice = {
    per: "token";
    inputPerMillion: string;
    outputPerMillion: string; /** The most one call can cost; what a buyer authorises at most. */
    maxPerCall: string;
} | {
    per: "call";
    amount: string;
};
export interface ProviderAdlInput {
    /** Listing name, 1 to 80 characters. Becomes `metadata.name` as a slug. */
    name: string;
    description?: string;
    /** The model the provider declares it serves; receipts name it. Optional for a listing that names none. */
    model?: string;
    network: AdlNetwork;
    /** USDC, AUDD, PYUSD or USDG. */
    currency: string;
    mint: string;
    /** The provider wallet that is paid. */
    payTo: string;
    /** Per token, settled through metered escrow; or per call (a fixed-price job), settled through escrow. */
    price: AdlPrice;
    /** `live` for a provider that takes real payments. Defaults to live. */
    mode?: "live" | "dry-run";
    /** Where buyers reach the provider. Recorded under `extensions.identity`. */
    endpointUrl?: string;
}
/**
 * The schema's provider family for a model id: providers speak the
 * OpenAI-compatible API, so anything not plainly Anthropic, Gemini or Ollama
 * is "openai". The exact model is `extensions.identity.declaredModel`.
 */
export declare function adlProviderFamily(model: string | undefined): "openai" | "anthropic" | "gemini" | "ollama";
/** A `metadata.name` the schema accepts: lowercase letters, digits and dashes, 2 to 63 characters. */
export declare function adlNameSlug(name: string): string;
/**
 * The ADL v0.3 document for a provider on the Reddi Agent Protocol: a charge
 * on the Solana rail, priced per token and settled through metered escrow (or
 * priced per call and settled through escrow), with the protocol fee, a
 * reddi.receipt.v2 receipt and reputation signals. It passes Level 3. The
 * caller checks its inputs; a bad input gives a document that fails
 * `checkAdlConformance`, never a silently different one.
 */
export declare function buildProviderAdl(input: ProviderAdlInput): AdlDocument;
export interface ProviderAdlTerms {
    name: string;
    description: string;
    /** `extensions.identity.declaredModel`, when the document names one. */
    declaredModel?: string;
    /** `extensions.identity.endpoint`, when the document names one. */
    endpointUrl?: string;
    mode: "live" | "dry-run";
    network: AdlNetwork;
    currency: string;
    mint: string;
    payTo: string;
    price: AdlPrice;
}
/**
 * A provider's listing terms from its ADL: the document must pass Level 3 and
 * hold exactly one charge intent on the Solana rail, in a token, priced per
 * token (metered escrow) or per call (escrow).
 */
export declare function providerTermsFromAdl(doc: AdlDocument): {
    ok: true;
    terms: ProviderAdlTerms;
    report: AdlConformanceReport;
} | {
    ok: false;
    problems: string[];
    report: AdlConformanceReport;
};
/** SHA-256 of the lab's ADL v0.3 JSON Schema this copy was made from. */
export declare const ADL_V03_SCHEMA_SHA256 = "07ef5112a2efeb7db746897fab209e91de18d78a31ed8756f534a64ac21df9e0";
/** The ADL v0.3 JSON Schema (draft 2020-12). */
export declare const ADL_V03_SCHEMA: Record<string, unknown>;
