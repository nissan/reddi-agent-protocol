import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const ACCEPTED_EVIDENCE_FILENAME = "accepted-evidence.json";
export const ACCEPTED_EVIDENCE_VERSION = 4;

/**
 * Publishing a receipt is a read-modify-write over one directory entry (snapshot the prior receipt,
 * rename the new one in, restore the prior one if durability cannot be proven), so it is serialized
 * by a lock directory created with `mkdir`, which is atomic on every filesystem this lane runs on.
 * While the lock exists the accepted receipt is not citable: it is either mid-replacement or its
 * on-disk state is unproven, and consumers refuse it rather than guess which.
 */
export const ACCEPTED_EVIDENCE_LOCK_DIRNAME = ".accepted-evidence.lock";
export const EVIDENCE_LOCK_STATE_PUBLISHING = "publishing";
export const EVIDENCE_LOCK_STATE_INDETERMINATE = "indeterminate";
const ACCEPTED_EVIDENCE_LOCK_OWNER_FILENAME = "owner.json";
const ACCEPTED_EVIDENCE_LOCK_WAIT_MS = 10_000;
const ACCEPTED_EVIDENCE_LOCK_POLL_MS = 25;

/**
 * How old a lock must be before a publisher may reclaim it, and only then with positive evidence
 * that its owner is gone: same host, and a pid that no longer exists. A reclaimed lock is moved
 * aside for diagnosis rather than deleted, and a lock recording an indeterminate publication is
 * never reclaimable — that one needs an operator, because nothing on disk proves what it left.
 */
const ACCEPTED_EVIDENCE_LOCK_STALE_MS = 10 * 60 * 1000;
const ACCEPTED_EVIDENCE_LOCK_RECLAIM_ATTEMPTS = 3;

/**
 * Name and version of the lane source fingerprint encoding. It is recorded in every receipt and
 * required to match exactly on read: a receipt carrying any other algorithm is refused rather than
 * reinterpreted under this one, because two encodings can disagree about which trees are equal.
 */
export const LANE_SOURCE_FINGERPRINT_ALGORITHM = "rap-lane-source-fingerprint-v2-sha256";

/**
 * Repository-owned freshness bound for Surfpool lane evidence: 14 days. Every consumer enforces it
 * and none may exceed it, so an old PASS receipt can never be cited as current lane evidence. A
 * caller may only tighten this window, never widen or disable it.
 */
export const ACCEPTED_EVIDENCE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const ACCEPTED_EVIDENCE_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Upper bound on a receipt's own size. A receipt is a short JSON record naming a handful of
 * artifacts, so anything larger is not a receipt this reader should buffer or parse.
 */
export const ACCEPTED_EVIDENCE_MAX_BYTES = 1024 * 1024;

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
    "lib/config",
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
    "lib/config",
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

/**
 * Two stats describe the same unmodified file only if device, inode, size and change time all
 * match. Device and inode alone are not enough: a filesystem is free to hand a newly created file
 * the inode a just-deleted one released, and an in-place rewrite keeps the inode by construction.
 * Size and change time both move when the bytes behind the path are replaced, so they close the
 * window between the pre-open type check and the opened descriptor.
 */
function isSameFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.ctimeMs === right.ctimeMs
  );
}

