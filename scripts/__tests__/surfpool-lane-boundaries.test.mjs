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
    "scripts/lib/json-schema-subset.mjs",
    "scripts/__tests__/quasar-runtime-compatibility-schema.test.mjs",
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

test("the Quasar readiness guard is triggered by runtime-compatibility schema contract changes", () => {
  const workflow = loadWorkflow("quasar-readiness-guard.yml");
  const paths = workflow.on.pull_request.paths;
  for (const requiredPath of [
    "scripts/check-quasar-*.mjs",
    "scripts/lib/json-schema-subset.mjs",
    "scripts/__tests__/quasar-runtime-compatibility-schema.test.mjs",
  ]) {
    assert.ok(paths.includes(requiredPath), `pull_request must cover ${requiredPath}`);
  }
});

// The set of regression test files a shell command executes, resolved through package.json so a
// step that runs an aggregate script counts as running each file the aggregate runs.
function testFilesExecutedBy(command, packageScripts, seen = new Set()) {
  const files = new Set();
  for (const match of String(command ?? "").matchAll(/node\s+--test\s+(\S+)/g)) {
    files.add(match[1].replace(/^\.\//, ""));
  }
  for (const match of String(command ?? "").matchAll(/npm\s+run\s+([\w:-]+)/g)) {
    const name = match[1];
    if (seen.has(name) || !packageScripts[name]) continue;
    seen.add(name);
    for (const file of testFilesExecutedBy(packageScripts[name], packageScripts, seen)) files.add(file);
  }
  return files;
}

test("every workflow whose path filters name a regression test file also runs that file", () => {
  // A trigger that names an exact test file promises hosted coverage of it. Without a step that
  // runs it, editing only that file starts the job and proves nothing — the case that let the
  // runtime-compatibility schema regressions ride on indirect smoke coverage alone. Glob filters
  // (`scripts/__tests__/**`) make no such per-file promise and are not read as one.
  const packageScripts = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts;
  const names = fs.readdirSync(path.join(repoRoot, ".github/workflows")).filter((name) => name.endsWith(".yml"));
  let checked = 0;

  for (const name of names) {
    const workflow = loadWorkflow(name);
    const executed = new Set();
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        for (const file of testFilesExecutedBy(step.run, packageScripts)) executed.add(file);
      }
    }
    for (const [eventName, trigger] of Object.entries(workflow.on ?? {})) {
      for (const filter of trigger?.paths ?? []) {
        if (!filter.endsWith(".test.mjs") || filter.includes("*")) continue;
        assert.ok(fs.existsSync(path.join(repoRoot, filter)), `${name} ${eventName} names a missing file: ${filter}`);
        assert.ok(
          executed.has(filter),
          `${name} triggers on ${eventName} changes to ${filter} but no step runs it`,
        );
        checked += 1;
      }
    }
  }

  assert.ok(checked > 0, "the repository must have at least one workflow triggering on a named test file");
});

const LANE_BOUNDARY_SUITE = "scripts/__tests__/surfpool-lane-boundaries.test.mjs";

// Files whose edit must start a job that runs this suite. Workflow YAML is here because a trigger
// list can otherwise be deleted in a PR that starts nothing; the suite file and the script that
// runs it are here because a change to either can silently stop it being executed.
const GUARDED_BY_THIS_SUITE = Object.freeze([
  ".github/workflows/quasar-readiness-guard.yml",
  ".github/workflows/rap-package-guard.yml",
  ".github/workflows/surfpool-quasar-critical-sdk.yml",
  LANE_BOUNDARY_SUITE,
  "package.json",
]);

/**
 * Which workflow events run this suite, and on which path filters — per event, never flattened.
 * GitHub evaluates each event's filters independently, so a filter present only under `push` does
 * nothing for a pull request, and it is the pull request that gates a merge.
 */
function laneBoundaryCoverage(workflows) {
  const coverage = [];
  for (const [name, workflow] of Object.entries(workflows)) {
    const runsSuite = Object.values(workflow.jobs ?? {}).some((job) => (job.steps ?? []).some((step) =>
      testFilesExecutedBy(step.run, workflow.packageScripts).has(LANE_BOUNDARY_SUITE)));
    for (const [eventName, trigger] of Object.entries(workflow.on ?? {})) {
      if (!trigger?.paths) continue;
      coverage.push({ workflow: name, event: eventName, runsSuite, paths: trigger.paths });
    }
  }
  return coverage;
}

