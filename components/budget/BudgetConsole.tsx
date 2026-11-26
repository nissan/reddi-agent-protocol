"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, Transaction } from "@solana/web3.js";
import { explorerAddressUrl, explorerTxUrl, shortAddress } from "@/lib/sandbox/client";
import { formatUnits, triPriceFromLamports } from "@/lib/sandbox/pricing";
import { checkBudgetTransaction, type ExpectedOpen } from "@/lib/budget/tx-check";
import { isPausedError, PAUSED_MESSAGE } from "@redditech/x402-solana/pause";

const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });

const DEVNET_RPC = "https://api.devnet.solana.com";
const POLL_MS = 5000;
const ACTIVATE_POLL_MS = 3000;
/** Evidence beside posted shares (calls signed, latest receipt) is read on the first load and then about once a minute, not on every poll. */
const EVIDENCE_EVERY_POLLS = 12;
const SLOT_MS = 400;
const MAX_PROVIDERS = 4;
const LAST_BUDGET_KEY = "rap-budget-last";
/** A started Budget whose key is not switched on yet, kept for this tab so a reload can finish activating it. */
const PENDING_BUDGET_KEY = "rap-budget-pending";
const FAUCET_URL = "https://faucet.solana.com";
const noopSubscribe = () => () => {};
const budgetInUrl = () => new URLSearchParams(window.location.search).get("b");

type TokenName = "SOL" | "USDC";
type Provider = { id: string; name: string; model: string; tagline: string; payTo: string; token: TokenName; pricing: { inputPerMillionUsd: string; outputPerMillionUsd: string } };
type Offer = { providers: Provider[]; tokens: Record<TokenName, { decimals: number; max: string; defaultTotal: string; mint: string | null }>; judge: string | null; emailConfirm?: boolean };
type SliceAction = "approve" | "dispute" | "payout";
type Slice = {
  payee: string;
  provider?: { id: string; name: string; model: string };
  reserved: string;
  posted: string;
  state: "open" | "posted" | "disputed" | "paid";
  approved: boolean;
  disputeEndsSlot?: string;
  judgeEndsSlot?: string;
  actions: SliceAction[];
  evidence?: { signedCalls: number; receipt: { served: number; cost: string } | null; judgeWouldPay?: string };
};
type View = {
  address: string;
  payer: string;
  token: TokenName;
  decimals: number;
  total: string;
  unreserved: string;
  perProviderCap: string;
  judge: string | null;
  createdSlot: string;
  openEndsSlot: string;
  closedSlot: string | null;
  closed: boolean;
  reviewFromOpenEnd: boolean;
  slot: string;
  providers: { payee: string; id?: string; name?: string }[];
  slices: Slice[];
  canClose: boolean;
};

const card = "rounded-2xl border border-white/10 bg-black/20 p-4";
const primary = "rounded-xl bg-brand-green px-5 py-3 font-semibold text-black hover:opacity-90 disabled:opacity-50";
const quiet = "rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:border-white/30 disabled:opacity-50";

function errorText(body: unknown, fallback: string): string {
  const error = (body as { error?: { message?: unknown } } | undefined)?.error;
  return typeof error?.message === "string" ? error.message : fallback;
}

function errorCode(body: unknown): string | undefined {
  const code = (body as { error?: { code?: unknown } } | undefined)?.error?.code;
  return typeof code === "string" ? code : undefined;
}

const proofKey = (payer: string, email: string) => `rap-budget-email-proof:${payer}:${email.trim().toLowerCase()}`;

