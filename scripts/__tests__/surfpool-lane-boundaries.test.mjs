import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseWorkflowYaml } from "../lib/workflow-yaml.mjs";
import {
  LOCAL_ENDPOINT_ENV_KEYS,
  QUASAR_PROGRAM_SOURCE_DIRS,
  SurfpoolSafetyError,
  assertLocalOnlyEnvironment,
  SurfpoolReadinessError,
  assertQuasarProgramIdsMatchSources,
  baselinePath,
  declaredQuasarProgramId,
  localChildEnv,
  resolveRepositorySubpath,
  startLocalSurfnet,
  waitForPortClosed,
} from "../lib/surfpool-sdk-lifecycle.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function configuredQuasarProgramIds() {
  const inventory = JSON.parse(fs.readFileSync(path.join(repoRoot, "config/quasar/deployments.json"), "utf8"));
  return inventory.quasarDeployments.devnet.programIds;
}

function withoutKey(record, key) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function loadWorkflow(name) {
  return parseWorkflowYaml(fs.readFileSync(path.join(repoRoot, ".github/workflows", name), "utf8"));
}

test("the lane precondition accepts the repository's configured Quasar program IDs", () => {
  // Invokes the same check the runner performs before it builds or starts anything.
  assert.equal(assertQuasarProgramIdsMatchSources(repoRoot, configuredQuasarProgramIds()), true);
});

test("the lane precondition refuses a configured program ID that drifts from its declare_id!", () => {
  const ids = configuredQuasarProgramIds();

  for (const key of Object.keys(QUASAR_PROGRAM_SOURCE_DIRS)) {
    const drifted = { ...ids, [key]: "11111111111111111111111111111112" };
    assert.throws(
      () => assertQuasarProgramIdsMatchSources(repoRoot, drifted),
      (error) => {
        assert.ok(error instanceof SurfpoolSafetyError);
        assert.match(error.message, new RegExp(`drifted.*${key}`, "s"));
        return true;
      },
      `drifting ${key} must be refused`,
    );
  }
});

test("the lane precondition refuses a missing Quasar program ID", () => {
  const incomplete = withoutKey(configuredQuasarProgramIds(), "escrow");
  assert.throws(() => assertQuasarProgramIdsMatchSources(repoRoot, incomplete), /missing Quasar escrow program ID/);
});

test("each Quasar crate reports the program ID it actually compiles with", () => {
  for (const [key, dir] of Object.entries(QUASAR_PROGRAM_SOURCE_DIRS)) {
    const declared = declaredQuasarProgramId(repoRoot, dir);
    assert.match(declared, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, `${key} must declare a base58 program ID`);
  }
  // A crate with no program lib must fail closed with the same clear precondition error.
  assert.throws(() => declaredQuasarProgramId(repoRoot, "scripts"), SurfpoolSafetyError);
  assert.throws(() => declaredQuasarProgramId(repoRoot, "scripts"), /declare_id! not found/);
  assert.throws(() => declaredQuasarProgramId(repoRoot, "experiments/quasar-escrow-ref"), /declare_id! not found/);
});

test("the workflow reader models the constructs these workflows are written with", () => {
  const parsed = parseWorkflowYaml(
    [
      "name: Example # trailing comment",
      "",
      "on:",
      "  push:",
      "    branches: [main, feature/**]",
      "    paths:",
      "      - \"config/quasar/**\"",
      "      - \"a#b\"",
      "  workflow_dispatch:",
      "",
      "jobs:",
      "  example:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 90",
      "    env:",
      "      # a comment line inside a mapping",
      "      BUDGET_MS: \"2400000\"",
      "    steps:",
      "      - name: Setup Node",
      "        uses: actions/setup-node@v4",
      "        with:",
      "          node-version: \"24.20.0\"",
      "      - name: Run",
      "        run: |",
      "          echo one # not a comment",
      "          echo two",
    ].join("\n"),
  );

  assert.equal(parsed.name, "Example");
  assert.deepEqual(parsed.on.push.branches, ["main", "feature/**"]);
  assert.deepEqual(parsed.on.push.paths, ["config/quasar/**", "a#b"]);
  assert.equal(parsed.on.workflow_dispatch, null);
  assert.equal(parsed.jobs.example["timeout-minutes"], 90);
  assert.equal(parsed.jobs.example.env.BUDGET_MS, "2400000");
  assert.equal(parsed.jobs.example.steps.length, 2);
  assert.equal(parsed.jobs.example.steps[0].with["node-version"], "24.20.0");
  assert.equal(parsed.jobs.example.steps[1].run, "echo one # not a comment\necho two\n");
});