/** Every guarded file with no independent witness under the merge-gating pull_request event. */
function unwitnessedFiles(coverage, guarded = GUARDED_BY_THIS_SUITE) {
  return guarded.filter((file) => !coverage.some((entry) =>
    entry.runsSuite
    && entry.event === "pull_request"
    && entry.paths.includes(file)
    // A workflow's own filter list cannot be its only witness: deleting that line is exactly the
    // edit that must still start a job.
    && `.github/workflows/${entry.workflow}` !== file));
}

function repositoryWorkflows() {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts;
  const workflows = {};
  for (const name of fs.readdirSync(path.join(repoRoot, ".github/workflows")).filter((entry) => entry.endsWith(".yml"))) {
    workflows[name] = { ...loadWorkflow(name), packageScripts };
  }
  return workflows;
}

test("every file this suite guards has an independent workflow that runs it on pull request", () => {
  const coverage = laneBoundaryCoverage(repositoryWorkflows());

  assert.deepEqual(unwitnessedFiles(coverage), [], "each guarded file needs a witness other than itself");
  const witnesses = new Set(coverage.filter((entry) => entry.runsSuite).map((entry) => entry.workflow));
  assert.ok(witnesses.size >= 2, `at least two workflows must run this suite; got ${[...witnesses].join(", ") || "none"}`);
});

test("each event's filters are judged on their own, so push coverage cannot stand in for pull request", () => {
  const workflows = repositoryWorkflows();
  const pushOnly = {
    ...workflows,
    "example.yml": {
      packageScripts: workflows["quasar-readiness-guard.yml"].packageScripts,
      on: { push: { paths: [...GUARDED_BY_THIS_SUITE] }, pull_request: { paths: ["unrelated/**"] } },
      jobs: { example: { steps: [{ run: "npm run test:surfpool:lane-boundaries" }] } },
    },
  };

  // The added workflow covers every guarded file under push and none under pull_request. If events
  // were flattened it would satisfy the check on its own.
  const coverageWithoutRealWitnesses = laneBoundaryCoverage(pushOnly)
    .filter((entry) => entry.workflow === "example.yml");
  assert.deepEqual(
    unwitnessedFiles(coverageWithoutRealWitnesses),
    [...GUARDED_BY_THIS_SUITE],
    "push-only coverage must not satisfy a pull-request gate",
  );
});

// Mutation fixtures: each is an edit a maintainer could plausibly make, and each must be reported as
// a coverage gap rather than passing silently.
const COVERAGE_MUTATIONS = [
  {
    label: "the readiness guard stops naming its reciprocal partner",
    mutate: (workflows) => {
      workflows["quasar-readiness-guard.yml"].on.pull_request.paths =
        workflows["quasar-readiness-guard.yml"].on.pull_request.paths.filter((p) => p !== ".github/workflows/rap-package-guard.yml");
    },
    expected: [".github/workflows/rap-package-guard.yml"],
  },
  {
    label: "the package guard stops naming its reciprocal partner",
    mutate: (workflows) => {
      workflows["rap-package-guard.yml"].on.pull_request.paths =
        workflows["rap-package-guard.yml"].on.pull_request.paths.filter((p) => p !== ".github/workflows/quasar-readiness-guard.yml");
    },
    expected: [".github/workflows/quasar-readiness-guard.yml"],
  },
  {
    label: "the heavy lane's YAML loses its lightweight witnesses",
    mutate: (workflows) => {
      for (const name of ["quasar-readiness-guard.yml", "rap-package-guard.yml"]) {
        workflows[name].on.pull_request.paths =
          workflows[name].on.pull_request.paths.filter((p) => p !== ".github/workflows/surfpool-quasar-critical-sdk.yml");
      }
    },
    expected: [".github/workflows/surfpool-quasar-critical-sdk.yml"],
  },
  {
    label: "the suite file itself stops being a trigger",
    mutate: (workflows) => {
      for (const workflow of Object.values(workflows)) {
        for (const trigger of Object.values(workflow.on ?? {})) {
          if (trigger?.paths) trigger.paths = trigger.paths.filter((p) => p !== LANE_BOUNDARY_SUITE);
        }
      }
    },
    expected: [LANE_BOUNDARY_SUITE],
  },
  {
    // Reciprocity cuts both ways: the package guard is the readiness guard's only independent
    // witness, so dropping the step here leaves the readiness guard's own YAML unguarded.
    label: "one witness drops the step that runs the suite",
    mutate: (workflows) => {
      for (const job of Object.values(workflows["rap-package-guard.yml"].jobs)) {
        job.steps = (job.steps ?? []).filter((step) => !String(step.run ?? "").includes("test:surfpool:lane-boundaries"));
      }
    },
    expected: [".github/workflows/quasar-readiness-guard.yml"],
  },
  {
    label: "both witnesses drop the step that runs the suite",
    mutate: (workflows) => {
      for (const name of ["quasar-readiness-guard.yml", "rap-package-guard.yml"]) {
        for (const job of Object.values(workflows[name].jobs)) {
          job.steps = (job.steps ?? []).filter((step) => !String(step.run ?? "").includes("test:surfpool:lane-boundaries"));
        }
      }
    },
    // Only the heavy lane still runs the suite, and it no longer names either guard's YAML.
    expected: [
      ".github/workflows/quasar-readiness-guard.yml",
      ".github/workflows/rap-package-guard.yml",
      ".github/workflows/surfpool-quasar-critical-sdk.yml",
    ],
  },
];