function isSameOrChild(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function openedDescriptorPath(fd, label) {
  if (process.platform !== "linux") {
    throw new EvidenceManifestError(
      `this platform cannot verify the opened descriptor for ${label}, so evidence cannot be bound to it`,
    );
  }
  try {
    return fs.realpathSync(`/proc/self/fd/${fd}`);
  } catch (error) {
    throw new EvidenceManifestError(
      `could not verify the opened descriptor for ${label}: ${error?.message ?? error}`,
    );
  }
}

function assertOpenedDescriptorContained(fd, containmentRootRealPath, label) {
  const openedPath = openedDescriptorPath(fd, label);
  if (!isSameOrChild(containmentRootRealPath, openedPath)) {
    throw new EvidenceManifestError(
      `${label} opened outside its allowed root while evidence was being computed: ${openedPath}`,
    );
  }
}

/**
 * Reads a file the receipt will be bound to, refusing to follow a symlink in the final path
 * component and hashing the bytes from that same descriptor. `identity`, when supplied, is the
 * identity the walk validated: a mismatch means the path was re-pointed at a different file, or the
 * bytes behind it were rewritten, between the walk and the read, and the read is refused rather
 * than silently hashed.
 *
 * The final component is `lstat`ed *before* the open and required to be an ordinary file, because
 * opening a FIFO for reading blocks until a writer appears — the post-open `fstat` guard would
 * never be reached. `O_NONBLOCK` makes the open itself non-blocking for anything that slipped in
 * between the two calls, and the opened descriptor's identity must still match what the `lstat`
 * saw, so a special file swapped in during that window is refused rather than opened.
 *
 * A platform without `O_NOFOLLOW` or `/proc/self/fd` cannot provide that proof, so it is refused
 * rather than downgraded to a following read.
 */
function readFingerprintedFile(repoRoot, relativePath, options = {}) {
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK, O_CLOEXEC } = fs.constants;
  if (typeof O_NOFOLLOW !== "number") {
    throw new EvidenceManifestError(
      `this platform cannot open ${relativePath} without following symbolic links, so evidence cannot be bound to it`,
    );
  }

  const containmentRootRealPath = options.containmentRootRealPath ?? fs.realpathSync(repoRoot);
  const identity = options.identity;
  const absolutePath = path.join(repoRoot, relativePath);

  let beforeOpen;
  try {
    beforeOpen = fs.lstatSync(absolutePath);
  } catch (error) {
    throw new EvidenceManifestError(`${relativePath} could not be opened: ${error?.message ?? error}`);
  }
  if (beforeOpen.isSymbolicLink()) {
    throw new EvidenceManifestError(`${relativePath} must not be a symbolic link: ${relativePath}`);
  }
  if (!beforeOpen.isFile()) {
    throw new EvidenceManifestError(`${relativePath} must be an ordinary file`);
  }

  let openFlags = O_RDONLY | O_NOFOLLOW;
  if (typeof O_NONBLOCK === "number") openFlags |= O_NONBLOCK;
  if (typeof O_CLOEXEC === "number") openFlags |= O_CLOEXEC;
  let fd;
  try {
    fd = fs.openSync(absolutePath, openFlags);
  } catch (error) {
    if (error?.code === "ELOOP" || error?.code === "EMLINK") {
      throw new EvidenceManifestError(`${relativePath} must not be a symbolic link: ${relativePath}`);
    }
    throw new EvidenceManifestError(`${relativePath} could not be opened: ${error?.message ?? error}`);
  }

  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()) {
      throw new EvidenceManifestError(`${relativePath} must be an ordinary file`);
    }
    if (!isSameFileIdentity(opened, beforeOpen)) {
      throw new EvidenceManifestError(`${relativePath} was replaced while evidence was being computed`);
    }
    assertOpenedDescriptorContained(fd, containmentRootRealPath, relativePath);
    if (Number.isFinite(options.maxBytes) && opened.size > options.maxBytes) {
      throw new EvidenceManifestError(
        `${relativePath} is ${opened.size} bytes, larger than the allowed ${options.maxBytes} bytes`,
      );
    }
    if (identity && !isSameFileIdentity(opened, identity)) {
      throw new EvidenceManifestError(`${relativePath} was replaced while evidence was being computed`);
    }
    const contents = fs.readFileSync(fd);
    const afterRead = fs.fstatSync(fd);
    if (!isSameFileIdentity(afterRead, opened)) {
      throw new EvidenceManifestError(`${relativePath} changed while it was being read`);
    }
    return contents;
  } finally {
    fs.closeSync(fd);
  }
}

function containmentRootRealPath(repoRoot, containmentRootRelativePath, label) {
  if (!containmentRootRelativePath) return fs.realpathSync(repoRoot);
  const normalized = path.normalize(containmentRootRelativePath);
  assertNoSymlinkPathComponents(repoRoot, normalized, label);
  const realRepoRoot = fs.realpathSync(repoRoot);
  const resolved = fs.realpathSync(path.join(repoRoot, normalized));
  if (!isSameOrChild(realRepoRoot, resolved)) {
    throw new EvidenceManifestError(`${label} resolves outside the repository through a symlink: ${containmentRootRelativePath}`);
  }
  return resolved;
}

function fileContentDigest(repoRoot, relativePath, options = {}) {
  const contents = readFingerprintedFile(repoRoot, relativePath, {
    ...options,
    containmentRootRealPath: options.containmentRootRealPath ?? containmentRootRealPath(
      repoRoot,
      options.containmentRootRelativePath,
      options.containmentRootLabel ?? "evidence root",
    ),
  });
  return `sha256:${crypto.createHash("sha256").update(contents).digest("hex")}`;
}

