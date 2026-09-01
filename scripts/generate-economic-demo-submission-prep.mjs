#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { ACCEPTED_EVIDENCE_MAX_AGE_MS, readAcceptedEvidenceManifest } from "./lib/surfpool-evidence-manifest.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const prepParent = join(rootDir, "artifacts", "economic-demo-submission-prep");
const outDir = join(prepParent, timestamp);
const latestLink = join(prepParent, "latest");

function latestArtifact(root, filename) {
  const base = join(rootDir, root);
  if (!existsSync(base)) return null;
  const candidates = readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, filename))
    .filter((path) => existsSync(join(rootDir, path)))
    .sort();
  return candidates.at(-1) ?? null;
}

function required(path, label) {
  if (!path) throw new Error(`missing_${label}`);
  return path;
}

// Surfpool lanes publish an atomic accepted-evidence receipt only after a PASS. Selecting on that
// receipt (rather than the lexically-last run directory) keeps a retained FAIL run from being cited.
function acceptedSurfpoolEvidence(relativeDir, target, label) {
  try {
    const { artifacts } = readAcceptedEvidenceManifest(rootDir, relativeDir, {
      target,
      requiredArtifacts: ["summary", "log"],
      maxAgeMs: ACCEPTED_EVIDENCE_MAX_AGE_MS,
    });
    return artifacts.summary;
  } catch (error) {
    throw new Error(`missing_${label}: ${error.message}`);
  }
}

const evidence = {
  playwright: process.env.ECONOMIC_DEMO_PLAYWRIGHT_EVIDENCE || "artifacts/playwright-economic-demo",
  surfpool: required(latestArtifact("artifacts/economic-demo-surfpool-rehearsal", "summary.json"), "surfpool_summary"),
  surfpoolCritical: acceptedSurfpoolEvidence("artifacts/surfpool-smoke", "legacy-anchor", "surfpool_critical_summary"),
  surfpoolQuasarCritical: acceptedSurfpoolEvidence("artifacts/surfpool-quasar-smoke", "quasar", "surfpool_quasar_critical_summary"),
  jupiterQuote: required(latestArtifact("artifacts/economic-demo-jupiter-quote-proof", "quote-proof.json"), "jupiter_quote_proof"),
  surfpoolJupiterInvoke: required(latestArtifact("artifacts/surfpool-jupiter-invoke", "SUMMARY.md"), "surfpool_jupiter_invoke"),
  upfrontPack: required(latestArtifact("artifacts/economic-demo-upfront-payment-evidence", "upfront-payment-evidence.json"), "upfront_payment_pack"),
  livePaymentGate: required(latestArtifact("artifacts/economic-demo-live-payment-gate", "gate.json"), "live_payment_gate"),
  devnetUsdcReceipt: required(latestArtifact("artifacts/economic-demo-devnet-usdc-receipt", "receipt-verification.json"), "devnet_usdc_receipt_verification"),
  senderPlan: required(latestArtifact("artifacts/economic-demo-devnet-usdc-sender-plan", "sender-plan.json"), "sender_plan"),
  runReport: required(latestArtifact("artifacts/economic-demo-run-report", "run-report.json"), "economic_demo_run_report"),
  payShReddix402: "artifacts/pay-sh-reddi-x402/20260507T064842Z/SUMMARY.json",
  payShSessionProbe: "artifacts/pay-sh-reddi-x402/20260507T065805Z-session-splits/SUMMARY.json",
  payShSplitProbe: "artifacts/pay-sh-reddi-x402/20260507T065908Z-splits/SUMMARY.json",
  umbraPrivateX402: required(latestArtifact("artifacts/umbra-private-x402", "SUMMARY.json"), "umbra_private_x402"),
  umbraDevnetSmoke: required(latestArtifact("artifacts/umbra-devnet-smoke", "SUMMARY.json"), "umbra_devnet_smoke"),
  proofHierarchy: "docs/ECONOMIC-DEMO-PROOF-HIERARCHY-2026-05-07.md",
  bdd: "docs/bdd/features/bucket-j-end-user-economic-demo.feature",
};

