import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const ACCEPTED_EVIDENCE_FILENAME = "accepted-evidence.json";
export const ACCEPTED_EVIDENCE_VERSION = 3;

/**
 * Repository-owned freshness bound for Surfpool lane evidence: 14 days. Every consumer enforces it
 * and none may exceed it, so an old PASS receipt can never be cited as current lane evidence. A
 * caller may only tighten this window, never widen or disable it.
 */
export const ACCEPTED_EVIDENCE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const ACCEPTED_EVIDENCE_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Repository paths whose contents the lane's evidence actually depends on: every input the built
 * programs compile from (sources, the Quasar framework they depend on by path, and the manifests and
 * lockfiles that pin their dependencies) plus the demo client, the lane runner, and the pinned
 * toolchain baseline. A receipt records the digest at publish time and readers recompute it, so
 * editing any of these invalidates prior evidence.
 */
const LANE_FINGERPRINT_PATHS = Object.freeze({
  quasar: Object.freeze([
    // The Quasar framework the four programs compile against: `quasar-lang` is a path dependency, so
    // editing it changes every .so the lane builds without touching any experiments/ source.
    "third_party/quasar",
    ".mise.toml",
    "Anchor.toml",
    "Cargo.toml",
    "Cargo.lock",
    "programs/escrow/Cargo.toml",
    "experiments/quasar-escrow/src",
    "experiments/quasar-escrow/Cargo.toml",
    "experiments/quasar-escrow/Cargo.lock",
    "experiments/quasar-escrow-ref/src",
    "experiments/quasar-escrow-ref/Cargo.toml",
    "experiments/quasar-escrow-ref/Cargo.lock",
    "experiments/quasar-registry/src",
    "experiments/quasar-registry/Cargo.toml",
    "experiments/quasar-registry/Cargo.lock",
    "experiments/quasar-reputation/src",
    "experiments/quasar-reputation/Cargo.toml",
    "experiments/quasar-reputation/Cargo.lock",
    "experiments/quasar-attestation/src",
    "experiments/quasar-attestation/Cargo.toml",
    "experiments/quasar-attestation/Cargo.lock",
    "packages/demo-agents/src",
    "packages/demo-agents/package.json",
    "packages/demo-agents/package-lock.json",
    "packages/demo-agents/tsconfig.json",
    "packages/agent-protocol/src",
    "packages/agent-protocol/package.json",
    "packages/agent-protocol/package-lock.json",
    "packages/agent-protocol/tsconfig.json",
    "packages/per-client/src",
    "packages/per-client/package.json",
    "packages/per-client/package-lock.json",
    "packages/per-client/tsconfig.json",
    "lib/config/network.ts",
    "lib/program.ts",
    "lib/register",
    "scripts/lib/surfpool-sdk-lifecycle.mjs",
    "scripts/lib/surfpool-evidence-manifest.mjs",
    "scripts/run-surfpool-critical-smoke.sh",
    "scripts/run-surfpool-quasar-critical-smoke.sh",
    "scripts/run-surfpool-sdk-critical-smoke.mjs",
    "scripts/resolve-accepted-surfpool-evidence.mjs",
    "scripts/check-solana-baseline-pins.mjs",
    "scripts/solana-baseline-toolchain.sh",
    "scripts/lib/solana-baseline-version-match.sh",
    "scripts/check-quasar-boundary-guard.mjs",
    "scripts/check-quasar-critical-success.mjs",
    "scripts/check-quasar-demo-readiness.mjs",
    "scripts/check-quasar-deployment-inventory.mjs",
    "scripts/check-quasar-per-abi.mjs",
    "scripts/check-quasar-runtime-compatibility.mjs",
    "package.json",
    "package-lock.json",
    "config/quasar",
    "config/networks",
    "config/toolchain/solana-baseline-assets.json",
    "rust-toolchain.toml",
    "docs/SOLANA-TOOLCHAIN-BASELINE.md",
    "docs/ECONOMIC-DEMO-JUDGE-PACKET-2026-05-05.md",
    "docs/ECONOMIC-DEMO-OPERATOR-CHECKLIST-2026-05-05.md",
    "docs/QUASAR-HACKATHON-CUTOVER-PLAN-2026-05-05.md",
    ".github/workflows/anchor-program-tests.yml",
    ".github/workflows/quasar-program-tests.yml",
    ".github/workflows/surfpool-acceptance-manual.yml",
    ".github/workflows/surfpool-quasar-critical-sdk.yml",
  ]),
  "legacy-anchor": Object.freeze([
    "programs/escrow/src",
    "programs/escrow/Cargo.toml",
    ".mise.toml",
    "Anchor.toml",
    // programs/escrow declares no [workspace], so the root manifest's [profile.release]
    // (lto, codegen-units, overflow-checks) governs its cargo build-sbf output.
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "lib/config/network.ts",
    "packages/demo-agents/src",
    "packages/demo-agents/package.json",
    "packages/demo-agents/package-lock.json",
    "packages/demo-agents/tsconfig.json",
    "scripts/lib/surfpool-sdk-lifecycle.mjs",
    "scripts/lib/surfpool-evidence-manifest.mjs",
    "scripts/run-surfpool-critical-smoke.sh",
    "scripts/run-surfpool-sdk-critical-smoke.mjs",
    "scripts/resolve-accepted-surfpool-evidence.mjs",
    "scripts/check-solana-baseline-pins.mjs",
    "scripts/solana-baseline-toolchain.sh",
    "scripts/lib/solana-baseline-version-match.sh",
    "package.json",
    "package-lock.json",
    "config/networks",
    "config/toolchain/solana-baseline-assets.json",
    "docs/SOLANA-TOOLCHAIN-BASELINE.md",
    ".github/workflows/anchor-program-tests.yml",
    ".github/workflows/quasar-program-tests.yml",
    ".github/workflows/surfpool-acceptance-manual.yml",
    ".github/workflows/surfpool-quasar-critical-sdk.yml",
  ]),
});

