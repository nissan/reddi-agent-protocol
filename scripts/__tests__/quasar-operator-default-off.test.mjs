import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");
const fixtureDir = path.join(testDir, "fixtures");
const loaderPath = path.join(fixtureDir, "quasar-operator-refusal-loader.mjs");
const preloadPath = path.join(fixtureDir, "quasar-operator-refusal-preload.cjs");
const entryPaths = [
  "scripts/run-quasar-per-devnet-smoke.mjs",
  "scripts/run-quasar-per-magicblock-cpi-smoke.mjs",
  "scripts/run-quasar-per-agent-vault-delegation-smoke.mjs",
  "scripts/run-quasar-per-agent-vault-settlement-smoke.mjs",
].map((entry) => path.join(repoRoot, entry));
const aliases = ["smoke:quasar:per-devnet", "smoke:quasar:per-magicblock-cpi"];
const aliasArgs = ["--approve", "--force"];
const packageScripts = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts;
const refusalText = "[quasar-operator] DISABLED: this historical Quasar operator entrypoint is frozen";

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "../../lib/node_modules/npm/bin/npm-cli.js"),
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(found, `npm CLI not found in synthetic test setup (checked ${candidates.join(", ")})`);
  return found;
}

function readEffects(effectsPath) {
  if (!fs.existsSync(effectsPath)) return [];
  return fs.readFileSync(effectsPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

function makeSandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quasar-refusal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const cwd = path.join(root, "cwd");
  const effectsPath = path.join(root, "effects.jsonl");
  const signerSentinel = path.join(home, ".config", "solana", "definitely-not-a-wallet.json");
  const artifactSentinel = path.join(root, "forbidden-artifacts");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  const env = {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: home,
    TMPDIR: root,
    npm_config_cache: path.join(root, "npm-cache"),
    npm_config_update_notifier: "false",
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    NODE_NO_WARNINGS: "1",
    NODE_OPTIONS: `--require=${preloadPath} --experimental-loader=${loaderPath}`,
    QUASAR_REFUSAL_TARGETS: entryPaths.join(path.delimiter),
    QUASAR_REFUSAL_EFFECTS: effectsPath,
    QUASAR_REFUSAL_SIGNER_SENTINEL: signerSentinel,
    QUASAR_REFUSAL_ARTIFACT_SENTINEL: artifactSentinel,
    SOLANA_KEYPAIR: signerSentinel,
    OUT_DIR: artifactSentinel,
    RPC_URL: "http://127.0.0.1:1/fake-rpc-that-must-not-be-used",
    TEE_RPC_URL: "http://127.0.0.1:2/fake-tee-that-must-not-be-used",
    QUASAR_OPERATOR_APPROVED: "yes",
    QUASAR_APPROVAL_FILE: path.join(root, "fake-approval.json"),
    ALLOW_UNSAFE_QUASAR: "1",
  };
  return { root, cwd, effectsPath, artifactSentinel, env };
}

function assertRefused(result, sandbox) {
  assert.notEqual(result.status, 0, `entrypoint unexpectedly succeeded: ${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /\[quasar-operator\] DISABLED:.*historical Quasar operator entrypoint is frozen/);
  assert.deepEqual(readEffects(sandbox.effectsPath), [], "a prohibited effect occurred before refusal");
  assert.equal(fs.existsSync(sandbox.artifactSentinel), false, "configured evidence output was created");
  assert.equal(fs.existsSync(path.join(sandbox.cwd, "artifacts")), false, "default evidence output was created");
}

for (const entryPath of entryPaths) {
  test(`direct entrypoint refuses without imports or effects: ${path.basename(entryPath)}`, (t) => {
    const sandbox = makeSandbox(t);
    const baseline = spawnSync(process.execPath, [entryPath], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      encoding: "utf8",
    });
    assertRefused(baseline, sandbox);

    fs.rmSync(sandbox.effectsPath, { force: true });
    const hostile = spawnSync(process.execPath, [entryPath, "--approve", "--force", "--cluster", "mainnet-beta"], {
      cwd: sandbox.cwd,
      env: { ...sandbox.env, QUASAR_OPERATOR_APPROVED: "true", OPERATOR_APPROVAL_TOKEN: "synthetic-not-a-token" },
      encoding: "utf8",
    });
    assertRefused(hostile, sandbox);
    assert.equal(
      hostile.stderr.split("\n").find((line) => line.includes(refusalText)),
      baseline.stderr.split("\n").find((line) => line.includes(refusalText)),
      "approval-looking inputs changed the refusal diagnostic",
    );
  });
}

for (const alias of aliases) {
  test(`npm alias resolves to a refusing real entrypoint: ${alias}`, (t) => {
    const sandbox = makeSandbox(t);
    const npmCli = npmCliPath();
    const result = spawnSync(process.execPath, [npmCli, "--prefix", repoRoot, "run", alias, "--", ...aliasArgs], {
      cwd: sandbox.cwd,
      env: {
        ...sandbox.env,
        QUASAR_REFUSAL_NPM_PARENT: npmCli,
        QUASAR_REFUSAL_NPM_LAUNCH: [packageScripts[alias], ...aliasArgs].join(" "),
      },
      encoding: "utf8",
    });
    assertRefused(result, sandbox);
  });
}

test("npm-parent positive control rejects and records network, signer, and non-launch child processes", (t) => {
  const sandbox = makeSandbox(t);
  const fixture = path.join(fixtureDir, "quasar-operator-npm-parent-positive.cjs");
  const result = spawnSync(process.execPath, [fixture], {
    cwd: sandbox.cwd,
    env: {
      ...sandbox.env,
      QUASAR_REFUSAL_NPM_PARENT: fixture,
      QUASAR_REFUSAL_NPM_LAUNCH: "synthetic-permitted-launch",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `an npm-parent effect was not rejected before it started: ${result.stderr}`);
  assert.deepEqual(
    readEffects(sandbox.effectsPath).map((effect) => effect.type),
    ["signer-read", "network", "network", "http", "fetch", "child-process", "child-process"],
  );
});

test("instrumentation positive controls detect imports, signer reads, network calls, child processes, and artifacts", (t) => {
  const sandbox = makeSandbox(t);
  for (const [fixtureName, expectedType, fixtureEnv] of [
    ["quasar-operator-import-positive.mjs", "sdk-import", "QUASAR_REFUSAL_IMPORT_FIXTURE"],
    ["quasar-operator-business-import-positive.mjs", "business-import", "QUASAR_REFUSAL_IMPORT_FIXTURE"],
  ]) {
    const fixture = path.join(fixtureDir, fixtureName);
    const result = spawnSync(process.execPath, [fixture], {
      cwd: sandbox.cwd,
      env: { ...sandbox.env, [fixtureEnv]: fixture },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.ok(readEffects(sandbox.effectsPath).some((effect) => effect.type === expectedType));
  }

  fs.rmSync(sandbox.effectsPath, { force: true });
  const effectFixture = path.join(fixtureDir, "quasar-operator-effects-positive.cjs");
  const result = spawnSync(process.execPath, [effectFixture], {
    cwd: sandbox.cwd,
    env: { ...sandbox.env, QUASAR_REFUSAL_EFFECT_FIXTURE: effectFixture },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const effectTypes = new Set(readEffects(sandbox.effectsPath).map((effect) => effect.type));
  for (const expected of ["signer-read", "network", "http", "fetch", "child-process"]) {
    assert.ok(effectTypes.has(expected), `positive control did not record ${expected}`);
  }
  assert.equal(fs.existsSync(sandbox.artifactSentinel), true, "artifact positive control was not observable");
});
