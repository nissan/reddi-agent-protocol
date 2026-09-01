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

test("the lane child environment pins every payment and mint variable and disables dotenv", async () => {
  // The lane spawns demo children with replaceEnv:true. Rebuild that environment the way the runner
  // does and assert nothing is left for a gitignored .env.devnet to fill in.
  const source = await fsp.readFile(path.join(repoRoot, "scripts/run-surfpool-sdk-critical-smoke.mjs"), "utf8");
  const childTmpDir = "/tmp/lane-tmp";
  const body = source.slice(source.indexOf("function localChildEnv"), source.indexOf("function baselinePath"));
  const localChildEnv = new Function(
    "childTmpDir", "baselinePath", "process",
    `${body}; return localChildEnv;`,
  )(childTmpDir, () => "/usr/bin", process);

  const env = localChildEnv({});
  assert.equal(env.DEMO_DISABLE_DOTENV, "true", "the child must not load a developer's .env.devnet");

  const pinned = localChildEnv({
    DEMO_PAYMENTS_API_BASE_URL: "http://127.0.0.1:1",
    DEMO_PRIVATE_MINT: "",
  });
  assert.equal(pinned.DEMO_PRIVATE_MINT, "", "an unset mint must be pinned empty, not inherited");
  assert.doesNotThrow(() => assertLocalOnlyEnvironment(pinned));
});