/** The proof a confirmation link left in this browser for this wallet and address, if any. */
function storedEmailProof(payer: string, email: string): string | undefined {
  try {
    return window.localStorage.getItem(proofKey(payer, email)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** What a confirmation link's fragment carries (`#confirm=…&payer=…&email=…`), or undefined. */
export function confirmationFromHash(hash: string): { proof: string; payer: string; email: string } | undefined {
  if (!hash.startsWith("#confirm=")) return undefined;
  const params = new URLSearchParams(hash.slice(1));
  const proof = params.get("confirm");
  const payer = params.get("payer");
  const email = params.get("email");
  if (!proof || !payer || !email || proof.length > 80 || payer.length > 44 || email.length > 512) return undefined;
  return { proof, payer, email };
}

/** Base units from a decimal amount the person typed, or undefined. */
export function unitsOf(text: string, decimals: number): bigint | undefined {
  const match = new RegExp(`^\\s*(\\d{0,6})(?:\\.(\\d{0,${decimals}}))?\\s*$`).exec(text);
  if (!match || (!match[1] && !match[2])) return undefined;
  const base = BigInt(10) ** BigInt(decimals);
  return BigInt(match[1] || "0") * base + BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
}

function amount(units: string | bigint, decimals: number, token: TokenName): string {
  return `${formatUnits(BigInt(units), decimals)} ${token}`;
}

/** The calls the Budget signed and the provider's latest receipt, beside a posted share, so the payer can judge a post before disputing it. */
function SliceEvidenceNote({ slice, units }: { slice: Slice; units: (value: string) => string }) {
  const e = slice.evidence!;
  const calls = (n: number) => `${n} call${n === 1 ? "" : "s"}`;
  const posted = BigInt(slice.posted);
  return (
    <div className="mt-2 space-y-1 text-xs text-gray-400" data-testid="budget-slice-evidence">
      <p>
        Your Budget signed {calls(e.signedCalls)} to this provider.{" "}
        {e.receipt ? `Its latest receipt shows ${calls(e.receipt.served)} costing ${units(e.receipt.cost)}.` : "No receipt from it matches those calls yet."}
      </p>
      {e.judgeWouldPay !== undefined && slice.state === "posted" && BigInt(e.judgeWouldPay) < posted ? (
        <p className="text-amber-300" data-testid="budget-slice-evidence-short">
          That is less than it posted. If you dispute, the RAP judge pays it {units(e.judgeWouldPay)} and the rest comes back to you.
        </p>
      ) : null}
    </div>
  );
}

/** "in about 3 h" / "about 20 min ago" from a slot, at about 400 ms a slot. */
function whenSlot(target: string | null | undefined, now: string): string {
  if (!target) return "";
  const ms = Number(BigInt(target) - BigInt(now)) * SLOT_MS;
  const abs = Math.abs(ms);
  const text = abs >= 2 * 3_600_000 ? `${Math.round(abs / 3_600_000)} h` : `${Math.max(1, Math.round(abs / 60_000))} min`;
  return ms >= 0 ? `in about ${text}` : `about ${text} ago`;
}

function readLast(): string | null {
  try {
    return window.localStorage.getItem(LAST_BUDGET_KEY);
  } catch {
    return null;
  }
}

function writeLast(address: string | null) {
  try {
    if (address) window.localStorage.setItem(LAST_BUDGET_KEY, address);
    else window.localStorage.removeItem(LAST_BUDGET_KEY);
  } catch {
    // Remembering the last Budget is a convenience only.
  }
}

type Pending = { id: string; budget: string; key: string };

function readPending(): Pending | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_BUDGET_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Pending>) : null;
    return p && typeof p.id === "string" && typeof p.budget === "string" && typeof p.key === "string" ? (p as Pending) : null;
  } catch {
    return null;
  }
}

function writePending(p: Pending | null) {
  try {
    if (p) window.sessionStorage.setItem(PENDING_BUDGET_KEY, JSON.stringify(p));
    else window.sessionStorage.removeItem(PENDING_BUDGET_KEY);
  } catch {
    // Without storage a reload before activation loses the key: the Budget can still be closed from its page.
  }
}

const STATE_LABEL: Record<Slice["state"], string> = {
  open: "Working: calls are being metered",
  posted: "Posted what it is owed",
  disputed: "Disputed: the judge decides",
  paid: "Paid",
};

class RefusedTransaction extends Error {}

