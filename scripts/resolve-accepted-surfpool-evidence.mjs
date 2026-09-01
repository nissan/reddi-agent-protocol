#!/usr/bin/env node
// Resolves the accepted (PASS-only) Surfpool evidence summary for a target, so shell consumers
// share the exact selection rule the Node consumers use. Prints "n/a" when nothing is accepted.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ACCEPTED_EVIDENCE_MAX_AGE_MS, readAcceptedEvidenceManifest } from "./lib/surfpool-evidence-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [relativeDir, target] = process.argv.slice(2);

if (!relativeDir || !target) {
  console.error("usage: resolve-accepted-surfpool-evidence.mjs <artifacts/dir> <target>");
  process.exit(2);
}

try {
  const { artifacts } = readAcceptedEvidenceManifest(repoRoot, relativeDir, {
    target,
    requiredArtifacts: ["summary", "log"],
    maxAgeMs: ACCEPTED_EVIDENCE_MAX_AGE_MS,
  });
  process.stdout.write(`${artifacts.summary}\n`);
} catch (error) {
  process.stderr.write(`[accepted-evidence] ${relativeDir}: ${error.message}\n`);
  process.stdout.write("n/a\n");
}
