#!/usr/bin/env node
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

import {
  assertLocalOnlyEnvironment,
  assertQuasarCriticalDemoOutput,
  assertQuasarPerFailClosedOutput,
  assertQuasarProgramIdsMatchSources,
  assertionEvidenceText,
  createRedactingLineBuffer,
  createStepEvidenceRecord,
  baselinePath,
  createTruncatingEvidenceBuffer,
  localChildEnv,
  redactForEvidence,
  resolveRepositorySubpath,
  scheduleProcessGroupTermination,
  startLocalSurfnet,
  stopLocalSurfnetLease,
  summarizeEvidenceCompleteness,
  waitForPortClosed,
} from "./lib/surfpool-sdk-lifecycle.mjs";
import {
  ACCEPTED_EVIDENCE_FILENAME,
  ACCEPTED_EVIDENCE_LOCK_DIRNAME,
  EVIDENCE_PUBLICATION_INDETERMINATE,
  EVIDENCE_PUBLICATION_NOT_PUBLISHED,
  EVIDENCE_PUBLICATION_ROLLED_BACK,
  computeLaneSourceFingerprint,
  writeAcceptedEvidenceManifest,
} from "./lib/surfpool-evidence-manifest.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const defaultTimeoutMs = 20 * 60 * 1000;
const ASSERTION_HEAD_LIMIT = 512_000;
const ASSERTION_TAIL_LIMIT = 1_500_000;

const args = parseArgs(process.argv.slice(2));
const target = args.target ?? "legacy-anchor";
if (!["legacy-anchor", "quasar"].includes(target)) {
  console.error(`[surfpool-sdk-smoke] unsupported target: ${target}`);
  process.exit(2);
}

// Safety runs before importing/starting Surfpool, creating run directories, or
// invoking any tool that could touch networked validators.
try {
  assertLocalOnlyEnvironment(process.env);
} catch (error) {
  console.error(`[surfpool-sdk-smoke] local-only preflight failed: ${error.message}`);
  process.exit(1);
}

// Bind PASS evidence to the sources as they existed before any build, validator startup, or demo
// side effect. Publication recomputes the fingerprint and refuses the receipt if the working tree
// changed while the lane was running.
let preRunSourceFingerprint;
try {
  preRunSourceFingerprint = computeLaneSourceFingerprint(repoRoot, target);
} catch (error) {
  console.error(`[surfpool-sdk-smoke] source fingerprint preflight failed: ${error.message}`);
  process.exit(1);
}

const { Surfnet } = await import("@solana/surfpool");
const runId = `sdk-${target}-${crypto.randomUUID()}`;
const evidenceRoot = path.join(repoRoot, "artifacts", target === "quasar" ? "surfpool-quasar-smoke" : "surfpool-smoke");
const outDir = path.join(evidenceRoot, runId);
const tmpDir = path.join(repoRoot, ".tmp", "surfpool-sdk-critical-smoke", runId);
// Build output lives outside the per-run directory so cleanup does not delete it and CI can cache
// it. Ledger, runtime state, child TMPDIR, and logs stay per-run under tmpDir.
const cargoTargetRootRelative = path.join(".tmp", "surfpool-sdk-cargo-target");
const cargoTargetDir = resolveRepositorySubpath(
  repoRoot,
  process.env.RAP_SURFPOOL_CARGO_TARGET_DIR?.trim() || path.join(cargoTargetRootRelative, target),
  cargoTargetRootRelative,
  "RAP_SURFPOOL_CARGO_TARGET_DIR",
);
const childTmpDir = path.join(tmpDir, "tmp");
const logFile = path.join(outDir, "surfpool-sdk-critical-smoke.log");
const summaryFile = path.join(outDir, "SUMMARY.md");
const abortController = new AbortController();
const overallTimeoutMs = positiveInt(process.env.RAP_SURFPOOL_CRITICAL_TIMEOUT_MS, defaultTimeoutMs);
let activeChild;
let surfnetLease;
let cleanupStarted = false;
let exitCode = 0;
let exitReason = "success";
let finalStatus = "PASS";
let acceptedReceiptOutcome = null;
let quarantinedPriorReceipt = null;
let failureMessage;
let programs = [];
const cleanupNotes = [];
// Every step's reported evidence loss, so the published receipt discloses what the retained log is
// missing. Assertions refuse incomplete evidence, but unasserted steps still reach a PASS run.
const evidenceOmissions = [];
let logWriteChain = Promise.resolve();
let logWriteError;
// Sticky: takeLogWriteError() clears the transient error for control flow, but once an append has
// failed the file on disk is short by an unknown amount for the rest of the run, and every later
// disclosure has to say so instead of reporting a zero-loss count.
let logPersistenceFailed = false;