export default function BudgetConsole() {
  const { publicKey, signMessage, signTransaction } = useWallet();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [token, setToken] = useState<TokenName>("SOL");
  const [total, setTotal] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [keyModel, setKeyModel] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<{ id: string; budget: string; signature?: string } | null>(null);
  const fromUrl = useSyncExternalStore(noopSubscribe, budgetInUrl, () => null);
  const last = useSyncExternalStore(noopSubscribe, readLast, () => null);
  /** Undefined until the person picks: then the Budget in the URL, if any. */
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const address = chosen === undefined ? fromUrl : chosen;
  const [view, setView] = useState<View | null>(null);
  const [gone, setGone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const watching = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/budget/v1/prepare", { cache: "no-store" });
        const body = (await response.json()) as Offer;
        if (!live) return;
        if (!response.ok) {
          setMessage(errorText(body, "Budgets are not available right now."));
          return;
        }
        setOffer(body);
        setTotal(formatUnits(BigInt(body.tokens.SOL.defaultTotal), body.tokens.SOL.decimals));
        setPicked(body.providers.filter((p) => p.token === "SOL").slice(0, 2).map((p) => p.id));
      } catch {
        if (live) setMessage("The providers could not be loaded. Check your connection and reload the page.");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // A confirmation link lands here: keep its proof in this browser and take it out of the address bar.
  useEffect(() => {
    const confirmed = confirmationFromHash(window.location.hash);
    if (!confirmed) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    let kept = true;
    try {
      window.localStorage.setItem(proofKey(confirmed.payer, confirmed.email), confirmed.proof);
    } catch {
      kept = false;
    }
    void Promise.resolve().then(() => {
      if (kept) setEmail(confirmed.email);
      setMessage(kept ? "Your alert email is confirmed. Connect the same wallet and open your Budget." : "This browser would not keep the confirmation. Allow site storage for this page, then open the link again.");
    });
  }, []);

  const polls = useRef(0);
  const load = useCallback(async (budget: string) => {
    const withEvidence = polls.current++ % EVIDENCE_EVERY_POLLS === 0;
    try {
      const response = await fetch(`/api/budget/v1/status?budget=${encodeURIComponent(budget)}${withEvidence ? "&evidence=1" : ""}`, { cache: "no-store" });
      const body = (await response.json()) as { budget?: View };
      if (response.ok && body.budget) {
        const next = body.budget;
        // Between evidence reads, keep the last evidence for shares whose post has not changed.
        setView((prev) =>
          withEvidence || !prev || prev.address !== next.address
            ? next
            : { ...next, slices: next.slices.map((s) => { const old = prev.slices.find((o) => o.payee === s.payee); return old?.evidence && old.posted === s.posted && old.state === s.state ? { ...s, evidence: old.evidence } : s; }) },
        );
        setGone(false);
      } else if (response.status === 404) {
        setView(null);
        setGone(true);
      }
    } catch {
      // A dropped poll is retried.
    }
  }, []);

  useEffect(() => {
    if (!address) return;
    watching.current = address;
    const first = setTimeout(() => void load(address), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && watching.current === address) void load(address);
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [address, load]);

  function show(budget: string | null) {
    setChosen(budget);
    setView(null);
    setGone(false);
    writeLast(budget);
    const url = new URL(window.location.href);
    if (budget) url.searchParams.set("b", budget);
    else url.searchParams.delete("b");
    window.history.replaceState(null, "", url.toString());
  }

  function pickToken(next: TokenName) {
    setToken(next);
    if (offer) {
      setTotal(formatUnits(BigInt(offer.tokens[next].defaultTotal), offer.tokens[next].decimals));
      // A Budget holds one token, so it can only name providers paid in it.
      setPicked(offer.providers.filter((p) => p.token === next).slice(0, 2).map((p) => p.id));
    }
  }

  function toggle(id: string, on: boolean) {
    setPicked((current) => (on ? [...current, id].slice(0, MAX_PROVIDERS) : current.filter((x) => x !== id)));
  }

  async function send(transaction: string, expect: { budget: string; open?: ExpectedOpen }): Promise<string> {
    if (!signTransaction || !publicKey) throw new Error("no wallet");
    const wrong = checkBudgetTransaction(transaction, { wallet: publicKey.toBase58(), ...expect });
    if (wrong) throw new RefusedTransaction(wrong);
    const signed = await signTransaction(Transaction.from(Buffer.from(transaction, "base64")));
    const devnet = new Connection(DEVNET_RPC, "confirmed");
    const signature = await devnet.sendRawTransaction(signed.serialize());
    await devnet.confirmTransaction(signature, "confirmed");
    return signature;
  }

  async function open() {
    if (!offer) return;
    setMessage(null);
    if (!publicKey || !signMessage || !signTransaction) {
      setMessage("Connect a wallet in this browser first. It must be able to sign a message, as Phantom and Solflare can.");
      return;
    }
    const t = offer.tokens[token];
    const units = unitsOf(total, t.decimals);
    if (units === undefined || units <= BigInt(0)) {
      setMessage(`Give the Budget an amount in ${token}.`);
      return;
    }
    if (picked.length === 0) {
      setMessage("Pick at least one provider your agent may pay.");
      return;
    }
    setBusy("open");
    try {
      if (token === "SOL") {
        const balance = await new Connection(DEVNET_RPC, "confirmed").getBalance(publicKey);
        if (BigInt(balance) < units + BigInt(10_000_000)) {
          setMessage(`This wallet holds ${(balance / 1e9).toFixed(4)} devnet SOL, not enough for this Budget. Get free test SOL from ${FAUCET_URL}, then try again.`);
          return;
        }
      }
      const prepared = await fetch("/api/budget/v1/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payer: publicKey.toBase58(), token, total: units.toString(), providerIds: picked, email, emailProof: storedEmailProof(publicKey.toBase58(), email) }),
      });
      const terms = (await prepared.json()) as { terms?: { nonce?: string }; message?: string; budget?: string };
      if (prepared.status === 409 && errorCode(terms) === "email_unconfirmed") {
        const asked = await fetch("/api/budget/v1/confirm-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payer: publicKey.toBase58(), email }),
        });
        setMessage(asked.ok ? `We sent a link to ${email.trim()}. Open it in this browser, then press open again. Nothing was signed.` : errorText(await asked.json().catch(() => undefined), "The confirmation email could not be sent. Nothing was signed."));
        return;
      }
      if (!prepared.ok || !terms.message) {
        setMessage(errorText(terms, "The Budget could not be prepared. Nothing was signed."));
        return;
      }
      const signature = await signMessage(Uint8Array.from(Buffer.from(terms.message, "base64")));
      const started = await fetch("/api/budget/v1/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terms: terms.terms, signature: Buffer.from(signature).toString("base64") }),
      });
      const body = (await started.json()) as { id?: string; budget?: string; key?: string; transaction?: string };
      if (!started.ok || !body.id || !body.budget || !body.key || !body.transaction) {
        setMessage(errorText(body, "The Budget could not be started. Nothing was locked."));
        return;
      }
      if (body.budget !== terms.budget) {
        setMessage("The server answered for another Budget. Nothing was signed.");
        return;
      }
      setKey(body.key);
      setKeyModel(offer?.providers.find((p) => p.id === picked[0])?.model ?? null);
      const sent = await send(body.transaction, {
        budget: body.budget,
        open: {
          nonce: terms.terms?.nonce ?? "",
          total: units,
          mint: t.mint,
          allowlist: picked.map((id) => offer.providers.find((p) => p.id === id)?.payTo ?? ""),
          judge: offer.judge,
        },
      });
      writePending({ id: body.id, budget: body.budget, key: body.key });
      setWaiting({ id: body.id, budget: body.budget, signature: sent });
      void activate(body.id, body.budget);
    } catch (error) {
      setMessage(
        error instanceof RefusedTransaction
          ? `The page stopped before your wallet signed: ${error.message}. Nothing was locked; reload and try again.`
          : isPausedError(error)
            ? `${PAUSED_MESSAGE} Nothing was locked.`
            : "The wallet did not sign, or devnet did not take the transaction. Nothing was locked.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function activate(id: string, budget: string) {
    for (let i = 0; i < 60; i++) {
      try {
        const response = await fetch("/api/budget/v1/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }), cache: "no-store" });
        const body = (await response.json()) as { status?: string };
        if (response.ok && body.status === "open") {
          writePending(null);
          setWaiting(null);
          show(budget);
          return;
        }
        if (!response.ok) {
          writePending(null);
          setMessage(errorText(body, "The Budget is open on chain, but its key could not be switched on."));
          return;
        }
      } catch {
        // Retried.
      }
      await new Promise((resolve) => setTimeout(resolve, ACTIVATE_POLL_MS));
    }
    setMessage("Devnet is slow to finalize the Budget. Reload this page in a minute.");
  }

  // A reload between the wallet's signature and activation: finish switching the key on.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = readPending();
    if (!pending) return;
    const timer = setTimeout(() => {
      setKey(pending.key);
      setWaiting({ id: pending.id, budget: pending.budget });
      void activate(pending.id, pending.budget);
    }, 0);
    return () => clearTimeout(timer);
    // activate only reads state setters; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(action: "approve" | "dispute" | "close" | "payout", payee?: string) {
    if (!view) return;
    setMessage(null);
    if (!publicKey || !signTransaction) {
      setMessage("Connect the wallet that opened this Budget first.");
      return;
    }
    setBusy(`${action}:${payee ?? ""}`);
    try {
      const response = await fetch("/api/budget/v1/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budget: view.address, action, account: publicKey.toBase58(), ...(payee ? { payee } : {}) }),
      });
      const body = (await response.json()) as { transaction?: string };
      if (!response.ok || !body.transaction) {
        setMessage(errorText(body, "That could not be prepared. Nothing was signed."));
        return;
      }
      setLastSignature(await send(body.transaction, { budget: view.address }));
      await load(view.address);
    } catch (error) {
      setMessage(
        error instanceof RefusedTransaction
          ? `The page stopped before your wallet signed: ${error.message}. Nothing changed.`
          : "The wallet did not sign, or devnet did not take the transaction. Nothing changed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function copyKey() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const t = offer?.tokens[token];
  const units = t ? unitsOf(total, t.decimals) : undefined;
  const isPayer = Boolean(view && publicKey && publicKey.toBase58() === view.payer);

  return (
    <div className="space-y-8" data-testid="budget-console" data-state={view ? (view.closed ? "closed" : "open") : waiting ? "waiting" : "new"}>
      {/* The nav bar holds the wallet button on wider screens; on a phone it sits behind Menu, so it is repeated here. */}
      <div className="flex flex-wrap items-center gap-3 md:hidden">
        <WalletMultiButton />
        <span className="text-sm text-gray-400">Set your wallet to Solana devnet.</span>
      </div>

      {message ? (
        <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100" role="status" data-testid="budget-message">
          {message}
        </p>
      ) : null}

      {key ? (
        <section className="rounded-3xl border border-brand-green/40 bg-brand-green/10 p-6" aria-labelledby="budget-key" data-testid="budget-key">
          <h2 id="budget-key" className="font-display text-2xl font-bold text-white">Your agent&apos;s key</h2>
          <p className="mt-2 max-w-3xl leading-7 text-gray-300">
            Copy it now: this page shows it once. Your agent spends this Budget with it, only with the providers you picked, and never more than each one&apos;s share.
            Anyone with the key can do the same, so keep it in your agent&apos;s settings, not in chat.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="block max-w-full overflow-x-auto rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-sm text-gray-100" data-testid="budget-key-value">{key}</code>
            <button type="button" onClick={copyKey} className={quiet}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className="mt-4 text-sm font-semibold text-white">How your agent uses it</p>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-300">
            Send OpenAI-style chat calls to the address below with the key as a bearer token. The model names the provider. The first call to each provider takes its share of the Budget; later calls draw on it.
          </p>
          <pre className="mt-3 max-w-full overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs leading-5 text-gray-100" data-testid="budget-key-usage">{`curl ${typeof window === "undefined" ? "" : window.location.origin}/api/budget/v1/chat/completions \\
  -H "authorization: Bearer <your key>" \\
  -H "content-type: application/json" \\
  -d '{"model":"${keyModel ?? "<provider model>"}","messages":[{"role":"user","content":"Hello"}]}'`}</pre>
          <p className="mt-3 text-sm text-gray-400">
            Setting up the agent itself? <Link className="underline hover:text-white" href="/agent-setup">Agent setup</Link> has the steps for each kind of agent.
          </p>
        </section>
      ) : null}

      {waiting ? (
        <p className={`${card} text-sm leading-6 text-gray-200`} aria-live="polite" data-testid="budget-waiting">
          Locked. Waiting for devnet to finalize the Budget, then the key switches on. This takes about 15 seconds.
          {waiting.signature ? <> <a className="underline" href={explorerTxUrl(waiting.signature)} target="_blank" rel="noreferrer">See the transaction</a>.</> : null}
        </p>
      ) : null}

      {address ? (
        <BudgetDashboard
          view={view}
          gone={gone}
          address={address}
          isPayer={isPayer}
          busy={busy}
          lastSignature={lastSignature}
          onAct={act}
          onNew={() => {
            setKey(null);
            show(null);
          }}
        />
      ) : null}

      {!address && !waiting ? (
        <section aria-labelledby="budget-new" className="rounded-3xl border border-white/10 bg-black/20 p-6 md:p-8" data-testid="budget-new">
          <h2 id="budget-new" className="font-display text-2xl font-bold text-white">Set a budget</h2>
          {last ? (
            <p className="mt-2 text-sm text-gray-400">
              <button type="button" className="underline hover:text-white" onClick={() => show(last)} data-testid="budget-last">Back to your last Budget ({shortAddress(last)})</button>
            </p>
          ) : null}
          {!offer ? <p className="mt-4 text-gray-300">Loading…</p> : null}
          {offer && t ? (
            <div className="mt-5 space-y-6">
              <fieldset>
                <legend className="text-sm font-semibold text-white">1. How much, in one token</legend>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <div className="flex overflow-hidden rounded-xl border border-white/15" role="radiogroup" aria-label="Token">
                    {(["SOL", "USDC"] as TokenName[]).map((name) => (
                      <button
                        key={name}
                        type="button"
                        role="radio"
                        aria-checked={token === name}
                        onClick={() => pickToken(name)}
                        className={`px-4 py-2 text-sm font-semibold ${token === name ? "bg-brand-green text-black" : "text-white hover:bg-white/5"}`}
                        data-testid={`budget-token-${name}`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-200">
                    <span className="sr-only">Amount</span>
                    <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" className="w-32 rounded-lg border border-white/15 bg-black/40 px-3 py-2 font-mono text-white" data-testid="budget-total" />
                    {token}
                  </label>
                  {token === "SOL" && units !== undefined ? <span className="text-sm text-gray-400">about ${triPriceFromLamports(units).usdc}</span> : null}
                </div>
                <p className="mt-2 text-sm text-gray-400">
                  {token === "SOL" ? "Test SOL on devnet has no value. " : "Devnet USDC comes free from Circle's faucet (faucet.circle.com). "}Every provider your agent pays must take {token}.
                </p>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-semibold text-white">2. Who your agent may pay (up to {MAX_PROVIDERS})</legend>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {offer.providers.filter((p) => p.token === token).length === 0 ? (
                    <p className="text-sm text-gray-300" data-testid="budget-no-providers">No provider takes {token} Budgets yet. Pick the other token.</p>
                  ) : null}
                  {offer.providers.filter((p) => p.token === token).map((p) => {
                    const on = picked.includes(p.id);
                    return (
                      <label key={p.id} className={`flex items-start gap-3 rounded-2xl border p-4 ${on ? "border-brand-green bg-brand-green/10" : "border-white/10 bg-black/20"}`} data-testid={`budget-provider-${p.id}`}>
                        <input type="checkbox" className="mt-1" checked={on} disabled={!on && picked.length >= MAX_PROVIDERS} onChange={(e) => toggle(p.id, e.target.checked)} />
                        <span>
                          <span className="font-semibold text-white">{p.name}</span>
                          <span className="block text-sm text-gray-300">{p.tagline}</span>
                          <span className="mt-1 block text-xs text-gray-400">${p.pricing.inputPerMillionUsd} per million tokens in, ${p.pricing.outputPerMillionUsd} out</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <label className="block">
                <span className="text-sm font-semibold text-white">3. Where we tell you what it spends</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" className="mt-3 block w-full max-w-md rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white" data-testid="budget-email" />
                <span className="mt-2 block text-sm text-gray-400">An email each time a provider takes a share or posts what it is owed, with a link to dispute it.{offer?.emailConfirm ? " We send a link to this address first, and the Budget opens once you have opened it." : ""}</span>
              </label>

              <ul className="grid gap-3 text-sm leading-6 text-gray-200 sm:grid-cols-2 lg:grid-cols-4" data-testid="budget-terms">
                <li className={card}><span className="font-semibold text-white">Open 72 hours.</span> Close it any time; what nobody has taken comes straight back.</li>
                <li className={card}><span className="font-semibold text-white">Half each, at most.</span> No one provider can take more than half{units !== undefined ? <> ({amount(units / BigInt(2), t.decimals, token)})</> : null}.</li>
                <li className={card}><span className="font-semibold text-white">24 hours to check.</span> After it closes, each provider waits a day before it is paid, unless you approve sooner.</li>
                <li className={card}><span className="font-semibold text-white">{offer.judge ? "RAP judge." : "Only your providers."}</span> {offer.judge ? <>If you dispute a share, the RAP judge pays the provider only what its signed receipts for your agent&apos;s calls show. It checks the calls were served, not answer quality. <Link className="underline hover:text-white" href="/faq">How the judge decides</Link></> : "Only the providers you picked can take a share."}</li>
              </ul>

              <div className="flex flex-wrap items-center gap-4">
                <button type="button" onClick={open} disabled={busy !== null} className={primary} data-testid="budget-open">
                  {busy === "open" ? "Waiting for your wallet…" : "Open the Budget"}
                </button>
                <span className="text-sm text-gray-400">With your wallet set to Solana devnet, it signs twice: a message that lets the RAP relay spend for your agent, then the lock.</span>
              </div>
            </div>
          ) : null}
          <p className="mt-6 text-sm text-gray-400">
            No wallet yet? <Link className="underline hover:text-white" href="/sandbox?scenario=budget" data-testid="budget-preview">Preview a Budget without a wallet</Link> in the sandbox.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function BudgetDashboard(props: {
  view: View | null;
  gone: boolean;
  address: string;
  isPayer: boolean;
  busy: string | null;
  lastSignature: string | null;
  onAct: (action: "approve" | "dispute" | "close" | "payout", payee?: string) => void;
  onNew: () => void;
}) {
  const { view, gone, address, isPayer, busy, onAct } = props;
  if (gone) {
    return (
      <section className="rounded-3xl border border-white/10 bg-black/20 p-6" data-testid="budget-gone">
        <h2 className="font-display text-2xl font-bold text-white">This Budget is finished</h2>
        <p className="mt-2 text-gray-300">Every share has been paid out and the rest came back to the wallet that opened it. <a className="underline" href={explorerAddressUrl(address)} target="_blank" rel="noreferrer">See its history</a>.</p>
        <button type="button" onClick={props.onNew} className={`${primary} mt-5`}>Set a new budget</button>
      </section>
    );
  }
  if (!view) return <p className="text-gray-300">Reading the Budget from devnet…</p>;
  const units = (v: string) => amount(v, view.decimals, view.token);
  const shared = view.slices.reduce((sum, s) => sum + BigInt(s.reserved), BigInt(0));
  const owed = view.slices.reduce((sum, s) => sum + (s.state === "posted" || s.state === "disputed" || s.state === "paid" ? BigInt(s.posted) : BigInt(0)), BigInt(0));
  const withoutShare = view.providers.filter((p) => !view.slices.some((s) => s.payee === p.payee));
  const pct = (v: bigint) => (BigInt(view.total) === BigInt(0) ? 0 : Number((v * BigInt(1000)) / BigInt(view.total)) / 10);

  return (
    <section className="space-y-6 rounded-3xl border border-brand-green/25 bg-black/20 p-6 md:p-8" aria-labelledby="budget-view" data-testid="budget-view">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-label">{view.closed ? "Closed" : "Open"}</p>
          <h2 id="budget-view" className="mt-2 font-display text-3xl font-bold text-white">{units(view.total)} Budget</h2>
          <p className="mt-1 text-sm text-gray-400">
            <a className="underline" href={explorerAddressUrl(view.address)} target="_blank" rel="noreferrer">{shortAddress(view.address)}</a>
            {" · "}
            {view.closed ? <>closed {whenSlot(view.closedSlot, view.slot)}</> : <>closes by itself {whenSlot(view.openEndsSlot, view.slot)}</>}
          </p>
        </div>
        <button type="button" onClick={props.onNew} className={quiet}>Set a new budget</button>
      </div>

      <div>
        <div className="flex h-3 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className="bg-brand-green" style={{ width: `${pct(owed)}%` }} />
          <div className="bg-brand-green/40" style={{ width: `${pct(shared - owed > BigInt(0) ? shared - owed : BigInt(0))}%` }} />
        </div>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-gray-400">Owed to providers</dt><dd className="font-mono text-white" data-testid="budget-owed">{units(owed.toString())}</dd></div>
          <div><dt className="text-gray-400">Held in shares</dt><dd className="font-mono text-white">{units(shared.toString())}</dd></div>
          <div><dt className="text-gray-400">{view.closed ? "Came back to you" : "Not given out yet"}</dt><dd className="font-mono text-white" data-testid="budget-unreserved">{units(view.unreserved)}</dd></div>
        </dl>
      </div>

      {view.reviewFromOpenEnd ? (
        <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100" data-testid="budget-review-note">
          Your agent closed this Budget early. Each provider waits until the Budget&apos;s 72 hours are up before it is paid, unless you approve its share now.
        </p>
      ) : null}

      <div>
        <h3 className="font-display text-xl font-bold text-white">Providers</h3>
        {view.slices.length === 0 ? <p className="mt-2 text-sm text-gray-300">No provider has taken a share yet. A share appears here the moment your agent first calls a provider.</p> : null}
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {view.slices.map((s) => (
            <li key={s.payee} className={card} data-testid={`budget-slice-${s.provider?.id ?? s.payee}`} data-state={s.state}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{s.provider?.name ?? shortAddress(s.payee)}</p>
                  <p className="text-xs text-gray-400">{s.approved && s.state === "posted" ? "Approved by you: paid out next" : STATE_LABEL[s.state]}</p>
                </div>
                <p className="text-right font-mono text-sm text-white">
                  {s.state === "open" ? units(s.reserved) : units(s.posted)}
                  <span className="block text-xs text-gray-400">{s.state === "open" ? "share held" : `of ${units(s.reserved)} held`}</span>
                </p>
              </div>
              {s.disputeEndsSlot && (s.state === "posted" || s.state === "open") && !s.approved ? (
                <p className="mt-2 text-xs text-gray-400">Paid {whenSlot(s.disputeEndsSlot, view.slot)} unless you dispute it.</p>
              ) : null}
              {s.evidence ? <SliceEvidenceNote slice={s} units={units} /> : null}
              {s.judgeEndsSlot && s.state === "disputed" ? <p className="mt-2 text-xs text-gray-400">If the judge has not ruled {whenSlot(s.judgeEndsSlot, view.slot)}, the whole share comes back to you.</p> : null}
              {s.actions.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.actions.includes("approve") ? (
                    <button type="button" className={quiet} disabled={!isPayer || busy !== null} onClick={() => onAct("approve", s.payee)} data-testid="budget-approve">
                      {busy === `approve:${s.payee}` ? "Approving…" : "Approve and pay now"}
                    </button>
                  ) : null}
                  {s.actions.includes("dispute") ? (
                    <button type="button" className={quiet} disabled={!isPayer || busy !== null} onClick={() => onAct("dispute", s.payee)} data-testid="budget-dispute">
                      {busy === `dispute:${s.payee}` ? "Disputing…" : "Dispute"}
                    </button>
                  ) : null}
                  {s.actions.includes("payout") ? (
                    <button type="button" className={quiet} disabled={busy !== null} onClick={() => onAct("payout", s.payee)} data-testid="budget-payout">
                      {busy === `payout:${s.payee}` ? "Paying out…" : "Pay out"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {withoutShare.length > 0 ? (
          <p className="mt-3 text-sm text-gray-400">Also allowed: {withoutShare.map((p) => p.name ?? shortAddress(p.payee)).join(", ")}.</p>
        ) : null}
      </div>

      {view.canClose ? (
        <div className="flex flex-wrap items-center gap-4 border-t border-white/10 pt-5">
          <button type="button" className={primary} disabled={!isPayer || busy !== null} onClick={() => onAct("close")} data-testid="budget-close">
            {busy === "close:" ? "Closing…" : "Close early and get the rest back"}
          </button>
          <span className="text-sm text-gray-400">
            Your agent can&apos;t take new shares after this. What it has used is paid after the 24-hour check.
          </span>
        </div>
      ) : null}
      {!isPayer ? <p className="text-sm text-gray-400" data-testid="budget-connect-note">Connect the wallet that opened this Budget to approve, dispute or close it. Anyone can send a payout that is due.</p> : null}
      {props.lastSignature ? (
        <p className="text-sm text-gray-400">Done. <a className="underline" href={explorerTxUrl(props.lastSignature)} target="_blank" rel="noreferrer">See the transaction</a>.</p>
      ) : null}
    </section>
  );
}
