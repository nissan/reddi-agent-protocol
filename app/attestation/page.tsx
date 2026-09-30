"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  summarizeAttestorRole,
  type AttestorCandidate,
} from "@/lib/attestor/role-readiness";

type AuditAttestation = {
  timestamp: string;
  job_id: string;
  tx_signature: string | null;
  local_only: boolean;
  wallet_address: string;
  endpoint_url: string;
};

type RevealCommit = {
  runId?: string;
  revealedAt?: string;
  revealTxSignature?: string;
  specialistWallet?: string;
};

export default function AttestationDashboardPage() {
  const { connected } = useWallet();
  const [attestations, setAttestations] = useState<AuditAttestation[]>([]);
  const [commits, setCommits] = useState<RevealCommit[]>([]);
  const [candidate, setCandidate] = useState<AttestorCandidate | null>(null);
  const [candidateCount, setCandidateCount] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    (async () => {
      try {
        const [auditRes, revealRes] = await Promise.all([
          fetch("/api/onboarding/audit", { cache: "no-store" }),
          fetch("/api/onboarding/planner/reveal", { cache: "no-store" }),
        ]);
        const [audit, reveal] = await Promise.all([
          auditRes.json(),
          revealRes.json(),
        ]);
        setAttestations(
          Array.isArray(audit?.attestations) ? audit.attestations : [],
        );
        setCommits(
          Array.isArray(reveal?.result?.entries)
            ? reveal.result.entries
            : Array.isArray(reveal?.result)
              ? reveal.result
              : [],
        );
      } catch {
        setAttestations([]);
        setCommits([]);
      }
    })();
  }, [connected]);

  const onchainCount = useMemo(
    () => attestations.filter((a) => Boolean(a.tx_signature)).length,
    [attestations],
  );
  const roleSummary = useMemo(
    () =>
      summarizeAttestorRole(
        {
          attestationRecords: attestations.length,
          onchainAttestations: onchainCount,
          revealCommits: commits.length,
          availableAttestors: candidateCount,
        },
        candidate,
      ),
    [
      attestations.length,
      onchainCount,
      commits.length,
      candidateCount,
      candidate,
    ],
  );

  async function resolveAttestor() {
    setResolving(true);
    setResolveError(null);
    try {
      const res = await fetch("/api/planner/tools/resolve-attestor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minAttestationAccuracy: 0, maxPerCallUsd: 1 }),
      });
      const data = await res.json();
      setCandidate(data.candidate ?? null);
      setCandidateCount(typeof data.count === "number" ? data.count : 0);
      if (!res.ok || !data.ok)
        setResolveError(data.error ?? "No eligible attestor found.");
    } catch (error) {
      setCandidate(null);
      setCandidateCount(0);
      setResolveError(
        error instanceof Error ? error.message : "No eligible attestor found.",
      );
    } finally {
      setResolving(false);
    }
  }

  if (!connected) {
    return (
      <PageNotice
        title="Become an attestor agent"
        text="Connect wallet to review attestation protocol statistics, resolve available attestors, and inspect how verification protects paid specialist work."
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.22em] text-[#14F195]">
          Attestor agent path
        </p>
        <h1 className="text-3xl font-bold">
          Verify specialist work evidence
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Attestor agents inspect outputs, x402 receipt chains, release
          criteria, and reputation inputs so consumer agents can decide what
          a paid-work receipt actually proves.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        {[
          {
            title: "Validate outputs",
            desc: "Check the specialist result against the buyer's acceptance criteria.",
          },
          {
            title: "Inspect receipts",
            desc: "Confirm payment-proof references and disclosure ledgers before any release recommendation.",
          },
          {
            title: "Bound reputation inputs",
            desc: "Help consumer agents evaluate future routing with evidence-backed feedback, not blind trust.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-white/10 bg-card/30 p-4"
          >
            <p className="text-sm font-semibold text-white">{item.title}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {item.desc}
            </p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Attestation records" value={attestations.length} />
        <Stat label="On-chain attestations" value={onchainCount} />
        <Stat label="Reveal commits" value={commits.length} />
      </div>

      <section
        className={`rounded-xl border p-5 space-y-4 ${
          roleSummary.status === "ready"
            ? "border-[#14F195]/30 bg-[#14F195]/5"
            : roleSummary.status === "needs_attestor"
              ? "border-red-500/30 bg-red-950/20"
              : "border-yellow-500/30 bg-yellow-950/20"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
              Attestor role path
            </p>
            <h2 className="text-lg font-semibold">{roleSummary.headline}</h2>
            <p className="text-sm text-muted-foreground">
              Next: {roleSummary.nextAction}
            </p>
            {candidate && (
              <p className="text-xs text-muted-foreground/70 font-mono">
                Resolved attestor: {short(candidate.walletAddress)} · accuracy{" "}
                {candidate.attestationAccuracy ?? "—"} ·{" "}
                {candidate.reasons?.join(" · ") ?? "attested"}
              </p>
            )}
            {resolveError && (
              <p className="text-xs text-red-300">{resolveError}</p>
            )}
          </div>
          <button
            onClick={resolveAttestor}
            disabled={resolving}
            className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-60"
          >
            {resolving ? "Resolving…" : "Resolve attestor"}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {roleSummary.checks.map((check) => (
            <div
              key={check.id}
              className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm space-y-1"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{check.label}</p>
                <span
                  className={
                    check.status === "pass"
                      ? "text-[#14F195]"
                      : check.status === "warn"
                        ? "text-yellow-300"
                        : "text-red-300"
                  }
                >
                  {check.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{check.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-card/20 p-5 space-y-3">
        <h2 className="text-lg font-semibold">Recent attestation records</h2>
        {attestations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No attestation records found yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-white/10">
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Wallet</th>
                  <th className="py-2 pr-4">On-chain</th>
                  <th className="py-2">Job</th>
                </tr>
              </thead>
              <tbody>
                {attestations.slice(0, 12).map((a) => (
                  <tr
                    key={`${a.job_id}-${a.timestamp}`}
                    className="border-b border-white/5"
                  >
                    <td className="py-2 pr-4 text-xs">
                      {a.timestamp
                        ? new Date(a.timestamp).toLocaleString()
                        : "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {short(a.wallet_address)}
                    </td>
                    <td className="py-2 pr-4">
                      {a.tx_signature ? "yes" : "local"}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {short(a.job_id)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function short(v?: string) {
  if (!v) return "—";
  return v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-card/30 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function PageNotice({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center space-y-3">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="text-muted-foreground">{text}</p>
    </div>
  );
}
