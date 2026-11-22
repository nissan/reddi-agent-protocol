/**
 * Agent Definition Language (ADL) v0.3 for the Reddi Agent Protocol.
 *
 * ADL is owned by nissan/reddiagent-lab: `specs/ADL-v0.3.md`, its JSON Schema
 * and the Python conformance checker `scripts/adl_v03_conformance.py`. This
 * module is the TypeScript port the platform runs: the same schema (a copy at the
 * end of this file, kept in step by `scripts/sync-adl-v03.mjs`) and the same
 * level checks, so a document passes here exactly when it passes in the lab.
 * The tests hold every lab example to the lab checker's verdict.
 *
 * The protocol fee is 5% (500 bps), with an optional `launchRate` block that
 * must say 2.5% (250 bps) for payouts before 2027-04-01T00:00:00Z, the rates
 * in `@redditech/x402-solana` and the program.
 *
 * It also builds the ADL document a per-token provider publishes
 * (`buildProviderAdl`) and reads a provider's listing terms back out of one
 * (`providerTermsFromAdl`), so a listing and its ADL cannot say different
 * things.
 *
 * Validating a document never makes a payment and proves nothing about a
 * deployment. No network access.
 */
import Ajv2020Module from "ajv/dist/2020.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
export const ADL_V03_API_VERSION = "reddiagent.dev/v0.3";
export const ADL_V03_RECEIPT_FORMAT = "reddi.receipt.v2";
export const ADL_V03_LIVE_RAIL = "solana";
/** The protocol fee: 5% of the amount actually paid. */
export const ADL_V03_PROTOCOL_FEE_BPS = 500;
/** The launch rate: 2.5% for payouts before `endsAt`. */
export const ADL_V03_LAUNCH_RATE = Object.freeze({ bps: 250, endsAt: "2027-04-01T00:00:00Z" });
export const ADL_V03_PROTOCOL_FEE_SOL_CAP = "0.1";
/** Mints the escrow program accepts on Solana mainnet-beta. Devnet mints are the operator's choice. */
export const ADL_V03_MAINNET_MINTS = Object.freeze({
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    AUDD: "AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw",
    PYUSD: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    USDG: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
});
/** The largest ADL document the parser accepts, in UTF-8 bytes. */
export const ADL_MAX_DOCUMENT_BYTES = 64 * 1024;
const LIVE_GATED_BEFORE_LEVEL_3 = "payment/reputation extension requires Level 3 or higher";
const LIVE_GATED_BEFORE_LEVEL_4 = "production deployment descriptor requires Level 4";
const MIGRATION_NOTE = "docs/ADL-V0.2-TO-V0.3-MIGRATION.md";
const PRODUCTION_RUNTIME_TARGETS = new Set(["hosted-container", "serverless", "platform-native", "openclaw"]);
const OBSERVABILITY_EVENTS_BY_LEVEL = {
    1: ["trace.started", "trace.completed", "task.completed", "task.failed"],
    2: ["model.called", "policy.checked", "eval.checked"],
    3: ["payment.intent.created", "receipt.emitted", "reputation.signal.emitted"],
    4: ["deployment.health.checked", "adapter.loss.reported"],
};
const isObj = (value) => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
const obj = (value) => (isObj(value) ? value : {});
const list = (value) => (Array.isArray(value) ? value : []);
/**
 * Reads an ADL document from YAML or JSON text. YAML 1.1 rules, as the lab's
 * PyYAML reads it. Refuses documents over `ADL_MAX_DOCUMENT_BYTES`, aliases
 * beyond a small bound, duplicate keys and a top level that is not a mapping.
 */
