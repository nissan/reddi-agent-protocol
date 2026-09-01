import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ACCEPTED_EVIDENCE_FILENAME,
  ACCEPTED_EVIDENCE_MAX_AGE_MS,
  EvidenceManifestError,
  assertContainedArtifactPath,
  computeLaneSourceFingerprint,
  readAcceptedEvidenceManifest,
  writeAcceptedEvidenceManifest,
} from "../lib/surfpool-evidence-manifest.mjs";

import { createTruncatingEvidenceBuffer, scheduleProcessGroupTermination } from "../lib/surfpool-sdk-lifecycle.mjs";

async function withRepo(run) {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "rap-evidence-manifest-"));
  try {
    return await run(repoRoot);
  } finally {
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
}

// One representative file per fingerprint root the lanes actually build from, so a root that stops
// being fingerprinted is caught rather than silently ignored.
const FINGERPRINTED_BUILD_INPUTS = Object.freeze({
  quasar: Object.freeze({
    "packages/demo-agents/src/demo.ts": "export const version = 1;\n",
    "third_party/quasar/lang/src/lib.rs": "pub fn owner_check() {}\n",
    "Cargo.toml": '[workspace]\nmembers = ["programs/*"]\n\n[profile.release]\nlto = "fat"\n',
    "Cargo.lock": "version = 4\n",
    "experiments/quasar-escrow/src/lib.rs": 'declare_id!("stub");\n',
    "experiments/quasar-escrow/Cargo.toml": "[package]\nname = \"quasar-escrow\"\n",
    "experiments/quasar-escrow/Cargo.lock": "version = 4\n",
    "experiments/quasar-escrow-ref/src/lib.rs": "pub struct EscrowRef;\n",
    "experiments/quasar-escrow-ref/Cargo.toml": "[package]\nname = \"quasar-escrow-ref\"\n",
    "experiments/quasar-escrow-ref/Cargo.lock": "version = 4\n",
    "experiments/quasar-registry/src/lib.rs": 'declare_id!("stub");\n',
    "experiments/quasar-registry/Cargo.toml": "[package]\nname = \"quasar-registry\"\n",
    "experiments/quasar-registry/Cargo.lock": "version = 4\n",
    "experiments/quasar-reputation/src/lib.rs": 'declare_id!("stub");\n',
    "experiments/quasar-reputation/Cargo.toml": "[package]\nname = \"quasar-reputation\"\n",
    "experiments/quasar-reputation/Cargo.lock": "version = 4\n",
    "experiments/quasar-attestation/src/lib.rs": 'declare_id!("stub");\n',
    "experiments/quasar-attestation/Cargo.toml": "[package]\nname = \"quasar-attestation\"\n",
    "experiments/quasar-attestation/Cargo.lock": "version = 4\n",
    "scripts/lib/surfpool-sdk-lifecycle.mjs": "export const sdk = true;\n",
    "scripts/lib/surfpool-evidence-manifest.mjs": "export const receipt = true;\n",
    "scripts/run-surfpool-sdk-critical-smoke.mjs": "console.log('run');\n",
    "scripts/resolve-accepted-surfpool-evidence.mjs": "console.log('resolve');\n",
    "package.json": "{\"scripts\":{}}\n",
    "package-lock.json": "{\"lockfileVersion\":3}\n",
    "config/quasar/deployments.json": "{}\n",
    "config/toolchain/solana-baseline-assets.json": "{}\n",
    "rust-toolchain.toml": '[toolchain]\nchannel = "1.89.0"\n',
    "docs/SOLANA-TOOLCHAIN-BASELINE.md": "# baseline\n",
  }),
  "legacy-anchor": Object.freeze({
    "packages/demo-agents/src/demo.ts": "export const version = 1;\n",
    "programs/escrow/src/lib.rs": "fn main() {}\n",
    "programs/escrow/Cargo.toml": "[package]\nname = \"escrow\"\n",
    "Cargo.toml": '[workspace]\nmembers = ["programs/*"]\n\n[profile.release]\nlto = "fat"\n',
    "Cargo.lock": "version = 4\n",
    "scripts/lib/surfpool-sdk-lifecycle.mjs": "export const sdk = true;\n",
    "scripts/lib/surfpool-evidence-manifest.mjs": "export const receipt = true;\n",
    "scripts/run-surfpool-sdk-critical-smoke.mjs": "console.log('run');\n",
    "scripts/resolve-accepted-surfpool-evidence.mjs": "console.log('resolve');\n",
    "package.json": "{\"scripts\":{}}\n",
    "package-lock.json": "{\"lockfileVersion\":3}\n",
    "config/toolchain/solana-baseline-assets.json": "{}\n",
    "rust-toolchain.toml": '[toolchain]\nchannel = "1.89.0"\n',
    "docs/SOLANA-TOOLCHAIN-BASELINE.md": "# baseline\n",
  }),
});

