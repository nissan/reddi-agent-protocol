"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, Transaction } from "@solana/web3.js";
import { explorerAddressUrl, explorerTxUrl, shortAddress } from "@/lib/sandbox/client";
import { formatUnits, triPriceFromLamports } from "@/lib/sandbox/pricing";
import { passAgentSnippet } from "@/lib/pass/snippet";

const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });

const DEVNET_RPC = "https://api.devnet.solana.com";
const POLL_MS = 2000;
const FAUCET_URL = "https://faucet.solana.com";
const DEFAULT_BUDGET_SOL = "0.01";

type Offer = { id: string; name: string; model: string; pricing: { inputPerMillionUsd: string; outputPerMillionUsd: string }; minLamports: string };
type View = {
  id: string;
  status: "waiting" | "active" | "closed";
  expiresAt: number;
  payer?: string;
  lockSignature?: string;
  perCallMaxLamports?: string;
  providers: { id: string; name: string; model: string; maxLamports: string; spentLamports: string; calls: number; escrow?: string; closed: boolean; settleSignature?: string }[];
};
type Started = { key: string; payUrl: string; solanaPayUrl: string; baseUrl: string; pass: View };

function sol(lamports: string | bigint): string {
  return formatUnits(BigInt(lamports), 9);
}

/** Whole lamports from a SOL amount typed by the person, or undefined. */
function lamportsOf(text: string): bigint | undefined {
  const match = /^\s*(\d{0,3})(?:\.(\d{0,9}))?\s*$/.exec(text);
  if (!match || (!match[1] && !match[2])) return undefined;
  return BigInt(match[1] || "0") * BigInt(1_000_000_000) + BigInt((match[2] ?? "").padEnd(9, "0") || "0");
}

function errorText(body: unknown, fallback: string): string {
  const error = (body as { error?: { message?: unknown } } | undefined)?.error;
  return typeof error?.message === "string" ? error.message : fallback;
}

