"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { buildOpenRatingInstruction } from "@redditech/x402-solana/rating";
import { JobRatingPanel } from "@/components/rating/JobRatingPanel";
import { RateJobOption } from "@/components/rating/RateJobOption";
import { parseJudgeAddress } from "@/lib/rating/rated-pay";
import { browserRatingStorage, rememberRatedJob } from "@/lib/rating/rating-secrets";
import { RATING_RENT_LAMPORTS, RATING_RENT_SOL } from "@/lib/rating/rating-state";
import { buildSandboxMeteredLock, SANDBOX_ESCROW_PROGRAM_ID } from "@/lib/sandbox/escrow";
import { minimumSolPayout, solPayoutWouldFail } from "@redditech/x402-solana/escrow-readiness";

import {
  findSandboxProviderById,
  findSandboxScenario,
  SANDBOX_MODELS_PATH,
  SANDBOX_PROVIDERS,
  SANDBOX_SCENARIOS,
  type SandboxProvider,
  type SandboxScenario,
  type SandboxScenarioId,
  type SandboxSpotCheck,
} from "@/lib/sandbox/catalog";
import {
  callSandbox,
  challengeFrom,
  curlFor,
  devnetPaymentHeader,
  errorMessageOf,
  explorerAddressUrl,
  explorerTxUrl,
  marketingSignupUrl,
  meteredPaymentHeader,
  providerPriceView,
  shortAddress,
  simulatedPaymentHeader,
  triPriceLabel,
  type SandboxChallenge,
  type SandboxExchange,
} from "@/lib/sandbox/client";
import { isSandboxReceipt, responseBodyWithAnswer, type SandboxReceiptPayment, verifySandboxReceipt, type SandboxReceipt, type SandboxVerification } from "@/lib/sandbox/receipt";
import { formatUnits, requestInputTokens, SANDBOX_DEMO_RATES_NOTE, SANDBOX_FEE_BPS, triPriceFromLamports, TYPICAL_REVIEW } from "@/lib/sandbox/pricing";
import { createSessionKey, directPaymentDelegationHeaderValue, directPaymentProofHeaders, paidCallAuthHeaders, sessionDelegationHeaderValue, type MessageSigner } from "@/lib/payments/session-auth";
import SandboxSessionRunner from "@/components/sandbox/SandboxSessionRunner";
import { applySandboxReputation, initialSandboxReputation, type SandboxReputation } from "@/lib/sandbox/reputation";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

/** The sandbox talks to devnet whatever network profile the rest of the app uses. */
const DEVNET_RPC = "https://api.devnet.solana.com";
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
/** How long a delegation to this tab's key runs: an hour, well inside the 24-hour limit asked for in #883. */
const DELEGATION_SECONDS = 3600;
const FEE_HEADROOM_LAMPORTS = 10_000;
/** Rent for the escrow account, returned to the visitor when the provider settles. */
const ESCROW_RENT_HEADROOM_LAMPORTS = 2_500_000;
const FAUCET_URL = "https://faucet.solana.com";
/** Set at build time once the marketing site has an address; the button is hidden until then. */
const SIGNUP_URL = marketingSignupUrl(process.env.NEXT_PUBLIC_MARKETING_ORIGIN);

type PayMode = "simulated" | "wallet";
type Phase = "idle" | "challenged" | "unavailable" | "answered";
type Notice = { tone: "bad" | "good" | "info"; title: string; text: string };

type Answered = {
  provider: SandboxProvider;
  messages: { role: string; content: string }[];
  answer: string;
  /** The request and response body bytes, as text: what the receipt hashes cover. */
  requestText: string;
  responseText: string;
  receipt: SandboxReceipt;
  spotCheck: SandboxSpotCheck;
  paymentHeader: string;
  reputationBefore: SandboxReputation;
  reputationAfter: SandboxReputation;
};

/** Exact SOL-to-lamports for the catalog's decimal strings; refuses anything else. */
function lamportsFromSol(amount: string): number | undefined {
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(amount);
  if (!match) return undefined;
  const lamports = Number(match[1]) * 1_000_000_000 + Number((match[2] ?? "").padEnd(9, "0"));
  return Number.isSafeInteger(lamports) && lamports > 0 ? lamports : undefined;
}

/** A fifth of the challenge's price, in SOL, for the "try to cheat" underpayment. At least one lamport. */
function fifthOfPrice(amount: string): string | undefined {
  const lamports = lamportsFromSol(amount);
  if (lamports === undefined) return undefined;
  return formatUnits(BigInt(Math.max(1, Math.floor(lamports / 5))), 9);
}

/** The most a request can cost with this provider, in lamports: what the challenge asks the buyer to authorise. */
function maxChargeFor(provider: SandboxProvider, messages: readonly { content: string }[]): bigint {
  return providerPriceView(provider, requestInputTokens(messages)).maxLamports;
}

/**
 * What the visitor knows it authorised: the maximum for this request at the
 * listed per-token price, and the transaction and wallet for a devnet transfer.
 */
function expectedPaymentFor(provider: SandboxProvider, messages: readonly { content: string }[], paymentHeader: string): { amount?: string; txSignature?: string; payer?: string } {
  const expected: { amount?: string; txSignature?: string; payer?: string } = { amount: maxChargeFor(provider, messages).toString() };
  try {
    const sent = JSON.parse(paymentHeader) as { txSignature?: unknown; payer?: unknown };
    // A metered escrow's receipt names the provider's settle transaction, which the visitor did not sign, so only a direct transfer's is compared.
    if (typeof sent.txSignature === "string") expected.txSignature = sent.txSignature;
    if (typeof sent.payer === "string") expected.payer = sent.payer;
  } catch {
    // A demo:<nonce> header names no transaction.
  }
  return expected;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function StepCard({ index, title, active, done, children }: { index: number; title: string; active: boolean; done: boolean; children: React.ReactNode }) {
  return (
    <section
      data-testid={`sandbox-step-${index}`}
      data-state={done ? "done" : active ? "active" : "waiting"}
      className={`rounded-2xl border p-5 transition md:p-6 ${active ? "border-brand-green/50 bg-white/[0.05]" : done ? "border-white/15 bg-white/[0.03]" : "border-white/10 bg-white/[0.02]"}`}
    >
      <div className="flex items-center gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-ink text-black" : active ? "border border-brand-green text-brand-green" : "border border-white/20 text-gray-400"}`}>
          {done ? "✓" : index}
        </span>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function NoticeBox({ notice }: { notice: Notice }) {
  const tone = notice.tone === "bad" ? "border-red-400/40 bg-red-500/10 text-red-100" : notice.tone === "good" ? "border-brand-green/40 bg-brand-green/10 text-emerald-100" : "border-sky-400/40 bg-sky-500/10 text-sky-100";
  return (
    <div role="status" data-testid="sandbox-notice" data-tone={notice.tone} className={`rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <p className="font-semibold">{notice.title}</p>
      <p className="mt-1 leading-6">{notice.text}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-36 shrink-0 text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-sm text-gray-100">{children}</dd>
    </div>
  );
}