function openDirectoryForSync(directoryPath, label) {
  const { O_RDONLY, O_DIRECTORY, O_CLOEXEC } = fs.constants;
  if (typeof O_DIRECTORY !== "number") {
    throw new EvidenceManifestError(`this platform cannot durably sync ${label}, so accepted evidence cannot be published`);
  }
  let flags = O_RDONLY | O_DIRECTORY;
  if (typeof O_CLOEXEC === "number") flags |= O_CLOEXEC;
  try {
    return fs.openSync(directoryPath, flags);
  } catch (error) {
    throw new EvidenceManifestError(`${label} could not be opened for durable sync: ${error?.message ?? error}`);
  }
}

function fsyncDescriptorSync(fd, label) {
  try {
    fs.fsyncSync(fd);
  } catch (error) {
    throw new EvidenceManifestError(`${label} could not be durably synced: ${error?.message ?? error}`);
  }
}

/**
 * Every directory sync opens its own descriptor and closes it again. Linux reports a writeback
 * error at most once per open file description, so a second `fsync` on a descriptor that already
 * reported one returns success without proving anything; a durability claim may never rest on that.
 */
function fsyncDirectoryPathSync(directoryPath, label) {
  const fd = openDirectoryForSync(directoryPath, label);
  try {
    fsyncDescriptorSync(fd, label);
  } finally {
    fs.closeSync(fd);
  }
}

function writeFileDurablySync(filePath, contents, label) {
  const { O_WRONLY, O_CREAT, O_EXCL, O_CLOEXEC } = fs.constants;
  let flags = O_WRONLY | O_CREAT | O_EXCL;
  if (typeof O_CLOEXEC === "number") flags |= O_CLOEXEC;
  let fd;
  try {
    fd = fs.openSync(filePath, flags, 0o600);
  } catch (error) {
    throw new EvidenceManifestError(`${label} could not be opened for durable write: ${error?.message ?? error}`);
  }
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } catch (error) {
    throw new EvidenceManifestError(`${label} could not be durably written: ${error?.message ?? error}`);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Length-prefixed record framing. A separator byte cannot be used here because file contents are
 * arbitrary bytes and may contain it: with `path \0 contents \0` concatenation, deleting a file and
 * re-embedding `\0<its path>\0<its bytes>` at the tail of the preceding sorted file reproduces the
 * exact same stream, so two different trees hash equal. A fixed-width byte length in front of every
 * record makes the encoding injective, so a fingerprint match means the trees really do match.
 */
function updateFramed(hash, bytes) {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function digestFile(hash, repoRoot, entry) {
  updateFramed(hash, Buffer.from(entry.relativePath.split(path.sep).join("/"), "utf8"));
  updateFramed(hash, readFingerprintedFile(repoRoot, entry.relativePath, { identity: entry }));
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
    stat = fs.lstatSync(absolute);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new EvidenceManifestError(
      `fingerprinted sources must not traverse symbolic links: ${relativePath}`,
    );
  }
  if (stat.isFile()) {
    assertContainedRealPath(repoRoot, relativePath);
    out.push({ relativePath, dev: stat.dev, ino: stat.ino, size: stat.size, ctimeMs: stat.ctimeMs });
    return;
  }
  if (!stat.isDirectory()) {
    throw new EvidenceManifestError(
      `fingerprinted sources must be ordinary files or directories: ${relativePath}`,
    );
  }
  for (const entry of fs.readdirSync(absolute).sort()) {
    if (FINGERPRINT_IGNORED_DIRECTORIES.has(entry)) continue;
    walkFiles(repoRoot, path.join(relativePath, entry), out);
  }
}

/**
 * Rejects a file whose fully resolved path lands outside the repository.
 *
 * `walkFiles` only `lstat`s the joined path, which follows every component before the last, so an
 * *intermediate* component of a multi-segment root (`experiments/quasar-escrow` in the root
 * `experiments/quasar-escrow/src`) can be a symlink out of the repository without the walk seeing
 * it. `realpathSync` is what catches that. It is not a race guarantee — the bytes are bound to the
 * opened descriptor in `readFingerprintedFile`, not to this path check.
 */
function assertContainedRealPath(repoRoot, relativePath) {
  const realRepoRoot = fs.realpathSync(repoRoot);
  let resolved;
  try {
    resolved = fs.realpathSync(path.join(repoRoot, relativePath));
  } catch {
    throw new EvidenceManifestError(`fingerprinted source could not be resolved: ${relativePath}`);
  }
  if (resolved !== realRepoRoot && !resolved.startsWith(`${realRepoRoot}${path.sep}`)) {
    throw new EvidenceManifestError(
      `fingerprinted sources must stay inside the repository: ${relativePath}`,
    );
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
  files.sort((left, right) => (left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0));
  const hash = crypto.createHash("sha256");
  updateFramed(hash, Buffer.from(LANE_SOURCE_FINGERPRINT_ALGORITHM, "utf8"));
  updateFramed(hash, Buffer.from(String(target), "utf8"));
  const fileCount = Buffer.alloc(8);
  fileCount.writeBigUInt64BE(BigInt(files.length));
  hash.update(fileCount);
  for (const file of files) digestFile(hash, repoRoot, file);
  return `${LANE_SOURCE_FINGERPRINT_ALGORITHM}:${hash.digest("hex")}`;
}

export class EvidenceManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvidenceManifestError";
  }
}

