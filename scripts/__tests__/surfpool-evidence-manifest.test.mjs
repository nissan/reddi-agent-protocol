import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { spawnSync } from "node:child_process";

import {
  ACCEPTED_EVIDENCE_FILENAME,
  ACCEPTED_EVIDENCE_MAX_AGE_MS,
  ACCEPTED_EVIDENCE_MAX_BYTES,
  EvidenceManifestError,
  assertContainedArtifactPath,
  computeLaneSourceFingerprint,
  readAcceptedEvidenceManifest,
  writeAcceptedEvidenceManifest,
} from "../lib/surfpool-evidence-manifest.mjs";

import { createTruncatingEvidenceBuffer, scheduleProcessGroupTermination } from "../lib/surfpool-sdk-lifecycle.mjs";

const realRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The synthetic repo mirrors the repository's own compatibility inventory, so a demo-critical path
// the inventory forgets to declare is not silently fingerprinted by this suite either.
const REAL_DEMO_CRITICAL_PATHS = Object.freeze(
  JSON.parse(fs.readFileSync(path.join(realRepoRoot, "config/quasar/runtime-compatibility.json"), "utf8"))
    .demoCriticalPaths.map((entry) => entry.path),
);

// The modules that own a Quasar refusal: the onboarding paths that must refuse without a verified
// lock-created escrow, and the loopback predicate that decides whether the local-surfpool Quasar
// target resolves at all. Editing any of them must invalidate accepted Quasar evidence, otherwise a
// receipt keeps vouching for a refusal that no longer exists. Which mechanism binds a module — a
// fingerprint root or the compatibility inventory — is deliberately not asserted here; only that
// something does.
const QUASAR_REFUSAL_OWNING_MODULES = Object.freeze([
  "lib/onboarding/quasar-escrow-binding.ts",
  "lib/onboarding/attestation-resolution.ts",
  "lib/onboarding/reputation-signal.ts",
  "lib/onboarding/onchain-attestation.ts",
  "lib/config/loopback-endpoint.ts",
  "app/onboarding/page.tsx",
]);

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
    "packages/demo-agents/package.json": '{"name":"demo-agents"}\n',
    "packages/demo-agents/package-lock.json": '{"lockfileVersion":3}\n',
    "packages/demo-agents/tsconfig.json": '{"compilerOptions":{"module":"NodeNext"}}\n',
    "packages/agent-protocol/src/index.ts": "export const protocol = true;\n",
    "packages/agent-protocol/package.json": '{"name":"agent-protocol"}\n',
    "packages/agent-protocol/package-lock.json": '{"lockfileVersion":3}\n',
    "packages/agent-protocol/tsconfig.json": '{"compilerOptions":{"module":"NodeNext"}}\n',
    "packages/per-client/src/index.ts": "export const per = true;\n",
    "packages/per-client/package.json": '{"name":"per-client"}\n',
    "packages/per-client/package-lock.json": '{"lockfileVersion":3}\n',
    "packages/per-client/tsconfig.json": '{"compilerOptions":{"module":"NodeNext"}}\n',
    "lib/config/network.ts": "export const profile = 'local-surfpool';\n",
    "lib/program.ts": "export const PROGRAM_TARGET = 'quasar';\n",
    "lib/register/registration-instruction.ts": "export const register = true;\n",
    "app/register/page.tsx": "export default function Register() { return null; }\n",
    "app/onboarding/page.tsx": "export default function Onboarding() { return null; }\n",
    "lib/onboarding/attestation-instruction.ts": "export const attest = true;\n",
    "lib/onboarding/onchain-attestation.ts": "export const onchainAttest = true;\n",
    "lib/onboarding/reputation-signal.ts": "export const reputation = true;\n",
    "lib/registry/bridge.ts": "export const bridge = true;\n",
    "lib/useOnchainAgents.ts": "export const useOnchainAgents = true;\n",
    "lib/quasar/instruction-builders.ts": "export const quasarData = true;\n",
    "lib/quasar/instructions.ts": "export const quasarInstructions = true;\n",
    "packages/demo-agents/src/registration-instruction.ts": "export const demoRegisterIx = true;\n",
    "packages/demo-agents/src/register-agents.ts": "export const demoRegister = true;\n",
    "third_party/quasar/lang/src/lib.rs": "pub fn owner_check() {}\n",
    ".mise.toml": '[tools]\nnode = "24.20.0"\n',
    "Anchor.toml": '[toolchain]\nanchor_version = "1.1.2"\n',
    "Cargo.toml": '[workspace]\nmembers = ["programs/*"]\n\n[profile.release]\nlto = "fat"\n',
    "Cargo.lock": "version = 4\n",
    "programs/escrow/Cargo.toml": '[package]\nname = "escrow"\n[dependencies]\nanchor-lang = { version = "1.1.2" }\n',
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
    "scripts/run-surfpool-critical-smoke.sh": "#!/usr/bin/env bash\nnode scripts/run-surfpool-sdk-critical-smoke.mjs --target legacy-anchor\n",
    "scripts/run-surfpool-quasar-critical-smoke.sh": "#!/usr/bin/env bash\nnode scripts/run-surfpool-sdk-critical-smoke.mjs --target quasar\n",
    "scripts/run-surfpool-sdk-critical-smoke.mjs": "console.log('run');\n",
    "scripts/resolve-accepted-surfpool-evidence.mjs": "console.log('resolve');\n",
    "scripts/check-solana-baseline-pins.mjs": "console.log('pins');\n",
    "scripts/solana-baseline-toolchain.sh": "#!/usr/bin/env bash\necho node=24.20.0\n",
    "scripts/lib/solana-baseline-version-match.sh": "#!/usr/bin/env bash\nexit 0\n",
    "scripts/check-quasar-boundary-guard.mjs": "console.log('boundary');\n",
    "scripts/check-quasar-critical-success.mjs": "console.log('critical');\n",
    "scripts/check-quasar-demo-readiness.mjs": "console.log('readiness');\n",
    "scripts/check-quasar-deployment-inventory.mjs": "console.log('inventory');\n",
    "scripts/check-quasar-per-abi.mjs": "console.log('per');\n",
    "scripts/check-quasar-runtime-compatibility.mjs": "console.log('compat');\n",
    "package.json": "{\"scripts\":{}}\n",
    "package-lock.json": "{\"lockfileVersion\":3}\n",
    "config/quasar/deployments.json": "{}\n",
    "config/quasar/deployments.schema.json": "{}\n",
    "config/quasar/runtime-compatibility.json": JSON.stringify({
      demoCriticalPaths: REAL_DEMO_CRITICAL_PATHS.map((path) => ({ path })),
    }, null, 2),
    "config/quasar/runtime-compatibility.schema.json": "{}\n",
    "config/networks/devnet.json": "{}\n",
    "config/networks/local-surfpool.json": "{}\n",
    "config/networks/mainnet.json": "{}\n",
    "config/toolchain/solana-baseline-assets.json": "{}\n",
    "rust-toolchain.toml": '[toolchain]\nchannel = "1.89.0"\n',
    "docs/SOLANA-TOOLCHAIN-BASELINE.md": "# baseline\n",
    "docs/ECONOMIC-DEMO-JUDGE-PACKET-2026-05-05.md": "# judge packet\nQuasar-deployed Solana programs\nlegacy Anchor\napproval-gated blocker\n",
    "docs/ECONOMIC-DEMO-OPERATOR-CHECKLIST-2026-05-05.md": "# operator checklist\nQuasar-deployed Solana programs\nlegacy Anchor\napproval-gated blocker\n",
    "docs/QUASAR-HACKATHON-CUTOVER-PLAN-2026-05-05.md": "# cutover\nQuasar-deployed Solana programs\nlegacy Anchor\napproval-gated blocker\n",
    ".github/workflows/anchor-program-tests.yml": "name: anchor\n",
    ".github/workflows/quasar-program-tests.yml": "name: quasar\n",
    ".github/workflows/surfpool-acceptance-manual.yml": "name: manual\n",
    ".github/workflows/surfpool-quasar-critical-sdk.yml": "name: quasar sdk\n",
  }),
  "legacy-anchor": Object.freeze({
    "packages/demo-agents/src/demo.ts": "export const version = 1;\n",
    "packages/demo-agents/package.json": '{"name":"demo-agents"}\n',
    "packages/demo-agents/package-lock.json": '{"lockfileVersion":3}\n',
    "packages/demo-agents/tsconfig.json": '{"compilerOptions":{"module":"NodeNext"}}\n',
    "lib/config/network.ts": "export const profile = 'local-surfpool';\n",
    "programs/escrow/src/lib.rs": "fn main() {}\n",
    "programs/escrow/Cargo.toml": "[package]\nname = \"escrow\"\n",
    ".mise.toml": '[tools]\nnode = "24.20.0"\n',
    "Anchor.toml": '[toolchain]\nanchor_version = "1.1.2"\n',
    "Cargo.toml": '[workspace]\nmembers = ["programs/*"]\n\n[profile.release]\nlto = "fat"\n',
    "Cargo.lock": "version = 4\n",
    "scripts/lib/surfpool-sdk-lifecycle.mjs": "export const sdk = true;\n",
    "scripts/lib/surfpool-evidence-manifest.mjs": "export const receipt = true;\n",
    "scripts/run-surfpool-critical-smoke.sh": "#!/usr/bin/env bash\nnode scripts/run-surfpool-sdk-critical-smoke.mjs --target legacy-anchor\n",
    "scripts/run-surfpool-sdk-critical-smoke.mjs": "console.log('run');\n",
    "scripts/resolve-accepted-surfpool-evidence.mjs": "console.log('resolve');\n",
    "scripts/check-solana-baseline-pins.mjs": "console.log('pins');\n",
    "scripts/solana-baseline-toolchain.sh": "#!/usr/bin/env bash\necho node=24.20.0\n",
    "scripts/lib/solana-baseline-version-match.sh": "#!/usr/bin/env bash\nexit 0\n",
    "package.json": "{\"scripts\":{}}\n",
    "package-lock.json": "{\"lockfileVersion\":3}\n",
    "config/networks/devnet.json": "{}\n",
    "config/networks/local-surfpool.json": "{}\n",
    "config/networks/mainnet.json": "{}\n",
    "config/toolchain/solana-baseline-assets.json": "{}\n",
    "rust-toolchain.toml": '[toolchain]\nchannel = "1.89.0"\n',
    "docs/SOLANA-TOOLCHAIN-BASELINE.md": "# baseline\n",
    ".github/workflows/anchor-program-tests.yml": "name: anchor\n",
    ".github/workflows/quasar-program-tests.yml": "name: quasar\n",
    ".github/workflows/surfpool-acceptance-manual.yml": "name: manual\n",
    ".github/workflows/surfpool-quasar-critical-sdk.yml": "name: quasar sdk\n",
  }),
});

