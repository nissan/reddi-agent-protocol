import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { Surfnet } from "@solana/surfpool";

import {
  SurfpoolReadinessError,
  SurfpoolSafetyError,
  assertLoopbackEndpoint,
  assertQuasarCriticalDemoOutput,
  assertQuasarPerFailClosedOutput,
  createRedactingLineBuffer,
  redactForEvidence,
  startLocalSurfnet,
  waitForPortClosed,
} from "../lib/surfpool-sdk-lifecycle.mjs";

const quasarIds = {
  escrow: "VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW",
  registry: "Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU",
  reputation: "nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6",
  attestation: "CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex",
};

test("SDK Surfnet allocates dynamic loopback ports and isolates parallel instances", async () => {
  const leases = [];
  try {
    leases.push(await startLocalSurfnet(Surfnet, { env: {}, readinessTimeoutMs: 20_000 }));
    leases.push(await startLocalSurfnet(Surfnet, { env: {}, readinessTimeoutMs: 20_000 }));

    assert.notEqual(leases[0].instanceId, leases[1].instanceId);
    assert.notEqual(leases[0].rpcUrl, leases[1].rpcUrl);
    assert.notEqual(leases[0].wsUrl, leases[1].wsUrl);
    for (const lease of leases) {
      assertLoopbackEndpoint(lease.rpcUrl, "rpcUrl");
      assertLoopbackEndpoint(lease.wsUrl, "wsUrl");
      assert.match(lease.instanceId, /^[0-9a-f-]{36}$/i);
      assert.ok(lease.readinessAttempts >= 1);
    }
  } finally {
    for (const lease of leases.splice(0).reverse()) {
      const { rpcUrl, wsUrl } = lease;
      lease.stop();
      await waitForPortClosed(rpcUrl, { timeoutMs: 5_000 });
      await waitForPortClosed(wsUrl, { timeoutMs: 5_000 });
    }
  }
});

test("local-only preflight refuses live endpoints before SDK startup", async () => {
  let starts = 0;
  class FakeSurfnet {
    static startWithConfig() {
      starts += 1;
      throw new Error("must not start");
    }
  }

  await assert.rejects(
    startLocalSurfnet(FakeSurfnet, {
      env: { NEXT_PUBLIC_RPC_ENDPOINT: "https://api.devnet.solana.com" },
      readinessProbe: () => true,
    }),
    SurfpoolSafetyError,
  );
  assert.equal(starts, 0);
});

test("readiness timeout stops the SDK Surfnet it started", async () => {
  let stopped = 0;
  class FakeSurfnet {
    static startWithConfig() {
      return {
        rpcUrl: "http://127.0.0.1:18181",
        wsUrl: "ws://127.0.0.1:18182",
        instanceId: "fake-timeout",
        stop() { stopped += 1; },
      };
    }
  }

  await assert.rejects(
    startLocalSurfnet(FakeSurfnet, {
      env: {},
      readinessTimeoutMs: 5,
      readinessIntervalMs: 1,
      readinessProbe: () => false,
    }),
    SurfpoolReadinessError,
  );
  assert.equal(stopped, 1);
});

test("readiness enforces its own deadline when a probe never settles", async () => {
  let stopped = 0;
  class FakeSurfnet {
    static startWithConfig() {
      return {
        rpcUrl: "http://127.0.0.1:18191",
        wsUrl: "ws://127.0.0.1:18192",
        instanceId: "fake-hang",
        stop() { stopped += 1; },
      };
    }
  }

  const startedAt = Date.now();
  await assert.rejects(
    startLocalSurfnet(FakeSurfnet, {
      env: {},
      readinessTimeoutMs: 300,
      readinessIntervalMs: 10,
      readinessProbe: () => new Promise(() => {}),
    }),
    SurfpoolReadinessError,
  );
  assert.ok(Date.now() - startedAt < 10_000, "readiness must be bounded by readinessTimeoutMs");
  assert.equal(stopped, 1);
});

