import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export const LOCAL_ENDPOINT_ENV_KEYS = Object.freeze([
  "ANCHOR_PROVIDER_URL",
  "DEMO_DEVNET_RPC",
  "DEMO_DEVNET_RPC_WS",
  "DEMO_PAYMENTS_API_BASE_URL",
  "DEMO_PER_RPC",
  "JUPITER_API_BASE",
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
  "NEXT_PUBLIC_BUILD_NETWORK_PROFILE",
  "NEXT_PUBLIC_NETWORK_PROFILE",
]);

const LOCAL_NETWORK_PROFILE_VALUES = new Set([
  "local-surfpool",
  "local",
  "localnet",
  "surfpool",
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

/**
 * URL hostnames keep IPv6 brackets (`new URL("ws://[::1]:1").hostname === "[::1]"`), which every
 * consumer here must strip before comparing or handing to `net.connect` — the socket API treats a
 * bracketed literal as a DNS name and fails with ENOTFOUND.
 */
export function normalizeHostname(hostname) {
  return String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
}

export function isLoopbackHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) && octets[0] === 127;
}

function allowedEndpointProtocols(options = {}) {
  if (options.protocol) return [options.protocol];
  return options.protocols ?? ["http:", "ws:"];
}

export function assertLoopbackEndpoint(raw, label = "endpoint", options = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SurfpoolSafetyError(`${label} must be a valid localhost URL; got ${JSON.stringify(raw)}`);
  }

  const protocols = allowedEndpointProtocols(options);
  if (!protocols.includes(url.protocol)) {
    const expected = protocols.map((protocol) => protocol.replace(":", "://")).join(" or ");
    throw new SurfpoolSafetyError(`${label} must use ${expected} for local Surfpool; got ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new SurfpoolSafetyError(`${label} must not include credentials`);
  }

  if (!isLoopbackHostname(url.hostname)) {
    throw new SurfpoolSafetyError(`${label} must bind to loopback only; got host ${url.hostname}`);
  }

  if (!url.port) {
    throw new SurfpoolSafetyError(`${label} must include an explicit dynamically assigned port; got ${url.href}`);
  }

  return url;
}

function expectedEndpointProtocolForEnvKey(key) {
  return key === "DEMO_DEVNET_RPC_WS" || key === "NEXT_PUBLIC_RPC_WS_ENDPOINT" ? "ws:" : "http:";
}

export function assertLocalOnlyEnvironment(env = process.env, options = {}) {
  const endpointKeys = options.endpointKeys ?? LOCAL_ENDPOINT_ENV_KEYS;
  const profileKeys = options.profileKeys ?? NETWORK_PROFILE_ENV_KEYS;

  for (const key of endpointKeys) {
    const value = env[key]?.trim();
    if (!value) continue;
    assertLoopbackEndpoint(value, key, { protocol: expectedEndpointProtocolForEnvKey(key) });
  }

  for (const key of profileKeys) {
    const value = env[key]?.trim().toLowerCase();
    if (!value) continue;
    if (!LOCAL_NETWORK_PROFILE_VALUES.has(value)) {
      throw new SurfpoolSafetyError(`${key}=${value} is not allowed in the local Surfpool validation lane; use local-surfpool or a local alias`);
    }
  }
}

function isSameOrChild(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoSymlinkPathComponents(repoRoot, absolutePath, label) {
  const relative = path.relative(repoRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SurfpoolSafetyError(`${label} must stay inside the repository; got ${absolutePath}`);
  }
  let current = repoRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) {
      throw new SurfpoolSafetyError(`${label} must not traverse symbolic links; got ${absolutePath}`);
    }
  }
}

export function resolveRepositorySubpath(repoRoot, requestedPath, baseRelativeDir, label = "path") {
  if (!repoRoot) throw new SurfpoolSafetyError(`${label} requires repoRoot`);
  if (!requestedPath) throw new SurfpoolSafetyError(`${label} requires a path`);
  if (!baseRelativeDir) throw new SurfpoolSafetyError(`${label} requires a repository-local base directory`);
  const realRepoRoot = fs.realpathSync(repoRoot);
  const base = path.resolve(realRepoRoot, baseRelativeDir);
  const candidate = path.resolve(realRepoRoot, requestedPath);
  if (!isSameOrChild(base, candidate)) {
    throw new SurfpoolSafetyError(`${label} must stay under ${baseRelativeDir}; got ${requestedPath}`);
  }
  assertNoSymlinkPathComponents(realRepoRoot, candidate, label);
  return candidate;
}

export const QUASAR_PROGRAM_SOURCE_DIRS = Object.freeze({
  escrow: "experiments/quasar-escrow",
  registry: "experiments/quasar-registry",
  reputation: "experiments/quasar-reputation",
  attestation: "experiments/quasar-attestation",
});

/** The program ID a Quasar crate compiles with, from its `declare_id!`. */
export function declaredQuasarProgramId(repoRoot, sourceDir) {
  const relative = path.join(sourceDir, "src/lib.rs");
  let source;
  try {
    source = fs.readFileSync(path.join(repoRoot, relative), "utf8");
  } catch (error) {
    throw new SurfpoolSafetyError(`declare_id! not found: cannot read ${relative} (${error.code ?? error.message})`);
  }
  const declared = source.match(/declare_id!\("([^"]+)"\)/)?.[1];
  if (!declared) throw new SurfpoolSafetyError(`declare_id! not found in ${relative}`);
  return declared;
}

/**
 * Quasar owner checks and the reveal commitment pre-image compare against `declare_id!`, so a
 * configured program ID that drifts from its source would deploy binaries at an address the program
 * itself rejects. This runs as a lane precondition, before anything is built or started.
 */
export function assertQuasarProgramIdsMatchSources(repoRoot, configuredIds) {
  const drift = [];
  for (const [key, dir] of Object.entries(QUASAR_PROGRAM_SOURCE_DIRS)) {
    if (!configuredIds?.[key]) {
      throw new SurfpoolSafetyError(`missing Quasar ${key} program ID in config/quasar/deployments.json`);
    }
    const declared = declaredQuasarProgramId(repoRoot, dir);
    if (declared !== configuredIds[key]) {
      drift.push(`${key}: configured ${configuredIds[key]}, ${dir}/src/lib.rs declares ${declared}`);
    }
  }
  if (drift.length) {
    throw new SurfpoolSafetyError(`Quasar program IDs drifted from their declare_id! sources: ${drift.join("; ")}`);
  }
  return true;
}

export function validateSurfnetEndpoints(surfnet) {
  const rpcUrl = String(surfnet?.rpcUrl ?? "");
  const wsUrl = String(surfnet?.wsUrl ?? "");
  const rpc = assertLoopbackEndpoint(rpcUrl, "Surfnet RPC URL", { protocol: "http:" });
  const ws = assertLoopbackEndpoint(wsUrl, "Surfnet WebSocket URL", { protocol: "ws:" });

  // Both URLs already carry an explicit port. Comparing the port numbers rather than the host and
  // port together is deliberate: `localhost` and `127.0.0.1` are different strings for the same
  // loopback stack, so an SDK reporting one dynamically assigned port under two spellings would
  // otherwise pass as two sockets.
  const rpcPort = Number.parseInt(rpc.port, 10);
  const wsPort = Number.parseInt(ws.port, 10);
  if (!Number.isInteger(rpcPort) || !Number.isInteger(wsPort)) {
    throw new SurfpoolSafetyError(`Surfnet endpoints must report explicit numeric dynamic ports; got ${rpc.href} and ${ws.href}`);
  }
  if (rpcPort === wsPort) {
    throw new SurfpoolSafetyError(
      `Surfnet RPC and WebSocket endpoints must be bound to distinct dynamic ports; both reported port ${rpcPort}`,
    );
  }

  return {
    rpcUrl: rpc.href,
    wsUrl: ws.href,
    rpcPort,
    wsPort,
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

async function runReadinessAttempt(probe, rpcUrl, { signal, attempts, budgetMs }) {
  const attemptController = new AbortController();
  const abortAttempt = (reason) => {
    if (!attemptController.signal.aborted) attemptController.abort(reason);
  };
  const onOuterAbort = () => abortAttempt(signal.reason ?? new Error("readiness aborted"));
  if (signal) {
    if (signal.aborted) abortAttempt(signal.reason ?? new Error("readiness aborted"));
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  let deadlineTimer;
  const deadline = new Promise((_, reject) => {
    deadlineTimer = setTimeout(() => {
      const error = new Error(`readiness probe attempt ${attempts} exceeded ${budgetMs}ms`);
      abortAttempt(error);
      reject(error);
    }, budgetMs);
  });

  try {
    return await Promise.race([
      (async () => probe(rpcUrl, { signal: attemptController.signal, attempts }))(),
      deadline,
    ]);
  } finally {
    clearTimeout(deadlineTimer);
    abortAttempt(new Error("readiness probe attempt settled"));
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }
}

export async function waitForSurfnetReadiness(rpcUrl, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 250;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? Math.max(intervalMs * 4, 2_000);
  const probe = options.probe ?? defaultReadinessProbe;
  const signal = options.signal;
  const startedAt = Date.now();
  let attempts = 0;
  let lastError;

  while (Date.now() - startedAt <= timeoutMs) {
    if (signal?.aborted) throw signal.reason ?? new Error("readiness aborted");
    attempts += 1;
    const budgetMs = Math.max(1, Math.min(timeoutMs - (Date.now() - startedAt), attemptTimeoutMs));
    try {
      if (await runReadinessAttempt(probe, rpcUrl, { signal, attempts, budgetMs })) return { attempts };
    } catch (error) {
      lastError = error;
    }
    if (Date.now() - startedAt > timeoutMs) break;
    await sleep(intervalMs, signal);
  }

  throw new SurfpoolReadinessError(`Surfnet RPC did not become ready within ${timeoutMs}ms`, {
    attempts,
    cause: lastError,
  });
}

export async function stopWithRetries(stopFn, options = {}) {
  const attempts = Math.max(1, options.attempts ?? 2);
  const retryDelayMs = options.retryDelayMs ?? 50;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      stopFn();
      return { attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(retryDelayMs);
    }
  }
  throw lastError ?? new Error("Surfnet stop failed without an error");
}

export async function stopLocalSurfnetLease(lease, options = {}) {
  if (!lease?.stop) return { attempts: 0 };
  return stopWithRetries(() => lease.stop(), options);
}

export async function startLocalSurfnet(Surfnet, options = {}) {
  assertLocalOnlyEnvironment(options.env ?? process.env);
  const requestedConfig = options.config ?? {};
  if (Object.hasOwn(requestedConfig, "offline") && requestedConfig.offline !== true) {
    throw new SurfpoolSafetyError("Surfnet config override offline=false is not allowed in the local Surfpool validation lane");
  }
  if (Object.hasOwn(requestedConfig, "airdropSol") && requestedConfig.airdropSol !== 0) {
    throw new SurfpoolSafetyError("Surfnet config override airdropSol must remain 0 in the local Surfpool validation lane");
  }
  if (Object.hasOwn(requestedConfig, "blockProductionMode") && requestedConfig.blockProductionMode !== "transaction") {
    throw new SurfpoolSafetyError("Surfnet config override blockProductionMode must remain transaction in the local Surfpool validation lane");
  }
  if (requestedConfig.remoteRpcUrl) {
    assertLoopbackEndpoint(requestedConfig.remoteRpcUrl, "Surfnet remoteRpcUrl", { protocol: "http:" });
  }
  const config = {
    ...requestedConfig,
    offline: true,
    airdropSol: 0,
    blockProductionMode: "transaction",
  };

  const surfnet = Surfnet.startWithConfig(config);
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    surfnet.stop();
    stopped = true;
  };

  // Everything after the SDK hands back a running Surfnet is inside cleanup ownership: a rejected
  // endpoint must stop the instance it already started, not leave its ports bound.
  try {
    const endpoints = validateSurfnetEndpoints(surfnet);
    const readiness = await waitForSurfnetReadiness(endpoints.rpcUrl, {
      timeoutMs: options.readinessTimeoutMs,
      intervalMs: options.readinessIntervalMs,
      attemptTimeoutMs: options.readinessAttemptTimeoutMs,
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
    try {
      await stopWithRetries(stop, {
        attempts: options.stopAttempts ?? 2,
        retryDelayMs: options.stopRetryDelayMs ?? 50,
      });
    } catch (stopError) {
      if (error instanceof Error) {
        error.message = `${error.message}; additionally failed to stop Surfnet after startup failure: ${stopError.message}`;
        if (!error.cause) error.cause = stopError;
      }
    }
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
  const anchorFallback = lines.some((line) => /fallback used|L1 fallback|legacy Anchor\/PER paths/i.test(line));
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

export const OVERSIZED_LOG_LINE_MARKER = "[redacted: oversized unterminated log line omitted]\n";

export function createRedactingLineBuffer(options = {}) {
  const decoder = new StringDecoder("utf8");
  const maxResidualChars = options.maxResidualChars ?? 1_000_000;
  let residual = "";
  let droppingOversizedLine = false;

  const firstLineBreakIndex = (text) => {
    const newline = text.indexOf("\n");
    const carriage = text.indexOf("\r");
    if (newline === -1) return carriage;
    if (carriage === -1) return newline;
    return Math.min(newline, carriage);
  };

  const processDecoded = (decoded) => {
    let emitted = "";
    let remaining = decoded;

    while (remaining) {
      const breakIndex = firstLineBreakIndex(remaining);
      if (breakIndex === -1) {
        if (!droppingOversizedLine) {
          residual += remaining;
          if (residual.length >= maxResidualChars) {
            residual = "";
            droppingOversizedLine = true;
            emitted += OVERSIZED_LOG_LINE_MARKER;
          }
        }
        return emitted;
      }

      const record = remaining.slice(0, breakIndex + 1);
      remaining = remaining.slice(breakIndex + 1);

      if (droppingOversizedLine) {
        droppingOversizedLine = false;
        residual = "";
        continue;
      }

      residual += record;
      if (residual.length >= maxResidualChars) emitted += OVERSIZED_LOG_LINE_MARKER;
      else emitted += redactForEvidence(residual, options);
      residual = "";
    }

    return emitted;
  };

  return {
    push(chunk) {
      return processDecoded(typeof chunk === "string" ? chunk : decoder.write(chunk));
    },
    flush() {
      let emitted = processDecoded(decoder.end());
      if (droppingOversizedLine) {
        droppingOversizedLine = false;
        residual = "";
        return emitted;
      }
      if (residual) {
        emitted += residual.length >= maxResidualChars ? OVERSIZED_LOG_LINE_MARKER : redactForEvidence(residual, options);
        residual = "";
      }
      return emitted;
    },
  };
}

/**
 * Bounded in-memory buffer for the text the lane asserts on. Keeps a deterministic head (so
 * assertion-critical banners printed early are never lost) and a sliding tail, and reports what it
 * dropped in between rather than silently discarding the front.
 */
export function createTruncatingEvidenceBuffer(options = {}) {
  const headLimit = options.headLimit ?? 512_000;
  const tailLimit = options.tailLimit ?? 1_500_000;
  const describeOmission = options.describeOmission
    ?? ((chars, count) => `\n[truncated: omitted ${chars} characters in ${count} chunk(s) between the retained head and tail]\n`);
  const head = [];
  const tail = [];
  let headLength = 0;
  let tailLength = 0;
  let omittedChars = 0;
  let omittedChunks = 0;

  return {
    push(text) {
      if (!text) return;
      if (headLength < headLimit) {
        head.push(text);
        headLength += text.length;
        return;
      }
      tail.push(text);
      tailLength += text.length;
      while (tailLength > tailLimit && tail.length > 1) {
        const dropped = tail.shift();
        tailLength -= dropped.length;
        omittedChars += dropped.length;
        omittedChunks += 1;
      }
    },
    get omittedChars() { return omittedChars; },
    get omittedChunks() { return omittedChunks; },
    text() {
      if (omittedChunks === 0) return head.join("") + tail.join("");
      return `${head.join("")}${describeOmission(omittedChars, omittedChunks)}${tail.join("")}`;
    },
  };
}

/**
 * PATH for lane child processes: the pinned user-scoped baseline toolchain first, then the repo's
 * own binaries, then whatever the caller had.
 */
export function baselinePath({ repoRoot, home = process.env.HOME, inheritedPath = process.env.PATH } = {}) {
  if (!repoRoot) throw new Error("baselinePath requires repoRoot");
  return [
    path.join(home ?? "", ".cargo/bin"),
    path.join(home ?? "", ".local/share/solana/reddi-agent-protocol-baseline/install/active_release/bin"),
    path.join(home ?? "", ".local/share/surfpool/releases/v1.5.0/bin"),
    path.join(repoRoot, "node_modules/.bin"),
    inheritedPath ?? "",
  ].filter(Boolean).join(path.delimiter);
}

/**
 * The complete environment a lane child runs with under `replaceEnv`. Nothing is inherited that the
 * lane has not pinned, and dotenv is disabled so a gitignored .env.devnet cannot reintroduce a
 * remote endpoint or mint.
 */
export function localChildEnv(overrides = {}, { repoRoot, childTmpDir, home = process.env.HOME, nodeEnv = process.env.NODE_ENV } = {}) {
  if (!repoRoot) throw new Error("localChildEnv requires repoRoot");
  if (!childTmpDir) throw new Error("localChildEnv requires childTmpDir");
  return {
    ...overrides,
    HOME: home,
    PATH: baselinePath({ repoRoot, home }),
    NODE_ENV: nodeEnv ?? "test",
    npm_config_audit: "false",
    npm_config_fund: "false",
    DEMO_DISABLE_DOTENV: "true",
    TMPDIR: childTmpDir,
  };
}

/**
 * Signal a detached child's process group, then escalate to SIGKILL after a delay. The escalation is
 * cancellable: once the exact child has exited, `cancel()` must be called so a recycled pid can never
 * receive the delayed group kill.
 */
export function scheduleProcessGroupTermination(child, signal, options = {}) {
  const killDelayMs = options.killDelayMs ?? 5_000;
  const kill = options.kill ?? ((pid, sig) => process.kill(pid, sig));
  const pid = child?.pid;
  if (!pid) return { cancel() {}, get cancelled() { return true; } };

  try {
    kill(-pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }

  let cancelled = false;
  const timer = setTimeout(() => {
    if (cancelled) return;
    try { kill(-pid, "SIGKILL"); } catch { /* already gone */ }
  }, killDelayMs);
  timer.unref?.();

  return {
    cancel() {
      cancelled = true;
      clearTimeout(timer);
    },
    get cancelled() { return cancelled; },
  };
}

export async function waitForPortClosed(endpoint, options = {}) {
  const url = assertLoopbackEndpoint(endpoint, "closed-port probe endpoint");
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 100;
  const startedAt = Date.now();

  const host = normalizeHostname(url.hostname);
  const port = Number.parseInt(url.port, 10);

  while (Date.now() - startedAt <= timeoutMs) {
    if (await probePortClosed(host, port)) return true;
    await sleep(intervalMs, options.signal);
  }

  throw new Error(`Timed out waiting for ${url.href} to close`);
}

export function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("sleep aborted"));
  return new Promise((resolve, reject) => {
    const settle = (settleFn, value) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      settleFn(value);
    };
    const onAbort = () => settle(reject, signal.reason ?? new Error("sleep aborted"));
    const timer = setTimeout(() => settle(resolve, undefined), ms);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Refusal is the only proof a port is closed. A successful connect means it is still bound, and a
 * connect that neither succeeds nor is refused (timeout) proves nothing, so it keeps the caller
 * waiting instead of reporting closure. Any other socket error means the probe itself could not run
 * — a bad host, an unavailable address family — and is raised rather than mistaken for closure.
 */
const PORT_CLOSED_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET"]);

function probePortClosed(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const done = (settle, value) => {
      socket.removeAllListeners();
      socket.destroy();
      settle(value);
    };
    socket.setTimeout(200);
    socket.once("connect", () => done(resolve, false));
    socket.once("timeout", () => done(resolve, false));
    socket.once("error", (error) => {
      if (PORT_CLOSED_ERROR_CODES.has(error?.code)) return done(resolve, true);
      done(
        reject,
        new SurfpoolSafetyError(
          `closed-port probe for ${host}:${port} could not run (${error?.code ?? error?.message ?? error}); refusing to report the port as closed`,
        ),
      );
    });
  });
}