/** A dollar figure with at least two decimals, as prices are usually written: 0.2 becomes 0.20. */
function dollars(amount: string): string {
  const [whole, fraction = ""] = amount.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

/** A provider's listed per-token prices and the most this request can cost, in USDC, AUDD and SOL. */
function PriceLines({ provider, inputTokens }: { provider: SandboxProvider; inputTokens: number }) {
  const view = providerPriceView(provider, inputTokens);
  return (
    <div className="mt-2 space-y-1 text-xs text-gray-300" data-testid={`sandbox-price-${provider.id}`}>
      <p>
        Per million tokens: <span className="font-mono">${dollars(view.inputPerMillion.usdc)}</span> in, <span className="font-mono">${dollars(view.outputPerMillion.usdc)}</span> out
      </p>
      <p className="text-gray-400">
        ({view.inputPerMillion.audd} / {view.outputPerMillion.audd} AUDD · {view.inputPerMillion.sol} / {view.outputPerMillion.sol} SOL)
      </p>
      <p>
        Max this call, up to {provider.pricing.maxOutputTokens.toLocaleString("en-US")} output tokens:{" "}
        <span className="font-mono" data-testid={`sandbox-max-${provider.id}`}>{triPriceLabel(view.maxPerCall)}</span>
      </p>
      <p className="text-gray-400">
        A typical real code review ({TYPICAL_REVIEW.inputTokens.toLocaleString("en-US")} tokens in, {TYPICAL_REVIEW.outputTokens.toLocaleString("en-US")} out) would cost{" "}
        <span className="font-mono" data-testid={`sandbox-typical-${provider.id}`}>{triPriceLabel(view.typicalReview)}</span>
      </p>
    </div>
  );
}

/** The payment lines of a receipt: tokens, cost, fee, provider share and refund, in all three currencies. */
function ReceiptPaymentFields({ payment, simulated }: { payment: SandboxReceiptPayment; simulated: boolean }) {
  const amount = BigInt(payment.amount);
  const fee = BigInt(payment.fee.amount);
  const sol = (lamports: bigint) => `${triPriceLabel(triPriceFromLamports(lamports))} (${lamports.toString()} lamports)`;
  const feePercent = `${Number(SANDBOX_FEE_BPS) / 100}%`;
  if (payment.metered) {
    const tokens = `${Number(payment.metered.inputTokens).toLocaleString("en-US")} in, ${Number(payment.metered.outputTokens).toLocaleString("en-US")} out`;
    return (
      <>
        <Field label="Tokens used">{tokens}</Field>
        <Field label="Max approved">{sol(BigInt(payment.metered.maxAmount))}</Field>
        <Field label={simulated ? "Cost (simulated, nothing was paid)" : "Cost"}>{sol(amount)}</Field>
        <Field label={`Protocol fee ${feePercent}`}>
          {sol(fee)}
          {payment.fee.treasury ? <>, to the protocol treasury {shortAddress(payment.fee.treasury)}</> : <>, rounds down to nothing at this size</>}
        </Field>
        <Field label="Provider receives">{sol(amount - fee)}</Field>
        <Field label="Back to you">{sol(BigInt(payment.metered.refunded))}</Field>
      </>
    );
  }
  return (
    <>
      <Field label={simulated ? "Paid (simulated, nothing was paid)" : "Paid"}>{sol(amount)} on {payment.network}</Field>
      <Field label="Protocol fee">
        none on this transfer. A direct devnet transfer pays the maximum straight to the provider; only the metered escrow takes the {feePercent} fee and refunds the rest.
      </Field>
    </>
  );
}

const actionButton = "rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const quietButton = "rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

export default function SandboxConsole({ initialScenario }: { initialScenario?: string }) {
  const startScenario = findSandboxScenario(initialScenario) ?? SANDBOX_SCENARIOS[0];
  const [scenario, setScenario] = useState<SandboxScenario>(startScenario);
  const [providerId, setProviderId] = useState(startScenario.providerIds[0]);
  const [prompt, setPrompt] = useState(startScenario.prompt);
  const [payMode, setPayMode] = useState<PayMode>("simulated");
  const [phase, setPhase] = useState<Phase>("idle");
  const [challenge, setChallenge] = useState<SandboxChallenge | null>(null);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [heldAnswer, setHeldAnswer] = useState("");
  const [verification, setVerification] = useState<SandboxVerification | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<SandboxExchange[]>([]);
  const [reputation, setReputation] = useState(() => initialSandboxReputation(SANDBOX_PROVIDERS));
  const [receipts, setReceipts] = useState<SandboxReceipt[]>([]);
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  // Providers whose server-held devnet key can settle a metered escrow. Others take a direct transfer.
  const [meteredProviders, setMeteredProviders] = useState<Record<string, boolean>>({});
  const [origin, setOrigin] = useState("https://app.agent-protocol.reddi.tech");
  const [pendingWalletPayment, setPendingWalletPayment] = useState<string | null>(null);
  // Providers the listing says serve escrows opted in to rating. The option is offered only for those.
  const [ratedProviders, setRatedProviders] = useState<Record<string, boolean>>({});
  // "Rate this job": off unless the visitor turns it on.
  const [rateJob, setRateJob] = useState(false);
  const [judgeText, setJudgeText] = useState("");
  const [ratedEscrow, setRatedEscrow] = useState<string | null>(null);
  // True once the page is interactive and the provider key listing has settled.
  const [ready, setReady] = useState(false);

  const { publicKey, signTransaction, signMessage, connected } = useWallet();
  // How each wallet payment signs a request body, by payment header: a metered lock's delegated key (#866),
  // or a direct transfer's proof (#882). Keys and delegations live in this tab's memory only.
  const payerSigners = useRef(new Map<string, (body: string) => Promise<Record<string, string>>>());
  // The wallet's direct-payment delegation to a tab key, by provider payee, reused until it nears expiry.
  const directDelegations = useRef(new Map<string, { delegation: string; sessionKey: { sign: MessageSigner }; expiresAt: number }>());
  const signedFor = (paymentHeader: string | undefined) => (paymentHeader ? payerSigners.current.get(paymentHeader) : undefined);
  const devnet = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);
  const provider = findSandboxProviderById(providerId) ?? SANDBOX_PROVIDERS[0];
  const messages = useMemo(() => [{ role: "user", content: prompt }], [prompt]);
  const inputTokens = requestInputTokens(messages);

  useEffect(() => {
    setOrigin(window.location.origin);
    let cancelled = false;
    fetch(SANDBOX_MODELS_PATH, { cache: "no-store" })
      .then((response) => response.json())
      .then((listing: { data?: { rap?: { providerId?: string; receiptProviderId?: string; meteredEscrow?: { available?: boolean; acceptsRatedEscrows?: boolean } } }[] }) => {
        if (cancelled) return;
        const keys: Record<string, string> = {};
        const metered: Record<string, boolean> = {};
        const rated: Record<string, boolean> = {};
        for (const entry of listing.data ?? []) {
          if (entry.rap?.providerId && entry.rap.receiptProviderId) keys[entry.rap.providerId] = entry.rap.receiptProviderId;
          if (entry.rap?.providerId && entry.rap.meteredEscrow?.available === true) metered[entry.rap.providerId] = true;
          if (entry.rap?.providerId && entry.rap.meteredEscrow?.acceptsRatedEscrows === true) rated[entry.rap.providerId] = true;
        }
        setRatedProviders(rated);
        setProviderKeys(keys);
        setMeteredProviders(metered);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetRun = useCallback(() => {
    setPhase("idle");
    setChallenge(null);
    setAnswered(null);
    setHeldAnswer("");
    setVerification(null);
    setNotice(null);
    setExchanges([]);
    setPendingWalletPayment(null);
    setRatedEscrow(null);
  }, []);

  function chooseScenario(id: SandboxScenarioId) {
    const next = findSandboxScenario(id);
    if (!next) return;
    setScenario(next);
    setProviderId(next.providerIds[0]);
    setPrompt(next.prompt);
    resetRun();
    const url = new URL(window.location.href);
    url.searchParams.set("scenario", next.id);
    window.history.replaceState(null, "", url);
  }

  function chooseProvider(id: string) {
    setProviderId(id);
    resetRun();
  }

  const record = (exchange: SandboxExchange) => setExchanges((current) => [...current, exchange]);

  async function sendRequest() {
    setBusy("request");
    setNotice(null);
    try {
      const result = await callSandbox({ label: "Unpaid request", model: provider.model, messages });
      record(result.exchange);
      const issued = challengeFrom(result.body);
      if (result.status === 402 && issued) {
        setChallenge(issued);
        setPhase("challenged");
      } else if (result.status === 503) {
        setPhase("unavailable");
        setNotice({ tone: "info", title: "Provider unavailable. You paid nothing.", text: errorMessageOf(result.body) });
      } else {
        setNotice({ tone: "bad", title: `Request refused (${result.status})`, text: errorMessageOf(result.body) });
      }
    } catch {
      setNotice({ tone: "bad", title: "The sandbox did not answer", text: "Check your connection and send the request again." });
    } finally {
      setBusy(null);
    }
  }

  /** Returns "settled", "retry" when the provider has not seen the transfer yet, or "refused". */
  async function settle(paymentHeader: string, label: string): Promise<"settled" | "retry" | "refused"> {
    const result = await callSandbox({ label, model: provider.model, messages, paymentHeader, signBody: signedFor(paymentHeader) });
    record(result.exchange);
    if (result.status !== 200) {
      setNotice({ tone: "bad", title: result.status === 409 ? "Refused: this payment was already used" : `Payment refused (${String(result.body.reason ?? result.status)})`, text: errorMessageOf(result.body) });
      return result.status === 402 && (result.body.reason === "invalid_receipt" || result.body.reason === "unsupported_receipt") ? "retry" : "refused";
    }
    const choices = result.body.choices as { message?: { content?: unknown } }[] | undefined;
    const answer = typeof choices?.[0]?.message?.content === "string" ? choices[0].message.content : "";
    if (!isSandboxReceipt(result.receipt)) {
      setNotice({ tone: "bad", title: "The answer came without a receipt", text: "The sandbox answered but sent no readable receipt, so there is nothing to check. Run the call again." });
      return "refused";
    }
    const receipt = result.receipt;
    const spotCheck = (result.body.rap_sandbox as { spotCheck: SandboxSpotCheck }).spotCheck;
    const checked = await verifySandboxReceipt({
      receipt,
      model: provider.model,
      requestBody: result.requestText,
      responseBody: result.responseText,
      expectedProviderId: providerKeys[provider.id],
      expectedPayment: expectedPaymentFor(provider, messages, paymentHeader),
    });
    const before = reputation[provider.id];
    const after = applySandboxReputation(before, { receiptVerified: checked.ok, spotCheckPassed: spotCheck.passed });
    setReputation((current) => ({ ...current, [provider.id]: after }));
    setReceipts((current) => [...current, receipt]);
    setAnswered({ provider, messages, answer, requestText: result.requestText, responseText: result.responseText, receipt, spotCheck, paymentHeader, reputationBefore: before, reputationAfter: after });
    setHeldAnswer(answer);
    setVerification(checked);
    setPhase("answered");
    setPendingWalletPayment(null);
    setNotice(null);
    return "settled";
  }

  async function paySimulated(overrides: { amount?: string; payTo?: string } = {}, label = "Paid request (simulated payment)") {
    if (!challenge) return;
    setBusy("pay");
    setNotice(null);
    try {
      await settle(simulatedPaymentHeader(challenge, overrides), label);
    } catch {
      setNotice({ tone: "bad", title: "The sandbox did not answer", text: "Nothing was accepted. Try the payment again." });
    } finally {
      setBusy(null);
    }
  }

  async function settleWalletPayment(paymentHeader: string) {
    // Kept until the provider accepts or refuses it, so a transfer that is
    // already on devnet can be presented again instead of paid twice.
    setPendingWalletPayment(paymentHeader);
    // The devnet RPC the server reads can trail the one that took the transfer,
    // so the same receipt is presented again a few times.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
      const outcome = await settle(paymentHeader, attempt === 0 ? "Paid request (devnet transfer)" : "Paid request (devnet transfer, presented again)");
      if (outcome === "settled") return;
      if (outcome === "refused") {
        setPendingWalletPayment(null);
        return;
      }
    }
  }

  async function payWithWallet() {
    if (!challenge) return;
    setBusy("pay");
    setNotice(null);
    try {
      if (!publicKey || !signTransaction) {
        setNotice({ tone: "info", title: "Connect a wallet first", text: "Use the wallet button above, with the wallet set to Solana devnet." });
        return;
      }
      const lamports = lamportsFromSol(String(challenge.amount));
      // The page only ever signs the maximum the catalog's own per-token price gives for this request, to the catalog's own payee.
      const expectedMax = formatUnits(maxChargeFor(provider, messages), 9);
      if (lamports === undefined || challenge.payTo !== provider.payTo || String(challenge.amount) !== expectedMax || challenge.network !== "solana-devnet") {
        setNotice({ tone: "bad", title: "Challenge does not match the sandbox catalog", text: "The page will not ask your wallet to sign it." });
        return;
      }
      if ((await devnet.getGenesisHash()) !== DEVNET_GENESIS_HASH) {
        setNotice({ tone: "bad", title: "Not connected to devnet", text: "The sandbox only builds devnet transfers, so nothing was signed." });
        return;
      }
      // Every devnet payment is presented with the payer's signature (#866, #882), so the wallet must sign messages.
      if (!signMessage) {
        setNotice({ tone: "info", title: "This wallet cannot sign messages", text: "The provider needs your wallet's signature to know the payment is yours. Nothing was signed; use a wallet that can sign messages, or the simulated payment." });
        return;
      }
      const metered = meteredProviders[provider.id] === true;
      const balance = await devnet.getBalance(publicKey);
      if (balance < lamports + FEE_HEADROOM_LAMPORTS + (metered ? ESCROW_RENT_HEADROOM_LAMPORTS : 0)) {
        setNotice({ tone: "info", title: "This wallet needs devnet SOL", text: `It holds ${(balance / 1_000_000_000).toFixed(4)} devnet SOL. Get free test SOL from ${FAUCET_URL}, or switch to the simulated payment.` });
        return;
      }
      // A SOL payout that leaves the provider's wallet above zero but below the
      // rent-exempt minimum is refused by the runtime. A metered payout can be
      // any amount up to the maximum, so the wallet must already be rent-exempt.
      const payeeBalance = BigInt(await devnet.getBalance(new PublicKey(challenge.payTo)));
      if (metered ? minimumSolPayout(payeeBalance) > BigInt(0) : solPayoutWouldFail(payeeBalance, BigInt(lamports))) {
        setNotice({ tone: "info", title: "This provider cannot receive SOL yet", text: "Its wallet holds too little devnet SOL to accept a payment this small, so the payment would fail. Nothing was signed; use the simulated payment instead." });
        return;
      }
      const latest = await devnet.getLatestBlockhash("confirmed");
      // Metered: lock the maximum in the devnet escrow; the provider settles the actual cost and the rest comes back.
      // Otherwise: transfer the maximum straight to the provider.
      const lock = metered
        ? buildSandboxMeteredLock({ payer: publicKey, payee: new PublicKey(challenge.payTo), maxLamports: BigInt(lamports), challengeNonce: challenge.nonce })
        : undefined;
      // Rated only when the visitor asked for it and this provider's listing says it serves rated escrows.
      const wantsRating = lock !== undefined && rateJob && ratedProviders[provider.id] === true;
      const judge = wantsRating ? parseJudgeAddress(judgeText, { payer: publicKey.toBase58(), payee: challenge.payTo }) : undefined;
      if (judge && !judge.ok) {
        setNotice({ tone: "info", title: "Check the judge address", text: `${judge.message} Nothing was signed.` });
        return;
      }
      if (wantsRating && balance < lamports + FEE_HEADROOM_LAMPORTS + ESCROW_RENT_HEADROOM_LAMPORTS + Number(RATING_RENT_LAMPORTS)) {
        setNotice({ tone: "info", title: "This wallet needs more devnet SOL", text: `Rating adds about ${RATING_RENT_SOL} SOL of refundable rent. Get free test SOL from ${FAUCET_URL}, or pay without rating.` });
        return;
      }
      // Before paying: the wallet signs one message delegating to a key held in this tab, which then signs
      // each request. Per lock when metered; per provider for an hour when direct. Declining pays nothing.
      const nowSeconds = Math.floor(Date.now() / 1000);
      let auth: { escrow: string; delegation: string; sessionKey: { sign: MessageSigner } } | undefined;
      let direct = lock ? undefined : directDelegations.current.get(challenge.payTo);
      if (direct && direct.expiresAt - nowSeconds < 300) direct = undefined;
      try {
        if (lock) {
          const sessionKey = await createSessionKey();
          const escrow = lock.escrow.toBase58();
          const delegation = await sessionDelegationHeaderValue({ escrow, provider: challenge.payTo, sessionKey: sessionKey.publicKey, expiresAt: nowSeconds + DELEGATION_SECONDS }, (message) => signMessage(message));
          auth = { escrow, delegation, sessionKey };
        } else if (!direct) {
          const sessionKey = await createSessionKey();
          const expiresAt = nowSeconds + DELEGATION_SECONDS;
          const delegation = await directPaymentDelegationHeaderValue({ provider: challenge.payTo, sessionKey: sessionKey.publicKey, expiresAt }, (message) => signMessage(message));
          direct = { delegation, sessionKey, expiresAt };
          directDelegations.current.set(challenge.payTo, direct);
        }
      } catch {
        setNotice({ tone: "info", title: "You declined the message", text: "The provider needs your wallet's signature to know the payment is yours. Nothing was paid; pay again when you are ready, or use the simulated payment." });
        return;
      }
      const transaction = new Transaction({ feePayer: publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(
        lock ? lock.instruction : SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(challenge.payTo), lamports }),
      );
      // open_rating must land in the slot of the lock, so it rides in the same transaction.
      if (lock && judge?.ok) transaction.add(buildOpenRatingInstruction({ programId: SANDBOX_ESCROW_PROGRAM_ID, escrow: lock.escrow, payer: publicKey, judge: judge.judge }));
      // Signed in the visitor's wallet and submitted here to devnet only. The
      // devnet blockhash means the signed transaction cannot land on another cluster.
      const signed = await signTransaction(transaction);
      const signature = await devnet.sendRawTransaction(signed.serialize());
      const paymentHeader = lock
        ? meteredPaymentHeader(challenge, lock.escrow.toBase58(), signature, publicKey.toBase58())
        : devnetPaymentHeader(challenge, signature, publicKey.toBase58());
      if (auth) {
        const lockAuth = auth;
        payerSigners.current.set(paymentHeader, (body) => paidCallAuthHeaders({ ...lockAuth, body }));
      } else if (direct) {
        const { delegation, sessionKey } = direct;
        const payTo = challenge.payTo;
        payerSigners.current.set(paymentHeader, (body) => directPaymentProofHeaders({ network: "solana-devnet", txSignature: signature, payTo, body, sign: sessionKey.sign, delegation }));
      }
      // From here the transfer may be on devnet, so it is remembered before anything else can fail.
      setPendingWalletPayment(paymentHeader);
      if (lock && judge?.ok) {
        setRatedEscrow(lock.escrow.toBase58());
        const storage = browserRatingStorage();
        try {
          if (storage) rememberRatedJob(storage, { wallet: publicKey.toBase58(), escrow: lock.escrow.toBase58(), programId: SANDBOX_ESCROW_PROGRAM_ID.toBase58(), counterparty: challenge.payTo, label: `${provider.name} (sandbox, devnet)`, ...(judge.judge ? { judge: judge.judge.toBase58() } : {}), openedAt: new Date().toISOString() });
        } catch {
          // The rating panel below still works for this visit.
        }
      } else {
        setRatedEscrow(null);
      }
      setNotice({ tone: "info", title: "Transfer sent to devnet", text: "Waiting for confirmation, then presenting it to the provider." });
      try {
        await devnet.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
      } catch {
        setNotice({ tone: "info", title: "Still waiting on devnet", text: "Your transfer was sent but is not confirmed yet. Present it again in a few seconds; do not pay twice." });
        return;
      }
      await settleWalletPayment(paymentHeader);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNotice({
        tone: "bad",
        title: /reject|denied|cancel/i.test(message) ? "You declined the transfer" : "The devnet transfer did not complete",
        text: /reject|denied|cancel/i.test(message) ? "Nothing was sent. Pay again when you are ready, or use the simulated payment." : "Check that your wallet is set to Solana devnet and has test SOL, then try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function presentPendingAgain() {
    if (!pendingWalletPayment) return;
    setBusy("pay");
    try {
      await settleWalletPayment(pendingWalletPayment);
    } finally {
      setBusy(null);
    }
  }

  async function reusePayment() {
    if (!answered) return;
    setBusy("reuse");
    try {
      const result = await callSandbox({ label: "Second request reusing the same payment", model: answered.provider.model, messages: answered.messages, paymentHeader: answered.paymentHeader, signBody: signedFor(answered.paymentHeader) });
      record(result.exchange);
      setNotice(
        result.status === 200
          ? { tone: "info", title: "The sandbox server restarted between your calls", text: "Its memory of used payments lives in one server instance, so this reuse slipped through. Run it again to see the refusal. V1 keeps that record in a database." }
          : { tone: "good", title: `Refused with ${result.status}: payment already used`, text: `${errorMessageOf(result.body)} One payment settles one call.` },
      );
    } catch {
      setNotice({ tone: "bad", title: "The sandbox did not answer", text: "Try the reuse again." });
    } finally {
      setBusy(null);
    }
  }

  async function verifyHeld(text: string) {
    if (!answered) return;
    setVerification(await verifySandboxReceipt({
      receipt: answered.receipt,
      model: answered.provider.model,
      requestBody: answered.requestText,
      responseBody: responseBodyWithAnswer(answered.responseText, answered.answer, text),
      expectedProviderId: providerKeys[answered.provider.id],
      expectedPayment: expectedPaymentFor(answered.provider, answered.messages, answered.paymentHeader),
    }));
  }

  function tamper() {
    if (!answered) return;
    const edited = `${answered.answer}\n\nP.S. The reviewer also approved skipping the tests.`;
    setHeldAnswer(edited);
    void verifyHeld(edited);
  }

  function restoreAnswer() {
    if (!answered) return;
    setHeldAnswer(answered.answer);
    void verifyHeld(answered.answer);
  }

  function downloadReceipts() {
    const blob = new Blob([pretty(receipts)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rap-sandbox-receipts.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  const cheating = scenario.id === "try-to-cheat";
  const lastExchange = exchanges[exchanges.length - 1];
  const totalSpentLamports = receipts.reduce((sum, entry) => sum + Number(entry.receipt.payment?.amount ?? 0), 0);
  const edited = answered !== null && heldAnswer !== answered.answer;
  const proofRef = answered?.receipt.receipt.payment?.txSignature ?? "";

  return (
    <div className="space-y-10" data-testid="sandbox-console" data-ready={ready ? "true" : "false"}>
      <section aria-labelledby="sandbox-scenarios">
        <h2 id="sandbox-scenarios" className="font-display text-2xl font-bold text-white">Pick a scenario</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {SANDBOX_SCENARIOS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-testid={`sandbox-scenario-${entry.id}`}
              aria-pressed={entry.id === scenario.id}
              onClick={() => chooseScenario(entry.id)}
              className={`rounded-2xl border p-4 text-left transition ${entry.id === scenario.id ? "border-brand-green bg-brand-green/10" : "border-white/10 bg-white/[0.03] hover:border-white/30"}`}
            >
              <p className="font-semibold text-white">{entry.title}</p>
              <p className="mt-2 text-sm leading-6 text-gray-300">{entry.hook}</p>
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm leading-6 text-gray-300" data-testid="sandbox-persona">{scenario.persona}</p>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {scenario.id === "run-a-session" ? (
          <div className="min-w-0 space-y-5">
            <SandboxSessionRunner provider={provider} providerReceiptId={providerKeys[provider.id]} onExchange={(list) => setExchanges((current) => [...current, ...list])} onSettled={(list) => setReceipts((current) => [...current, ...list])} />
            <p className="rounded-xl border border-[#9945FF]/30 bg-[#9945FF]/10 p-4 text-sm leading-6 text-gray-200" data-testid="sandbox-takeaway">{scenario.takeaway}</p>
          </div>
        ) : (
        <div className="min-w-0 space-y-5">
          <StepCard index={1} title="Send the request" active={phase === "idle" || phase === "unavailable"} done={phase === "challenged" || phase === "answered"}>
            <div className={`grid gap-3 ${scenario.providerIds.length > 1 ? "sm:grid-cols-3" : ""}`}>
              {scenario.providerIds.map((id) => {
                const entry = findSandboxProviderById(id)!;
                const score = reputation[entry.id];
                return (
                  <button
                    key={entry.id}
                    type="button"
                    data-testid={`sandbox-provider-${entry.id}`}
                    aria-pressed={entry.id === provider.id}
                    onClick={() => chooseProvider(entry.id)}
                    className={`rounded-xl border p-3 text-left text-sm transition ${entry.id === provider.id ? "border-brand-violet bg-brand-violet/15" : "border-white/10 bg-black/20 hover:border-white/30"}`}
                  >
                    <p className="font-semibold text-white">{entry.name}</p>
                    <p className="mt-1 text-gray-300">{entry.tagline}</p>
                    <p className="mt-2 font-mono text-xs text-gray-300">{entry.model}</p>
                    <PriceLines provider={entry} inputTokens={inputTokens} />
                    <p className="mt-1 text-xs text-amber-200" data-testid={`sandbox-reputation-${entry.id}`}>★ {score.score.toFixed(2)} from {score.receipts} receipts</p>
                  </button>
                );
              })}
            </div>
            <p className="text-xs leading-5 text-gray-400" data-testid="sandbox-pricing-note">
              Providers price per token. You approve a maximum for each call, the provider settles the tokens it actually used, and the rest comes back to you. A planned protocol fee of {Number(SANDBOX_FEE_BPS) / 100}% comes out of the provider&apos;s share. This request is about {inputTokens.toLocaleString("en-US")} input tokens. The sandbox pays in devnet SOL. {SANDBOX_DEMO_RATES_NOTE}
            </p>
            <label className="block text-sm text-gray-300">
              <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Your request</span>
              <textarea
                data-testid="sandbox-prompt"
                value={prompt}
                onChange={(event) => { setPrompt(event.target.value); resetRun(); }}
                rows={5}
                maxLength={4000}
                className="w-full rounded-xl border border-white/15 bg-black/40 p-3 font-mono text-sm text-gray-100 outline-none focus:border-brand-green"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" data-testid="sandbox-send" className={actionButton} disabled={!ready || busy !== null || prompt.trim().length === 0} onClick={sendRequest}>
                {busy === "request" ? "Sending…" : phase === "idle" ? "Send request" : "Send again"}
              </button>
              <span className="text-xs text-gray-400">An OpenAI-style chat request to {provider.name}. No payment attached yet.</span>
            </div>
            {(phase === "idle" || phase === "unavailable") && notice ? <NoticeBox notice={notice} /> : null}
            {phase === "unavailable" && scenario.providerIds.length > 1 ? (
              <p className="text-sm text-gray-300">No challenge was issued, so there was nothing to pay and no receipt. Choose another provider above to carry on.</p>
            ) : null}
          </StepCard>

          <StepCard index={2} title="Pay the 402 challenge" active={phase === "challenged"} done={phase === "answered"}>
            {challenge ? (
              <>
                <p className="text-sm leading-6 text-gray-300">The provider answered <span className="font-mono text-amber-200">402 Payment Required</span> with these terms. Nothing has been paid.</p>
                <dl className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-4" data-testid="sandbox-challenge">
                  <Field label="Maximum">
                    {String(challenge.amount)} {challenge.currency}
                    {(() => {
                      const lamports = lamportsFromSol(String(challenge.amount));
                      if (lamports === undefined) return null;
                      const tri = triPriceFromLamports(BigInt(lamports));
                      return <> ({tri.usdc} USDC · {tri.audd} AUDD at demo rates). You approve up to this; the call settles at the tokens it uses.</>;
                    })()}
                  </Field>
                  <Field label="Pay to"><a className="underline decoration-dotted" href={explorerAddressUrl(challenge.payTo)} target="_blank" rel="noreferrer">{challenge.payTo}</a></Field>
                  <Field label="Network">{challenge.network}</Field>
                  <Field label="Nonce">{challenge.nonce}</Field>
                </dl>
                {phase === "challenged" ? (
                  <>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="How to pay">
                      <button type="button" data-testid="sandbox-mode-simulated" aria-pressed={payMode === "simulated"} onClick={() => setPayMode("simulated")} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${payMode === "simulated" ? "border-brand-green bg-brand-green/15 text-white" : "border-white/20 text-gray-300"}`}>
                        Simulated payment, no wallet
                      </button>
                      <button type="button" data-testid="sandbox-mode-wallet" aria-pressed={payMode === "wallet"} onClick={() => setPayMode("wallet")} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${payMode === "wallet" ? "border-brand-green bg-brand-green/15 text-white" : "border-white/20 text-gray-300"}`}>
                        Devnet SOL from my wallet
                      </button>
                    </div>
                    {payMode === "simulated" ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <button type="button" data-testid="sandbox-pay" className={actionButton} disabled={busy !== null} onClick={() => paySimulated()}>
                            {busy === "pay" ? "Paying…" : `Pay ${String(challenge.amount)} SOL (simulated)`}
                          </button>
                          <span className="text-xs text-gray-400">No transaction is made. The receipt will say the payment was simulated.</span>
                        </div>
                        {cheating ? (
                          <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Or try to cheat first</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button type="button" data-testid="sandbox-underpay" className={quietButton} disabled={busy !== null} onClick={() => paySimulated({ amount: fifthOfPrice(String(challenge.amount)) ?? "0.000000001" }, "Paid request, underpaid")}>Pay a fifth of the price</button>
                              <button type="button" data-testid="sandbox-wrong-payee" className={quietButton} disabled={busy !== null} onClick={() => paySimulated({ payTo: SANDBOX_PROVIDERS[0].payTo }, "Paid request, wrong payee")}>Pay a different wallet</button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm leading-6 text-gray-300">
                          {meteredProviders[provider.id] ? (
                            <>Your wallet locks up to {String(challenge.amount)} devnet SOL in the escrow program. After it answers, the provider settles the actual tokens used, {Number(SANDBOX_FEE_BPS) / 100}% of that goes to the protocol treasury, and the rest of the maximum comes straight back to you. </>
                          ) : (
                            <>Your wallet signs one transfer of {String(challenge.amount)} devnet SOL to the provider&apos;s devnet wallet; what you send here is not returned. </>
                          )}
                          Set the wallet to Solana devnet first. Test SOL is free from the{" "}
                          <a className="underline" href={FAUCET_URL} target="_blank" rel="noreferrer">Solana faucet</a> and has no monetary value.
                        </p>
                        {meteredProviders[provider.id] && ratedProviders[provider.id] ? (
                          <RateJobOption checked={rateJob} onCheckedChange={setRateJob} judge={judgeText} onJudgeChange={setJudgeText} stance="accepts" disabled={busy !== null || pendingWalletPayment !== null} />
                        ) : null}
                        <div className="flex flex-wrap items-center gap-3">
                          <WalletMultiButton />
                          <button type="button" data-testid="sandbox-pay-wallet" className={actionButton} disabled={busy !== null || !connected || pendingWalletPayment !== null} onClick={payWithWallet}>
                            {busy === "pay" ? "Waiting for devnet…" : meteredProviders[provider.id] ? `Lock up to ${String(challenge.amount)} devnet SOL` : `Pay ${String(challenge.amount)} devnet SOL`}
                          </button>
                          {pendingWalletPayment ? (
                            <button type="button" className={quietButton} disabled={busy !== null} onClick={presentPendingAgain}>Present my transfer again</button>
                          ) : null}
                        </div>
                        {pendingWalletPayment ? <p className="text-xs text-amber-200">Your transfer is on devnet but the provider has not seen it yet. Present it again in a few seconds; do not pay twice.</p> : null}
                      </div>
                    )}
                    {notice ? <NoticeBox notice={notice} /> : null}
                  </>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-gray-400">The provider&apos;s payment terms appear here after you send the request.</p>
            )}
          </StepCard>

          <StepCard index={3} title="Read the answer and check the receipt" active={phase === "answered"} done={false}>
            {answered && verification ? (
              <>
                <label className="block text-sm text-gray-300">
                  <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Answer from {answered.provider.name} (scripted). Edit it and the receipt stops matching.</span>
                  <textarea
                    data-testid="sandbox-answer"
                    value={heldAnswer}
                    onChange={(event) => { setHeldAnswer(event.target.value); void verifyHeld(event.target.value); }}
                    rows={6}
                    className="w-full rounded-xl border border-white/15 bg-black/40 p-3 text-sm leading-6 text-gray-100 outline-none focus:border-brand-green"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" data-testid="sandbox-tamper" className={quietButton} onClick={tamper}>Edit the answer for me</button>
                  {edited ? <button type="button" data-testid="sandbox-restore" className={quietButton} onClick={restoreAnswer}>Put the original back</button> : null}
                  {cheating || scenario.id === "buy-a-review" ? (
                    <button type="button" data-testid="sandbox-reuse" className={quietButton} disabled={busy !== null} onClick={reusePayment}>{busy === "reuse" ? "Trying…" : "Reuse the same payment"}</button>
                  ) : null}
                </div>
                <div data-testid="sandbox-verification" data-ok={verification.ok ? "true" : "false"} className={`rounded-xl border p-4 ${verification.ok ? "border-brand-green/40 bg-brand-green/10" : "border-red-400/40 bg-red-500/10"}`}>
                  <p className="font-semibold text-white">{verification.ok ? "Receipt verified in your browser" : "Receipt does not match what you are holding"}</p>
                  <ul className="mt-3 space-y-2">
                    {verification.checks.map((check) => (
                      <li key={check.id} className="flex gap-2 text-sm" data-testid={`sandbox-check-${check.id}`} data-passed={check.passed ? "true" : "false"}>
                        <span aria-hidden className={check.passed ? "text-brand-green" : "text-red-300"}>{check.passed ? "✓" : "✗"}</span>
                        <span><span className="font-medium text-white">{check.label}.</span> <span className="text-gray-300">{check.detail}</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
                {notice ? <NoticeBox notice={notice} /> : null}
                <dl className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-4" data-testid="sandbox-receipt">
                  <Field label="Receipt format">
                    {verification.kind === "v2" ? <>reddi.receipt.v2</> : <>Sandbox simulated receipt. Not a reddi.receipt.v2 receipt, because no transaction paid for it.</>}
                  </Field>
                  <Field label="Provider">{answered.provider.name} ({shortAddress(answered.receipt.receipt.providerId)}, sandbox test key)</Field>
                  <Field label="Declared model">{answered.receipt.receipt.declaredModel}</Field>
                  {answered.receipt.receipt.payment ? <ReceiptPaymentFields payment={answered.receipt.receipt.payment} simulated={!proofRef} /> : null}
                  <Field label="Payment proof">
                    {proofRef ? (
                      <a className="underline" href={explorerTxUrl(proofRef)} target="_blank" rel="noreferrer">{shortAddress(proofRef)} on Solana Explorer</a>
                    ) : (
                      <>simulated, no transaction</>
                    )}
                  </Field>
                  <Field label="Request hash">{answered.receipt.receipt.requestHash}</Field>
                  <Field label="Response hash">{answered.receipt.receipt.responseHash}</Field>
                  <Field label="Issued at">{answered.receipt.receipt.issuedAt}</Field>
                </dl>
                <div className="rounded-xl border border-white/10 bg-black/30 p-4" data-testid="sandbox-reputation-change">
                  <p className="text-xs uppercase tracking-wide text-gray-400">Reputation update for {answered.provider.name}</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    ★ {answered.reputationBefore.score.toFixed(2)} → ★ {answered.reputationAfter.score.toFixed(2)}
                    <span className={`ml-2 text-sm font-medium ${answered.reputationAfter.score >= answered.reputationBefore.score ? "text-brand-green" : "text-red-300"}`}>
                      {answered.reputationAfter.score >= answered.reputationBefore.score ? "held or rose" : "fell"}
                    </span>
                  </p>
                  <p className="mt-1 text-sm leading-6 text-gray-300">{answered.spotCheck.note}</p>
                  <p className="mt-1 text-xs text-gray-400">Sandbox scores live in this browser tab and reset when you reload.</p>
                </div>
                {ratedEscrow ? <JobRatingPanel escrow={ratedEscrow} programId={SANDBOX_ESCROW_PROGRAM_ID} connection={devnet} showWhenNone /> : null}
                <p className="rounded-xl border border-brand-violet/30 bg-brand-violet/10 p-4 text-sm leading-6 text-gray-200" data-testid="sandbox-takeaway">{scenario.takeaway}</p>
                <button type="button" data-testid="sandbox-run-again" className={quietButton} onClick={resetRun}>Run it again</button>
              </>
            ) : (
              <p className="text-sm text-gray-400">The answer, its receipt, and the checks you can run on it appear here once the call is paid.</p>
            )}
          </StepCard>
        </div>
        )}

        <aside className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="font-semibold text-white">On the wire</h3>
            {lastExchange ? (
              <div className="mt-3 space-y-3" data-testid="sandbox-wire">
                <p className="text-sm text-gray-300">{lastExchange.label} <span className={`ml-1 rounded px-1.5 py-0.5 font-mono text-xs ${lastExchange.response.status === 200 ? "bg-brand-green/20 text-brand-green" : "bg-amber-500/20 text-amber-200"}`}>{lastExchange.response.status}</span></p>
                <details open>
                  <summary className="cursor-pointer text-xs uppercase tracking-wide text-gray-400">Try it from a terminal</summary>
                  <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-black/60 p-3 text-xs leading-5 text-gray-200">{curlFor(origin, lastExchange)}</pre>
                </details>
                <details>
                  <summary className="cursor-pointer text-xs uppercase tracking-wide text-gray-400">Response body</summary>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-black/60 p-3 text-xs leading-5 text-gray-200">{pretty(lastExchange.response.body)}</pre>
                </details>
                {exchanges.length > 1 ? <p className="text-xs text-gray-400">{exchanges.length} calls in this run.</p> : null}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-gray-400">Each call you make shows up here as a copyable curl command with the raw response.</p>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5" data-testid="sandbox-ledger">
            <h3 className="font-semibold text-white">Your session</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">Receipts</dt><dd className="mt-1 text-2xl font-bold text-white" data-testid="sandbox-receipt-count">{receipts.length}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">Spent</dt><dd className="mt-1 text-2xl font-bold text-white" data-testid="sandbox-spent">{totalSpentLamports.toLocaleString("en-AU")}<span className="ml-1 text-xs font-normal text-gray-400">lamports</span><span className="mt-1 block text-xs font-normal text-gray-400" data-testid="sandbox-spent-tri">{triPriceLabel(triPriceFromLamports(BigInt(totalSpentLamports)))}</span></dd></div>
            </dl>
            <button type="button" className={`${quietButton} mt-4 w-full`} disabled={receipts.length === 0} onClick={downloadReceipts}>Download receipts as JSON</button>
          </section>

          <section className="rounded-2xl border border-brand-green/25 bg-gradient-to-br from-brand-green/10 to-brand-violet/10 p-5">
            <h3 className="font-semibold text-white">Build with it</h3>
            <p className="mt-2 text-sm leading-6 text-gray-300">The sandbox runs the same challenge, payment check and receipt format the open-source packages ship.</p>
            <div className="mt-4 flex flex-col gap-2">
              {SIGNUP_URL ? <a href={SIGNUP_URL} data-testid="sandbox-signup" className={`${actionButton} text-center`}>Get launch updates</a> : null}
              <Link href="/setup" className={`${SIGNUP_URL ? quietButton : actionButton} text-center`}>Connect your agent</Link>
              <Link href="/register" className={`${quietButton} text-center`}>Prepare a provider listing</Link>
              <a href="https://github.com/nissan/reddi-agent-protocol" target="_blank" rel="noreferrer" className={`${quietButton} text-center`}>Read the code on GitHub</a>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