test("readiness aborts each hung probe attempt instead of leaking it", async () => {
  const observedAborts = [];
  class FakeSurfnet {
    static startWithConfig() {
      return {
        rpcUrl: "http://127.0.0.1:18193",
        wsUrl: "ws://127.0.0.1:18194",
        instanceId: "fake-hang-abort",
        stop() {},
      };
    }
  }

  await assert.rejects(
    startLocalSurfnet(FakeSurfnet, {
      env: {},
      readinessTimeoutMs: 200,
      readinessIntervalMs: 10,
      readinessProbe: (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            observedAborts.push(signal.reason?.message ?? "aborted");
            reject(signal.reason);
          }, { once: true });
        }),
    }),
    SurfpoolReadinessError,
  );
  assert.ok(observedAborts.length >= 1);
  assert.match(observedAborts[0], /exceeded \d+ms/);
});

test("a hung probe consumes only its attempt slice, so a recovering RPC is still detected", async () => {
  let probeCalls = 0;
  class FakeSurfnet {
    static startWithConfig() {
      return {
        rpcUrl: "http://127.0.0.1:18197",
        wsUrl: "ws://127.0.0.1:18198",
        instanceId: "fake-hung-then-healthy",
        stop() {},
      };
    }
  }

  const lease = await startLocalSurfnet(FakeSurfnet, {
    env: {},
    readinessTimeoutMs: 1_000,
    readinessIntervalMs: 5,
    readinessAttemptTimeoutMs: 50,
    readinessProbe: () => {
      probeCalls += 1;
      return probeCalls === 1 ? new Promise(() => {}) : true;
    },
  });

  assert.equal(lease.readinessAttempts, 2, "the stalled first attempt must not consume the whole window");
  lease.stop();
});

test("a permanently hung probe is retried across the readiness window and still fails closed", async () => {
  class FakeSurfnet {
    static startWithConfig() {
      return {
        rpcUrl: "http://127.0.0.1:18199",
        wsUrl: "ws://127.0.0.1:18200",
        instanceId: "fake-hung-retry",
        stop() {},
      };
    }
  }

  const startedAt = Date.now();
  let attempts = 0;
  await assert.rejects(
    startLocalSurfnet(FakeSurfnet, {
      env: {},
      readinessTimeoutMs: 400,
      readinessIntervalMs: 5,
      readinessAttemptTimeoutMs: 50,
      readinessProbe: () => {
        attempts += 1;
        return new Promise(() => {});
      },
    }),
    (error) => {
      assert.ok(error instanceof SurfpoolReadinessError);
      assert.ok(error.attempts >= 3, `expected retries within the window, got ${error.attempts}`);
      return true;
    },
  );
  assert.ok(attempts >= 3, `expected the hung probe to be retried, got ${attempts} call(s)`);
  assert.ok(Date.now() - startedAt < 10_000, "overall readiness must still be bounded");
});

test("waiting for readiness does not accumulate abort listeners on a long-lived signal", async () => {
  const controller = new AbortController();
  class FakeSurfnet {
    static startWithConfig() {
      return {
        rpcUrl: "http://127.0.0.1:18195",
        wsUrl: "ws://127.0.0.1:18196",
        instanceId: "fake-listener-leak",
        stop() {},
      };
    }
  }

  const warnings = [];
  const onWarning = (warning) => warnings.push(warning);
  process.on("warning", onWarning);
  try {
    await assert.rejects(
      startLocalSurfnet(FakeSurfnet, {
        env: {},
        readinessTimeoutMs: 400,
        readinessIntervalMs: 1,
        readinessProbe: () => false,
        signal: controller.signal,
      }),
      SurfpoolReadinessError,
    );
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("warning", onWarning);
  }

  assert.deepEqual(
    warnings.filter((warning) => warning.name === "MaxListenersExceededWarning").map((warning) => warning.message),
    [],
  );
});