if (!existsSync(join(rootDir, evidence.proofHierarchy))) throw new Error("missing_proof_hierarchy_doc");
if (!existsSync(join(rootDir, evidence.bdd))) throw new Error("missing_bdd_feature");
if (!existsSync(join(rootDir, evidence.payShReddix402))) throw new Error("missing_pay_sh_reddi_x402_summary");
if (!existsSync(join(rootDir, evidence.payShSessionProbe))) throw new Error("missing_pay_sh_session_probe_summary");
if (!existsSync(join(rootDir, evidence.payShSplitProbe))) throw new Error("missing_pay_sh_split_probe_summary");

mkdirSync(outDir, { recursive: true });
const prepPath = join(outDir, "SUBMISSION-PREP.md");
const content = `# Economic Demo Submission Prep

Scope: safe local/demo prep only. Generated: ${new Date().toISOString()}.

## Demo entrypoint

- Route: \`/economic-demo\`
- PRs: \`https://github.com/nissan/reddi-agent-protocol/pull/244\`, follow-up boundary PRs \`https://github.com/nissan/reddi-agent-protocol/pull/246\` / \`https://github.com/nissan/reddi-agent-protocol/pull/247\`, and final recording evidence PR \`https://github.com/nissan/reddi-agent-protocol/pull/248\`
- BDD: \`${evidence.bdd}\`
- Proof hierarchy: \`${evidence.proofHierarchy}\`

## Current green evidence

- BDD index guard: \`npm run test:bdd:index\`
- Economic demo Playwright: \`npx playwright test e2e/economic-demo.spec.ts\`
- App build (default legacy-anchor target): \`npm run build\`
- Upfront evidence pack: \`npm run evidence:economic-demo:upfront-payment\`
- Surfpool/mock-Jupiter invoke proof: \`npm run test:surfpool:jupiter-invoke\`
- Surfpool A→B→C critical lane: \`npm run test:surfpool:critical\`
- Surfpool Quasar critical lane (local-surfpool profile, loopback endpoints, four distinct local program ids): \`npm run test:surfpool:quasar-critical\`
- Jupiter quote proof: \`npm run smoke:economic-demo:jupiter-quote\`
- Live payment gate: \`npm run check:economic-demo:live-payment-gate\` (blocked by default, safe)
- Devnet USDC receipt verifier: \`npm run verify:economic-demo:devnet-usdc-receipt\` (blocked by default, safe)
- Devnet USDC sender plan: \`npm run plan:economic-demo:devnet-usdc-sender\` (blocked by default, safe)
- Economic demo run report: \`npm run report:economic-demo:run\`
- Pay.sh / reddi-x402 evidence: \`npm run evidence:pay-sh:reddi-x402 -- artifacts/pay-sh-reddi-x402/20260507T064842Z\`
- Umbra private x402 adapter evidence: \`npm run evidence:umbra:private-x402\`
- Umbra devnet encrypted-balance deposit smoke: \`npm run smoke:umbra:devnet\`

## Local evidence paths to mention/demo

- Playwright evidence directory: \`${evidence.playwright}\`
- Surfpool/local payment semantics: \`${evidence.surfpool}\`
- Surfpool A→B→C critical lane: \`${evidence.surfpoolCritical}\`
- Surfpool Quasar critical lane: \`${evidence.surfpoolQuasarCritical}\`
- Surfpool/mock-Jupiter successful no-real-funds invoke proof: \`${evidence.surfpoolJupiterInvoke}\`
- Live Jupiter quote-only proof: \`${evidence.jupiterQuote}\`
- Upfront payment evidence pack: \`${evidence.upfrontPack}\`
- Live payment gate artifact: \`${evidence.livePaymentGate}\`
- Devnet USDC receipt verification artifact: \`${evidence.devnetUsdcReceipt}\`
- Devnet USDC sender plan artifact: \`${evidence.senderPlan}\`
- Economic demo run report: \`${evidence.runReport}\`
- Pay.sh / reddi-x402 sandbox charge: \`${evidence.payShReddix402}\`
- Pay.sh capped session probe: \`${evidence.payShSessionProbe}\`
- Pay.sh split-payment probe: \`${evidence.payShSplitProbe}\`
- Umbra private x402 adapter contract: \`${evidence.umbraPrivateX402}\`
- Umbra devnet encrypted-balance deposit: \`${evidence.umbraDevnetSmoke}\`
- Proof hierarchy doc: \`${evidence.proofHierarchy}\`

## Five-beat recording outline

1. Open \`/economic-demo\` and state the end-user asks an orchestrator to buy downstream agent work.
2. Show the upfront quote, user payment edge, downstream specialist/attestor fees, and retained markup.
3. Show communication graph and payment graph together: user → orchestrator → specialists/attestors → final output.
4. Show evidence hierarchy: deterministic UI, Surfpool local payment semantics, Surfpool A→B→C + Quasar critical lanes, Surfpool/mock-Jupiter successful no-real-funds invoke proof, public Jupiter quote/build/sign boundary, devnet USDC receipt verifier, live payment gate/sender plan.
5. Close with the hard boundary: Surfpool lanes are local validator proof, Pay.sh / reddi-x402 is sandbox charge compatibility, Umbra private x402 now has adapter-contract evidence plus a bounded devnet wSOL-to-encrypted-balance smoke, public Jupiter quote/build/sign is not successful devnet execution, blocked verifier/gate artifacts are safety evidence, and any further live signing/spend requires explicit approval.

## Hard no-go list unless Nissan explicitly approves

- No Phase 6 controlled live research
- No OpenAI/Fal image generation
- No paid provider requests
- No signing operations
- No wallet mutation
- No devnet transfer
- No mainnet transfer
- No Jupiter swap execution
- No Coolify/env mutation

## Proof hierarchy claims

Safe to say:

- The UI demonstrates upfront-funded consumer-agent orchestration.
- Surfpool/local evidence proves payment ordering, budget reconciliation, and blocked-edge zero-delta behavior.
- Surfpool A→B→C critical lane proves local public settlement plus PER-unavailable fallback safety.
- Surfpool Quasar critical lane proves local Quasar public settlement plus private-request boundary behavior, on a loopback Surfnet against locally built current-source programs only. It is the only current Quasar execution evidence, and it is cited from an accepted PASS receipt whose target, status, age, artifact hashes, and pre-run source fingerprint were revalidated when this document was generated.
- Quasar is reachable only as an explicit \`local-surfpool\` opt-in requiring loopback endpoints and four distinct valid local program ids; the default app build stays on the legacy Anchor target.
- Surfpool/mock-Jupiter proof shows a successful no-real-funds swap-shaped invoke path.
- Public Jupiter quote proof proves live route availability only; public Jupiter devnet execution is not claimed.
- Devnet USDC receipt verification is ready and fail-closed, but default artifacts are blocked until a real signature is supplied.
- Sender/swap execution is planned and gated, not claimed.
- Pay.sh / reddi-x402 proves sandbox HTTP 402 → payment → HTTP 200 receipt compatibility for the single-recipient charge flow.
- Pay.sh capped sessions and split payments are probe-only extension evidence because Pay.sh 0.16.0 returned 402 again after sandbox payment.
- Umbra private x402 adapter contract is present.
- Umbra private x402 adapter contract evidence proves the dependency-injected receiver-claimable UTXO call path and selective-disclosure receipt shape.
- Umbra devnet encrypted-balance deposit completed: devnet wSOL was wrapped, Umbra confidential registration submitted, deposit queue/callback finalized, and encrypted balance query returned the deposited amount.

Not safe to say yet:

- The app executed a successful public Jupiter devnet swap.
- The app executed a live/mainnet Jupiter swap.
- The app transferred devnet or mainnet USDC by itself.
- A judge wallet was charged.
- Mainnet settlement is supported.
- Pay.sh capped sessions or split-payment settlement completed.
- Pay.sh evidence proves Umbra private settlement or MagicBlock PER settlement.
- Umbra mainnet or production settlement completed.
- Umbra evidence proves live private settlement.
- The recorded Quasar devnet deployment is current or submission-ready; \`config/quasar/deployments.json\` records it as \`submissionReady: false\` with explicit client/deployment ABI mismatch known gaps.
- A devnet Quasar build is demo evidence. \`NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar\` on the devnet profile resolves to a blocked target: the readiness banner is amber, \`assertProgramTargetUsable()\` refuses every signing surface, and no on-chain path runs. It is not listed above.
`;
writeFileSync(prepPath, content);

try {
  // rmSync(..., force: true) also removes broken symlinks; existsSync() returns false for them.
  rmSync(latestLink, { recursive: true, force: true });
  symlinkSync(relative(prepParent, outDir), latestLink, "dir");
} catch {
  // Symlink creation is best-effort; checker can still discover newest timestamped prep dir.
}

console.log(JSON.stringify({ ok: true, prepPath, latestLink }, null, 2));