/**
 * Publication outcomes a caller may report. `not-published` and `rolled-back` both leave the
 * previous receipt as the only accepted evidence; `indeterminate` means the new receipt reached the
 * directory entry, could not be proven durable, and could not be rolled back, so nothing may be
 * reported about which receipt is on disk.
 */
export const EVIDENCE_PUBLICATION_NOT_PUBLISHED = "not-published";
export const EVIDENCE_PUBLICATION_ROLLED_BACK = "rolled-back";
export const EVIDENCE_PUBLICATION_INDETERMINATE = "indeterminate";

export class EvidencePublicationIndeterminateError extends EvidenceManifestError {
  constructor(message, options = {}) {
    super(message);
    this.name = "EvidencePublicationIndeterminateError";
    this.publicationOutcome = EVIDENCE_PUBLICATION_INDETERMINATE;
    this.cause = options.cause;
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
  if (!String(record.sourceFingerprint).startsWith(`${LANE_SOURCE_FINGERPRINT_ALGORITHM}:`)) {
    throw new EvidenceManifestError(
      `accepted evidence requires a ${LANE_SOURCE_FINGERPRINT_ALGORITHM} sourceFingerprint; ` +
      `got ${JSON.stringify(record.sourceFingerprint)}, which this publisher will not reinterpret`,
    );
  }
  if (!record?.repoRoot) {
    throw new EvidenceManifestError("accepted evidence requires repoRoot so artifact existence and containment can be verified");
  }
  for (const artifact of record.artifacts) {
    if (!artifact?.name) throw new EvidenceManifestError("every accepted artifact requires a name");
    assertContainedArtifactPath(record.manifestRelativeDir, artifact.path, { repoRoot: record.repoRoot });
  }
}

function lockOwnerRecordSync(lockDir) {
  try {
    const bytes = readFingerprintedFile(lockDir, ACCEPTED_EVIDENCE_LOCK_OWNER_FILENAME, {
      containmentRootRealPath: fs.realpathSync(lockDir),
      maxBytes: ACCEPTED_EVIDENCE_MAX_BYTES,
    });
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

function describeLockState(owner) {
  const state = owner?.state ?? "unknown";
  return owner?.detail ? `${state}: ${owner.detail}` : String(state);
}

function isReclaimableLockSync(lockDir, owner, nowMs) {
  if (owner?.state === EVIDENCE_LOCK_STATE_INDETERMINATE) return false;

  const startedAtMs = owner?.startedAt ? Date.parse(owner.startedAt) : Number.NaN;
  let ageMs;
  if (Number.isFinite(startedAtMs)) {
    ageMs = nowMs - startedAtMs;
  } else {
    try {
      ageMs = nowMs - fs.lstatSync(lockDir).mtimeMs;
    } catch {
      return false;
    }
  }
  if (!(ageMs > ACCEPTED_EVIDENCE_LOCK_STALE_MS)) return false;

  if (owner?.hostname && owner.hostname !== os.hostname()) return false;
  if (Number.isInteger(owner?.pid)) {
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      if (error?.code !== "ESRCH") return false;
    }
  }
  return true;
}

function moveAsideSync(fromPath, toPath, directoryPath, label) {
  let before;
  try {
    before = fs.lstatSync(fromPath);
  } catch (error) {
    throw new EvidenceManifestError(`${label} could not be inspected before it was moved aside: ${error?.message ?? error}`);
  }
  try {
    fs.renameSync(fromPath, toPath);
  } catch (error) {
    throw new EvidenceManifestError(`${label} could not be moved aside for diagnosis: ${error?.message ?? error}`);
  }
  fsyncDirectoryPathSync(directoryPath, "accepted evidence directory");

  let moved;
  try {
    moved = fs.lstatSync(toPath);
  } catch (error) {
    throw new EvidenceManifestError(`${label} could not be proven preserved at ${toPath}: ${error?.message ?? error}`);
  }
  // Renaming an entry keeps its inode but updates ctime, so identity here is device and inode only.
  if (moved.dev !== before.dev || moved.ino !== before.ino) {
    throw new EvidenceManifestError(`${label} at ${toPath} is not the entry that was moved aside`);
  }
  if (pathExistsSync(fromPath)) {
    throw new EvidenceManifestError(`${label} is still present at ${fromPath} after it was moved aside`);
  }
  return toPath;
}

function pathExistsSync(candidate) {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch {
    return false;
  }
}

function lockIdentitySync(lockDir, owner) {
  try {
    const stat = fs.lstatSync(lockDir);
    return { dev: stat.dev, ino: stat.ino, token: owner?.token ?? null };
  } catch {
    return null;
  }
}

function isSameLockIdentity(left, right) {
  if (!left || !right) return false;
  if (left.dev !== right.dev || left.ino !== right.ino) return false;
  return left.token === right.token;
}

/**
 * Move a lock judged stale aside, but only if the entry is still the exact one that was judged.
 * Another publisher may have reclaimed it in the meantime and be holding a live lock through a new
 * directory (a fresh inode, a fresh owner token); displacing that would put two writers inside the
 * read-modify-write the lock exists to serialize. Returns false when the entry changed, so the
 * caller falls back to waiting rather than racing.
 */
function reclaimStaleLockSync(manifestDir, lockDir, expected) {
  const quarantinePath = path.join(manifestDir, `${ACCEPTED_EVIDENCE_LOCK_DIRNAME}.stale-${crypto.randomUUID()}`);
  if (!isSameLockIdentity(lockIdentitySync(lockDir, lockOwnerRecordSync(lockDir)), expected)) return false;

  try {
    fs.renameSync(lockDir, quarantinePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw new EvidenceManifestError(`a stale accepted evidence publication lock could not be moved aside for diagnosis: ${error?.message ?? error}`);
  }

  const moved = lockIdentitySync(quarantinePath, lockOwnerRecordSync(quarantinePath));
  if (!isSameLockIdentity(moved, expected)) {
    try {
      fs.renameSync(quarantinePath, lockDir);
    } catch {
      // Reported below either way; the mismatch itself is what must not be acted on.
    }
    fsyncDirectoryPathSync(manifestDir, "accepted evidence directory");
    throw new EvidenceManifestError(
      `refusing to reclaim ${lockDir}: it changed between being judged stale and being moved aside, ` +
      `so a live publisher's lock may not be displaced`,
    );
  }
  fsyncDirectoryPathSync(manifestDir, "accepted evidence directory");
  return true;
}

/**
 * Take the single-writer publication lock, waiting boundedly for a live publisher to finish. A lock
 * older than the stale bound whose owner is provably gone is moved aside and retaken; a lock
 * recording an indeterminate publication is never taken, because the receipt it left behind is
 * exactly the state no automated writer may resolve.
 */
async function acquirePublicationLock(manifestDir, options = {}) {
  const lockDir = path.join(manifestDir, ACCEPTED_EVIDENCE_LOCK_DIRNAME);
  const waitMs = Number.isFinite(options.lockWaitMs) ? Math.max(0, options.lockWaitMs) : ACCEPTED_EVIDENCE_LOCK_WAIT_MS;
  const deadline = Date.now() + waitMs;
  let reclaimAttempts = 0;

  for (;;) {
    try {
      fs.mkdirSync(lockDir, 0o700);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw new EvidenceManifestError(`the accepted evidence publication lock could not be created: ${error?.message ?? error}`);
      }
      const owner = lockOwnerRecordSync(lockDir);
      if (owner?.state === EVIDENCE_LOCK_STATE_INDETERMINATE) {
        throw new EvidenceManifestError(
          `refusing to publish accepted evidence: ${lockDir} records an indeterminate publication ` +
          `(${describeLockState(owner)}); an operator must resolve the on-disk receipt state before this lane publishes again`,
        );
      }
      const judged = lockIdentitySync(lockDir, owner);
      if (
        reclaimAttempts < ACCEPTED_EVIDENCE_LOCK_RECLAIM_ATTEMPTS &&
        judged &&
        isReclaimableLockSync(lockDir, owner, Date.now())
      ) {
        reclaimAttempts += 1;
        if (reclaimStaleLockSync(manifestDir, lockDir, judged)) continue;
      }
      if (Date.now() >= deadline) {
        throw new EvidenceManifestError(
          `another accepted evidence publication holds ${lockDir} (${describeLockState(owner)}); refusing to publish concurrently`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, ACCEPTED_EVIDENCE_LOCK_POLL_MS));
    }
  }

  const lock = { lockDir, token: crypto.randomUUID() };
  try {
    writeLockOwnerSync(lock, EVIDENCE_LOCK_STATE_PUBLISHING);
    // Proving the containing directory can be opened and synced is also the publication preflight:
    // a directory that cannot be synced at all fails here, before any receipt is replaced.
    fsyncDirectoryPathSync(manifestDir, "accepted evidence directory");
  } catch (error) {
    await fsp.rm(lockDir, { recursive: true, force: true });
    throw error;
  }
  return lock;
}

function writeLockOwnerSync(lock, state, detail) {
  const owner = {
    token: lock.token,
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
    state,
    ...(detail ? { detail } : {}),
  };
  const ownerPath = path.join(lock.lockDir, ACCEPTED_EVIDENCE_LOCK_OWNER_FILENAME);
  const tempPath = path.join(lock.lockDir, `${ACCEPTED_EVIDENCE_LOCK_OWNER_FILENAME}.${crypto.randomUUID()}.tmp`);
  writeFileDurablySync(tempPath, `${JSON.stringify(owner, null, 2)}\n`, "accepted evidence publication lock owner record");
  fs.renameSync(tempPath, ownerPath);
  fsyncDirectoryPathSync(lock.lockDir, "accepted evidence publication lock");
}

async function releasePublicationLock(lock) {
  await fsp.rm(lock.lockDir, { recursive: true, force: true });
  try {
    fsyncDirectoryPathSync(path.dirname(lock.lockDir), "accepted evidence directory");
  } catch {
    // The outcome is already decided and durable; failing to sync the unlink cannot unmake it.
  }
}

/**
 * What is sitting at the receipt path right now: nothing, readable accepted evidence whose exact
 * bytes can be restored, or an entry no reader would ever accept (symlink, special file, oversized,
 * unreadable). The last kind is not evidence and is moved aside rather than left to block every
 * future passing run.
 */
function classifyPriorEntrySync(manifestDir) {
  const manifestPath = path.join(manifestDir, ACCEPTED_EVIDENCE_FILENAME);
  let existing;
  try {
    existing = fs.lstatSync(manifestPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { kind: "none" };
    return { kind: "unusable", reason: `it could not be inspected (${error?.message ?? error})` };
  }
  if (!existing.isFile()) {
    return { kind: "unusable", reason: "it is not an ordinary file" };
  }
  if (existing.size > ACCEPTED_EVIDENCE_MAX_BYTES) {
    return { kind: "unusable", reason: `it is ${existing.size} bytes, larger than the allowed ${ACCEPTED_EVIDENCE_MAX_BYTES} bytes` };
  }
  try {
    return {
      kind: "receipt",
      bytes: readFingerprintedFile(manifestDir, ACCEPTED_EVIDENCE_FILENAME, {
        containmentRootRealPath: fs.realpathSync(manifestDir),
        maxBytes: ACCEPTED_EVIDENCE_MAX_BYTES,
      }),
    };
  } catch (error) {
    return { kind: "unusable", reason: `it could not be read as accepted evidence (${error?.message ?? error})` };
  }
}

/**
 * Why the entry currently at the receipt path cannot be read as accepted evidence, or null when
 * there is nothing there or it is readable. A publisher moves such an entry aside, so a caller can
 * say so in the artifacts it writes *before* publication hashes them.
 */
export function describeUnusableAcceptedEntry(manifestDir) {
  const prior = classifyPriorEntrySync(manifestDir);
  return prior.kind === "unusable" ? prior.reason : null;
}

/**
 * Publish a per-target passing-evidence receipt, only after a run passes, under the single-writer
 * publication lock: the whole read-modify-write — classify or move aside the prior entry, snapshot
 * it, write and rename the new receipt, sync, and roll back — happens while this process holds the
 * lock, so a concurrent publisher can neither interleave with it nor undo a publication that
 * already succeeded, and a failed run can never displace previously accepted evidence.
 *
 * Publication succeeds only once the rename *and* the containing directory's fsync succeed. If that
 * sync fails after the rename, the snapshot is renamed back and the rollback is proven on a freshly
 * opened directory descriptor; the thrown error then carries `publicationOutcome: "rolled-back"`.
 * A failure before the rename carries `"not-published"`. If the rollback cannot be completed and
 * proven, the lock is left behind marked indeterminate and an `EvidencePublicationIndeterminateError`
 * is thrown: nothing is known about which receipt is on disk, so the caller must claim neither, and
 * every consumer refuses the receipt while that lock stands.
 */
export async function writeAcceptedEvidenceManifest(manifestDir, record, options = {}) {
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
      sha256: fileContentDigest(record.repoRoot, contained, {
        containmentRootRelativePath: record.manifestRelativeDir,
        containmentRootLabel: "evidence root",
      }),
    };
  });