function withoutKey(record, key) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

async function writeRepoFile(repoRoot, relativePath, body) {
  const absolute = path.join(repoRoot, relativePath);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, body);
}

async function seedFingerprintSources(repoRoot, target = "quasar") {
  for (const [relativePath, body] of Object.entries(FINGERPRINTED_BUILD_INPUTS[target])) {
    await writeRepoFile(repoRoot, relativePath, body);
  }
  if (target !== "quasar") return;
  for (const relativePath of [...REAL_DEMO_CRITICAL_PATHS, ...QUASAR_REFUSAL_OWNING_MODULES]) {
    if (relativePath in FINGERPRINTED_BUILD_INPUTS.quasar) continue;
    await writeRepoFile(repoRoot, relativePath, `export const declared = ${JSON.stringify(relativePath)};\n`);
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

test("a future-dated receipt is refused", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-legacy-anchor-future-date", { target: "legacy-anchor" });
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
    const tampered = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    tampered.acceptedAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fs.writeFileSync(manifestPath, JSON.stringify(tampered));

    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "legacy-anchor", requiredArtifacts: ["summary"] }),
      /future-dated/,
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

test("a source change before publication refuses the receipt instead of accepting untested sources", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-pre-publish-fingerprint");
    const preRunFingerprint = record.sourceFingerprint;

    await fsp.writeFile(path.join(repoRoot, "packages/demo-agents/src", "demo.ts"), "export const version = 2;\n");

    await assert.rejects(
      writeAcceptedEvidenceManifest(path.join(repoRoot, dir), { ...record, sourceFingerprint: preRunFingerprint }),
      /sources changed during the run/,
    );
    assert.equal(fs.existsSync(path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME)), false);
  });
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