function appendToLog(text) {
  if (!text) return logWriteChain;
  logWriteChain = logWriteChain
    .then(() => fs.appendFile(logFile, text))
    .catch((error) => {
      logWriteError ??= error;
      logPersistenceFailed = true;
    });
  return logWriteChain;
}

function takeLogWriteError() {
  const error = logWriteError;
  logWriteError = undefined;
  return error;
}

const timeout = setTimeout(() => {
  const error = new Error(`critical Surfpool smoke timed out after ${overallTimeoutMs}ms`);
  error.name = "SmokeTimeoutError";
  abortController.abort(error);
  terminateActiveChild("SIGTERM");
}, overallTimeoutMs);
timeout.unref?.();

for (const signalName of ["SIGINT", "SIGTERM"]) {
  process.once(signalName, () => {
    const error = new Error(`${signalName} received`);
    error.name = "SmokeInterruptError";
    abortController.abort(error);
    terminateActiveChild("SIGTERM");
  });
}

try {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(childTmpDir, { recursive: true });
  await logLine(`[surfpool-sdk-smoke] run id: ${runId}`);
  await logLine(`[surfpool-sdk-smoke] target: ${target}`);
  await logLine(`[surfpool-sdk-smoke] artifact dir: ${rel(outDir)}`);

  await runStep("Verify pinned Solana/Anchor/Surfpool baseline metadata", "npm", ["run", "check:toolchain:baseline"]);
  if (target === "quasar") {
    await runStep("Verify Quasar critical assertions", "npm", ["run", "check:quasar:submission"]);
  }

  programs = target === "quasar" ? await quasarProgramDescriptors() : await legacyAnchorProgramDescriptors();
  await buildPrograms(programs);

  surfnetLease = await startLocalSurfnet(Surfnet, {
    readinessTimeoutMs: 20_000,
    signal: abortController.signal,
  });
  await logLine(`[surfpool-sdk-smoke] SDK Surfnet instance: ${surfnetLease.instanceId}`);
  await logLine(`[surfpool-sdk-smoke] RPC: ${surfnetLease.rpcUrl}`);
  await logLine(`[surfpool-sdk-smoke] WS: ${surfnetLease.wsUrl}`);
  await logLine(`[surfpool-sdk-smoke] readiness attempts: ${surfnetLease.readinessAttempts}`);

  for (const program of programs) {
    await logLine(`[surfpool-sdk-smoke] deploying ${program.label} as ${program.programId}`);
    const deployed = surfnetLease.surfnet.deploy({ programId: program.programId, soPath: program.soPath });
    if (deployed !== program.programId) {
      throw new Error(`SDK deploy returned ${deployed} for ${program.label}; expected ${program.programId}`);
    }
  }

  const agentEnv = await prepareAgentEnvironment(programs);
  const registerOutput = await runStep(
    target === "quasar" ? "Register demo agents through Quasar registry" : "Register demo agents through Anchor registry",
    process.execPath,
    ["-r", "ts-node/register", "packages/demo-agents/src/register-agents.ts"],
    { env: agentEnv, replaceEnv: true },
  );
  if (target === "quasar") assertQuasarRegistrationOutput(registerOutput, programIdsByKey(programs));

  const publicDemoOutput = await runStep(
    target === "quasar" ? "Run full Quasar public settlement/reputation/attestation demo" : "Run full Anchor public settlement/reputation/attestation demo",
    process.execPath,
    ["-r", "ts-node/register", "packages/demo-agents/src/demo.ts"],
    { env: { ...agentEnv, DEMO_SETTLEMENT_MODE: "public" }, replaceEnv: true },
  );

  if (target === "quasar") {
    assertQuasarCriticalDemoOutput(publicDemoOutput, programIdsByKey(programs));
    const failClosedOutput = await runStep(
      "Assert Quasar PER request fails closed without claiming MagicBlock PER/TEE",
      process.execPath,
      ["-r", "ts-node/register", "packages/demo-agents/src/demo.ts"],
      { env: { ...agentEnv, DEMO_SETTLEMENT_MODE: "magicblock_per", DEMO_ALLOW_FALLBACK: "false" }, replaceEnv: true, expectFailure: true },
    );
    assertQuasarPerFailClosedOutput(failClosedOutput);
  } else {
    assertAnchorCriticalDemoOutput(publicDemoOutput, programs[0].programId);
    const fallbackOutput = await runStep(
      "Run Anchor PER-unreachable fallback boundary on local Surfpool",
      process.execPath,
      ["-r", "ts-node/register", "packages/demo-agents/src/demo.ts"],
      { env: { ...agentEnv, DEMO_SETTLEMENT_MODE: "auto", DEMO_ALLOW_FALLBACK: "true", DEMO_STOP_AFTER_SETTLEMENT: "true" }, replaceEnv: true },
    );
    assertAnchorFallbackOutput(fallbackOutput);
  }

} catch (error) {
  exitReason = error.name === "SmokeTimeoutError" ? "timeout" : error.name === "SmokeInterruptError" ? "interrupt" : "failure";
  exitCode = exitReason === "timeout" ? 124 : exitReason === "interrupt" ? 130 : 1;
  finalStatus = "FAIL";
  failureMessage = error.message;
  await logLine(`[surfpool-sdk-smoke] FAIL (${exitReason}): ${error.message}`);
} finally {
  clearTimeout(timeout);
  await cleanup(exitReason);
  if (finalStatus === "PASS") {
    await logLine(`[surfpool-sdk-smoke] PASS evidence artifacts complete; preparing ${rel(summaryFile)}`);
    await logLine(`[surfpool-sdk-smoke] publishing accepted evidence receipt: ${rel(path.join(evidenceRoot, ACCEPTED_EVIDENCE_FILENAME))}`);
    await writeSummary({ target, programs, status: finalStatus, failure: failureMessage });
    if (!(await publishAcceptedEvidence())) {
      await writeSummary({ target, programs, status: finalStatus, failure: failureMessage });
    }
  } else {
    await logLine(`[surfpool-sdk-smoke] FAIL evidence retained at ${rel(outDir)}; accepted-evidence receipt left untouched`);
    await writeSummary({ target, programs, status: finalStatus, failure: failureMessage });
  }
}