async function writeRepoFile(repoRoot, relativePath, body) {
  const absolute = path.join(repoRoot, relativePath);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, body);
}

async function seedFingerprintSources(repoRoot, target = "quasar") {
  for (const [relativePath, body] of Object.entries(FINGERPRINTED_BUILD_INPUTS[target])) {
    await writeRepoFile(repoRoot, relativePath, body);
  }
}

async function seedRun(repoRoot, relativeDir, runId, { status = "PASS", target = "quasar" } = {}) {
  await seedFingerprintSources(repoRoot, target);
  const runDir = path.join(repoRoot, relativeDir, runId);
  await fsp.mkdir(runDir, { recursive: true });
  await fsp.writeFile(path.join(runDir, "SUMMARY.md"), `# Summary\n\n- Status: ${status}\n`);
  await fsp.writeFile(path.join(runDir, "smoke.log"), "log\n");
  return {
    target,
    runId,
    status,
    repoRoot,
    manifestRelativeDir: relativeDir,
    sourceFingerprint: computeLaneSourceFingerprint(repoRoot, target),
    artifacts: [
      { name: "summary", path: path.join(relativeDir, runId, "SUMMARY.md") },
      { name: "log", path: path.join(relativeDir, runId, "smoke.log") },
    ],
    provenance: { command: "npm run test:surfpool:quasar-critical" },
  };
}

test("a later failing run never displaces already-accepted passing evidence", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    // UUID run ids are deliberately non-chronological: the failing run sorts last lexically.
    const passing = await seedRun(repoRoot, dir, "sdk-quasar-3b1e0000-0000-4000-8000-000000000000");
    const failing = await seedRun(repoRoot, dir, "sdk-quasar-f3af0000-0000-4000-8000-000000000000", { status: "FAIL" });

    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), passing);

    await assert.rejects(
      writeAcceptedEvidenceManifest(path.join(repoRoot, dir), { ...failing, status: "FAIL" }),
      EvidenceManifestError,
    );

    const { manifest, artifacts } = readAcceptedEvidenceManifest(repoRoot, dir, {
      target: "quasar",
      requiredArtifacts: ["summary", "log"],
    });
    assert.equal(manifest.runId, passing.runId);
    assert.equal(manifest.status, "PASS");
    assert.match(fs.readFileSync(path.join(repoRoot, artifacts.summary), "utf8"), /Status: PASS/);
    assert.ok(fs.existsSync(path.join(repoRoot, dir, failing.runId, "SUMMARY.md")), "failed runs stay retained on disk");
  });
});

