#!/usr/bin/env node
// No-live end-to-end dry-run rehearsal for the #564 x402 reference paid workflow.
// Deterministic and offline: no wallet, no RPC, no provider calls, no paid requests,
// no devnet transactions. The live devnet run is operator-gated; see
// docs/DEVNET-REFERENCE-RUN-564.md.
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function asFile(path) {
  try {
    return statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}

// Resolve an extensionless / TS-source path the way the app's bundler does.
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
  buildX402ReferenceWorkflowRehearsal,
  assertX402ReferenceWorkflowRehearsalStaysDryRun,
  X402_REFERENCE_WORKFLOW_STEP_IDS,
} = await import(pathToFileURL(join(rootDir, "lib", "economic-demo", "x402-reference-workflow-rehearsal.ts")).href);

const rehearsal = buildX402ReferenceWorkflowRehearsal();

// Fail closed before writing anything if any live-gated boundary is not false/zero.
assertX402ReferenceWorkflowRehearsalStaysDryRun(rehearsal);

const missingSteps = X402_REFERENCE_WORKFLOW_STEP_IDS.filter(
  (stepId) => !rehearsal.steps.some((step) => step.step === stepId),
);
if (missingSteps.length > 0) {
  throw new Error(`x402_reference_workflow_rehearsal_missing_steps:${missingSteps.join(",")}`);
}

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const outDir = join(rootDir, "artifacts", "economic-demo-x402-reference-rehearsal", timestamp);
mkdirSync(outDir, { recursive: true });

const artifactPath = join(outDir, "rehearsal.json");
writeFileSync(artifactPath, `${JSON.stringify(rehearsal, null, 2)}\n`);

const summaryPath = join(outDir, "SUMMARY.md");
writeFileSync(
  summaryPath,
  [
    "# x402 Reference Workflow Rehearsal (no-live dry run)",
    "",
    `- Issue: ${rehearsal.issueRef}`,
    `- Schema: ${rehearsal.schemaVersion}`,
    `- Scenario: ${rehearsal.scenarioId}`,
    `- Steps rehearsed: ${rehearsal.steps.map((step) => step.step).join(" -> ")}`,
    `- Proof contract emitted: ${rehearsal.proofContract.schemaVersion}`,
    `- Quote total: ${rehearsal.quote.totalUsdc} USDC (protocol rail fee ${rehearsal.quote.protocolRailFeeBps} bps)`,
    `- Dry-run payment proof ref: ${rehearsal.x402PaymentPlan.dryRunPaymentProofRef}`,
    `- Metering mode: ${rehearsal.metering.meteringMode} (real.executed=${rehearsal.metering.real.executed}, real.paidRequests=${rehearsal.metering.real.paidRequests}, real.devnetTransactions=${rehearsal.metering.real.devnetTransactions})`,
    `- Live gate: ${rehearsal.liveGate.state} — REQUIRES OPERATOR (${rehearsal.liveGate.operator}); runbook: ${rehearsal.liveGate.runbookPath}`,
    `- JSON: ${artifactPath}`,
    "",
  ].join("\n"),
);

console.log(JSON.stringify({ ok: true, artifactPath, summaryPath, liveStepsExecuted: rehearsal.liveGate.liveStepsExecuted }, null, 2));
