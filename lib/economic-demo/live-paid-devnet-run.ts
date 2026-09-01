import { createHash, randomUUID } from "node:crypto";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { parseX402Header } from "@reddi/x402-solana";
import { SUBMISSION_BLOCKED, SUBMISSION_BLOCKED_REASON } from "@/lib/program";
import { openRouterAll30EndpointEvidence } from "@/lib/economic-demo/openrouter-endpoints";
import { economicDemoScenarios, type EconomicDemoScenarioId } from "@/lib/economic-demo/fixture";

export const ECONOMIC_DEMO_LIVE_PAID_DEVNET_SCHEMA_VERSION =
  "reddi.economic-demo.live-paid-devnet-run.v1" as const;

export const ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM =
  "RUN_ECONOMIC_DEMO_LIVE_PAID_DEVNET" as const;

export const ECONOMIC_DEMO_LIVE_PAID_DEVNET_PROFILE_IDS = [
  "planning-agent",
  "content-creation-agent",
  "code-generation-agent",
  "verification-validation-agent",
] as const;

const DEFAULT_DEVNET_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDC_DECIMALS = 6;
const DEFAULT_MAX_USDC = 0.2;
const MAX_CALLS = 4;
const REQUEST_TIMEOUT_MS = 12_000;

export type EconomicDemoLivePaidDevnetStatus =
  | "not_armed"
  | "blocked"
  | "complete";

export type EconomicDemoLivePaidDevnetStep = {
  id: string;
  profileId: string;
  endpoint: string;
  status:
    | "challenge_observed"
    | "payment_submitted"
    | "completion_returned"
    | "blocked";
  httpStatus?: number | null;
  amountUsdc?: string;
  payTo?: string;
  txSignature?: string;
  outputPreview?: string;
  error?: string;
};

export type EconomicDemoLivePaidDevnetRun = {
  schemaVersion: typeof ECONOMIC_DEMO_LIVE_PAID_DEVNET_SCHEMA_VERSION;
  runId: string;
  generatedAt: string;
  status: EconomicDemoLivePaidDevnetStatus;
  scenarioId: EconomicDemoScenarioId;
  promptHash: string;
  network: "solana-devnet";
  orchestratorWallet: string | null;
  maxCalls: number;
  maxUsdc: number;
  spentUsdc: string;
  timeline: EconomicDemoLivePaidDevnetStep[];
  guardrails: {
    devnetOnly: true;
    exactAllowlistedEndpointsOnly: true;
    orchestratorSignerEnvOnly: true;
    hardCallCap: number;
    hardSpendCapUsdc: number;
    noMainnet: true;
    noArbitraryEndpointCalls: true;
    noRawSignerMaterialInResponse: true;
  };
  futureGuardrails: string[];
  claimBoundary: string;
};

type Env = Record<string, string | undefined>;

const allowlistedEndpoints = Object.fromEntries(
  openRouterAll30EndpointEvidence.map((entry) => [entry.profileId, entry]),
) as Record<string, (typeof openRouterAll30EndpointEvidence)[number]>;

function hashPrompt(prompt: string) {
  return `sha256:${createHash("sha256").update(prompt).digest("hex")}`;
}

function scenarioFor(id: unknown) {
  if (typeof id === "string") {
    const found = economicDemoScenarios.find((scenario) => scenario.id === id);
    if (found) return found;
  }
  return economicDemoScenarios[0];
}