test("concurrent publishes leave exactly one complete, parseable receipt", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-smoke";
    const records = [];
    for (let i = 0; i < 12; i += 1) {
      records.push(await seedRun(repoRoot, dir, `sdk-legacy-anchor-run-${i}`, { target: "legacy-anchor" }));
    }

    await Promise.all(records.map((record) =>
      writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record)));

    const { manifest } = readAcceptedEvidenceManifest(repoRoot, dir, {
      target: "legacy-anchor",
      requiredArtifacts: ["summary", "log"],
    });
    assert.ok(records.some((record) => record.runId === manifest.runId));

    const leftovers = fs.readdirSync(path.join(repoRoot, dir)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, [], "atomic publish must not leave temp files behind");
  });
});

test("reading refuses a receipt for the wrong target, a missing artifact, or no receipt at all", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary"] }),
      /no accepted evidence/,
    );

    const record = await seedRun(repoRoot, dir, "sdk-quasar-aaaa0000-0000-4000-8000-000000000000");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "legacy-anchor", requiredArtifacts: ["summary"] }),
      /is for target "quasar", expected "legacy-anchor"/,
    );

    await fsp.rm(path.join(repoRoot, dir, record.runId, "smoke.log"));
    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }),
      /cites a missing log artifact/,
    );
  });
});

test("a hand-edited FAIL receipt is rejected rather than cited as proof", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-bbbb0000-0000-4000-8000-000000000000");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
    const tampered = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    tampered.status = "FAIL";
    fs.writeFileSync(manifestPath, JSON.stringify(tampered));

    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary"] }),
      /only PASS runs may be cited/,
    );
  });
});

test("publishing requires provenance and at least one artifact", async () => {
  await withRepo(async (repoRoot) => {
    const dir = path.join(repoRoot, "artifacts/surfpool-smoke");
    await assert.rejects(
      writeAcceptedEvidenceManifest(dir, { target: "quasar", runId: "r", status: "PASS", artifacts: [], provenance: { command: "x" } }),
      /at least one artifact/,
    );
    await assert.rejects(
      writeAcceptedEvidenceManifest(dir, { target: "quasar", runId: "r", status: "PASS", artifacts: [{ name: "summary", path: "p" }] }),
      /provenance.command/,
    );
    await assert.rejects(
      writeAcceptedEvidenceManifest(dir, {
        target: "quasar", runId: "r", status: "PASS",
        artifacts: [{ name: "summary", path: "artifacts/surfpool-smoke/r/SUMMARY.md" }],
        provenance: { command: "x" },
      }),
      /explicit manifestRelativeDir/,
    );
    await assert.rejects(
      writeAcceptedEvidenceManifest(dir, {
        target: "quasar", runId: "r", status: "PASS", manifestRelativeDir: "artifacts/surfpool-smoke",
        artifacts: [{ name: "summary", path: "artifacts/surfpool-smoke/r/SUMMARY.md" }],
        provenance: { command: "x" },
      }),
      /sourceFingerprint/,
    );
    assert.equal(fs.existsSync(path.join(dir, ACCEPTED_EVIDENCE_FILENAME)), false);
  });
});

test("evidence buffer keeps the head, keeps the tail, and reports what it dropped", () => {
  const buffer = createTruncatingEvidenceBuffer({
    headLimit: 40,
    tailLimit: 40,
    describeOmission: (chars, count) => `<<omitted ${chars} chars in ${count} chunks>>`,
  });

  buffer.push("Target:   quasar\n");
  for (let i = 0; i < 20; i += 1) buffer.push(`filler-line-${String(i).padStart(3, "0")}\n`);
  buffer.push("Full A→B→C cycle complete\n");

  const text = buffer.text();
  assert.match(text, /^Target:   quasar\n/, "the front must never be silently dropped");
  assert.match(text, /Full A→B→C cycle complete\n$/, "the tail must be retained");
  assert.ok(buffer.omittedChunks > 0);
  assert.match(text, new RegExp(`<<omitted ${buffer.omittedChars} chars in ${buffer.omittedChunks} chunks>>`));
  assert.equal(text.includes("filler-line-010"), false, "the dropped middle is accounted for, not present");
});

