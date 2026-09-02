import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import { Surfnet } from "@solana/surfpool";

import {
  EVIDENCE_PUBLICATION_INDETERMINATE,
  EVIDENCE_PUBLICATION_NOT_PUBLISHED,
  EVIDENCE_PUBLICATION_ROLLED_BACK,
} from "../lib/surfpool-evidence-manifest.mjs";
import {
  SurfpoolReadinessError,
  SurfpoolSafetyError,
  OVERSIZED_LOG_LINE_MARKER,
  assertLoopbackEndpoint,
  assertQuasarCriticalDemoOutput,
  assertQuasarPerFailClosedOutput,
  createRedactingLineBuffer,
  createStepEvidenceRecord,
  createTruncatingEvidenceBuffer,
  collectStepEvidenceOmission,
  createEvidenceLogWriter,
  describeAcceptedReceiptDisposition,
  sanitizeEvidenceFragment,
  describeSummaryPublicationFailure,
  redactForEvidence,
  spawnLoggedStep,
  startLocalSurfnet,
  summarizeEvidenceCompleteness,
  validateSurfnetEndpoints,
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

test("SDK startup refuses safety-critical Surfnet config overrides before startup", async () => {
  let starts = 0;
  class FakeSurfnet {
    static startWithConfig() {
      starts += 1;
      throw new Error("must not start");
    }
  }

  for (const config of [
    { offline: false },
    { airdropSol: 1 },
    { blockProductionMode: "manual" },
  ]) {
    await assert.rejects(
      startLocalSurfnet(FakeSurfnet, { env: {}, config, readinessProbe: () => true }),
      SurfpoolSafetyError,
      `${JSON.stringify(config)} must be rejected before Surfnet.startWithConfig`,
    );
  }
  assert.equal(starts, 0);
});

test("Surfnet endpoint validation enforces HTTP RPC and WS websocket schemes", () => {
  assert.deepEqual(validateSurfnetEndpoints({
    rpcUrl: "http://127.0.0.1:18180",
    wsUrl: "ws://127.0.0.1:18181",
  }), {
    rpcUrl: "http://127.0.0.1:18180/",
    wsUrl: "ws://127.0.0.1:18181/",
    rpcPort: 18180,
    wsPort: 18181,
  });

  assert.throws(
    () => validateSurfnetEndpoints({ rpcUrl: "ws://127.0.0.1:18180", wsUrl: "ws://127.0.0.1:18181" }),
    /Surfnet RPC URL must use http:\/\//,
  );
  assert.throws(
    () => validateSurfnetEndpoints({ rpcUrl: "http://127.0.0.1:18180", wsUrl: "http://127.0.0.1:18181" }),
    /Surfnet WebSocket URL must use ws:\/\//,
  );
});

test("Surfnet endpoint validation requires two distinct loopback sockets", () => {
  // Distinctness is socket identity, not port number. Two endpoints overlap when they name the same
  // loopback address at one port, or when either is `localhost`, which is not a literal address and
  // may resolve to whichever loopback address the pair's other endpoint names.
  for (const [rpcUrl, wsUrl] of [
    ["http://127.0.0.1:18180", "ws://127.0.0.1:18180"],
    ["http://127.0.0.001:18180", "ws://127.0.0.1:18180"],
    ["http://[::1]:18180", "ws://[0:0:0:0:0:0:0:1]:18180"],
    ["http://localhost:18180", "ws://127.0.0.1:18180"],
    ["http://[::1]:18180", "ws://localhost:18180"],
    ["http://localhost:18180", "ws://localhost:18180"],
  ]) {
    assert.throws(
      () => validateSurfnetEndpoints({ rpcUrl, wsUrl }),
      /must be distinct dynamic loopback sockets/,
      `${rpcUrl} and ${wsUrl} may be one socket and must be refused`,
    );
  }

  // The IPv4-mapped IPv6 form needs no canonicalization here because it never reaches the socket
  // comparison: `URL` renders it as `[::ffff:7f00:1]`, which loopback acceptance refuses outright.
  assert.throws(
    () => validateSurfnetEndpoints({ rpcUrl: "http://[::ffff:127.0.0.1]:18180", wsUrl: "ws://127.0.0.1:18181" }),
    /must bind to loopback only/,
  );

  // Two literal addresses on different address families are two sockets, even on one port, and two
  // ports are two sockets whatever the spelling.
  for (const [rpcUrl, wsUrl, expected] of [
    ["http://[::1]:18180", "ws://127.0.0.1:18180", { rpcPort: 18180, wsPort: 18180 }],
    ["http://127.0.0.1:18180", "ws://[::1]:18180", { rpcPort: 18180, wsPort: 18180 }],
    ["http://127.0.0.1:18180", "ws://127.0.0.2:18180", { rpcPort: 18180, wsPort: 18180 }],
    ["http://localhost:18180", "ws://127.0.0.1:18181", { rpcPort: 18180, wsPort: 18181 }],
  ]) {
    assert.deepEqual(
      validateSurfnetEndpoints({ rpcUrl, wsUrl }),
      { rpcUrl: new URL(rpcUrl).href, wsUrl: new URL(wsUrl).href, ...expected },
      `${rpcUrl} and ${wsUrl} are distinct sockets and must be accepted`,
    );
  }
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

test("a failed lease stop remains retryable instead of being marked stopped", async () => {
  let stopCalls = 0;
  class FakeSurfnet {
    static startWithConfig() {
      return {
        rpcUrl: "http://127.0.0.1:18183",
        wsUrl: "ws://127.0.0.1:18184",
        instanceId: "fake-retryable-stop",
        stop() {
          stopCalls += 1;
          if (stopCalls === 1) throw new Error("first stop not confirmed");
        },
      };
    }
  }

  const lease = await startLocalSurfnet(FakeSurfnet, { env: {}, readinessProbe: () => true });
  assert.throws(() => lease.stop(), /first stop not confirmed/);
  assert.equal(stopCalls, 1);
  assert.doesNotThrow(() => lease.stop());
  assert.equal(stopCalls, 2);
  lease.stop();
  assert.equal(stopCalls, 2, "a successful stop remains idempotent");
});

test("startup-error cleanup retries a stop that initially fails", async () => {
  let stopCalls = 0;
  class FakeSurfnet {
    static startWithConfig() {
      return {
        rpcUrl: "http://0.0.0.0:18185",
        wsUrl: "ws://0.0.0.0:18186",
        instanceId: "fake-startup-retry-stop",
        stop() {
          stopCalls += 1;
          if (stopCalls === 1) throw new Error("first stop not confirmed");
        },
      };
    }
  }

  await assert.rejects(
    startLocalSurfnet(FakeSurfnet, {
      env: {},
      readinessProbe: () => true,
      stopRetryDelayMs: 1,
    }),
    /loopback/,
  );
  assert.equal(stopCalls, 2);
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
  assert.doesNotThrow(() => assertLoopbackEndpoint("http://127.42.0.1:4567", "rpc", { protocol: "http:" }));
  assert.doesNotThrow(() => assertLoopbackEndpoint("ws://localhost:4568", "ws", { protocol: "ws:" }));
  assert.throws(() => assertLoopbackEndpoint("https://api.mainnet-beta.solana.com", "rpc"), SurfpoolSafetyError);
  assert.throws(() => assertLoopbackEndpoint("http://0.0.0.0:8899", "rpc"), SurfpoolSafetyError);
  assert.throws(() => assertLoopbackEndpoint("not a url", "rpc"), SurfpoolSafetyError);
  assert.throws(() => assertLoopbackEndpoint("ws://127.0.0.1:4567", "rpc", { protocol: "http:" }), /http:\/\//);
  assert.throws(() => assertLoopbackEndpoint("http://127.0.0.1:4568", "ws", { protocol: "ws:" }), /ws:\/\//);
  assert.throws(
    () => assertLoopbackEndpoint("http://operator:secret@127.0.0.1:8899", "rpc"),
    /must not include credentials/,
  );
  assert.throws(
    () => assertLoopbackEndpoint("ws://:secret@[::1]:8900", "ws"),
    /must not include credentials/,
  );
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

test("a step whose evidence spool dropped its middle is refused, not certified", () => {
  const head = `
║       Reddi Agent Protocol — local-surfpool Demo ║
Target:   quasar
Escrow:   ${quasarIds.escrow}
Registry: ${quasarIds.registry}
Repute:   ${quasarIds.reputation}
Attest:   ${quasarIds.attestation}
`;
  const tail = `
║  🏁  Full A→B→C cycle complete                          ║
  Settlement:      Quasar escrow public settlement
  ℹ️  MagicBlock PER/TEE is not claimed by this Quasar final path; no Anchor/PER fallback was used.
`;
  const spool = createTruncatingEvidenceBuffer({ headLimit: head.length, tailLimit: tail.length });
  spool.push(head);
  // A retry storm that pushes the prohibited hint out of both the retained head and the tail.
  spool.push("  retrying rpc against api.devnet.solana.com after ECONNRESET\n");
  for (let i = 0; i < 200; i += 1) spool.push(`  attempt ${i} failed\n`);
  spool.push(tail);

  const evidence = createStepEvidenceRecord(spool, [], { logFile: "artifacts/surfpool-sdk-critical-smoke.log" });

  assert.equal(evidence.complete, false, "the spool must report that it dropped output");
  assert.equal(
    evidence.text.includes("api.devnet.solana.com"),
    false,
    "the prohibited hint must be absent from the retained text — this is the fail-open the refusal closes",
  );
  assert.throws(
    () => assertQuasarCriticalDemoOutput(evidence, quasarIds),
    /evidence is incomplete[\s\S]*surfpool-sdk-critical-smoke\.log/,
  );
  assert.throws(
    () => assertQuasarPerFailClosedOutput(evidence),
    /evidence is incomplete/,
  );
});

test("a prohibited hint hidden inside an oversized unterminated line is refused, not certified", () => {
  const head = `
║       Reddi Agent Protocol — local-surfpool Demo ║
Target:   quasar
Escrow:   ${quasarIds.escrow}
Registry: ${quasarIds.registry}
Repute:   ${quasarIds.reputation}
Attest:   ${quasarIds.attestation}
`;
  const tail = `║  🏁  Full A→B→C cycle complete                          ║
  Settlement:      Quasar escrow public settlement
  ℹ️  MagicBlock PER/TEE is not claimed by this Quasar final path; no Anchor/PER fallback was used.
`;
  const maxResidualChars = 4_096;
  const redactor = createRedactingLineBuffer({ maxResidualChars });
  const spool = createTruncatingEvidenceBuffer({ headLimit: 512_000, tailLimit: 1_500_000 });
  const emit = (text) => { if (text) spool.push(text); };

  emit(redactor.push(head));
  // One unterminated line larger than the residual bound — a single-line RPC error dump.
  emit(redactor.push(`{"err":"connect ECONNREFUSED","url":"https://api.devnet.solana.com",${"x".repeat(maxResidualChars)}`));
  emit(redactor.push("}\n"));
  emit(redactor.push(tail));
  emit(redactor.flush());

  const evidence = createStepEvidenceRecord(spool, [redactor], { logFile: "artifacts/surfpool-sdk-critical-smoke.log" });

  assert.equal(spool.complete, true, "the spool itself dropped nothing — spool completeness alone cannot catch this");
  assert.equal(
    evidence.text.includes("api.devnet.solana.com"),
    false,
    "the prohibited hint must be absent from the retained text — this is the fail-open the refusal closes",
  );
  assert.equal(evidence.complete, false, "redactor-side loss must make the step evidence incomplete");
  assert.equal(evidence.logComplete, false, "a marker-replaced record never reached the log");
  assert.ok(evidence.logOmittedLines > 0);
  assert.ok(evidence.logOmittedChars > 0);
  assert.equal(evidence.spoolOmittedChars, 0, "the spool dropped nothing, so its channel must report nothing");
  assert.equal(evidence.spoolOmittedChunks, 0);
  assert.throws(
    () => assertQuasarCriticalDemoOutput(evidence, quasarIds),
    /evidence is incomplete[\s\S]*oversized log line/,
  );
  assert.throws(() => assertQuasarPerFailClosedOutput(evidence), /evidence is incomplete/);
});

test("output that fits the redaction bound stays complete and is still redacted", () => {
  const redactor = createRedactingLineBuffer({ repoRoot: "/repo/path", home: "/home/example", maxResidualChars: 4_096 });
  const spool = createTruncatingEvidenceBuffer({ headLimit: 512_000, tailLimit: 1_500_000 });
  spool.push(redactor.push(`AGENT_A_KEYPAIR=[${Array.from({ length: 64 }, (_, i) => i + 1).join(",")}]\n`));
  spool.push(redactor.push("Target:   quasar in /repo/path\n"));
  spool.push(redactor.flush());

  const evidence = createStepEvidenceRecord(spool, [redactor], { logFile: "artifacts/surfpool-sdk-critical-smoke.log" });

  assert.equal(evidence.complete, true);
  assert.equal(evidence.logOmittedChars, 0);
  assert.equal(evidence.logOmittedLines, 0);
  assert.equal(evidence.spoolOmittedChars, 0);
  assert.equal(evidence.text.includes("AGENT_A_KEYPAIR=["), false, "redaction still applies to complete evidence");
  assert.equal(evidence.text.includes("<repo>"), true);
});

test("a complete evidence record is asserted normally and a missing one is refused", () => {
  const complete = {
    text: `
║       Reddi Agent Protocol — local-surfpool Demo ║
Target:   quasar
Escrow:   ${quasarIds.escrow}
Registry: ${quasarIds.registry}
Repute:   ${quasarIds.reputation}
Attest:   ${quasarIds.attestation}
║  🏁  Full A→B→C cycle complete                          ║
  Settlement:      Quasar escrow public settlement
  ℹ️  MagicBlock PER/TEE is not claimed by this Quasar final path; no Anchor/PER fallback was used.
`,
    complete: true,
    logOmittedChars: 0,
    logOmittedLines: 0,
    spoolOmittedChars: 0,
    spoolOmittedChunks: 0,
  };
  assert.equal(assertQuasarCriticalDemoOutput(complete, quasarIds), true);
  assert.throws(
    () => assertQuasarCriticalDemoOutput({ ...complete, text: `${complete.text}\ncluster=devnet\n` }, quasarIds),
    /devnet\/mainnet/,
  );
  assert.throws(() => assertQuasarCriticalDemoOutput(undefined, quasarIds), /no evidence text was captured/);
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

test("spool truncation and an oversized redacted line together report both losses and are refused", () => {
  const maxResidualChars = 4_096;
  const redactor = createRedactingLineBuffer({ maxResidualChars });
  const head = `
║       Reddi Agent Protocol — local-surfpool Demo ║
Target:   quasar
Escrow:   ${quasarIds.escrow}
Registry: ${quasarIds.registry}
Repute:   ${quasarIds.reputation}
Attest:   ${quasarIds.attestation}
`;
  const tail = `║  🏁  Full A→B→C cycle complete                          ║
  Settlement:      Quasar escrow public settlement
  ℹ️  MagicBlock PER/TEE is not claimed by this Quasar final path; no Anchor/PER fallback was used.
`;
  // Both bounded stages lose output in the same run: the redactor drops an oversized unterminated
  // record, and the spool drops chunks between its head and tail.
  const spool = createTruncatingEvidenceBuffer({ headLimit: head.length, tailLimit: tail.length });
  const emit = (text) => { if (text) spool.push(text); };

  emit(redactor.push(head));
  emit(redactor.push(`{"err":"connect ECONNREFUSED","url":"https://api.devnet.solana.com",${"x".repeat(maxResidualChars)}`));
  emit(redactor.push("}\n"));
  for (let i = 0; i < 200; i += 1) emit(redactor.push(`  attempt ${i} failed\n`));
  emit(redactor.push(tail));
  emit(redactor.flush());

  const evidence = createStepEvidenceRecord(spool, [redactor], { logFile: "artifacts/surfpool-sdk-critical-smoke.log" });

  assert.equal(evidence.complete, false, "loss from either stage must make the step evidence incomplete");
  assert.ok(evidence.spoolOmittedChunks > 0, "the spool's own loss must be reported on the spool channel");
  assert.ok(evidence.spoolOmittedChars > 0);
  assert.ok(evidence.logOmittedLines > 0, "the redactor's oversized-line loss must be reported on the log channel");
  assert.ok(evidence.logOmittedChars > 0);
  assert.equal(evidence.logComplete, false);
  assert.equal(evidence.spoolComplete, false);
  assert.equal(
    evidence.text.includes("api.devnet.solana.com"),
    false,
    "the prohibited hint must be absent from the retained text — this is the fail-open the refusal closes",
  );
  assert.throws(
    () => assertQuasarCriticalDemoOutput(evidence, quasarIds),
    new RegExp(
      `evidence is incomplete[\\s\\S]*spool dropped ${evidence.spoolOmittedChars} character\\(s\\) in `
      + `${evidence.spoolOmittedChunks} spool chunk\\(s\\)[\\s\\S]*replaced ${evidence.logOmittedLines} `
      + `oversized log line\\(s\\) \\(${evidence.logOmittedChars} character\\(s\\)\\)`,
    ),
  );
  assert.throws(() => assertQuasarPerFailClosedOutput(evidence), /evidence is incomplete/);
});

test("a 3 MB line-terminated step loses output from the assertion spool only, never from the log", () => {
  // The spool sits downstream of the log write, so what it drops is still on disk. Counting its loss
  // as log omission published a receipt claiming the log had lost megabytes it still held.
  const chunk = `  ${"lane output ".repeat(6)}\n`.repeat(800);
  const chunks = Math.ceil(3_000_000 / chunk.length);
  const redactor = createRedactingLineBuffer({});
  const spool = createTruncatingEvidenceBuffer({});
  let log = "";
  const emit = (text) => {
    if (!text) return;
    log += text;
    spool.push(text);
  };

  for (let i = 0; i < chunks; i += 1) emit(redactor.push(chunk));
  emit(redactor.flush());

  const evidence = createStepEvidenceRecord(spool, [redactor], { logFile: "artifacts/surfpool-sdk-critical-smoke.log" });

  assert.ok(log.length >= 3_000_000, "the fixture must exceed the spool's head and tail bounds");
  assert.equal(log, chunk.repeat(chunks), "every line-terminated record reached the log, in order");
  assert.equal(evidence.logComplete, true, "no record was replaced by an oversized-line marker");
  assert.equal(evidence.logOmittedChars, 0, "a spool drop must never be counted against the log");
  assert.equal(evidence.logOmittedLines, 0);
  assert.equal(evidence.spoolComplete, false, "the bounded spool must report its own truncation");
  assert.ok(evidence.spoolOmittedChars > 0);
  assert.ok(evidence.spoolOmittedChunks > 0);
  assert.equal(evidence.complete, false, "an assertion still may not run over truncated evidence");
  assert.throws(() => assertQuasarPerFailClosedOutput(evidence), /evidence is incomplete/);

  const omission = {
    label: "run local Quasar demo",
    logOmittedChars: evidence.logOmittedChars,
    logOmittedLines: evidence.logOmittedLines,
    spoolOmittedChars: evidence.spoolOmittedChars,
    spoolOmittedChunks: evidence.spoolOmittedChunks,
  };
  const [logClause, spoolClause] = summarizeEvidenceCompleteness([omission]).split("Assertion/display spool");

  assert.match(logClause, /Log: the line-terminated redacted child stream with nothing omitted/);
  assert.equal(
    logClause.includes(String(evidence.spoolOmittedChars)),
    false,
    "the receipt must not report the spool's dropped characters as log omission",
  );
  assert.match(
    spoolClause,
    new RegExp(`${evidence.spoolOmittedChars} char\\(s\\) in ${evidence.spoolOmittedChunks} chunk\\(s\\)`),
  );
  assert.match(spoolClause, /already written to the log/);
});

test("the receipt disclosure names each channel's loss separately", () => {
  assert.match(
    summarizeEvidenceCompleteness([]),
    /Log: the line-terminated redacted child stream with nothing omitted[\s\S]*spool: retained every step's output in full/,
  );

  const logOnly = summarizeEvidenceCompleteness([
    { label: "build programs", logOmittedChars: 4_096, logOmittedLines: 1, spoolOmittedChars: 0, spoolOmittedChunks: 0 },
  ]);
  assert.match(logOnly, /Log: 1 step\(s\) had records replaced by an oversized-line marker — build programs \(1 record\(s\), 4096 char\(s\)\)/);
  assert.match(logOnly, /spool: retained every step's output in full/);

  const both = summarizeEvidenceCompleteness([
    { label: "build programs", logOmittedChars: 4_096, logOmittedLines: 1, spoolOmittedChars: 0, spoolOmittedChunks: 0 },
    { label: "run demo", logOmittedChars: 0, logOmittedLines: 0, spoolOmittedChars: 1_000_000, spoolOmittedChunks: 3 },
  ]);
  const [logClause, spoolClause] = both.split("Assertion/display spool");
  assert.equal(logClause.includes("run demo"), false, "a spool-only truncation is not a log omission");
  assert.equal(spoolClause.includes("build programs"), false, "a marker-replaced record is not a spool truncation");
  assert.match(spoolClause, /run demo \(1000000 char\(s\) in 3 chunk\(s\)/);
  assert.match(both, /No assertion runs over a step either channel dropped from/);
});

test("an oversized unterminated record dropped before a step is aborted is still disclosed", () => {
  // The timeout/SIGINT sequence: the redactor replaces a megabyte-scale unterminated record with a
  // marker, the step is then aborted, and the FAIL summary still has to name the loss.
  const maxResidualChars = 1_000;
  const redactor = createRedactingLineBuffer({ maxResidualChars });
  const spool = createTruncatingEvidenceBuffer({});
  let log = "";
  const emit = (text) => {
    if (!text) return;
    log += text;
    spool.push(text);
  };

  emit(redactor.push("Target:   quasar\n"));
  emit(redactor.push(`{"err":"connect ECONNREFUSED","url":"https://api.devnet.solana.com",${"x".repeat(maxResidualChars)}`));
  // The abort path flushes whatever the redactors still hold before finalizing the record.
  emit(redactor.flush());

  const record = createStepEvidenceRecord(spool, [redactor], { logFile: "artifacts/surfpool-sdk-critical-smoke.log", logPersisted: true });

  assert.ok(log.includes(OVERSIZED_LOG_LINE_MARKER.trim()), "the log holds a marker where the record was");
  assert.equal(log.includes("api.devnet.solana.com"), false, "the dropped record never reached the log");
  assert.equal(record.completeness, "partial");
  assert.equal(record.complete, false);
  assert.equal(record.logOmittedLines, 1);
  assert.ok(record.logOmittedChars >= maxResidualChars);

  const disclosure = summarizeEvidenceCompleteness([{ label: "run local Quasar demo", ...record }]);
  assert.match(disclosure, /Log: 1 step\(s\) had records replaced by an oversized-line marker — run local Quasar demo \(1 record\(s\)/);
  assert.equal(disclosure.includes("nothing omitted"), false, "an aborted step's loss must not be published as a lossless log");
});

test("a step whose log write failed is disclosed as indeterminate, never as zero loss", () => {
  const redactor = createRedactingLineBuffer({});
  const spool = createTruncatingEvidenceBuffer({});
  spool.push(redactor.push("Target:   quasar\n"));
  spool.push(redactor.flush());

  const record = createStepEvidenceRecord(spool, [redactor], {
    logFile: "artifacts/surfpool-sdk-critical-smoke.log",
    logPersisted: false,
  });

  assert.equal(record.completeness, "indeterminate", "an append that failed leaves the file short by an unknown amount");
  assert.equal(record.complete, false, "completeness that cannot be proven must not be asserted over");
  assert.equal(record.logComplete, false);
  assert.equal(record.logPersisted, false);
  assert.equal(record.spoolComplete, true, "the in-memory spool is still intact and reported as such");

  assert.throws(
    () => assertQuasarPerFailClosedOutput(record),
    /writing to the log failed, so what reached disk is indeterminate and cannot be counted/,
  );

  const disclosure = summarizeEvidenceCompleteness([{ label: "build Quasar programs", ...record }]);
  assert.match(disclosure, /Log: writing to it failed during this run \(during build Quasar programs\)/);
  assert.match(disclosure, /no zero-loss count is claimed for it/);
  assert.equal(disclosure.includes("nothing omitted"), false);
  assert.match(disclosure, /spool: retained every step's output in full/, "the intact channel is still reported as intact");
});

test("a run-level log write failure is disclosed even when no step reported a loss", () => {
  // A banner write can fail outside any step, so the run-level flag has to reach the summary on its
  // own — otherwise an empty omission list publishes a lossless log for a truncated file.
  const disclosure = summarizeEvidenceCompleteness([], { logPersisted: false });

  assert.match(disclosure, /Log: writing to it failed during this run, so what reached disk is indeterminate/);
  assert.equal(disclosure.includes("nothing omitted"), false);
  assert.equal(disclosure.includes("(during "), false, "no step is named when the failure was not inside one");

  const both = summarizeEvidenceCompleteness(
    [{ label: "run demo", logPersisted: true, logOmittedChars: 4_096, logOmittedLines: 1, spoolOmittedChars: 0, spoolOmittedChunks: 0 }],
    { logPersisted: false },
  );
  assert.match(both, /indeterminate[\s\S]*separately, 1 step\(s\) had records replaced by an oversized-line marker before the log was reached — run demo \(1 record\(s\), 4096 char\(s\)\)/);
});

test("keypair redaction stops at the array and leaves a same-line prohibited hint detectable", () => {
  const keypair = `[${Array.from({ length: 64 }, (_, i) => i + 1).join(",")}]`;
  const hostileLine = `AGENT_A_KEYPAIR=${keypair} rpc=https://api.devnet.solana.com/v1 [attempt 1]\n`;

  const redactor = createRedactingLineBuffer({});
  const spool = createTruncatingEvidenceBuffer({});
  const emit = (text) => { if (text) spool.push(text); };
  emit(redactor.push(`
║       Reddi Agent Protocol — local-surfpool Demo ║
Target:   quasar
Escrow:   ${quasarIds.escrow}
Registry: ${quasarIds.registry}
Repute:   ${quasarIds.reputation}
Attest:   ${quasarIds.attestation}
`));
  emit(redactor.push(hostileLine));
  emit(redactor.push(`║  🏁  Full A→B→C cycle complete                          ║
  Settlement:      Quasar escrow public settlement
  ℹ️  MagicBlock PER/TEE is not claimed by this Quasar final path; no Anchor/PER fallback was used.
`));
  emit(redactor.flush());

  const evidence = createStepEvidenceRecord(spool, [redactor], { logFile: "artifacts/surfpool-sdk-critical-smoke.log" });

  assert.equal(evidence.complete, true, "redacting the secret is not an omission");
  assert.equal(evidence.text.includes("AGENT_A_KEYPAIR=["), false, "the keypair must not survive redaction");
  assert.equal(evidence.text.includes("1,2,3,4,5"), false, "the keypair bytes must not survive redaction");
  assert.equal(
    evidence.text.includes("api.devnet.solana.com"),
    true,
    "redaction must not swallow the rest of the line — the prohibited hint has to stay visible to the assertions",
  );
  assert.throws(
    () => assertQuasarCriticalDemoOutput(evidence, quasarIds),
    /devnet\/mainnet/,
  );
});

test("keypair redaction consumes only the bracketed literal, not later brackets on the line", () => {
  const redacted = redactForEvidence("AGENT_A_KEYPAIR=[1,2,3] Target:   legacy-anchor [attempt 1]");

  assert.equal(redacted.includes("AGENT_A_KEYPAIR"), false);
  assert.equal(redacted.includes("[1,2,3]"), false);
  assert.equal(redacted, "AGENT_KEYPAIR=<redacted> Target:   legacy-anchor [attempt 1]");
});

// Integration harness for the lane's real step runner: a temporary log file, the production
// `createEvidenceLogWriter`, and the production `spawnLoggedStep`. Every case below drives an actual
// child process through the same settlement path the smoke runner uses, and collects the disclosure
// with the same `collectStepEvidenceOmission` the runner passes as its `onRecord` sink.
const stepRunnerDirs = [];
after(() => {
  for (const dir of stepRunnerDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function stagedStepRunner(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-step-runner-"));
  stepRunnerDirs.push(dir);
  const logFile = path.join(dir, "surfpool-sdk-critical-smoke.log");
  fs.writeFileSync(logFile, "");
  const appends = [];
  const append = options.append ?? ((text) => fsp.appendFile(logFile, text));
  const logWriter = createEvidenceLogWriter((text) => {
    appends.push(text);
    return append(text);
  });
  const omissions = [];
  const records = [];
  const controller = new AbortController();
  const displayed = [];
  const run = (childSource, overrides = {}) => spawnLoggedStep({
    label: overrides.label ?? "step under test",
    command: process.execPath,
    commandArgs: ["-e", childSource],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" },
    signal: controller.signal,
    logWriter,
    logFile: "artifacts/surfpool-sdk-critical-smoke.log",
    display: (text) => displayed.push(text),
    onRecord: (label, record) => {
      records.push({ label, record });
      collectStepEvidenceOmission(omissions, label, record);
    },
    headLimit: overrides.headLimit ?? 512_000,
    tailLimit: overrides.tailLimit ?? 1_500_000,
    redactOptions: overrides.redactOptions ?? {},
    timeoutMs: overrides.timeoutMs ?? 30_000,
  });
  // Bounded: the child under test never exits on its own, so a wait with no deadline would turn a
  // regression in what reaches `display` into a hung job with a leaked detached process group.
  const waitForDisplayed = (needle, timeoutMs = 10_000) => new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      if (displayed.join("").includes(needle)) {
        clearInterval(poll);
        resolve(true);
      } else if (Date.now() >= deadline) {
        clearInterval(poll);
        resolve(false);
      }
    }, 20);
    poll.unref?.();
  });
  return { dir, logFile, logWriter, omissions, records, controller, displayed, appends, run, waitForDisplayed,
    logText: () => fs.readFileSync(logFile, "utf8"),
    summary: () => summarizeEvidenceCompleteness(omissions, { logPersisted: logWriter.persisted }) };
}

test("a step aborted after an oversized unterminated record still reports that loss to the run summary", async () => {
  const harness = stagedStepRunner();
  const maxResidualChars = 4_096;
  // An unterminated record larger than the residual bound, then a child that never exits: the
  // redactor replaces the record with a marker and the step has to be aborted.
  const childSource = `process.stdout.write("SECRET-HINT api.devnet.solana.com " + "x".repeat(${maxResidualChars * 2}));`
    + "setInterval(() => {}, 1000);";

  const stepPromise = harness.run(childSource, { redactOptions: { maxResidualChars }, label: "run local Quasar demo" });
  const sawMarker = await harness.waitForDisplayed(OVERSIZED_LOG_LINE_MARKER.trim());
  // Aborted either way, so the detached child is always reaped and the step always settles before
  // the assertions run.
  const abortReason = new Error("SIGINT received");
  abortReason.name = "SmokeInterruptError";
  harness.controller.abort(abortReason);

  await assert.rejects(stepPromise, (error) => {
    assert.equal(error.name, "SmokeInterruptError");
    return true;
  });

  assert.ok(sawMarker, "the oversized-record marker never reached the display within the deadline");

  assert.equal(harness.records.length, 1, "the aborted step must still finalize exactly one record");
  const [{ record }] = harness.records;
  assert.equal(record.complete, false);
  assert.equal(record.completeness, "partial");
  assert.equal(record.logOmittedLines, 1);
  assert.ok(record.logOmittedChars >= maxResidualChars);
  assert.equal(record.logPersisted, true);

  assert.equal(harness.logText().includes("api.devnet.solana.com"), false, "the dropped record never reached the log");
  assert.match(harness.logText(), new RegExp(OVERSIZED_LOG_LINE_MARKER.trim().replace(/[[\]]/g, "\\$&")));

  assert.equal(harness.omissions.length, 1, "the run summary must see the aborted step's loss");
  assert.match(harness.summary(), /Log: 1 step\(s\) had records replaced by an oversized-line marker — run local Quasar demo \(1 record\(s\)/);
  assert.equal(harness.summary().includes("nothing omitted"), false);
});

test("a multi-megabyte line-terminated step with a nonzero exit keeps the log whole and reports spool truncation", async () => {
  const harness = stagedStepRunner();
  const childSource = 'const chunk = ("  lane output ".repeat(6) + "\\n").repeat(800);'
    + "for (let i = 0; i < 50; i += 1) process.stdout.write(chunk);"
    + "process.exitCode = 3;";

  const result = await harness.run(childSource, { label: "run local Quasar demo" });

  assert.equal(result.status, 3, "a nonzero exit still resolves with the evidence record");
  const record = result.evidence;
  assert.ok(record.spoolOmittedChunks > 0, "the bounded spool must have truncated a 3 MB step");
  assert.ok(record.spoolOmittedChars > 0);
  assert.equal(record.logOmittedChars, 0, "nothing was dropped on the way to the log");
  assert.equal(record.logOmittedLines, 0);
  assert.equal(record.logComplete, true);
  assert.equal(record.logPersisted, true);
  assert.equal(record.completeness, "partial");

  const logged = harness.logText();
  assert.ok(logged.length >= 3_000_000, `every byte the child emitted reached the log; got ${logged.length}`);
  assert.equal(logged, harness.appends.join(""), "the log holds exactly the redacted stream, in order");
  assert.ok(logged.length > record.text.length, "the spool retained less than the log did");

  assert.equal(harness.omissions.length, 1);
  const summary = harness.summary();
  assert.match(summary, /Log: the line-terminated redacted child stream with nothing omitted/);
  assert.match(summary, /spool \(in-memory only; what it dropped was already written to the log\): truncated for 1 step\(s\)/);
});

test("a real log-writer failure marks the step indeterminate and reaches the summary before the rejection", async () => {
  const harness = stagedStepRunner({
    append: () => Promise.reject(Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" })),
  });

  const stepPromise = harness.run('process.stdout.write("Target:   quasar\\n");');

  await assert.rejects(stepPromise, /ENOSPC/);

  assert.equal(harness.records.length, 1, "the record is finalized before the rejection propagates");
  const [{ record }] = harness.records;
  assert.equal(record.logPersisted, false);
  assert.equal(record.completeness, "indeterminate");
  assert.equal(record.complete, false);
  assert.equal(record.spoolComplete, true, "the in-memory spool is intact and reported as such");
  assert.match(record.text, /Target:   quasar/);
  assert.equal(harness.logWriter.persisted, false);

  const summary = harness.summary();
  assert.match(summary, /Log: writing to it failed during this run \(during step under test\)/);
  assert.match(summary, /no zero-loss count is claimed for it/);
  assert.equal(summary.includes("nothing omitted"), false);
});

test("a step that cannot be spawned still finalizes and records its evidence", async () => {
  const harness = stagedStepRunner();
  await assert.rejects(
    spawnLoggedStep({
      label: "missing command",
      command: path.join(harness.dir, "does-not-exist"),
      commandArgs: [],
      cwd: harness.dir,
      env: { PATH: "" },
      signal: harness.controller.signal,
      logWriter: harness.logWriter,
      logFile: "artifacts/surfpool-sdk-critical-smoke.log",
      onRecord: (label, record) => {
        harness.records.push({ label, record });
        collectStepEvidenceOmission(harness.omissions, label, record);
      },
    }),
    /ENOENT/,
  );

  assert.equal(harness.records.length, 1, "a failed spawn settles exactly once");
  assert.equal(harness.records[0].record.completeness, "proven", "nothing was emitted, so nothing was lost");
  assert.equal(harness.omissions.length, 0, "a lossless step is not published as an omission");
});

// Every material combination of the three inputs the disclosure derives from. The contradiction the
// truth table exists to reject: a run may not recommend the log for spool-dropped bytes while also
// saying that log's persistence is unproven.
for (const logPersisted of [true, false]) {
  for (const spoolLoss of [true, false]) {
    for (const logLoss of [true, false]) {
      test(`the disclosure is consistent for logPersisted=${logPersisted} spoolLoss=${spoolLoss} logLoss=${logLoss}`, () => {
        const omissions = spoolLoss || logLoss || !logPersisted
          ? [{
            label: "run local Quasar demo",
            logPersisted,
            logOmittedChars: logLoss ? 4_096 : 0,
            logOmittedLines: logLoss ? 1 : 0,
            spoolOmittedChars: spoolLoss ? 1_000_000 : 0,
            spoolOmittedChunks: spoolLoss ? 3 : 0,
          }]
          : [];
        const summary = summarizeEvidenceCompleteness(omissions, { logPersisted });

        if (logPersisted) {
          assert.equal(summary.includes("indeterminate"), false);
          assert.equal(
            summary.includes("Log: the line-terminated redacted child stream with nothing omitted"),
            !logLoss,
          );
          assert.equal(summary.includes("had records replaced by an oversized-line marker"), logLoss);
          assert.equal(summary.includes("what it dropped was already written to the log"), spoolLoss);
        } else {
          assert.match(summary, /writing to it failed during this run/);
          assert.equal(summary.includes("nothing omitted"), false, "an unproven log may never be published as lossless");
          assert.equal(
            summary.includes("what it dropped was already written to the log"),
            false,
            "the spool clause may not recommend a log whose persistence is unproven",
          );
          if (spoolLoss) assert.match(summary, /whose persistence this run could not prove, so its coverage is indeterminate/);
        }

        assert.equal(summary.includes("spool: retained every step's output in full"), !spoolLoss);
        assert.match(summary, /No assertion runs over a step either channel dropped from/);
      });
    }
  }
}

test("the summary-failure notice redacts the paths a filesystem error carries", () => {
  // The hosted-runner shape: an absolute repository path and a home path inside an fs error, on the
  // one operator channel that reports a summary the run could not publish.
  const repoRoot = "/home/runner/work/rap/rap";
  const home = "/home/runner";
  const error = new Error(
    `EACCES: permission denied, mkdir '${repoRoot}/artifacts/surfpool-quasar-smoke/sdk-quasar-1234'`
    + ` (cache ${home}/.cache/solana)`,
  );

  const notice = describeSummaryPublicationFailure({
    error,
    summaryFile: "artifacts/surfpool-quasar-smoke/sdk-quasar-1234/SUMMARY.md",
    repoRoot,
    home,
  });

  assert.equal(notice.includes(repoRoot), false, "the absolute repository path must not reach the operator channel");
  assert.equal(notice.includes(home), false, "the absolute home path must not reach the operator channel");
  assert.match(notice, /<repo>\/artifacts\/surfpool-quasar-smoke/);
  assert.match(notice, /~\/\.cache\/solana/);
  assert.match(notice, /EACCES: permission denied/, "the diagnosis itself must survive redaction");
});

test("the summary-failure notice redacts key material and stays on one bounded line", () => {
  const keypair = `AGENT_A_KEYPAIR=[${Array.from({ length: 64 }, (_, i) => i + 1).join(",")}]`;
  const notice = describeSummaryPublicationFailure({
    error: new Error(`write failed while flushing ${keypair}\nsecond line\rthird line`),
    summaryFile: "artifacts/SUMMARY.md",
  });

  assert.equal(notice.includes("AGENT_A_KEYPAIR=["), false, "key material must not reach the operator channel");
  assert.match(notice, /AGENT_KEYPAIR=<redacted>/);
  assert.equal(notice.includes("\n"), false, "the notice must stay a single stderr line");
  assert.equal(notice.includes("\r"), false);
  assert.match(notice, /second line third line/, "collapsed lines are kept, not dropped");
});

test("an oversized summary-failure reason is truncated with the count it dropped", () => {
  const maxErrorChars = 200;
  const notice = describeSummaryPublicationFailure({
    error: new Error("x".repeat(5_000)),
    summaryFile: "artifacts/SUMMARY.md",
    maxErrorChars,
  });

  assert.ok(notice.length < 1_500, `the notice must stay bounded; got ${notice.length}`);
  assert.match(notice, /\[truncated 4800 character\(s\)\]/);
  assert.equal(notice.includes("x".repeat(maxErrorChars + 1)), false, "no more than the bound survives");
});

test("the summary-failure notice states the run's invariant and never guesses the file's state", () => {
  const notice = describeSummaryPublicationFailure({
    error: new Error("ENOSPC: no space left on device"),
    summaryFile: "artifacts/surfpool-quasar-smoke/sdk-quasar-1234/SUMMARY.md",
  });

  // Reaching this notice is only possible on a path that exits nonzero and published no receipt, so
  // those two are asserted; which summary is on disk was never observed, so all four states are
  // named as possible rather than one being claimed.
  assert.match(notice, /authoritative result is failure/);
  assert.match(notice, /has no citable accepted-evidence receipt, so it must not be accepted/);
  assert.match(notice, /may be absent, partial, stale from an earlier write in this run, or still report PASS/);
  assert.match(notice, /did not verify which/);
  assert.equal(
    notice.includes("is missing or partial"),
    false,
    "a PASS summary already durable on disk is neither missing nor partial, so it may not be claimed to be",
  );
  assert.match(notice, /artifacts\/surfpool-quasar-smoke\/sdk-quasar-1234\/SUMMARY\.md is untrusted/);
});

test("the summary-failure notice scrubs key material split across lines before joining them", () => {
  // redactForEvidence stops its keypair patterns at a line break — correct for a line-buffered log,
  // but here the collapse to one stderr line would otherwise reassemble the raw bytes afterwards.
  const bytes = Array.from({ length: 64 }, (_, i) => i + 1);
  for (const [label, breakSequence] of [["LF", "\n"], ["CRLF", "\r\n"], ["indented continuation", "\n\t"]]) {
    const labelled = `AGENT_A_KEYPAIR=[${bytes.slice(0, 20).join(",")},${breakSequence}${bytes.slice(20).join(",")}]`;
    const notice = describeSummaryPublicationFailure({
      error: new Error(`write failed while flushing ${labelled}`),
      summaryFile: "artifacts/SUMMARY.md",
    });

    assert.equal(notice.includes("AGENT_A_KEYPAIR=["), false, `${label}: the labelled keypair must not survive`);
    assert.equal(notice.includes("21,22,23"), false, `${label}: no run of key bytes may survive`);
    assert.match(notice, /AGENT_KEYPAIR=<redacted>/, `${label}: the redaction marker replaces it`);
  }
});

test("the summary-failure notice scrubs a bare byte array however its elements are spaced", () => {
  const bytes = Array.from({ length: 64 }, (_, i) => i + 1);
  for (const [label, separator] of [["newline", ",\n"], ["carriage return", ",\r\n"], ["spaces", ", "]]) {
    const array = `[${bytes.join(separator === ", " ? ", " : separator)}]`;
    const notice = describeSummaryPublicationFailure({
      error: new Error(`ENOSPC while writing ${array}`),
      summaryFile: "artifacts/SUMMARY.md",
    });

    assert.match(notice, /\[<redacted-bytes>\]/, `${label}: the array must be replaced`);
    assert.equal(notice.includes("60,61,62"), false, `${label}: no run of bytes may survive the collapse`);
  }
});

test("the summary-failure notice reports the publication outcome the run actually observed", () => {
  const build = (receiptOutcome) => describeSummaryPublicationFailure({
    error: new Error("EIO: simulated"),
    summaryFile: "artifacts/SUMMARY.md",
    receiptOutcome,
  });

  // The indeterminate path renamed this run's receipt into place and could not roll it back, so a
  // file may well remain; claiming none was published would be false, and the retained lock is the
  // only reason consumers still refuse it.
  const indeterminate = build(EVIDENCE_PUBLICATION_INDETERMINATE);
  assert.match(indeterminate, /An accepted-evidence file may remain on disk from this run/);
  assert.match(indeterminate, /state is indeterminate and the retained publication lock makes every consumer refuse it/);
  assert.equal(indeterminate.includes("published no receipt"), false, "a file may be on disk, so this may not be claimed");

  const rolledBack = build(EVIDENCE_PUBLICATION_ROLLED_BACK);
  assert.match(rolledBack, /published no receipt; the previously accepted receipt was durably restored/);

  const notPublished = build(EVIDENCE_PUBLICATION_NOT_PUBLISHED);
  assert.match(notPublished, /published no receipt and did not modify any accepted-evidence entry already on disk/);

  // Publication never ran, so nothing about a prior receipt may be claimed either way.
  const unattempted = build(null);
  assert.match(unattempted, /This run published no receipt it may cite\./);
  assert.equal(unattempted.includes("previously accepted receipt"), false);

  for (const notice of [indeterminate, rolledBack, notPublished, unattempted]) {
    assert.match(notice, /has no citable accepted-evidence receipt, so it must not be accepted/);
  }
});

test("the summary-failure notice never claims a quarantined prior entry was left alone", () => {
  // publishAcceptedEvidence returns not-published after moveAsideSync has already emptied the
  // canonical path, so this outcome alone does not mean nothing on disk changed.
  const quarantinedPriorEntry = {
    path: "artifacts/surfpool-quasar-smoke/.accepted-evidence.json.quarantined-abc123",
    reason: "the entry is not an ordinary file",
  };

  const withQuarantine = describeSummaryPublicationFailure({
    error: new Error("ENOSPC: no space left on device"),
    summaryFile: "artifacts/SUMMARY.md",
    receiptOutcome: EVIDENCE_PUBLICATION_NOT_PUBLISHED,
    quarantinedPriorEntry,
  });

  assert.equal(
    withQuarantine.includes("did not modify any accepted-evidence entry"),
    false,
    "the canonical entry was moved aside, so this run did modify what is on disk",
  );
  assert.match(withQuarantine, /moved aside remains quarantined at artifacts\/surfpool-quasar-smoke\/\.accepted-evidence\.json\.quarantined-abc123/);
  assert.match(withQuarantine, /the entry is not an ordinary file/);
  assert.match(withQuarantine, /has no citable accepted-evidence receipt, so it must not be accepted/);

  // The indeterminate transaction can quarantine too, and there both facts have to survive.
  const indeterminate = describeSummaryPublicationFailure({
    error: new Error("EIO: simulated"),
    summaryFile: "artifacts/SUMMARY.md",
    receiptOutcome: EVIDENCE_PUBLICATION_INDETERMINATE,
    quarantinedPriorEntry,
  });
  assert.match(indeterminate, /An accepted-evidence file may remain on disk from this run/);
  assert.match(indeterminate, /moved aside remains quarantined at/);

  // Publication never ran, so no disposition may be named at all.
  const unattempted = describeSummaryPublicationFailure({
    error: new Error("EIO: simulated"),
    summaryFile: "artifacts/SUMMARY.md",
  });
  assert.equal(unattempted.includes("quarantined"), false);
  assert.equal(unattempted.includes("did not modify"), false);
});

test("the summary-failure notice redacts a repository path containing whitespace", () => {
  // redactForEvidence substitutes repoRoot and home as literal strings, so it has to see the raw
  // message: collapsing whitespace first would leave a path like this unmatched and leak it.
  for (const [label, repoRoot] of [
    ["doubled space", "/home/runner/work/my  project/rap"],
    ["tab", "/home/runner/work/my\tproject/rap"],
    ["newline", "/home/runner/work/my\nproject/rap"],
  ]) {
    const home = "/home/build\tuser";
    const notice = describeSummaryPublicationFailure({
      error: new Error(`EACCES: permission denied, mkdir '${repoRoot}/artifacts/x' (home ${home}/.cache)`),
      summaryFile: "artifacts/SUMMARY.md",
      repoRoot,
      home,
    });

    assert.equal(notice.includes(repoRoot), false, `${label}: the raw repository path must not survive`);
    assert.equal(notice.includes(home), false, `${label}: the raw home path must not survive`);
    assert.match(notice, /<repo>\/artifacts\/x/, `${label}: the substitution still happened`);
    assert.match(notice, /~\/\.cache/, `${label}: the home substitution still happened`);
  }
});

test("the summary-failure notice survives a path, key material, and an oversized message together", () => {
  const repoRoot = "/home/runner/work/my  project/rap";
  const bytes = Array.from({ length: 64 }, (_, i) => i + 1);
  const notice = describeSummaryPublicationFailure({
    error: new Error(
      `EIO writing ${repoRoot}/artifacts/SUMMARY.md`
      + ` AGENT_B_KEYPAIR=[${bytes.slice(0, 30).join(",")},\n${bytes.slice(30).join(",")}]`
      + ` and [${bytes.join(",\r\n")}]`
      + ` ${"filler ".repeat(1_000)}`,
    ),
    summaryFile: "artifacts/SUMMARY.md",
    repoRoot,
    home: "/home/runner",
    receiptOutcome: EVIDENCE_PUBLICATION_NOT_PUBLISHED,
    maxErrorChars: 400,
  });

  assert.equal(notice.includes(repoRoot), false, "the whitespace-bearing path must not survive");
  assert.equal(notice.includes("AGENT_B_KEYPAIR=["), false, "the labelled keypair must not survive");
  assert.equal(notice.includes("31,32,33"), false, "no run of key bytes may survive");
  assert.equal(notice.includes("\n"), false, "the notice must stay one stderr line");
  assert.match(notice, /\[truncated \d+ character\(s\)\]/, "the reason is still bounded");
  assert.ok(notice.length < 1_200, `the notice must stay bounded; got ${notice.length}`);
  assert.match(notice, /must not be accepted/);
});

const RECEIPT_DISPOSITION_FIXTURE = {
  receiptPath: "artifacts/surfpool-quasar-smoke/accepted-evidence.json",
  lockPath: "artifacts/surfpool-quasar-smoke/.accepted-evidence.lock",
  receiptFilename: "accepted-evidence.json",
};

const QUARANTINE_REPO_ROOT = "/home/runner/work/reddi/rap";

// Defence in depth for the summary layer. Production sanitizes this reason upstream — the receipt
// layer's recordedUnusableReason already rewrites the absolute path Node embeds in an EACCES
// message — so no current caller hands the path through. These cases hold the summary layer to the
// same contract independently, so a future caller that skips the upstream pass cannot leak.
const QUARANTINED_PRIOR_ENTRY = {
  path: "artifacts/surfpool-quasar-smoke/.accepted-evidence.json.quarantined-abc123",
  reason: "it could not be read as accepted evidence (accepted-evidence.json could not be opened: EACCES: "
    + `permission denied, open '${QUARANTINE_REPO_ROOT}/artifacts/surfpool-quasar-smoke/accepted-evidence.json')`,
};

test("the FAIL summary never calls a quarantined prior entry untouched", () => {
  // publishAcceptedEvidence returns not-published after moveAsideSync already emptied the canonical
  // path, so this outcome alone does not mean the prior entry survived where it was.
  const quarantined = describeAcceptedReceiptDisposition({
    ...RECEIPT_DISPOSITION_FIXTURE,
    status: "FAIL",
    receiptOutcome: EVIDENCE_PUBLICATION_NOT_PUBLISHED,
    quarantinedPriorEntry: QUARANTINED_PRIOR_ENTRY,
    repoRoot: QUARANTINE_REPO_ROOT,
    home: "/home/runner",
  });

  assert.equal(
    quarantined.receiptLine.includes("left untouched"),
    false,
    "this run emptied the canonical path, so the receipt line may not claim otherwise",
  );
  assert.match(quarantined.receiptLine, /not published by this run \(accepted-evidence\.json could not be published\)/);
  assert.match(
    quarantined.priorEntryLine,
    /unusable \(it could not be read as accepted evidence[\s\S]*EACCES[\s\S]*\); publication moved it aside to artifacts\/surfpool-quasar-smoke\/\.accepted-evidence\.json\.quarantined-abc123/,
  );

  // Without a quarantine the settled wording stands: nothing on disk was moved.
  const untouched = describeAcceptedReceiptDisposition({
    ...RECEIPT_DISPOSITION_FIXTURE,
    status: "FAIL",
    receiptOutcome: EVIDENCE_PUBLICATION_NOT_PUBLISHED,
  });
  assert.match(untouched.receiptLine, /any previously accepted receipt is left untouched/);
  assert.equal(untouched.priorEntryLine, null, "no prior-entry line is emitted when nothing was moved");
});

// The self-contradiction this pair exists to prevent: one line may not report a prior entry as
// left alone while the next reports the same run as having moved it aside.
for (const receiptOutcome of [
  EVIDENCE_PUBLICATION_INDETERMINATE,
  EVIDENCE_PUBLICATION_ROLLED_BACK,
  EVIDENCE_PUBLICATION_NOT_PUBLISHED,
  null,
]) {
  for (const quarantinedPriorEntry of [QUARANTINED_PRIOR_ENTRY, null]) {
    test(`the receipt and prior-entry lines agree for outcome=${receiptOutcome} quarantined=${Boolean(quarantinedPriorEntry)}`, () => {
      const { receiptLine, priorEntryLine } = describeAcceptedReceiptDisposition({
        ...RECEIPT_DISPOSITION_FIXTURE,
        status: "FAIL",
        receiptOutcome,
        quarantinedPriorEntry,
        repoRoot: QUARANTINE_REPO_ROOT,
        home: "/home/runner",
      });

      assert.equal(
        Boolean(priorEntryLine),
        Boolean(quarantinedPriorEntry),
        "the prior-entry line appears exactly when an entry was quarantined",
      );
      if (quarantinedPriorEntry) {
        assert.equal(
          receiptLine.includes("left untouched"),
          false,
          "the receipt line may not contradict the prior-entry line",
        );
        assert.equal(
          priorEntryLine.includes(QUARANTINE_REPO_ROOT),
          false,
          "the absolute path the filesystem error carried may not reach the summary",
        );
        assert.match(priorEntryLine, /<repo>\/artifacts\/surfpool-quasar-smoke\/accepted-evidence\.json/);
        assert.match(priorEntryLine, /EACCES/, "the diagnosis itself survives redaction");
        assert.match(priorEntryLine, /^unusable \(/);
      }
      assert.equal(receiptLine.includes("undefined"), false);
    });
  }
}

test("a quarantine reason carrying key material or an oversized dump is bounded and scrubbed", () => {
  const bytes = Array.from({ length: 64 }, (_, i) => i + 1);
  const { priorEntryLine } = describeAcceptedReceiptDisposition({
    ...RECEIPT_DISPOSITION_FIXTURE,
    status: "FAIL",
    receiptOutcome: EVIDENCE_PUBLICATION_NOT_PUBLISHED,
    quarantinedPriorEntry: {
      path: "artifacts/surfpool-quasar-smoke/.accepted-evidence.json.quarantined-abc123",
      reason: `it could not be read: AGENT_A_KEYPAIR=[${bytes.join(",")}] at ${QUARANTINE_REPO_ROOT}/x `
        + "filler ".repeat(500),
    },
    repoRoot: QUARANTINE_REPO_ROOT,
    home: "/home/runner",
  });

  assert.equal(priorEntryLine.includes("AGENT_A_KEYPAIR=["), false, "key material may not reach the summary");
  assert.equal(priorEntryLine.includes(QUARANTINE_REPO_ROOT), false);
  assert.equal(priorEntryLine.includes("\n"), false, "the summary line stays one line");
  assert.match(priorEntryLine, /\[truncated \d+ character\(s\)\]/, "an unbounded reason is bounded");
  assert.ok(priorEntryLine.length < 700, `the line must stay bounded; got ${priorEntryLine.length}`);
});

// The summary's failure and cleanup sections carry filesystem error messages verbatim from Node.
// Every other line in that file avoids absolute paths by going through rel(); these are the two
// that cannot, so they are routed through the sanitizer instead.
const SUMMARY_ERROR_SHAPES = [
  {
    label: "missing build artifact",
    message: "ENOENT: no such file or directory, access "
      + "'/home/runner/work/reddi/rap/.tmp/surfpool-sdk-critical-smoke/sdk-quasar-1/deploy/escrow/quasar_escrow_poc.so'",
    survives: /ENOENT: no such file or directory/,
  },
  {
    label: "busy temporary directory",
    message: "tmp cleanup warning: EBUSY: resource busy or locked, rmdir "
      + "'/home/runner/work/reddi/rap/.tmp/surfpool-sdk-critical-smoke/sdk-quasar-1'",
    survives: /EBUSY: resource busy or locked/,
  },
  {
    label: "containment refusal",
    message: "RAP_SURFPOOL_CARGO_TARGET_DIR must stay inside the repository; got /home/runner/work/reddi/rap/../escape",
    survives: /must stay inside the repository/,
  },
];

for (const { label, message, survives } of SUMMARY_ERROR_SHAPES) {
  test(`a ${label} error reaches the summary without its absolute path`, () => {
    const repoRoot = "/home/runner/work/reddi/rap";
    const sanitized = sanitizeEvidenceFragment(message, { repoRoot, home: "/home/runner" });

    assert.equal(sanitized.includes(repoRoot), false, "the absolute repository path must not reach the summary");
    assert.equal(sanitized.includes("/home/runner"), false, "the absolute home path must not reach the summary");
    assert.match(sanitized, /<repo>\/|~\//, "the path is rewritten rather than dropped");
    assert.match(sanitized, survives, "the diagnosis itself survives");
  });
}

test("an untrusted summary fragment stays one bounded line and carries no key material", () => {
  const bytes = Array.from({ length: 64 }, (_, i) => i + 1);
  const sanitized = sanitizeEvidenceFragment(
    `cleanup warning: EIO\nAGENT_C_KEYPAIR=[${bytes.slice(0, 30).join(",")},\n${bytes.slice(30).join(",")}]\r\n`
    + "filler ".repeat(500),
    { repoRoot: "/repo", home: "/home/runner", maxChars: 300 },
  );

  assert.equal(sanitized.includes("AGENT_C_KEYPAIR=["), false, "key material may not reach the summary");
  assert.equal(sanitized.includes("31,32,33"), false, "no run of key bytes may survive the collapse");
  assert.equal(sanitized.includes("\n"), false, "a multi-line error may not break the summary's bullet list");
  assert.match(sanitized, /\[truncated \d+ character\(s\)\]/, "an unbounded message is bounded");
  assert.ok(sanitized.length < 400, `the fragment must stay bounded; got ${sanitized.length}`);
});

test("a PASS run cites the receipt path and reports no prior-entry disposition", () => {
  const passed = describeAcceptedReceiptDisposition({
    ...RECEIPT_DISPOSITION_FIXTURE,
    status: "PASS",
    quarantinedPriorEntry: QUARANTINED_PRIOR_ENTRY,
  });

  assert.equal(passed.receiptLine, RECEIPT_DISPOSITION_FIXTURE.receiptPath, "a PASS summary cites the receipt itself");
  assert.equal(passed.priorEntryLine, null, "the published receipt records its own quarantine, so the summary does not");
});

test("an indeterminate publication names the retained lock that makes consumers refuse", () => {
  const { receiptLine } = describeAcceptedReceiptDisposition({
    ...RECEIPT_DISPOSITION_FIXTURE,
    status: "FAIL",
    receiptOutcome: EVIDENCE_PUBLICATION_INDETERMINATE,
  });

  assert.match(receiptLine, /^INDETERMINATE: a receipt was renamed into artifacts\/surfpool-quasar-smoke\/accepted-evidence\.json/);
  assert.match(receiptLine, /must not be cited/);
  assert.match(receiptLine, /artifacts\/surfpool-quasar-smoke\/\.accepted-evidence\.lock makes every consumer refuse it/);
  assert.equal(receiptLine.includes("left untouched"), false);
});

test("a rolled-back publication reports the restored receipt", () => {
  const { receiptLine, priorEntryLine } = describeAcceptedReceiptDisposition({
    ...RECEIPT_DISPOSITION_FIXTURE,
    status: "FAIL",
    receiptOutcome: EVIDENCE_PUBLICATION_ROLLED_BACK,
  });

  assert.match(receiptLine, /the previously accepted receipt was durably restored/);
  assert.equal(receiptLine.includes("left untouched"), false, "restored is a different fact from untouched");
  assert.equal(priorEntryLine, null);
});

test("the summary-failure notice survives a thrown non-Error value", () => {
  const notice = describeSummaryPublicationFailure({ error: "raw string failure", summaryFile: "artifacts/SUMMARY.md" });
  assert.match(notice, /summary publication failed: raw string failure/);
  assert.match(notice, /must not be accepted/);
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

/*
 * If a hostile child emits one giant unterminated line, do not force-flush arbitrary text.
 * The whole record is omitted until its terminator arrives so a keypair split across the
 * size boundary cannot leak as a prefix/suffix that no regex can match.
 */
test("line-buffered redaction replaces oversized unterminated lines instead of force-flushing them", () => {
  const secretLine = `AGENT_A_KEYPAIR=[${Array.from({ length: 128 }, (_, i) => i + 1).join(",")}]`;
  const buffer = createRedactingLineBuffer({ maxResidualChars: 32 });

  let emitted = buffer.push(secretLine.slice(0, 40));
  emitted += buffer.push(secretLine.slice(40));
  emitted += buffer.flush();

  assert.equal(emitted, OVERSIZED_LOG_LINE_MARKER);
  assert.equal(emitted.includes("AGENT_A_KEYPAIR"), false);
  assert.equal(emitted.includes("1,2,3"), false);
});

/* Oversized-line recovery must discard only that one record, not all future output. */
test("line-buffered redaction resumes after an oversized line terminates", () => {
  const buffer = createRedactingLineBuffer({ maxResidualChars: 16 });
  let emitted = buffer.push("x".repeat(20));
  emitted += buffer.push(" still omitted\nnormal line\n");
  emitted += buffer.flush();

  assert.equal(emitted, `${OVERSIZED_LOG_LINE_MARKER}normal line\n`);
});

test("line-buffered redaction omits a complete oversized line even when its terminator arrives in the same chunk", () => {
  const buffer = createRedactingLineBuffer({ maxResidualChars: 16 });
  const emitted = buffer.push(`${"x".repeat(32)}\nnormal line\n`) + buffer.flush();

  assert.equal(emitted, `${OVERSIZED_LOG_LINE_MARKER}normal line\n`);
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
