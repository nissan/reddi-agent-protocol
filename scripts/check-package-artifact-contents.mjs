#!/usr/bin/env node
// check-package-artifact-contents.mjs
//
// RAP v0.1 package artifact guard (#449).
//
// Deterministic, offline check that the publishable package tarball contents
// stay bounded. It runs `npm pack --dry-run --json` from each candidate
// package directory (never from the repo root — `npm --prefix <pkg> pack` can
// accidentally inspect the root app package) and fails when the artifact:
//
//   - is missing required files (package.json, README.md, dist/ output), or
//   - includes secrets (.env, keys, wallets, keypairs, npmrc, pem),
//   - includes generated noise (node_modules/, dist-tests/, test-results/,
//     artifacts/, coverage/, logs, tarballs, .DS_Store),
//   - includes private research or ingest corpora (research/, ingests/),
//   - includes unrelated app/repo files (app/, components/, e2e/, programs/,
//     third_party/, tests/).
//
// It also asserts manifest hygiene: "files" whitelists dist + README.md, the
// package is not marked private, and a license is declared.
//
// Relationship to existing guards:
//   - packages/agent-protocol/scripts/check-package-exports.mjs (#573/#521)
//     proves every exports/main/types target exists — it does not inspect the
//     packed artifact. This script is the artifact-contents half.
//   - scripts/check-oss-release-smoke.mjs (#512/#523) includes a pack
//     inspection but only inside the full clean-checkout smoke (tests, build,
//     examples). This script is the cheap standalone gate suitable for the
//     rap-package-guard CI lane and for `release:dry-run`.
//
// Usage:
//   node scripts/check-package-artifact-contents.mjs            # all candidates
//   node scripts/check-package-artifact-contents.mjs --dir packages/agent-protocol
//
// Node built-ins only. No network. No publish. Exit 0 on pass.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// OSS v0.1 publishable candidate set per docs/OSS-V0.1-RELEASE-SMOKE.md.
// @reddi/sendai-x402 and @reddi/eliza-plugin-x402 are deferred experimental
// packages and must not be added here without a promotion issue.
const DEFAULT_PACKAGE_DIRS = ["packages/agent-protocol", "packages/x402-solana"];

const REQUIRED_FILES = ["package.json", "README.md"];