test("every module owning the onboarding Quasar refusal is bound to the evidence it is cited as proof of", async () => {
  for (const relativePath of QUASAR_REFUSAL_OWNING_MODULES) {
    await withRepo(async (repoRoot) => {
      const dir = "artifacts/surfpool-quasar-smoke";
      const record = await seedRun(repoRoot, dir, "sdk-quasar-refusal-binding");
      await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

      assert.doesNotThrow(() =>
        readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }));

      await writeRepoFile(repoRoot, relativePath, "export const refusalRemoved = true;\n");

      assert.throws(
        () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }),
        /produced from different sources than the working tree/,
        `weakening ${relativePath} must invalidate accepted Quasar evidence`,
      );
    });
  }
});

test("an artifact content change after publication invalidates the receipt", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-artifact-hash");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    assert.doesNotThrow(() =>
      readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }));

    await fsp.appendFile(path.join(repoRoot, dir, record.runId, "SUMMARY.md"), "\nEdited after publication.\n");

    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }),
      /summary artifact whose content changed/,
    );
  });
});

test("a symlink anywhere under a fingerprint root is refused rather than hashed", async () => {
  const cases = [
    // A file symlink pointing outside the repository would bind a receipt to foreign content.
    { relativePath: "lib/config/scratch.ts", target: os.tmpdir(), type: "file" },
    // A directory symlink pointing at a parent would recurse until the OS path limit.
    { relativePath: "lib/config/self", target: "..", type: "dir" },
    // The root itself being a link is the same escape, one level up.
    { relativePath: "experiments/quasar-escrow/src", target: "../../../lib", type: "dir" },
  ];

  for (const { relativePath, target, type } of cases) {
    await withRepo(async (repoRoot) => {
      await seedFingerprintSources(repoRoot, "quasar");
      assert.doesNotThrow(() => computeLaneSourceFingerprint(repoRoot, "quasar"));

      const absolute = path.join(repoRoot, relativePath);
      await fsp.rm(absolute, { recursive: true, force: true });
      await fsp.mkdir(path.dirname(absolute), { recursive: true });
      await fsp.symlink(target, absolute, type);

      assert.throws(
        () => computeLaneSourceFingerprint(repoRoot, "quasar"),
        /must not traverse symbolic links/,
        `${relativePath} must be refused, not hashed`,
      );
    });
  }
});