export function parseAdlDocument(text) {
    if (typeof text !== "string" || text.trim() === "")
        return { ok: false, message: "The ADL document is empty." };
    if (new TextEncoder().encode(text).length > ADL_MAX_DOCUMENT_BYTES)
        return { ok: false, message: `The ADL document is larger than ${ADL_MAX_DOCUMENT_BYTES / 1024} KB.` };
    let value;
    try {
        value = parseYaml(text, { version: "1.1", uniqueKeys: true, maxAliasCount: 50, prettyErrors: false });
    }
    catch (error) {
        return { ok: false, message: `The ADL document is not valid YAML or JSON: ${error instanceof Error ? error.message.split("\n")[0] : "parse error"}` };
    }
    if (!isObj(value))
        return { ok: false, message: "The ADL document must be a mapping at the top level." };
    return { ok: true, document: value };
}
/** The document as YAML text, for publishing. */
export function formatAdlDocument(document) {
    // Written under YAML 1.1 rules so strings such as dates and "yes" are quoted and read back as strings.
    return stringifyYaml(document, { version: "1.1", lineWidth: 0 });
}
// ajv ships CommonJS; under NodeNext its default export is the module object.
const Ajv2020 = (Ajv2020Module.default ?? Ajv2020Module);
let compiled;
function schemaValidator() {
    // The lab validates with jsonschema's Draft 2020-12 validator, which does not assert formats.
    compiled ??= new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(ADL_V03_SCHEMA);
    return compiled;
}
function schemaDiagnostics(doc) {
    if (doc.apiVersion !== ADL_V03_API_VERSION) {
        return [{ path: "apiVersion", message: `expected ${ADL_V03_API_VERSION}, found ${JSON.stringify(doc.apiVersion ?? null)}; earlier versions are not valid ADL v0.3, see ${MIGRATION_NOTE}` }];
    }
    const validate = schemaValidator();
    if (validate(doc))
        return [];
    return (validate.errors ?? []).map((error) => {
        const extra = error.params && "additionalProperty" in error.params ? ` (${String(error.params.additionalProperty)})` : "";
        return { path: error.instancePath.replace(/^\//, "").replace(/\//g, ".") || "$", message: `${error.message ?? "is invalid"}${extra}` };
    });
}
function hasPath(doc, dotted) {
    let value = doc;
    for (const part of dotted.split(".")) {
        if (!isObj(value) || !(part in value))
            return false;
        value = value[part];
    }
    if (value === null || value === undefined)
        return false;
    if (typeof value === "string" || Array.isArray(value))
        return value.length > 0;
    if (isObj(value))
        return Object.keys(value).length > 0;
    return true;
}
/** Equal as decimals, both given as decimal strings. */
function decimalEqual(left, right) {
    if (typeof left !== "string" || typeof right !== "string")
        return false;
    const norm = (s) => {
        const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/.exec(s);
        if (!m || (m[2] === "" && (m[3] ?? "") === ""))
            return undefined;
        const int = m[2].replace(/^0+/, "");
        const frac = (m[3] ?? "").replace(/0+$/, "");
        const sign = int === "" && frac === "" ? "" : m[1] === "-" ? "-" : "";
        return `${sign}${int}.${frac}`;
    };
    const a = norm(left);
    const b = norm(right);
    return a !== undefined && a === b;
}
/** Deep equality of JSON-like values, as Python's `==` on parsed YAML. */
function same(a, b) {
    if (a === b)
        return true;
    if (Array.isArray(a) && Array.isArray(b))
        return a.length === b.length && a.every((v, i) => same(v, b[i]));
    if (isObj(a) && isObj(b)) {
        const ka = Object.keys(a);
        return ka.length === Object.keys(b).length && ka.every((k) => k in b && same(a[k], b[k]));
    }
    return false;
}
const x402Of = (doc) => obj(obj(doc.extensions).x402);
const paymentMode = (doc) => (typeof x402Of(doc).mode === "string" ? x402Of(doc).mode : null);
const paymentIntents = (doc) => list(x402Of(doc).intents).filter(isObj);
function policiesById(doc) {
    const map = new Map();
    for (const policy of list(obj(doc.harness).policies))
        if (isObj(policy) && typeof policy.id === "string")
            map.set(policy.id, policy);
    return map;
}
function receiptsByIntent(doc) {
    const map = new Map();
    for (const ref of list(obj(obj(doc.extensions).receipts).refs))
        if (isObj(ref) && typeof ref.intentRef === "string")
            map.set(ref.intentRef, ref);
    return map;
}
function authorityMatchesIntent(intent) {
    const authority = obj(intent.authority);
    if (Object.keys(authority).length === 0)
        return false;
    for (const key of ["asset", "rail", "purpose", "scope"])
        if (!same(authority[key], intent[key]))
            return false;
    return decimalEqual(authority.maxAmount, intent.maxAmount);
}
function policyMatchesIntent(policy, intent) {
    const limits = obj(policy.limits);
    const enforcement = obj(policy.enforcement);
    if (policy.capability !== "payment")
        return false;
    if (policy.resource !== `x402:intent:${String(intent.id)}`)
        return false;
    if (policy.action !== intent.direction)
        return false;
    if (policy.effect !== "allow")
        return false;
    if (enforcement.target !== "policy-engine" || enforcement.phase !== "before-execution")
        return false;
    if (limits.requireReceipt !== true)
        return false;
    const price = obj(intent.price);
    const bound = intent.direction === "charge" ? (price.per === "token" ? price.maxPerCall : price.amount) : intent.maxAmount;
    return limits.asset === obj(intent.asset).symbol && decimalEqual(limits.maxAmount, bound);
}
function paymentSemanticDiagnostics(doc) {
    const problems = [];
    const x402 = x402Of(doc);
    const mode = paymentMode(doc);
    const fee = x402.protocolFee;
    if (isObj(fee)) {
        if (fee.bps !== ADL_V03_PROTOCOL_FEE_BPS)
            problems.push(`extensions.x402.protocolFee.bps must be ${ADL_V03_PROTOCOL_FEE_BPS}`);
        if ("launchRate" in fee) {
            const launch = obj(fee.launchRate);
            if (launch.bps !== ADL_V03_LAUNCH_RATE.bps || launch.endsAt !== ADL_V03_LAUNCH_RATE.endsAt)
                problems.push(`extensions.x402.protocolFee.launchRate must be ${ADL_V03_LAUNCH_RATE.bps} bps ending ${ADL_V03_LAUNCH_RATE.endsAt}`);
        }
        const cap = obj(fee.cap);
        if (cap.symbol !== "SOL" || !decimalEqual(cap.amount, ADL_V03_PROTOCOL_FEE_SOL_CAP))
            problems.push(`extensions.x402.protocolFee.cap must be ${ADL_V03_PROTOCOL_FEE_SOL_CAP} SOL`);
    }
    for (const intent of paymentIntents(doc)) {
        const id = String(intent.id ?? "None");
        const holders = [["", intent]];
        if (isObj(intent.authority))
            holders.push([".authority", intent.authority]);
        for (const [suffix, holder] of holders) {
            const asset = obj(holder.asset);
            const symbol = typeof asset.symbol === "string" ? asset.symbol : "";
            if (asset.network === "solana-mainnet-beta" && symbol in ADL_V03_MAINNET_MINTS && asset.mint !== ADL_V03_MAINNET_MINTS[symbol]) {
                problems.push(`extensions.x402.intents[${id}]${suffix}.asset.mint is not the allowlisted ${symbol} mint on solana-mainnet-beta`);
            }
        }
        if (intent.direction === "charge") {
            const perToken = obj(intent.price).per === "token";
            const metered = intent.settlement === "metered-escrow";
            if (perToken && !metered)
                problems.push(`extensions.x402.intents[${id}].settlement must be metered-escrow for a per-token price`);
            else if (metered && !perToken)
                problems.push(`extensions.x402.intents[${id}].settlement=metered-escrow needs a per-token price`);
        }
        if (mode === "live") {
            if (intent.rail !== ADL_V03_LIVE_RAIL)
                problems.push(`extensions.x402.intents[${id}].rail=${String(intent.rail ?? "None")} is an unsupported live payment rail`);
            if (intent.direction === "charge" && !isObj(fee))
                problems.push("extensions.x402.protocolFee is required for a live charge");
        }
    }
    return problems;
}
function authorityMissingFields(doc) {
    const policies = policiesById(doc);
    const receipts = receiptsByIntent(doc);
    const missing = [];
    for (const intent of paymentIntents(doc)) {
        if (typeof intent.id !== "string")
            continue;
        const id = intent.id;
        const direction = intent.direction;
        if (direction !== "spend" && direction !== "refund" && direction !== "charge")
            continue;
        if (direction !== "charge" || isObj(intent.authority)) {
            if (!authorityMatchesIntent(intent))
                missing.push(`extensions.x402.intents[${id}].authority`);
        }
        const receipt = receipts.get(id);
        if (!receipt)
            missing.push(`extensions.receipts.refs[intentRef=${id}]`);
        else if (receipt.format !== ADL_V03_RECEIPT_FORMAT)
            missing.push(`extensions.receipts.refs[intentRef=${id}].format=${ADL_V03_RECEIPT_FORMAT}`);
        const matched = list(intent.policyRefs).some((ref) => {
            const policy = typeof ref === "string" ? policies.get(ref) : undefined;
            return policy !== undefined && policyMatchesIntent(policy, intent);
        });
        if (!matched)
            missing.push(`harness.policies[payment:x402:intent:${id}]`);
    }
    return missing;
}
function hasProductionRuntime(doc) {
    const target = obj(obj(doc.harness).runtime).target;
    return typeof target === "string" && PRODUCTION_RUNTIME_TARGETS.has(target);
}
function hasDeploymentDescriptor(doc) {
    const deployment = obj(doc.harness).deployment;
    if (!isObj(deployment) || Object.keys(deployment).length === 0)
        return false;
    if (["container", "serverless", "platform-native", "openclaw"].includes(deployment.target))
        return true;
    if (["preview", "staging", "production"].includes(deployment.environment))
        return true;
    const rollback = obj(deployment.rollback);
    if (Object.keys(rollback).length > 0 && rollback.mode !== "none")
        return true;
    return ["region", "resources", "secretRefs", "networkPolicy", "storage", "scheduler", "observability", "healthCheck", "constraints"].some((f) => f in deployment);
}
function missingObservabilityEvents(doc, level) {
    const declared = new Set(list(obj(obj(doc.harness).observability).events).filter(isObj).map((e) => e.name).filter((n) => typeof n === "string"));
    return (OBSERVABILITY_EVENTS_BY_LEVEL[level] ?? []).filter((e) => !declared.has(e)).map((e) => `harness.observability.events.${e}`);
}
function levelMissingFields(doc, level) {
    if (level === 0)
        return [];
    if (level === 1) {
        const missing = ["harness.instructions", "harness.runtime.target", "harness.evalGates"].filter((f) => !hasPath(doc, f));
        return [...missing, ...missingObservabilityEvents(doc, 1)];
    }
    if (level === 2) {
        const missing = ["model.capability", "model.providers.preferred", "model.requirements", "harness.policies", "harness.evalGates"].filter((f) => !hasPath(doc, f));
        return [...missing, ...missingObservabilityEvents(doc, 2)];
    }
    if (level === 3) {
        const missing = [];
        const extensions = obj(doc.extensions);
        const x402 = obj(extensions.x402);
        if (x402.enabled !== true)
            missing.push("extensions.x402.enabled=true");
        const intents = x402.intents;
        if (!Array.isArray(intents) || intents.length === 0)
            missing.push("extensions.x402.intents");
        else if (intents.some((i) => isObj(i) && !hasValue(i.policyRefs)))
            missing.push("extensions.x402.intents[*].policyRefs");
        if (obj(extensions.receipts).required !== true)
            missing.push("extensions.receipts.required=true");
        if (!hasValue(obj(extensions.reputation).emitSignals))
            missing.push("extensions.reputation.emitSignals");
        if (paymentMode(doc) === null)
            missing.push("extensions.x402.mode");
        return [...missing, ...authorityMissingFields(doc), ...paymentSemanticDiagnostics(doc), ...missingObservabilityEvents(doc, 3)];
    }
    if (level === 4) {
        const missing = [];
        if (!hasProductionRuntime(doc))
            missing.push("harness.runtime.target in hosted-container|serverless|platform-native|openclaw");
        for (const f of ["harness.deployment.environment", "harness.deployment.rollback", "harness.observability.events", "harness.recovery.disable"])
            if (!hasPath(doc, f))
                missing.push(f);
        return [...missing, ...missingObservabilityEvents(doc, 4)];
    }
    throw new Error(`Unknown ADL v0.3 conformance level: ${level}`);
}
/** Python truthiness for the values a YAML document holds. */
function hasValue(value) {
    if (value === null || value === undefined || value === false || value === 0 || value === "")
        return false;
    if (Array.isArray(value))
        return value.length > 0;
    if (isObj(value))
        return Object.keys(value).length > 0;
    return true;
}
function levelForbidden(doc, level) {
    const forbidden = [];
    if (level < 3 && x402Of(doc).enabled)
        forbidden.push(LIVE_GATED_BEFORE_LEVEL_3);
    if (level < 4 && (hasProductionRuntime(doc) || hasDeploymentDescriptor(doc)))
        forbidden.push(LIVE_GATED_BEFORE_LEVEL_4);
    return forbidden;
}
/**
 * Checks an ADL v0.3 document against the schema and every conformance level
 * up to the requested one (the option, else `conformance.requestedLevel`,
 * else 0). The same verdict as the lab's `adl_v03_conformance.py`.
 */
export function checkAdlConformance(doc, options = {}) {
    const schemaErrors = schemaDiagnostics(doc);
    const declared = obj(doc.conformance).requestedLevel;
    const requested = options.requestedLevel ?? (typeof declared === "number" && Number.isInteger(declared) && declared >= 0 && declared <= 4 ? declared : 0);
    const missingFieldsByLevel = {};
    const forbiddenCapabilitiesByLevel = {};
    if (schemaErrors.length === 0) {
        for (let level = 0; level <= requested; level++) {
            missingFieldsByLevel[String(level)] = levelMissingFields(doc, level);
            forbiddenCapabilitiesByLevel[String(level)] = levelForbidden(doc, level);
        }
    }
    let achieved = -1;
    if (schemaErrors.length === 0) {
        achieved = 0;
        for (let level = 1; level <= 4; level++) {
            if (levelMissingFields(doc, level).length > 0)
                break;
            achieved = level;
        }
    }
    const requestedMissing = Object.values(missingFieldsByLevel).flat();
    const requestedForbidden = forbiddenCapabilitiesByLevel[String(requested)] ?? [];
    const pass = schemaErrors.length === 0 && requestedMissing.length === 0 && requestedForbidden.length === 0 && achieved >= requested;
    const mode = paymentMode(doc);
    return {
        agent: typeof obj(doc.metadata).name === "string" ? obj(doc.metadata).name : "",
        apiVersion: ADL_V03_API_VERSION,
        requestedLevel: requested,
        achievedLevel: achieved,
        status: pass ? "pass" : "fail",
        schemaDiagnostics: schemaErrors,
        missingFieldsByLevel,
        forbiddenCapabilitiesByLevel,
        payment: { mode, paymentMade: false, liveRailDeclared: mode === "live" },
    };
}
/** Every problem in a report, one line each, schema problems first. */
export function adlProblems(report) {
    return [
        ...report.schemaDiagnostics.map((d) => `${d.path}: ${d.message}`),
        ...Object.values(report.missingFieldsByLevel).flat(),
        ...(report.forbiddenCapabilitiesByLevel[String(report.requestedLevel)] ?? []),
    ];
}
const INTENT_ID = "charge-inference";
const RECEIPT_ID = "charge-inference-receipt";
const POLICY_ID = "allow-inference-charge";
const RECEIPT_EVIDENCE = "receipt:charge-inference";
/**
 * The schema's provider family for a model id: providers speak the
 * OpenAI-compatible API, so anything not plainly Anthropic, Gemini or Ollama
 * is "openai". The exact model is `extensions.identity.declaredModel`.
 */
export function adlProviderFamily(model) {
    const m = (model ?? "").toLowerCase();
    if (m.startsWith("anthropic/") || m.startsWith("claude"))
        return "anthropic";
    if (m.startsWith("google/") || m.startsWith("gemini"))
        return "gemini";
    if (m.startsWith("ollama/"))
        return "ollama";
    return "openai";
}
/** A `metadata.name` the schema accepts: lowercase letters, digits and dashes, 2 to 63 characters. */
export function adlNameSlug(name) {
    const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63).replace(/-+$/g, "");
    return slug.length >= 2 ? slug : `${slug || "provider"}${slug ? "-provider" : ""}`;
}
/**
 * The ADL v0.3 document for a provider on the Reddi Agent Protocol: a charge
 * on the Solana rail, priced per token and settled through metered escrow (or
 * priced per call and settled through escrow), with the protocol fee, a
 * reddi.receipt.v2 receipt and reputation signals. It passes Level 3. The
 * caller checks its inputs; a bad input gives a document that fails
 * `checkAdlConformance`, never a silently different one.
 */
export function buildProviderAdl(input) {
    const asset = { symbol: input.currency, network: input.network, mint: input.mint };
    const perToken = input.price.per === "token";
    const bound = input.price.per === "token" ? input.price.maxPerCall : input.price.amount;
    const serves = input.model ? `serves ${input.model}` : "takes paid work";
    const description = (input.description?.trim() || `${input.name} ${serves} through the Reddi Agent Protocol.`).replace(/\s+/g, " ");
    const event = (name, type, extra = {}) => ({ name, type, required: true, evidenceRef: `trace:${name}`, scope: "task", ...extra });
    const what = input.model ? ` with ${input.model}` : "";
    return {
        apiVersion: ADL_V03_API_VERSION,
        kind: "Agent",
        metadata: { name: adlNameSlug(input.name), description },
        model: {
            capability: "chat",
            providers: { preferred: adlProviderFamily(input.model) },
            requirements: { streaming: false },
        },
        conformance: { requestedLevel: 3, evidenceRefs: [RECEIPT_EVIDENCE] },
        harness: {
            instructions: {
                inline: perToken
                    ? `Answer paid requests${what}. Charge only for the tokens used, at the listed per-token price, through a metered escrow the buyer locked; never more than the buyer's lock. Return a signed ${ADL_V03_RECEIPT_FORMAT} receipt with every paid answer.`
                    : `Deliver each paid job${what} for the listed price, paid through an escrow the buyer locked. Return a signed ${ADL_V03_RECEIPT_FORMAT} receipt with every paid answer.`,
            },
            policies: [
                {
                    id: POLICY_ID,
                    capability: "payment",
                    subject: "agent",
                    resource: `x402:intent:${INTENT_ID}`,
                    action: "charge",
                    effect: "allow",
                    scope: { type: "task", value: INTENT_ID },
                    limits: { asset: input.currency, maxAmount: bound, requireReceipt: true },
                    approval: { required: false, mode: "none" },
                    enforcement: { target: "policy-engine", phase: "before-execution", targetRef: `x402:intent:${INTENT_ID}` },
                },
            ],
            evalGates: [
                {
                    id: "inference-receipt-required",
                    type: "receipt-check",
                    rule: "A signed receipt must be returned with every paid answer.",
                    required: true,
                    severity: "critical",
                    appliesTo: { scope: "receipt", targetRef: "extensions.receipts.refs" },
                    evidence: { ref: RECEIPT_EVIDENCE, schema: { type: "object", required: ["status"], properties: { status: { enum: ["pass", "fail"] } } } },
                    retryable: false,
                    onFailure: { completion: "block", defaultStatus: "fail", visibility: "trace-and-receipt" },
                },
            ],
            runtime: { target: "local-python", network: { access: "none", allowlist: [], denyByDefault: true }, storage: { mode: "ephemeral" }, scheduler: { trigger: "manual" }, activation: { mode: "blocked" } },
            observability: {
                events: [
                    event("trace.started", "trace"),
                    event("trace.completed", "trace"),
                    event("task.completed", "task"),
                    event("task.failed", "task"),
                    event("model.called", "model"),
                    event("policy.checked", "policy"),
                    event("eval.checked", "eval"),
                    event("payment.intent.created", "payment", { receiptRef: RECEIPT_ID }),
                    { name: "receipt.emitted", type: "receipt", required: true, evidenceRef: RECEIPT_EVIDENCE, scope: "receipt", receiptRef: RECEIPT_ID },
                    event("reputation.signal.emitted", "reputation"),
                ],
                summaries: [
                    {
                        id: "paid_call_summary",
                        type: "run-summary",
                        destinationRef: "provider_log",
                        eventRefs: ["task.completed", "task.failed", "payment.intent.created", "receipt.emitted"],
                        humanReadable: true,
                    },
                ],
                destinations: [{ id: "provider_log", type: "file", mode: "local-only", ref: "file://./.rap-provider/sessions.jsonl", redaction: { mode: "payload-redacted", fields: ["prompt", "output"] } }],
                retention: { mode: "ephemeral", purgeOnCompletion: true },
                redaction: { mode: "payload-redacted", fields: ["prompt", "output"] },
            },
        },
        extensions: {
            x402: {
                enabled: true,
                mode: input.mode ?? "live",
                protocolFee: { bps: ADL_V03_PROTOCOL_FEE_BPS, launchRate: { ...ADL_V03_LAUNCH_RATE }, rounding: "down", paidBy: "provider", cap: { symbol: "SOL", amount: ADL_V03_PROTOCOL_FEE_SOL_CAP }, base: "actual-cost" },
                intents: [
                    {
                        id: INTENT_ID,
                        direction: "charge",
                        asset,
                        rail: ADL_V03_LIVE_RAIL,
                        maxAmount: bound,
                        purpose: perToken ? `Charge a buyer for one call, priced per token.` : `Charge a buyer for one job at a fixed price.`,
                        scope: { type: "task", value: INTENT_ID },
                        requireReceipt: true,
                        receiptRef: RECEIPT_ID,
                        policyRefs: [POLICY_ID],
                        price: input.price.per === "token"
                            ? { per: "token", inputPerMillion: input.price.inputPerMillion, outputPerMillion: input.price.outputPerMillion, maxPerCall: input.price.maxPerCall }
                            : { per: "call", amount: input.price.amount },
                        payTo: input.payTo,
                        settlement: perToken ? "metered-escrow" : "escrow",
                    },
                ],
            },
            receipts: { required: true, refs: [{ id: RECEIPT_ID, intentRef: INTENT_ID, format: ADL_V03_RECEIPT_FORMAT, evidenceRef: RECEIPT_EVIDENCE, policyRefs: [POLICY_ID] }] },
            reputation: { emitSignals: ["taskCompleted", "receiptVerified"], basis: ["receipt", "policy"], evidenceRefs: [RECEIPT_EVIDENCE] },
            identity: { wallet: input.payTo, ...(input.model ? { declaredModel: input.model } : {}), ...(input.endpointUrl ? { endpoint: input.endpointUrl } : {}) },
        },
    };
}
/**
 * A provider's listing terms from its ADL: the document must pass Level 3 and
 * hold exactly one charge intent on the Solana rail, in a token, priced per
 * token (metered escrow) or per call (escrow).
 */
export function providerTermsFromAdl(doc) {
    const report = checkAdlConformance(doc, { requestedLevel: 3 });
    if (report.status !== "pass")
        return { ok: false, problems: adlProblems(report), report };
    const charges = paymentIntents(doc).filter((i) => i.direction === "charge");
    if (charges.length !== 1)
        return { ok: false, problems: [`extensions.x402.intents must hold exactly one charge intent for a listing; found ${charges.length}`], report };
    const intent = charges[0];
    const price = obj(intent.price);
    const asset = obj(intent.asset);
    if (intent.rail !== ADL_V03_LIVE_RAIL)
        return { ok: false, problems: ["the charge intent must use the solana rail"], report };
    if (typeof asset.mint !== "string" || (asset.network !== "solana-devnet" && asset.network !== "solana-mainnet-beta"))
        return { ok: false, problems: ["the charge intent must pay in a token on solana-devnet or solana-mainnet-beta"], report };
    let listed;
    if (price.per === "token" && intent.settlement === "metered-escrow")
        listed = { per: "token", inputPerMillion: String(price.inputPerMillion), outputPerMillion: String(price.outputPerMillion), maxPerCall: String(price.maxPerCall) };
    else if (price.per === "call" && intent.settlement === "escrow")
        listed = { per: "call", amount: String(price.amount) };
    else
        return { ok: false, problems: ["the charge intent must be priced per token and settled by metered-escrow, or priced per call and settled by escrow"], report };
    const metadata = obj(doc.metadata);
    const identity = obj(obj(doc.extensions).identity);
    return {
        ok: true,
        report,
        terms: {
            name: String(metadata.name ?? ""),
            description: String(metadata.description ?? ""),
            ...(typeof identity.declaredModel === "string" && identity.declaredModel ? { declaredModel: identity.declaredModel } : {}),
            ...(typeof identity.endpoint === "string" && identity.endpoint ? { endpointUrl: identity.endpoint } : {}),
            mode: paymentMode(doc) === "live" ? "live" : "dry-run",
            network: asset.network,
            currency: String(asset.symbol),
            mint: asset.mint,
            payTo: String(intent.payTo),
            price: listed,
        },
    };
}
// BEGIN GENERATED ADL v0.3 SCHEMA
// Generated by scripts/sync-adl-v03.mjs from nissan/reddiagent-lab
// specs/ADL-v0.3.schema.json (sha256 07ef5112a2efeb7db746897fab209e91de18d78a31ed8756f534a64ac21df9e0). Do not edit by hand.
/** SHA-256 of the lab's ADL v0.3 JSON Schema this copy was made from. */
export const ADL_V03_SCHEMA_SHA256 = "07ef5112a2efeb7db746897fab209e91de18d78a31ed8756f534a64ac21df9e0";
/** The ADL v0.3 JSON Schema (draft 2020-12). */
export const ADL_V03_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://reddiagent.dev/schemas/adl-v0.2.schema.json",
    "title": "ReddiAgent ADL v0.3",
    "type": "object",
    "additionalProperties": false,
    "required": [
        "apiVersion",
        "kind",
        "metadata",
        "model",
        "harness"
    ],
    "properties": {
        "apiVersion": {
            "const": "reddiagent.dev/v0.3"
        },
        "kind": {
            "const": "Agent"
        },
        "metadata": {
            "type": "object",
            "additionalProperties": true,
            "required": [
                "name",
                "description"
            ],
            "properties": {
                "name": {
                    "type": "string",
                    "pattern": "^[a-z0-9][a-z0-9-]{1,62}$"
                },
                "description": {
                    "type": "string",
                    "minLength": 1
                }
            }
        },
        "model": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "capability",
                "providers",
                "requirements"
            ],
            "properties": {
                "capability": {
                    "type": "string",
                    "enum": [
                        "chat",
                        "reasoning",
                        "code",
                        "vision",
                        "audio",
                        "embedding",
                        "reranking"
                    ]
                },
                "providers": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "preferred"
                    ],
                    "properties": {
                        "preferred": {
                            "$ref": "#/$defs/providerId"
                        },
                        "fallbacks": {
                            "type": "array",
                            "items": {
                                "$ref": "#/$defs/providerId"
                            },
                            "uniqueItems": true
                        }
                    }
                },
                "requirements": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "toolCalling": {
                            "type": "boolean"
                        },
                        "structuredOutput": {
                            "type": "boolean"
                        },
                        "streaming": {
                            "type": "boolean"
                        },
                        "jsonMode": {
                            "type": "boolean"
                        },
                        "contextWindow": {
                            "type": "integer",
                            "minimum": 1
                        },
                        "maxOutputTokens": {
                            "type": "integer",
                            "minimum": 1
                        },
                        "modalities": {
                            "type": "array",
                            "items": {
                                "$ref": "#/$defs/modality"
                            },
                            "uniqueItems": true
                        }
                    }
                },
                "cost": {
                    "type": "object",
                    "additionalProperties": true,
                    "properties": {
                        "latencyBudget": {
                            "type": "string",
                            "minLength": 1
                        },
                        "maxUsdPerTask": {
                            "type": "string",
                            "pattern": "^[0-9]+(\\.[0-9]+)?$"
                        }
                    }
                }
            }
        },
        "harness": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "instructions",
                "runtime"
            ],
            "properties": {
                "instructions": {
                    "type": "object",
                    "additionalProperties": false,
                    "oneOf": [
                        {
                            "required": [
                                "inline"
                            ],
                            "not": {
                                "required": [
                                    "path"
                                ]
                            }
                        },
                        {
                            "required": [
                                "path"
                            ],
                            "not": {
                                "required": [
                                    "inline"
                                ]
                            }
                        }
                    ],
                    "properties": {
                        "inline": {
                            "type": "string",
                            "minLength": 1
                        },
                        "path": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                },
                "tools": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/tool"
                    }
                },
                "functions": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/tool"
                    }
                },
                "skills": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/namedRef"
                    }
                },
                "dataSources": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/dataSource"
                    }
                },
                "memory": {
                    "$ref": "#/$defs/memory"
                },
                "policies": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/policy"
                    },
                    "uniqueItems": true
                },
                "evalGates": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/evalGate"
                    }
                },
                "runtime": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "target"
                    ],
                    "properties": {
                        "target": {
                            "type": "string",
                            "enum": [
                                "local-python",
                                "hosted-container",
                                "serverless",
                                "platform-native",
                                "openclaw"
                            ]
                        },
                        "network": {
                            "$ref": "#/$defs/runtimeNetwork"
                        },
                        "secretRefs": {
                            "$ref": "#/$defs/secretRefs"
                        },
                        "storage": {
                            "$ref": "#/$defs/runtimeStorage"
                        },
                        "scheduler": {
                            "$ref": "#/$defs/runtimeScheduler"
                        },
                        "activation": {
                            "$ref": "#/$defs/runtimeActivation"
                        },
                        "constraints": {
                            "$ref": "#/$defs/targetConstraints"
                        }
                    }
                },
                "deployment": {
                    "$ref": "#/$defs/deployment"
                },
                "observability": {
                    "$ref": "#/$defs/observability"
                },
                "recovery": {
                    "$ref": "#/$defs/recovery"
                }
            }
        },
        "conformance": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "requestedLevel"
            ],
            "properties": {
                "requestedLevel": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 4
                },
                "evidenceRefs": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "minLength": 1
                    },
                    "uniqueItems": true
                }
            }
        },
        "extensions": {
            "type": "object",
            "additionalProperties": false,
            "patternProperties": {
                "^x-[A-Za-z0-9_.-]+$": {
                    "type": "object",
                    "additionalProperties": true
                },
                "^https?://[^\\s]+$": {
                    "type": "object",
                    "additionalProperties": true
                }
            },
            "properties": {
                "x402": {
                    "$ref": "#/$defs/x402"
                },
                "receipts": {
                    "$ref": "#/$defs/receiptExtension"
                },
                "reputation": {
                    "$ref": "#/$defs/reputationExtension"
                },
                "identity": {
                    "type": "object",
                    "additionalProperties": true
                }
            }
        }
    },
    "$defs": {
        "providerId": {
            "type": "string",
            "enum": [
                "openai",
                "anthropic",
                "gemini",
                "ollama"
            ]
        },
        "modality": {
            "type": "string",
            "enum": [
                "text",
                "image",
                "audio",
                "embedding"
            ]
        },
        "namedRef": {
            "type": "object",
            "additionalProperties": true,
            "required": [
                "id"
            ],
            "properties": {
                "id": {
                    "type": "string",
                    "minLength": 1
                },
                "type": {
                    "type": "string"
                },
                "description": {
                    "type": "string"
                }
            }
        },
        "dataSource": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "id",
                "type",
                "description",
                "sourceRef",
                "trust",
                "citationRequired",
                "sourceCheck"
            ],
            "properties": {
                "id": {
                    "type": "string",
                    "pattern": "^[a-zA-Z][a-zA-Z0-9_\\-]*$"
                },
                "type": {
                    "type": "string",
                    "enum": [
                        "file",
                        "url",
                        "api",
                        "database",
                        "vector-index",
                        "mcp"
                    ]
                },
                "description": {
                    "type": "string",
                    "minLength": 1
                },
                "sourceRef": {
                    "type": "string",
                    "pattern": "^(file|url|api|database|vector-index|mcp):[A-Za-z0-9._~:/?#\\[\\]@!$&'()*+,;=%-]+$"
                },
                "path": {
                    "type": "string",
                    "minLength": 1
                },
                "url": {
                    "type": "string",
                    "pattern": "^https?://[^\\s]+$"
                },
                "api": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "endpoint",
                        "method"
                    ],
                    "properties": {
                        "endpoint": {
                            "type": "string",
                            "pattern": "^https?://[^\\s]+$"
                        },
                        "method": {
                            "type": "string",
                            "enum": [
                                "GET",
                                "POST",
                                "PUT",
                                "PATCH",
                                "DELETE"
                            ]
                        },
                        "authRef": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                },
                "database": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "engine",
                        "connectionRef"
                    ],
                    "properties": {
                        "engine": {
                            "type": "string",
                            "enum": [
                                "sqlite",
                                "postgres",
                                "mysql",
                                "duckdb",
                                "other"
                            ]
                        },
                        "connectionRef": {
                            "type": "string",
                            "minLength": 1
                        },
                        "schemaRef": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                },
                "vectorIndex": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "indexRef"
                    ],
                    "properties": {
                        "indexRef": {
                            "type": "string",
                            "minLength": 1
                        },
                        "embeddingModel": {
                            "type": "string",
                            "minLength": 1
                        },
                        "namespace": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                },
                "mcp": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "serverRef",
                        "outputShape"
                    ],
                    "properties": {
                        "serverRef": {
                            "type": "string",
                            "minLength": 1
                        },
                        "toolName": {
                            "type": "string",
                            "minLength": 1
                        },
                        "outputShape": {
                            "type": "string",
                            "enum": [
                                "metadata-only",
                                "source-citable-output"
                            ]
                        }
                    }
                },
                "trust": {
                    "type": "string",
                    "enum": [
                        "approved",
                        "untrusted",
                        "unknown"
                    ]
                },
                "citationRequired": {
                    "type": "boolean"
                },
                "sourceCheck": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "required",
                        "expectation"
                    ],
                    "properties": {
                        "required": {
                            "type": "boolean"
                        },
                        "expectation": {
                            "type": "string",
                            "enum": [
                                "approved-source",
                                "manual-review",
                                "not-citable"
                            ]
                        },
                        "gateRef": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "file"
                            }
                        },
                        "required": [
                            "type"
                        ]
                    },
                    "then": {
                        "required": [
                            "path"
                        ],
                        "properties": {
                            "sourceRef": {
                                "pattern": "^file:"
                            }
                        },
                        "not": {
                            "anyOf": [
                                {
                                    "required": [
                                        "url"
                                    ]
                                },
                                {
                                    "required": [
                                        "api"
                                    ]
                                },
                                {
                                    "required": [
                                        "database"
                                    ]
                                },
                                {
                                    "required": [
                                        "vectorIndex"
                                    ]
                                },
                                {
                                    "required": [
                                        "mcp"
                                    ]
                                }
                            ]
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "url"
                            }
                        },
                        "required": [
                            "type"
                        ]
                    },
                    "then": {
                        "required": [
                            "url"
                        ],
                        "properties": {
                            "sourceRef": {
                                "pattern": "^url:"
                            }
                        },
                        "not": {
                            "anyOf": [
                                {
                                    "required": [
                                        "path"
                                    ]
                                },
                                {
                                    "required": [
                                        "api"
                                    ]
                                },
                                {
                                    "required": [
                                        "database"
                                    ]
                                },
                                {
                                    "required": [
                                        "vectorIndex"
                                    ]
                                },
                                {
                                    "required": [
                                        "mcp"
                                    ]
                                }
                            ]
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "api"
                            }
                        },
                        "required": [
                            "type"
                        ]
                    },
                    "then": {
                        "required": [
                            "api"
                        ],
                        "properties": {
                            "sourceRef": {
                                "pattern": "^api:"
                            }
                        },
                        "not": {
                            "anyOf": [
                                {
                                    "required": [
                                        "path"
                                    ]
                                },
                                {
                                    "required": [
                                        "url"
                                    ]
                                },
                                {
                                    "required": [
                                        "database"
                                    ]
                                },
                                {
                                    "required": [
                                        "vectorIndex"
                                    ]
                                },
                                {
                                    "required": [
                                        "mcp"
                                    ]
                                }
                            ]
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "database"
                            }
                        },
                        "required": [
                            "type"
                        ]
                    },
                    "then": {
                        "required": [
                            "database"
                        ],
                        "properties": {
                            "sourceRef": {
                                "pattern": "^database:"
                            }
                        },
                        "not": {
                            "anyOf": [
                                {
                                    "required": [
                                        "path"
                                    ]
                                },
                                {
                                    "required": [
                                        "url"
                                    ]
                                },
                                {
                                    "required": [
                                        "api"
                                    ]
                                },
                                {
                                    "required": [
                                        "vectorIndex"
                                    ]
                                },
                                {
                                    "required": [
                                        "mcp"
                                    ]
                                }
                            ]
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "vector-index"
                            }
                        },
                        "required": [
                            "type"
                        ]
                    },
                    "then": {
                        "required": [
                            "vectorIndex"
                        ],
                        "properties": {
                            "sourceRef": {
                                "pattern": "^vector-index:"
                            }
                        },
                        "not": {
                            "anyOf": [
                                {
                                    "required": [
                                        "path"
                                    ]
                                },
                                {
                                    "required": [
                                        "url"
                                    ]
                                },
                                {
                                    "required": [
                                        "api"
                                    ]
                                },
                                {
                                    "required": [
                                        "database"
                                    ]
                                },
                                {
                                    "required": [
                                        "mcp"
                                    ]
                                }
                            ]
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "mcp"
                            }
                        },
                        "required": [
                            "type"
                        ]
                    },
                    "then": {
                        "required": [
                            "mcp"
                        ],
                        "properties": {
                            "sourceRef": {
                                "pattern": "^mcp:"
                            }
                        },
                        "not": {
                            "anyOf": [
                                {
                                    "required": [
                                        "path"
                                    ]
                                },
                                {
                                    "required": [
                                        "url"
                                    ]
                                },
                                {
                                    "required": [
                                        "api"
                                    ]
                                },
                                {
                                    "required": [
                                        "database"
                                    ]
                                },
                                {
                                    "required": [
                                        "vectorIndex"
                                    ]
                                }
                            ]
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "trust": {
                                "const": "approved"
                            }
                        },
                        "required": [
                            "trust"
                        ]
                    },
                    "then": {
                        "properties": {
                            "citationRequired": {
                                "const": true
                            },
                            "sourceCheck": {
                                "properties": {
                                    "required": {
                                        "const": true
                                    },
                                    "expectation": {
                                        "const": "approved-source"
                                    }
                                },
                                "required": [
                                    "required",
                                    "expectation"
                                ]
                            }
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "trust": {
                                "enum": [
                                    "untrusted",
                                    "unknown"
                                ]
                            }
                        },
                        "required": [
                            "trust"
                        ]
                    },
                    "then": {
                        "properties": {
                            "citationRequired": {
                                "const": true
                            },
                            "sourceCheck": {
                                "properties": {
                                    "required": {
                                        "const": true
                                    },
                                    "expectation": {
                                        "enum": [
                                            "manual-review",
                                            "not-citable"
                                        ]
                                    }
                                },
                                "required": [
                                    "required",
                                    "expectation"
                                ]
                            }
                        }
                    }
                }
            ]
        },
        "memory": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "mode"
            ],
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": [
                        "none",
                        "session",
                        "persistent",
                        "external"
                    ]
                },
                "retention": {
                    "type": "string",
                    "minLength": 1
                },
                "scope": {
                    "type": "string",
                    "enum": [
                        "task",
                        "session",
                        "project",
                        "user",
                        "workspace",
                        "external"
                    ]
                },
                "storageRef": {
                    "type": "string",
                    "minLength": 1
                },
                "privacyPolicy": {
                    "type": "string",
                    "minLength": 1
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "mode": {
                                "enum": [
                                    "persistent",
                                    "external"
                                ]
                            }
                        },
                        "required": [
                            "mode"
                        ]
                    },
                    "then": {
                        "required": [
                            "retention",
                            "privacyPolicy"
                        ]
                    }
                }
            ]
        },
        "secretRefs": {
            "type": "array",
            "items": {
                "$ref": "#/$defs/secretRef"
            },
            "uniqueItems": true
        },
        "secretRef": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "name",
                "provider"
            ],
            "properties": {
                "name": {
                    "type": "string",
                    "pattern": "^[A-Z][A-Z0-9_]{1,127}$"
                },
                "provider": {
                    "type": "string",
                    "enum": [
                        "env",
                        "vault",
                        "onepassword",
                        "cloud-secret-manager",
                        "openclaw-secret-ref"
                    ]
                },
                "ref": {
                    "type": "string",
                    "minLength": 1
                },
                "scope": {
                    "type": "string",
                    "enum": [
                        "runtime",
                        "deployment",
                        "provider",
                        "tool"
                    ]
                },
                "required": {
                    "type": "boolean"
                }
            },
            "allOf": [
                {
                    "not": {
                        "properties": {
                            "ref": {
                                "pattern": "^(sk-|sk_live_|sk_test_|xox[baprs]-|gh[pousr]_|AKIA|AIza|-----BEGIN )"
                            }
                        },
                        "required": [
                            "ref"
                        ]
                    }
                }
            ]
        },
        "runtimeNetwork": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "access"
            ],
            "properties": {
                "access": {
                    "type": "string",
                    "enum": [
                        "none",
                        "egress",
                        "ingress",
                        "egress-and-ingress"
                    ]
                },
                "allowlist": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "minLength": 1
                    },
                    "uniqueItems": true
                },
                "denyByDefault": {
                    "type": "boolean"
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "access": {
                                "const": "none"
                            }
                        },
                        "required": [
                            "access"
                        ]
                    },
                    "then": {
                        "properties": {
                            "allowlist": {
                                "maxItems": 0
                            },
                            "denyByDefault": {
                                "const": true
                            }
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "access": {
                                "enum": [
                                    "egress",
                                    "ingress",
                                    "egress-and-ingress"
                                ]
                            }
                        },
                        "required": [
                            "access"
                        ]
                    },
                    "then": {
                        "required": [
                            "allowlist",
                            "denyByDefault"
                        ]
                    }
                }
            ]
        },
        "runtimeStorage": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "mode"
            ],
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": [
                        "none",
                        "ephemeral",
                        "persistent",
                        "external"
                    ]
                },
                "refs": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "minLength": 1
                    },
                    "uniqueItems": true
                },
                "retention": {
                    "type": "string",
                    "minLength": 1
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "mode": {
                                "enum": [
                                    "persistent",
                                    "external"
                                ]
                            }
                        },
                        "required": [
                            "mode"
                        ]
                    },
                    "then": {
                        "required": [
                            "refs",
                            "retention"
                        ]
                    }
                }
            ]
        },
        "runtimeScheduler": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "trigger"
            ],
            "properties": {
                "trigger": {
                    "type": "string",
                    "enum": [
                        "manual",
                        "cron",
                        "event",
                        "webhook",
                        "queue"
                    ]
                },
                "schedule": {
                    "type": "string",
                    "minLength": 1
                },
                "eventRef": {
                    "type": "string",
                    "minLength": 1
                },
                "timezone": {
                    "type": "string",
                    "minLength": 1
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "trigger": {
                                "const": "cron"
                            }
                        },
                        "required": [
                            "trigger"
                        ]
                    },
                    "then": {
                        "required": [
                            "schedule",
                            "timezone"
                        ]
                    }
                },
                {
                    "if": {
                        "properties": {
                            "trigger": {
                                "enum": [
                                    "event",
                                    "webhook",
                                    "queue"
                                ]
                            }
                        },
                        "required": [
                            "trigger"
                        ]
                    },
                    "then": {
                        "required": [
                            "eventRef"
                        ]
                    }
                }
            ]
        },
        "runtimeActivation": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "mode"
            ],
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": [
                        "blocked",
                        "approval-required",
                        "approved-bounded"
                    ]
                },
                "approvalRef": {
                    "type": "string",
                    "minLength": 1
                },
                "expiresAt": {
                    "type": "string",
                    "minLength": 1
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "mode": {
                                "const": "approved-bounded"
                            }
                        },
                        "required": [
                            "mode"
                        ]
                    },
                    "then": {
                        "required": [
                            "approvalRef",
                            "expiresAt"
                        ]
                    }
                }
            ]
        },
        "targetConstraints": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "runtimeVersion": {
                    "type": "string",
                    "minLength": 1
                },
                "image": {
                    "type": "string",
                    "minLength": 1
                },
                "region": {
                    "type": "string",
                    "minLength": 1
                },
                "maxDurationSeconds": {
                    "type": "integer",
                    "minimum": 1
                },
                "maxConcurrency": {
                    "type": "integer",
                    "minimum": 1
                }
            }
        },
        "deployment": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "target": {
                    "type": "string",
                    "enum": [
                        "local",
                        "container",
                        "serverless",
                        "platform-native",
                        "openclaw"
                    ]
                },
                "environment": {
                    "type": "string",
                    "enum": [
                        "local",
                        "preview",
                        "staging",
                        "production"
                    ]
                },
                "region": {
                    "type": "string",
                    "minLength": 1
                },
                "resources": {
                    "$ref": "#/$defs/deploymentResources"
                },
                "secretRefs": {
                    "$ref": "#/$defs/secretRefs"
                },
                "networkPolicy": {
                    "$ref": "#/$defs/runtimeNetwork"
                },
                "storage": {
                    "$ref": "#/$defs/runtimeStorage"
                },
                "scheduler": {
                    "$ref": "#/$defs/runtimeScheduler"
                },
                "observability": {
                    "$ref": "#/$defs/observability"
                },
                "rollback": {
                    "$ref": "#/$defs/rollback"
                },
                "healthCheck": {
                    "$ref": "#/$defs/healthCheck"
                },
                "constraints": {
                    "$ref": "#/$defs/targetConstraints"
                }
            }
        },
        "deploymentResources": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "cpu": {
                    "type": "string",
                    "minLength": 1
                },
                "memory": {
                    "type": "string",
                    "minLength": 1
                },
                "timeoutSeconds": {
                    "type": "integer",
                    "minimum": 1
                }
            }
        },
        "observability": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "events",
                "summaries",
                "destinations",
                "retention",
                "redaction"
            ],
            "properties": {
                "events": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "$ref": "#/$defs/observabilityEvent"
                    },
                    "uniqueItems": true
                },
                "summaries": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "$ref": "#/$defs/observabilitySummary"
                    },
                    "uniqueItems": true
                },
                "destinations": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "$ref": "#/$defs/observabilityDestination"
                    },
                    "uniqueItems": true
                },
                "sinks": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/observabilityDestination"
                    },
                    "uniqueItems": true
                },
                "evidenceRefs": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/observabilityEvidenceRef"
                    },
                    "uniqueItems": true
                },
                "traceRef": {
                    "type": "string",
                    "minLength": 1
                },
                "retention": {
                    "$ref": "#/$defs/observabilityRetention"
                },
                "redaction": {
                    "$ref": "#/$defs/observabilityRedaction"
                },
                "receipts": {
                    "$ref": "#/$defs/observabilityRelationship"
                },
                "exports": {
                    "$ref": "#/$defs/observabilityRelationship"
                }
            }
        },
        "observabilityEventName": {
            "type": "string",
            "enum": [
                "trace.started",
                "model.called",
                "tool.called",
                "policy.checked",
                "eval.checked",
                "payment.intent.created",
                "payment.settled",
                "receipt.emitted",
                "reputation.signal.emitted",
                "deployment.health.checked",
                "adapter.loss.reported",
                "task.completed",
                "task.failed",
                "trace.completed"
            ]
        },
        "observabilityEvent": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "name",
                "type",
                "required",
                "evidenceRef"
            ],
            "properties": {
                "name": {
                    "$ref": "#/$defs/observabilityEventName"
                },
                "type": {
                    "type": "string",
                    "enum": [
                        "trace",
                        "model",
                        "tool",
                        "policy",
                        "eval",
                        "payment",
                        "receipt",
                        "reputation",
                        "deployment",
                        "adapter",
                        "task"
                    ]
                },
                "required": {
                    "type": "boolean"
                },
                "evidenceRef": {
                    "$ref": "#/$defs/observabilityEvidenceRef"
                },
                "scope": {
                    "type": "string",
                    "enum": [
                        "task",
                        "session",
                        "runtime",
                        "deployment",
                        "adapter",
                        "receipt",
                        "export"
                    ]
                },
                "summaryRef": {
                    "type": "string",
                    "minLength": 1
                },
                "receiptRef": {
                    "type": "string",
                    "minLength": 1
                },
                "exportRef": {
                    "type": "string",
                    "minLength": 1
                }
            }
        },
        "observabilitySummary": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "id",
                "type",
                "destinationRef",
                "eventRefs"
            ],
            "properties": {
                "id": {
                    "type": "string",
                    "pattern": "^[a-zA-Z][a-zA-Z0-9_\\-]*$"
                },
                "type": {
                    "type": "string",
                    "enum": [
                        "run-summary",
                        "trace-summary",
                        "adapter-loss-summary",
                        "deployment-readiness-summary"
                    ]
                },
                "destinationRef": {
                    "type": "string",
                    "minLength": 1
                },
                "eventRefs": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "$ref": "#/$defs/observabilityEventName"
                    },
                    "uniqueItems": true
                },
                "humanReadable": {
                    "type": "boolean"
                }
            }
        },
        "observabilityDestination": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "id",
                "type",
                "mode",
                "ref",
                "redaction"
            ],
            "properties": {
                "id": {
                    "type": "string",
                    "pattern": "^[a-zA-Z][a-zA-Z0-9_\\-]*$"
                },
                "type": {
                    "type": "string",
                    "enum": [
                        "stdout",
                        "file",
                        "otlp",
                        "webhook",
                        "openclaw-trace"
                    ]
                },
                "mode": {
                    "type": "string",
                    "enum": [
                        "local-only",
                        "adapter-managed",
                        "external-reviewed"
                    ]
                },
                "ref": {
                    "type": "string",
                    "minLength": 1
                },
                "redaction": {
                    "$ref": "#/$defs/observabilityRedaction"
                }
            }
        },
        "observabilityEvidenceRef": {
            "type": "string",
            "pattern": "^(trace|evidence|receipt|export):[A-Za-z0-9._~:/?#\\[\\]@!$&'()*+,;=%-]+$"
        },
        "observabilityRetention": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "mode"
            ],
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": [
                        "ephemeral",
                        "time-bound",
                        "external-managed"
                    ]
                },
                "maxAge": {
                    "type": "string",
                    "minLength": 1
                },
                "storageRef": {
                    "type": "string",
                    "minLength": 1
                },
                "purgeOnCompletion": {
                    "type": "boolean"
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "mode": {
                                "enum": [
                                    "time-bound",
                                    "external-managed"
                                ]
                            }
                        },
                        "required": [
                            "mode"
                        ]
                    },
                    "then": {
                        "required": [
                            "maxAge",
                            "storageRef"
                        ]
                    }
                }
            ]
        },
        "observabilityRedaction": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "mode"
            ],
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": [
                        "metadata-only",
                        "payload-redacted",
                        "full"
                    ]
                },
                "fields": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "minLength": 1
                    },
                    "uniqueItems": true
                }
            }
        },
        "observabilityRelationship": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "include",
                "eventRefs"
            ],
            "properties": {
                "include": {
                    "type": "boolean"
                },
                "eventRefs": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/observabilityEventName"
                    },
                    "uniqueItems": true
                },
                "requiredEvidenceRefs": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/observabilityEvidenceRef"
                    },
                    "uniqueItems": true
                }
            }
        },
        "rollback": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "mode"
            ],
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": [
                        "none",
                        "dry-run-disable",
                        "previous-version",
                        "operator-reviewed"
                    ]
                },
                "ref": {
                    "type": "string",
                    "minLength": 1
                },
                "requiresApproval": {
                    "type": "boolean"
                }
            }
        },
        "healthCheck": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "type",
                "ref"
            ],
            "properties": {
                "type": {
                    "type": "string",
                    "enum": [
                        "none",
                        "http",
                        "command",
                        "trace-event"
                    ]
                },
                "ref": {
                    "type": "string",
                    "minLength": 1
                },
                "intervalSeconds": {
                    "type": "integer",
                    "minimum": 1
                }
            }
        },
        "recovery": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "disable": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "mode"
                    ],
                    "properties": {
                        "mode": {
                            "type": "string",
                            "enum": [
                                "manual",
                                "operator-reviewed",
                                "policy-engine"
                            ]
                        },
                        "ref": {
                            "type": "string",
                            "minLength": 1
                        },
                        "requiresApproval": {
                            "type": "boolean"
                        }
                    }
                },
                "restart": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "mode"
                    ],
                    "properties": {
                        "mode": {
                            "type": "string",
                            "enum": [
                                "none",
                                "manual",
                                "bounded-retry"
                            ]
                        },
                        "maxAttempts": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 10
                        }
                    }
                }
            }
        },
        "tool": {
            "type": "object",
            "additionalProperties": true,
            "required": [
                "id",
                "type",
                "description"
            ],
            "properties": {
                "id": {
                    "type": "string",
                    "pattern": "^[a-zA-Z][a-zA-Z0-9_\\-]*$"
                },
                "type": {
                    "type": "string",
                    "enum": [
                        "function",
                        "mcp",
                        "http",
                        "native"
                    ]
                },
                "description": {
                    "type": "string",
                    "minLength": 1
                },
                "inputSchema": {
                    "type": "object"
                },
                "outputSchema": {
                    "type": "object"
                },
                "permissions": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": [
                            "tool",
                            "network",
                            "payment",
                            "shell",
                            "filesystem",
                            "messaging",
                            "mcp",
                            "mutation"
                        ]
                    },
                    "uniqueItems": true
                },
                "sideEffects": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "mode"
                    ],
                    "properties": {
                        "mode": {
                            "type": "string",
                            "enum": [
                                "none",
                                "read",
                                "write",
                                "network",
                                "payment",
                                "messaging",
                                "shell",
                                "filesystem",
                                "mcp",
                                "multiple"
                            ]
                        },
                        "mutatesState": {
                            "type": "boolean"
                        },
                        "external": {
                            "type": "boolean"
                        },
                        "resources": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "minLength": 1
                            },
                            "uniqueItems": true
                        }
                    }
                },
                "timeout": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "seconds"
                    ],
                    "properties": {
                        "seconds": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 3600
                        },
                        "behavior": {
                            "type": "string",
                            "enum": [
                                "fail-closed",
                                "cancel",
                                "retry"
                            ]
                        }
                    }
                },
                "retryPolicy": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "maxAttempts"
                    ],
                    "properties": {
                        "maxAttempts": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 10
                        },
                        "backoff": {
                            "type": "string",
                            "enum": [
                                "none",
                                "fixed",
                                "exponential"
                            ]
                        },
                        "retryOn": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "minLength": 1
                            },
                            "uniqueItems": true
                        }
                    }
                },
                "auditLevel": {
                    "type": "string",
                    "enum": [
                        "none",
                        "metadata",
                        "event",
                        "payload-redacted",
                        "full"
                    ]
                },
                "policyRefs": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "string",
                        "minLength": 1
                    },
                    "uniqueItems": true
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "type": {
                                "const": "mcp"
                            }
                        },
                        "required": [
                            "type"
                        ]
                    },
                    "then": {
                        "required": [
                            "policyRefs"
                        ]
                    }
                },
                {
                    "if": {
                        "properties": {
                            "permissions": {
                                "contains": {
                                    "enum": [
                                        "network",
                                        "payment",
                                        "shell",
                                        "filesystem",
                                        "messaging",
                                        "mcp",
                                        "mutation"
                                    ]
                                }
                            }
                        },
                        "required": [
                            "permissions"
                        ]
                    },
                    "then": {
                        "required": [
                            "policyRefs"
                        ]
                    }
                },
                {
                    "if": {
                        "properties": {
                            "sideEffects": {
                                "properties": {
                                    "mode": {
                                        "enum": [
                                            "write",
                                            "network",
                                            "payment",
                                            "messaging",
                                            "shell",
                                            "filesystem",
                                            "mcp",
                                            "multiple"
                                        ]
                                    }
                                },
                                "required": [
                                    "mode"
                                ]
                            }
                        },
                        "required": [
                            "sideEffects"
                        ]
                    },
                    "then": {
                        "required": [
                            "policyRefs"
                        ]
                    }
                }
            ]
        },
        "policy": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "id",
                "capability",
                "subject",
                "resource",
                "action",
                "effect",
                "scope",
                "enforcement"
            ],
            "properties": {
                "id": {
                    "type": "string",
                    "minLength": 1
                },
                "capability": {
                    "type": "string",
                    "enum": [
                        "tool",
                        "network",
                        "filesystem",
                        "payment",
                        "messaging",
                        "shell",
                        "human-approval",
                        "data",
                        "memory",
                        "runtime"
                    ]
                },
                "subject": {
                    "type": "string",
                    "minLength": 1
                },
                "resource": {
                    "type": "string",
                    "minLength": 1
                },
                "action": {
                    "type": "string",
                    "minLength": 1
                },
                "effect": {
                    "type": "string",
                    "enum": [
                        "allow",
                        "deny"
                    ]
                },
                "scope": {
                    "type": "object",
                    "additionalProperties": true,
                    "required": [
                        "type"
                    ],
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": [
                                "task",
                                "session",
                                "project",
                                "workspace",
                                "agent",
                                "resource",
                                "external"
                            ]
                        },
                        "value": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                },
                "limits": {
                    "type": "object",
                    "additionalProperties": true
                },
                "approval": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "required"
                    ],
                    "properties": {
                        "required": {
                            "type": "boolean"
                        },
                        "mode": {
                            "type": "string",
                            "enum": [
                                "none",
                                "human",
                                "operator",
                                "policy-engine"
                            ]
                        },
                        "threshold": {
                            "type": "string",
                            "minLength": 1
                        },
                        "approver": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                },
                "enforcement": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "target",
                        "phase"
                    ],
                    "properties": {
                        "target": {
                            "type": "string",
                            "enum": [
                                "static-validator",
                                "runtime-adapter",
                                "policy-engine",
                                "human-review"
                            ]
                        },
                        "phase": {
                            "type": "string",
                            "enum": [
                                "compatibility",
                                "before-execution",
                                "during-execution",
                                "after-execution"
                            ]
                        },
                        "targetRef": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "capability": {
                                "const": "human-approval"
                            }
                        },
                        "required": [
                            "capability"
                        ]
                    },
                    "then": {
                        "required": [
                            "approval"
                        ],
                        "properties": {
                            "approval": {
                                "properties": {
                                    "required": {
                                        "const": true
                                    }
                                },
                                "required": [
                                    "required"
                                ]
                            },
                            "enforcement": {
                                "properties": {
                                    "target": {
                                        "const": "human-review"
                                    }
                                },
                                "required": [
                                    "target"
                                ]
                            }
                        }
                    }
                }
            ]
        },
        "policyRefList": {
            "type": "array",
            "items": {
                "type": "string",
                "minLength": 1
            },
            "uniqueItems": true
        },
        "evalGate": {
            "type": "object",
            "additionalProperties": true,
            "required": [
                "id",
                "type",
                "rule",
                "required",
                "severity",
                "appliesTo",
                "evidence",
                "retryable",
                "onFailure"
            ],
            "properties": {
                "id": {
                    "type": "string",
                    "minLength": 1
                },
                "type": {
                    "type": "string",
                    "enum": [
                        "output-check",
                        "source-check",
                        "tool-check",
                        "budget-check",
                        "receipt-check",
                        "human-review"
                    ]
                },
                "rule": {
                    "type": "string",
                    "minLength": 1
                },
                "required": {
                    "type": "boolean"
                },
                "severity": {
                    "type": "string",
                    "enum": [
                        "info",
                        "warning",
                        "error",
                        "critical"
                    ]
                },
                "appliesTo": {
                    "type": "object",
                    "additionalProperties": true,
                    "required": [
                        "scope"
                    ],
                    "properties": {
                        "scope": {
                            "type": "string",
                            "enum": [
                                "task",
                                "output",
                                "tool",
                                "source",
                                "budget",
                                "receipt",
                                "human-review"
                            ]
                        },
                        "targetRef": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                },
                "evidence": {
                    "type": "object",
                    "additionalProperties": true,
                    "required": [
                        "ref",
                        "schema"
                    ],
                    "properties": {
                        "ref": {
                            "type": "string",
                            "minLength": 1
                        },
                        "schema": {
                            "type": "object",
                            "additionalProperties": true
                        }
                    }
                },
                "retryable": {
                    "type": "boolean"
                },
                "onFailure": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "completion",
                        "defaultStatus"
                    ],
                    "properties": {
                        "completion": {
                            "type": "string",
                            "enum": [
                                "block",
                                "warn"
                            ]
                        },
                        "defaultStatus": {
                            "type": "string",
                            "enum": [
                                "pass",
                                "fail",
                                "warn",
                                "skipped"
                            ]
                        },
                        "visibility": {
                            "type": "string",
                            "enum": [
                                "trace",
                                "receipt",
                                "trace-and-receipt"
                            ]
                        }
                    }
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "required": {
                                "const": true
                            }
                        },
                        "required": [
                            "required"
                        ]
                    },
                    "then": {
                        "properties": {
                            "severity": {
                                "enum": [
                                    "error",
                                    "critical"
                                ]
                            },
                            "onFailure": {
                                "properties": {
                                    "completion": {
                                        "const": "block"
                                    },
                                    "defaultStatus": {
                                        "const": "fail"
                                    }
                                },
                                "required": [
                                    "completion",
                                    "defaultStatus"
                                ]
                            }
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "required": {
                                "const": false
                            }
                        },
                        "required": [
                            "required"
                        ]
                    },
                    "then": {
                        "properties": {
                            "severity": {
                                "enum": [
                                    "info",
                                    "warning"
                                ]
                            },
                            "onFailure": {
                                "properties": {
                                    "completion": {
                                        "const": "warn"
                                    },
                                    "defaultStatus": {
                                        "const": "warn"
                                    }
                                },
                                "required": [
                                    "completion",
                                    "defaultStatus"
                                ]
                            }
                        }
                    }
                }
            ]
        },
        "x402": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "enabled": {
                    "type": "boolean"
                },
                "intents": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/paymentIntent"
                    },
                    "uniqueItems": true
                },
                "mode": {
                    "type": "string",
                    "enum": [
                        "dry-run",
                        "live"
                    ]
                },
                "protocolFee": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "bps",
                        "rounding",
                        "paidBy"
                    ],
                    "properties": {
                        "bps": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 10000
                        },
                        "launchRate": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                                "bps",
                                "endsAt"
                            ],
                            "description": "A lower rate for payouts before endsAt (UTC); bps applies from endsAt on. The protocol's launch rate is 250 bps until 2027-04-01T00:00:00Z.",
                            "properties": {
                                "bps": {
                                    "type": "integer",
                                    "minimum": 0,
                                    "maximum": 10000
                                },
                                "endsAt": {
                                    "type": "string",
                                    "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
                                }
                            }
                        },
                        "rounding": {
                            "const": "down"
                        },
                        "paidBy": {
                            "const": "provider"
                        },
                        "cap": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                                "symbol",
                                "amount"
                            ],
                            "description": "Most the fee can be on one payment in this asset. The protocol caps SOL payments at 0.1 SOL; stablecoins have no cap.",
                            "properties": {
                                "symbol": {
                                    "const": "SOL"
                                },
                                "amount": {
                                    "type": "string",
                                    "pattern": "^[0-9]+(\\.[0-9]+)?$"
                                }
                            }
                        },
                        "base": {
                            "const": "actual-cost",
                            "description": "The fee is taken from the amount actually paid: the price per call, or the settled cost of a per-token call."
                        }
                    }
                }
            },
            "required": [
                "mode"
            ]
        },
        "paymentIntent": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "id",
                "direction",
                "asset",
                "rail"
            ],
            "properties": {
                "id": {
                    "type": "string",
                    "pattern": "^[a-zA-Z][a-zA-Z0-9_\\-]*$"
                },
                "direction": {
                    "type": "string",
                    "enum": [
                        "spend",
                        "charge",
                        "refund"
                    ]
                },
                "maxAmount": {
                    "type": "string",
                    "pattern": "^[0-9]+(\\.[0-9]+)?$"
                },
                "purpose": {
                    "type": "string",
                    "minLength": 1
                },
                "scope": {
                    "$ref": "#/$defs/paymentScope"
                },
                "authority": {
                    "$ref": "#/$defs/paymentAuthority"
                },
                "receiptRef": {
                    "type": "string",
                    "pattern": "^[a-zA-Z][a-zA-Z0-9_\\-]*$"
                },
                "requireReceipt": {
                    "type": "boolean"
                },
                "policyRefs": {
                    "$ref": "#/$defs/policyRefList"
                },
                "asset": {
                    "$ref": "#/$defs/paymentAsset"
                },
                "rail": {
                    "type": "string",
                    "enum": [
                        "solana",
                        "base",
                        "stripe",
                        "other-x402"
                    ]
                },
                "price": {
                    "oneOf": [
                        {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                                "amount",
                                "per"
                            ],
                            "properties": {
                                "amount": {
                                    "type": "string",
                                    "pattern": "^[0-9]+(\\.[0-9]+)?$"
                                },
                                "per": {
                                    "const": "call"
                                }
                            }
                        },
                        {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                                "per",
                                "inputPerMillion",
                                "outputPerMillion",
                                "maxPerCall"
                            ],
                            "properties": {
                                "per": {
                                    "const": "token"
                                },
                                "inputPerMillion": {
                                    "type": "string",
                                    "pattern": "^[0-9]+(\\.[0-9]+)?$"
                                },
                                "outputPerMillion": {
                                    "type": "string",
                                    "pattern": "^[0-9]+(\\.[0-9]+)?$"
                                },
                                "maxPerCall": {
                                    "type": "string",
                                    "pattern": "^[0-9]+(\\.[0-9]+)?$"
                                }
                            }
                        }
                    ]
                },
                "payTo": {
                    "type": "string",
                    "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
                },
                "settlement": {
                    "type": "string",
                    "enum": [
                        "direct",
                        "escrow",
                        "metered-escrow"
                    ]
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "direction": {
                                "enum": [
                                    "spend",
                                    "refund"
                                ]
                            }
                        },
                        "required": [
                            "direction"
                        ]
                    },
                    "then": {
                        "required": [
                            "maxAmount",
                            "purpose",
                            "scope",
                            "authority",
                            "requireReceipt",
                            "receiptRef",
                            "policyRefs"
                        ],
                        "properties": {
                            "requireReceipt": {
                                "const": true
                            }
                        }
                    }
                },
                {
                    "if": {
                        "properties": {
                            "direction": {
                                "const": "charge"
                            }
                        },
                        "required": [
                            "direction"
                        ]
                    },
                    "then": {
                        "required": [
                            "price",
                            "payTo",
                            "settlement",
                            "requireReceipt",
                            "receiptRef",
                            "policyRefs"
                        ],
                        "properties": {
                            "requireReceipt": {
                                "const": true
                            }
                        }
                    }
                }
            ]
        },
        "paymentScope": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "type",
                "value"
            ],
            "properties": {
                "type": {
                    "type": "string",
                    "enum": [
                        "task",
                        "session",
                        "resource",
                        "service"
                    ]
                },
                "value": {
                    "type": "string",
                    "minLength": 1
                }
            }
        },
        "paymentAuthority": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "principal",
                "spender",
                "maxAmount",
                "asset",
                "rail",
                "purpose",
                "scope",
                "expiresAt",
                "revocation",
                "audit"
            ],
            "properties": {
                "principal": {
                    "type": "string",
                    "pattern": "^[a-zA-Z0-9_.:-]+$"
                },
                "spender": {
                    "type": "string",
                    "pattern": "^[a-zA-Z0-9_.:-]+$"
                },
                "maxAmount": {
                    "type": "string",
                    "pattern": "^[0-9]+(\\.[0-9]+)?$"
                },
                "purpose": {
                    "type": "string",
                    "minLength": 1
                },
                "scope": {
                    "$ref": "#/$defs/paymentScope"
                },
                "expiresAt": {
                    "type": "string",
                    "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
                },
                "revocation": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "mode",
                        "path"
                    ],
                    "properties": {
                        "mode": {
                            "type": "string",
                            "enum": [
                                "operator",
                                "policy-engine",
                                "human-review"
                            ]
                        },
                        "path": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                },
                "audit": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                        "path",
                        "evidenceRef"
                    ],
                    "properties": {
                        "path": {
                            "type": "string",
                            "minLength": 1
                        },
                        "evidenceRef": {
                            "$ref": "#/$defs/observabilityEvidenceRef"
                        }
                    }
                },
                "asset": {
                    "$ref": "#/$defs/paymentAsset"
                },
                "rail": {
                    "type": "string",
                    "enum": [
                        "solana",
                        "base",
                        "stripe",
                        "other-x402"
                    ]
                }
            }
        },
        "receiptExtension": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "required"
            ],
            "properties": {
                "required": {
                    "type": "boolean"
                },
                "refs": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/receiptRequirement"
                    },
                    "uniqueItems": true
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "required": {
                                "const": true
                            }
                        },
                        "required": [
                            "required"
                        ]
                    },
                    "then": {
                        "required": [
                            "refs"
                        ]
                    }
                }
            ]
        },
        "receiptRequirement": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "id",
                "intentRef",
                "format",
                "evidenceRef",
                "policyRefs"
            ],
            "properties": {
                "id": {
                    "type": "string",
                    "pattern": "^[a-zA-Z][a-zA-Z0-9_\\-]*$"
                },
                "intentRef": {
                    "type": "string",
                    "pattern": "^[a-zA-Z][a-zA-Z0-9_\\-]*$"
                },
                "evidenceRef": {
                    "$ref": "#/$defs/observabilityEvidenceRef"
                },
                "policyRefs": {
                    "$ref": "#/$defs/policyRefList"
                },
                "format": {
                    "type": "string",
                    "enum": [
                        "reddi.receipt.v2"
                    ]
                }
            }
        },
        "reputationExtension": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "emitSignals": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": [
                            "taskCompleted",
                            "evalPassed",
                            "receiptVerified",
                            "policyCompliant",
                            "refundIssued",
                            "disputeOpened"
                        ]
                    },
                    "uniqueItems": true
                },
                "basis": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": [
                            "eval",
                            "receipt",
                            "policy",
                            "human-review"
                        ]
                    },
                    "uniqueItems": true
                },
                "evidenceRefs": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/observabilityEvidenceRef"
                    },
                    "uniqueItems": true
                }
            }
        },
        "paymentAsset": {
            "type": "object",
            "additionalProperties": false,
            "required": [
                "symbol",
                "network"
            ],
            "properties": {
                "symbol": {
                    "type": "string",
                    "enum": [
                        "SOL",
                        "USDC",
                        "PYUSD",
                        "USDG",
                        "AUDD"
                    ]
                },
                "network": {
                    "type": "string",
                    "enum": [
                        "solana-devnet",
                        "solana-mainnet-beta"
                    ]
                },
                "mint": {
                    "type": "string",
                    "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
                }
            },
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "symbol": {
                                "const": "SOL"
                            }
                        },
                        "required": [
                            "symbol"
                        ]
                    },
                    "then": {
                        "not": {
                            "required": [
                                "mint"
                            ]
                        }
                    },
                    "else": {
                        "required": [
                            "mint"
                        ]
                    }
                }
            ]
        }
    }
};
// END GENERATED ADL v0.3 SCHEMA