test("evidence buffer is a verbatim passthrough when nothing is dropped", () => {
  const buffer = createTruncatingEvidenceBuffer({ headLimit: 1_000, tailLimit: 1_000 });
  buffer.push("alpha\n");
  buffer.push("beta\n");
  assert.equal(buffer.text(), "alpha\nbeta\n");
  assert.equal(buffer.omittedChunks, 0);
  assert.equal(buffer.omittedChars, 0);
});

test("a receipt citing a path outside its evidence directory is refused", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-cccc");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
    await fsp.mkdir(path.join(repoRoot, "secrets"), { recursive: true });
    await fsp.writeFile(path.join(repoRoot, "secrets", "id.json"), "[1,2,3]\n");

    for (const escape of ["../../secrets/id.json", "/etc/passwd", "artifacts/surfpool-smoke/other/SUMMARY.md"]) {
      const tampered = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      tampered.artifacts = [{ name: "summary", path: escape }, { name: "log", path: `${dir}/sdk-quasar-cccc/smoke.log` }];
      fs.writeFileSync(manifestPath, JSON.stringify(tampered));
      assert.throws(
        () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }),
        (error) => {
          assert.ok(error instanceof EvidenceManifestError, `expected refusal for ${escape}`);
          assert.match(error.message, /repository-relative|escape|must live under/);
          return true;
        },
        `expected ${escape} to be refused`,
      );
    }
  });
});

test("publishing refuses an artifact path that escapes the target evidence directory", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    await assert.rejects(
      writeAcceptedEvidenceManifest(path.join(repoRoot, dir), {
        target: "quasar",
        runId: "sdk-quasar-escape",
        status: "PASS",
        repoRoot,
        manifestRelativeDir: dir,
        sourceFingerprint: "sha256:whatever",
        artifacts: [{ name: "summary", path: "../../secrets/id.json" }],
        provenance: { command: "npm run test:surfpool:quasar-critical" },
      }),
      /must not escape|must live under/,
    );
    assert.equal(fs.existsSync(path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME)), false);
  });
});

test("publishing refuses an absolute artifact path and one under a sibling evidence root", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const base = {
      target: "quasar",
      runId: "sdk-quasar-escape",
      status: "PASS",
      repoRoot,
      manifestRelativeDir: dir,
      sourceFingerprint: "sha256:whatever",
      provenance: { command: "npm run test:surfpool:quasar-critical" },
    };

    for (const escape of ["/etc/passwd", "artifacts/surfpool-smoke/other/SUMMARY.md", "artifacts/surfpool-quasar-smoke-evil/x/SUMMARY.md"]) {
      await assert.rejects(
        writeAcceptedEvidenceManifest(path.join(repoRoot, dir), { ...base, artifacts: [{ name: "summary", path: escape }] }),
        /repository-relative|must not escape|must live under/,
        `${escape} must be refused at publish time`,
      );
    }
    assert.equal(fs.existsSync(path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME)), false);
  });
});

test("a receipt older than the caller's freshness bound is refused as stale", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-legacy-anchor-old", { target: "legacy-anchor" });
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), {
      ...record,
      acceptedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    });

    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "legacy-anchor", requiredArtifacts: ["summary"], maxAgeMs: 60 * 60 * 1000 }),
      /is stale/,
    );
    assert.doesNotThrow(() =>
      readAcceptedEvidenceManifest(repoRoot, dir, { target: "legacy-anchor", requiredArtifacts: ["summary"] }));
  });
});

test("a receipt with an unparseable acceptedAt is refused", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-legacy-anchor-bad-date", { target: "legacy-anchor" });
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
    const tampered = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    tampered.acceptedAt = "whenever";
    fs.writeFileSync(manifestPath, JSON.stringify(tampered));

    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "legacy-anchor", requiredArtifacts: ["summary"] }),
      /unparseable acceptedAt/,
    );
  });
});

