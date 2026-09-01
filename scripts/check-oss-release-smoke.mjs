#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const packageSet = [
  {
    name: "@reddi/agent-protocol",
    dir: "packages/agent-protocol",
    commands: [
      ["npm", ["test"]],
      ["npm", ["run", "example:ard:no-spend"]],
    ],
    importSmoke: [
      "index.js",
      "receipts.js",
      "policy.js",
      "provider-trust.js",
      "source-diagnostics.js",
      "discovery-source.js",
      "rail-neutral-proof-chain-fixture.js",
    ],
  },
  {
    name: "@reddi/x402-solana",
    dir: "packages/x402-solana",
    commands: [
      ["npm", ["test", "--", "--runInBand"]],
      ["npm", ["run", "build"]],
    ],
    importSmoke: [
      "index.js",
      "budget-policy.js",
      "client.js",
      "jupiter.js",
      "middleware.js",
      "nonce.js",
      "payment.js",
      "spl-token-observer.js",
    ],
  },
];

const excludedPackages = new Set([
  "@reddi/sendai-x402",
  "@reddi/eliza-plugin-x402",
]);

const forbiddenPackPathPatterns = [
  /^node_modules\//,
  /^artifacts\//,
  /^coverage\//,
  /^\.next\//,
  /^ingests\//,
  /^research\//,
  /^programs\//,
  /^third_party\//,
  /^app\//,
  /^components\//,
  /^config\//,
  /^\.env($|\.)/,
  /(^|\/)\.env($|\.)/,
  /(^|\/)(id_rsa|id_ed25519|wallet|keypair).*\.json$/i,
  /(^|\/).*secret.*$/i,
  /(^|\/).*private-key.*$/i,
  /(^|\/).*\.log$/i,
  /(^|\/).*\.tgz$/i,
];

const staleClaimPatterns = [
  {
    pattern: /trustless micropayment/i,
    reason: "stale trustless micropayment claim",
  },
  {
    pattern: /on-chain escrow \(Phase 0/i,
    reason: "stale on-chain escrow phase claim",
  },
];

const overclaimPatterns = [
  {
    pattern: /published (?:on )?npm|npm[- ]published|publicly published/i,
    reason: "npm publication claim",
  },
  {
    pattern: /generally installable|npm install @reddi\/x402-solana/i,
    reason: "general installability claim",
  },
  {
    pattern: /production[- ]ready settlement|production settlement|settlement[- ]finality|settlement finality/i,
    reason: "settlement-finality claim",
  },
  {
    pattern: /mainnet support|mainnet[- ]ready|mainnet readiness/i,
    reason: "mainnet readiness claim",
  },
  {
    pattern: /custody|escrow[- ]finality|escrow finality/i,
    reason: "custody or escrow-finality claim",
  },
  {
    pattern: /default live payment|live payment|live\/devnet payment|devnet payment/i,
    reason: "live/devnet payment claim",
  },
  {
    pattern: /pay\.sh activation|pay\.sh activated|default pay\.sh/i,
    reason: "Pay.sh activation claim",
  },
  {
    pattern: /hosted marketplace publication|marketplace publication/i,
    reason: "marketplace publication claim",
  },
  {
    pattern: /trust\/reputation mutation|trust mutation|reputation mutation/i,
    reason: "trust/reputation mutation claim",
  },
];

const claimScanFiles = [
  "README.md",
  "SECURITY.md",
  "DEPLOY.md",
  "docs/NETWORK-PROFILES.md",
  "packages/agent-protocol/README.md",
  "packages/x402-solana/README.md",
  "packages/x402-solana/src/index.ts",
  "packages/x402-solana/dist/index.js",
  "packages/x402-solana/dist/index.d.ts",
  "packages/x402-solana/package.json",
  "docs/X402-SOLANA-PACKAGE-SURFACE-DECISION.md",
  "docs/X402-ADAPTER-RETENTION-DECISION-2026-06-24.md",
  "docs/OSS-V0.1-RELEASE-SMOKE.md",
];

const failures = [];
const passed = [];

function run(label, command, args, options = {}) {
  const cwd = options.cwd ?? ROOT;
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: options.capture ? "pipe" : "inherit",
    env: {
      ...process.env,
      CI: process.env.CI ?? "1",
      REDDI_RELEASE_SMOKE: "no-publish-no-live-payment",
    },
  });

  if (result.status !== 0) {
    failures.push(`${label} failed with exit ${result.status}`);
  } else {
    passed.push(label);
  }

  return result;
}

function parseJsonOutput(label, result) {
  if (result.status !== 0) return undefined;
  const stdout = result.stdout?.trim() ?? "";
  const start = stdout.indexOf("[");
  if (start < 0) {
    failures.push(`${label} did not emit npm pack JSON`);
    return undefined;
  }
  try {
    return JSON.parse(stdout.slice(start));
  } catch (error) {
    failures.push(`${label} emitted invalid JSON: ${error.message}`);
    return undefined;
  }
}

