#!/usr/bin/env node
/**
 * Public-claim boundary contract for RAP Assurance.
 *
 * Owned-text contract only. Every file scanned here is one whose literal text
 * IS the published artifact: repository prose (README/docs), package manifest
 * metadata, and the WebVTT caption tracks served verbatim under /public.
 *
 * Rendered app copy is a claim only once it renders, so it is gated at the DOM
 * layer by `e2e/public-claim-boundary.spec.ts`, the only other consumer of the
 * shared pattern list in `lib/public-claims/public-claim-boundary-terms.ts`.
 *
 * Usage:
 *   node scripts/check-public-claim-boundaries.mjs
 *   node scripts/check-public-claim-boundaries.mjs --negative-control
 *
 *   --negative-control  Append every forbidden claim's affirmative example to
 *                       the scanned text; the gate MUST exit 1 (CI runs this
 *                       and asserts failure, proving the gate can still fail).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const negativeControl = process.argv.includes("--negative-control");

const {
  CENTRAL_MESSAGE,
  FORBIDDEN_PUBLIC_CLAIMS,
  PROHIBITION_HEADING_PATTERN,
  PUBLIC_CLAIM_DOM_ROUTES,
  QUALIFIER_CASES,
  claimIsQualified,
} = await import(
  pathToFileURL(join(ROOT, "lib", "public-claims", "public-claim-boundary-terms.ts")).href
);

const requiredCentralMessageFiles = [
  "README.md",
  "docs/PUBLIC-CLAIM-BOUNDARY.md",
  "docs/whitepaper/WHITEPAPER-v1.md",
  "docs/RAP-RECEIPT-POLICY-V1.md",
  "packages/agent-protocol/README.md",
  "packages/x402-solana/README.md",
  "packages/rap-mcp-bridge/README.md",
];

const activeClaimFiles = [
  ...requiredCentralMessageFiles,
  "CONTRIBUTING.md",
  "DEPLOY.md",
  "SECURITY.md",
  "docs/PAYMENT-FLOW-ARCHITECTURE.md",
  "docs/RAP-V0.1-DEVELOPER-QUICKSTART-AND-CONFORMANCE.md",
  "docs/whitepaper/README.md",
  "docs/whitepaper/CLAIMS-TRACEABILITY.md",
  "docs/whitepaper/GLOSSARY.md",
  "docs/verifiable-agent-protocol/README.md",
  "packages/per-client/README.md",
  "packages/openrouter-specialists/README.md",
  "public/videos/onboarding/captions/hire-agent-x402.vtt",
  "public/videos/onboarding/captions/economic-proof.vtt",
  "public/videos/onboarding/captions/register-agent.vtt",
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

const failures = [];
const checked = [];

function read(rel) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) {
    failures.push(`${rel}: missing public-claim contract file`);
    return null;
  }
  checked.push(rel);
  return readFileSync(path, "utf8");
}

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

/**
 * Opens the injected block in `--negative-control` so the injections never
 * inherit a prohibition window from the file's last real heading, which would
 * exempt them and drop that file from the control without any signal.
 */
const NEGATIVE_CONTROL_HEADING = "## Negative control injections";

/**
 * Scan one owned-text file. A pattern hit fails unless the matched line itself
 * qualifies the claim, or the line sits under an explicit prohibition heading.
 *
 * Fenced content is still scanned; the fence only suppresses heading detection,
 * so a `#` comment in a shell block cannot open a prohibition window. Fences
 * follow CommonMark closing rules — same character, at least as long, no info
 * string — so a longer fence can wrap a shorter one without the inner one
 * ending the block. An unterminated fence is a failure rather than a silent
 * freeze: it would pin the prohibition state for the rest of the file.
 */
