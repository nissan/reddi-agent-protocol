#!/usr/bin/env node
/**
 * Offline browser-wallet command precondition guard.
 *
 * This script reads only environment/configuration metadata. It never opens a browser, installs an
 * extension, reads or parses signer material, requests faucet funds, starts a validator, signs,
 * simulates, submits, or observes a transaction.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const localProfile = JSON.parse(readFileSync(join(rootDir, "config", "networks", "local-surfpool.json"), "utf8"));
const devnetProfile = JSON.parse(readFileSync(join(rootDir, "config", "networks", "devnet.json"), "utf8"));
const mainnetProfile = JSON.parse(readFileSync(join(rootDir, "config", "networks", "mainnet.json"), "utf8"));

function parseArgs(argv) {
  const args = { mode: "playwright-webserver", help: false, unknown: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--mode") {
      args.mode = next ?? "";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      args.unknown = arg;
      break;
    }
  }
  return args;
}

function resolveProfileName(env) {
  const raw = String(env.NETWORK_PROFILE || env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE || env.NEXT_PUBLIC_NETWORK_PROFILE || "devnet").toLowerCase();
  if (["local-surfpool", "local", "localnet", "surfpool"].includes(raw)) return "local-surfpool";
  if (["mainnet", "mainnet-beta"].includes(raw)) return "mainnet";
  return "devnet";
}

function baseProfile(name) {
  if (name === "local-surfpool") return localProfile;
  if (name === "mainnet") return mainnetProfile;
  return devnetProfile;
}

function effectiveRpc(env, profile) {
  return {
    http: env.NEXT_PUBLIC_RPC_ENDPOINT || env.NEXT_PUBLIC_RPC_URL || env.DEMO_DEVNET_RPC || profile.solana.rpcHttp,
    ws: env.NEXT_PUBLIC_RPC_WS_ENDPOINT || profile.solana.rpcWs,
  };
}

function isLoopbackRpcUrl(raw, expectedProtocol) {
  if (!raw) return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (expectedProtocol && url.protocol !== expectedProtocol) return false;
  if (!expectedProtocol && url.protocol !== "http:" && url.protocol !== "ws:") return false;
  if (!url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
    return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) && octets[0] === 127;
  }
  if (!host.includes(":")) return false;
  return expandIpv6(host) === "0:0:0:0:0:0:0:1";
}

function expandIpv6(host) {
  if (host.includes("%")) return undefined;
  const halves = host.split("::");
  if (halves.length > 2) return undefined;
  const parse = (part) => {
    if (part === "") return [];
    const hextets = part.split(":");
    if (hextets.some((hextet) => !/^[0-9a-f]{1,4}$/.test(hextet))) return undefined;
    return hextets;
  };
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return undefined;
  let hextets;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return undefined;
    hextets = [...head, ...Array.from({ length: fill }, () => "0"), ...tail];
  } else {
    hextets = head;
  }
  if (hextets.length !== 8) return undefined;
  return hextets.map((hextet) => hextet.replace(/^0+(?=.)/, "")).join(":");
}

function check(id, ok, summary) {
  return { id, ok: Boolean(ok), summary };
}

function buildArtifact(args, env) {
  const profileName = resolveProfileName(env);
  const rpc = effectiveRpc(env, baseProfile(profileName));
  const signerSecretPresent = typeof env.NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY === "string" && env.NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY.length > 0;
  const checks = [
    check("known_mode", ["playwright-webserver", "tier1-local-browser-harness"].includes(args.mode), "mode must be a known no-action browser-wallet precondition mode"),
    check("mainnet_not_selected", profileName !== "mainnet", "mainnet profile is never allowed for browser-wallet preconditions"),
  ];

  if (signerSecretPresent) {
    checks.push(check("signer_profile_local_surfpool", profileName === "local-surfpool", "public-prefixed Playwright signer secret is allowed only for local-surfpool"));
    checks.push(check("signer_rpc_loopback", isLoopbackRpcUrl(rpc.http, "http:"), "public-prefixed Playwright signer secret requires loopback HTTP RPC"));
    checks.push(check("signer_ws_loopback", !rpc.ws || isLoopbackRpcUrl(rpc.ws, "ws:"), "public-prefixed Playwright signer secret requires loopback WS RPC when WS is configured"));
  } else {
    checks.push(check("no_public_signer_secret", true, "no public-prefixed Playwright signer secret is configured"));
  }

  if (args.mode === "tier1-local-browser-harness") {
    checks.push(check("tier1_profile_local_surfpool", profileName === "local-surfpool", "Tier 1 browser harness preflight is local-surfpool only"));
    checks.push(check("tier1_http_loopback", isLoopbackRpcUrl(rpc.http, "http:"), "Tier 1 browser harness HTTP RPC must be explicit loopback with a port"));
    checks.push(check("tier1_ws_loopback", Boolean(rpc.ws) && isLoopbackRpcUrl(rpc.ws, "ws:"), "Tier 1 browser harness WS RPC must be explicit loopback with a port"));
    checks.push(check("tier1_mint_label_dormant", !env.BROWSER_WALLET_TIER1_TEST_MINT_LABEL || ["AUDD_TEST", "LOCAL_AUDD_TEST"].includes(env.BROWSER_WALLET_TIER1_TEST_MINT_LABEL), "Tier 1 test mint label must be AUDD_TEST or LOCAL_AUDD_TEST when declared"));
    checks.push(check("tier1_no_generated_mint_input", !env.BROWSER_WALLET_TIER1_TEST_MINT && !env.BROWSER_WALLET_TIER1_SECRET_KEY && !env.BROWSER_WALLET_TIER1_SIGNATURE, "Tier 1 dormant preflight must not receive generated mint, secret, or signature material"));
  }

  const status = checks.every((entry) => entry.ok) ? "passed" : "blocked";
  return {
    schemaVersion: "reddi.browser-wallet.command-preconditions.v1",
    generatedAt: new Date().toISOString(),
    status,
    mode: args.mode,
    inputs: {
      profileName,
      signerSecretPresent,
      rpcHttpConfigured: Boolean(rpc.http),
      rpcWsConfigured: Boolean(rpc.ws),
    },
    checks,
    blockers: checks.filter((entry) => !entry.ok).map((entry) => entry.id),
    guardrails: [
      "No browser, extension, wallet, faucet, validator, mint, keypair, blockhash, signature, transaction, balance, network, or RPC action is performed.",
      "Public-prefixed Playwright signer material is refused before Next.js starts unless the effective profile/RPC are local-surfpool loopback.",
      "Tier 1 preflight is a dormant contract check; it is not approval to generate local mint or signer material.",
    ],
  };
}

function help() {
  return [
    "Usage: node scripts/check-browser-wallet-command-preconditions.mjs [--mode playwright-webserver|tier1-local-browser-harness]",
    "",
    "Offline precondition guard. It reads env/config only and never touches a browser, wallet, faucet, validator, mint, keypair, blockhash, signature, transaction, balance, network, or RPC.",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(help());
  process.exit(0);
}
if (args.unknown) {
  console.error(`[browser-wallet-preconditions] unknown argument: ${args.unknown}`);
  console.error(help());
  process.exit(1);
}

const artifact = buildArtifact(args, process.env);
console.log(JSON.stringify(artifact, null, 2));
process.exit(artifact.status === "passed" ? 0 : 1);
