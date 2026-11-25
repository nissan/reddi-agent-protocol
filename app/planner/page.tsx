"use client";

import { Suspense } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/toast";
import { TASK_TYPES, PRIVACY_MODES } from "@/lib/capabilities/taxonomy";
import {
  summarizeConsumerPolicy,
  summarizeConsumerReceipt,
} from "@/lib/consumer/guided-paid-call";
import { getNetworkProfile } from "@/lib/config/network";
import { currentAccessToken } from "@/components/auth/WalletSignIn";
import {
  lamportsToSolAmount,
  paymentNetworkForProfile,
  planWalletDirectPayment,
  walletDirectPaymentEnabled,
} from "@/lib/payments/wallet-direct-payment";
import { planMeteredBuy } from "@/lib/payments/metered-buy";
import { fetchPaymentStop, paymentStopped } from "@/lib/payments/stop-switch";
import { SOLANA_GENESIS_HASHES } from "@/lib/payments/session-auth";
import {
  applySessionClose,
  applySessionOutcome,
  attachLockReceipt,
  delegateLock,
  openPlannerSession,
  signSingleCall,
  type LockAuth,
  prepareSessionCall,
  prepareSessionClose,
  type PlannerSessionHandle,
} from "@/lib/payments/planner-session-client";
import { ESCROW_PROGRAM_ID, SUBMISSION_BLOCKED, SUBMISSION_BLOCKED_REASON } from "@/lib/program";
import { JobRatingPanel } from "@/components/rating/JobRatingPanel";
import { RateJobOption } from "@/components/rating/RateJobOption";
import { SessionOption } from "@/components/payments/SessionOption";
import { legacyPagesEnabled } from "@/lib/legacy-pages";
import { isRatedDecline, parseJudgeAddress, ratedEscrowsEnabled, ratedJobStance, rememberRatedDecline } from "@/lib/rating/rated-pay";
import { browserRatingStorage, rememberRatedJob } from "@/lib/rating/rating-secrets";
import { RATING_RENT_SOL } from "@/lib/rating/rating-state";
import type { SpecialistListing } from "@/lib/registry/bridge";

// Read once at build time. Wallet-signed payment stays off unless the operator turns it on.
const WALLET_PAYMENT_ENABLED = walletDirectPaymentEnabled(
  process.env.NEXT_PUBLIC_WALLET_DIRECT_PAYMENT,
);
// Rating needs an escrow program that has the rating instructions; the operator says so at build time.
const RATED_ESCROWS_ENABLED = ratedEscrowsEnabled(process.env.NEXT_PUBLIC_RATED_ESCROWS);
// Run history and the off-chain feedback note use API routes that production turns off.
const LEGACY_PAGES = legacyPagesEnabled();
const BUYER_MINTS = {
  USDC: process.env.NEXT_PUBLIC_X402_USDC_MINT,
  AUDD: process.env.NEXT_PUBLIC_X402_AUDD_MINT,
  PYUSD: process.env.NEXT_PUBLIC_X402_PYUSD_MINT,
  USDG: process.env.NEXT_PUBLIC_X402_USDG_MINT,
};

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

type PlannerRun = {
  runId: string;
  createdAt: string;
  selectedWallet?: string;
  endpointUrl?: string;
  status: "completed" | "failed";
  challengeSeen: boolean;
  paymentAttempted: boolean;
  paymentSatisfied: boolean;
  x402TxSignature?: string;
  x402ReceiptNonce?: string;
  responsePreview?: string;
  error?: string;
  trace: string[];
};

type ResolveResult = {
  ok: boolean;
  candidate: {
    walletAddress: string;
    endpointUrl: string;
    taskTypes: string[];
    privacyModes: string[];
    perCallUsd: number;
    attested: boolean;
    healthStatus: string;
    reputationScore: number;
    avgFeedbackScore: number;
    selectionReasons: string[];
  } | null;
  alternativeCount: number;
  error?: string;
};

function shortWallet(wallet: string) {
  return wallet.length > 12
    ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
    : wallet;
}

function launchConfetti() {
  const colors = ["#818cf8", "#f472b6", "#22c55e", "#fb923c", "#facc15"];
  for (let i = 0; i < 40; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.cssText = `
      position: fixed; width: 10px; height: 10px; z-index: 200;
      left: ${Math.random() * 100}vw; top: -10px;
      background: ${colors[Math.floor(Math.random() * 5)]};
      border-radius: ${Math.random() > 0.5 ? "50%" : "0"};
      animation: confettiFall 2s ease-out forwards;
      animation-delay: ${Math.random() * 0.5}s;
    `;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 2500);
  }
}

const STEPS = ["Describe task", "Select specialist", "Execute", "Feedback"];

