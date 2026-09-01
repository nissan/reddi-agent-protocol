import net from "node:net";

export const LOCAL_ENDPOINT_ENV_KEYS = Object.freeze([
  "ANCHOR_PROVIDER_URL",
  "DEMO_DEVNET_RPC",
  "DEMO_DEVNET_RPC_WS",
  "DEMO_PER_RPC",
  "NEXT_PUBLIC_PER_RPC",
  "NEXT_PUBLIC_RPC_ENDPOINT",
  "NEXT_PUBLIC_RPC_URL",
  "NEXT_PUBLIC_RPC_WS_ENDPOINT",
  "SOLANA_URL",
  "SURFPOOL_DATASOURCE_RPC_URL",
  "SURFPOOL_RPC_URL",
]);

export const NETWORK_PROFILE_ENV_KEYS = Object.freeze([
  "NETWORK_PROFILE",
  "NEXT_PUBLIC_NETWORK_PROFILE",
]);

const FORBIDDEN_NETWORK_PROFILE_VALUES = new Set([
  "mainnet",
  "mainnet-beta",
  "testnet",
]);

export class SurfpoolSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = "SurfpoolSafetyError";
  }
}

export class SurfpoolReadinessError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SurfpoolReadinessError";
    this.attempts = options.attempts ?? 0;
    this.cause = options.cause;
  }
}

export function isLoopbackHostname(hostname) {
  const host = String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) && octets[0] === 127;
}

export function assertLoopbackEndpoint(raw, label = "endpoint") {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SurfpoolSafetyError(`${label} must be a valid localhost URL; got ${JSON.stringify(raw)}`);
  }

  if (!["http:", "ws:"].includes(url.protocol)) {
    throw new SurfpoolSafetyError(`${label} must use http:// or ws:// for local Surfpool; got ${url.protocol}`);
  }

  if (!isLoopbackHostname(url.hostname)) {
    throw new SurfpoolSafetyError(`${label} must bind to loopback only; got host ${url.hostname}`);
  }

  if (!url.port) {
    throw new SurfpoolSafetyError(`${label} must include an explicit dynamically assigned port; got ${url.href}`);
  }

  return url;
}

export function assertLocalOnlyEnvironment(env = process.env, options = {}) {
  const endpointKeys = options.endpointKeys ?? LOCAL_ENDPOINT_ENV_KEYS;
  const profileKeys = options.profileKeys ?? NETWORK_PROFILE_ENV_KEYS;

  for (const key of endpointKeys) {
    const value = env[key]?.trim();
    if (!value) continue;
    assertLoopbackEndpoint(value, key);
  }

  for (const key of profileKeys) {
    const value = env[key]?.trim().toLowerCase();
    if (!value) continue;
    if (FORBIDDEN_NETWORK_PROFILE_VALUES.has(value)) {
      throw new SurfpoolSafetyError(`${key}=${value} is not allowed in the local Surfpool validation lane`);
    }
  }
}

export function validateSurfnetEndpoints(surfnet) {
  const rpcUrl = String(surfnet?.rpcUrl ?? "");
  const wsUrl = String(surfnet?.wsUrl ?? "");
  const rpc = assertLoopbackEndpoint(rpcUrl, "Surfnet RPC URL");
  const ws = assertLoopbackEndpoint(wsUrl, "Surfnet WebSocket URL");

  if (rpc.href === ws.href) {
    throw new SurfpoolSafetyError("Surfnet RPC and WebSocket endpoints must be distinct dynamic loopback URLs");
  }

  return {
    rpcUrl: rpc.href,
    wsUrl: ws.href,
    rpcPort: Number.parseInt(rpc.port, 10),
    wsPort: Number.parseInt(ws.port, 10),
  };
}

export async function defaultReadinessProbe(rpcUrl, options = {}) {
  const signal = options.signal;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getVersion" }),
    signal,
  });
  if (!response.ok) return false;
  const payload = await response.json();
  return Boolean(payload?.result?.["solana-core"]);
}

export async function waitForSurfnetReadiness(rpcUrl, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 250;
  const probe = options.probe ?? defaultReadinessProbe;
  const signal = options.signal;
  const startedAt = Date.now();
  let attempts = 0;
  let lastError;

  while (Date.now() - startedAt <= timeoutMs) {
    if (signal?.aborted) throw signal.reason ?? new Error("readiness aborted");
    attempts += 1;
    try {
      if (await probe(rpcUrl, { signal, attempts })) return { attempts };
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs, signal);
  }

  throw new SurfpoolReadinessError(`Surfnet RPC did not become ready within ${timeoutMs}ms`, {
    attempts,
    cause: lastError,
  });
}