test("a fingerprint root entry that is neither an ordinary file nor a directory is refused", async () => {
  await withRepo(async (repoRoot) => {
    await seedFingerprintSources(repoRoot, "quasar");
    assert.doesNotThrow(() => computeLaneSourceFingerprint(repoRoot, "quasar"));

    const fifo = path.join(repoRoot, "lib/config/pipe");
    const made = spawnSync("mkfifo", [fifo]);
    if (made.status !== 0) return; // platform without mkfifo: the symlink cases already cover the rule

    assert.throws(
      () => computeLaneSourceFingerprint(repoRoot, "quasar"),
      /must be ordinary files or directories/,
    );
  });
});

test("an intermediate component of a multi-segment root escaping the repository is refused", async () => {
  // `experiments/quasar-escrow/src` is a fingerprint root, but the walk only lstats the joined path,
  // which follows every component before the last. The parent being a link out of the repository is
  // therefore invisible to the walk and is what the resolved-path check exists to catch.
  await withRepo(async (repoRoot) => {
    await seedFingerprintSources(repoRoot, "quasar");
    assert.doesNotThrow(() => computeLaneSourceFingerprint(repoRoot, "quasar"));

    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "rap-outside-root-"));
    try {
      await fsp.mkdir(path.join(outside, "src"), { recursive: true });
      await fsp.writeFile(path.join(outside, "src", "lib.rs"), "pub fn smuggled() {}\n");

      const parent = path.join(repoRoot, "experiments/quasar-escrow");
      await fsp.rm(parent, { recursive: true, force: true });
      await fsp.symlink(outside, parent, "dir");

      assert.throws(
        () => computeLaneSourceFingerprint(repoRoot, "quasar"),
        /must stay inside the repository/,
      );
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });
});