function PlannerInner() {
  const { connected, publicKey, sendTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const [paymentNote, setPaymentNote] = useState<string | null>(null);
  // A receipt for a transaction that was sent but not yet accepted by the provider.
  const [pendingReceipt, setPendingReceipt] = useState<unknown>(null);
  const searchParams = useSearchParams();
  const preferredWallet = searchParams.get("specialist") ?? "";

  const [step, setStep] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [taskType, setTaskType] = useState<string>(TASK_TYPES[0].id);
  const [privacyMode, setPrivacyMode] = useState<"public" | "per" | "vanish">(
    "public",
  );
  const [maxPerCallUsd, setMaxPerCallUsd] = useState("0.01");
  const [requiresAttested, setRequiresAttested] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidates, setCandidates] = useState<SpecialistListing[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>(preferredWallet);
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [run, setRun] = useState<PlannerRun | null>(null);
  const [rating, setRating] = useState(5);
  // "Rate this job": off unless the buyer turns it on.
  const [rateJob, setRateJob] = useState(false);
  const [judgeText, setJudgeText] = useState("");
  // What each provider's own offer said about rated jobs, by wallet.
  const [statedRatedStance, setStatedRatedStance] = useState<Record<string, boolean>>({});
  // Bumped when a refusal is remembered, so the stance below is read again.
  const [declineVersion, setDeclineVersion] = useState(0);
  // The escrow of the job just paid with rating on.
  const [ratedEscrow, setRatedEscrow] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [allAgents, setAllAgents] = useState<SpecialistListing[]>([]);
  // Sessions (#863): one lock pays for many calls to a provider, settled once.
  const [useSession, setUseSession] = useState(true);
  const [sessionCalls, setSessionCalls] = useState(10);
  const [settleAfterNext, setSettleAfterNext] = useState(false);
  const [settlingSession, setSettlingSession] = useState(false);
  // In memory only: the session key never leaves this tab. A provider settles an idle session itself.
  const sessionsRef = useRef(new Map<string, PlannerSessionHandle>());
  // Each metered lock's delegation to a key held in this tab, by escrow (#866).
  const lockAuthRef = useRef(new Map<string, LockAuth>());
  // The same sessions, for showing on screen.
  const [sessionViews, setSessionViews] = useState<Record<string, PlannerSessionHandle>>({});
  const prevStep = useRef(step);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/registry");
        const data = await res.json();
        if (!cancelled) setAllAgents(data.listings ?? []);
      } catch {
        if (!cancelled) setAllAgents([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (prevStep.current !== step) {
      showToast(`Step ${step + 1} of 4`, "info");
      prevStep.current = step;
    }
  }, [step]);

  const topCandidates = useMemo(() => {
    const scored = [...allAgents]
      .filter((agent) => agent.health.status !== "fail")
      .sort((a, b) => {
        const aScore =
          (a.attestation.attested ? 40 : 0) +
          (a.health.status === "pass" ? 20 : 0) +
          a.onchain.reputationScore / 500 +
          a.signals.avgFeedbackScore * 4;
        const bScore =
          (b.attestation.attested ? 40 : 0) +
          (b.health.status === "pass" ? 20 : 0) +
          b.onchain.reputationScore / 500 +
          b.signals.avgFeedbackScore * 4;
        return bScore - aScore;
      });
    return scored.slice(0, 3);
  }, [allAgents]);

  const maxSpend = useMemo(() => {
    const parsed = Number(maxPerCallUsd);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }, [maxPerCallUsd]);

  const consumerPolicy = useMemo(
    () =>
      summarizeConsumerPolicy({
        requiredPrivacyMode: privacyMode,
        requiresHealthPass: true,
        requiresAttested,
        maxPerCallUsd: maxSpend,
        preferredWallet: selectedWallet || undefined,
      }),
    [privacyMode, requiresAttested, maxSpend, selectedWallet],
  );

  const receiptSummary = useMemo(
    () => (run ? summarizeConsumerReceipt(run, maxSpend) : null),
    [run, maxSpend],
  );

  useEffect(() => {
    if (!preferredWallet) return;
    setSelectedWallet(preferredWallet);
  }, [preferredWallet]);

  async function findSpecialists() {
    if (!prompt.trim()) return;
    setLoadingCandidates(true);
    try {
      const res = await fetch("/api/planner/tools/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task: prompt,
          taskTypeHint: taskType,
          policy: {
            preferredPrivacyMode: privacyMode,
            maxPerCallUsd: maxSpend,
            requireAttestation: requiresAttested,
          },
        }),
      });
      const data: ResolveResult = await res.json();
      setResolved(data);
      setCandidates(topCandidates);
      setSelectedWallet(
        data.candidate?.walletAddress ?? topCandidates[0]?.walletAddress ?? "",
      );
      setStep(1);
      showToast(
        data.ok
          ? "Specialists resolved"
          : (data.error ?? "No eligible specialist"),
        data.ok ? "success" : "error",
      );
    } finally {
      setLoadingCandidates(false);
    }
  }

  function runRequestBody(extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      prompt,
      preferredWallet: selectedWallet,
      policy: {
        requiredPrivacyMode: privacyMode,
        requiresHealthPass: true,
        requiresAttested,
        maxPerCallUsd: maxSpend,
        preferredWallet: selectedWallet,
      },
      ...extra,
    });
  }

  function showRun(data: { ok?: boolean; error?: string; result?: { result?: PlannerRun } | PlannerRun | null }) {
    const outer = data.result as { result?: PlannerRun } | PlannerRun | null | undefined;
    const nextRun = (outer && "result" in outer ? outer.result : (outer as PlannerRun | null | undefined)) ?? null;
    setRun(nextRun);
    setStep(2);
    if (data.ok) showToast("Execution complete", "success");
    else showToast(data.error ?? nextRun?.error ?? "Execution failed", "error");
  }

  const judgeChoice = parseJudgeAddress(judgeText, { payer: publicKey?.toBase58() ?? "", payee: selectedWallet });
  const selectedStance = useMemo(
    () => ratedJobStance({ stated: statedRatedStance[selectedWallet], providerWallet: selectedWallet, storage: browserRatingStorage() }),
    // declineVersion: a remembered refusal is read from browser storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statedRatedStance, selectedWallet, declineVersion],
  );

  /** Presents a receipt for a payment already sent. Never asks the wallet to sign. */
  async function presentReceipt(receipt: unknown) {
    // When signed in, the session lets the server link the job record to this account.
    const token = await currentAccessToken().catch(() => undefined);
    // A single metered call carries the payer's signature (#866), made with the lock's delegated key.
    const escrow = (receipt as { settlement?: unknown; escrow?: unknown } | null)?.settlement === "metered-escrow" ? (receipt as { escrow?: unknown }).escrow : undefined;
    const lockAuth = typeof escrow === "string" ? lockAuthRef.current.get(escrow) : undefined;
    const paidCallAuth = lockAuth ? await signSingleCall(lockAuth, prompt) : undefined;
    const res = await fetch("/api/onboarding/planner/execute", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: runRequestBody({ paymentMode: "wallet", paymentReceipt: receipt, consumerWallet: publicKey?.toBase58(), ...(paidCallAuth ? { paidCallAuth } : {}) }),
    });
    const data = await res.json();
    if (data.ok) {
      setPendingReceipt(null);
      setPaymentNote(null);
    } else if (isRatedDecline(data.error) || isRatedDecline(data.result?.result?.error) || isRatedDecline(data.result?.result?.responsePreview)) {
      // The provider refused because the escrow is rated. Presenting it again cannot work.
      rememberRatedDecline(browserRatingStorage(), selectedWallet);
      setDeclineVersion((version) => version + 1);
      setPendingReceipt(null);
      setRatedEscrow(null);
      setPaymentNote("This provider does not take rated jobs and served nothing. Nothing was charged. Your maximum and the rating rent stay locked until the refund window opens; to use this provider, pay again with rating turned off.");
    } else {
      setPaymentNote("Your payment was sent, but the provider has not accepted it yet. Present it again; do not pay twice.");
    }
    showRun(data);
  }

  function keepSession(handle: PlannerSessionHandle) {
    sessionsRef.current.set(handle.ledger.providerKey, handle);
    setSessionViews((current) => ({ ...current, [handle.ledger.providerKey]: handle }));
  }

  /**
   * Sends this prompt as the next call of an open session. Signed by the
   * session key, so the wallet is not asked. Returns false when the session
   * cannot take the call, so the caller locks a new maximum.
   */
  async function callInSession(handle: PlannerSessionHandle): Promise<boolean> {
    const prepared = await prepareSessionCall(handle, prompt, settleAfterNext);
    if (!prepared.ok) {
      keepSession(prepared.handle);
      return false;
    }
    const token = await currentAccessToken().catch(() => undefined);
    const res = await fetch("/api/onboarding/planner/execute", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: runRequestBody({ paymentMode: "wallet", paymentReceipt: handle.receipt, consumerWallet: publicKey?.toBase58(), session: prepared.request }),
    });
    const data = await res.json();
    const applied = applySessionOutcome(handle, Boolean(data.ok), data.result?.session);
    keepSession(applied.handle);
    if (data.ok) {
      setPendingReceipt(null);
      setSettleAfterNext(false);
    }
    const firstRefused = !data.ok && applied.handle.ledger.calls.length === 0 && applied.handle.ledger.state !== "open";
    setPaymentNote(
      firstRefused
        ? `${applied.note.split(". ")[0]}. Nothing was charged. Present the lock again to use it for this call alone; the rest of the maximum comes back after the provider settles.`
        : applied.note,
    );
    showRun(data);
    return true;
  }

  /** Asks the provider to settle the open session now. Signed by the session key; no wallet prompt. */
  async function settleSessionNow() {
    const handle = sessionsRef.current.get(selectedWallet);
    if (!handle) return;
    const prepared = await prepareSessionClose(handle);
    if (!prepared.ok) {
      setPaymentNote(prepared.message);
      return;
    }
    setSettlingSession(true);
    try {
      const token = await currentAccessToken().catch(() => undefined);
      const res = await fetch("/api/onboarding/planner/session/close", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ preferredWallet: selectedWallet, paymentReceipt: handle.receipt, close: prepared.close }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: "The settle request could not be read." }));
      const applied = applySessionClose(handle, data);
      keepSession(applied.handle);
      setSettleAfterNext(false);
      setPaymentNote(applied.note);
    } catch {
      setPaymentNote("The settle request did not go through. Nothing changed; the provider still settles the session once it is idle.");
    } finally {
      setSettlingSession(false);
    }
  }

  async function executeWithWallet() {
    if (!publicKey || !sendTransaction) {
      setPaymentNote("Connect a wallet to pay for this call.");
      return;
    }
    const openSession = sessionsRef.current.get(selectedWallet);
    if (openSession && openSession.ledger.state === "open" && openSession.ledger.calls.length === 0 && pendingReceipt === openSession.receipt) {
      // The session's lock is sent; its first call has not been answered yet.
      await callInSession(openSession);
      return;
    }
    if (pendingReceipt) {
      await presentReceipt(pendingReceipt);
      return;
    }
    if (openSession && openSession.ledger.state === "open" && !(rateJob && RATED_ESCROWS_ENABLED)) {
      if (await callInSession(openSession)) return;
      // The open session cannot take this call; the provider settles it, and a new lock follows.
    }
    setPaymentNote(null);
    const res = await fetch("/api/onboarding/planner/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: runRequestBody({ paymentMode: "wallet", consumerWallet: publicKey.toBase58() }),
    });
    const data = await res.json();
    if (!data.paymentRequired) {
      showRun(data);
      return;
    }
    const listing = [...candidates, ...allAgents].find((a) => a.walletAddress === selectedWallet);
    if (!listing || data.paymentRequired.selectedWallet !== selectedWallet) {
      setPaymentNote("The provider that answered is not the one you selected. Nothing was signed.");
      return;
    }
    const prices = {
      inputPerMillionUsd: listing.capabilities?.inputPerMillionUsd,
      outputPerMillionUsd: listing.capabilities?.outputPerMillionUsd,
    };
    if (data.paymentRequired.metered && (prices.inputPerMillionUsd || prices.outputPerMillionUsd)) {
      await lockMeteredMaximum(data.paymentRequired.metered, listing.walletAddress, prices);
      return;
    }
    if (rateJob && RATED_ESCROWS_ENABLED) {
      setPaymentNote("This provider asked for a direct payment, which cannot be rated: a rating needs a payment through escrow. Turn off \"Rate this job\" to pay this provider. Nothing was signed.");
      return;
    }
    const solAmount = lamportsToSolAmount(listing.onchain.rateLamports);
    const plan = planWalletDirectPayment({
      challenge: data.paymentRequired.challenge,
      listing: {
        walletAddress: listing.walletAddress,
        perCallUsd: listing.capabilities?.perCallUsd,
        perCall: solAmount ? { amount: solAmount, currency: "SOL" } : undefined,
      },
      profile: getNetworkProfile().name,
      maxPerCallUsd: maxSpend,
      // For SOL the limit is the price shown on the listing the buyer picked.
      spendCap: solAmount && /"currency"\s*:\s*"SOL"/.test(String(data.paymentRequired.challenge)) ? solAmount : undefined,
      payer: publicKey.toBase58(),
      mints: BUYER_MINTS,
    });
    if (!plan.ok) {
      setPaymentNote(`Payment request refused: ${plan.message} Nothing was signed.`);
      return;
    }
    if (await stoppedFor(plan.currency)) return;
    setPaymentNote(`Your wallet will ask you to approve ${plan.amount} ${plan.currency} to ${plan.payTo.slice(0, 4)}…${plan.payTo.slice(-4)} on ${plan.network}.`);
    let signature: string;
    const latest = await connection.getLatestBlockhash("confirmed");
    try {
      const transaction = new Transaction({
        feePayer: publicKey,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }).add(...plan.instructions);
      signature = await sendTransaction(transaction, connection);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setPaymentNote(
        /reject|denied|cancel/i.test(message)
          ? "You declined the payment. Nothing was charged."
          : "The payment was not sent. Check your wallet's network and balance, then try again.",
      );
      return;
    }
    const receipt = plan.receiptFor(signature);
    // From here the transfer may be on chain, so it is remembered before anything else can fail.
    setPendingReceipt(receipt);
    setPaymentNote("Payment sent. Waiting for confirmation before presenting it to the provider.");
    try {
      await connection.confirmTransaction(
        { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        "confirmed",
      );
    } catch {
      setPaymentNote("Your payment was sent but is not confirmed yet. Present it again in a few seconds; do not pay twice.");
      return;
    }
    await presentReceipt(receipt);
  }

  /** The incident stop switch (`/api/payments/status`), checked before any wallet is asked to sign. Unreadable on mainnet means stop. */
  async function stoppedFor(currency: string): Promise<boolean> {
    const stop = await fetchPaymentStop(fetch, getNetworkProfile().name === "mainnet");
    if (!paymentStopped(stop, currency)) return false;
    setPaymentNote(`${stop.reason ?? "New payments are paused."} Nothing was signed.`);
    return true;
  }

  /**
   * Per-token call: the wallet locks the approved maximum in a metered escrow.
   * The provider settles the actual cost after answering; the rest comes back.
   */
  async function lockMeteredMaximum(
    offer: unknown,
    walletAddress: string,
    prices: { inputPerMillionUsd?: number; outputPerMillionUsd?: number },
  ) {
    if (!publicKey || !sendTransaction) return;
    if (SUBMISSION_BLOCKED) {
      // The escrow program set is not ready on this profile (on mainnet until the audited deployment is registered).
      setPaymentNote(`${SUBMISSION_BLOCKED_REASON} Nothing was signed.`);
      return;
    }
    const network = paymentNetworkForProfile(getNetworkProfile().name);
    if (!network) {
      setPaymentNote("Wallet payment is not available on this network. Nothing was signed.");
      return;
    }
    const wantsRating = rateJob && RATED_ESCROWS_ENABLED;
    const judge = wantsRating ? parseJudgeAddress(judgeText, { payer: publicKey.toBase58(), payee: walletAddress }) : undefined;
    if (judge && !judge.ok) {
      setPaymentNote(`${judge.message} Nothing was signed.`);
      return;
    }
    const buy = (calls?: number) =>
      planMeteredBuy({
        offer,
        listing: { walletAddress, prices },
        network,
        programId: ESCROW_PROGRAM_ID,
        payer: publicKey,
        prompt,
        maxSpendUsd: maxSpend,
        mints: BUYER_MINTS,
        nonce: crypto.getRandomValues(new Uint8Array(16)),
        ...(judge?.ok ? { rating: { judge: judge.judge } } : {}),
        ...(calls !== undefined ? { sessionCalls: calls } : {}),
      });
    // A session needs the wallet to sign one message; a rated job is paid one call at a time.
    const wantsSession = useSession && !wantsRating && Boolean(signMessage);
    let plan = buy(wantsSession ? sessionCalls : undefined);
    if (!plan.ok && wantsSession && plan.reason === "no_output_limit") plan = buy();
    if (!plan.ok) {
      setPaymentNote(`Payment request refused: ${plan.message} Nothing was signed.`);
      return;
    }
    const stated = plan.providerAcceptsRatedJobs;
    if (stated !== undefined) {
      setStatedRatedStance((current) => ({ ...current, [walletAddress]: stated === true }));
    }
    if (plan.rating && ratedJobStance({ stated: plan.providerAcceptsRatedJobs, providerWallet: walletAddress, storage: browserRatingStorage() }) === "declines") {
      // Known before anything is signed: this provider would refuse the job.
      setPaymentNote("This provider does not take rated jobs, so it would refuse this one. Turn off \"Rate this job\" to pay it without a rating, or choose another provider. Nothing was signed.");
      return;
    }
    const { quote } = plan;
    if (await stoppedFor(quote.currency)) return;
    // Providers take a metered call only with the payer's signature (#866): the wallet signs one
    // message per lock, delegating its calls to a key held in this tab. Asked before the lock.
    if (!signMessage) {
      setPaymentNote("Your wallet cannot sign messages, and a per-token call needs your signature so the provider knows it is yours. Nothing was signed; use a wallet that can sign messages.");
      return;
    }
    setPaymentNote(
      plan.session
        ? `Your wallet will first ask you to sign a message (no payment) that lets this tab make up to ${plan.session.calls} calls to this provider on one lock, then to lock up to ${quote.maxCharge} ${quote.currency}. The provider settles once for the calls it serves; the rest comes back.`
        : `Your wallet will first ask you to sign a message (no payment) that lets this tab present this call to the provider, then to lock up to ${quote.maxCharge} ${quote.currency}.`,
    );
    let lockAuth: LockAuth;
    try {
      lockAuth = await delegateLock({ genesisHash: SOLANA_GENESIS_HASHES[network], escrow: plan.escrow, providerWallet: walletAddress, signWithPayer: (message) => signMessage(message) });
    } catch {
      setPaymentNote("You declined the message. Nothing was locked or charged.");
      return;
    }
    lockAuthRef.current.set(plan.escrow, lockAuth);
    let session: PlannerSessionHandle | undefined;
    if (plan.session) {
      session = await openPlannerSession({
        genesisHash: lockAuth.genesisHash,
        escrow: plan.escrow,
        providerWallet: walletAddress,
        lockBaseUnits: plan.session.lockBaseUnits,
        price: plan.session.price,
        maxOutputTokens: plan.session.maxOutputTokens,
        signWithPayer: (message) => signMessage(message),
        auth: lockAuth,
      });
    }
    const lockQuote = plan.quote;
    setPaymentNote(
      `Estimated cost ${lockQuote.estimatedCost} ${lockQuote.currency}${session ? " a call" : ""}. Your wallet will ask you to lock up to ${lockQuote.maxCharge} ${lockQuote.currency} in escrow${plan.rating ? `, and to pay about ${RATING_RENT_SOL} SOL of refundable rent for the rating` : ""}. ${lockQuote.notice}`,
    );
    let signature: string;
    const latest = await connection.getLatestBlockhash("confirmed");
    try {
      const transaction = new Transaction({
        feePayer: publicKey,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }).add(...plan.instructions);
      signature = await sendTransaction(transaction, connection);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setPaymentNote(
        /reject|denied|cancel/i.test(message)
          ? "You declined the lock. Nothing was charged."
          : "The lock was not sent. Check your wallet's network and balance, then try again.",
      );
      return;
    }
    const receipt = plan.receiptFor(signature);
    // From here the maximum may be locked, so the receipt is remembered before anything else can fail.
    setPendingReceipt(receipt);
    if (session) {
      session = attachLockReceipt(session, receipt);
      keepSession(session);
    }
    if (plan.rating) {
      setRatedEscrow(plan.escrow);
      const storage = browserRatingStorage();
      try {
        // Kept in this browser so the job can be found again when it is time to rate.
        if (storage) rememberRatedJob(storage, { wallet: publicKey.toBase58(), escrow: plan.escrow, programId: ESCROW_PROGRAM_ID.toBase58(), counterparty: walletAddress, ...(judge?.ok && judge.judge ? { judge: judge.judge.toBase58() } : {}), openedAt: new Date().toISOString() });
      } catch {
        // The job can still be added later by its escrow address, from run history.
      }
    }
    setPaymentNote("Lock sent. Waiting for confirmation before presenting it to the provider.");
    try {
      await connection.confirmTransaction(
        { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        "confirmed",
      );
    } catch {
      setPaymentNote("Your lock was sent but is not confirmed yet. Present it again in a few seconds; do not lock twice.");
      return;
    }
    if (session) {
      await callInSession(session);
      return;
    }
    await presentReceipt(receipt);
  }

  async function executeRun() {
    if (!prompt.trim()) return;
    setExecuting(true);
    try {
      if (WALLET_PAYMENT_ENABLED) {
        await executeWithWallet();
        return;
      }
      const res = await fetch("/api/onboarding/planner/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: runRequestBody(),
      });
      showRun(await res.json());
    } catch {
      showToast("Execution failed", "error");
    } finally {
      setExecuting(false);
    }
  }

  async function submitFeedback() {
    if (!run?.runId) return;
    const res = await fetch("/api/onboarding/planner/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: run.runId,
        score: rating,
        notes: note || undefined,
      }),
    });
    const data = await res.json();
    setSubmitted(true);
    setCompleteOpen(true);
    if (data.ok) {
      launchConfetti();
      showToast("Feedback saved", "success");
    } else {
      showToast(data.error ?? "Feedback failed", "error");
    }
  }

  return (
    <div className="min-h-screen bg-page">
      <Modal open={!connected} onClose={() => {}}>
        <div className="p-8 text-center">
          <div className="mb-4 text-4xl">🔗</div>
          <h2 className="mb-2 font-display text-xl text-white">
            Connect Your Wallet
          </h2>
          <p className="mb-6 text-sm text-gray-400">
            You need a Solana wallet to use the planner or register as a
            specialist.
          </p>
          <WalletMultiButton />
        </div>
      </Modal>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 space-y-8">
        <PageHeader
          label="Consumer agent path"
          title="Connect your agent system to RAP Assurance"
          subtitle="Use the planner/MCP flow to discover specialists, enforce budget and authority policy, bind payment-proof and evidence references, then inspect receipts before feedback."
          actions={
            <Link href={LEGACY_PAGES ? "/runs" : "/jobs"}>
              <Button variant="outline" size="sm">
                {LEGACY_PAGES ? "Run history →" : "My jobs →"}
              </Button>
            </Link>
          }
        />

        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              title: "Works with existing agents",
              desc: "Use this path as the human-visible version of what OpenClaw, Claude/MCP, OpenSwarm-style systems, or custom agents can do through MCP rails.",
            },
            {
              title: "Policy before payment",
              desc: "Resolve by task type, privacy mode, attestation requirement, and per-call budget before the x402 challenge is satisfied.",
            },
            {
              title: "Receipts after work",
              desc: "Keep the specialist response, payment state, and feedback trail inspectable for downstream reputation.",
            },
          ].map((item) => (
            <Card key={item.title} className="border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold text-white">{item.title}</p>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                {item.desc}
              </p>
            </Card>
          ))}
        </div>

        <div className="flex justify-center gap-2">
          {STEPS.map((_, index) => (
            <div
              key={index}
              className={`step-dot ${index < step ? "completed" : ""} ${index === step ? "current" : ""}`}
            />
          ))}
        </div>

        <div className="rounded-xl bg-surface p-6 glow-border">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <Card className="space-y-4 p-6">
              <p className="section-label">STEP {step + 1} OF 4</p>
              <h3 className="font-display text-2xl text-white">
                {STEPS[step]}
              </h3>
              <p className="text-sm leading-6 text-gray-400">
                {step === 0 &&
                  "Explain what your agent needs, then set category, privacy, attestation, and spend policy."}
                {step === 1 &&
                  "Review the best available specialists before payment is attempted."}
                {step === 2 &&
                  "Watch x402 negotiation, receipt state, and completion status."}
                {step === 3 &&
                  "Rate the job on chain if you paid with rating on, and leave an optional private note."}
              </p>
            </Card>

            <Card className="space-y-4 p-6">
              {step === 0 ? (
                <>
                  <Textarea
                    className="code-area min-h-44"
                    placeholder="Describe the task you want a specialist to complete…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-2 text-sm text-gray-400">
                      <span>Task type</span>
                      <select
                        className="w-full rounded-lg border border-border bg-page px-3 py-2 text-white"
                        value={taskType}
                        onChange={(e) => setTaskType(e.target.value)}
                      >
                        {TASK_TYPES.map((task) => (
                          <option key={task.id} value={task.id}>
                            {task.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm text-gray-400">
                      <span>Settlement</span>
                      <select
                        className="w-full rounded-lg border border-border bg-page px-3 py-2 text-white"
                        value={privacyMode}
                        onChange={(e) =>
                          setPrivacyMode(
                            e.target.value as "public" | "per" | "vanish",
                          )
                        }
                      >
                        {(legacyPagesEnabled() ? PRIVACY_MODES : PRIVACY_MODES.filter((mode) => mode.id === "public")).map((mode) => (
                          <option key={mode.id} value={mode.id}>
                            {mode.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm text-gray-400">
                      <span>Max spend / call (USD)</span>
                      <input
                        className="w-full rounded-lg border border-border bg-page px-3 py-2 text-white"
                        inputMode="decimal"
                        value={maxPerCallUsd}
                        onChange={(e) => setMaxPerCallUsd(e.target.value)}
                      />
                    </label>
                    <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={requiresAttested}
                        onChange={(e) => setRequiresAttested(e.target.checked)}
                      />
                      Require attested specialist
                    </label>
                  </div>
                  <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-4 text-sm text-gray-300">
                    <p className="font-medium text-white">
                      Policy before payment
                    </p>
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                      <span>Budget: {consumerPolicy.maxSpendLabel}</span>
                      <span>Privacy: {consumerPolicy.privacyLabel}</span>
                      <span>Trust: {consumerPolicy.attestationLabel}</span>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      {consumerPolicy.safeguards[1]}
                    </p>
                  </div>
                  <Button
                    className="w-full"
                    disabled={!prompt.trim() || loadingCandidates}
                    onClick={findSpecialists}
                  >
                    {loadingCandidates
                      ? "Finding specialists…"
                      : "Discover specialists →"}
                  </Button>
                </>
              ) : null}

              {step === 1 ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-400">
                    Resolved candidates, best match is preselected.
                  </p>
                  {resolved ? (
                    <p className="text-xs text-gray-500">
                      {resolved.candidate
                        ? `Reasons: ${resolved.candidate.selectionReasons.join(" · ")}`
                        : resolved.error}
                    </p>
                  ) : null}
                  <div className="space-y-3">
                    {candidates.map((agent, index) => {
                      const selected = selectedWallet === agent.walletAddress;
                      return (
                        <button
                          key={agent.walletAddress}
                          onClick={() => setSelectedWallet(agent.walletAddress)}
                          className={`w-full rounded-xl border p-4 text-left transition ${selected ? "ring-2 ring-indigo-500 border-indigo-500/40 bg-indigo-500/10" : "border-white/10 bg-white/5 hover:border-white/20"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-white">
                                {agent.onchain.model ||
                                  shortWallet(agent.walletAddress)}
                              </p>
                              <p className="text-xs text-gray-400">
                                {shortWallet(agent.walletAddress)}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="border-white/10 bg-white/5 text-gray-300"
                            >
                              #{index + 1}
                            </Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-400">
                            <span>
                              ⭐{" "}
                              {Math.round(agent.onchain.reputationScore / 100)}
                            </span>
                            <span>
                              ◎{" "}
                              {(
                                Number(agent.onchain.rateLamports) /
                                1_000_000_000
                              ).toFixed(4)}{" "}
                              SOL
                            </span>
                            <span>{agent.health.status}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {WALLET_PAYMENT_ENABLED && RATED_ESCROWS_ENABLED && selectedWallet ? (
                    <RateJobOption
                      checked={rateJob}
                      onCheckedChange={setRateJob}
                      judge={judgeText}
                      onJudgeChange={setJudgeText}
                      judgeError={judgeChoice.ok ? undefined : judgeChoice.message}
                      stance={selectedStance}
                      disabled={executing || Boolean(pendingReceipt)}
                    />
                  ) : null}
                  {WALLET_PAYMENT_ENABLED && selectedWallet ? (
                    <SessionOption
                      enabled={useSession && !(rateJob && RATED_ESCROWS_ENABLED)}
                      onEnabledChange={setUseSession}
                      calls={sessionCalls}
                      onCallsChange={setSessionCalls}
                      settleAfterNext={settleAfterNext}
                      onSettleAfterNextChange={setSettleAfterNext}
                      onSettleNow={settleSessionNow}
                      settling={settlingSession}
                      session={sessionViews[selectedWallet]}
                      unavailable={
                        rateJob && RATED_ESCROWS_ENABLED
                          ? "A rated job is paid one call at a time."
                          : !signMessage
                            ? "Your wallet cannot sign messages, so each call is locked on its own."
                            : undefined
                      }
                      disabled={executing || Boolean(pendingReceipt)}
                    />
                  ) : null}
                  <Button
                    className="w-full"
                    disabled={!selectedWallet || executing}
                    onClick={executeRun}
                  >
                    {executing
                      ? "Executing…"
                      : sessionViews[selectedWallet]?.ledger.state === "open" && sessionViews[selectedWallet]?.receipt === pendingReceipt
                        ? "Send the first call of your session again →"
                        : pendingReceipt
                          ? "Present payment again →"
                          : WALLET_PAYMENT_ENABLED && sessionViews[selectedWallet]?.ledger.state === "open"
                            ? "Execute in your open session →"
                            : WALLET_PAYMENT_ENABLED
                              ? "Pay and execute with this specialist →"
                              : "Execute with this specialist →"}
                  </Button>
                  {paymentNote ? (
                    <p
                      className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-gray-300"
                      data-testid="planner-payment-note"
                      role="status"
                    >
                      {paymentNote}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {step === 2 && run ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          run.status === "completed"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : "border-red-500/30 bg-red-500/10 text-red-300"
                        }
                      >
                        {run.status}
                      </Badge>
                      <span className="font-mono text-xs text-gray-400">
                        {run.runId}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-gray-300">
                      <p>
                        Payment:{" "}
                        {run.paymentSatisfied
                          ? "confirmed"
                          : run.paymentAttempted
                            ? "sent"
                            : "pending"}
                      </p>
                      <p>
                        Escrow:{" "}
                        {run.challengeSeen
                          ? "x402 challenge seen"
                          : "not required"}
                      </p>
                      {run.x402TxSignature ? (
                        <p className="font-mono text-xs text-gray-400">
                          tx {run.x402TxSignature}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <pre className="code-area min-h-40 overflow-auto rounded-xl p-4 text-sm text-gray-200">
                    {run.responsePreview || "No response preview."}
                  </pre>
                  <details className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
                    <summary className="cursor-pointer text-white">
                      Receipt
                    </summary>
                    <div className="mt-3 space-y-1 font-mono text-xs text-gray-400">
                      <p>tx: {run.x402TxSignature ?? "n/a"}</p>
                      <p>nonce: {run.x402ReceiptNonce ?? "n/a"}</p>
                      <p>specialist: {run.selectedWallet ?? "n/a"}</p>
                      <p>amount: {receiptSummary?.amountLabel ?? "n/a"}</p>
                      <p>
                        prompt:{" "}
                        {receiptSummary?.promptStorage === "sha256_only"
                          ? "sha256 only (raw prompt not required)"
                          : "n/a"}
                      </p>
                      <p>status: {run.status}</p>
                    </div>
                  </details>
                  {receiptSummary ? (
                    <div
                      className={`rounded-xl border p-4 text-sm ${receiptSummary.status === "paid" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : receiptSummary.status === "blocked" ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-yellow-500/30 bg-yellow-500/10 text-yellow-100"}`}
                    >
                      <p className="font-medium">
                        {receiptSummary.status === "paid"
                          ? "Paid receipt captured"
                          : receiptSummary.status === "blocked"
                            ? "Unpaid completion blocked"
                            : "Run did not complete"}
                      </p>
                      <p className="mt-1 text-xs opacity-80">
                        {receiptSummary.message}
                      </p>
                    </div>
                  ) : null}
                  <Button className="w-full" onClick={() => setStep(3)}>
                    Continue to feedback →
                  </Button>
                </div>
              ) : null}

              {step === 3 ? (
                <div className="space-y-4">
                  {ratedEscrow ? (
                    <JobRatingPanel escrow={ratedEscrow} showWhenNone />
                  ) : (
                    <p className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-5 text-gray-400" data-testid="planner-not-rated">
                      This job was paid without rating, so there is nothing to rate on chain.{LEGACY_PAGES ? " You can still leave a private note below." : null}
                    </p>
                  )}
                  {LEGACY_PAGES ? (
                    <>
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Private feedback (off-chain)</p>
                      <div className="flex gap-1">
                        {Array.from({ length: 5 }).map((_, index) => (
                          <button
                            key={index}
                            onClick={() => setRating(index + 1)}
                            aria-label={`${index + 1} of 5`}
                            className={`text-3xl transition ${index < rating ? "text-indigo-400" : "text-white/20"}`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                      <Textarea
                        className="min-h-28"
                        placeholder="Optional feedback note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <p className="text-xs leading-5 text-gray-400">
                        Saved by this app only. It is not written to the chain and does not change the provider&apos;s on-chain reputation.
                      </p>
                      <Button
                        className="w-full"
                        disabled={!run?.runId || submitted}
                        onClick={() => void submitFeedback()}
                      >
                        {submitted ? "Saved ✓" : "Save feedback"}
                      </Button>
                    </>
                  ) : (
                    <Link href="/jobs" className="block">
                      <Button className="w-full">Done, see my jobs →</Button>
                    </Link>
                  )}
                </div>
              ) : null}
            </Card>
          </div>
        </div>
      </div>

      {completeOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="max-w-md rounded-2xl bg-surface p-8 text-center glow-border">
            <div className="mb-4 text-6xl">🎉</div>
            <h2 className="font-display text-3xl text-white">Task Complete!</h2>
            <p className="mt-2 text-sm text-gray-400">
              Your feedback note was saved off-chain. On-chain ratings are made from your own wallet, in the job rating panel.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link href={LEGACY_PAGES ? "/runs" : "/jobs"}>
                <Button>{LEGACY_PAGES ? "View run history →" : "See my jobs →"}</Button>
              </Link>
              <Button variant="outline" onClick={() => setCompleteOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function PlannerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-page flex items-center justify-center">
          <p className="text-gray-400">Loading planner…</p>
        </div>
      }
    >
      <PlannerInner />
    </Suspense>
  );
}