process.exit(exitCode);

async function legacyAnchorProgramDescriptors() {
  const source = await fs.readFile(path.join(repoRoot, "programs/escrow/src/lib.rs"), "utf8");
  const declared = source.match(/declare_id!\("([^"]+)"\)/)?.[1];
  if (!declared) throw new Error("declare_id! not found in programs/escrow/src/lib.rs");
  return [
    {
      key: "escrow",
      label: "legacy Anchor escrow reference",
      manifest: "programs/escrow/Cargo.toml",
      packageTarget: "legacy-anchor",
      soName: "escrow",
      programId: declared,
    },
  ];
}

async function quasarProgramDescriptors() {
  const inventory = JSON.parse(await fs.readFile(path.join(repoRoot, "config/quasar/deployments.json"), "utf8"));
  const ids = inventory.quasarDeployments?.devnet?.programIds;
  assertQuasarProgramIdsMatchSources(repoRoot, ids);

  return [
    { key: "escrow", label: "Quasar escrow", manifest: "experiments/quasar-escrow/Cargo.toml", soName: "quasar_escrow_poc", programId: ids.escrow },
    { key: "registry", label: "Quasar registry", manifest: "experiments/quasar-registry/Cargo.toml", soName: "quasar_registry", programId: ids.registry },
    { key: "reputation", label: "Quasar reputation", manifest: "experiments/quasar-reputation/Cargo.toml", soName: "quasar_reputation", programId: ids.reputation },
    { key: "attestation", label: "Quasar attestation", manifest: "experiments/quasar-attestation/Cargo.toml", soName: "quasar_attestation", programId: ids.attestation },
  ];
}