function checkPackageManifest(pkg) {
  const manifestPath = join(ROOT, pkg.dir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (manifest.name !== pkg.name) {
    failures.push(`${pkg.dir}/package.json name mismatch: ${manifest.name}`);
  }
  if (!manifest.main || !manifest.types) {
    failures.push(`${pkg.name} must declare main and types`);
  }
  if (!Array.isArray(manifest.files) || !manifest.files.includes("dist") || !manifest.files.includes("README.md")) {
    failures.push(`${pkg.name} must restrict package files to dist plus README.md`);
  }
  if (excludedPackages.has(manifest.name)) {
    failures.push(`${manifest.name} is excluded from OSS v0.1 smoke`);
  }
}

function checkPackContents(pkg) {
  const result = run(
    `${pkg.name} npm pack dry-run`,
    "npm",
    ["pack", "--dry-run", "--json"],
    { cwd: join(ROOT, pkg.dir), capture: true },
  );
  const parsed = parseJsonOutput(`${pkg.name} npm pack dry-run`, result);
  if (!parsed?.[0]?.files) return;

  const files = parsed[0].files.map((file) => file.path);
  for (const required of ["package.json", "README.md"]) {
    if (!files.includes(required)) {
      failures.push(`${pkg.name} package dry-run missing ${required}`);
    }
  }
  if (!files.some((path) => path.startsWith("dist/"))) {
    failures.push(`${pkg.name} package dry-run missing dist output`);
  }
  for (const path of files) {
    for (const pattern of forbiddenPackPathPatterns) {
      if (pattern.test(path)) {
        failures.push(`${pkg.name} package dry-run includes forbidden path: ${path}`);
      }
    }
  }
}

async function checkImportSmoke(pkg) {
  const distDir = join(ROOT, pkg.dir, "dist");
  for (const file of pkg.importSmoke) {
    const modulePath = join(distDir, file);
    if (!existsSync(modulePath)) {
      failures.push(`${pkg.name} import smoke missing ${relative(ROOT, modulePath)}`);
      continue;
    }
    try {
      await import(`file://${modulePath}`);
    } catch (error) {
      failures.push(`${pkg.name} import smoke failed for ${file}: ${error.message}`);
    }
  }
  passed.push(`${pkg.name} import smoke`);
}

function checkClaimBoundaries() {
  for (const file of claimScanFiles) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const { pattern, reason } of staleClaimPatterns) {
      if (pattern.test(text)) {
        failures.push(`${file}: ${reason}`);
      }
    }
    checkOverclaimBoundaries(file, text);
  }

  const retention = readFileSync(join(ROOT, "docs/X402-ADAPTER-RETENTION-DECISION-2026-06-24.md"), "utf8");
  for (const packageName of excludedPackages) {
    const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`${escaped}[\\s\\S]{0,240}(defer|deferred|excluded)`, "i").test(retention)) {
      failures.push(`adapter retention doc must explicitly defer/exclude ${packageName}`);
    }
  }

  checkExcludedPackageManifests();
  passed.push("claim boundary scan");
}

function checkExcludedPackageManifests() {
  for (const dir of ["packages/sendai-x402", "packages/eliza-plugin-x402"]) {
    const manifest = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));
    if (!excludedPackages.has(manifest.name)) {
      failures.push(`${dir}/package.json name "${manifest.name}" drifted out of the deferred adapter set; update excludedPackages and docs/X402-ADAPTER-RETENTION-DECISION-2026-06-24.md before renaming`);
      continue;
    }
    if (manifest.private !== true) {
      failures.push(`${dir}/package.json must set private: true while the adapter is deferred from the public v0.1 package set`);
    }
    if (!/experimental|deferred|not part of the public v0\.1 package set/i.test(manifest.description ?? "")) {
      failures.push(`${dir}/package.json description must disclose deferred/experimental status`);
    }
  }
}

function checkOverclaimBoundaries(file, text) {
  const lines = text.split("\n");
  let boundaryContext = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = line.toLowerCase();
    if (/^(#{1,6}\s*)?(forbidden claims|explicit non-claims|success boundary|boundaries|what this does not prove|passing this smoke does not mean|excluded from v0\.1 smoke)/i.test(line.trim())) {
      boundaryContext = normalized;
    } else if (/^#{1,6}\s+/.test(line.trim())) {
      boundaryContext = "";
    }

    for (const { pattern, reason } of overclaimPatterns) {
      if (!pattern.test(line)) continue;
      if (isAllowedBoundaryLine([lines[index - 1] ?? "", line, lines[index + 1] ?? ""].join(" "), boundaryContext)) continue;
      failures.push(`${file}:${index + 1}: ${reason}: ${line.trim()}`);
    }
  }
}

function isAllowedBoundaryLine(line, boundaryContext) {
  const normalized = line.toLowerCase();
  if (boundaryContext) return true;
  return [
    " not ",
    " not yet ",
    " no ",
    " no-",
    " non-",
    "never ",
    "must not",
    "should not",
    "do not",
    "does not",
    "without ",
    "outside ",
    "excluded",
    "exclude ",
    "deferred",
    "forbidden",
    "blocked",
    "fail ",
    "fails ",
    "rejected",
    "disabled",
    "requires explicit",
    "until ",
    "unless ",
    "separately proven",
    "must stay local",
    "must not imply",
    "overclaim",
    "mock",
    "behind explicit",
    "separate spend policy",
    "human-approved",
  ].some((marker) => normalized.includes(marker));
}

function checkRootPackageScript() {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (manifest.scripts?.["check:oss-release-smoke"] !== "node ./scripts/check-oss-release-smoke.mjs") {
    failures.push("root package.json missing check:oss-release-smoke script");
  } else {
    passed.push("root smoke script registration");
  }
}

for (const pkg of packageSet) {
  checkPackageManifest(pkg);
  for (const [command, args] of pkg.commands) {
    run(`${pkg.name}: ${command} ${args.join(" ")}`, command, args, { cwd: join(ROOT, pkg.dir) });
  }
  await checkImportSmoke(pkg);
  checkPackContents(pkg);
}

run("RAP naming guard", "npm", ["run", "check:rap:naming"]);
checkClaimBoundaries();
checkRootPackageScript();

console.log("");
console.log("[oss-release-smoke] passed checks:");
for (const item of passed) {
  console.log(`- ${item}`);
}

if (failures.length > 0) {
  console.error("");
  console.error("[oss-release-smoke] failures:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("");
console.log("[oss-release-smoke] OK: clean-checkout smoke stayed no-publish and no-live-payment");