test("loopback validation rejects malformed, non-loopback, and live-network-style URLs", () => {
  assert.doesNotThrow(() => assertLoopbackEndpoint("http://127.42.0.1:4567", "rpc"));
  assert.doesNotThrow(() => assertLoopbackEndpoint("ws://localhost:4568", "ws"));
  assert.throws(() => assertLoopbackEndpoint("https://api.mainnet-beta.solana.com", "rpc"), SurfpoolSafetyError);
  assert.throws(() => assertLoopbackEndpoint("http://0.0.0.0:8899", "rpc"), SurfpoolSafetyError);
  assert.throws(() => assertLoopbackEndpoint("not a url", "rpc"), SurfpoolSafetyError);
});

test("Quasar output parser requires all four explicit local program IDs and no fallback", () => {
  const goodOutput = `
║       Reddi Agent Protocol — local-surfpool Demo ║
Target:   quasar
Escrow:   ${quasarIds.escrow}
Registry: ${quasarIds.registry}
Repute:   ${quasarIds.reputation}
Attest:   ${quasarIds.attestation}
║  🏁  Full A→B→C cycle complete                          ║
  Settlement:      Quasar escrow public settlement
  ℹ️  MagicBlock PER/TEE is not claimed by this Quasar final path; no Anchor/PER fallback was used.
`;
  assert.equal(assertQuasarCriticalDemoOutput(goodOutput, quasarIds), true);

  assert.throws(
    () => assertQuasarCriticalDemoOutput(goodOutput.replace(quasarIds.attestation, "CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv111"), quasarIds),
    /Attest:/,
  );
  assert.throws(
    () => assertQuasarCriticalDemoOutput(goodOutput.replace("Target:   quasar", "Target:   legacy-anchor"), quasarIds),
    /Target: quasar/,
  );
  assert.throws(
    () => assertQuasarCriticalDemoOutput(goodOutput.replace("no Anchor/PER fallback was used", "L1 fallback used"), quasarIds),
    /fallback/,
  );
  assert.throws(
    () => assertQuasarCriticalDemoOutput(goodOutput.replace("local-surfpool", "devnet") + "\nhttps://explorer.solana.com/tx/abc?cluster=devnet", quasarIds),
    /local-surfpool|devnet\/mainnet/,
  );
});

test("Quasar PER fail-closed parser rejects hostile success-looking output", () => {
  assert.equal(
    assertQuasarPerFailClosedOutput("❌ Demo failed: MagicBlock PER/TEE is not claimed for the Quasar final demo path yet."),
    true,
  );
  assert.throws(
    () => assertQuasarPerFailClosedOutput("MagicBlock PER/TEE is not claimed for the Quasar final demo path yet.\nFull A→B→C cycle complete"),
    /unexpectedly completed/,
  );
  assert.throws(() => assertQuasarPerFailClosedOutput("Full A→B→C cycle complete"), /expected boundary/);
});

test("evidence redaction repository-relativizes paths and strips keypair byte arrays", () => {
  const redacted = redactForEvidence(
    "AGENT_A_KEYPAIR=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17] /repo/path/artifacts /home/example/.config",
    { repoRoot: "/repo/path", home: "/home/example" },
  );
  assert.equal(redacted.includes("/repo/path"), false);
  assert.equal(redacted.includes("/home/example"), false);
  assert.match(redacted, /AGENT_KEYPAIR=<redacted>/);
  assert.match(redacted, /<repo>\/artifacts/);
  assert.match(redacted, /~\/\.config/);
});