export async function startLocalSurfnet(Surfnet, options = {}) {
  assertLocalOnlyEnvironment(options.env ?? process.env);
  const config = {
    offline: true,
    airdropSol: 0,
    blockProductionMode: "transaction",
    ...(options.config ?? {}),
  };
  if (config.remoteRpcUrl) {
    assertLoopbackEndpoint(config.remoteRpcUrl, "Surfnet remoteRpcUrl");
  }

  const surfnet = Surfnet.startWithConfig(config);
  const endpoints = validateSurfnetEndpoints(surfnet);
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    surfnet.stop();
  };

  try {
    const readiness = await waitForSurfnetReadiness(endpoints.rpcUrl, {
      timeoutMs: options.readinessTimeoutMs,
      intervalMs: options.readinessIntervalMs,
      probe: options.readinessProbe,
      signal: options.signal,
    });
    return {
      surfnet,
      stop,
      instanceId: String(surfnet.instanceId ?? ""),
      ...endpoints,
      readinessAttempts: readiness.attempts,
    };
  } catch (error) {
    stop();
    throw error;
  }
}

export function assertQuasarCriticalDemoOutput(output, expectedProgramIds) {
  const text = String(output ?? "");
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const targetLine = lines.find((line) => line.startsWith("Target:"));
  const settlementLine = lines.find((line) => line.startsWith("Settlement:") && /Quasar escrow public settlement/.test(line));
  const completed = lines.some((line) => /Full A→B→C cycle complete/.test(line));
  const notClaimed = lines.some((line) => /MagicBlock PER\/TEE is not claimed/.test(line));
  const legacyTarget = lines.some((line) => /Target:\s+legacy-anchor/.test(line));
  const anchorFallback = lines.some((line) => /No Anchor\/PER fallback was used/.test(line))
    ? false
    : lines.some((line) => /fallback used|L1 fallback|legacy Anchor\/PER paths/i.test(line));
  const localSurfpoolProfile = lines.some((line) => /local-surfpool/.test(line));
  const liveNetworkHint = /cluster=devnet|api\.devnet\.solana\.com|api\.mainnet-beta\.solana\.com|devnet-tee\.magicblock\.app/i.test(text);

  const programChecks = [
    ["Escrow", expectedProgramIds.escrow],
    ["Registry", expectedProgramIds.registry],
    ["Repute", expectedProgramIds.reputation],
    ["Attest", expectedProgramIds.attestation],
  ].map(([label, id]) => ({
    label,
    id,
    ok: lines.some((line) => line.startsWith(`${label}:`) && line.includes(id)),
  }));

  const missing = [];
  if (!targetLine || !/Target:\s+quasar/.test(targetLine)) missing.push("Target: quasar");
  if (legacyTarget) missing.push("no legacy-anchor target");
  for (const check of programChecks) {
    if (!check.id || !check.ok) missing.push(`${check.label}: ${check.id ?? "<missing>"}`);
  }
  if (!completed) missing.push("Full A→B→C completion banner");
  if (!localSurfpoolProfile) missing.push("local-surfpool profile banner/output");
  if (liveNetworkHint) missing.push("no devnet/mainnet explorer/RPC/PER hints in local evidence");
  if (!settlementLine) missing.push("Quasar escrow public settlement summary");
  if (!notClaimed) missing.push("MagicBlock PER/TEE not-claimed boundary");
  if (anchorFallback) missing.push("no Anchor/PER fallback wording");

  if (missing.length) {
    throw new Error(`Quasar critical demo output did not prove the expected local Quasar path: ${missing.join(", ")}`);
  }

  return true;
}

export function assertQuasarPerFailClosedOutput(output) {
  const text = String(output ?? "");
  if (!/MagicBlock PER\/TEE is not claimed for the Quasar final demo path yet/.test(text)) {
    throw new Error("Quasar PER fail-closed output did not include the expected boundary message");
  }
  if (/Full A→B→C cycle complete/.test(text)) {
    throw new Error("Quasar PER fail-closed command unexpectedly completed the full demo");
  }
  return true;
}

export function redactForEvidence(value, options = {}) {
  let text = String(value ?? "");
  const replacements = [];
  if (options.repoRoot) replacements.push([options.repoRoot, "<repo>"]);
  if (options.home) replacements.push([options.home, "~"]);
  for (const [from, to] of replacements) {
    if (!from) continue;
    text = text.split(from).join(to);
  }
  text = text.replace(/AGENT_[ABC]_KEYPAIR=\[[^\n\r]*\]/g, "AGENT_KEYPAIR=<redacted>");
  text = text.replace(/\[(?:\d{1,3},){16,}\d{1,3}\]/g, "[<redacted-bytes>]");
  return text;
}

export async function waitForPortClosed(endpoint, options = {}) {
  const url = assertLoopbackEndpoint(endpoint, "closed-port probe endpoint");
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 100;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (!(await canConnect(url.hostname, Number.parseInt(url.port, 10)))) return true;
    await sleep(intervalMs, options.signal);
  }

  throw new Error(`Timed out waiting for ${url.href} to close`);
}

export function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("sleep aborted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("sleep aborted"));
        },
        { once: true },
      );
    }
  });
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(200);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}