test("a fingerprinted source read refuses an intermediate directory swapped to a symlink after the walk", async () => {
  await withRepo(async (repoRoot) => {
    await seedFingerprintSources(repoRoot, "quasar");
    assert.doesNotThrow(() => computeLaneSourceFingerprint(repoRoot, "quasar"));

    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "rap-swapped-source-root-"));
    const sourceDir = path.join(repoRoot, "lib/config");
    const movedDir = path.join(outside, "config");
    const triggerPath = path.join(sourceDir, "network.ts");
    const originalOpenSync = fs.openSync;
    let swapped = false;
    fs.openSync = function patchedOpenSync(file, flags, mode) {
      if (!swapped && path.resolve(String(file)) === triggerPath) {
        swapped = true;
        fs.renameSync(sourceDir, movedDir);
        fs.symlinkSync(movedDir, sourceDir, "dir");
      }
      return originalOpenSync.call(this, file, flags, mode);
    };

    try {
      assert.throws(
        () => computeLaneSourceFingerprint(repoRoot, "quasar"),
        /opened outside its allowed root/,
      );
      assert.equal(swapped, true, "the regression must exercise the walk-to-read race");
    } finally {
      fs.openSync = originalOpenSync;
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });
});

test("artifact digest reads refuse an evidence root swapped to a symlink after containment validation", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-artifact-root-swap");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);
    assert.doesNotThrow(() =>
      readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }));

    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "rap-swapped-evidence-root-"));
    const evidenceRoot = path.join(repoRoot, dir);
    const movedRoot = path.join(outside, "surfpool-quasar-smoke");
    const triggerPath = path.join(evidenceRoot, record.runId, "SUMMARY.md");
    const originalOpenSync = fs.openSync;
    let swapped = false;
    fs.openSync = function patchedOpenSync(file, flags, mode) {
      if (!swapped && path.resolve(String(file)) === triggerPath) {
        swapped = true;
        fs.renameSync(evidenceRoot, movedRoot);
        fs.symlinkSync(movedRoot, evidenceRoot, "dir");
      }
      return originalOpenSync.call(this, file, flags, mode);
    };

    try {
      assert.throws(
        () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }),
        /opened outside its allowed root/,
      );
      assert.equal(swapped, true, "the regression must exercise the validation-to-read race");
    } finally {
      fs.openSync = originalOpenSync;
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });
});

test("a repository reached through a symlinked root still fingerprints, and to the same digest", async () => {
  // The per-file containment re-check resolves real paths, so it must compare against the resolved
  // repository root: a checkout reached through a symlinked parent (or a /tmp that is itself a link)
  // is legitimate and must not be mistaken for an escape.
  await withRepo(async (repoRoot) => {
    await seedFingerprintSources(repoRoot, "quasar");
    const direct = computeLaneSourceFingerprint(repoRoot, "quasar");

    const linkParent = await fsp.mkdtemp(path.join(os.tmpdir(), "rap-linked-root-"));
    try {
      const linkedRoot = path.join(linkParent, "checkout");
      await fsp.symlink(repoRoot, linkedRoot, "dir");
      assert.equal(computeLaneSourceFingerprint(linkedRoot, "quasar"), direct);
    } finally {
      await fsp.rm(linkParent, { recursive: true, force: true });
    }
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
      /must not traverse symbolic links/,
    );
  });
});

