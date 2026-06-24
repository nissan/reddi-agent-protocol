#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "reddi.pay-sh.devnet-paid-run-approval.v1";
const APPROVED_STATUS = "approved";
const VERIFIED_STATUS = "verified";
const ALLOWED_ENVIRONMENTS = new Set(["pay-sh-sandbox", "sandbox-localnet", "solana-devnet"]);
const ALLOWED_NETWORKS = new Set(["solana-devnet"]);
const ALLOWED_ASSETS = new Set(["USDC"]);
const AMBIGUOUS_LIVE_PATTERNS = [
  /auto[-_]?pay/i,
  /default[-_]?live/i,
  /live[-_]?enabled/i,
  /\bmainnet\b/i,
  /\bproduction\b/i,
];

function parseArgs(argv) {
  const args = {
    approval: process.env.PAY_SH_DEVNET_APPROVAL_RECORD || "",
    request: process.env.PAY_SH_DEVNET_RUN_REQUEST || "",
    receipt: process.env.PAY_SH_DEVNET_RECEIPT || "",
    verifier: process.env.PAY_SH_DEVNET_VERIFIER || "",
    now: process.env.PAY_SH_DEVNET_APPROVAL_NOW || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--approval") {
      args.approval = next ?? "";
      index += 1;
    } else if (arg === "--request") {
      args.request = next ?? "";
      index += 1;
    } else if (arg === "--receipt") {
      args.receipt = next ?? "";
      index += 1;
    } else if (arg === "--verifier") {
      args.verifier = next ?? "";
      index += 1;
    } else if (arg === "--now") {
      args.now = next ?? "";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (!arg.startsWith("--") && !args.approval) {
      args.approval = arg;
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

function readJson(path, label, failures) {
  const fullPath = resolveRepoPath(path);
  if (!path || !existsSync(fullPath)) {
    failures.push({ id: `${label}_present`, ok: false, summary: `${label} JSON file must exist` });
    return null;
  }

  try {
    return JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (error) {
    failures.push({ id: `${label}_json_parseable`, ok: false, summary: `${label} JSON must parse: ${error.message}` });
    return null;
  }
}

function present(value) {
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
}

function exactPublicReference(value) {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(value);
}

function exactHttpsEndpoint(value) {
  if (typeof value !== "string" || value.includes("*") || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hash === "" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function finitePositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function getCapUsdc(record) {
  return record?.capUsdc ?? record?.caps?.singleRunUsdc ?? null;
}

function getSessionCapUsdc(record) {
  return record?.sessionCapUsdc ?? record?.caps?.sessionUsdc ?? null;
}

function getRetryAllowed(record) {
  return record?.retryAllowed ?? record?.retryPolicy?.allowed ?? null;
}

function getRetryCount(record) {
  return record?.retryCount ?? record?.retryPolicy?.maxRetries ?? record?.retryPolicy?.count ?? null;
}

function hasAmbiguousLiveText(record) {
  const text = [
    record?.exactCommand,
    record?.paymentMode,
    record?.activationState,
    record?.notes,
    record?.summary,
  ]
    .filter((value) => typeof value === "string")
    .join("\n");

  return AMBIGUOUS_LIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function addCheck(checks, id, ok, summary) {
  checks.push({ id, ok: Boolean(ok), summary });
}

function compareField(checks, actual, expected, fieldName, label) {
  addCheck(checks, `${label}_${fieldName}_matches_approval`, actual === expected, `${label}.${fieldName} must exactly match approval.${fieldName}`);
}

function validateApprovalRecord(approval, now) {
  const checks = [];
  addCheck(checks, "schema_version", approval?.schemaVersion === SCHEMA_VERSION, `schemaVersion must equal ${SCHEMA_VERSION}`);
  addCheck(checks, "approval_status", approval?.status === APPROVED_STATUS, "approval status must be approved");
  addCheck(checks, "approver_present", present(approval?.approver), "approver must be present");
  addCheck(checks, "approved_at_present", Number.isFinite(Date.parse(approval?.approvedAt ?? "")), "approvedAt must be an ISO timestamp");
  addCheck(checks, "environment_allowed", ALLOWED_ENVIRONMENTS.has(approval?.environment), "environment must be pay-sh-sandbox, sandbox-localnet, or solana-devnet");
  addCheck(checks, "network_devnet", ALLOWED_NETWORKS.has(approval?.network), "network must be solana-devnet for this checker");
  addCheck(checks, "asset_usdc", ALLOWED_ASSETS.has(approval?.asset), "asset must be USDC for Pay.sh/devnet paid-run validation");
  addCheck(checks, "payer_exact", exactPublicReference(approval?.payer), "payer must be an exact public key/reference, not a default or wildcard");
  addCheck(checks, "recipient_payee_exact", exactPublicReference(approval?.recipientPayee), "recipientPayee must be an exact public key/reference, not a default or wildcard");
  addCheck(checks, "endpoint_exact_https", exactHttpsEndpoint(approval?.endpoint), "endpoint must be one exact HTTPS URL without wildcard or credentials");
  addCheck(checks, "single_run_cap_present", finitePositiveNumber(getCapUsdc(approval)), "single-run cap must be a positive USDC number");
  addCheck(checks, "session_cap_present", finitePositiveNumber(getSessionCapUsdc(approval)), "session cap must be a positive USDC number");
  addCheck(checks, "session_cap_covers_single_run", getSessionCapUsdc(approval) >= getCapUsdc(approval), "session cap must be >= single-run cap");
  addCheck(checks, "retry_policy_explicit", typeof getRetryAllowed(approval) === "boolean" && Number.isInteger(getRetryCount(approval)) && getRetryCount(approval) >= 0, "retry policy must explicitly set allowed and maxRetries/count");
  addCheck(checks, "retry_policy_bounded", getRetryAllowed(approval) === false ? getRetryCount(approval) === 0 : getRetryCount(approval) > 0 && getRetryCount(approval) <= 2, "retries must be disabled with 0 retries or explicitly bounded to <=2");
  addCheck(checks, "exact_command_present", present(approval?.exactCommand), "exact command must be present");
  addCheck(checks, "evidence_path_present", present(approval?.evidencePath), "evidence path must be present");
  addCheck(checks, "rollback_owner_present", present(approval?.rollbackOwner), "rollback/suspend owner must be present");
  addCheck(checks, "expiry_present", Number.isFinite(Date.parse(approval?.expiresAt ?? "")), "expiresAt must be an ISO timestamp");
  addCheck(checks, "not_expired", Number.isFinite(Date.parse(approval?.expiresAt ?? "")) && Date.parse(approval.expiresAt) > now.getTime(), "approval must not be expired");
  addCheck(checks, "single_use_scope", approval?.scope === "single-use", "approval scope must be single-use");
  addCheck(checks, "auto_pay_disabled", approval?.autoPay === false, "autoPay must be false");
  addCheck(checks, "default_live_disabled", approval?.defaultLive === false, "defaultLive must be false");
  addCheck(checks, "no_auto_pay_or_default_live_ambiguity", !hasAmbiguousLiveText(approval), "approval text/command must not imply auto-pay, default-live, production, mainnet, or live-enabled mode");
  return checks;
}

function validateRequest(checks, request, approval) {
  if (!request) return;
  compareField(checks, request.environment, approval.environment, "environment", "request");
  compareField(checks, request.network, approval.network, "network", "request");
  compareField(checks, request.asset, approval.asset, "asset", "request");
  compareField(checks, request.payer, approval.payer, "payer", "request");
  compareField(checks, request.recipientPayee, approval.recipientPayee, "recipientPayee", "request");
  compareField(checks, request.endpoint, approval.endpoint, "endpoint", "request");
  compareField(checks, request.exactCommand, approval.exactCommand, "exactCommand", "request");
  compareField(checks, request.evidencePath, approval.evidencePath, "evidencePath", "request");
  addCheck(checks, "request_cap_within_approval", finitePositiveNumber(request.capUsdc) && request.capUsdc <= getCapUsdc(approval), "request cap must be positive and <= approval single-run cap");
  addCheck(checks, "request_retry_policy_matches", getRetryAllowed(request) === getRetryAllowed(approval) && getRetryCount(request) === getRetryCount(approval), "request retry policy must match approval retry policy");
  addCheck(checks, "request_auto_pay_disabled", request.autoPay === false, "request autoPay must be false");
  addCheck(checks, "request_default_live_disabled", request.defaultLive === false, "request defaultLive must be false");
  addCheck(checks, "request_no_auto_pay_or_default_live_ambiguity", !hasAmbiguousLiveText(request), "request text/command must not imply auto-pay, default-live, production, mainnet, or live-enabled mode");
}

function validateReceipt(checks, receipt, approval) {
  if (!receipt) return;
  addCheck(checks, "receipt_status_present", present(receipt.status), "receipt status must be present when a receipt is supplied");
  compareField(checks, receipt.network, approval.network, "network", "receipt");
  compareField(checks, receipt.asset, approval.asset, "asset", "receipt");
  compareField(checks, receipt.payer, approval.payer, "payer", "receipt");
  compareField(checks, receipt.recipientPayee, approval.recipientPayee, "recipientPayee", "receipt");
  compareField(checks, receipt.endpoint, approval.endpoint, "endpoint", "receipt");
  addCheck(checks, "receipt_amount_within_cap", finitePositiveNumber(receipt.amountUsdc) && receipt.amountUsdc <= getCapUsdc(approval), "receipt amount must be positive and <= approval single-run cap");
  addCheck(checks, "receipt_evidence_path_matches_approval", receipt.evidencePath === approval.evidencePath, "receipt evidence path must match approval evidence path");
}

function validateVerifier(checks, verifier, approval, receipt) {
  if (!verifier) return;
  addCheck(checks, "verifier_status_verified", verifier.status === VERIFIED_STATUS, "verifier status must be verified when a verifier artifact is supplied");
  compareField(checks, verifier.network, approval.network, "network", "verifier");
  compareField(checks, verifier.asset, approval.asset, "asset", "verifier");
  compareField(checks, verifier.payer, approval.payer, "payer", "verifier");
  compareField(checks, verifier.recipientPayee, approval.recipientPayee, "recipientPayee", "verifier");
  compareField(checks, verifier.endpoint, approval.endpoint, "endpoint", "verifier");
  addCheck(checks, "verifier_cap_matches_approval", verifier.capUsdc === getCapUsdc(approval), "verifier cap must equal approval single-run cap");
  addCheck(checks, "verifier_evidence_path_matches_approval", verifier.evidencePath === approval.evidencePath, "verifier evidence path must match approval evidence path");
  if (receipt) {
    addCheck(checks, "verifier_receipt_path_matches_receipt", verifier.receiptEvidencePath === receipt.evidencePath, "verifier receiptEvidencePath must match supplied receipt evidencePath");
    addCheck(checks, "verifier_amount_matches_receipt", verifier.amountUsdc === receipt.amountUsdc, "verifier amount must match supplied receipt amount");
  }
}

function help() {
  return [
    "Usage: node scripts/check-pay-sh-devnet-approval-record.mjs --approval <approval.json> [--request <request.json>] [--receipt <receipt.json>] [--verifier <verifier.json>] [--now <iso>]",
    "",
    "Offline fail-closed validator for Pay.sh/devnet paid-run approval records.",
    "It does not execute payments, call Pay.sh, read wallets, or query Solana RPC.",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(help());
  process.exit(0);
}

if (args.unknown) {
  console.error(`[pay-sh-devnet-approval] unknown argument: ${args.unknown}`);
  console.error(help());
  process.exit(1);
}

const loadFailures = [];
const approval = readJson(args.approval, "approval_record", loadFailures);
const request = args.request ? readJson(args.request, "request", loadFailures) : null;
const receipt = args.receipt ? readJson(args.receipt, "receipt", loadFailures) : null;
const verifier = args.verifier ? readJson(args.verifier, "verifier", loadFailures) : null;
const now = args.now && Number.isFinite(Date.parse(args.now)) ? new Date(args.now) : new Date();

const checks = [...loadFailures];
if (approval) {
  checks.push(...validateApprovalRecord(approval, now));
  validateRequest(checks, request, approval);
  validateReceipt(checks, receipt, approval);
  validateVerifier(checks, verifier, approval, receipt);
}

const status = checks.every((check) => check.ok) ? "approved_for_review" : "blocked";
const artifact = {
  schemaVersion: "reddi.pay-sh.devnet-approval-validation.v1",
  generatedAt: new Date().toISOString(),
  status,
  inputs: {
    approval: args.approval ? relative(rootDir, resolveRepoPath(args.approval)) : null,
    request: args.request ? relative(rootDir, resolveRepoPath(args.request)) : null,
    receipt: args.receipt ? relative(rootDir, resolveRepoPath(args.receipt)) : null,
    verifier: args.verifier ? relative(rootDir, resolveRepoPath(args.verifier)) : null,
    now: now.toISOString(),
  },
  checks,
  blockers: checks.filter((check) => !check.ok).map((check) => check.id),
  guardrails: [
    "Offline validator only: no payment, Pay.sh setup, wallet setup, wallet top-up, RPC call, provider call, catalog submission, hosted write, trust mutation, or reputation mutation occurs.",
    "Passing validation only proves the supplied records are internally consistent for review.",
    "Passing validation does not authorize execution; Nissan approval is still required before any paid run.",
  ],
};

console.log(JSON.stringify(artifact, null, 2));
process.exit(status === "approved_for_review" ? 0 : 1);
