"use client";

import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

type PaymentTx = { profileId: string; signature: string; solscan: string };
type RunResult = {
  replay?: boolean;
  source?: string;
  fallbackReason?: string;
  image: { imageUrl: string; provider: string; model: string; receipt: string };
  walletAuthorization?: { wallet: string; signature: string; message: string; boundary: string } | null;
  paidRun: { status: string; spentUsdc: string; orchestratorWallet: string | null };
  paymentTxs: PaymentTx[];
  perProof: { claim: string; teeRpcUrl: string; programId: string; solscan: Record<string, string> };
  torque: {
    score: {
      consumer: { wallet: string; before: number; after: number };
      agent: { wallet: string; before: number; after: number };
      note: string;
    };
  };
};

function short(value?: string | null) {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value;
}

export default function ZPictureDemoPage() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { connected, publicKey, signMessage } = useWallet();
  const prompt = "Generate a clean high-contrast square image showing one large capital letter Z, centered, bold, unmistakable, on a simple futuristic dark background.";

  async function run() {
    if (!connected || !publicKey) {
      setError("Connect the funded Phantom devnet wallet first.");
      return;
    }
    if (!signMessage) {
      setError("Connected wallet cannot sign authorization messages.");
      return;
    }
     setStatus("running");
    setError(null);
    setResult(null);
    const authorizationMessage = `Authorize Reddi Agent Protocol economic demo Z image call on Solana devnet for wallet ${publicKey.toBase58()} at ${new Date().toISOString()}`;
    let signature: string;
    try {
      const encoded = new TextEncoder().encode(authorizationMessage);
      const signed = await signMessage(encoded);
      signature = btoa(String.fromCharCode(...Array.from(signed)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      return;
    }
    try {
      const res = await fetch("/api/economic-demo/z-picture-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, walletAuthorization: { wallet: publicKey.toBase58(), signature, message: authorizationMessage } }) });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok || !data?.ok) throw new Error(data?.error || data?.fallbackReason || `z_picture_run_failed_${res.status}`);
      setResult(data);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  const txs = result?.paymentTxs ?? [];
  return (
    <main className="min-h-screen bg-page text-white">
      <section className="mx-auto max-w-7xl px-6 py-10">
        <p className="section-label">Economic demo · gated Z picture call</p>
        <h1 className="mt-3 max-w-5xl font-display text-4xl font-bold sm:text-5xl">Agent Protocol call → image evidence → payment-proof refs → bounded PER evidence → reputation inputs</h1>
        <p className="mt-4 max-w-4xl text-gray-300">Payments prove transfer; RAP Assurance proves paid work. This page is a gated devnet/demo surface: wallet authorization and any transfer references must stay bounded, and replay fallback does not imply production, custody, or mainnet readiness.</p>
        <div className="mt-6 rounded-2xl border border-white/10 bg-card/80 p-5">
          <p className="text-xs uppercase tracking-wide text-gray-500">1 · Select funded devnet wallet</p>
          <div className="mt-3 flex flex-wrap items-center gap-3"><WalletMultiButton /><span className="font-mono text-sm text-[#14F195]">{connected && publicKey ? publicKey.toBase58() : "No wallet connected"}</span></div>
          <p className="mt-2 text-xs text-gray-400">The wallet signature is recorded as client authorization for this browser-run demo. x402 transfer references remain bounded Solana devnet proof metadata.</p>
        </div>
        <div className="mt-6 rounded-2xl border border-[#14F195]/25 bg-[#14F195]/10 p-5">
          <p className="text-xs uppercase tracking-wide text-[#14F195]">2 · Prompt + execution</p>
          <p className="mt-2 text-lg">{prompt}</p>
          <button onClick={run} disabled={status === "running" || !connected} className="mt-5 rounded-xl bg-[#14F195] px-5 py-3 font-semibold text-black disabled:opacity-60">{status === "running" ? "Awaiting wallet / executing call…" : "Sign and execute Agent Protocol Z image call"}</button>
          {status === "error" && <p className="mt-3 text-red-300">{error}</p>}
        </div>

        {result && (
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            {result.replay && <section className="rounded-2xl border border-yellow-400/25 bg-yellow-400/10 p-5 lg:col-span-2"><p className="section-label">Replay fallback mode</p><h2 className="mt-2 text-2xl font-semibold">Signed interaction captured; replaying the completed devnet proof</h2><p className="mt-3 text-sm leading-6 text-yellow-50/90">The browser wallet signature was captured, but this deployment is replaying the frozen completed proof because the image/payment runner is not guaranteed inside Vercel serverless runtime. Fallback reason: <span className="font-mono">{result.fallbackReason}</span></p></section>}
            <section className="rounded-2xl border border-white/10 bg-card/80 p-5">
              <p className="section-label">Returned image proof</p>
              <h2 className="mt-2 text-2xl font-semibold">The generated image contains “Z”</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.image.imageUrl} alt="Generated proof image showing Z" className="mt-5 aspect-square w-full rounded-xl border border-white/10 object-contain bg-black" />
              <p className="mt-3 font-mono text-xs text-gray-400">{result.image.provider} · {result.image.model} · {result.image.receipt}</p>
            </section>

            <section className="rounded-2xl border border-white/10 bg-card/80 p-5">
              <p className="section-label">Wallet-authorized Agent Protocol run</p>
              <h2 className="mt-2 text-2xl font-semibold">Devnet x402 payment-proof references</h2>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3"><dt className="text-gray-500">Status</dt><dd className="mt-1 text-[#14F195]">{result.paidRun.status}</dd></div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3"><dt className="text-gray-500">Recorded spend</dt><dd className="mt-1 text-[#14F195]">{result.paidRun.spentUsdc} USDC</dd></div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3 sm:col-span-2"><dt className="text-gray-500">Connected Phantom wallet</dt><dd className="mt-1 break-all font-mono text-[#14F195]">{result.walletAuthorization?.wallet ?? publicKey?.toBase58()}</dd></div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3 sm:col-span-2"><dt className="text-gray-500">x402 payment signer</dt><dd className="mt-1 break-all font-mono text-[#14F195]">{result.paidRun.orchestratorWallet}</dd></div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3 sm:col-span-2"><dt className="text-gray-500">Wallet authorization signature</dt><dd className="mt-1 break-all font-mono text-xs text-[#14F195]">{short(result.walletAuthorization?.signature)}</dd></div>
              </dl>
              <div className="mt-4 space-y-2">
                {txs.map((tx: PaymentTx) => <a key={tx.signature} href={tx.solscan} target="_blank" className="block rounded-lg border border-[#14F195]/25 bg-[#14F195]/10 p-3 text-sm hover:bg-[#14F195]/15"><span className="text-gray-400">{tx.profileId}</span><br/><span className="font-mono text-[#14F195]">Solscan devnet: {short(tx.signature)}</span></a>)}
              </div>
            </section>

            <section className="rounded-2xl border border-accent-purple/25 bg-accent-purple/10 p-5">
              <p className="section-label">MagicBlock PER reference proof</p>
              <h2 className="mt-2 text-2xl font-semibold">Bounded execution-lane evidence</h2>
              <p className="mt-3 text-sm leading-6 text-gray-200">{result.perProof.claim}</p>
              <dl className="mt-4 grid gap-3 text-sm">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3"><dt className="text-gray-500">TEE RPC</dt><dd className="mt-1 font-mono text-accent-purple">{result.perProof.teeRpcUrl}</dd></div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3"><dt className="text-gray-500">Program</dt><dd className="mt-1 break-all font-mono text-accent-purple">{result.perProof.programId}</dd></div>
              </dl>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {Object.entries(result.perProof.solscan).map(([label, url]) => <a key={label} href={url as string} target="_blank" className="rounded-lg border border-accent-purple/30 bg-black/30 p-3 text-sm text-accent-purple hover:bg-accent-purple/15">{label} tx · {short((url as string).split('/tx/')[1]?.split('?')[0])}</a>)}
              </div>
            </section>

            <section className="rounded-2xl border border-yellow-400/25 bg-yellow-400/10 p-5">
              <p className="section-label">Torque reputation dashboard</p>
              <h2 className="mt-2 text-2xl font-semibold">Agent + consumer scores updated</h2>
              <div className="mt-4 grid gap-3">
                <div className="rounded-xl border border-white/10 bg-black/30 p-4"><p className="text-gray-400">Consumer</p><p className="mt-1 break-all font-mono text-white">{result.torque.score.consumer.wallet}</p><p className="mt-2 text-3xl font-bold text-yellow-100">{result.torque.score.consumer.before} → {result.torque.score.consumer.after}</p></div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-4"><p className="text-gray-400">Agent</p><p className="mt-1 break-all font-mono text-white">{result.torque.score.agent.wallet}</p><p className="mt-2 text-3xl font-bold text-yellow-100">{result.torque.score.agent.before} → {result.torque.score.agent.after}</p></div>
              </div>
              <p className="mt-3 text-xs leading-5 text-yellow-50/80">{result.torque.score.note}</p>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
