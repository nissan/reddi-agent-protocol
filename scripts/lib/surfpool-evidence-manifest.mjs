import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const ACCEPTED_EVIDENCE_FILENAME = "accepted-evidence.json";
export const ACCEPTED_EVIDENCE_VERSION = 1;

export class EvidenceManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvidenceManifestError";
  }
}

export function assertContainedArtifactPath(manifestRelativeDir, artifactPath) {
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
  for (const artifact of record.artifacts) {
    if (!artifact?.name) throw new EvidenceManifestError("every accepted artifact requires a name");
    assertContainedArtifactPath(record.manifestRelativeDir ?? path.dirname(artifact.path ?? ""), artifact.path);
  }
}

/**
 * Atomically publish a per-target passing-evidence receipt. Written only after a run passes, via
 * temp-file + rename inside the same directory, so a concurrent or crashed writer can never leave a
 * torn manifest and a failed run can never displace previously accepted evidence.
 */
export async function writeAcceptedEvidenceManifest(manifestDir, record) {
  assertPassRecord(record);
  if (record.manifestRelativeDir) {
    for (const artifact of record.artifacts) assertContainedArtifactPath(record.manifestRelativeDir, artifact.path);
  }
  const manifest = {
    version: ACCEPTED_EVIDENCE_VERSION,
    status: "PASS",
    target: record.target,
    runId: record.runId,
    acceptedAt: record.acceptedAt ?? new Date().toISOString(),
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
  if (Number.isFinite(maxAgeMs) && Date.now() - acceptedAtMs > maxAgeMs) {
    throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} is stale: accepted ${manifest.acceptedAt}, older than the allowed ${maxAgeMs}ms`);
  }

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const byName = new Map(artifacts.map((artifact) => [artifact?.name, artifact]));
  const resolved = {};
  for (const name of requiredArtifacts) {
    const artifact = byName.get(name);
    if (!artifact?.path) {
      throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} does not record the required ${name} artifact`);
    }
    const contained = assertContainedArtifactPath(manifestRelativeDir, artifact.path);
    if (!fs.existsSync(path.join(repoRoot, contained))) {
      throw new EvidenceManifestError(`accepted evidence at ${manifestRelativeDir} cites a missing ${name} artifact: ${artifact.path}`);
    }
    resolved[name] = contained;
  }

  return { manifest, manifestPath, artifacts: resolved };
}
