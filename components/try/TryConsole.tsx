"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, Transaction } from "@solana/web3.js";
import { explorerAddressUrl, explorerTxUrl, shortAddress, type SandboxCallResult, type SandboxChallenge } from "@/lib/sandbox/client";
import { formatUnits, triPriceFromLamports } from "@/lib/sandbox/pricing";
import { isSandboxReceipt, verifySandboxReceipt, type SandboxVerification } from "@/lib/sandbox/receipt";
import { PREVIEW_LOCK_NETWORK_FEE_LAMPORTS, PREVIEW_SETTLE_NETWORK_FEE_LAMPORTS, previewAnswer, previewQuote } from "@/lib/try/preview";
import { TRY_TASKS, tryTaskProvider, type TryTask } from "@/lib/try/tasks";
import AgentHandoff from "./AgentHandoff";

const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });

const DEVNET_RPC = "https://api.devnet.solana.com";
const POLL_MS = 2000;
const FAUCET_URL = "https://faucet.solana.com";

type Started = {
  token: string;
  payUrl: string;
  solanaPayUrl: string;
  maxLamports: string;
  expiresAt: number;
  task: { id: string; title: string; prompt: string };
  provider: { id: string; name: string; payTo: string; pricing: { inputPerMillionUsd: string; outputPerMillionUsd: string } };
};

type Answered = {
  state: "answered";
  lockSignature: string;
  payer: string;
  escrow: string;
  status: number;
  body: Record<string, unknown>;
  requestText: string;
  responseText: string;
  receipt?: unknown;
};

type Phase = "pick" | "pay" | "waiting" | "answered" | "failed";
/** Devnet: a real wallet pays a real lock. Preview: the same call with a simulated payment, no wallet and no chain. */
type Mode = "devnet" | "preview";

function sol(lamports: string | bigint): string {
  return formatUnits(BigInt(lamports), 9);
}

function errorText(body: unknown, fallback: string): string {
  const error = (body as { error?: { message?: unknown } } | undefined)?.error;
  return typeof error?.message === "string" ? error.message : fallback;
}

/** Waits one poll interval, or less when `wake.current` is called. */
function pauseUnlessWoken(wake: { current: (() => void) | null }): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, POLL_MS);
    function done() {
      clearTimeout(timer);
      wake.current = null;
      resolve();
    }
    wake.current = done;
  });
}