async function buildPrograms(programs) {
  // One cargo target dir for every program: the Quasar crates share quasar-lang and build with fat
  // LTO, so a per-program dir would repeat the same release link work for no added isolation.
  await fs.mkdir(cargoTargetDir, { recursive: true });

  for (const program of programs) {
    const deployDir = path.join(tmpDir, "deploy", program.key);
    await fs.mkdir(deployDir, { recursive: true });
    await runStep(`Build ${program.label} SBF with reusable Cargo target cache`, "cargo", [
      "build-sbf",
      "--manifest-path",
      program.manifest,
      "--sbf-out-dir",
      deployDir,
    ], {
      env: {
        CARGO_TARGET_DIR: cargoTargetDir,
        SBF_OUT_PATH: deployDir,
      },
    });
    const soPath = path.join(deployDir, `${program.soName}.so`);
    await fs.access(soPath);
    program.soPath = soPath;
  }
}

async function prepareAgentEnvironment(programs) {
  const agentA = Keypair.generate();
  const agentB = Keypair.generate();
  const agentC = Keypair.generate();
  surfnetLease.surfnet.fundSolMany([agentA, agentB, agentC].map((agent) => ({
    address: agent.publicKey.toBase58(),
    lamports: 5 * LAMPORTS_PER_SOL,
  })));

  const ids = programIdsByKey(programs);
  const escrowId = ids.escrow;
  return localChildEnv({
    AGENT_A_KEYPAIR: JSON.stringify([...agentA.secretKey]),
    AGENT_B_KEYPAIR: JSON.stringify([...agentB.secretKey]),
    AGENT_C_KEYPAIR: JSON.stringify([...agentC.secretKey]),
    DEMO_DEVNET_RPC: surfnetLease.rpcUrl,
    DEMO_DEVNET_RPC_WS: surfnetLease.wsUrl,
    NEXT_PUBLIC_RPC_ENDPOINT: surfnetLease.rpcUrl,
    NEXT_PUBLIC_RPC_URL: surfnetLease.rpcUrl,
    NEXT_PUBLIC_RPC_WS_ENDPOINT: surfnetLease.wsUrl,
    ANCHOR_PROVIDER_URL: surfnetLease.rpcUrl,
    SOLANA_URL: surfnetLease.rpcUrl,
    DEMO_PER_RPC: "http://127.0.0.1:1",
    NEXT_PUBLIC_PER_RPC: "http://127.0.0.1:1",
    DEMO_ESCROW_PROGRAM_ID: escrowId,
    NEXT_PUBLIC_ESCROW_PROGRAM_ID: escrowId,
    DEMO_REGISTRY_PROGRAM_ID: ids.registry ?? escrowId,
    NEXT_PUBLIC_REGISTRY_PROGRAM_ID: ids.registry ?? escrowId,
    DEMO_REPUTATION_PROGRAM_ID: ids.reputation ?? escrowId,
    NEXT_PUBLIC_REPUTATION_PROGRAM_ID: ids.reputation ?? escrowId,
    DEMO_ATTESTATION_PROGRAM_ID: ids.attestation ?? escrowId,
    NEXT_PUBLIC_ATTESTATION_PROGRAM_ID: ids.attestation ?? escrowId,
    DEMO_PROGRAM_TARGET: target,
    HACKATHON_DEMO_TARGET: target,
    NEXT_PUBLIC_DEMO_PROGRAM_TARGET: target,
    NETWORK_PROFILE: "local-surfpool",
    NEXT_PUBLIC_NETWORK_PROFILE: "local-surfpool",
    DEMO_ALLOW_FALLBACK: "true",
    DEMO_PAYMENTS_CLUSTER: "local-surfpool",
    DEMO_PAYMENTS_API_BASE_URL: "http://127.0.0.1:1",
    DEMO_PRIVATE_MINT: "",
    DEMO_STOP_AFTER_SETTLEMENT: "false",
    JUPITER_API_KEY: "",
    JUPITER_API_BASE: "http://127.0.0.1:1",
    TS_NODE_PROJECT: "packages/demo-agents/tsconfig.json",
    TS_NODE_TRANSPILE_ONLY: "true",
  }, { repoRoot, childTmpDir });
}

