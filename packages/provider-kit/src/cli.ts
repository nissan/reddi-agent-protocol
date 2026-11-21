#!/usr/bin/env node
/**
 * rap-provider: run your own paid provider on Reddi Agent Protocol.
 *
 *   rap-provider init [--wallet <address>] [--config provider.json]
 *   rap-provider doctor [--config provider.json] [--json]
 *   rap-provider start [--config provider.json]
 *   rap-provider register [--config provider.json] [--dry-run]
 *   rap-provider status [--config provider.json]
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { createProviderChain, type ProviderChain } from "./chain.js";
import { listingBody, publishListing, readListings, type ListingFetch } from "./listing.js";
import { AGENT_REGISTRATION_FEE_LAMPORTS, agentAddress, buildRegisterAgentInstruction, readAgentRecord } from "./registry.js";
import { checkProviderCluster } from "@reddi/x402-solana";
import { DEFAULT_CONFIG_FILE, exampleConfig, parseProviderConfig, type ProviderConfig } from "./config.js";
import { formatDoctor, runDoctor } from "./doctor.js";
import { loadProviderKey } from "./keys.js";
import { startProvider } from "./server.js";

const HELP = `rap-provider: run your own paid provider on Reddi Agent Protocol

Commands
  init     Write a starting provider.json (devnet, USDC, mock answers).
  doctor   Check the setup without sending or spending anything.
  start    Serve the paid endpoint.
  register Put the provider in the on-chain registry and list it in the app
           with its per-token price. Run it again to update the listing.
  status   Show the registry record and the listing.

Options
  --config <file>    Config file. Default: provider.json
  --wallet <address> With init: the provider wallet's address.
  --force            With init: overwrite an existing config.
  --json             With doctor: print the checks as JSON.
  --dry-run          With register: print what would be sent and send nothing.

Environment
  SOLANA_RPC_URL             RPC endpoint. Required on mainnet.
  RAP_PROVIDER_KEYPAIR_PATH  The wallet's keypair file, if not in the config.
  UPSTREAM_API_KEY           API key for the model (name set by upstream.apiKeyEnv).
  PORT                       Port to listen on. Default: 8787
  RAP_APP_URL                The app to list in. Default: https://app.agent-protocol.reddi.tech
`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  env: Record<string, string | undefined>;
  /** Replaced in tests. */
  chain?: (config: ProviderConfig, keypair?: import("@solana/web3.js").Keypair) => ProviderChain;
  fetchImpl?: ListingFetch;
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

  if (command === "register" || command === "status") {
    const config = loadConfig(args, io);
    if (!config) return 1;
    const dryRun = args.includes("--dry-run");
    const owner = new PublicKey(config.wallet);
    const agent = agentAddress(config.terms.programId, owner);
    const body = listingBody(config);
    const makeChain = io.chain ?? ((c: ProviderConfig, keypair?: import("@solana/web3.js").Keypair) => createProviderChain(c.rpcUrl, keypair));

    if (command === "status") {
      const chain = makeChain(config);
      const cluster = await checkProviderCluster(() => chain.readGenesisHash(), config.network, config.genesisHash);
      if (!cluster.ok) {
        io.err(`The RPC endpoint is not ${config.network}, or could not be read.`);
        return 1;
      }
      const record = await chain.readAccount(agent).catch(() => undefined);
      const held = record && record.owner.equals(config.terms.programId) ? readAgentRecord(record.data) : undefined;
      io.out(record === undefined ? "Registry: could not be read." : held ? `Registry: registered at ${agent.toBase58()} (model ${held.model}).` : `Registry: not registered (${agent.toBase58()} does not exist).`);
      const listed = await readListings({ config, ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}) });
      if (!listed.ok) {
        io.err(`Listing: ${listed.message}`);
        return 1;
      }
      io.out(listed.listing ? `Listing: shown in ${config.appUrl} as ${JSON.stringify(listed.listing)}` : `Listing: not shown in ${config.appUrl}. A paused or draft listing is not public.`);
      return held && listed.listing ? 0 : 1;
    }

    if (!body.ok) {
      io.err(body.message);
      return 1;
    }
    // The key must be the configured wallet's before anything is read or sent.
    const key = loadProviderKey({ keypairPath: config.keypairPath, wallet: config.wallet });
    if (!key.ok && !dryRun) {
      io.err(`rap-provider cannot register: ${key.message}`);
      return 1;
    }
    const chain = makeChain(config, key.ok ? key.key.keypair : undefined);
    const cluster = await checkProviderCluster(() => chain.readGenesisHash(), config.network, config.genesisHash);
    if (!cluster.ok) {
      io.err(`The RPC endpoint is not ${config.network}, or could not be read. Nothing was sent.`);
      return 1;
    }
    let existing: Awaited<ReturnType<ProviderChain["readAccount"]>>;
    try {
      existing = await chain.readAccount(agent);
    } catch {
      io.err("The registry could not be read. Nothing was sent.");
      return 1;
    }
    if (existing && (!existing.owner.equals(config.terms.programId) || !readAgentRecord(existing.data)?.owner.equals(owner))) {
      io.err(`${agent.toBase58()} exists but is not this wallet's registry record. Nothing was sent.`);
      return 1;
    }
    let instruction: ReturnType<typeof buildRegisterAgentInstruction> | undefined;
    if (!existing) {
      try {
        instruction = buildRegisterAgentInstruction(config.terms.programId, owner, config.model);
      } catch (error) {
        io.err(`model: ${error instanceof Error ? error.message : "cannot be registered"}.`);
        return 1;
      }
    }

    if (dryRun) {
      io.out(JSON.stringify({
        dryRun: true,
        network: config.network,
        registry: existing
          ? { alreadyRegistered: true, account: agent.toBase58() }
          : { instruction: "register_agent", program: config.terms.programId.toBase58(), accounts: instruction!.keys.map((k) => ({ address: k.pubkey.toBase58(), signer: k.isSigner, writable: k.isWritable })), model: config.model, burnsLamports: AGENT_REGISTRATION_FEE_LAMPORTS.toString() },
        listing: { app: config.appUrl, request: "PUT /api/listings", body: body.body },
      }, null, 2));
      io.out(key.ok ? "Dry run: nothing was signed or sent." : `Dry run: nothing was signed or sent. Before a real run: ${key.message}`);
      return 0;
    }
    if (!key.ok) return 1;

    if (instruction) {
      try {
        const signature = await chain.sendInstructions([instruction]);
        io.out(`Registered on chain at ${agent.toBase58()} (transaction ${signature}). 0.01 SOL was burned as the registration fee.`);
      } catch {
        io.err("The registration transaction did not confirm. Check the wallet's SOL balance (rap-provider doctor) and run register again; it sends nothing twice.");
        return 1;
      }
    } else {
      io.out(`Already registered on chain at ${agent.toBase58()}.`);
    }
    const published = await publishListing({ config, body: body.body, signMessage: key.key.signMessage, ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}) });
    if (!published.ok) {
      io.err(`${published.message}\nThe on-chain registration stands. Run register again to retry the listing.`);
      return 1;
    }
    io.out(`Listed in ${config.appUrl} as "${body.body.displayName}" (${body.body.status}): ${config.terms.price.inputPerMillion} in / ${config.terms.price.outputPerMillion} out ${config.terms.price.currency} per million tokens.`);
    return 0;
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