test("a cancelled termination never escalates to SIGKILL on a recycled pid", async () => {
  const signalled = [];
  const child = { pid: 4242, kill: () => {} };
  const escalation = scheduleProcessGroupTermination(child, "SIGTERM", {
    killDelayMs: 20,
    kill: (pid, sig) => signalled.push([pid, sig]),
  });

  assert.deepEqual(signalled, [[-4242, "SIGTERM"]], "the group is signalled immediately");
  escalation.cancel();
  assert.equal(escalation.cancelled, true);

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(signalled, [[-4242, "SIGTERM"]], "no SIGKILL may land after the child has exited");
});

test("an uncancelled termination does escalate to SIGKILL for the same process group", async () => {
  const signalled = [];
  const child = { pid: 4243, kill: () => {} };
  scheduleProcessGroupTermination(child, "SIGTERM", {
    killDelayMs: 20,
    kill: (pid, sig) => signalled.push([pid, sig]),
  });

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(signalled, [[-4243, "SIGTERM"], [-4243, "SIGKILL"]]);
});

test("terminating a child with no pid is a no-op rather than signalling the whole group", () => {
  const signalled = [];
  const escalation = scheduleProcessGroupTermination({ pid: undefined }, "SIGTERM", {
    killDelayMs: 5,
    kill: (pid, sig) => signalled.push([pid, sig]),
  });
  assert.deepEqual(signalled, [], "a missing pid must never become kill(-0) / kill(NaN)");
  escalation.cancel();
});

test("a source change after publication invalidates the receipt", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-fingerprint");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    assert.doesNotThrow(() =>
      readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }));

    await fsp.writeFile(path.join(repoRoot, "packages/demo-agents/src", "demo.ts"), "export const version = 2;\n");

    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }),
      /produced from different sources than the working tree/,
    );
  });
});

test("fingerprints ignore generated cache directories while preserving tracked source sensitivity", async () => {
  await withRepo(async (repoRoot) => {
    await seedFingerprintSources(repoRoot, "quasar");
    const before = computeLaneSourceFingerprint(repoRoot, "quasar");

    await writeRepoFile(repoRoot, "third_party/quasar/target/release/build/generated.rs", "generated cache\n");
    await writeRepoFile(repoRoot, "third_party/quasar/node_modules/package/index.js", "vendored cache\n");
    await writeRepoFile(repoRoot, "third_party/quasar/.git/objects/aa/bb", "git object\n");

    assert.equal(
      computeLaneSourceFingerprint(repoRoot, "quasar"),
      before,
      "generated/heavy cache directories under a fingerprinted root must not affect receipts",
    );

    await writeRepoFile(repoRoot, "third_party/quasar/lang/src/lib.rs", "pub fn owner_check() { panic!(); }\n");
    assert.notEqual(
      computeLaneSourceFingerprint(repoRoot, "quasar"),
      before,
      "tracked framework source under the same root must still affect receipts",
    );
  });
});

test("the repository-owned freshness bound cannot be widened or disabled by a caller", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-too-old");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), {
      ...record,
      acceptedAt: new Date(Date.now() - ACCEPTED_EVIDENCE_MAX_AGE_MS - 60_000).toISOString(),
    });

    for (const attemptedBypass of [undefined, Number.POSITIVE_INFINITY, ACCEPTED_EVIDENCE_MAX_AGE_MS * 100]) {
      assert.throws(
        () => readAcceptedEvidenceManifest(repoRoot, dir, {
          target: "quasar", requiredArtifacts: ["summary"], maxAgeMs: attemptedBypass,
        }),
        /is stale/,
        `maxAgeMs=${String(attemptedBypass)} must not widen the repository bound`,
      );
    }
  });
});

test("a receipt published for a different evidence root is refused", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-rootmix");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
    const tampered = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    tampered.evidenceRoot = "artifacts/surfpool-smoke";
    fs.writeFileSync(manifestPath, JSON.stringify(tampered));

    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary"] }),
      /published for evidence root/,
    );
  });
});