// The disclosure belongs to whoever owns the buffers, not to a caller's success path: a step that
// times out, is interrupted, or fails to spawn drops output exactly the same way, and its loss has
// to reach the summary even though nothing is ever returned to runStep.
function recordStepEvidence(label, evidence) {
  if (evidence.complete === true) return evidence;
  evidenceOmissions.push({
    label,
    logPersisted: evidence.logPersisted,
    logOmittedChars: evidence.logOmittedChars,
    logOmittedLines: evidence.logOmittedLines,
    spoolOmittedChars: evidence.spoolOmittedChars,
    spoolOmittedChunks: evidence.spoolOmittedChunks,
  });
  return evidence;
}

async function runStep(label, command, commandArgs, options = {}) {
  const expectFailure = options.expectFailure ?? false;
  await logLine("");
  await logLine(`[surfpool-sdk-smoke] >>> ${label}`);
  const output = await spawnLogged(label, command, commandArgs, options);
  if (expectFailure ? output.status === 0 : output.status !== 0) {
    const expectation = expectFailure ? "expected failure but command succeeded" : `command failed with exit ${output.status}`;
    throw new Error(`${label}: ${expectation}`);
  }
  return output.evidence;
}

function spawnLogged(label, command, commandArgs, options = {}) {
  const commandTimeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const childEnv = options.replaceEnv
    ? { ...(options.env ?? {}) }
    : {
        ...process.env,
        PATH: baselinePath({ repoRoot }),
        npm_config_audit: "false",
        npm_config_fund: "false",
        ...(options.env ?? {}),
      };
  return new Promise((resolve, reject) => {
    if (abortController.signal.aborted) return reject(abortController.signal.reason);
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: childEnv,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    const evidence = createTruncatingEvidenceBuffer({
      headLimit: ASSERTION_HEAD_LIMIT,
      tailLimit: ASSERTION_TAIL_LIMIT,
      describeOmission: (chars, count) =>
        `\n[surfpool-sdk-smoke] evidence buffer truncated: omitted ${chars} characters in ${count} chunk(s) between the retained head and tail; `
        + `the retained output is in ${rel(logFile)}, which is itself redacted and may replace an oversized unterminated record with a marker. `
        + `No step assertion runs over evidence any stage dropped from — it is refused instead\n`,
    });
    let abortedReason;
    const commandTimer = setTimeout(() => {
      abortedReason = new Error(`${command} ${commandArgs.join(" ")} timed out after ${commandTimeoutMs}ms`);
      abortedReason.name = "SmokeTimeoutError";
      terminateChild(child, "SIGTERM");
    }, commandTimeoutMs);
    commandTimer.unref?.();
    const onAbort = () => {
      abortedReason = abortController.signal.reason ?? new Error("aborted");
      terminateChild(child, "SIGTERM");
    };
    abortController.signal.addEventListener("abort", onAbort, { once: true });

    const emit = (text) => {
      if (!text) return;
      appendToLog(text);
      process.stdout.write(text);
      evidence.push(text);
    };
    // Redaction is line-buffered per stream so a secret split across two pipe
    // chunks is still matched before anything reaches stdout or the evidence log.
    const streamBuffers = [];
    const attachStream = (stream) => {
      const buffer = createRedactingLineBuffer({ repoRoot, home: process.env.HOME });
      streamBuffers.push(buffer);
      stream.on("data", (chunk) => emit(buffer.push(chunk)));
    };
    const flushStreams = () => {
      for (const buffer of streamBuffers) emit(buffer.flush());
    };
    attachStream(child.stdout);
    attachStream(child.stderr);
    // Every terminal path settles the same way: stop the timers, flush what the redactors still
    // hold, wait for the queued log writes, then finalize exactly one evidence record. Only after
    // the record is recorded does the outcome decide between resolve and reject.
    let settlement;
    const settle = () => {
      // 'error' and 'close' can both fire for the same child; the record — and the flush that feeds
      // it — must happen exactly once.
      if (settlement) return settlement;
      clearTimeout(commandTimer);
      abortController.signal.removeEventListener("abort", onAbort);
      cancelPendingEscalations(child);
      flushStreams();
      if (activeChild === child) activeChild = undefined;
      settlement = logWriteChain.then(() => {
        const logError = takeLogWriteError();
        const record = recordStepEvidence(
          label,
          createStepEvidenceRecord(evidence, streamBuffers, {
            logFile: rel(logFile),
            logPersisted: !logPersistenceFailed,
          }),
        );
        return { logError, record };
      });
      return settlement;
    };
    child.once("error", (error) => {
      settle().then(() => reject(error), () => reject(error));
    });
    child.once("close", (code, signal) => {
      settle()
        .then(({ logError, record }) => {
          if (logError) return reject(logError);
          if (abortedReason) return reject(abortedReason);
          return resolve({
            status: code ?? (signal ? 128 + (signal === "SIGINT" ? 2 : 15) : 1),
            signal,
            evidence: record,
          });
        })
        .catch(reject);
    });
  });
}

