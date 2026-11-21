#!/usr/bin/env node
/**
 * rap-provider: run your own paid provider on Reddi Agent Protocol.
 *
 *   rap-provider init [--wallet <address>] [--config provider.json]
 *   rap-provider doctor [--config provider.json] [--json]
 *   rap-provider start [--config provider.json]
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createProviderChain } from "./chain.js";
import { DEFAULT_CONFIG_FILE, exampleConfig, parseProviderConfig, type ProviderConfig } from "./config.js";
import { formatDoctor, runDoctor } from "./doctor.js";
import { loadProviderKey } from "./keys.js";
import { startProvider } from "./server.js";

const HELP = `rap-provider: run your own paid provider on Reddi Agent Protocol

Commands
  init     Write a starting provider.json (devnet, USDC, mock answers).
  doctor   Check the setup without sending or spending anything.
  start    Serve the paid endpoint.

Options
  --config <file>    Config file. Default: provider.json
  --wallet <address> With init: the provider wallet's address.
  --force            With init: overwrite an existing config.
  --json             With doctor: print the checks as JSON.

Environment
  SOLANA_RPC_URL             RPC endpoint. Required on mainnet.
  RAP_PROVIDER_KEYPAIR_PATH  The wallet's keypair file, if not in the config.
  UPSTREAM_API_KEY           API key for the model (name set by upstream.apiKeyEnv).
  PORT                       Port to listen on. Default: 8787
`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  env: Record<string, string | undefined>;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

function loadConfig(args: string[], io: CliIo): ProviderConfig | undefined {
  const path = option(args, "--config") ?? DEFAULT_CONFIG_FILE;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    io.err(`${path} could not be read as JSON. Run "rap-provider init" to write one.`);
    return undefined;
  }
  const promptFile = (raw as { systemPromptFile?: unknown } | null)?.systemPromptFile;
  if (typeof promptFile === "string" && promptFile.trim()) {
    try {
      raw = { ...(raw as object), systemPrompt: readFileSync(resolve(dirname(path), promptFile.trim()), "utf8") };
    } catch {
      io.err(`systemPromptFile: ${promptFile} could not be read.`);
      return undefined;
    }
  }
  const parsed = parseProviderConfig(raw, io.env);
  if (!parsed.ok) {
    io.err(`${path} has ${parsed.errors.length} problem${parsed.errors.length === 1 ? "" : "s"}:\n${parsed.errors.map((e) => `  ${e}`).join("\n")}`);
    return undefined;
  }
  return parsed.config;
}

/** Runs one command. Resolves with the exit code; `start` resolves only when it fails to start. */
export async function runCli(args: string[], io: CliIo): Promise<number> {
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    io.out(HELP);
    return command ? 0 : 1;
  }

  if (command === "init") {
    const path = option(args, "--config") ?? DEFAULT_CONFIG_FILE;
    if (existsSync(path) && !args.includes("--force")) {
      io.err(`${path} already exists. Pass --force to overwrite it.`);
      return 1;
    }
    const wallet = option(args, "--wallet") ?? "";
    const file = exampleConfig(wallet || "YOUR_WALLET_ADDRESS");
    if (wallet && !parseProviderConfig(file, {}).ok) {
      io.err("--wallet must be a Solana address.");
      return 1;
    }
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    io.out(`Wrote ${path}.${wallet ? "" : " Set wallet to your provider wallet's address."}\nNext: rap-provider doctor`);
    return 0;
  }

  if (command === "doctor") {
    const config = loadConfig(args, io);
    if (!config) return 1;
    const key = loadProviderKey({ keypairPath: config.keypairPath, wallet: config.wallet });
    const result = await runDoctor({ config, chain: createProviderChain(config.rpcUrl), key });
    io.out(args.includes("--json") ? JSON.stringify(result, null, 2) : formatDoctor(result));
    return result.ok ? 0 : 1;
  }

  if (command === "start") {
    const config = loadConfig(args, io);
    if (!config) return 1;
    const started = await startProvider(config, { log: (event) => io.out(JSON.stringify({ time: new Date().toISOString(), ...event })) });
    if (!started.ok) {
      io.err(`rap-provider cannot start: ${started.message}`);
      return 1;
    }
    const { terms } = config;
    io.out(`${config.name} is listening on :${config.port} (${config.network}). ${terms.price.inputPerMillion} in / ${terms.price.outputPerMillion} out ${terms.price.currency} per million tokens.${config.upstream.mock ? " Mock answers are ON." : ""}`);
    const stop = () => void started.close().then(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return new Promise<number>(() => undefined);
  }

  io.err(`Unknown command "${command}".\n\n${HELP}`);
  return 1;
}

function invokedDirectly(): boolean {
  if (!process.argv[1]) return false;
  try {
    // npm runs the command through a symlink, so compare real paths.
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  runCli(process.argv.slice(2), { out: (t) => console.log(t), err: (t) => console.error(t), env: process.env }).then((code) => process.exit(code));
}