function parseKeypairFromEnv(raw: string): Keypair {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("orchestrator_keypair_must_be_byte_array");
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function envConfig(env: Env) {
  const maxUsdc = Number(env.ECONOMIC_DEMO_LIVE_PAID_DEVNET_MAX_USDC ?? DEFAULT_MAX_USDC);
  return {
    armed: env.ECONOMIC_DEMO_LIVE_PAID_DEVNET === "1" || env.ECONOMIC_DEMO_LIVE_PAID_DEVNET === "true",
    confirm: env.ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM,
    signerJson: env.ECONOMIC_DEMO_ORCHESTRATOR_DEVNET_KEYPAIR_JSON,
    rpcUrl: env.SOLANA_RPC_URL ?? DEFAULT_DEVNET_RPC_URL,
    usdcMint: env.X402_USDC_DEVNET_MINT ?? DEFAULT_DEVNET_USDC_MINT,
    maxUsdc: Number.isFinite(maxUsdc) && maxUsdc > 0 && maxUsdc <= DEFAULT_MAX_USDC ? maxUsdc : DEFAULT_MAX_USDC,
  };
}

function baseRun(input: {
  scenarioId?: EconomicDemoScenarioId;
  prompt?: string;
  status: EconomicDemoLivePaidDevnetStatus;
  orchestratorWallet: string | null;
  maxUsdc: number;
  spentUsdc?: string;
  timeline?: EconomicDemoLivePaidDevnetStep[];
}): EconomicDemoLivePaidDevnetRun {
  const scenario = scenarioFor(input.scenarioId);
  const prompt = typeof input.prompt === "string" && input.prompt.trim() ? input.prompt.trim().slice(0, 800) : scenario.prompt;
  return {
    schemaVersion: ECONOMIC_DEMO_LIVE_PAID_DEVNET_SCHEMA_VERSION,
    runId: `economic-demo-paid-devnet-${randomUUID()}`,
    generatedAt: new Date().toISOString(),
    status: input.status,
    scenarioId: scenario.id,
    promptHash: hashPrompt(prompt),
    network: "solana-devnet",
    orchestratorWallet: input.orchestratorWallet,
    maxCalls: MAX_CALLS,
    maxUsdc: input.maxUsdc,
    spentUsdc: input.spentUsdc ?? "0",
    timeline: input.timeline ?? [],
    guardrails: {
      devnetOnly: true,
      exactAllowlistedEndpointsOnly: true,
      orchestratorSignerEnvOnly: true,
      hardCallCap: MAX_CALLS,
      hardSpendCapUsdc: input.maxUsdc,
      noMainnet: true,
      noArbitraryEndpointCalls: true,
      noRawSignerMaterialInResponse: true,
    },
    futureGuardrails: [
      "Per-agent daily spend budgets with persisted counters instead of per-run caps only.",
      "Automated devnet wallet rotation and stale-key retirement.",
      "Richer funding preflight that checks SPL-token balances before first downstream call.",
      "Operator dashboard for downstream receipt reconciliation and refund/dispute paths.",
    ],
    claimBoundary:
      "Live paid devnet lane only when explicitly armed: orchestrator-owned devnet signer pays exact allowlisted specialist x402 challenges on solana-devnet. No mainnet, no arbitrary endpoints, and no production settlement claim.",
  };
}

async function fetchWithTimeout(endpoint: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(endpoint, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

function usdcToBaseUnits(amount: number): bigint {
  return BigInt(Math.ceil(amount * 10 ** USDC_DECIMALS));
}

async function payUsdcChallenge(input: {
  connection: Connection;
  signer: Keypair;
  mint: PublicKey;
  payTo: PublicKey;
  amount: number;
}) {
  const sourceTokenAccount = getAssociatedTokenAddressSync(input.mint, input.signer.publicKey);
  const requiredBaseUnits = usdcToBaseUnits(input.amount);
  try {
    const sourceAccount = await getAccount(input.connection, sourceTokenAccount, "confirmed");
    if (sourceAccount.amount < requiredBaseUnits) {
      throw new Error("insufficient_devnet_usdc");
    }
  } catch {
    throw new Error(`orchestrator wallet lacks enough devnet USDC for challenge: required ${input.amount} USDC`);
  }

  const destinationTokenAccount = getAssociatedTokenAddressSync(input.mint, input.payTo);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      input.signer.publicKey,
      destinationTokenAccount,
      input.payTo,
      input.mint,
    ),
    createTransferCheckedInstruction(
      sourceTokenAccount,
      input.mint,
      destinationTokenAccount,
      input.signer.publicKey,
      usdcToBaseUnits(input.amount),
      USDC_DECIMALS,
    ),
  );
  const signature = await sendAndConfirmTransaction(input.connection, tx, [input.signer], {
    commitment: "confirmed",
    maxRetries: 1,
  });
  return { signature, destinationTokenAccount: destinationTokenAccount.toBase58() };
}

export async function runEconomicDemoLivePaidDevnet(options?: {
  scenarioId?: EconomicDemoScenarioId;
  prompt?: string;
  env?: Env;
}): Promise<EconomicDemoLivePaidDevnetRun> {
  const cfg = envConfig(options?.env ?? process.env);
  if (!cfg.armed || cfg.confirm !== ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM || !cfg.signerJson) {
    return baseRun({
      scenarioId: options?.scenarioId,
      prompt: options?.prompt,
      status: "not_armed",
      orchestratorWallet: null,
      maxUsdc: cfg.maxUsdc,
      timeline: [
        {
          id: "live_paid_lane_not_armed",
          profileId: "orchestrator",
          endpoint: "env",
          status: "blocked",
          error: "live paid lane not armed: set ECONOMIC_DEMO_LIVE_PAID_DEVNET=1, exact confirmation token, and ECONOMIC_DEMO_ORCHESTRATOR_DEVNET_KEYPAIR_JSON",
        },
      ],
    });
  }

  if (SUBMISSION_BLOCKED) {
    return baseRun({
      scenarioId: options?.scenarioId,
      prompt: options?.prompt,
      status: "blocked",
      orchestratorWallet: null,
      maxUsdc: cfg.maxUsdc,
      timeline: [
        {
          id: "profile_not_submission_ready",
          profileId: "orchestrator",
          endpoint: "network-profile",
          status: "blocked",
          error: SUBMISSION_BLOCKED_REASON,
        },
      ],
    });
  }

  let signer: Keypair;
  try {
    signer = parseKeypairFromEnv(cfg.signerJson);
  } catch {
    return baseRun({
      scenarioId: options?.scenarioId,
      prompt: options?.prompt,
      status: "blocked",
      orchestratorWallet: null,
      maxUsdc: cfg.maxUsdc,
      timeline: [{ id: "signer_parse_failed", profileId: "orchestrator", endpoint: "env", status: "blocked", error: "orchestrator signer env could not be parsed as a keypair byte array" }],
    });
  }

  const scenario = scenarioFor(options?.scenarioId);
  const prompt = typeof options?.prompt === "string" && options.prompt.trim() ? options.prompt.trim().slice(0, 800) : scenario.prompt;
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const mint = new PublicKey(cfg.usdcMint);
  const timeline: EconomicDemoLivePaidDevnetStep[] = [];
  let spent = 0;

  for (const profileId of ECONOMIC_DEMO_LIVE_PAID_DEVNET_PROFILE_IDS) {
    if (timeline.filter((step) => step.status === "completion_returned").length >= MAX_CALLS) break;
    const entry = allowlistedEndpoints[profileId];
    try {
      const first = await fetchWithTimeout(entry.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: profileId, messages: [{ role: "user", content: prompt }], max_tokens: 180 }),
      });
      const challengeHeader = first.headers.get("x402-request");
      if (first.status !== 402 || !challengeHeader) throw new Error(`expected_402_challenge_got_${first.status}`);
      const challenge = parseX402Header(challengeHeader);
      if (challenge.network !== "solana-devnet" || challenge.currency !== "USDC" || challenge.endpoint !== entry.endpoint || challenge.paymentAddress !== entry.walletAddress) {
        throw new Error("challenge_did_not_match_exact_allowlist");
      }
      if (spent + challenge.amount > cfg.maxUsdc) throw new Error("hard_spend_cap_exceeded");
      timeline.push({ id: `${profileId}:challenge`, profileId, endpoint: entry.endpoint, status: "challenge_observed", httpStatus: first.status, amountUsdc: String(challenge.amount), payTo: challenge.paymentAddress });

      const payment = await payUsdcChallenge({ connection, signer, mint, payTo: new PublicKey(challenge.paymentAddress), amount: challenge.amount });
      spent += challenge.amount;
      const receipt = {
        network: "solana-devnet",
        payTo: challenge.paymentAddress,
        amount: String(challenge.amount),
        currency: "USDC",
        nonce: challenge.nonce,
        payer: signer.publicKey.toBase58(),
        signature: payment.signature,
        txSignature: payment.signature,
        mint: mint.toBase58(),
        destinationTokenAccount: payment.destinationTokenAccount,
      };
      timeline.push({ id: `${profileId}:payment`, profileId, endpoint: entry.endpoint, status: "payment_submitted", amountUsdc: String(challenge.amount), payTo: challenge.paymentAddress, txSignature: payment.signature });

      const second = await fetchWithTimeout(entry.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x402-payment": JSON.stringify(receipt) },
        body: JSON.stringify({ model: profileId, messages: [{ role: "user", content: prompt }], max_tokens: 180 }),
      });
      const bodyText = await second.text();
      if (!second.ok) throw new Error(`paid_retry_failed_${second.status}:${bodyText.slice(0, 160)}`);
      timeline.push({ id: `${profileId}:completion`, profileId, endpoint: entry.endpoint, status: "completion_returned", httpStatus: second.status, outputPreview: bodyText.slice(0, 280) });
    } catch (error) {
      timeline.push({ id: `${profileId}:blocked`, profileId, endpoint: entry.endpoint, status: "blocked", error: error instanceof Error ? error.message : "live_paid_call_failed" });
      return baseRun({ scenarioId: scenario.id, prompt, status: "blocked", orchestratorWallet: signer.publicKey.toBase58(), maxUsdc: cfg.maxUsdc, spentUsdc: spent.toFixed(6), timeline });
    }
  }

  return baseRun({ scenarioId: scenario.id, prompt, status: "complete", orchestratorWallet: signer.publicKey.toBase58(), maxUsdc: cfg.maxUsdc, spentUsdc: spent.toFixed(6), timeline });
}