test("an artifact symlinked inside the evidence root is refused", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-internal-artifact-symlink");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    const runDir = path.join(repoRoot, dir, record.runId);
    await fsp.writeFile(path.join(runDir, "linked-target.log"), "same-root log\n");
    await fsp.symlink("linked-target.log", path.join(runDir, "linked-smoke.log"));

    const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
    const tampered = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    tampered.artifacts = [{ name: "log", path: `${dir}/${record.runId}/linked-smoke.log` }];
    fs.writeFileSync(manifestPath, JSON.stringify(tampered));

    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["log"] }),
      /artifact path must not traverse symbolic links/,
    );
  });
});

test("an evidence root symlinked outside the repository is refused", async () => {
  const externalRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "rap-evidence-external-"));
  try {
    await withRepo(async (repoRoot) => {
      const dir = "artifacts/surfpool-quasar-smoke";
      const runId = "sdk-quasar-root-symlink";
      await seedFingerprintSources(repoRoot, "quasar");
      await fsp.mkdir(path.join(repoRoot, "artifacts"), { recursive: true });
      await fsp.symlink(externalRoot, path.join(repoRoot, dir), "dir");
      await fsp.mkdir(path.join(externalRoot, runId), { recursive: true });
      await fsp.writeFile(path.join(externalRoot, runId, "SUMMARY.md"), "# external summary\n");
      await fsp.writeFile(path.join(externalRoot, runId, "smoke.log"), "external log\n");

      const record = {
        target: "quasar",
        runId,
        status: "PASS",
        repoRoot,
        manifestRelativeDir: dir,
        sourceFingerprint: computeLaneSourceFingerprint(repoRoot, "quasar"),
        artifacts: [
          { name: "summary", path: `${dir}/${runId}/SUMMARY.md` },
          { name: "log", path: `${dir}/${runId}/smoke.log` },
        ],
        provenance: { command: "npm run test:surfpool:quasar-critical" },
      };

      await assert.rejects(
        writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record),
        /evidence root must not traverse symbolic links/,
      );
      assert.equal(fs.existsSync(path.join(externalRoot, ACCEPTED_EVIDENCE_FILENAME)), false);
    });
  } finally {
    await fsp.rm(externalRoot, { recursive: true, force: true });
  }
});

test("an evidence root symlinked elsewhere inside the repository is refused", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const realDir = "artifacts/internal-smoke-target";
    const runId = "sdk-quasar-internal-root-symlink";
    await seedFingerprintSources(repoRoot, "quasar");
    await fsp.mkdir(path.join(repoRoot, realDir, runId), { recursive: true });
    await fsp.symlink(path.join(repoRoot, realDir), path.join(repoRoot, dir), "dir");
    await fsp.writeFile(path.join(repoRoot, realDir, runId, "SUMMARY.md"), "# internal summary\n");
    await fsp.writeFile(path.join(repoRoot, realDir, runId, "smoke.log"), "internal log\n");

    const record = {
      target: "quasar",
      runId,
      status: "PASS",
      repoRoot,
      manifestRelativeDir: dir,
      sourceFingerprint: computeLaneSourceFingerprint(repoRoot, "quasar"),
      artifacts: [
        { name: "summary", path: `${dir}/${runId}/SUMMARY.md` },
        { name: "log", path: `${dir}/${runId}/smoke.log` },
      ],
      provenance: { command: "npm run test:surfpool:quasar-critical" },
    };

    await assert.rejects(
      writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record),
      /evidence root must not traverse symbolic links/,
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
    const withoutRepoRoot = withoutKey(record, "repoRoot");

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

test("a receipt that is itself a symlink to a foreign file is refused rather than trusted", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-symlinked-receipt");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
    const genuine = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "rap-foreign-receipt-"));
    try {
      // A foreign receipt that would otherwise pass every content check: same fingerprint, same
      // artifacts, but an attacker-chosen acceptedAt that defeats the freshness bound.
      const foreign = path.join(outside, "accepted-evidence.json");
      await fsp.writeFile(foreign, JSON.stringify({ ...genuine, acceptedAt: new Date().toISOString() }, null, 2));
      await fsp.rm(manifestPath);
      await fsp.symlink(foreign, manifestPath, "file");

      assert.throws(
        () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }),
        /must not be a symbolic link/,
      );
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });
});