export default function PassConsole() {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const [cap, setCap] = useState("");
  const [started, setStarted] = useState<Started | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const polling = useRef(false);
  const { publicKey, signTransaction } = useWallet();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/pass/v1/start", { cache: "no-store" });
        const body = (await response.json()) as { providers?: Offer[] };
        if (!live) return;
        const list = response.ok && Array.isArray(body.providers) ? body.providers : [];
        setOffers(list);
        if (list[0]) setBudgets({ [list[0].id]: DEFAULT_BUDGET_SOL });
        if (!response.ok) setMessage(errorText(body, "Agent passes are not available right now."));
      } catch {
        if (live) {
          setOffers([]);
          setMessage("The providers could not be loaded. Check your connection and reload the page.");
        }
      }
    })();
    return () => {
      live = false;
      polling.current = false;
    };
  }, []);

  const poll = useCallback(async (passId: string) => {
    if (polling.current) return;
    polling.current = true;
    while (polling.current) {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch("/api/pass/v1/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: passId }), cache: "no-store" });
          const body = (await response.json()) as { pass?: View };
          if (response.ok && body.pass) {
            setView(body.pass);
            if (body.pass.status !== "waiting") {
              polling.current = false;
              return;
            }
          } else if (response.status !== 503) {
            polling.current = false;
            setMessage(errorText(body, "Something went wrong. Start again."));
            return;
          }
        } catch {
          // A dropped poll is retried.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }, []);

  const picked = (offers ?? []).filter((offer) => budgets[offer.id] !== undefined);
  const total = picked.reduce((sum, offer) => sum + (lamportsOf(budgets[offer.id]) ?? BigInt(0)), BigInt(0));

  async function start() {
    setMessage(null);
    const entries = [];
    for (const offer of picked) {
      const lamports = lamportsOf(budgets[offer.id]);
      if (lamports === undefined || lamports <= BigInt(0)) {
        setMessage(`Give ${offer.name} a budget in SOL, such as ${DEFAULT_BUDGET_SOL}.`);
        return;
      }
      entries.push({ providerId: offer.id, lamports: lamports.toString() });
    }
    if (entries.length === 0) {
      setMessage("Pick at least one provider for your agent.");
      return;
    }
    const capLamports = cap.trim() ? lamportsOf(cap) : undefined;
    if (cap.trim() && (capLamports === undefined || capLamports <= BigInt(0))) {
      setMessage("Give the per-call limit in SOL, such as 0.001, or leave it empty.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/pass/v1/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budgets: entries, ...(capLamports ? { perCallMaxLamports: capLamports.toString() } : {}) }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(errorText(body, "The pass could not start. Nothing was asked of your wallet."));
        return;
      }
      const s = body as Started;
      setStarted(s);
      setView(s.pass);
      setQr(await QRCode.toDataURL(s.solanaPayUrl, { margin: 1, width: 280, errorCorrectionLevel: "M" }));
      void poll(s.pass.id);
    } catch {
      setMessage("The pass could not start. Check your connection and try again.");
    } finally {
      setBusy(false);
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
      if (BigInt(balance) < total + BigInt(5_000_000)) {
        setMessage(`This wallet holds ${(balance / 1e9).toFixed(4)} devnet SOL, not enough for this pass. Get free test SOL from ${FAUCET_URL}, then try again.`);
        return;
      }
      const signed = await signTransaction(Transaction.from(Buffer.from((body as { transaction: string }).transaction, "base64")));
      await devnet.sendRawTransaction(signed.serialize());
      setSent(true);
    } catch {
      setMessage("The wallet did not sign, or devnet did not take the transaction. Nothing was paid.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!started) return;
    polling.current = false;
    await poll(started.pass.id);
  }

  async function close() {
    if (!started) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/pass/v1/close", { method: "POST", headers: { authorization: `Bearer ${started.key}` } });
      const body = (await response.json()) as { pass?: View; failures?: string[] };
      if (body.pass) setView(body.pass);
      if (!response.ok) setMessage(errorText(body, "The pass could not be closed just now. Try again in a moment."));
      else if (body.failures?.length) setMessage(`Some of the pass did not close yet: ${body.failures.join(" ")}`);
    } catch {
      setMessage("The pass could not be closed just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  const status = view?.status;
  const snippet = started ? passAgentSnippet({ baseUrl: started.baseUrl, key: started.key, models: (view?.providers ?? []).map((p) => p.model) }) : "";

  return (
    <div className="space-y-8" data-testid="pass-console" data-status={status ?? "new"}>
      <section aria-labelledby="pass-step-1">
        <h2 id="pass-step-1" className="font-display text-2xl font-bold text-white">1. Pick providers and a budget for each</h2>
        {offers === null ? <p className="mt-4 text-gray-300">Loading the providers…</p> : null}
        {offers && offers.length === 0 ? <p className="mt-4 text-gray-300" data-testid="pass-none">No provider is taking passes right now. Try again later.</p> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(offers ?? []).map((offer) => {
            const on = budgets[offer.id] !== undefined;
            return (
              <div key={offer.id} className={`rounded-2xl border p-4 ${on ? "border-brand-green bg-brand-green/10" : "border-white/10 bg-black/20"}`} data-testid={`pass-offer-${offer.id}`}>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={started !== null}
                    onChange={(e) =>
                      setBudgets((current) => {
                        const next = { ...current };
                        if (e.target.checked) next[offer.id] = DEFAULT_BUDGET_SOL;
                        else delete next[offer.id];
                        return next;
                      })
                    }
                    className="mt-1"
                  />
                  <span>
                    <span className="font-semibold text-white">{offer.name}</span>
                    <span className="block font-mono text-xs text-gray-400">{offer.model}</span>
                    <span className="mt-1 block text-sm text-gray-300">
                      ${offer.pricing.inputPerMillionUsd} per million tokens in, ${offer.pricing.outputPerMillionUsd} out. At least {sol(offer.minLamports)} SOL.
                    </span>
                  </span>
                </label>
                {on ? (
                  <label className="mt-3 flex items-center gap-2 text-sm text-gray-200">
                    Budget
                    <input
                      value={budgets[offer.id]}
                      disabled={started !== null}
                      onChange={(e) => setBudgets((current) => ({ ...current, [offer.id]: e.target.value }))}
                      inputMode="decimal"
                      className="w-28 rounded-lg border border-white/15 bg-black/40 px-2 py-1 font-mono text-white"
                      data-testid={`pass-budget-${offer.id}`}
                    />
                    SOL
                  </label>
                ) : null}
              </div>
            );
          })}
        </div>
        {offers && offers.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-200">
              Most one call may cost (optional)
              <input value={cap} disabled={started !== null} onChange={(e) => setCap(e.target.value)} inputMode="decimal" placeholder="0.001" className="w-28 rounded-lg border border-white/15 bg-black/40 px-2 py-1 font-mono text-white" data-testid="pass-cap" />
              SOL
            </label>
            <p className="text-sm text-gray-300">
              Total: <span className="font-mono text-white" data-testid="pass-total">{sol(total)} SOL</span> (about ${triPriceFromLamports(total).usdc})
            </p>
          </div>
        ) : null}
        {!started && offers && offers.length > 0 ? (
          <button type="button" onClick={start} disabled={busy} className="mt-5 rounded-xl bg-brand-green px-5 py-3 font-semibold text-black hover:opacity-90 disabled:opacity-50" data-testid="pass-start">
            {busy ? "Preparing the pass…" : "Make the pass"}
          </button>
        ) : null}
      </section>

      {started && status === "waiting" ? (
        <section aria-labelledby="pass-step-2" className="rounded-3xl border border-white/10 bg-black/20 p-6" data-testid="pass-pay">
          <h2 id="pass-step-2" className="font-display text-2xl font-bold text-white">2. Lock the budget with one signature</h2>
          <p className="mt-3 max-w-3xl leading-7 text-gray-300">
            Your wallet signs one transaction. It locks {sol(total)} SOL in escrow, one lock per provider, and lets this pass make calls against those locks for 24 hours.
            Each provider is paid only for the calls it answers, and the rest comes back to your wallet when the pass closes.
          </p>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-center">
              <p className="font-semibold text-white">Scan with your phone</p>
              <p className="mt-1 text-sm text-gray-400">Solana Pay, in Phantom or Solflare set to devnet</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn in the browser */}
              {qr ? <img src={qr} alt="Solana Pay QR code for this pass" className="mx-auto mt-4 rounded-xl bg-white p-2" width={240} height={240} data-testid="pass-qr" /> : null}
              <a href={started.solanaPayUrl} className="mt-4 inline-block text-sm text-brand-green underline md:hidden">Open in my wallet app</a>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
              <p className="font-semibold text-white">Or use a wallet in this browser</p>
              <p className="mt-1 text-sm text-gray-400">Set your wallet to Solana devnet first.</p>
              <div className="mt-4"><WalletMultiButton /></div>
              <button type="button" onClick={payWithConnectedWallet} disabled={!publicKey || busy || sent} className="mt-4 rounded-xl bg-brand-green px-5 py-3 font-semibold text-black hover:opacity-90 disabled:opacity-50" data-testid="pass-pay-wallet">
                {busy ? "Waiting for your wallet…" : "Pay with this wallet"}
              </button>
            </div>
          </div>
          <p className="mt-5 text-sm text-gray-300" aria-live="polite">
            {sent ? "Sent. Waiting for devnet to confirm the lock…" : "Waiting for your signature. This page updates by itself; on a phone, come back here after you approve."}
          </p>
        </section>
      ) : null}

      {message ? (
        <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100" role="status" data-testid="pass-message">
          {message}
        </p>
      ) : null}

      {started && view && status !== "waiting" ? (
        <section aria-labelledby="pass-step-3" className="rounded-3xl border border-brand-green/25 bg-black/20 p-6" data-testid="pass-ready">
          <h2 id="pass-step-3" className="font-display text-2xl font-bold text-white">{status === "closed" ? "Your pass is closed" : "3. Give your agent the pass"}</h2>
          {status === "active" ? (
            <>
              <p className="mt-3 max-w-3xl leading-7 text-gray-300">
                Copy this into your assistant&apos;s settings or instructions. It works with any assistant that can call an OpenAI-style API with a key.
                This page shows the key once, so copy it now. Anyone with the key can spend this pass, up to its budget, until it ends.
              </p>
              <div className="relative mt-4">
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/40 p-4 pr-20 font-mono text-sm leading-6 text-gray-100" data-testid="pass-snippet">{snippet}</pre>
                <button type="button" onClick={() => copy("snippet", snippet)} className="absolute right-3 top-3 rounded-lg border border-white/15 bg-black/50 px-3 py-1 text-xs text-gray-200 hover:border-white/30">
                  {copied === "snippet" ? "Copied" : "Copy"}
                </button>
              </div>
            </>
          ) : null}
          <dl className="mt-5 grid gap-3 text-sm text-gray-200 sm:grid-cols-2">
            {view.providers.map((p) => (
              <div key={p.id} className="rounded-xl border border-white/10 bg-black/25 p-3" data-testid={`pass-provider-${p.id}`}>
                <dt className="font-semibold text-white">{p.name}</dt>
                <dd className="mt-1 font-mono">
                  {sol(p.spentLamports)} of {sol(p.maxLamports)} SOL, {p.calls} {p.calls === 1 ? "call" : "calls"}
                </dd>
                {p.escrow ? <dd className="mt-1 text-xs text-gray-400">Escrow <a className="underline" href={explorerAddressUrl(p.escrow)} target="_blank" rel="noreferrer">{shortAddress(p.escrow)}</a></dd> : null}
                {p.settleSignature ? <dd className="mt-1 text-xs text-gray-400">Settled <a className="underline" href={explorerTxUrl(p.settleSignature)} target="_blank" rel="noreferrer">{shortAddress(p.settleSignature)}</a></dd> : null}
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-gray-400">
            {status === "active" ? <>Ends {new Date(view.expiresAt * 1000).toLocaleString()}. </> : null}
            {view.lockSignature ? <>Lock <a className="underline" href={explorerTxUrl(view.lockSignature)} target="_blank" rel="noreferrer">{shortAddress(view.lockSignature)}</a>.</> : null}
          </p>
          {status === "active" ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={refresh} disabled={busy} className="rounded-xl border border-white/15 px-5 py-3 font-semibold text-white hover:border-white/30 disabled:opacity-50" data-testid="pass-refresh">
                See what it has spent
              </button>
              <button type="button" onClick={close} disabled={busy} className="rounded-xl bg-brand-green px-5 py-3 font-semibold text-black hover:opacity-90 disabled:opacity-50" data-testid="pass-close">
                {busy ? "Closing…" : "Close the pass and get the rest back"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
