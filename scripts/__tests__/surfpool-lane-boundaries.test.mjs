import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  LOCAL_ENDPOINT_ENV_KEYS,
  SurfpoolSafetyError,
  assertLocalOnlyEnvironment,
  baselinePath,
  localChildEnv,
} from "../lib/surfpool-sdk-lifecycle.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const QUASAR_SOURCE_DIRS = {
  escrow: "experiments/quasar-escrow",
  registry: "experiments/quasar-registry",
  reputation: "experiments/quasar-reputation",
  attestation: "experiments/quasar-attestation",
};

function declaredProgramId(sourceDir) {
  const lib = fs.readFileSync(path.join(repoRoot, sourceDir, "src/lib.rs"), "utf8");
  const declared = lib.match(/declare_id!\("([^"]+)"\)/)?.[1];
  assert.ok(declared, `declare_id! not found in ${sourceDir}/src/lib.rs`);
  return declared;
}

test("configured Quasar program IDs equal the declare_id! each program compiles with", () => {
  // Quasar owner checks and the reveal commitment pre-image compare against declare_id!, so the
  // deployment inventory and the sources must agree or the lane deploys to addresses they reject.
  const inventory = JSON.parse(fs.readFileSync(path.join(repoRoot, "config/quasar/deployments.json"), "utf8"));
  const ids = inventory.quasarDeployments.devnet.programIds;

  for (const [key, sourceDir] of Object.entries(QUASAR_SOURCE_DIRS)) {
    assert.equal(ids[key], declaredProgramId(sourceDir), `${key} program ID drifted from ${sourceDir}/src/lib.rs`);
  }
});

test("a payments API base pointing off-loopback is rejected before anything starts", () => {
  assert.ok(LOCAL_ENDPOINT_ENV_KEYS.includes("DEMO_PAYMENTS_API_BASE_URL"));

  assert.throws(
    () => assertLocalOnlyEnvironment({ DEMO_PAYMENTS_API_BASE_URL: "https://payments.magicblock.app" }),
    SurfpoolSafetyError,
  );
  assert.doesNotThrow(() => assertLocalOnlyEnvironment({ DEMO_PAYMENTS_API_BASE_URL: "http://127.0.0.1:1" }));
});

test("the lane child environment pins every payment and mint variable and disables dotenv", () => {
  const env = localChildEnv({}, { repoRoot: "/repo", childTmpDir: "/repo/.tmp/run/tmp", home: "/home/dev" });

  assert.equal(env.DEMO_DISABLE_DOTENV, "true", "the child must not load a developer's .env.devnet");
  assert.equal(env.TMPDIR, "/repo/.tmp/run/tmp", "temp files stay inside the run directory");
  assert.equal(env.NODE_ENV, process.env.NODE_ENV ?? "test");

  // replaceEnv means the child sees exactly this object: nothing is inherited that is not pinned.
  assert.deepEqual(
    Object.keys(env).sort(),
    ["DEMO_DISABLE_DOTENV", "HOME", "NODE_ENV", "PATH", "TMPDIR", "npm_config_audit", "npm_config_fund"],
  );
});

test("the lane child environment carries the pinned payment and mint overrides through unchanged", () => {
  const env = localChildEnv(
    { DEMO_PAYMENTS_API_BASE_URL: "http://127.0.0.1:1", DEMO_PRIVATE_MINT: "", DEMO_PER_RPC: "http://127.0.0.1:1" },
    { repoRoot: "/repo", childTmpDir: "/repo/.tmp/run/tmp", home: "/home/dev" },
  );

  assert.equal(env.DEMO_PRIVATE_MINT, "", "an unset mint must be pinned empty, not inherited");
  assert.equal(env.DEMO_PAYMENTS_API_BASE_URL, "http://127.0.0.1:1");
  assert.equal(env.DEMO_DISABLE_DOTENV, "true", "an override must not be able to re-enable dotenv silently");
  assert.doesNotThrow(() => assertLocalOnlyEnvironment(env));
});

test("the lane child PATH puts the pinned baseline toolchain ahead of whatever the caller had", () => {
  const resolved = baselinePath({ repoRoot: "/repo", home: "/home/dev", inheritedPath: "/usr/bin" });
  const entries = resolved.split(":");

  assert.deepEqual(entries, [
    "/home/dev/.cargo/bin",
    "/home/dev/.local/share/solana/reddi-agent-protocol-baseline/install/active_release/bin",
    "/home/dev/.local/share/surfpool/releases/v1.5.0/bin",
    "/repo/node_modules/.bin",
    "/usr/bin",
  ]);
  assert.ok(entries.indexOf("/home/dev/.cargo/bin") < entries.indexOf("/usr/bin"));
});

test("child environment helpers refuse to guess the run-scoped paths they bind", () => {
  assert.throws(() => localChildEnv({}, { childTmpDir: "/tmp/x" }), /requires repoRoot/);
  assert.throws(() => localChildEnv({}, { repoRoot: "/repo" }), /requires childTmpDir/);
  assert.throws(() => baselinePath({}), /requires repoRoot/);
});
