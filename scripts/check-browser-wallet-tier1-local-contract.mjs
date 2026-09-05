#!/usr/bin/env node
/** Offline checker for the dormant Tier 1 local browser-harness contract. */
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

const {
  BROWSER_WALLET_TIER1_LOCAL_HARNESS_SCHEMA_VERSION,
  DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT,
  validateBrowserWalletTier1LocalHarnessContract,
} = await import(pathToFileURL(join(rootDir, "packages", "agent-protocol", "src", "browser-wallet-approval.ts")).href);

function parseArgs(argv) {
  const args = { contract: "", contractRequested: false, help: false, unknown: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--contract") {
      args.contract = next ?? "";
      args.contractRequested = true;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (!arg.startsWith("--") && !args.contract) {
      args.contract = arg;
      args.contractRequested = true;
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
function readOptionalContract(path, requested, checks) {
  if (!requested) return { read: true, value: DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT };
  if (!path) {
    checks.push({ id: "contract_path_supplied", ok: false, summary: "--contract requires an exact Tier 1 contract JSON path" });
    return { read: false, value: null };
  }
  const full = resolveRepoPath(path);
  if (!existsSync(full)) {
    checks.push({ id: "contract_present", ok: false, summary: "Tier 1 contract JSON file must exist" });
    return { read: false, value: null };
  }
  try {
    return { read: true, value: JSON.parse(readFileSync(full, "utf8")) };
  } catch {
    checks.push({ id: "contract_json_parseable", ok: false, summary: "Tier 1 contract JSON must parse" });
    return { read: false, value: null };
  }
}
function help() {
  return [
    "Usage: node scripts/check-browser-wallet-tier1-local-contract.mjs [--contract <contract.json>]",
    "",
    "Validates the dormant Tier 1 local browser harness contract. It does not generate a mint, wallet, keypair, address, signature, blockhash, transaction, validator state, or token balance.",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(help());
  process.exit(0);
}
if (args.unknown) {
  console.error(`[browser-wallet-tier1-contract] unknown argument: ${args.unknown}`);
  console.error(help());
  process.exit(1);
}
const checks = [];
const contract = readOptionalContract(args.contract, args.contractRequested, checks);
if (contract.read) {
  const result = validateBrowserWalletTier1LocalHarnessContract(contract.value);
  if (result.ok) {
    checks.push({ id: "tier1_contract", ok: true, summary: "Tier 1 local browser harness contract is dormant, local-only, and canonical" });
  } else {
    for (const validationError of result.errors) {
      checks.push({ id: `${validationError.code}:${validationError.path}`, ok: false, summary: validationError.message });
    }
  }
}
const status = checks.length > 0 && checks.every((entry) => entry.ok) ? "passed" : "blocked";
const artifact = {
  schemaVersion: BROWSER_WALLET_TIER1_LOCAL_HARNESS_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  status,
  inputs: { contract: args.contractRequested ? (args.contract ? relative(rootDir, resolveRepoPath(args.contract)) : null) : "built-in-dormant-contract" },
  checks,
  blockers: checks.filter((entry) => !entry.ok).map((entry) => entry.id),
  guardrails: [
    "Interfaces/preflight only: no browser, wallet, extension, faucet, RPC, validator, mint, keypair, signature, blockhash, transaction, state, or token balance is created or inspected.",
    "The local test asset is AUDD_TEST/LOCAL_AUDD_TEST with grantEligibility=non_eligible; it is never official AUDD.",
  ],
};
console.log(JSON.stringify(artifact, null, 2));
process.exit(status === "passed" ? 0 : 1);
