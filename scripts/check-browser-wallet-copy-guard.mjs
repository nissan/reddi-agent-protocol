#!/usr/bin/env node
/** Offline executable guard for browser-wallet AUDD identity/copy rows. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDir = join(rootDir, "scripts", "fixtures", "browser-wallet-copy-guard");

function asFile(path) {
  try {
    return statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}
function resolveTsCandidate(basePath) {
  for (const candidate of [basePath, `${basePath}.ts`, join(basePath, "index.ts"), basePath.endsWith(".js") ? basePath.replace(/\.js$/, ".ts") : null].filter(Boolean)) {
    const file = asFile(candidate);
    if (file) return file;
  }
  return null;
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const target = resolveTsCandidate(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { BROWSER_WALLET_IDENTITY_COPY_GUARD_SCHEMA_VERSION, validateBrowserWalletIdentityCopyClaims } = await import(
  pathToFileURL(join(rootDir, "packages", "agent-protocol", "src", "browser-wallet-approval.ts")).href
);

function parseArgs(argv) {
  const args = { rows: [], negativeControl: false, help: false, unknown: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--row") {
      args.rows.push(next ?? "");
      index += 1;
    } else if (arg === "--negative-control") {
      args.negativeControl = true;
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
  return isAbsolute(path) ? path : join(rootDir, path);
}
function defaultRows() {
  if (!existsSync(defaultDir)) return [];
  return readdirSync(defaultDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => join(defaultDir, entry));
}
function readRows(paths, checks) {
  const rows = [];
  for (const path of paths) {
    const full = resolveRepoPath(path);
    if (!existsSync(full)) {
      checks.push({ id: `row_present:${relative(rootDir, full)}`, ok: false, summary: "copy-guard row JSON file must exist" });
      continue;
    }
    try {
      rows.push({ path: full, row: JSON.parse(readFileSync(full, "utf8")) });
    } catch {
      checks.push({ id: `row_json_parseable:${relative(rootDir, full)}`, ok: false, summary: "copy-guard row JSON must parse" });
    }
  }
  return rows;
}
function help() {
  return [
    "Usage: node scripts/check-browser-wallet-copy-guard.mjs [--row <row.json> ...] [--negative-control]",
    "",
    "Validates browser-wallet AUDD identity/copy rows. Default rows come from scripts/fixtures/browser-wallet-copy-guard/.",
    "This is deterministic/offline and never contacts a network or wallet.",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(help());
  process.exit(0);
}
if (args.unknown) {
  console.error(`[browser-wallet-copy-guard] unknown argument: ${args.unknown}`);
  console.error(help());
  process.exit(1);
}
const checks = [];
const rowPaths = args.rows.length ? args.rows : defaultRows();
const rows = readRows(rowPaths, checks);
if (args.negativeControl && rows[0]) {
  rows[0].row = JSON.parse(JSON.stringify(rows[0].row));
  rows[0].row.copy = rows[0].row.copy || {};
  rows[0].row.copy.summary = `${rows[0].row.copy.summary || ""} official AUDD grant-eligible observed settlement controlled-live evidence`;
}
for (const { path, row } of rows) {
  const result = validateBrowserWalletIdentityCopyClaims(row);
  const rel = relative(rootDir, path);
  if (result.ok) {
    checks.push({ id: `copy_guard:${rel}`, ok: true, summary: "identity/copy row keeps non-live evidence boundaries" });
  } else {
    for (const validationError of result.errors) {
      checks.push({ id: `${validationError.code}:${rel}:${validationError.path}`, ok: false, summary: validationError.message });
    }
  }
}
if (rowPaths.length === 0) checks.push({ id: "copy_guard_rows_present", ok: false, summary: "at least one copy-guard row is required" });
const status = checks.every((entry) => entry.ok) ? "passed" : "blocked";
const artifact = {
  schemaVersion: BROWSER_WALLET_IDENTITY_COPY_GUARD_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  status,
  inputs: { rows: rowPaths.map((path) => relative(rootDir, resolveRepoPath(path))), negativeControl: args.negativeControl },
  checks,
  blockers: checks.filter((entry) => !entry.ok).map((entry) => entry.id),
  guardrails: [
    "No source-code grepping, network, RPC, wallet, browser, transaction, or settlement action occurs; this validates supplied evidence/copy rows only.",
    "Browser-wallet safety rows must never be represented as official AUDD, grant-eligible, observed settlement, settlement-finality, or controlled-live evidence until a future evidence-aware approval path explicitly replaces this contract.",
  ],
};
console.log(JSON.stringify(artifact, null, 2));
process.exit(status === "passed" ? 0 : 1);
