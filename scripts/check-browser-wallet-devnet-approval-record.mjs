#!/usr/bin/env node
/**
 * Offline checker for single-use manual Devnet browser-wallet approval records.
 * It validates JSON only. It never installs/configures a wallet extension, opens a browser, reads or
 * parses secret material, requests faucet funds, signs, simulates, submits, confirms, or observes a transaction.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function asFile(path) {
  try {
    return statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}

function resolveTsCandidate(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    join(basePath, "index.ts"),
    basePath.endsWith(".js") ? basePath.replace(/\.js$/, ".ts") : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const file = asFile(candidate);
    if (file) return file;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const basePath = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
      const target = resolveTsCandidate(basePath);
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { BROWSER_WALLET_APPROVAL_VALIDATION_SCHEMA_VERSION, validateBrowserWalletApprovalRecord } = await import(
  pathToFileURL(join(rootDir, "packages", "agent-protocol", "src", "browser-wallet-approval.ts")).href
);

function parseArgs(argv) {
  const args = {
    approval: "",
    now: "",
    nowRequested: false,
    allowFutureAuddDevnet: false,
    help: false,
    unknown: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--approval") {
      args.approval = next ?? "";
      index += 1;
    } else if (arg === "--now") {
      args.now = next ?? "";
      args.nowRequested = true;
      index += 1;
    } else if (arg === "--allow-future-partner-confirmed-audd-devnet") {
      args.allowFutureAuddDevnet = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      args.unknown = arg;
      break;
    }
  }
  return args;
}

function resolveRepoPath(path) {
  if (!path) return "";
  return isAbsolute(path) ? path : join(rootDir, path);
}

function readJson(path, checks) {
  const fullPath = resolveRepoPath(path);
  if (!path || !existsSync(fullPath)) {
    checks.push({ id: "approval_record_present", ok: false, summary: "approval JSON file must exist" });
    return { read: false, value: null };
  }
  try {
    return { read: true, value: JSON.parse(readFileSync(fullPath, "utf8")) };
  } catch {
    checks.push({ id: "approval_json_parseable", ok: false, summary: "approval JSON must parse" });
    return { read: false, value: null };
  }
}

function help() {
  return [
    "Usage: node scripts/check-browser-wallet-devnet-approval-record.mjs --approval <approval.json> [--now <iso>]",
    "",
    "Offline fail-closed checker for manual single-use Devnet browser-wallet approval records.",
    "Passing means the approval artifact is internally consistent for human review only; it does not authorize or perform wallet/transaction activity.",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(help());
  process.exit(0);
}
if (args.unknown) {
  console.error(`[browser-wallet-devnet-approval] unknown argument: ${args.unknown}`);
  console.error(help());
  process.exit(1);
}

const checks = [];
const approval = readJson(args.approval, checks);
let now;
if (args.nowRequested) {
  if (args.now && Number.isFinite(Date.parse(args.now))) {
    now = args.now;
  } else {
    checks.push({ id: "now_parseable", ok: false, summary: "--now must be an exact parseable ISO timestamp" });
  }
}
if (approval.read) {
  const result = validateBrowserWalletApprovalRecord(approval.value, {
    now,
    allowFuturePartnerConfirmedAuddDevnet: args.allowFutureAuddDevnet,
  });
  if (result.ok) {
    checks.push({ id: "approval_schema", ok: true, summary: "approval record matches the browser-wallet single-use schema" });
  } else {
    for (const validationError of result.errors) {
      checks.push({
        id: `${validationError.code}:${validationError.path}`,
        ok: false,
        summary: validationError.message,
      });
    }
  }
}

const status = checks.length > 0 && checks.every((check) => check.ok) ? "approved_for_manual_review" : "blocked";
const artifact = {
  schemaVersion: BROWSER_WALLET_APPROVAL_VALIDATION_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  status,
  inputs: {
    approval: args.approval ? relative(rootDir, resolveRepoPath(args.approval)) : null,
    now: now ?? null,
    allowFuturePartnerConfirmedAuddDevnet: args.allowFutureAuddDevnet,
  },
  checks,
  blockers: checks.filter((check) => !check.ok).map((check) => check.id),
  guardrails: [
    "Offline validator only: no browser extension install/configuration, wallet creation/import/export/inspection/funding, faucet request, signer parsing, RPC call, simulation, submission, confirmation, or transaction observation occurs.",
    "Passing validation only proves the approval JSON is exact and internally consistent for manual review.",
    "Devnet browser-wallet actions remain unavailable by default and require a separate human approval/runbook before execution.",
    "Official AUDD Devnet remains unavailable unless future partner-confirmed mint/test-token evidence and a separate approval are supplied.",
  ],
};

console.log(JSON.stringify(artifact, null, 2));
process.exit(status === "approved_for_manual_review" ? 0 : 1);