test("every workflow in the repository parses into a job model, so the reader cannot silently skip one", () => {
  const names = fs.readdirSync(path.join(repoRoot, ".github/workflows")).filter((name) => name.endsWith(".yml"));
  assert.ok(names.length > 0);
  for (const name of names) {
    const workflow = loadWorkflow(name);
    assert.ok(workflow.on, `${name} must expose its triggers`);
    assert.ok(Object.keys(workflow.jobs ?? {}).length > 0, `${name} must expose at least one job`);
  }
});

test("the Quasar SDK workflow is triggered by refusal and compatibility surface changes", () => {
  const workflow = loadWorkflow("surfpool-quasar-critical-sdk.yml");
  const requiredPaths = [
    ".mise.toml",
    "Anchor.toml",
    "config/networks/**",
    "lib/config/**",
    "app/register/**",
    "app/onboarding/**",
    "app/api/onboarding/**",
    "lib/program.ts",
    "lib/onboarding/**",
    "lib/register/**",
    "lib/registry/**",
    "lib/useOnchainAgents.ts",
    "packages/agent-protocol/**",
    "packages/per-client/**",
    "docs/ECONOMIC-DEMO-JUDGE-PACKET-2026-05-05.md",
    "docs/ECONOMIC-DEMO-OPERATOR-CHECKLIST-2026-05-05.md",
    "docs/QUASAR-HACKATHON-CUTOVER-PLAN-2026-05-05.md",
    ".github/workflows/anchor-program-tests.yml",
    ".github/workflows/quasar-program-tests.yml",
  ];

  for (const eventName of ["push", "pull_request"]) {
    const paths = workflow.on[eventName].paths;
    for (const requiredPath of requiredPaths) {
      assert.ok(paths.includes(requiredPath), `${eventName} must cover ${requiredPath}`);
    }
  }
});

test("hosted Surfpool workflows request the exact repository Node baseline", () => {
  const critical = loadWorkflow("surfpool-quasar-critical-sdk.yml");
  const manual = loadWorkflow("surfpool-acceptance-manual.yml");

  assert.equal(
    critical.jobs["surfpool-quasar-critical-sdk"].steps.find((step) => step.uses === "actions/setup-node@v4")?.with?.["node-version"],
    "24.20.0",
  );
  assert.equal(
    manual.jobs["surfpool-acceptance"].steps.find((step) => step.uses === "actions/setup-node@v4")?.with?.["node-version"],
    "24.20.0",
  );
});

async function listenOn(host) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host, port: 0 }, resolve);
    });
  } catch (error) {
    server.close();
    // A machine without this address family cannot host the probe at all.
    if (error?.code === "EADDRNOTAVAIL" || error?.code === "EAFNOSUPPORT") return null;
    throw error;
  }
  return { server, port: server.address().port };
}

// A bracketed IPv6 URL hostname handed straight to net.connect is treated as a DNS name and fails
// with ENOTFOUND, which a refusal-means-closed probe reads as "closed" — so port closure would be
// reported for a Surfnet that is still listening.
for (const [host, endpointHost] of [["127.0.0.1", "127.0.0.1"], ["::1", "[::1]"]]) {
  test(`waitForPortClosed does not report a still-listening ${host} socket as closed`, async () => {
    const listening = await listenOn(host);
    if (!listening) return;

    try {
      await assert.rejects(
        waitForPortClosed(`http://${endpointHost}:${listening.port}`, { timeoutMs: 400, intervalMs: 50 }),
        /Timed out waiting for .* to close/,
      );
    } finally {
      await new Promise((resolve) => listening.server.close(resolve));
    }
  });

  test(`waitForPortClosed reports a released ${host} port as closed`, async () => {
    const listening = await listenOn(host);
    if (!listening) return;

    await new Promise((resolve) => listening.server.close(resolve));
    assert.equal(
      await waitForPortClosed(`http://${endpointHost}:${listening.port}`, { timeoutMs: 5_000, intervalMs: 50 }),
      true,
    );
  });
}