test("an artifact reachable only through a symlink out of the evidence root is refused", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-symlink");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    await fsp.mkdir(path.join(repoRoot, "secrets"), { recursive: true });
    await fsp.writeFile(path.join(repoRoot, "secrets", "SUMMARY.md"), "- Status: PASS\n");
    await fsp.symlink(path.join(repoRoot, "secrets"), path.join(repoRoot, dir, "escaped"), "dir");

    const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
    const tampered = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    tampered.artifacts = [{ name: "summary", path: `${dir}/escaped/SUMMARY.md` }];
    fs.writeFileSync(manifestPath, JSON.stringify(tampered));

    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary"] }),
      /through a symlink/,
    );
  });
});

test("publishing refuses to cite an artifact that does not exist yet", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const passing = await seedRun(repoRoot, dir, "sdk-quasar-good");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), passing);

    // A later run that publishes before writing its SUMMARY must not displace the accepted receipt.
    await fsp.mkdir(path.join(repoRoot, dir, "sdk-quasar-nosummary"), { recursive: true });
    await assert.rejects(
      writeAcceptedEvidenceManifest(path.join(repoRoot, dir), {
        target: "quasar",
        runId: "sdk-quasar-nosummary",
        status: "PASS",
        repoRoot,
        manifestRelativeDir: dir,
        sourceFingerprint: computeLaneSourceFingerprint(repoRoot, "quasar"),
        artifacts: [{ name: "summary", path: `${dir}/sdk-quasar-nosummary/SUMMARY.md` }],
        provenance: { command: "npm run test:surfpool:quasar-critical" },
      }),
      /citing a missing summary artifact/,
    );

    const { manifest } = readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary"] });
    assert.equal(manifest.runId, "sdk-quasar-good", "the previously accepted receipt must survive");
  });
});

test("publishing without repoRoot is refused so containment checks can never be skipped", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-norepo");
    const { repoRoot: _omitted, ...withoutRepoRoot } = record;

    await assert.rejects(
      writeAcceptedEvidenceManifest(path.join(repoRoot, dir), withoutRepoRoot),
      /requires repoRoot/,
    );
    assert.equal(fs.existsSync(path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME)), false);
  });
});

test("containment validation refuses to run without a repoRoot to resolve against", () => {
  assert.throws(
    () => assertContainedArtifactPath("artifacts/surfpool-smoke", "artifacts/surfpool-smoke/r/SUMMARY.md"),
    /repoRoot is required to validate artifact containment/,
  );
});

for (const [target, inputs] of Object.entries(FINGERPRINTED_BUILD_INPUTS)) {
  for (const relativePath of Object.keys(inputs)) {
    test(`editing ${relativePath} invalidates an accepted ${target} receipt`, async () => {
      await withRepo(async (repoRoot) => {
        const dir = target === "quasar" ? "artifacts/surfpool-quasar-smoke" : "artifacts/surfpool-smoke";
        const record = await seedRun(repoRoot, dir, `sdk-${target}-fingerprint-root`, { target });
        await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

        // Baseline: the receipt is accepted against the sources that produced it.
        assert.doesNotThrow(() =>
          readAcceptedEvidenceManifest(repoRoot, dir, { target, requiredArtifacts: ["summary", "log"] }));

        // Every one of these files is a real build input: changing it changes the binaries the lane
        // would now produce, so the prior receipt must stop being citable.
        await writeRepoFile(repoRoot, relativePath, `${inputs[relativePath]}// changed\n`);

        assert.throws(
          () => readAcceptedEvidenceManifest(repoRoot, dir, { target, requiredArtifacts: ["summary", "log"] }),
          /produced from different sources than the working tree/,
          `${relativePath} must be inside the ${target} fingerprint`,
        );
      });
    });
  }
}