export default function TryConsole() {
  const [mode, setMode] = useState<Mode>("devnet");
  const [phase, setPhase] = useState<Phase>("pick");
  const [task, setTask] = useState<TryTask>(TRY_TASKS[0]);
  const [started, setStarted] = useState<Started | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [verification, setVerification] = useState<SandboxVerification | null>(null);
  // What devnet charged to include each transaction, read from the chain after the answer.
  const [networkFees, setNetworkFees] = useState<{ lock?: number; settle?: number }>({});
  const [preview, setPreview] = useState<{ challenge: SandboxChallenge; maxLamports: bigint } | null>(null);
  const [previewResult, setPreviewResult] = useState<SandboxCallResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // A failed call leaves the lock in its escrow: a Solana Pay link for the wallet to take it back.
  const [refund, setRefund] = useState<{ url: string; qr: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const polling = useRef(false);
  // Cuts the wait between polls short. A phone browser pauses this page while the
  // wallet app is in front, so the page checks at once when it is shown again.
  const wake = useRef<(() => void) | null>(null);
  // The check in flight, and whether the page was hidden while it was. Chrome on a
  // phone can hold such a request for a minute after the page comes back.
  const inFlight = useRef<{ controller: AbortController; spannedHidden: boolean } | null>(null);
  const { publicKey, signTransaction } = useWallet();

  const reset = useCallback(() => {
    polling.current = false;
    setPhase("pick");
    setStarted(null);
    setQr(null);
    setAnswered(null);
    setVerification(null);
    setNetworkFees({});
    setPreview(null);
    setPreviewResult(null);
    setRefund(null);
    setMessage(null);
  }, []);

  useEffect(() => () => {
    polling.current = false;
  }, []);

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") {
        if (inFlight.current) inFlight.current.spannedHidden = true;
        return;
      }
      // A check that was in flight while the page was hidden is dropped and sent again.
      // It went out before the wallet approved, so the provider has not acted on it.
      if (inFlight.current?.spannedHidden) inFlight.current.controller.abort();
      wake.current?.();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, []);

  async function startPreview() {
    setBusy(true);
    setMessage(null);
    try {
      const quote = await previewQuote(task);
      if (!quote.ok) {
        setMessage(quote.message);
        return;
      }
      setPreview({ challenge: quote.challenge, maxLamports: quote.maxLamports });
      setPhase("pay");
    } catch {
      setMessage("The preview could not start. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function payPreview() {
    if (!preview) return;
    setBusy(true);
    setMessage(null);
    try {
      const reply = await previewAnswer(task, preview.challenge);
      if (!reply.ok) {
        setMessage(reply.message);
        return;
      }
      setPreviewResult(reply.result);
      setVerification(reply.verification);
      setPhase("answered");
    } catch {
      setMessage("The preview could not reach the provider. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (mode === "preview") return startPreview();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/try/v1/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: task.id }) });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(errorText(body, "The try could not start. Nothing was asked of your wallet."));
        return;
      }
      const s = body as Started;
      setStarted(s);
      setQr(await QRCode.toDataURL(s.solanaPayUrl, { margin: 1, width: 280, errorCorrectionLevel: "M" }));
      setPhase("pay");
      void poll(s);
    } catch {
      setMessage("The try could not start. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const lockSignature = answered?.lockSignature;
  const settleSignature = answered && isSandboxReceipt(answered.receipt) ? answered.receipt.receipt.payment?.txSignature : undefined;
  useEffect(() => {
    if (!lockSignature) return;
    let live = true;
    const devnet = new Connection(DEVNET_RPC, "confirmed");
    const feeOf = async (signature: string | undefined) => {
      if (!signature) return undefined;
      try {
        return (await devnet.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }))?.meta?.fee;
      } catch {
        return undefined;
      }
    };
    void Promise.all([feeOf(lockSignature), feeOf(settleSignature)]).then(([lock, settle]) => {
      if (live) setNetworkFees({ lock, settle });
    });
    return () => {
      live = false;
    };
  }, [lockSignature, settleSignature]);

  async function poll(s: Started) {
    if (polling.current) return;
    polling.current = true;
    while (polling.current) {
      if (Date.now() / 1000 > s.expiresAt) {
        polling.current = false;
        setPhase("failed");
        setMessage("This try ran out of time before a payment arrived. Nothing was taken. Start again when you're ready.");
        return;
      }
      if (document.visibilityState === "hidden") {
        // Nothing is sent while the wallet app is in front; the check runs when the page is back.
        await pauseUnlessWoken(wake);
        continue;
      }
      const flight = { controller: new AbortController(), spannedHidden: false };
      inFlight.current = flight;
      try {
        const response = await fetch("/api/try/v1/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: s.token }), cache: "no-store", signal: flight.controller.signal });
        const body: unknown = await response.json();
        if (response.ok && (body as { state?: string }).state === "answered") {
          polling.current = false;
          const a = body as Answered;
          setAnswered(a);
          if (a.status === 200) {
            setPhase("answered");
            setVerification(
              await verifySandboxReceipt({
                receipt: a.receipt,
                requestBody: a.requestText,
                responseBody: a.responseText,
                model: (JSON.parse(a.requestText) as { model: string }).model,
                expectedPayment: { amount: s.maxLamports, payer: a.payer },
              }),
            );
          } else {
            setPhase("failed");
            setMessage(errorText(a.body, "The provider did not accept this payment.") + " Your SOL stays in the escrow, and your wallet can take it back once the refund window opens, about 30 minutes after the lock.");
            const url = `solana:${encodeURIComponent(`${window.location.origin}/api/try/v1/refund?escrow=${encodeURIComponent(a.escrow)}`)}`;
            setRefund({ url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" }) });
          }
          return;
        }
        if (response.ok && (body as { state?: string }).state === "settled") {
          // An earlier poll's answer was served and paid, but this server no longer holds it.
          polling.current = false;
          setPhase("failed");
          setMessage("Your call was already answered and paid from an earlier check, so its answer can't be shown again here. Nothing more was taken: the unused part of your maximum went back to your wallet when it settled.");
          return;
        }
        if (!response.ok && response.status !== 503) {
          polling.current = false;
          setPhase("failed");
          setMessage(errorText(body, "Something went wrong. Start again."));
          return;
        }
      } catch {
        // A dropped or aborted poll is retried.
        if (flight.controller.signal.aborted) continue;
      } finally {
        if (inFlight.current === flight) inFlight.current = null;
      }
      await pauseUnlessWoken(wake);
    }
  }

  async function payWithConnectedWallet() {
    if (!started || !publicKey || !signTransaction) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(started.payUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: publicKey.toBase58() }) });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(errorText(body, "The payment could not be prepared. Nothing was signed."));
        return;
      }
      const devnet = new Connection(DEVNET_RPC, "confirmed");
      const balance = await devnet.getBalance(publicKey);
      if (BigInt(balance) < BigInt(started.maxLamports) + BigInt(3_000_000)) {
        setMessage(`This wallet holds ${(balance / 1e9).toFixed(4)} devnet SOL, not enough for this lock. Get free test SOL from ${FAUCET_URL}, then try again.`);
        return;
      }
      const tx = Transaction.from(Buffer.from((body as { transaction: string }).transaction, "base64"));
      const signed = await signTransaction(tx);
      await devnet.sendRawTransaction(signed.serialize());
      setPhase("waiting");
    } catch {
      setMessage("The wallet did not sign, or devnet did not take the transaction. Nothing was paid.");
    } finally {
      setBusy(false);
    }
  }

  const max = started ? triPriceFromLamports(BigInt(started.maxLamports)) : null;
  const provider = tryTaskProvider(task);
  const replyBody = answered?.body ?? previewResult?.body;
  const answer = replyBody ? ((replyBody.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content ?? "") : "";
  const receiptValue = answered?.receipt ?? previewResult?.receipt;
  const payment = isSandboxReceipt(receiptValue) ? receiptValue.receipt.payment : undefined;
  // A preview shows the fees a devnet try pays at this page's compute budget; a devnet try shows what the chain charged.
  const lockNetworkFee = mode === "preview" ? PREVIEW_LOCK_NETWORK_FEE_LAMPORTS : networkFees.lock !== undefined ? BigInt(networkFees.lock) : undefined;
  const settleNetworkFee = mode === "preview" ? PREVIEW_SETTLE_NETWORK_FEE_LAMPORTS : networkFees.settle !== undefined ? BigInt(networkFees.settle) : undefined;
  const typical = mode === "preview" ? "Typical " : "";

  return (
    <div className="space-y-8" data-testid="try-console" data-phase={phase} data-mode={mode}>
      <section aria-labelledby="try-step-1">
        <div className="mb-6 inline-flex rounded-xl border border-white/10 bg-black/25 p-1" role="radiogroup" aria-label="How to try it" data-testid="try-mode">
          {([
            ["devnet", "Pay on devnet with a wallet"],
            ["preview", "Preview without a wallet"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              disabled={phase !== "pick"}
              onClick={() => setMode(value)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${mode === value ? "bg-brand-green text-black" : "text-gray-200 hover:text-white"} disabled:cursor-default`}
              data-testid={`try-mode-${value}`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "preview" ? (
          <p className="-mt-2 mb-5 max-w-3xl text-sm leading-6 text-gray-300" data-testid="try-preview-intro">
            Walk through the whole call with nothing to install. The provider quotes, answers and signs a receipt, and you see the payment it would settle,
            with no wallet and nothing on chain. When you&apos;re ready, switch to devnet and pay for real.
          </p>
        ) : null}
        <h2 id="try-step-1" className="font-display text-2xl font-bold text-white">1. Pick something to ask</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {TRY_TASKS.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={phase !== "pick"}
              onClick={() => setTask(t)}
              className={`rounded-2xl border p-4 text-left transition ${t.id === task.id ? "border-brand-green bg-brand-green/10" : "border-white/10 bg-black/20 hover:border-white/25"} disabled:cursor-default`}
              data-testid={`try-task-${t.id}`}
              aria-pressed={t.id === task.id}
            >
              <p className="font-semibold text-white">{t.title}</p>
              <p className="mt-2 text-sm leading-6 text-gray-300">{t.blurb}</p>
            </button>
          ))}
        </div>
        {phase === "pick" ? (
          <button type="button" onClick={start} disabled={busy} className="mt-5 rounded-xl bg-brand-green px-5 py-3 font-semibold text-black hover:opacity-90 disabled:opacity-50" data-testid="try-start">
            {busy ? "Getting the price…" : "Get the price"}
          </button>
        ) : null}
      </section>

      {started && (phase === "pay" || phase === "waiting") ? (
        <section aria-labelledby="try-step-2" className="rounded-3xl border border-white/10 bg-black/20 p-6">
          <h2 id="try-step-2" className="font-display text-2xl font-bold text-white">2. Pay {started.provider.name}</h2>
          <p className="mt-3 max-w-3xl leading-7 text-gray-300">
            {started.provider.name} charges ${started.provider.pricing.inputPerMillionUsd} per million tokens in and ${started.provider.pricing.outputPerMillionUsd} out.
            Your wallet locks at most <span className="font-mono text-white" data-testid="try-max">{sol(started.maxLamports)} SOL</span>
            {max ? <> (about {max.usdc} USDC, {max.audd} AUDD)</> : null}. After the answer it pays for the tokens actually used, and the rest comes back to you.
            Your wallet shows a little more leaving than that: the escrow account&apos;s storage deposit, which comes back to you with the change when the escrow closes.
          </p>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-center">
              <p className="font-semibold text-white">Scan with your phone</p>
              <p className="mt-1 text-sm text-gray-400">Solana Pay, in Phantom or Solflare set to devnet</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn in the browser */}
              {qr ? <img src={qr} alt="Solana Pay QR code for this payment" className="mx-auto mt-4 rounded-xl bg-white p-2" width={240} height={240} data-testid="try-qr" /> : null}
              <a href={started.solanaPayUrl} className="mt-4 inline-block text-sm text-brand-green underline md:hidden" data-testid="try-open-wallet">Open in my wallet app</a>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
              <p className="font-semibold text-white">Or use a wallet in this browser</p>
              <p className="mt-1 text-sm text-gray-400">Set your wallet to Solana devnet first.</p>
              <div className="mt-4"><WalletMultiButton /></div>
              <button type="button" onClick={payWithConnectedWallet} disabled={!publicKey || busy || phase === "waiting"} className="mt-4 rounded-xl bg-brand-green px-5 py-3 font-semibold text-black hover:opacity-90 disabled:opacity-50" data-testid="try-pay-wallet">
                {busy ? "Waiting for your wallet…" : "Pay with this wallet"}
              </button>
            </div>
          </div>
          <p className="mt-5 text-sm text-gray-300" aria-live="polite" data-testid="try-waiting">
            {phase === "waiting" ? "Payment sent. Waiting for devnet to confirm it, then asking the provider…" : "Waiting for your payment. This page updates by itself. On a phone, come back to this page after you approve in your wallet."}
          </p>
        </section>
      ) : null}

      {preview && phase === "pay" && mode === "preview" ? (
        <section aria-labelledby="try-step-2-preview" className="rounded-3xl border border-white/10 bg-black/20 p-6" data-testid="try-preview-pay">
          <h2 id="try-step-2-preview" className="font-display text-2xl font-bold text-white">2. Pay {provider.name}, in preview</h2>
          <p className="mt-3 max-w-3xl leading-7 text-gray-300">
            {provider.name} charges ${provider.pricing.inputPerMillionUsd} per million tokens in and ${provider.pricing.outputPerMillionUsd} out.
            On devnet your wallet would lock at most <span className="font-mono text-white" data-testid="try-preview-max">{sol(preview.maxLamports)} SOL</span>
            {" "}(about {triPriceFromLamports(preview.maxLamports).usdc} USDC, {triPriceFromLamports(preview.maxLamports).audd} AUDD), then pay for the tokens actually used and get the rest back.
            Here the provider accepts a simulated payment for that amount instead.
          </p>
          <button type="button" onClick={payPreview} disabled={busy} className="mt-5 rounded-xl bg-brand-green px-5 py-3 font-semibold text-black hover:opacity-90 disabled:opacity-50" data-testid="try-preview-pay-button">
            {busy ? "Asking the provider…" : "Send the preview payment"}
          </button>
        </section>
      ) : null}

      {message ? (
        <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100" role="status" data-testid="try-message">
          {message}
        </p>
      ) : null}

      {phase === "answered" && (answered || previewResult) ? (
        <section aria-labelledby="try-step-3" className="rounded-3xl border border-brand-green/25 bg-black/20 p-6" data-testid="try-answer">
          <h2 id="try-step-3" className="font-display text-2xl font-bold text-white">3. Your answer, and the receipt</h2>
          <pre className="mt-4 whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-sm leading-6 text-gray-100">{answer}</pre>
          {payment ? (
            <dl className="mt-5 grid gap-2 text-sm text-gray-200 sm:grid-cols-2">
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">{mode === "preview" ? "Maximum authorised" : "Locked"}</dt><dd className="font-mono">{sol(payment.metered?.maxAmount ?? started?.maxLamports ?? "0")} SOL</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">Paid for {payment.metered ? `${payment.metered.inputTokens} in, ${payment.metered.outputTokens} out tokens` : "the answer"}</dt><dd className="font-mono" data-testid="try-charged">{sol(payment.amount ?? "0")} SOL <span className="text-gray-400">(about ${triPriceFromLamports(BigInt(payment.amount ?? "0")).usdc})</span></dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">Protocol fee, inside that</dt><dd className="font-mono">{sol(payment.fee?.amount ?? "0")} SOL</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-gray-400">Back to your wallet</dt><dd className="font-mono">{sol(payment.metered?.refunded ?? "0")} SOL</dd></div>
              {lockNetworkFee !== undefined ? (
                <div><dt className="text-xs uppercase tracking-wide text-gray-400">{typical}Solana network fee for {mode === "preview" ? "the" : "your"} lock</dt><dd className="font-mono" data-testid="try-network-fee">{sol(lockNetworkFee)} SOL <span className="text-gray-400">(about ${triPriceFromLamports(lockNetworkFee).usdc})</span></dd></div>
              ) : null}
              {settleNetworkFee !== undefined ? (
                <div><dt className="text-xs uppercase tracking-wide text-gray-400">{typical}Network fee for the settle, paid by {provider.name}</dt><dd className="font-mono">{sol(settleNetworkFee)} SOL</dd></div>
              ) : null}
            </dl>
          ) : null}
          <ul className="mt-5 space-y-1 text-sm" data-testid="try-checks">
            {(verification?.checks ?? []).map((check) => (
              <li key={check.id} className={check.passed ? "text-emerald-200" : "text-amber-200"}>
                {check.passed ? "✓" : "✗"} {check.label}
              </li>
            ))}
          </ul>
          {mode === "preview" ? (
            <p className="mt-4 max-w-3xl text-sm leading-6 text-gray-300" data-testid="try-preview-note">
              That&apos;s the whole call: price, answer and a receipt the provider signed, checked in your browser. On devnet the same steps run with your
              wallet, and the lock and settle land on chain.{" "}
              <button type="button" onClick={() => { reset(); setMode("devnet"); }} className="text-brand-green underline" data-testid="try-switch-devnet">Pay on devnet next</button>
            </p>
          ) : null}
          {answered ? (
            <p className="mt-4 text-sm text-gray-400">
              Lock <a className="underline hover:text-white" href={explorerTxUrl(answered.lockSignature)} target="_blank" rel="noreferrer">{shortAddress(answered.lockSignature)}</a>
              {payment?.txSignature ? <> · Settle <a className="underline hover:text-white" href={explorerTxUrl(payment.txSignature)} target="_blank" rel="noreferrer">{shortAddress(payment.txSignature)}</a></> : null}
              {" · "}Escrow <a className="underline hover:text-white" href={explorerAddressUrl(answered.escrow)} target="_blank" rel="noreferrer">{shortAddress(answered.escrow)}</a>
            </p>
          ) : null}
          <button type="button" onClick={reset} className="mt-5 rounded-xl border border-white/15 px-4 py-2 text-sm text-gray-200 hover:border-white/30">Try another</button>
        </section>
      ) : null}

      {phase === "failed" && refund ? (
        <section className="rounded-3xl border border-white/10 bg-black/20 p-6 text-center md:text-left" data-testid="try-refund">
          <h2 className="font-display text-xl font-bold text-white">Take your SOL back</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">
            Scan with the wallet that paid, or open the link on your phone. It returns everything in the escrow, with no fee, once the refund window is open.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn in the browser */}
          <img src={refund.qr} alt="Solana Pay QR code for the refund" className="mx-auto mt-4 rounded-xl bg-white p-2 md:mx-0" width={200} height={200} />
          <a href={refund.url} className="mt-3 inline-block text-sm text-brand-green underline" data-testid="try-refund-link">Open the refund in my wallet app</a>
        </section>
      ) : null}

      {phase === "failed" ? (
        <button type="button" onClick={reset} className="rounded-xl border border-white/15 px-4 py-2 text-sm text-gray-200 hover:border-white/30" data-testid="try-again">Start again</button>
      ) : null}

      {phase === "answered" ? <AgentHandoff /> : null}
    </div>
  );
}