  const manifest = {
    version: ACCEPTED_EVIDENCE_VERSION,
    status: "PASS",
    target: record.target,
    runId: record.runId,
    acceptedAt: record.acceptedAt ?? new Date().toISOString(),
    evidenceRoot: path.normalize(record.manifestRelativeDir).split(path.sep).join("/"),
    sourceFingerprintAlgorithm: LANE_SOURCE_FINGERPRINT_ALGORITHM,
    sourceFingerprint: record.sourceFingerprint,
    artifacts,
    provenance: { ...record.provenance },
  };
  const evidenceRootRelative = path.normalize(record.manifestRelativeDir).split(path.sep).join("/");
  await fsp.mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, ACCEPTED_EVIDENCE_FILENAME);
  const tempPath = path.join(manifestDir, `.${ACCEPTED_EVIDENCE_FILENAME}.${crypto.randomUUID()}.tmp`);
  const rollbackPath = path.join(manifestDir, `.${ACCEPTED_EVIDENCE_FILENAME}.${crypto.randomUUID()}.rollback`);

  const lock = await acquirePublicationLock(manifestDir, options);
  let rollbackPrepared = false;
  let renamed = false;
  let lockRetained = false;
  let quarantinedPriorEntry = null;
  const cleanupFailures = [];
  try {
    const prior = classifyPriorEntrySync(manifestDir);
    if (prior.kind === "unusable") {
      quarantinedPriorEntry = moveAsideSync(
        manifestPath,
        path.join(manifestDir, `.${ACCEPTED_EVIDENCE_FILENAME}.quarantined-${crypto.randomUUID()}`),
        manifestDir,
        `the unusable ${ACCEPTED_EVIDENCE_FILENAME} being replaced (${prior.reason})`,
      );
      manifest.quarantinedPriorEntry = {
        path: path.posix.join(evidenceRootRelative, path.basename(quarantinedPriorEntry)),
        reason: prior.reason,
      };
    } else if (prior.kind === "receipt") {
      writeFileDurablySync(rollbackPath, prior.bytes, "accepted evidence rollback copy");
      rollbackPrepared = true;
    }
    writeFileDurablySync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "accepted evidence temp receipt");
    fs.renameSync(tempPath, manifestPath);
    renamed = true;
    fsyncDirectoryPathSync(manifestDir, "accepted evidence directory");
  } catch (error) {
    if (!renamed) {
      error.publicationOutcome ??= EVIDENCE_PUBLICATION_NOT_PUBLISHED;
      throw error;
    }
    let restoredEntry = false;
    try {
      if (rollbackPrepared) fs.renameSync(rollbackPath, manifestPath);
      else fs.unlinkSync(manifestPath);
      restoredEntry = true;
      fsyncDirectoryPathSync(manifestDir, "accepted evidence directory");
    } catch (rollbackError) {
      if (!restoredEntry) rollbackPrepared = false; // keep the prior bytes on disk for the operator
      lockRetained = true;
      const detail =
        `${manifestPath} was renamed into place, could not be durably published (${error.message}), ` +
        `and the previous state could not be restored (${rollbackError.message})`;
      try {
        writeLockOwnerSync(lock, EVIDENCE_LOCK_STATE_INDETERMINATE, detail);
      } catch {
        // The lock directory itself is what makes consumers refuse; losing its detail cannot undo that.
      }
      throw new EvidencePublicationIndeterminateError(
        `accepted evidence publication is indeterminate: ${detail}; the receipt now on disk must not be ` +
        `cited as accepted evidence, and ${lock.lockDir} is retained so every consumer refuses it until an operator resolves it`,
        { cause: error },
      );
    }
    const restored = new EvidenceManifestError(
      `accepted evidence could not be durably published (${error.message}); ` +
      (rollbackPrepared
        ? "the previously accepted receipt was durably restored"
        : "no accepted receipt is published"),
    );
    restored.publicationOutcome = rollbackPrepared
      ? EVIDENCE_PUBLICATION_ROLLED_BACK
      : EVIDENCE_PUBLICATION_NOT_PUBLISHED;
    restored.cause = error;
    throw restored;
  } finally {
    // Cleanup runs after the outcome is already decided and durable, so a failure here may never
    // change that outcome — it is collected and reported alongside it instead.
    for (const [leftover, label] of [[tempPath, "temp receipt"], ...(rollbackPrepared ? [[rollbackPath, "rollback copy"]] : [])]) {
      try {
        await fsp.rm(leftover, { force: true });
      } catch (error) {
        cleanupFailures.push(`the ${label} at ${leftover} could not be removed: ${error?.message ?? error}`);
      }
    }
    if (!lockRetained) {
      try {
        await releasePublicationLock(lock);
      } catch (error) {
        lockRetained = true;
        cleanupFailures.push(`the publication lock at ${lock.lockDir} could not be released: ${error?.message ?? error}`);
      }
    }
  }
  return { manifestPath, manifest, quarantinedPriorEntry, cleanupFailures, lockRetained };
}