async function cleanup(reason) {
  if (cleanupStarted) return;
  cleanupStarted = true;
  terminateActiveChild("SIGTERM");
  if (surfnetLease) {
    const rpcUrl = surfnetLease.rpcUrl;
    const wsUrl = surfnetLease.wsUrl;
    try {
      await stopLocalSurfnetLease(surfnetLease, { attempts: 2, retryDelayMs: 100 });
      await waitForPortClosed(rpcUrl, { timeoutMs: 5_000 });
      await waitForPortClosed(wsUrl, { timeoutMs: 5_000 });
      cleanupNotes.push("SDK Surfnet stopped and dynamic RPC/WS ports closed");
    } catch (error) {
      const message = `cleanup warning: ${error.message}`;
      cleanupNotes.push(message);
      if (exitCode === 0) exitCode = 1;
      finalStatus = "FAIL";
      failureMessage ??= message;
    }
  }
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
    cleanupNotes.push(`isolated per-run runtime directory removed (reusable build cache at ${rel(cargoTargetDir)} retained)`);
  } catch (error) {
    const message = `tmp cleanup warning: ${error.message}`;
    cleanupNotes.push(message);
    if (exitCode === 0) exitCode = 1;
    finalStatus = "FAIL";
    failureMessage ??= message;
  }
  await logLine(`[surfpool-sdk-smoke] cleanup (${reason}): ${cleanupNotes.join("; ") || "complete"}`);
}

function terminateActiveChild(signal) {
  if (activeChild) terminateChild(activeChild, signal);
}

function terminateChild(child, signal) {
  const escalation = scheduleProcessGroupTermination(child, signal);
  (child.rapEscalations ??= []).push(escalation);
}

function cancelPendingEscalations(child) {
  for (const escalation of child.rapEscalations ?? []) escalation.cancel();
  child.rapEscalations = [];
}

/**
 * Operator notice for something learned *after* the receipt was published. It goes to stdout only:
 * the evidence log is a cited artifact whose hash the receipt records, so appending to it here
 * would invalidate the very receipt this run just published.
 */
function noteAfterPublication(line) {
  process.stdout.write(`${redactForEvidence(line, { repoRoot, home: process.env.HOME })}\n`);
}

async function logLine(line) {
  const text = `${redactForEvidence(line, { repoRoot, home: process.env.HOME })}\n`;
  process.stdout.write(text);
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  await appendToLog(text);
  const error = takeLogWriteError();
  if (error) throw error;
}

/**
 * The receipt line is the judge-facing claim about what is on disk, so it may only state what the
 * publication actually proved. A PASS summary is written before publication and hashed into the
 * receipt, so it must not be rewritten on success; every other wording belongs to a run already
 * reported FAIL.
 */
