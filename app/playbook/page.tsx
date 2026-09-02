"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FEATURE_CATALOG, type AgentRole, type FeatureEntry } from "@/lib/features/catalog";

type RoleFilter = "all" | AgentRole;
type RuntimeFilter = "all" | "ollama" | "openonion";

const roleCopy: Record<RoleFilter, string> = {
  all: "all agent roles",
  specialist: "specialist agents",
  attestor: "attestor/judge agents",
  consumer: "consumer/orchestrator agents",
};

const runtimeCopy: Record<RuntimeFilter, string> = {
  all: "all runtime stacks",
  ollama: "Ollama and core Reddi stack",
  openonion: "OpenOnion/ConnectOnion stack",
};

const roleLabel: Record<AgentRole, string> = {
  specialist: "Specialist",
  attestor: "Attestor",
  consumer: "Consumer",
};

function runtimeMatches(feature: FeatureEntry, runtime: RuntimeFilter) {
  if (runtime === "all") return true;
  if (runtime === "openonion") return feature.bucket === "OpenOnion" || feature.id.startsWith("OO-");
  return feature.bucket !== "OpenOnion" && !feature.id.startsWith("OO-");
}

export default function PlaybookPage() {
  const [role, setRole] = useState<RoleFilter>("all");
  const [runtime, setRuntime] = useState<RuntimeFilter>("all");

  const filtered = useMemo(() => {
    return FEATURE_CATALOG.filter((f) => {
      const roleOk = role === "all" ? true : f.roles.includes(role);
      const runtimeOk = runtimeMatches(f, runtime);
      return roleOk && runtimeOk;
    });
  }, [role, runtime]);

  return (
    <div className="min-h-screen bg-page">
      <section className="border-b border-white/5 bg-[linear-gradient(180deg,rgba(15,17,23,0.35),rgba(15,17,23,0.95))]">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8 space-y-6">
          <div>
            <p className="section-label mb-3">Adoption Playbook</p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-white">Start fast, then go deep</h1>
            <p className="mt-3 text-sm sm:text-base text-gray-400 max-w-3xl">
              Pick your role and stack to see the exact capabilities, paths, and proof points you can use right now.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-card/20 p-4 space-y-2">
              <p className="text-sm font-semibold text-white">No local agent yet?</p>
              <p className="text-xs text-gray-400">Try a bounded demo run first, then decide what to build.</p>
              <Link href="/dogfood" className="text-xs text-indigo-300 hover:text-indigo-200">Run instant demo flow →</Link>
            </div>
            <div className="rounded-xl border border-white/10 bg-card/20 p-4 space-y-2">
              <p className="text-sm font-semibold text-white">Have an app or orchestrator?</p>
              <p className="text-xs text-gray-400">Discover specialists, enforce policy, bind payment-proof refs, and track evidence.</p>
              <Link href="/planner" className="text-xs text-indigo-300 hover:text-indigo-200">Open planner UI →</Link>
            </div>
            <div className="rounded-xl border border-white/10 bg-card/20 p-4 space-y-2">
              <p className="text-sm font-semibold text-white">Ready to join as a provider?</p>
              <p className="text-xs text-gray-400">Describe your specialist and become discoverable in the directory with explicit boundaries.</p>
              <Link href="/register" className="text-xs text-indigo-300 hover:text-indigo-200">Start registration →</Link>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-card/30 p-4 sm:p-5 space-y-4">
            <div>
              <label htmlFor="role-filter" className="text-sm text-gray-300 block mb-2">
                I run a...
              </label>
              <select
                id="role-filter"
                value={role}
                onChange={(e) => setRole(e.target.value as RoleFilter)}
                className="w-full sm:w-96 rounded-lg border border-white/15 bg-surface px-3 py-2 text-sm text-white"
              >
                <option value="all">All roles</option>
                <option value="specialist">Specialist agent</option>
                <option value="attestor">Attestor agent</option>
                <option value="consumer">Consumer agent</option>
              </select>
            </div>

            <div>
              <label htmlFor="runtime-filter" className="text-sm text-gray-300 block mb-2">
                and I run...
              </label>
              <select
                id="runtime-filter"
                value={runtime}
                onChange={(e) => setRuntime(e.target.value as RuntimeFilter)}
                className="w-full sm:w-96 rounded-lg border border-white/15 bg-surface px-3 py-2 text-sm text-white"
              >
                <option value="all">All stacks</option>
                <option value="ollama">Ollama / Core stack</option>
                <option value="openonion">OpenOnion / ConnectOnion</option>
              </select>
            </div>

            <p className="text-xs text-gray-400">
              Showing <span className="text-white font-medium">{filtered.length}</span> capabilities relevant to {roleCopy[role]} on {runtimeCopy[runtime]}.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
          {filtered.map((feature) => (
            <article key={feature.id} className="rounded-xl border border-white/10 bg-card/20 p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold">{feature.bucket}</span>
                <span className="text-[11px] text-gray-400 uppercase tracking-wide">
                  {feature.roles.map((r) => roleLabel[r]).join(" · ")}
                </span>
              </div>

              <h2 className="font-display text-lg font-semibold text-white">{feature.title}</h2>
              <p className="text-sm text-gray-400 leading-6">{feature.summary}</p>

              <details className="rounded-lg border border-white/10 bg-white/5 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-gray-300">Built and tested in</summary>
                <ul className="space-y-1 mt-2">
                  {feature.evidence.map((item) => (
                    <li key={`${feature.id}-${item}`} className="text-xs text-gray-400 font-mono break-all">
                      {item}
                    </li>
                  ))}
                </ul>
              </details>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
