/**
 * `rap-provider doctor`: a read-only preflight. It sends nothing and spends
 * nothing. Each line says what was checked and, when it failed, what to do.
 */
import { accessSync, constants, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { checkProviderCluster, checkTokenAccount, checkTreasuryReadiness, ESCROW_PROTOCOL_TREASURY, token2022MintPosture, treasuryTokenAccount } from "@reddi/x402-solana";
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

/** Enough for transaction fees, with room for the rent of a token account. */
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

  if (config.paused) {
    add({ name: "Payments", status: "warn", detail: `paused for ${terms.price.currency}: no new locks are taken`, fix: `Remove ${terms.price.currency} from pausedCurrencies (and RAP_PROVIDER_PAUSED_CURRENCIES) and restart to take payments again.` });
  }

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
    const heldCheck = checkTokenAccount(tokenAccount, held, { mint: terms.mint, tokenProgram: terms.tokenProgram, owner: terms.payee });
    let recoveryReady = false;
    if (terms.payoutAccount) {
      const recovery = checkTokenAccount(terms.payoutAccount, await chain.readAccount(terms.payoutAccount), { mint: terms.mint, tokenProgram: terms.tokenProgram, owner: terms.payee });
      recoveryReady = recovery.ok;
      add(recovery.ok
        ? { name: "Recovery payout account", status: "pass", detail: `${terms.payoutAccount.toBase58()} can receive payouts if the usual account cannot` }
        : { name: "Recovery payout account", status: "fail", detail: `${terms.payoutAccount.toBase58()}: ${recovery.detail}`, fix: `Set payoutAccount to a ${terms.price.currency} token account this wallet owns, or remove the setting.` });
    }
    if (heldCheck.ok) {
      add({ name: `${terms.price.currency} token account`, status: "pass", detail: `${tokenAccount.toBase58()} receives payouts` });
    } else if (heldCheck.problem === "missing") {
      add({ name: `${terms.price.currency} token account`, status: "fail", detail: `${tokenAccount.toBase58()} does not exist, so no payout can land`, fix: `Create it: ${createCommand}` });
    } else if (heldCheck.problem === "frozen" || heldCheck.problem === "memo_required") {
      add({
        name: `${terms.price.currency} token account`,
        status: recoveryReady ? "warn" : "fail",
        detail: `${tokenAccount.toBase58()} is ${heldCheck.detail}, so payouts to it fail`,
        fix: recoveryReady ? "Payouts go to your recovery payout account until this is resolved." : heldCheck.problem === "frozen" ? `Ask the issuer to unfreeze it, or set payoutAccount to another ${terms.price.currency} token account this wallet owns.` : "Turn off required memos on it (spl-token disable-required-transfer-memos).",
      });
    } else {
      add({ name: `${terms.price.currency} token account`, status: "fail", detail: `${tokenAccount.toBase58()} is not this wallet's token account for the mint (${heldCheck.detail})`, fix: `Create it: ${createCommand}` });
    }

    const treasury = await checkTreasuryReadiness((address) => chain.readAccount(address), [{ symbol: terms.price.currency, mint: terms.mint, tokenProgram: terms.tokenProgram }], ESCROW_PROTOCOL_TREASURY);
    const notReady = treasury.items.find((item) => !item.ok);
    add(notReady
      ? { name: "Protocol treasury", status: "fail", detail: `${notReady.name}: ${notReady.detail}`, fix: `The protocol treasury cannot receive ${terms.price.currency} fees on this network yet, and a settle does not create its account. This provider refuses calls in ${terms.price.currency} until it is ready. ${config.network === "solana-devnet" && notReady.detail.startsWith("missing") ? `On devnet anyone can create it once: spl-token create-account ${terms.mint.toBase58()} --owner ${ESCROW_PROTOCOL_TREASURY.toBase58()} --fee-payer <your keypair> --url devnet` : "Report it to the Reddi Agent Protocol team."}` }
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
