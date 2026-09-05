#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const fakeSecret = "DO_NOT_ECHO_PLAYWRIGHT_SIGNER_TEST_SENTINEL";

const cases = [
  {
    name: "preconditions pass without signer secret",
    command: ["scripts/check-browser-wallet-command-preconditions.mjs", "--mode", "playwright-webserver"],
    env: { NETWORK_PROFILE: "devnet", NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY: "" },
    expectExit: 0,
    expectStatus: "passed",
  },
  {
    name: "preconditions reject signer secret on devnet before use",
    command: ["scripts/check-browser-wallet-command-preconditions.mjs", "--mode", "playwright-webserver"],
    env: { NETWORK_PROFILE: "devnet", NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY: fakeSecret },
    expectExit: 1,
    expectStatus: "blocked",
    expectBlocker: "signer_profile_local_surfpool",
    mustNotInclude: fakeSecret,
  },
  {
    name: "preconditions allow signer secret only for local loopback",
    command: ["scripts/check-browser-wallet-command-preconditions.mjs", "--mode", "playwright-webserver"],
    env: {
      NETWORK_PROFILE: "local-surfpool",
      NEXT_PUBLIC_RPC_ENDPOINT: "http://127.0.0.1:18999",
      NEXT_PUBLIC_RPC_WS_ENDPOINT: "ws://localhost:19000",
      NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY: fakeSecret,
    },
    expectExit: 0,
    expectStatus: "passed",
    mustNotInclude: fakeSecret,
  },
  {
    name: "tier1 local preflight rejects default devnet profile",
    command: ["scripts/check-browser-wallet-command-preconditions.mjs", "--mode", "tier1-local-browser-harness"],
    env: { NETWORK_PROFILE: "devnet" },
    expectExit: 1,
    expectStatus: "blocked",
    expectBlocker: "tier1_profile_local_surfpool",
  },
  {
    name: "approval checker accepts strict valid record for review only",
    command: [
      "scripts/check-browser-wallet-devnet-approval-record.mjs",
      "--approval",
      "scripts/fixtures/browser-wallet-devnet-approval/approval.valid.json",
      "--now",
      "2026-09-03T12:30:00.000Z",
    ],
    env: {},
    expectExit: 0,
    expectStatus: "approved_for_manual_review",
  },
  {
    name: "approval checker fails expired approval",
    command: [
      "scripts/check-browser-wallet-devnet-approval-record.mjs",
      "--approval",
      "scripts/fixtures/browser-wallet-devnet-approval/approval.valid.json",
      "--now",
      "2026-09-03T15:00:00.000Z",
    ],
    env: {},
    expectExit: 1,
    expectStatus: "blocked",
    expectBlockerPrefix: "expired_browser_wallet_approval:",
  },
  {
    name: "approval checker blocks JSON that parses to a non-object",
    command: [
      "scripts/check-browser-wallet-devnet-approval-record.mjs",
      "--approval",
      "scripts/fixtures/browser-wallet-devnet-approval/approval.not-an-object.json",
      "--now",
      "2026-09-03T12:30:00.000Z",
    ],
    env: {},
    expectExit: 1,
    expectStatus: "blocked",
    expectBlocker: "malformed_browser_wallet_approval:$",
  },
  {
    name: "Tier 1 contract checker blocks JSON that parses to a non-object",
    command: [
      "scripts/check-browser-wallet-tier1-local-contract.mjs",
      "--contract",
      "scripts/fixtures/browser-wallet-devnet-approval/approval.not-an-object.json",
    ],
    env: {},
    expectExit: 1,
    expectStatus: "blocked",
    expectBlocker: "malformed_browser_wallet_approval:$",
  },
  {
    name: "Tier 1 dormant contract checker passes built-in contract",
    command: ["scripts/check-browser-wallet-tier1-local-contract.mjs"],
    env: {},
    expectExit: 0,
    expectStatus: "passed",
  },
  {
    name: "Tier 1 contract checker blocks a valueless --contract flag instead of silently using the built-in contract",
    command: ["scripts/check-browser-wallet-tier1-local-contract.mjs", "--contract"],
    env: {},
    expectExit: 1,
    expectStatus: "blocked",
    expectBlocker: "contract_path_supplied",
  },
  {
    name: "approval checker blocks an unparseable --now instead of falling back to wall-clock time",
    command: [
      "scripts/check-browser-wallet-devnet-approval-record.mjs",
      "--approval",
      "scripts/fixtures/browser-wallet-devnet-approval/approval.valid.json",
      "--now",
      "2026-13-45",
    ],
    env: {},
    expectExit: 1,
    expectStatus: "blocked",
    expectBlocker: "now_parseable",
  },
  {
    name: "copy guard passes safe fixtures",
    command: ["scripts/check-browser-wallet-copy-guard.mjs"],
    env: {},
    expectExit: 0,
    expectStatus: "passed",
  },
  {
    name: "copy guard negative control fails",
    command: ["scripts/check-browser-wallet-copy-guard.mjs", "--negative-control"],
    env: {},
    expectExit: 1,
    expectStatus: "blocked",
    expectBlockerPrefix: "official_audd_devnet_unavailable:",
  },
];

const failures = [];
for (const testCase of cases) {
  const env = {
    ...process.env,
    ...testCase.env,
  };
  if (testCase.env.NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY === "") delete env.NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY;
  const result = spawnSync(node, testCase.command, { cwd: rootDir, env, encoding: "utf8" });
  let artifact;
  try {
    artifact = JSON.parse(result.stdout);
  } catch (error) {
    failures.push(`${testCase.name}: stdout was not JSON: ${error.message}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    continue;
  }
  if (result.status !== testCase.expectExit) failures.push(`${testCase.name}: expected exit ${testCase.expectExit}, got ${result.status}`);
  if (artifact.status !== testCase.expectStatus) failures.push(`${testCase.name}: expected status ${testCase.expectStatus}, got ${artifact.status}`);
  if (testCase.expectBlocker && !artifact.blockers.includes(testCase.expectBlocker)) failures.push(`${testCase.name}: missing blocker ${testCase.expectBlocker}`);
  if (testCase.expectBlockerPrefix && !artifact.blockers.some((item) => item.startsWith(testCase.expectBlockerPrefix))) failures.push(`${testCase.name}: missing blocker prefix ${testCase.expectBlockerPrefix}`);
  if (testCase.mustNotInclude && `${result.stdout}\n${result.stderr}`.includes(testCase.mustNotInclude)) failures.push(`${testCase.name}: output leaked forbidden test sentinel`);
}

if (failures.length > 0) {
  console.error("[browser-wallet-safety-checks] FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[browser-wallet-safety-checks] OK: ${cases.length} offline cases`);