for (const { label, mutate, expected } of COVERAGE_MUTATIONS) {
  test(`hosted coverage is reported as lost when ${label}`, () => {
    const workflows = structuredClone(repositoryWorkflows());
    assert.deepEqual(unwitnessedFiles(laneBoundaryCoverage(workflows)), [], "the fixture starts from full coverage");

    mutate(workflows);
    assert.deepEqual(
      unwitnessedFiles(laneBoundaryCoverage(workflows)).sort(),
      [...expected].sort(),
      `${label} must be reported, not tolerated`,
    );
  });
}

test("the heavy Surfpool lane is not triggered by sibling guard YAML", () => {
  // The lane-boundary suite is cheap; running the 90-minute Surfnet/Rust job because a lightweight
  // guard's YAML changed would be paying for it in the wrong place.
  const critical = loadWorkflow("surfpool-quasar-critical-sdk.yml");
  for (const eventName of ["push", "pull_request"]) {
    const paths = critical.on[eventName].paths;
    for (const sibling of [".github/workflows/quasar-readiness-guard.yml", ".github/workflows/rap-package-guard.yml"]) {
      assert.equal(paths.includes(sibling), false, `${eventName} must not start the heavy lane for ${sibling}`);
    }
    assert.ok(
      paths.includes(".github/workflows/surfpool-quasar-critical-sdk.yml"),
      `${eventName} must still re-run the lane when its own definition changes`,
    );
  }
});

test("a guard workflow re-runs its own job when its triggers are edited", () => {
  // Self-listing is not sufficient on its own — that is what unwitnessedFiles checks — but it is
  // still necessary, so an edit re-runs the checks the file itself gates.
  for (const name of ["quasar-readiness-guard.yml", "quasar-program-tests.yml", "rap-package-guard.yml"]) {
    const workflow = loadWorkflow(name);
    const selfListed = Object.values(workflow.on ?? {}).some((trigger) =>
      (trigger?.paths ?? []).includes(`.github/workflows/${name}`));
    assert.ok(selfListed, `${name} must list itself so editing its triggers re-runs its own job`);
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
  // One loopback address at one port is one socket, whichever spelling it is dressed in.
  { label: "rpc and ws on one socket", rpcUrl: "http://127.0.0.1:8899", wsUrl: "ws://127.0.0.1:8899" },
  { label: "rpc and ws on one socket under loopback aliases", rpcUrl: "http://localhost:8899", wsUrl: "ws://127.0.0.1:8899" },
  { label: "rpc and ws on one socket in non-canonical IPv6", rpcUrl: "http://[::1]:8899", wsUrl: "ws://[0:0:0:0:0:0:0:1]:8899" },
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
