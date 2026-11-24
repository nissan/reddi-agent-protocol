"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { agentSetupTabs } from "@/lib/try/agent-setup";

const FALLBACK_ORIGIN = "https://app.agent-protocol.reddi.tech";
const noopSubscribe = () => () => {};

/** "Want your agent to do this next time?" with copy-paste setup for each kind of agent. */
export default function AgentHandoff({ heading = "Want your agent to do this next time?", afterTry = true }: { heading?: string; afterTry?: boolean }) {
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => FALLBACK_ORIGIN);
  const [active, setActive] = useState("prompt");
  const [copied, setCopied] = useState<string | null>(null);
  const tabs = agentSetupTabs(origin);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(tab.snippet);
      setCopied(tab.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section className="rounded-3xl border border-brand-green/25 bg-paper-raised p-6 md:p-8" data-testid="agent-handoff" aria-labelledby="agent-handoff-heading">
      <p className="section-label">Hand it to your agent</p>
      <h2 id="agent-handoff-heading" className="mt-2 font-display text-2xl font-bold text-white md:text-3xl">{heading}</h2>
      <p className="mt-3 max-w-3xl leading-7 text-gray-300">
        {afterTry ? "What you just did by hand is what your agent does on its own" : "Your agent follows the same steps a person takes on the try page"}: ask for a price, lock the most it can cost, get the answer,
        check the receipt. Give it the skill file below and a budget, and it follows those steps every time.
      </p>
      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Agent type">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab.id}
            onClick={() => setActive(t.id)}
            className={`rounded-full border px-4 py-1.5 text-sm ${t.id === tab.id ? "border-brand-green bg-brand-green/15 text-white" : "border-white/15 text-gray-300 hover:border-white/30"}`}
            data-testid={`agent-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm leading-6 text-gray-300">{tab.intro}</p>
      <div className="relative mt-3">
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/40 p-4 pr-20 font-mono text-sm leading-6 text-gray-100" data-testid="agent-snippet">{tab.snippet}</pre>
        <button type="button" onClick={copy} className="absolute right-3 top-3 rounded-lg border border-white/15 bg-black/50 px-3 py-1 text-xs text-gray-200 hover:border-white/30">
          {copied === tab.id ? "Copied" : "Copy"}
        </button>
      </div>
      <ul className="mt-5 grid gap-3 text-sm leading-6 text-gray-300 sm:grid-cols-3">
        <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">You set the budget.</span> The skill tells your agent to ask for a per-call and total limit, and to stop at it.</li>
        <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">Quote first.</span> Your agent shows you the price before its first paid call.</li>
        <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">No keypair to hand over.</span> <Link className="underline hover:text-white" href="/pass">Give your agent a pass</Link>: a budget you lock once in your own wallet, and a key it pays with.</li>
      </ul>
      <p className="mt-5 text-sm text-gray-400">
        Read the <a className="underline hover:text-white" href="/skill.md">skill file</a>
        {afterTry ? <>, or keep these steps on the <Link className="underline hover:text-white" href="/agent-setup">agent setup page</Link></> : null}.
      </p>
    </section>
  );
}
