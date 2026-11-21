"use client";

import { useEffect, useState } from "react";

type AuditAttestation = {
  timestamp: string;
  job_id: string;
  operator_pubkey_suffix: string;
  tx_signature: string | null;
  explorer_url: string | null;
  local_only: boolean;
  wallet_address: string;
  endpoint_url: string;
};

type HeartbeatPoll = {
  polled_at: string;
  specialists_checked: number;
  results_summary: string;
};

export default function AuditPage() {
  const [tab, setTab] = useState<"attestations" | "heartbeat">("attestations");
  const [attestations, setAttestations] = useState<AuditAttestation[]>([]);
  const [heartbeatPolls, setHeartbeatPolls] = useState<HeartbeatPoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        const response = await fetch("/api/onboarding/audit");
        const payload = await response.json();

        if (!response.ok || payload.ok !== true) {
          throw new Error(payload.error || "Failed to load audit trail.");
        }

        if (!alive) return;
        setAttestations(payload.attestations ?? []);
        setHeartbeatPolls(payload.heartbeat_polls ?? []);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Failed to load audit trail.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="max-w-7xl mx-auto px-4 py-10 sm:px-6 lg:px-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Audit Trail</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Attestations and heartbeat checks in one place.
        </p>
      </div>

      <div className="flex gap-2 border-b border-white/10">
        {[
          { id: "attestations", label: "Attestations" },
          { id: "heartbeat", label: "Heartbeat Checks" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as typeof tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === item.id
                ? "border-brand-violet text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-muted-foreground">
          Loading audit trail…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
          {error}
        </div>
      ) : tab === "attestations" ? (
        attestations.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-muted-foreground">
            No attestation records yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Job ID</th>
                  <th className="px-4 py-3">Operator</th>
                  <th className="px-4 py-3">Tx Signature</th>
                  <th className="px-4 py-3">Local only</th>
                </tr>
              </thead>
              <tbody>
                {attestations.map((item) => (
                  <tr key={`${item.timestamp}-${item.job_id}`} className="border-t border-white/10">
                    <td className="px-4 py-3 font-mono text-xs">{item.timestamp}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.job_id}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.operator_pubkey_suffix}</td>
                    <td className="px-4 py-3 text-xs">
                      {item.tx_signature && item.explorer_url ? (
                        <a
                          href={item.explorer_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-green hover:underline"
                        >
                          {item.tx_signature}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">n/a</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="rounded-full bg-white/10 px-2 py-1">
                        {item.local_only ? "local" : "on-chain"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : heartbeatPolls.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-muted-foreground">
          No heartbeat checks yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Polled at</th>
                <th className="px-4 py-3">Specialists checked</th>
                <th className="px-4 py-3">Results summary</th>
              </tr>
            </thead>
            <tbody>
              {heartbeatPolls.map((item) => (
                <tr key={item.polled_at} className="border-t border-white/10">
                  <td className="px-4 py-3 font-mono text-xs">{item.polled_at}</td>
                  <td className="px-4 py-3 text-xs">{item.specialists_checked}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{item.results_summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
