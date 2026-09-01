import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ACCEPTED_EVIDENCE_FILENAME,
  EvidenceManifestError,
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

async function seedRun(repoRoot, relativeDir, runId, { status = "PASS" } = {}) {
  const runDir = path.join(repoRoot, relativeDir, runId);
  await fsp.mkdir(runDir, { recursive: true });
  await fsp.writeFile(path.join(runDir, "SUMMARY.md"), `# Summary\n\n- Status: ${status}\n`);
  await fsp.writeFile(path.join(runDir, "smoke.log"), "log\n");
  return {
    target: "quasar",
    runId,
    status,
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
      records.push(await seedRun(repoRoot, dir, `sdk-legacy-anchor-run-${i}`));
    }

    await Promise.all(records.map((record) =>
      writeAcceptedEvidenceManifest(path.join(repoRoot, dir), { ...record, target: "legacy-anchor" })));

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
        manifestRelativeDir: dir,
        artifacts: [{ name: "summary", path: "../../secrets/id.json" }],
        provenance: { command: "npm run test:surfpool:quasar-critical" },
      }),
      EvidenceManifestError,
    );
    assert.equal(fs.existsSync(path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME)), false);
  });
});

test("a receipt older than the caller's freshness bound is refused as stale", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-legacy-anchor-old");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), {
      ...record,
      target: "legacy-anchor",
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
    const record = await seedRun(repoRoot, dir, "sdk-legacy-anchor-bad-date");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), { ...record, target: "legacy-anchor" });

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
