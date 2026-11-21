/**
 * `rap-provider doctor`: a read-only preflight. It sends nothing and spends
 * nothing. Each line says what was checked and, when it failed, what to do.
 */
import { accessSync, constants, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { checkProviderCluster, checkTreasuryReadiness, ESCROW_PROTOCOL_TREASURY, token2022MintPosture, treasuryTokenAccount } from "@reddi/x402-solana";
import type { ProviderChain } from "./chain.js";
import type { ProviderConfig } from "./config.js";
import type { ProviderKeyResult } from "./keys.js";

export type CheckStatus = "pass" | "warn" | "fail";
export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  /** What to do about a warning or failure. */
  fix?: string;
}

/** Enough for transaction fees and for creating the token accounts a first settle may need. */
export const WALLET_MIN_LAMPORTS = 10_000_000n;
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export interface DoctorInput {
  config: ProviderConfig;
  chain: ProviderChain;
  key: ProviderKeyResult;
  fetchImpl?: FetchLike;
  /** True when the directory can be written. Defaults to a real check. */
  canWrite?: (directory: string) => boolean;
}

const sol = (lamports: bigint) => `${(Number(lamports) / 1e9).toFixed(4)} SOL`;

function defaultCanWrite(directory: string): boolean {
  let current = resolve(directory);
  // The directory may not exist yet: the nearest existing parent must be writable.
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current);
  try {
    accessSync(current, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(input: DoctorInput): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  const { config, chain } = input;
  const { terms } = config;
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck) => checks.push(check);
  const done = () => ({ ok: checks.every((c) => c.status !== "fail"), checks });

  add({ name: "Configuration", status: "pass", detail: `${config.name}: ${config.model}, ${terms.price.inputPerMillion} in / ${terms.price.outputPerMillion} out ${terms.price.currency} per million tokens, at most ${terms.maxOutputTokens} output tokens a call` });

  // Nothing else read from this endpoint means anything until it is the right cluster.
  const cluster = await checkProviderCluster(() => chain.readGenesisHash(), config.network, config.genesisHash);
  if (!cluster.ok) {
    add({
      name: "RPC endpoint",
      status: "fail",
      detail: cluster.reason === "wrong_cluster" ? `the endpoint is not ${config.network}` : "the endpoint could not be read",
      fix: cluster.reason === "wrong_cluster" ? `Point SOLANA_RPC_URL (or rpcUrl) at a ${config.network} endpoint.` : "Check SOLANA_RPC_URL (or rpcUrl) and your network connection.",
    });
    return done();
  }
  add({ name: "RPC endpoint", status: "pass", detail: `serves ${config.network}` });

  try {
    const program = await chain.readAccount(terms.programId);
    add(program?.executable
      ? { name: "Escrow program", status: "pass", detail: `deployed at ${terms.programId.toBase58()}` }
      : { name: "Escrow program", status: "fail", detail: `no program at ${terms.programId.toBase58()} on ${config.network}`, fix: "The V1 program may not be deployed on this network yet. Use solana-devnet until the mainnet release." });

    const wallet = await chain.readAccount(new PublicKey(config.wallet));
    const lamports = wallet?.lamports ?? 0n;
    add(lamports >= WALLET_MIN_LAMPORTS
      ? { name: "Wallet balance", status: "pass", detail: `${sol(lamports)} for fees` }
      : { name: "Wallet balance", status: "fail", detail: `${sol(lamports)} held, at least ${sol(WALLET_MIN_LAMPORTS)} needed for fees and account rent`, fix: config.network === "solana-devnet" ? `Fund ${config.wallet} at https://faucet.solana.com (devnet).` : `Send SOL to ${config.wallet}.` });

    const tokenAccount = treasuryTokenAccount({ mint: terms.mint, tokenProgram: terms.tokenProgram }, terms.payee);
    const held = await chain.readAccount(tokenAccount);
    const createCommand = `spl-token create-account ${terms.mint.toBase58()} --owner ${config.wallet}${terms.tokenProgram.toBase58() === TOKEN_2022_PROGRAM ? ` --program-id ${TOKEN_2022_PROGRAM}` : ""} --url ${config.network === "solana-devnet" ? "devnet" : "mainnet-beta"}`;
    if (!held) {
      add({ name: `${terms.price.currency} token account`, status: "fail", detail: `${tokenAccount.toBase58()} does not exist, so no payout can land`, fix: `Create it: ${createCommand}` });
    } else if (!held.owner.equals(terms.tokenProgram) || held.data.length < 72 || !new PublicKey(held.data.subarray(0, 32)).equals(terms.mint) || !new PublicKey(held.data.subarray(32, 64)).equals(terms.payee)) {
      add({ name: `${terms.price.currency} token account`, status: "fail", detail: `${tokenAccount.toBase58()} is not this wallet's token account for the mint`, fix: `Create it: ${createCommand}` });
    } else {
      add({ name: `${terms.price.currency} token account`, status: "pass", detail: `${tokenAccount.toBase58()} receives payouts` });
    }

    const treasury = await checkTreasuryReadiness((address) => chain.readAccount(address), [{ symbol: terms.price.currency, mint: terms.mint, tokenProgram: terms.tokenProgram }], ESCROW_PROTOCOL_TREASURY);
    // A missing treasury token account is created by the first settle, at the provider's cost.
    const missingAccount = treasury.items.slice(1).some((item) => !item.ok);
    add(!treasury.items[0].ok
      ? { name: "Protocol treasury", status: "fail", detail: treasury.items[0].detail, fix: "The protocol treasury is not ready on this network. Report it to the Reddi Agent Protocol team; do not take payments until it is." }
      : missingAccount
        ? { name: "Protocol treasury", status: "warn", detail: `its ${terms.price.currency} token account does not exist yet`, fix: "Your first settle creates it and pays its rent (about 0.002 SOL)." }
        : { name: "Protocol treasury", status: "pass", detail: `ready to receive the 2.5% fee in ${terms.price.currency}` });

    if (terms.tokenProgram.toBase58() === TOKEN_2022_PROGRAM) {
      const mint = await chain.readAccount(terms.mint);
      if (!mint) {
        add({ name: `${terms.price.currency} mint`, status: "fail", detail: "the mint account does not exist", fix: "Check the mint address in the config." });
      } else {
        const posture = token2022MintPosture(mint.data, terms.mint);
        add(posture.pausable?.paused
          ? { name: `${terms.price.currency} mint`, status: "fail", detail: "the issuer has paused transfers", fix: "Wait until transfers resume, or price in another currency." }
          : posture.transferHookProgram
            ? { name: `${terms.price.currency} mint`, status: "warn", detail: `transfers run the issuer's hook program ${posture.transferHookProgram}`, fix: "Read docs/ESCROW-PAYOUT-SAFETY.md before taking payment in this currency." }
            : { name: `${terms.price.currency} mint`, status: "pass", detail: "transfers are not paused and no transfer hook is set" });
      }
    }
  } catch {
    add({ name: "Chain accounts", status: "fail", detail: "an account could not be read", fix: "Check the RPC endpoint and try again." });
    return done();
  }

  add(input.key.ok
    ? { name: "Signing key", status: "pass", detail: "the key file belongs to the configured wallet" }
    : { name: "Signing key", status: "fail", detail: input.key.message, fix: "Point keypairPath (or RAP_PROVIDER_KEYPAIR_PATH) at the wallet's keypair file." });

  if (config.upstream.mock) {
    add({ name: "Model", status: config.network === "solana-mainnet-beta" ? "fail" : "warn", detail: "mock answers are on, so buyers would pay for canned text", fix: "Set upstream.mock to false and upstream.baseUrl to your model before you list." });
  } else {
    try {
      const response = await fetchImpl(`${config.upstream.baseUrl}/models`, { method: "GET", headers: config.upstream.apiKey ? { authorization: `Bearer ${config.upstream.apiKey}` } : {}, signal: AbortSignal.timeout(10_000) });
      add(response.ok
        ? { name: "Model", status: "pass", detail: `${config.upstream.baseUrl} answers` }
        : { name: "Model", status: "fail", detail: `${config.upstream.baseUrl}/models answered with status ${response.status}`, fix: response.status === 401 || response.status === 403 ? `Set ${config.upstream.apiKeyEnv} to a valid API key.` : "Check upstream.baseUrl." });
    } catch {
      add({ name: "Model", status: "fail", detail: `${config.upstream.baseUrl} could not be reached`, fix: "Check upstream.baseUrl and that the model server is running." });
    }
  }

  const host = new URL(config.publicUrl).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (local) {
    add({ name: "Public address", status: config.network === "solana-mainnet-beta" ? "fail" : "warn", detail: `${config.publicUrl} is only reachable from this machine`, fix: "Set publicUrl to the https address buyers will use before you list." });
  } else {
    try {
      const response = await fetchImpl(`${config.publicUrl}/healthz`, { method: "GET", signal: AbortSignal.timeout(10_000) });
      add(response.ok
        ? { name: "Public address", status: "pass", detail: `${config.publicUrl} answers` }
        : { name: "Public address", status: "warn", detail: `${config.publicUrl}/healthz answered with status ${response.status}`, fix: "Start the provider (rap-provider start) and check the address routes to it." });
    } catch {
      add({ name: "Public address", status: "warn", detail: `${config.publicUrl} did not answer`, fix: "Start the provider (rap-provider start) and check the address routes to it." });
    }
  }

  const replayDirectory = dirname(resolve(config.replayFile));
  add((input.canWrite ?? defaultCanWrite)(replayDirectory)
    ? { name: "Payment memory", status: "pass", detail: `accepted escrows are remembered in ${config.replayFile}` }
    : { name: "Payment memory", status: "fail", detail: `${replayDirectory} cannot be written`, fix: "Set replayFile to a path this process can write, on a disk that survives restarts." });

  return done();
}

const MARK: Record<CheckStatus, string> = { pass: "ok  ", warn: "warn", fail: "FAIL" };

export function formatDoctor(result: { ok: boolean; checks: DoctorCheck[] }): string {
  const lines = result.checks.flatMap((c) => [`${MARK[c.status]}  ${c.name}: ${c.detail}`, ...(c.fix && c.status !== "pass" ? [`      ${c.fix}`] : [])]);
  const failed = result.checks.filter((c) => c.status === "fail").length;
  const warned = result.checks.filter((c) => c.status === "warn").length;
  lines.push("", failed > 0 ? `${failed} to fix before taking payments.` : warned > 0 ? `Ready, with ${warned} to look at.` : "Ready.");
  return lines.join("\n");
}
