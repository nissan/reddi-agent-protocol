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