function scanClaims(rel, text) {
  const lines = text.split(/\r?\n/);
  let underProhibitionHeading = false;
  let openFence = null;
  lines.forEach((line, index) => {
    const fence = FENCE.exec(line);
    if (fence) {
      const [, marker, trailing] = fence;
      if (!openFence) {
        openFence = { char: marker[0], length: marker.length, line: index + 1 };
        return;
      }
      if (marker[0] === openFence.char && marker.length >= openFence.length && trailing.trim() === "") {
        openFence = null;
        return;
      }
    }
    if (!openFence && /^#{1,6}\s/.test(line)) {
      underProhibitionHeading = PROHIBITION_HEADING_PATTERN.test(line);
    }
    for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
      if (!claim.pattern.test(line)) continue;
      if (claimIsQualified(line, claim) || underProhibitionHeading) continue;
      failures.push(`${rel}:${index + 1}: [${claim.id}] ${claim.reason} :: ${line.trim()}`);
    }
  });

  if (openFence) {
    failures.push(
      `${rel}:${openFence.line}: unterminated ${openFence.char.repeat(openFence.length)} code fence; prohibition-heading state could not be tracked past it`,
    );
  }
}

// --- 1. central message ---

for (const rel of requiredCentralMessageFiles) {
  const text = read(rel);
  if (text === null) continue;
  if (!text.toLowerCase().includes(CENTRAL_MESSAGE.toLowerCase())) {
    failures.push(`${rel}: missing central RAP Assurance message: ${CENTRAL_MESSAGE}`);
  }
}

// --- 2. forbidden affirmative claims in owned prose ---

for (const rel of activeClaimFiles) {
  const text = read(rel);
  if (text === null) continue;
  const injected = negativeControl
    ? `${text}\n${NEGATIVE_CONTROL_HEADING}\n\n${FORBIDDEN_PUBLIC_CLAIMS.map((claim) => claim.injectionExample).join("\n")}\n`
    : text;
  scanClaims(rel, injected);
}

// --- 3. historical docs carry a current disclaimer ---

for (const rel of historicalFilesRequiringDisclaimer) {
  const text = read(rel);
  if (text === null) continue;
  const firstBlock = text.split(/\r?\n/).slice(0, 8).join("\n");
  if (!/historical|superseded|archived/i.test(firstBlock) || !/PUBLIC-CLAIM-BOUNDARY|RAP Assurance claim remediation/i.test(firstBlock)) {
    failures.push(`${rel}: high-risk historical doc must carry a current RAP Assurance/public-claim-boundary disclaimer at the top`);
  }
}

// --- 4. package manifest descriptions ---

for (const rel of packageManifestFiles) {
  const raw = read(rel);
  if (raw === null) continue;
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    failures.push(`${rel}: package manifest is not valid JSON: ${error.message}`);
    continue;
  }
  const description = manifest.description ?? "";
  if (!description) {
    failures.push(`${rel}: package description must disclose the bounded RAP Assurance surface`);
    continue;
  }
  if (!/RAP Assurance|Reddi Agent Protocol|x402\/Solana/i.test(description)) {
    failures.push(`${rel}: package description should identify the RAP Assurance / Reddi Agent Protocol surface`);
  }
  for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
    if (claim.pattern.test(description) && !claimIsQualified(description, claim)) {
      failures.push(`${rel}: [${claim.id}] ${claim.reason} :: ${description}`);
    }
  }
}

// --- 5. negative-control self-test (always on) ---

for (const testCase of QUALIFIER_CASES) {
  const claim = FORBIDDEN_PUBLIC_CLAIMS.find((entry) => entry.id === testCase.claimId);
  if (!claim) {
    failures.push(`self-test: unknown claim id in qualifier case: ${testCase.claimId}`);
    continue;
  }
  if (!claim.pattern.test(testCase.line)) {
    failures.push(`self-test: [${claim.id}] qualifier case no longer matches its own pattern: ${testCase.line}`);
    continue;
  }
  const actual = claimIsQualified(testCase.line, claim);
  if (actual !== testCase.qualified) {
    const expected = testCase.qualified ? "qualified boundary prose" : "an unqualified claim";
    failures.push(`self-test: [${claim.id}] expected ${expected}, got qualified=${actual}: ${testCase.line}`);
  }
}

if (PROHIBITION_HEADING_PATTERN.test(NEGATIVE_CONTROL_HEADING)) {
  failures.push(
    `self-test: the negative-control heading is itself a prohibition heading, so injections would be exempt: ${NEGATIVE_CONTROL_HEADING}`,
  );
}