const FORBIDDEN_PATH_PATTERNS = [
  // Secrets and credentials.
  { pattern: /(^|\/)\.env($|\.)/, reason: "dotenv file" },
  { pattern: /(^|\/)\.npmrc$/, reason: "npm credentials file" },
  { pattern: /(^|\/)(id_rsa|id_ed25519|wallet|keypair)[^/]*\.json$/i, reason: "wallet/keypair-shaped file" },
  { pattern: /(^|\/)[^/]*secret[^/]*$/i, reason: "secret-shaped path" },
  { pattern: /(^|\/)[^/]*private-key[^/]*$/i, reason: "private-key-shaped path" },
  { pattern: /\.(pem|p12|pfx|keystore)$/i, reason: "key material extension" },
  // Generated noise.
  { pattern: /^node_modules\//, reason: "node_modules" },
  { pattern: /^dist-tests\//, reason: "compiled test output (dist-tests/)" },
  { pattern: /^test-results\//, reason: "test-results output" },
  { pattern: /^artifacts\//, reason: "artifacts output" },
  { pattern: /^coverage\//, reason: "coverage output" },
  { pattern: /^\.next\//, reason: "Next.js build output" },
  { pattern: /(^|\/)[^/]*\.log$/i, reason: "log file" },
  { pattern: /(^|\/)[^/]*\.tsbuildinfo$/i, reason: "TypeScript build info" },
  { pattern: /(^|\/)[^/]*\.tgz$/i, reason: "nested tarball" },
  { pattern: /(^|\/)\.DS_Store$/, reason: "macOS metadata" },
  // Private research / ingest corpora.
  { pattern: /^research\//, reason: "private research" },
  { pattern: /^ingests\//, reason: "ingest corpus" },
  // Unrelated app/repo files.
  { pattern: /^app\//, reason: "app UI files" },
  { pattern: /^components\//, reason: "app UI components" },
  { pattern: /^config\//, reason: "repo config" },
  { pattern: /^e2e\//, reason: "e2e suites" },
  { pattern: /^tests?\//, reason: "test sources" },
  { pattern: /^programs\//, reason: "on-chain program sources" },
  { pattern: /^third_party\//, reason: "third-party sources" },
];

function parseArgs(argv) {
  const dirs = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") {
      const value = argv[i + 1];
      if (!value) {
        console.error("check-package-artifact-contents: --dir requires a value");
        process.exit(2);
      }
      dirs.push(value.replace(/\/+$/, ""));
      i += 1;
    } else {
      console.error(`check-package-artifact-contents: unknown argument ${argv[i]}`);
      process.exit(2);
    }
  }
  return dirs.length > 0 ? dirs : DEFAULT_PACKAGE_DIRS;
}

const failures = [];

function checkManifest(pkgDir, manifest) {
  if (manifest.private === true) {
    failures.push(`${pkgDir}: package.json marks the package private — not publishable`);
  }
  if (typeof manifest.license !== "string" || manifest.license.length === 0) {
    failures.push(`${pkgDir}: package.json must declare a license`);
  }
  if (
    !Array.isArray(manifest.files) ||
    !manifest.files.includes("dist") ||
    !manifest.files.includes("README.md")
  ) {
    failures.push(`${pkgDir}: package.json "files" must whitelist dist and README.md`);
  }
}

function checkPackage(pkgDir) {
  const absDir = join(ROOT, pkgDir);
  const manifestPath = join(absDir, "package.json");
  if (!existsSync(manifestPath)) {
    failures.push(`${pkgDir}: no package.json found`);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    failures.push(`${pkgDir}: package.json is not valid JSON: ${error.message}`);
    return;
  }
  checkManifest(pkgDir, manifest);

  // Run from the package directory — see header comment.
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: absDir,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    failures.push(`${pkgDir}: npm pack --dry-run failed with exit ${result.status}`);
    return;
  }

  const stdout = result.stdout ?? "";
  const start = stdout.indexOf("[");
  if (start < 0) {
    failures.push(`${pkgDir}: npm pack --dry-run emitted no JSON`);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch (error) {
    failures.push(`${pkgDir}: npm pack --dry-run emitted invalid JSON: ${error.message}`);
    return;
  }
  const files = parsed?.[0]?.files?.map((file) => file.path);
  if (!Array.isArray(files) || files.length === 0) {
    failures.push(`${pkgDir}: npm pack --dry-run reported no files`);
    return;
  }

  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) {
      failures.push(`${pkgDir}: packed artifact missing required file ${required}`);
    }
  }
  if (!files.some((path) => path.startsWith("dist/"))) {
    failures.push(`${pkgDir}: packed artifact missing dist/ output`);
  }

  for (const path of files) {
    for (const { pattern, reason } of FORBIDDEN_PATH_PATTERNS) {
      if (pattern.test(path)) {
        failures.push(`${pkgDir}: packed artifact includes forbidden path (${reason}): ${path}`);
      }
    }
  }

  console.log(
    `check-package-artifact-contents: ${manifest.name ?? pkgDir} dry-run pack = ${files.length} file(s)`,
  );
}

function main() {
  const pkgDirs = parseArgs(process.argv.slice(2));
  for (const pkgDir of pkgDirs) {
    checkPackage(pkgDir);
  }

  if (failures.length > 0) {
    console.error("check-package-artifact-contents: FAIL");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }
  console.log(`check-package-artifact-contents: OK — ${pkgDirs.length} package(s) bounded.`);
}

main();