/**
 * Read a per-target passing-evidence receipt, validating target, PASS status, provenance, and that
 * every required artifact still exists. Throws EvidenceManifestError rather than returning stale or
 * failed evidence.
 *
 * The receipt itself is read under the same descriptor-bound contract as the evidence it cites: the
 * evidence root is resolved and checked for symlinked components first, the manifest is opened
 * without following a final-component symlink, the opened descriptor is re-resolved back inside that
 * root, and the bytes that are parsed are the bytes read from that same descriptor. A foreign or
 * swapped receipt is therefore refused before any of its fields are trusted.
 */
export function readAcceptedEvidenceManifest(repoRoot, manifestRelativeDir, { target, requiredArtifacts = [], maxAgeMs } = {}) {
  const effectiveMaxAgeMs = Number.isFinite(maxAgeMs)
    ? Math.min(maxAgeMs, ACCEPTED_EVIDENCE_MAX_AGE_MS)
    : ACCEPTED_EVIDENCE_MAX_AGE_MS;
  const manifestPath = path.join(repoRoot, manifestRelativeDir, ACCEPTED_EVIDENCE_FILENAME);
  const manifestRelativePath = path.join(path.normalize(manifestRelativeDir), ACCEPTED_EVIDENCE_FILENAME);

  const lockDir = path.join(repoRoot, manifestRelativeDir, ACCEPTED_EVIDENCE_LOCK_DIRNAME);
  if (pathExistsSync(lockDir)) {
    throw new EvidenceManifestError(
      `accepted evidence at ${manifestRelativeDir} is not citable while a publication lock stands ` +
      `(${describeLockState(lockOwnerRecordSync(lockDir))}); the receipt state is unproven until an operator resolves ` +
      `${path.join(path.normalize(manifestRelativeDir), ACCEPTED_EVIDENCE_LOCK_DIRNAME)}`,
    );
  }

  if (!fs.existsSync(manifestPath)) {
    throw new EvidenceManifestError(`no accepted evidence at ${manifestRelativePath}; run the lane to a PASS first`);
  }

  const evidenceRootRealPath = containmentRootRealPath(repoRoot, manifestRelativeDir, "evidence root");
  const manifestBytes = readFingerprintedFile(repoRoot, manifestRelativePath, {
    containmentRootRealPath: evidenceRootRealPath,
    maxBytes: ACCEPTED_EVIDENCE_MAX_BYTES,
  });

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
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

  if (manifest.sourceFingerprintAlgorithm !== LANE_SOURCE_FINGERPRINT_ALGORITHM) {
    throw new EvidenceManifestError(
      `accepted evidence at ${manifestRelativeDir} records source fingerprint algorithm ` +
      `${JSON.stringify(manifest.sourceFingerprintAlgorithm)}, which this reader does not accept ` +
      `(expected ${LANE_SOURCE_FINGERPRINT_ALGORITHM}); re-run the lane`,
    );
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
    const actualDigest = fileContentDigest(repoRoot, contained, {
      containmentRootRealPath: evidenceRootRealPath,
    });
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
