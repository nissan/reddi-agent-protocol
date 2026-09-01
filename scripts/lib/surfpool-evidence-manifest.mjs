import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const ACCEPTED_EVIDENCE_FILENAME = "accepted-evidence.json";
export const ACCEPTED_EVIDENCE_VERSION = 2;

/**
 * Repository-owned freshness bound for Surfpool lane evidence: 14 days. Every consumer enforces it
 * and none may exceed it, so an old PASS receipt can never be cited as current lane evidence. A
 * caller may only tighten this window, never widen or disable it.
 */
export const ACCEPTED_EVIDENCE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Repository paths whose contents the lane's evidence actually depends on. A receipt records the
 * digest of these at publish time; readers recompute it, so editing a Quasar program, the demo
 * client, the lane runner, or the pinned toolchain baseline invalidates prior evidence.
 */
const LANE_FINGERPRINT_PATHS = Object.freeze({
  quasar: Object.freeze([
    "experiments/quasar-escrow/src",
    "experiments/quasar-registry/src",
    "experiments/quasar-reputation/src",
    "experiments/quasar-attestation/src",
    "packages/demo-agents/src",
    "scripts/lib/surfpool-sdk-lifecycle.mjs",
    "scripts/lib/surfpool-evidence-manifest.mjs",
    "scripts/run-surfpool-sdk-critical-smoke.mjs",
    "config/quasar/deployments.json",
    "docs/SOLANA-TOOLCHAIN-BASELINE.md",
  ]),
  "legacy-anchor": Object.freeze([
    "programs/escrow/src",
    "packages/demo-agents/src",
    "scripts/lib/surfpool-sdk-lifecycle.mjs",
    "scripts/lib/surfpool-evidence-manifest.mjs",
    "scripts/run-surfpool-sdk-critical-smoke.mjs",
    "docs/SOLANA-TOOLCHAIN-BASELINE.md",
  ]),
});

function digestFile(hash, repoRoot, relativePath) {
  hash.update(relativePath.split(path.sep).join("/"));
  hash.update("\0");
  hash.update(fs.readFileSync(path.join(repoRoot, relativePath)));
  hash.update("\0");
}

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
    walkFiles(repoRoot, path.join(relativePath, entry), out);
  }
}

/**
 * Deterministic digest of the repository sources this lane's evidence depends on. Used as the
 * receipt's immutable binding to the exact sources that produced it.
 */
export function computeLaneSourceFingerprint(repoRoot, target) {
  const roots = LANE_FINGERPRINT_PATHS[target];
  if (!roots) throw new EvidenceManifestError(`no source fingerprint is defined for target ${JSON.stringify(target)}`);
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

export function assertContainedArtifactPath(manifestRelativeDir, artifactPath, options = {}) {
  if (typeof manifestRelativeDir !== "string" || !manifestRelativeDir) {
    throw new EvidenceManifestError("a bound evidence root (manifestRelativeDir) is required to validate artifact containment");
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
  if (repoRoot) {
    const boundRoot = fs.realpathSync(path.join(repoRoot, normalizedDir));
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

  if (record.repoRoot) {
    for (const artifact of record.artifacts) {
      if (!fs.existsSync(path.join(record.repoRoot, artifact.path))) {
        throw new EvidenceManifestError(`refusing to publish a receipt citing a missing ${artifact.name} artifact: ${artifact.path}`);
      }
    }
  }

  const manifest = {
    version: ACCEPTED_EVIDENCE_VERSION,
    status: "PASS",
    target: record.target,
    runId: record.runId,
    acceptedAt: record.acceptedAt ?? new Date().toISOString(),
    evidenceRoot: path.normalize(record.manifestRelativeDir).split(path.sep).join("/"),
    sourceFingerprint: record.sourceFingerprint,
    artifacts: [...record.artifacts],
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
  if (Date.now() - acceptedAtMs > effectiveMaxAgeMs) {
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

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const byName = new Map(artifacts.map((artifact) => [artifact?.name, artifact]));
  const resolved = {};
  for (const name of requiredArtifacts) {
    const artifact = byName.get(name);
    if (!artifact?.path) {
      throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} does not record the required ${name} artifact`);
    }
    const contained = assertContainedArtifactPath(manifestRelativeDir, artifact.path, { repoRoot });
    if (!fs.existsSync(path.join(repoRoot, contained))) {
      throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} cites a missing ${name} artifact: ${artifact.path}`);
    }
    resolved[name] = contained;
  }

  return { manifest, manifestPath, artifacts: resolved };
}
