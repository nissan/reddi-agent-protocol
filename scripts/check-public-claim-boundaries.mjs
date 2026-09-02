#!/usr/bin/env node
/**
 * Public-claim boundary contract for RAP Assurance.
 *
 * This is an executable documentation/metadata contract, not a proxy for code
 * behavior. It scans only public copy surfaces intentionally owned by this
 * repository (README/package metadata/app copy/source docs) and fails when the
 * central RAP Assurance message or important non-claim boundaries drift.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CENTRAL_MESSAGE = "Payments prove transfer; RAP Assurance proves paid work";

const requiredCentralMessageFiles = [
  "README.md",
  "docs/PUBLIC-CLAIM-BOUNDARY.md",
  "docs/whitepaper/WHITEPAPER-v1.md",
  "docs/RAP-RECEIPT-POLICY-V1.md",
  "packages/agent-protocol/README.md",
  "packages/x402-solana/README.md",
  "packages/rap-mcp-bridge/README.md",
  "app/page.tsx",
  "app/layout.tsx",
];

const activeClaimFiles = [
  ...requiredCentralMessageFiles,
  "CONTRIBUTING.md",
  "DEPLOY.md",
  "SECURITY.md",
  "docs/PAYMENT-FLOW-ARCHITECTURE.md",
  "docs/RAP-V0.1-DEVELOPER-QUICKSTART-AND-CONFORMANCE.md",
  "docs/whitepaper/README.md",
  "docs/verifiable-agent-protocol/README.md",
  "packages/per-client/README.md",
  "packages/openrouter-specialists/README.md",
  "app/agents/page.tsx",
  "app/register/page.tsx",
  "app/planner/page.tsx",
  "app/attestation/page.tsx",
  "app/mcp-bridge-demo/page.tsx",
  "app/spec/page.tsx",
  "app/whitepaper/page.tsx",
  "app/tour/page.tsx",
  "app/playbook/page.tsx",
  "app/orchestrator/page.tsx",
  "app/manager/page.tsx",
  "app/circle-x402/page.tsx",
  "app/agents/[wallet]/page.tsx",
  "app/agents/candidates/[id]/page.tsx",
  "app/customize/page.tsx",
  "app/dogfood/page.tsx",
  "app/economic-demo/page.tsx",
  "app/economic-demo/z-picture-demo/page.tsx",
  "app/economic-demo/z-picture-proof/page.tsx",
  "app/economic-demo/z-picture-onchain-proof/page.tsx",
  "app/leaderboard/page.tsx",
  "app/specialist/page.tsx",
  "app/api/economic-demo/z-picture-run/route.ts",
  "app/api/economic-demo/z-picture-latest/route.ts",
  "lib/economic-demo/z-picture-static-proof.ts",
  "lib/mcp-bridge-demo/fixture.ts",
  "components/NavBar.tsx",
  "components/manager/discovery/OperatorDiscoveryWorkspace.tsx",
  "components/manager/listings/MarketplaceApprovalQueue.tsx",
];

const historicalFilesRequiringDisclaimer = [
  "docs/LANDING-PAGE-MESSAGING-PLAN-2026-05-08.md",
  "docs/MARKETPLACE-DEMO-STORYBOARD-2026-05-08.md",
  "docs/MARKETPLACE-DEMO-READINESS-HARNESS-2026-05-08.md",
  "docs/ONBOARDING-VIDEO-UX-PLAN.md",
  "docs/PITCH-SPECIALIST-AGENTS-JAGGEDNESS-2026-05-07.md",
  "docs/BOUNTY-GAP-CLOSURE-PLAN-2026-05-08.md",
  "docs/COLOSSEUM-FINAL-QUASAR-PROOF-MAP-2026-05-06.md",
  "docs/RAP-MCP-BRIDGE-DEVNET-MCP-PLAN-2026-05-08.md",
  "docs/ECONOMIC-DEMO-LIVE-STORYTELLING-PLAN-2026-05-08.md",
];

const packageManifestFiles = [
  "packages/agent-protocol/package.json",
  "packages/demo-agents/package.json",
  "packages/openrouter-specialists/package.json",
  "packages/per-client/package.json",
  "packages/rap-mcp-bridge/package.json",
  "packages/testing-specialists/package.json",
  "packages/x402-solana/package.json",
];

const forbiddenAffirmativeClaims = [
  {
    id: "marketplace-rail",
    pattern: /\b(?:is|as|becomes?|provides?|gives|gives existing agent systems|turns|lets|handles)\b[^\n]{0,120}\bmarketplace\s+rail\b/i,
    reason: "Do not position RAP as a marketplace rail.",
  },
  {
    id: "payment-facilitator",
    pattern: /\b(?:is|as|becomes?|provides?|runs|operates|handles)\b[^\n]{0,100}\bpayment\s+facilitator\b/i,
    reason: "Do not position RAP as a payment facilitator.",
  },
  {
    id: "generic-runtime",
    pattern: /\b(?:generic|hosted|production)\s+(?:agent\s+)?runtime\b[^\n]{0,80}\b(?:live|ready|available|provided|built in)\b/i,
    reason: "Do not claim a generic/hosted runtime product is live.",
  },
  {
    id: "custody-provider",
    pattern: /\b(?:takes?|holds?|provides?|offers?|assumes?)\s+(?:production\s+)?(?:funds?\s+)?custody\b|\bcustody\s+(?:provider|service|product)\b/i,
    reason: "Do not claim custody.",
  },
  {
    id: "escrow-provider",
    pattern: /\b(?:production\s+)?escrow\s+(?:provider|service|product|finality|guarantee)\b/i,
    reason: "Do not claim an escrow product or escrow finality.",
  },
  {
    id: "collected-fee",
    pattern: /\b(?:collects?|charges?|takes?)\s+(?:a\s+)?(?:0\.05%|5\s*bps|protocol\s+fee|take-?rate)\b/i,
    reason: "Protocol fee/take-rate is not implemented.",
  },
  {
    id: "production-ready",
    pattern: /\b(?:production[-\s]?ready|ready\s+for\s+production|production\s+readiness\s+(?:passed|complete|green))\b/i,
    reason: "Production readiness is not established.",
  },
  {
    id: "mainnet-ready",
    pattern: /\b(?:mainnet[-\s]?ready|ready\s+for\s+mainnet|mainnet\s+readiness\s+(?:passed|complete|green))\b/i,
    reason: "Mainnet readiness is not established.",
  },
  {
    id: "security-audited",
    pattern: /\b(?:security[-\s]?audited|audit\s+(?:passed|complete|completed)|audited\s+(?:release|contracts?|programs?))\b/i,
    reason: "No completed security audit is claimed.",
  },
  {
    id: "live-audd-settlement",
    pattern: /\bAUDD\b[^\n]{0,120}\b(?:live|production|settled|settlement\s+(?:complete|enabled|ready)|custody)\b/i,
    reason: "AUDD is proof/payment-plan/read-only observation metadata unless separately approved.",
  },
  {
    id: "payment-proves-work",
    pattern: /\bpayment\s+(?:proof|receipt|evidence)\s+(?:proves|guarantees|certifies)\s+(?:work|quality|success|delivery)\b/i,
    reason: "Payment proves transfer, not work quality.",
  },
];

const negationMarkers = [
  " not ",
  " not a ",
  " not an ",
  " no ",
  " no-",
  " never ",
  " does not ",
  " do not ",
  " must not ",
  " should not ",
  " without ",
  " unless ",
  " until ",
  " blocked",
  " gated",
  " out of scope",
  " non-claim",
  " nonclaim",
  " planned",
  " fixture",
  " historical",
  " archived",
  " superseded",
  " boundary",
];

const failures = [];
const checked = [];

function read(rel) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) {
    failures.push(`${rel}: missing public-claim contract file`);
    return "";
  }
  checked.push(rel);
  return readFileSync(path, "utf8");
}

function lineIsNegated(line, previous = "") {
  const normalized = ` ${previous} ${line} `.toLowerCase();
  return negationMarkers.some((marker) => normalized.includes(marker));
}

for (const rel of requiredCentralMessageFiles) {
  const text = read(rel);
  if (!text.toLowerCase().includes(CENTRAL_MESSAGE.toLowerCase())) {
    failures.push(`${rel}: missing central RAP Assurance message: ${CENTRAL_MESSAGE}`);
  }
}

for (const rel of activeClaimFiles) {
  const lines = read(rel).split(/\r?\n/);
  lines.forEach((line, index) => {
    const previous = lines[index - 1] ?? "";
    for (const claim of forbiddenAffirmativeClaims) {
      if (!claim.pattern.test(line)) continue;
      if (lineIsNegated(line, previous)) continue;
      failures.push(`${rel}:${index + 1}: [${claim.id}] ${claim.reason} :: ${line.trim()}`);
    }
  });
}

for (const rel of historicalFilesRequiringDisclaimer) {
  const firstBlock = read(rel).split(/\r?\n/).slice(0, 8).join("\n");
  if (!/historical|superseded|archived/i.test(firstBlock) || !/PUBLIC-CLAIM-BOUNDARY|RAP Assurance claim remediation/i.test(firstBlock)) {
    failures.push(`${rel}: high-risk historical doc must carry a current RAP Assurance/public-claim-boundary disclaimer at the top`);
  }
}

for (const rel of packageManifestFiles) {
  const manifest = JSON.parse(read(rel));
  const description = manifest.description ?? "";
  if (!description) {
    failures.push(`${rel}: package description must disclose the bounded RAP Assurance surface`);
    continue;
  }
  if (!/RAP Assurance|Reddi Agent Protocol|x402\/Solana/i.test(description)) {
    failures.push(`${rel}: package description should identify the RAP Assurance / Reddi Agent Protocol surface`);
  }
  for (const claim of forbiddenAffirmativeClaims) {
    if (claim.pattern.test(description) && !lineIsNegated(description)) {
      failures.push(`${rel}: [${claim.id}] ${claim.reason} :: ${description}`);
    }
  }
}

if (failures.length > 0) {
  console.error("[public-claim-boundaries] FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[public-claim-boundaries] OK: checked ${new Set(checked).size} public claim surface(s)`);