test("payment API bases pointing off-loopback are rejected before anything starts", () => {
  assert.ok(LOCAL_ENDPOINT_ENV_KEYS.includes("DEMO_PAYMENTS_API_BASE_URL"));
  assert.ok(LOCAL_ENDPOINT_ENV_KEYS.includes("JUPITER_API_BASE"));

  for (const key of ["DEMO_PAYMENTS_API_BASE_URL", "JUPITER_API_BASE"]) {
    assert.throws(
      () => assertLocalOnlyEnvironment({ [key]: "https://api.jup.ag" }),
      SurfpoolSafetyError,
      `${key} must be part of the parent-process local-only preflight`,
    );
    assert.doesNotThrow(() => assertLocalOnlyEnvironment({ [key]: "http://127.0.0.1:1" }));
  }
});

test("local-only preflight enforces HTTP RPC variables and WS websocket variables", () => {
  assert.doesNotThrow(() => assertLocalOnlyEnvironment({ NEXT_PUBLIC_RPC_ENDPOINT: "http://127.0.0.1:8899" }));
  assert.doesNotThrow(() => assertLocalOnlyEnvironment({ NEXT_PUBLIC_RPC_WS_ENDPOINT: "ws://127.0.0.1:8900" }));

  assert.throws(
    () => assertLocalOnlyEnvironment({ NEXT_PUBLIC_RPC_ENDPOINT: "ws://127.0.0.1:8899" }),
    /NEXT_PUBLIC_RPC_ENDPOINT must use http:\/\//,
  );
  assert.throws(
    () => assertLocalOnlyEnvironment({ DEMO_DEVNET_RPC_WS: "http://127.0.0.1:8900" }),
    /DEMO_DEVNET_RPC_WS must use ws:\/\//,
  );
});

const LOCAL_PROFILE_ALIASES = ["local-surfpool", "local", "localnet", "surfpool"];

for (const key of ["NETWORK_PROFILE", "NEXT_PUBLIC_BUILD_NETWORK_PROFILE", "NEXT_PUBLIC_NETWORK_PROFILE"]) {
  test(`the local Surfpool lane rejects non-local ${key} before anything starts`, () => {
    for (const value of ["devnet", "mainnet", "mainnet-beta", "testnet", "unknown-profile"]) {
      assert.throws(
        () => assertLocalOnlyEnvironment({ [key]: value }),
        SurfpoolSafetyError,
        `${key}=${value} must not be accepted by the local Surfpool validation lane`,
      );
    }
    for (const value of LOCAL_PROFILE_ALIASES) {
      assert.doesNotThrow(() => assertLocalOnlyEnvironment({ [key]: value }));
    }
  });
}

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
    {
      DEMO_PAYMENTS_API_BASE_URL: "http://127.0.0.1:1",
      DEMO_PRIVATE_MINT: "",
      DEMO_PER_RPC: "http://127.0.0.1:1",
      DEMO_DISABLE_DOTENV: "false",
      HOME: "/tmp/not-home",
      PATH: "/tmp/not-toolchain",
      TMPDIR: "/tmp/not-run-scoped",
    },
    { repoRoot: "/repo", childTmpDir: "/repo/.tmp/run/tmp", home: "/home/dev" },
  );

  assert.equal(env.DEMO_PRIVATE_MINT, "", "an unset mint must be pinned empty, not inherited");
  assert.equal(env.DEMO_PAYMENTS_API_BASE_URL, "http://127.0.0.1:1");
  assert.equal(env.DEMO_DISABLE_DOTENV, "true", "an override must not be able to re-enable dotenv silently");
  assert.equal(env.HOME, "/home/dev", "an override must not move HOME outside the run policy");
  assert.equal(env.TMPDIR, "/repo/.tmp/run/tmp", "an override must not move temporary files outside the run directory");
  assert.match(env.PATH, /^\/home\/dev\/\.cargo\/bin:/, "an override must not remove the pinned baseline PATH prefix");
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

