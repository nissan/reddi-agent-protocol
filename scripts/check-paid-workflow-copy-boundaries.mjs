#!/usr/bin/env node
/**
 * Paid-workflow copy-boundary regression gate (#501).
 *
 * Deterministic, offline, no-browser static scan of the buyer paid-workflow
 * route model output (`lib/economic-demo/buyer-paid-workflow-route-model.ts`,
 * #497/#498/#499). It renders the model from its deterministic fixtures —
 * exactly what `/economic-demo/paid-workflow` renders — and fails (exit 1) if
 * any rendered copy upgrades a dry-run/devnet proof claim into a live claim:
 * custody, settlement finality, production AUDD rail, default USDC auto-pay,
 * Pay.sh production activation, mainnet settlement, hosted registry writes,
 * live trust/reputation mutation, Airwallex settlement overclaims, or AP2
 * mandate-authority overclaims.
 *
 * The forbidden/required term list lives in
 * `lib/economic-demo/paid-workflow-copy-boundary-terms.ts` (shared with the
 * DOM-layer Playwright spec `e2e/economic-demo-paid-workflow-copy-gate.spec.ts`)
 * and is derived from docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md (#452) — this
 * script verifies every cited doc anchor still exists, so the gate and the
 * authority doc cannot drift apart silently.
 *
 * Checks, in order:
 *   1. Authority-doc anchor drift guard.
 *   2. Model builds `status: "ready"` from fixtures (and the empty-pack
 *      variant fails closed, since the route renders that panel too).
 *   3. No forbidden affirmative claim matches any rendered string.
 *   4. All required labels present (dry-run, no-spend, recorded-devnet,
 *      optional fresh-devnet, live-gated, production-disabled).
 *   5. Structural boundaries: the full #497 16-flag grid all-false, zero
 *      spend/refunds, blocked cases hold spend+mutation at zero/false.
 *   6. Built-in negative-control self-test: every forbidden claim's
 *      injectionExample, injected into a cloned model, must be caught. A
 *      scanner that stops catching its own injections fails the gate.
 *
 * Usage:
 *   node scripts/check-paid-workflow-copy-boundaries.mjs
 *   node scripts/check-paid-workflow-copy-boundaries.mjs --negative-control
 *
 *   --negative-control  Inject a forbidden phrase into the live model before
 *                       scanning; the gate MUST exit 1 (CI proves the gate
 *                       can fail by running this and asserting failure).
 *
 * No network, wallet, RPC, provider, Pay.sh, hosted-registry, or spend action
 * is performed or reachable from this script.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const negativeControl = process.argv.includes("--negative-control");

// --- TS resolution hooks (same pattern as run-x402-reference-workflow-rehearsal.mjs) ---

function asFile(path) {
  try {
    return statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}

function resolveTsCandidate(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, "index.ts"),
    basePath.endsWith(".js") ? basePath.replace(/\.js$/, ".ts") : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const file = asFile(candidate);
    if (file) return file;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = resolveTsCandidate(join(rootDir, specifier.slice(2)));
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    if (specifier === "@reddi/x402-solana") {
      const target = asFile(join(rootDir, "packages", "x402-solana", "dist", "index.js"));
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const basePath = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
      if (!existsSync(basePath) || !asFile(basePath)) {
        const target = resolveTsCandidate(basePath);
        if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  COPY_BOUNDARY_AUTHORITY_DOC_PATH,
  EXPECTED_HARD_BOUNDARY_FLAG_KEYS,
  FORBIDDEN_COPY_CLAIMS,
  REQUIRED_COPY_LABELS,
} = await import(
  pathToFileURL(join(rootDir, "lib", "economic-demo", "paid-workflow-copy-boundary-terms.ts")).href
);
const { buildBuyerPaidWorkflowRouteModel } = await import(
  pathToFileURL(join(rootDir, "lib", "economic-demo", "buyer-paid-workflow-route-model.ts")).href
);
const { getPaidWorkflowProofUiFixturePack } = await import(
  pathToFileURL(join(rootDir, "lib", "economic-demo", "paid-workflow-proof-ui-fixtures.ts")).href
);

// --- helpers ---

const failures = [];
function fail(section, message) {
  failures.push({ section, message });
}
function ok(message) {
  console.log(`  ok  ${message}`);
}

/** Collect every string VALUE in the model with its JSON path. */
function collectStrings(value, path = "$", out = []) {
  if (typeof value === "string") {
    out.push({ path, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectStrings(child, `${path}.${key}`, out);
    }
  }
  return out;
}

/** Scan strings against every forbidden claim; returns violations. */
function scanForbidden(strings) {
  const violations = [];
  for (const { path, text } of strings) {
    for (const claim of FORBIDDEN_COPY_CLAIMS) {
      for (const pattern of claim.patterns) {
        if (pattern.test(text)) {
          violations.push({ claimId: claim.id, claim: claim.claim, pattern: String(pattern), path, text });
        }
      }
    }
  }
  return violations;
}

// --- 1. authority-doc anchor drift guard ---

console.log(`\nCopy-boundary gate (#501) — authority: ${COPY_BOUNDARY_AUTHORITY_DOC_PATH}`);
const docFile = join(rootDir, COPY_BOUNDARY_AUTHORITY_DOC_PATH);
if (!asFile(docFile)) {
  fail("doc", `Authority doc missing: ${COPY_BOUNDARY_AUTHORITY_DOC_PATH}`);
} else {
  const docText = readFileSync(docFile, "utf8").replace(/\s+/g, " ");
  for (const claim of FORBIDDEN_COPY_CLAIMS) {
    if (!docText.includes(claim.docAnchor)) {
      fail(
        "doc",
        `Doc anchor for forbidden claim "${claim.id}" no longer exists in ${COPY_BOUNDARY_AUTHORITY_DOC_PATH}: "${claim.docAnchor}". ` +
          "Re-derive the gate from the updated boundaries doc instead of editing around this failure.",
      );
    }
  }
  if (failures.length === 0) {
    ok(`all ${FORBIDDEN_COPY_CLAIMS.length} forbidden-claim doc anchors present (no doc/gate drift)`);
  }
}

// --- 2. build the model (and the empty-pack fail-closed variant) ---

const model = buildBuyerPaidWorkflowRouteModel();
if (model.status !== "ready") {
  fail("model", `Route model did not build ready: status=${model.status} reason=${model.reasonCode ?? "?"}`);
}
const emptyPack = getPaidWorkflowProofUiFixturePack();
const emptyModel = buildBuyerPaidWorkflowRouteModel({ fixturePack: { ...emptyPack, cases: [] } });
if (emptyModel.status !== "fail_closed") {
  fail("model", "Empty fixture pack did not fail closed — the route's empty-contract panel depends on this.");
} else {
  ok(`model ready; empty-pack variant fails closed (${emptyModel.reasonCode})`);
}

if (negativeControl && model.status === "ready") {
  // Inject a forbidden overclaim into the live model so the gate demonstrably fails.
  model.receipt.detail = `${model.receipt.detail} ${FORBIDDEN_COPY_CLAIMS[0].injectionExample}`;
  console.log(
    `  !!  negative control: injected forbidden phrase into receipt.detail: "${FORBIDDEN_COPY_CLAIMS[0].injectionExample}"`,
  );
}

// --- 3. forbidden-copy scan (route model output = what the page renders) ---

const strings = [...collectStrings(model), ...collectStrings(emptyModel)];
const violations = scanForbidden(strings);
if (violations.length > 0) {
  for (const violation of violations) {
    fail(
      "forbidden",
      `[${violation.claimId}] ${violation.claim}\n        at ${violation.path}\n        pattern ${violation.pattern}\n        text: ${violation.text.slice(0, 160)}`,
    );
  }
} else {
  ok(`no forbidden claims across ${strings.length} rendered strings (${FORBIDDEN_COPY_CLAIMS.length} claim rules)`);
}

// --- 4. required labels ---

const allCopy = strings.map((entry) => entry.text).join("\n");
for (const label of REQUIRED_COPY_LABELS) {
  if (!label.pattern.test(allCopy)) {
    fail("required", `Required label missing from rendered copy: ${label.label} (${label.pattern})`);
  }
}
if (!failures.some((entry) => entry.section === "required")) {
  ok(`all ${REQUIRED_COPY_LABELS.length} required labels present (dry-run, no-spend, recorded-devnet, optional fresh-devnet, live-gated, production-disabled)`);
}

// --- 5. structural boundaries ---

if (model.status === "ready") {
  const flagKeys = Object.keys(model.hardBoundaryFlags);
  const expected = [...EXPECTED_HARD_BOUNDARY_FLAG_KEYS];
  const missing = expected.filter((key) => !flagKeys.includes(key));
  const extra = flagKeys.filter((key) => !expected.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    fail("flags", `16-flag grid drifted. missing=[${missing}] extra=[${extra}]`);
  }
  const trueFlags = Object.entries(model.hardBoundaryFlags).filter(([, value]) => value !== false);
  if (trueFlags.length > 0) {
    fail("flags", `Hard boundary flags not false: ${trueFlags.map(([key]) => key).join(", ")}`);
  }
  if (model.ledger.spentUsdc !== "0" || model.ledger.refundState.refundsIssued !== 0) {
    fail("ledger", `Ledger spend/refunds not zero: spent=${model.ledger.spentUsdc} refunds=${model.ledger.refundState.refundsIssued}`);
  }
  for (const blocked of model.blockedCases) {
    const spend = blocked.spendState;
    if (spend.spentUsdc !== "0" || spend.refundsIssued !== 0 || spend.spendingAllowed !== false || spend.mutationAllowed !== false) {
      fail("blocked", `Blocked case ${blocked.sourceCase} reports spend/mutation: ${JSON.stringify(spend)}`);
    }
  }
  if (!failures.some((entry) => ["flags", "ledger", "blocked"].includes(entry.section))) {
    ok(`structural boundaries hold: 16/16 flags false, zero spend/refunds, ${model.blockedCases.length} blocked cases at zero/false`);
  }
}

// --- 6. negative-control self-test (always on) ---

let selfTestFailures = 0;
for (const claim of FORBIDDEN_COPY_CLAIMS) {
  const caught = claim.patterns.some((pattern) => pattern.test(claim.injectionExample));
  if (!caught) {
    selfTestFailures += 1;
    fail("self-test", `Injection example for "${claim.id}" is NOT caught by its own patterns: "${claim.injectionExample}"`);
    continue;
  }
  // Full-pipeline check: inject into a cloned ready model and require a violation.
  const clone = JSON.parse(JSON.stringify(buildBuyerPaidWorkflowRouteModel()));
  if (clone.status === "ready") {
    clone.quote.detail = `${clone.quote.detail} ${claim.injectionExample}`;
    const injectedViolations = scanForbidden(collectStrings(clone));
    if (!injectedViolations.some((violation) => violation.claimId === claim.id)) {
      selfTestFailures += 1;
      fail("self-test", `Injected model for "${claim.id}" produced no violation — scanner regression.`);
    }
  }
}
if (selfTestFailures === 0) {
  ok(`negative-control self-test: all ${FORBIDDEN_COPY_CLAIMS.length} injected forbidden phrases are caught`);
}

// --- report ---

if (failures.length > 0) {
  console.error(`\nFAIL — ${failures.length} copy-boundary violation(s):\n`);
  for (const failure of failures) {
    console.error(`  [${failure.section}] ${failure.message}`);
  }
  console.error(
    `\nThe forbidden/required lists derive from ${COPY_BOUNDARY_AUTHORITY_DOC_PATH} — the fail-closed reading wins.`,
  );
  process.exit(1);
}

console.log("\nPASS — paid-workflow copy boundaries hold (no live-claim upgrades, all required labels present).\n");