test("a receipt read through a symlinked evidence root is refused before any of its fields are trusted", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-symlinked-root");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    const evidenceRoot = path.join(repoRoot, dir);
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "rap-foreign-evidence-root-"));
    try {
      const movedRoot = path.join(outside, "surfpool-quasar-smoke");
      await fsp.rename(evidenceRoot, movedRoot);
      await fsp.symlink(movedRoot, evidenceRoot, "dir");

      // Stale-dated so a reader that parses the receipt first would report staleness instead: the
      // symlinked-root refusal must win, proving no field of a foreign receipt is consulted.
      const movedManifest = path.join(movedRoot, ACCEPTED_EVIDENCE_FILENAME);
      const foreign = JSON.parse(fs.readFileSync(movedManifest, "utf8"));
      foreign.acceptedAt = new Date(Date.now() - ACCEPTED_EVIDENCE_MAX_AGE_MS - 60_000).toISOString();
      await fsp.writeFile(movedManifest, JSON.stringify(foreign, null, 2));

      assert.throws(
        () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }),
        /evidence root must not traverse symbolic links/,
      );
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });
});

test("a receipt swapped to a symlink between the existence check and the read is refused", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-receipt-swap");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);
    assert.doesNotThrow(() =>
      readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }));

    const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
    const genuine = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "rap-swapped-receipt-"));
    const originalOpenSync = fs.openSync;
    let swapped = false;
    fs.openSync = function patchedOpenSync(file, flags, mode) {
      if (!swapped && path.resolve(String(file)) === manifestPath) {
        swapped = true;
        const foreign = path.join(outside, "accepted-evidence.json");
        fs.writeFileSync(foreign, JSON.stringify({ ...genuine, runId: "attacker-chosen" }, null, 2));
        fs.rmSync(manifestPath);
        fs.symlinkSync(foreign, manifestPath, "file");
      }
      return originalOpenSync.call(this, file, flags, mode);
    };

    try {
      assert.throws(
        () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }),
        /must not be a symbolic link/,
      );
      assert.equal(swapped, true, "the regression must exercise the existence-check-to-read race");
    } finally {
      fs.openSync = originalOpenSync;
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });
});

test("an oversized receipt is refused instead of being buffered and parsed", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-oversized-receipt");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
    const genuine = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    genuine.padding = "x".repeat(ACCEPTED_EVIDENCE_MAX_BYTES);
    await fsp.writeFile(manifestPath, JSON.stringify(genuine));

    assert.throws(
      () => readAcceptedEvidenceManifest(repoRoot, dir, { target: "quasar", requiredArtifacts: ["summary", "log"] }),
      /larger than the allowed/,
    );
  });
});

const READER_MODULE_URL = pathToFileURL(
  path.join(realRepoRoot, "scripts/lib/surfpool-evidence-manifest.mjs"),
).href;

/**
 * Runs the receipt reader in a child process with a hard timeout.
 *
 * A synchronous open that blocks cannot be interrupted by an in-process timer, so "refused
 * promptly" is only observable from outside the process: a reader that blocks shows up here as a
 * child killed by the timeout rather than as a test run that hangs forever.
 */
function readReceiptInChild(repoRoot, dir, { target = "quasar", patch = "" } = {}) {
  const script = `
import fs from "node:fs";
import { readAcceptedEvidenceManifest } from ${JSON.stringify(READER_MODULE_URL)};
${patch}
try {
  const result = readAcceptedEvidenceManifest(
    ${JSON.stringify(repoRoot)},
    ${JSON.stringify(dir)},
    { target: ${JSON.stringify(target)}, requiredArtifacts: ["summary", "log"] },
  );
  console.log("ACCEPTED " + JSON.stringify(result.manifest.runId));
} catch (error) {
  console.log("REFUSED " + error.message);
}
`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return { ...child, outcome: (child.stdout ?? "").trim() };
}

