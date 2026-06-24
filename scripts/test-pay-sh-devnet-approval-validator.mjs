#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(rootDir, "scripts", "fixtures", "pay-sh-devnet-approval");
const checker = join(rootDir, "scripts", "check-pay-sh-devnet-approval-record.mjs");
const now = "2026-06-24T12:00:00.000Z";

const validArgs = [
  "--approval",
  join(fixtureDir, "approval.valid.json"),
  "--request",
  join(fixtureDir, "request.valid.json"),
  "--receipt",
  join(fixtureDir, "receipt.valid.json"),
  "--verifier",
  join(fixtureDir, "verifier.valid.json"),
  "--now",
  now,
];

const cases = [
  {
    name: "valid approval/request/receipt/verifier passes",
    args: validArgs,
    expectStatus: "approved_for_review",
    expectExit: 0,
  },
  {
    name: "missing approval record fails closed",
    args: ["--approval", join(fixtureDir, "missing.json"), "--now", now],
    expectStatus: "blocked",
    expectExit: 1,
    expectBlocker: "approval_record_present",
  },
  {
    name: "expired approval fails closed",
    args: ["--approval", join(fixtureDir, "approval.expired.json"), "--now", now],
    expectStatus: "blocked",
    expectExit: 1,
    expectBlocker: "not_expired",
  },
  {
    name: "over-cap request fails closed",
    args: [
      "--approval",
      join(fixtureDir, "approval.valid.json"),
      "--request",
      join(fixtureDir, "request.over-cap.json"),
      "--now",
      now,
    ],
    expectStatus: "blocked",
    expectExit: 1,
    expectBlocker: "request_cap_within_approval",
  },
  {
    name: "endpoint drift fails closed",
    args: [
      "--approval",
      join(fixtureDir, "approval.valid.json"),
      "--request",
      join(fixtureDir, "request.endpoint-mismatch.json"),
      "--now",
      now,
    ],
    expectStatus: "blocked",
    expectExit: 1,
    expectBlocker: "request_endpoint_matches_approval",
  },
  {
    name: "auto-pay ambiguity fails closed",
    args: [
      "--approval",
      join(fixtureDir, "approval.valid.json"),
      "--request",
      join(fixtureDir, "request.auto-pay.json"),
      "--now",
      now,
    ],
    expectStatus: "blocked",
    expectExit: 1,
    expectBlocker: "request_no_auto_pay_or_default_live_ambiguity",
  },
  {
    name: "receipt payee mismatch fails closed",
    args: [
      "--approval",
      join(fixtureDir, "approval.valid.json"),
      "--receipt",
      join(fixtureDir, "receipt.payee-mismatch.json"),
      "--now",
      now,
    ],
    expectStatus: "blocked",
    expectExit: 1,
    expectBlocker: "receipt_recipientPayee_matches_approval",
  },
  {
    name: "verifier asset mismatch fails closed",
    args: [
      "--approval",
      join(fixtureDir, "approval.valid.json"),
      "--verifier",
      join(fixtureDir, "verifier.asset-mismatch.json"),
      "--now",
      now,
    ],
    expectStatus: "blocked",
    expectExit: 1,
    expectBlocker: "verifier_asset_matches_approval",
  },
];

const failures = [];

for (const testCase of cases) {
  const result = spawnSync(process.execPath, [checker, ...testCase.args], {
    cwd: rootDir,
    encoding: "utf8",
  });

  let artifact = null;
  try {
    artifact = JSON.parse(result.stdout);
  } catch (error) {
    failures.push(`${testCase.name}: output did not parse as JSON: ${error.message}`);
    continue;
  }

  if (result.status !== testCase.expectExit) {
    failures.push(`${testCase.name}: expected exit ${testCase.expectExit}, got ${result.status}`);
  }
  if (artifact.status !== testCase.expectStatus) {
    failures.push(`${testCase.name}: expected status ${testCase.expectStatus}, got ${artifact.status}`);
  }
  if (testCase.expectBlocker && !artifact.blockers.includes(testCase.expectBlocker)) {
    failures.push(`${testCase.name}: missing expected blocker ${testCase.expectBlocker}`);
  }
}

if (failures.length > 0) {
  console.error("[pay-sh-devnet-approval-validator-test] FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[pay-sh-devnet-approval-validator-test] OK: ${cases.length} cases`);