function acceptedReceiptSummaryLine(status) {
  const receiptPath = rel(path.join(evidenceRoot, ACCEPTED_EVIDENCE_FILENAME));
  if (status === "PASS") return receiptPath;
  switch (acceptedReceiptOutcome) {
    case EVIDENCE_PUBLICATION_INDETERMINATE:
      return `INDETERMINATE: a receipt was renamed into ${receiptPath} and could neither be durably published nor rolled back, so what is on disk is unknown and must not be cited; the publication lock retained at ${rel(path.join(evidenceRoot, ACCEPTED_EVIDENCE_LOCK_DIRNAME))} makes every consumer refuse it until an operator resolves it`;
    case EVIDENCE_PUBLICATION_ROLLED_BACK:
      return `not published by this run (${ACCEPTED_EVIDENCE_FILENAME} could not be durably published); the previously accepted receipt was durably restored`;
    case EVIDENCE_PUBLICATION_NOT_PUBLISHED:
      return `not published by this run (${ACCEPTED_EVIDENCE_FILENAME} could not be published); any previously accepted receipt is left untouched`;
    default:
      return `not written (only PASS runs publish ${ACCEPTED_EVIDENCE_FILENAME}); any previously accepted receipt is left untouched`;
  }
}

async function writeSummary({ target, programs = [], status, failure }) {
  const lines = [
    `# Surfpool SDK ${target === "quasar" ? "Quasar" : "Anchor"} Critical Smoke Summary`,
    "",
    `- Status: ${status}`,
    "- Lifecycle: `@solana/surfpool` SDK `Surfnet.startWithConfig({ offline: true, airdropSol: 0, blockProductionMode: \"transaction\" })`",
    "- Network boundary: local SDK Surfnet only; no remote datasource, live RPC, wallet file, upgrade authority, or installed Surfpool source patching",
    surfnetLease ? `- RPC: ${surfnetLease.rpcUrl}` : "- RPC: not started",
    surfnetLease ? `- WS: ${surfnetLease.wsUrl}` : "- WS: not started",
    surfnetLease ? `- Surfnet instance: ${surfnetLease.instanceId}` : "- Surfnet instance: not started",
    "- Temporary state: isolated under `.tmp/surfpool-sdk-critical-smoke/<run-id>` and removed during cleanup",
    `- Build cache: reusable Cargo target dir at ${rel(cargoTargetDir)} (retained across runs; not per-run state)`,
    "- External Surfpool service process: none (in-process SDK lifecycle)",
    "",
    "## Programs deployed locally",
  ];
  for (const program of programs) {
    lines.push(`- ${program.label}: ${program.programId}${program.soPath ? ` from ${rel(program.soPath)}` : ""}`);
  }
  if (failure) {
    lines.push("", "## Failure", `- ${failure}`);
  }
  lines.push("", "## Cleanup", ...cleanupNotes.map((note) => `- ${note}`));
  lines.push("", "## Artifacts", `- Log: ${rel(logFile)}`);
  lines.push(`- Evidence completeness: ${summarizeEvidenceCompleteness(evidenceOmissions, { logPersisted: !logPersistenceFailed })}`);
  lines.push(`- Accepted evidence receipt: ${acceptedReceiptSummaryLine(status)}`);
  // Only ever from the outcome publication produced under its lock: a pre-publication observation of
  // the receipt path can be overtaken by a concurrent publisher, and this summary is immutable once
  // the receipt records its hash.
  if (status !== "PASS" && quarantinedPriorReceipt) {
    lines.push(
      `- Prior accepted evidence entry: unusable (${quarantinedPriorReceipt.reason}); publication moved it aside to ` +
      `${quarantinedPriorReceipt.path}`,
    );
  }
  if (status !== "PASS") {
    lines.push(`- Failed run evidence retained at: ${rel(outDir)}`);
  }
  await fs.mkdir(path.dirname(summaryFile), { recursive: true });
  await fs.writeFile(summaryFile, `${lines.join("\n")}\n`);
}