function fileContentDigest(repoRoot, relativePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, relativePath))).digest("hex")}`;
}

function digestFile(hash, repoRoot, relativePath) {
  hash.update(relativePath.split(path.sep).join("/"));
  hash.update("\0");
  hash.update(fs.readFileSync(path.join(repoRoot, relativePath)));
  hash.update("\0");
}

const FINGERPRINT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

function walkFiles(repoRoot, relativePath, out) {
  const absolute = path.join(repoRoot, relativePath);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return;
  }
  if (stat.isFile()) {
    out.push(relativePath);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(absolute).sort()) {
    if (FINGERPRINT_IGNORED_DIRECTORIES.has(entry)) continue;
    walkFiles(repoRoot, path.join(relativePath, entry), out);
  }
}

/**
 * Deterministic digest of the repository sources this lane's evidence depends on. Used as the
 * receipt's immutable binding to the exact sources that produced it.
 */
function runtimeCompatibilityFingerprintPaths(repoRoot) {
  try {
    const compatibility = JSON.parse(fs.readFileSync(path.join(repoRoot, "config/quasar/runtime-compatibility.json"), "utf8"));
    return (compatibility.demoCriticalPaths ?? [])
      .map((entry) => entry?.path)
      .filter((relativePath) => typeof relativePath === "string" && relativePath && !path.isAbsolute(relativePath))
      .filter((relativePath) => !path.normalize(relativePath).split(path.sep).includes(".."));
  } catch {
    return [];
  }
}

function fingerprintRootsForTarget(repoRoot, target) {
  const roots = LANE_FINGERPRINT_PATHS[target];
  if (!roots) throw new EvidenceManifestError(`no source fingerprint is defined for target ${JSON.stringify(target)}`);
  if (target !== "quasar") return roots;
  return [...new Set([...roots, ...runtimeCompatibilityFingerprintPaths(repoRoot)])];
}

export function computeLaneSourceFingerprint(repoRoot, target) {
  const roots = fingerprintRootsForTarget(repoRoot, target);
  const files = [];
  for (const root of roots) walkFiles(repoRoot, root, files);
  files.sort();
  const hash = crypto.createHash("sha256");
  hash.update(`target:${target}\0`);
  for (const file of files) digestFile(hash, repoRoot, file);
  return `sha256:${hash.digest("hex")}`;
}

export class EvidenceManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvidenceManifestError";
  }
}

function assertNoSymlinkPathComponents(repoRoot, normalizedRelativePath, label) {
  const parts = normalizedRelativePath.split(path.sep).filter(Boolean);
  let current = repoRoot;
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) {
      throw new EvidenceManifestError(`${label} must not traverse symbolic links: ${normalizedRelativePath}`);
    }
  }
}

export function assertContainedArtifactPath(manifestRelativeDir, artifactPath, options = {}) {
  if (typeof manifestRelativeDir !== "string" || !manifestRelativeDir) {
    throw new EvidenceManifestError("a bound evidence root (manifestRelativeDir) is required to validate artifact containment");
  }
  if (!options.repoRoot) {
    throw new EvidenceManifestError("a repoRoot is required to validate artifact containment against the real filesystem");
  }
  if (typeof artifactPath !== "string" || !artifactPath) {
    throw new EvidenceManifestError(`artifact path must be a non-empty repository-relative string; got ${JSON.stringify(artifactPath)}`);
  }
  if (path.isAbsolute(artifactPath) || /^[a-zA-Z]:[\\/]/.test(artifactPath)) {
    throw new EvidenceManifestError(`artifact path must be repository-relative; got ${JSON.stringify(artifactPath)}`);
  }
  const normalizedDir = path.normalize(manifestRelativeDir);
  const normalized = path.normalize(artifactPath);
  if (normalized.split(/[\\/]/).includes("..")) {
    throw new EvidenceManifestError(`artifact path must not escape ${manifestRelativeDir}; got ${JSON.stringify(artifactPath)}`);
  }
  if (normalized !== normalizedDir && !normalized.startsWith(`${normalizedDir}${path.sep}`)) {
    throw new EvidenceManifestError(`artifact path must live under ${manifestRelativeDir}; got ${JSON.stringify(artifactPath)}`);
  }

  const repoRoot = options.repoRoot;
  {
    assertNoSymlinkPathComponents(repoRoot, normalizedDir, "evidence root");
    assertNoSymlinkPathComponents(repoRoot, normalized, "artifact path");
    const realRepoRoot = fs.realpathSync(repoRoot);
    const boundRoot = fs.realpathSync(path.join(repoRoot, normalizedDir));
    if (boundRoot !== realRepoRoot && !boundRoot.startsWith(`${realRepoRoot}${path.sep}`)) {
      throw new EvidenceManifestError(`evidence root resolves outside the repository through a symlink: ${manifestRelativeDir}`);
    }
    let resolved;
    try {
      resolved = fs.realpathSync(path.join(repoRoot, normalized));
    } catch {
      return normalized;
    }
    if (resolved !== boundRoot && !resolved.startsWith(`${boundRoot}${path.sep}`)) {
      throw new EvidenceManifestError(`artifact path resolves outside ${manifestRelativeDir} through a symlink; got ${JSON.stringify(artifactPath)}`);
    }
  }
  return normalized;
}

function assertPassRecord(record) {
  if (record?.status !== "PASS") {
    throw new EvidenceManifestError(`refusing to accept evidence with status ${JSON.stringify(record?.status)}; only PASS runs are accepted`);
  }
  if (!record?.target) throw new EvidenceManifestError("accepted evidence requires a target");
  if (!record?.runId) throw new EvidenceManifestError("accepted evidence requires a runId");
  if (!Array.isArray(record?.artifacts) || record.artifacts.length === 0) {
    throw new EvidenceManifestError("accepted evidence requires at least one artifact path");
  }
  if (!record?.provenance?.command) {
    throw new EvidenceManifestError("accepted evidence requires provenance.command");
  }
  if (!record?.manifestRelativeDir) {
    throw new EvidenceManifestError("accepted evidence requires an explicit manifestRelativeDir to bind artifact containment to");
  }
  if (!record?.sourceFingerprint) {
    throw new EvidenceManifestError("accepted evidence requires a sourceFingerprint binding it to the sources that produced it");
  }
  if (!record?.repoRoot) {
    throw new EvidenceManifestError("accepted evidence requires repoRoot so artifact existence and containment can be verified");
  }
  for (const artifact of record.artifacts) {
    if (!artifact?.name) throw new EvidenceManifestError("every accepted artifact requires a name");
    assertContainedArtifactPath(record.manifestRelativeDir, artifact.path, { repoRoot: record.repoRoot });
  }
}

/**
 * Atomically publish a per-target passing-evidence receipt. Written only after a run passes, via
 * temp-file + rename inside the same directory, so a concurrent or crashed writer can never leave a
 * torn manifest and a failed run can never displace previously accepted evidence.
 */
export async function writeAcceptedEvidenceManifest(manifestDir, record) {
  assertPassRecord(record);

  const currentSourceFingerprint = computeLaneSourceFingerprint(record.repoRoot, record.target);
  if (record.sourceFingerprint !== currentSourceFingerprint) {
    throw new EvidenceManifestError(
      `refusing to publish accepted evidence because sources changed during the run ` +
      `(pre-run ${record.sourceFingerprint}, current ${currentSourceFingerprint}); re-run the lane`,
    );
  }

  const artifacts = record.artifacts.map((artifact) => {
    const contained = assertContainedArtifactPath(record.manifestRelativeDir, artifact.path, { repoRoot: record.repoRoot });
    if (!fs.existsSync(path.join(record.repoRoot, contained))) {
      throw new EvidenceManifestError(`refusing to publish a receipt citing a missing ${artifact.name} artifact: ${artifact.path}`);
    }
    return {
      ...artifact,
      path: contained.split(path.sep).join("/"),
      sha256: fileContentDigest(record.repoRoot, contained),
    };
  });

  const manifest = {
    version: ACCEPTED_EVIDENCE_VERSION,
    status: "PASS",
    target: record.target,
    runId: record.runId,
    acceptedAt: record.acceptedAt ?? new Date().toISOString(),
    evidenceRoot: path.normalize(record.manifestRelativeDir).split(path.sep).join("/"),
    sourceFingerprint: record.sourceFingerprint,
    artifacts,
    provenance: { ...record.provenance },
  };
  await fsp.mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, ACCEPTED_EVIDENCE_FILENAME);
  const tempPath = path.join(manifestDir, `.${ACCEPTED_EVIDENCE_FILENAME}.${crypto.randomUUID()}.tmp`);
  try {
    await fsp.writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await fsp.rename(tempPath, manifestPath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    throw error;
  }
  return { manifestPath, manifest };
}

/**
 * Read a per-target passing-evidence receipt, validating target, PASS status, provenance, and that
 * every required artifact still exists. Throws EvidenceManifestError rather than returning stale or
 * failed evidence.
 */
export function readAcceptedEvidenceManifest(repoRoot, manifestRelativeDir, { target, requiredArtifacts = [], maxAgeMs } = {}) {
  const effectiveMaxAgeMs = Number.isFinite(maxAgeMs)
    ? Math.min(maxAgeMs, ACCEPTED_EVIDENCE_MAX_AGE_MS)
    : ACCEPTED_EVIDENCE_MAX_AGE_MS;
  const manifestPath = path.join(repoRoot, manifestRelativeDir, ACCEPTED_EVIDENCE_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    throw new EvidenceManifestError(`no accepted evidence at ${path.join(manifestRelativeDir, ACCEPTED_EVIDENCE_FILENAME)}; run the lane to a PASS first`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} is not valid JSON: ${error.message}`);
  }

  if (manifest?.version !== ACCEPTED_EVIDENCE_VERSION) {
    throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} has unsupported version ${JSON.stringify(manifest?.version)}`);
  }
  if (manifest?.status !== "PASS") {
    throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} has status ${JSON.stringify(manifest?.status)}; only PASS runs may be cited`);
  }
  if (target && manifest?.target !== target) {
    throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} is for target ${JSON.stringify(manifest?.target)}, expected ${JSON.stringify(target)}`);
  }
  if (!manifest?.runId || !manifest?.acceptedAt || !manifest?.provenance?.command) {
    throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} is missing runId/acceptedAt/provenance`);
  }

  const acceptedAtMs = Date.parse(manifest.acceptedAt);
  if (!Number.isFinite(acceptedAtMs)) {
    throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} has an unparseable acceptedAt ${JSON.stringify(manifest.acceptedAt)}`);
  }
  const now = Date.now();
  if (acceptedAtMs - now > ACCEPTED_EVIDENCE_CLOCK_SKEW_MS) {
    throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} is future-dated: accepted ${manifest.acceptedAt}; re-run the lane`);
  }
  if (now - acceptedAtMs > effectiveMaxAgeMs) {
    throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} is stale: accepted ${manifest.acceptedAt}, older than the allowed ${effectiveMaxAgeMs}ms; re-run the lane`);
  }

  const boundRoot = path.normalize(manifestRelativeDir).split(path.sep).join("/");
  if (manifest.evidenceRoot !== boundRoot) {
    throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} was published for evidence root ${JSON.stringify(manifest.evidenceRoot)}, not ${JSON.stringify(boundRoot)}`);
  }

  const expectedFingerprint = computeLaneSourceFingerprint(repoRoot, manifest.target);
  if (manifest.sourceFingerprint !== expectedFingerprint) {
    throw new EvidenceManifestError(
      `accepted evidence at ${manifestRelativeDir} was produced from different sources than the working tree ` +
      `(receipt ${manifest.sourceFingerprint}, current ${expectedFingerprint}); re-run the lane`,
    );
  }

  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} does not record any artifacts`);
  }
  const validatedArtifacts = [];
  for (const artifact of manifest.artifacts) {
    if (!artifact?.name || !artifact?.path) {
      throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} records an artifact without name/path`);
    }
    const contained = assertContainedArtifactPath(manifestRelativeDir, artifact.path, { repoRoot });
    if (!fs.existsSync(path.join(repoRoot, contained))) {
      throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} cites a missing ${artifact.name} artifact: ${artifact.path}`);
    }
    if (!artifact.sha256) {
      throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} does not bind the ${artifact.name} artifact content hash`);
    }
    const actualDigest = fileContentDigest(repoRoot, contained);
    if (artifact.sha256 !== actualDigest) {
      throw new EvidenceManifestError(
        `accepted evidence at ${manifestRelativeDir} cites a ${artifact.name} artifact whose content changed ` +
        `(receipt ${artifact.sha256}, current ${actualDigest}); re-run the lane`,
      );
    }
    validatedArtifacts.push({ ...artifact, path: contained });
  }
  const byName = new Map(validatedArtifacts.map((artifact) => [artifact.name, artifact]));
  const resolved = {};
  for (const name of requiredArtifacts) {
    const artifact = byName.get(name);
    if (!artifact?.path) {
      throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} does not record the required ${name} artifact`);
    }
    resolved[name] = artifact.path;
  }

  return { manifest, manifestPath, artifacts: resolved };
}