test("SIGINT teardown stops an in-process SDK Surfnet and closes its ports", async () => {
  const childSource = `
    import { Surfnet } from "@solana/surfpool";
    import { startLocalSurfnet } from "./scripts/lib/surfpool-sdk-lifecycle.mjs";
    let lease;
    process.once("SIGINT", () => {
      try { lease?.stop(); } finally { process.exit(130); }
    });
    lease = await startLocalSurfnet(Surfnet, { env: {}, readinessTimeoutMs: 20000 });
    console.log(JSON.stringify({ rpcUrl: lease.rpcUrl, wsUrl: lease.wsUrl }));
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let endpoints;
  let stderr = "";
  const closePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`child did not exit after SIGINT; stderr=${stderr}`));
    }, 30_000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.stdout.on("data", (chunk) => {
      for (const line of chunk.toString("utf8").trim().split(/\r?\n/)) {
        if (!line) continue;
        endpoints = JSON.parse(line);
        child.kill("SIGINT");
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  const code = await closePromise;
  assert.deepEqual(code, 130, stderr);
  assert.ok(endpoints?.rpcUrl, stderr);
  await waitForPortClosed(endpoints.rpcUrl, { timeoutMs: 5_000 });
  await waitForPortClosed(endpoints.wsUrl, { timeoutMs: 5_000 });
});

test("Quasar output parser detects a real fallback that also prints the reassuring banner", () => {
  const fallbackOutput = `
║       Reddi Agent Protocol — local-surfpool Demo ║
Target:   quasar
Escrow:   ${quasarIds.escrow}
Registry: ${quasarIds.registry}
Repute:   ${quasarIds.reputation}
Attest:   ${quasarIds.attestation}
   ⚠️  PER unavailable (connect ECONNREFUSED...) — using L1 fallback
   ✅ L1 fallback used — sig: local
║  🏁  Full A→B→C cycle complete                          ║
  Settlement:      Quasar escrow public settlement
  ℹ️  MagicBlock PER/TEE is not claimed by this Quasar final path; no Anchor/PER fallback was used.
`;
  assert.throws(
    () => assertQuasarCriticalDemoOutput(fallbackOutput, quasarIds),
    /no Anchor\/PER fallback wording/,
  );
});

test("line-buffered redaction strips a keypair split across two pipe chunks", () => {
  const secretLine = `AGENT_A_KEYPAIR=[${Array.from({ length: 64 }, (_, i) => i + 1).join(",")}]\n`;
  const splitAt = 40;
  const buffer = createRedactingLineBuffer({ repoRoot: "/repo/path", home: "/home/example" });

  let emitted = buffer.push(Buffer.from(secretLine.slice(0, splitAt), "utf8"));
  assert.equal(emitted, "", "an incomplete line must not be emitted unredacted");
  emitted += buffer.push(Buffer.from(secretLine.slice(splitAt), "utf8"));
  emitted += buffer.flush();

  assert.equal(emitted.includes("AGENT_A_KEYPAIR=[1,2"), false);
  assert.match(emitted, /AGENT_KEYPAIR=<redacted>/);
});

test("line-buffered redaction relativizes paths split across chunks and flushes an unterminated tail", () => {
  const buffer = createRedactingLineBuffer({ repoRoot: "/repo/path", home: "/home/example" });
  let emitted = buffer.push("build output at /repo/pa");
  emitted += buffer.push("th/artifacts and /home/exa");
  emitted += buffer.push("mple/.config");
  assert.equal(emitted, "", "nothing complete yet");
  emitted += buffer.flush();

  assert.equal(emitted.includes("/repo/path"), false);
  assert.equal(emitted.includes("/home/example"), false);
  assert.match(emitted, /<repo>\/artifacts/);
  assert.match(emitted, /~\/\.config/);
  assert.equal(buffer.flush(), "", "flush must be idempotent");
});

test("line-buffered redaction emits complete lines and preserves carriage-return progress output", () => {
  const buffer = createRedactingLineBuffer({});
  assert.equal(buffer.push("first line\nsecond par"), "first line\n");
  assert.equal(buffer.push("t\rprogress"), "second part\r");
  assert.equal(buffer.flush(), "progress");
});