async function publishAcceptedEvidence() {
  try {
    if (takeLogWriteError()) throw new Error("evidence log write failed before publication");

    const artifacts = [
      { name: "summary", path: rel(summaryFile) },
      { name: "log", path: rel(logFile) },
    ];
    const sourceFingerprint = preRunSourceFingerprint;
    for (const artifact of artifacts) {
      const handle = await fs.open(path.join(repoRoot, artifact.path), "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }

    const published = await writeAcceptedEvidenceManifest(evidenceRoot, {
      target,
      runId,
      status: "PASS",
      repoRoot,
      manifestRelativeDir: rel(evidenceRoot),
      sourceFingerprint,
      artifacts,
      provenance: {
        command: target === "quasar" ? "npm run test:surfpool:quasar-critical" : "npm run test:surfpool:critical",
        runner: rel(__filename),
        lifecycle: "@solana/surfpool SDK in-process Surfnet (loopback only)",
      },
    });
    quarantinedPriorReceipt = published.quarantinedPriorEntry;
    if (quarantinedPriorReceipt) {
      noteAfterPublication(
        `[surfpool-sdk-smoke] the previous ${ACCEPTED_EVIDENCE_FILENAME} was unusable ` +
        `(${quarantinedPriorReceipt.reason}) and is retained for inspection at ${quarantinedPriorReceipt.path}`,
      );
    }
    if (published.cleanupFailures.length > 0) {
      noteAfterPublication(
        `[surfpool-sdk-smoke] the receipt at ${rel(published.manifestPath)} is published and durable, but publication ` +
        `cleanup failed: ${published.cleanupFailures.join("; ")}` +
        (published.lockRetained
          ? `. The publication lock at ${rel(path.join(evidenceRoot, ACCEPTED_EVIDENCE_LOCK_DIRNAME))} is retained, so every consumer refuses this receipt until an operator removes it`
          : ""),
      );
    }
    return true;
  } catch (error) {
    finalStatus = "FAIL";
    failureMessage ??= `accepted evidence receipt failed: ${error.message}`;
    if (exitCode === 0) exitCode = 1;
    acceptedReceiptOutcome = error.publicationOutcome ?? EVIDENCE_PUBLICATION_NOT_PUBLISHED;
    quarantinedPriorReceipt = error.quarantinedPriorEntry ?? null;
    const receiptState = acceptedReceiptSummaryLine("FAIL");
    try {
      await logLine(`[surfpool-sdk-smoke] accepted evidence receipt failed: ${error.message}; ${receiptState}`);
    } catch { /* the run already failed; log loss must not mask it */ }
    return false;
  }
}

function programIdsByKey(programs) {
  return Object.fromEntries(programs.map((program) => [program.key, program.programId]));
}

function assertQuasarRegistrationOutput(output, ids) {
  const text = assertionEvidenceText(output, "Quasar registration output");
  if (!text.includes(`Program: ${ids.registry}`) || !text.includes("Target: quasar") || !text.includes("Registration complete") || !text.includes("local-surfpool")) {
    throw new Error("Quasar registration output did not prove registration through the explicit local registry program ID/profile");
  }
  if (/cluster=devnet|api\.devnet\.solana\.com|api\.mainnet-beta\.solana\.com/i.test(text)) {
    throw new Error("Quasar registration output included live-network explorer/RPC hints instead of local custom endpoints");
  }
}

function assertAnchorCriticalDemoOutput(output, programId) {
  const text = assertionEvidenceText(output, "Anchor critical demo output");
  if (!text.includes("Target:   legacy-anchor") || !text.includes(`Escrow:   ${programId}`) || !text.includes("Full A→B→C cycle complete")) {
    throw new Error("Anchor critical demo output did not prove the expected local Anchor path");
  }
  if (!text.includes("Settlement:      L1 direct (public/fallback)")) {
    throw new Error("Anchor public settlement summary missing");
  }
}

function assertAnchorFallbackOutput(output) {
  const text = assertionEvidenceText(output, "Anchor PER fallback output");
  if (!text.includes("PER unavailable") || !text.includes("L1 fallback used")) {
    throw new Error("Anchor PER fallback output did not prove local fallback boundary");
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") parsed.target = argv[++i];
    else if (arg.startsWith("--target=")) parsed.target = arg.slice("--target=".length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function positiveInt(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function rel(absolutePath) {
  return path.relative(repoRoot, absolutePath) || ".";
}
