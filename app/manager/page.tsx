"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type RoleStatus = "ready" | "action_needed";

type ManagerRole = {
  id: "specialist" | "attestor" | "consumer" | "manager";
  label: string;
  href: string;
  count: number;
  status: RoleStatus;
  nextAction: string;
  signals: string[];
};

type Readiness = {
  checkedAt: string;
  status: RoleStatus;
  highestPriorityAction: string;
  counts: {
    specialists: number;
    liveSpecialists: number;
    insecureOrUnhealthySpecialists: number;
    attestationRecords: number;
    onchainAttestations: number;
    consumers: number;
    operatorReady: boolean;
  };
  roles: ManagerRole[];
};

type EvidencePack = {
  generatedAt: string;
  status: "ready" | "incomplete";
  command: string;
  artifacts: Array<{
    id: string;
    label: string;
    path: string | null;
    status: "present" | "missing";
    summary: string;
  }>;
  privacy: { note: string; rawPromptsIncluded: false; secretsIncluded: false };
  nextAction: string;
};

export default function ManagerPage() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [evidence, setEvidence] = useState<EvidencePack | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/manager/readiness", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Readiness failed");
      setReadiness(data.result);
      const evidenceRes = await fetch("/api/manager/evidence", { cache: "no-store" });
      const evidenceData = await evidenceRes.json();
      if (evidenceData.ok) setEvidence(evidenceData.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load manager readiness");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.24em] text-[#14F195]">Agent Manager Operations</p>
        <h1 className="text-3xl font-bold">Marketplace readiness board</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          One human-facing launchpad for the four roles: Specialist, Attestor, Consumer, and Agent Manager. Use it to clear setup blockers before demos or live marketplace use.
        </p>
        <Link
          href="/manager/discovery"
          className="inline-flex rounded-lg border border-[#14F195]/40 bg-[#14F195]/10 px-3 py-2 text-sm font-medium text-[#14F195] hover:border-[#14F195]/70 hover:text-emerald-100"
        >
          Open static discovery review
        </Link>
      </header>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Highest priority next action</p>
            <p className="text-lg font-semibold text-white">
              {readiness?.highestPriorityAction ?? "Loading readiness…"}
            </p>
            {readiness?.checkedAt && (
              <p className="mt-1 text-xs text-muted-foreground">Checked {new Date(readiness.checkedAt).toLocaleString()}</p>
            )}
          </div>
          <Button onClick={() => void load()} variant="outline">Refresh readiness</Button>
        </div>

        {readiness && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Specialists" value={readiness.counts.specialists} detail={`${readiness.counts.liveSpecialists} live`} />
            <Stat label="Attestations" value={readiness.counts.attestationRecords} detail={`${readiness.counts.onchainAttestations} on-chain`} />
            <Stat label="Consumers" value={readiness.counts.consumers} detail="profiles" />
            <Stat label="Operator" value={readiness.counts.operatorReady ? "Ready" : "Needs key"} detail="attestor gate" />
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(readiness?.roles ?? fallbackRoles).map((role) => (
          <Link key={role.id} href={role.href} className="rounded-2xl border border-white/10 bg-card/20 p-5 transition-colors hover:border-[#9945FF]/50">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">{role.label}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{role.nextAction}</p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-xs ${role.status === "ready" ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>
                {role.status === "ready" ? "Ready" : "Action needed"}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {role.signals.map((signal) => (
                <span key={signal} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-muted-foreground">
                  {signal}
                </span>
              ))}
            </div>
            <p className="mt-5 text-sm text-[#14F195]">Open {role.label} path →</p>
          </Link>
        ))}
      </section>

      <section className="rounded-2xl border border-white/10 bg-card/20 p-5 space-y-3">
        <h2 className="text-lg font-semibold">BDD confidence</h2>
        <p className="text-sm text-muted-foreground">
          Manager confidence command: <code className="rounded bg-black/30 px-1.5 py-0.5">{evidence?.command ?? "npm run test:bdd:status && npm run test:bdd:sweep"}</code>.
        </p>
        {evidence && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">Evidence status: <span className={evidence.status === "ready" ? "text-green-300" : "text-amber-200"}>{evidence.status}</span></p>
              <p className="text-xs text-muted-foreground">Generated {new Date(evidence.generatedAt).toLocaleString()}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {evidence.artifacts.map((artifact) => (
                <div key={artifact.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{artifact.label}</p>
                    <span className={artifact.status === "present" ? "text-green-300" : "text-red-300"}>{artifact.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{artifact.summary}</p>
                  {artifact.path && (
                    artifact.path.startsWith("/") ? (
                      <Link href={artifact.path} className="mt-2 block font-mono text-xs text-[#14F195] hover:text-emerald-200">
                        {artifact.path} →
                      </Link>
                    ) : (
                      <p className="mt-2 font-mono text-xs text-[#14F195]">{artifact.path}</p>
                    )
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{evidence.privacy.note}</p>
            <p className="text-sm text-white">Next: {evidence.nextAction}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

const fallbackRoles: ManagerRole[] = [
  { id: "specialist", label: "Specialist", href: "/onboarding", count: 0, status: "action_needed", nextAction: "Register and verify the first specialist.", signals: ["runtime", "endpoint", "x402"] },
  { id: "attestor", label: "Attestor", href: "/attestation", count: 0, status: "action_needed", nextAction: "Configure attestation operator and submit first attestation.", signals: ["operator", "audit", "release gate"] },
  { id: "consumer", label: "Consumer", href: "/consumer", count: 0, status: "action_needed", nextAction: "Register a consumer profile and run paid invocation.", signals: ["policy", "payment", "feedback"] },
  { id: "manager", label: "Agent Manager", href: "/manager", count: 1, status: "action_needed", nextAction: "Clear role blockers and generate evidence.", signals: ["readiness", "recovery", "BDD"] },
];