function makeFifo(absolutePath) {
  const made = spawnSync("mkfifo", [absolutePath]);
  return made.status === 0;
}

test("a named-pipe receipt is refused promptly instead of blocking the reader", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-fifo-receipt");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);
    assert.match(readReceiptInChild(repoRoot, dir).outcome, /^ACCEPTED/);

    const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
    await fsp.rm(manifestPath);
    if (!makeFifo(manifestPath)) return; // platform without mkfifo: nothing to prove here

    const child = readReceiptInChild(repoRoot, dir);
    assert.equal(child.signal, null, "the reader must not block until it is killed by the timeout");
    assert.match(child.outcome, /^REFUSED .*must be an ordinary file/);
  });
});

test("a named-pipe cited artifact is refused promptly instead of blocking the reader", async () => {
  await withRepo(async (repoRoot) => {
    const dir = "artifacts/surfpool-quasar-smoke";
    const record = await seedRun(repoRoot, dir, "sdk-quasar-fifo-artifact");
    await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

    const summaryPath = path.join(repoRoot, dir, "sdk-quasar-fifo-artifact", "SUMMARY.md");
    await fsp.rm(summaryPath);
    if (!makeFifo(summaryPath)) return; // platform without mkfifo: nothing to prove here

    const child = readReceiptInChild(repoRoot, dir);
    assert.equal(child.signal, null, "the reader must not block until it is killed by the timeout");
    assert.match(child.outcome, /^REFUSED .*must be an ordinary file/);
  });
});

test("a receipt replaced between the type check and the open is refused without consuming it", async () => {
  const cases = [
    // A named pipe is the shape that would block the open itself if it were reached.
    { label: "named pipe", plant: "fifo", expected: /must be an ordinary file/ },
    // An ordinary file swapped in still fails the descriptor's identity check.
    { label: "different ordinary file", plant: "file", expected: /was replaced while evidence was being computed/ },
  ];

  for (const { label, plant, expected } of cases) {
    await withRepo(async (repoRoot) => {
      const dir = "artifacts/surfpool-quasar-smoke";
      const record = await seedRun(repoRoot, dir, `sdk-quasar-receipt-race-${plant}`);
      await writeAcceptedEvidenceManifest(path.join(repoRoot, dir), record);

      const manifestPath = path.join(repoRoot, dir, ACCEPTED_EVIDENCE_FILENAME);
      const probe = path.join(repoRoot, ".mkfifo-probe");
      if (plant === "fifo" && !makeFifo(probe)) return; // platform without mkfifo
      await fsp.rm(probe, { force: true });

      // The swap happens after the reader's pre-open type check has already seen an ordinary file,
      // so only the descriptor-bound checks can catch it.
      const patch = `
import { spawnSync as spawnSyncInChild } from "node:child_process";
const manifestPath = ${JSON.stringify(manifestPath)};
const genuine = fs.readFileSync(manifestPath);
const originalLstatSync = fs.lstatSync;
let swapped = false;
fs.lstatSync = function patchedLstatSync(target, options) {
  const stat = originalLstatSync.call(this, target, options);
  if (!swapped && String(target) === manifestPath) {
    swapped = true;
    fs.rmSync(manifestPath);
    if (${JSON.stringify(plant)} === "fifo") {
      spawnSyncInChild("mkfifo", [manifestPath]);
    } else {
      const forged = JSON.parse(genuine.toString("utf8"));
      forged.runId = "attacker-chosen";
      fs.writeFileSync(manifestPath, JSON.stringify(forged, null, 2) + "\\n");
    }
  }
  return stat;
};
`;
      const child = readReceiptInChild(repoRoot, dir, { patch });
      assert.equal(child.signal, null, `${label}: the reader must not block until it is killed by the timeout`);
      assert.match(child.outcome, new RegExp(`^REFUSED .*${expected.source}`), label);
    });
  }
});
