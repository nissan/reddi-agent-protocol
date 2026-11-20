#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const outDir = join(
  rootDir,
  "artifacts",
  "marketplace-demo-readiness",
  timestamp,
);
mkdirSync(outDir, { recursive: true });

const args = new Set(process.argv.slice(2));
const includeDevnet = args.has("--include-devnet");
const skipSurfpool = args.has("--skip-surfpool");
const skipRecording = args.has("--skip-recording");
const planOnly = args.has("--plan-only");

const steps = [
  {
    id: "bdd_conversion",
    label: "BDD conversion journeys",
    command: "npm",
    args: [
      "run",
      "test:e2e:marketplace-conversion",
      "--",
      "--project=chromium",
    ],
    required: true,
  },
  {
    id: "recording_journey",
    label: "Playwright recording journey",
    command: "npm",
    args: ["run", "test:e2e:marketplace-recording", "--", "--project=chromium"],
    required: !skipRecording,
    skipped: skipRecording,
  },
  {
    id: "rap_mcp_surfpool_local",
    label: "RAP MCP bridge Surfpool local proof",
    command: "npm",
    args: ["run", "smoke:rap-mcp-bridge:surfpool-local"],
    required: !skipSurfpool,
    skipped: skipSurfpool,
  },
  {
    id: "onboarding_attestation_surfpool",
    label: "Onboarding/attestation Surfpool smoke",
    command: "npm",
    args: ["run", "test:surfpool:onboarding"],
    required: !skipSurfpool,
    skipped: skipSurfpool,
  },
  {
    id: "bounded_devnet_proof",
    label: "Bounded devnet proof (opt-in)",
    command: "npm",
    args: ["run", "smoke:rap-mcp-bridge:devnet-proof"],
    required: includeDevnet,
    skipped: !includeDevnet,
  },
];

function findFiles(dir, predicate, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) findFiles(full, predicate, acc);
    else if (predicate(full, stat))
      acc.push({ path: full, mtimeMs: stat.mtimeMs });
  }
  return acc;
}

function copyLatestRecordingArtifact() {
  const testResultsDir = join(rootDir, "test-results");
  const videos = findFiles(
    testResultsDir,
    (file) =>
      file.includes("marketplace-recording") && file.endsWith("video.webm"),
  ).sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (videos.length === 0) return null;
  const dest = join(outDir, "marketplace-recording.webm");
  cpSync(videos[0].path, dest);
  return { sourcePath: videos[0].path, artifactPath: dest };
}

function runStep(step) {
  return new Promise((resolve) => {
    const logPath = join(outDir, `${step.id}.log`);
    if (step.skipped || !step.required) {
      writeFileSync(logPath, `[marketplace-readiness] skipped ${step.label}\n`);
      resolve({ ...step, status: "skipped", code: 0, logPath });
      return;
    }
    const child = spawn(step.command, step.args, {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      chunks.push(chunk);
    });
    child.on("close", (code) => {
      writeFileSync(logPath, Buffer.concat(chunks));
      resolve({ ...step, status: code === 0 ? "pass" : "fail", code, logPath });
    });
  });
}

async function main() {
  const summary = {
    schemaVersion: "reddi.marketplace-demo-readiness.v1",
    generatedAt: new Date().toISOString(),
    outDir,
    mode: includeDevnet ? "local_plus_bounded_devnet" : "local_first_no_devnet",
    guardrails: [
      "BDD conversion journeys must pass before recording collateral is trusted",
      "Surfpool local validator gates must pass before bounded devnet proof",
      "Devnet proof is opt-in with --include-devnet",
      "No mainnet execution",
      "Recording script must be based on captured UI and artifacts, not aspirational copy",
    ],
    steps: [],
  };

  if (planOnly) {
    summary.steps = steps.map((step) => ({
      id: step.id,
      label: step.label,
      command: `${step.command} ${step.args.join(" ")}`,
      skipped: step.skipped || !step.required,
    }));
    writeFileSync(
      join(outDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  for (const step of steps) {
    console.log(`\n[marketplace-readiness] >>> ${step.label}`);
    const result = await runStep(step);
    summary.steps.push({
      id: result.id,
      label: result.label,
      status: result.status,
      code: result.code,
      logPath: result.logPath,
    });
    writeFileSync(
      join(outDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    if (result.status === "fail") {
      console.error(
        `[marketplace-readiness] FAIL ${step.id}; see ${result.logPath}`,
      );
      process.exit(result.code || 1);
    }
  }

  const ok = summary.steps.every(
    (step) => step.status === "pass" || step.status === "skipped",
  );
  summary.recordingArtifact = copyLatestRecordingArtifact();
  summary.ok = ok;
  summary.next = includeDevnet
    ? "Use Playwright video artifacts plus readiness summary to draft onboarding/hackathon demo script."
    : "Review Surfpool artifacts, then rerun with --include-devnet only when bounded devnet proof is approved/desired.";
  writeFileSync(
    join(outDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  writeFileSync(
    join(outDir, "SUMMARY.md"),
    `# Marketplace Demo Readiness\n\n- OK: ${ok}\n- Mode: ${summary.mode}\n- Generated: ${summary.generatedAt}\n- Output: ${outDir}\n- Recording artifact: ${summary.recordingArtifact?.artifactPath ?? "not captured"}\n\n## Steps\n\n${summary.steps.map((step) => `- ${step.status}: ${step.label} (${step.id})`).join("\n")}\n\n## Next\n\n${summary.next}\n`,
  );
  console.log(
    JSON.stringify(
      { ok, outDir, summaryPath: join(outDir, "summary.json") },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