for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
  if (!claim.pattern.test(claim.injectionExample)) {
    failures.push(`self-test: [${claim.id}] injection example is not caught by its own pattern: ${claim.injectionExample}`);
  } else if (claimIsQualified(claim.injectionExample, claim)) {
    failures.push(`self-test: [${claim.id}] injection example is suppressed by the qualifier list: ${claim.injectionExample}`);
  }
}

// --- 6. route-coverage documentation check ---
//
// docs/PUBLIC-CLAIM-BOUNDARY.md states which app routes the DOM half gates and
// why each remaining one is not gated. That statement is only true while it
// partitions the real route tree, so it is derived here from the filesystem and
// the shared route constant rather than trusted.

function appRoutes(dir = join(ROOT, "app"), prefix = "") {
  const routes = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith("(") || entry.name === "api") continue;
      routes.push(...appRoutes(join(dir, entry.name), `${prefix}/${entry.name}`));
    } else if (entry.name === "page.tsx") {
      routes.push(prefix === "" ? "/" : prefix);
    }
  }
  return routes;
}

function documentedRoutes(section) {
  return new Set(
    [...section.matchAll(/`(\/[A-Za-z0-9[\]/_-]*)`/g)].map((match) => match[1]),
  );
}

const boundaryDoc = read("docs/PUBLIC-CLAIM-BOUNDARY.md");
if (boundaryDoc !== null) {
  const routes = new Set(appRoutes());
  const gatedParagraph = boundaryDoc.slice(boundaryDoc.indexOf("The DOM half gates exactly"));
  const gatedDocumented = documentedRoutes(gatedParagraph.slice(0, gatedParagraph.indexOf("\n")));
  const tableStart = gatedParagraph.indexOf("| Not gated | Routes |");
  const tableEnd = gatedParagraph.indexOf("\n\n", tableStart);
  const ungatedDocumented = documentedRoutes(gatedParagraph.slice(tableStart, tableEnd));

  const gatedActual = new Set(PUBLIC_CLAIM_DOM_ROUTES.map((route) => route.path));
  for (const route of gatedActual) {
    if (!gatedDocumented.has(route)) {
      failures.push(`docs/PUBLIC-CLAIM-BOUNDARY.md: gated route ${route} is missing from the documented gated list`);
    }
  }
  for (const route of gatedDocumented) {
    if (!gatedActual.has(route)) {
      failures.push(`docs/PUBLIC-CLAIM-BOUNDARY.md: documents ${route} as gated, but it is not in PUBLIC_CLAIM_DOM_ROUTES`);
    }
    if (ungatedDocumented.has(route)) {
      failures.push(`docs/PUBLIC-CLAIM-BOUNDARY.md: ${route} is documented as both gated and not gated`);
    }
  }
  for (const route of routes) {
    if (!gatedActual.has(route) && !ungatedDocumented.has(route)) {
      failures.push(`docs/PUBLIC-CLAIM-BOUNDARY.md: app route ${route} is neither gated nor accounted for as not gated`);
    }
  }
  for (const route of [...gatedDocumented, ...ungatedDocumented]) {
    if (!routes.has(route)) {
      failures.push(`docs/PUBLIC-CLAIM-BOUNDARY.md: documents ${route}, which is not an app route`);
    }
  }
  const counts = [
    [`gates exactly these ${gatedActual.size} routes`, "gated route count"],
    [`\`app/\` has ${routes.size} page routes`, "total route count"],
    [`The ${routes.size - gatedActual.size} that are not DOM-gated`, "not-gated route count"],
  ];
  for (const [sentence, label] of counts) {
    if (!boundaryDoc.includes(sentence)) {
      failures.push(`docs/PUBLIC-CLAIM-BOUNDARY.md: ${label} is stated incorrectly; expected "${sentence}"`);
    }
  }
  checked.push("docs/PUBLIC-CLAIM-BOUNDARY.md");
}

if (failures.length > 0) {
  console.error("[public-claim-boundaries] FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[public-claim-boundaries] OK: checked ${new Set(checked).size} public claim surface(s)`);