test("the Surfpool cargo cache override is confined to the repository .tmp cache root", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "rap-surfpool-cargo-cache-"));
  const external = await fsp.mkdtemp(path.join(os.tmpdir(), "rap-surfpool-external-cache-"));
  try {
    const base = path.join(".tmp", "surfpool-sdk-cargo-target");
    await fsp.mkdir(path.join(tempRoot, base), { recursive: true });
    assert.equal(
      resolveRepositorySubpath(tempRoot, path.join(base, "quasar"), base, "RAP_SURFPOOL_CARGO_TARGET_DIR"),
      path.join(tempRoot, base, "quasar"),
    );
    assert.equal(
      resolveRepositorySubpath(tempRoot, path.join(tempRoot, base, "legacy-anchor"), base, "RAP_SURFPOOL_CARGO_TARGET_DIR"),
      path.join(tempRoot, base, "legacy-anchor"),
    );
    assert.throws(
      () => resolveRepositorySubpath(tempRoot, external, base, "RAP_SURFPOOL_CARGO_TARGET_DIR"),
      /must stay under/,
    );
    assert.throws(
      () => resolveRepositorySubpath(tempRoot, path.join("..", "outside"), base, "RAP_SURFPOOL_CARGO_TARGET_DIR"),
      /must stay under/,
    );

    await fsp.symlink(external, path.join(tempRoot, base, "linked"), "dir");
    assert.throws(
      () => resolveRepositorySubpath(tempRoot, path.join(base, "linked", "quasar"), base, "RAP_SURFPOOL_CARGO_TARGET_DIR"),
      /must not traverse symbolic links/,
    );
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
    await fsp.rm(external, { recursive: true, force: true });
  }
});

// A Surfnet the SDK already started is a live process holding ports. Every rejection path after
// start must stop it, or the lane leaves a validator running and the runner never learns it existed.
function fakeSurfnetReporting(endpoints) {
  let stopCount = 0;
  return {
    stopCount: () => stopCount,
    Surfnet: class {
      static startWithConfig() {
        return { ...endpoints, instanceId: "fake", stop() { stopCount += 1; } };
      }
    },
  };
}

const REJECTED_ENDPOINTS = [
  { label: "non-loopback bind", rpcUrl: "http://0.0.0.0:8899", wsUrl: "ws://0.0.0.0:8900" },
  { label: "public host", rpcUrl: "http://example.com:8899", wsUrl: "ws://example.com:8900" },
  { label: "no explicit port", rpcUrl: "http://127.0.0.1", wsUrl: "ws://127.0.0.1:8900" },
  { label: "rpc and ws identical", rpcUrl: "http://127.0.0.1:8899", wsUrl: "http://127.0.0.1:8899" },
  { label: "https scheme", rpcUrl: "https://127.0.0.1:8899", wsUrl: "ws://127.0.0.1:8900" },
];

for (const endpoints of REJECTED_ENDPOINTS) {
  test(`a started Surfnet reporting a ${endpoints.label} is stopped, not leaked`, async () => {
    const fake = fakeSurfnetReporting(endpoints);

    await assert.rejects(
      startLocalSurfnet(fake.Surfnet, { env: {}, readinessProbe: () => true }),
      SurfpoolSafetyError,
    );
    assert.equal(fake.stopCount(), 1, "the started Surfnet must be stopped exactly once");
  });
}

test("a Surfnet that never becomes ready is also stopped exactly once", async () => {
  const fake = fakeSurfnetReporting({ rpcUrl: "http://127.0.0.1:18311", wsUrl: "ws://127.0.0.1:18312" });

  await assert.rejects(
    startLocalSurfnet(fake.Surfnet, {
      env: {},
      readinessTimeoutMs: 60,
      readinessIntervalMs: 5,
      readinessProbe: () => false,
    }),
    SurfpoolReadinessError,
  );
  assert.equal(fake.stopCount(), 1);
});

test("a Surfnet accepted on loopback endpoints is handed back running", async () => {
  const fake = fakeSurfnetReporting({ rpcUrl: "http://127.0.0.1:18313", wsUrl: "ws://127.0.0.1:18314" });

  const lease = await startLocalSurfnet(fake.Surfnet, { env: {}, readinessProbe: () => true });

  assert.equal(fake.stopCount(), 0, "a healthy lease must not be stopped by startLocalSurfnet");
  lease.stop();
  lease.stop();
  assert.equal(fake.stopCount(), 1, "stop must be idempotent for the caller");
});
