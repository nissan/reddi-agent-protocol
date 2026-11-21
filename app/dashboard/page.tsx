"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

type HubStats = {
  specialists: number;
  consumerProfiles: number;
  attestationRecords: number;
};

export default function DashboardHubPage() {
  const { connected, publicKey } = useWallet();
  const [stats, setStats] = useState<HubStats>({ specialists: 0, consumerProfiles: 0, attestationRecords: 0 });

  useEffect(() => {
    (async () => {
      try {
        const [specRes, consumerRes, auditRes] = await Promise.all([
          fetch("/api/onboarding/capabilities", { cache: "no-store" }),
          fetch("/api/onboarding/consumers", { cache: "no-store" }),
          fetch("/api/onboarding/audit", { cache: "no-store" }),
        ]);

        const [spec, consumers, audit] = await Promise.all([specRes.json(), consumerRes.json(), auditRes.json()]);
        setStats({
          specialists: Array.isArray(spec?.result?.results) ? spec.result.results.length : 0,
          consumerProfiles: Array.isArray(consumers?.result?.results) ? consumers.result.results.length : 0,
          attestationRecords: Array.isArray(audit?.attestations) ? audit.attestations.length : 0,
        });
      } catch {
        // no-op: hub still renders links
      }
    })();
  }, []);

  if (!connected) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center space-y-5">
        <h1 className="text-3xl font-bold">Role Dashboards</h1>
        <p className="text-muted-foreground">Connect your wallet to access specialist, attestation, and consumer dashboard views.</p>
        <WalletMultiButton
          style={{
            background: "var(--color-ink)",
            color: "var(--color-paper)",
            height: "44px",
            fontSize: "15px",
            borderRadius: "8px",
            margin: "0 auto",
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Protocol Dashboards</h1>
        <p className="text-sm text-muted-foreground">
          Wallet: <span className="font-mono">{publicKey?.toBase58()}</span>
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Specialists in index" value={stats.specialists} />
        <StatCard label="Consumer profiles" value={stats.consumerProfiles} />
        <StatCard label="Attestation records" value={stats.attestationRecords} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <RoleCard
          title="Specialist Owner"
          desc="Track capability, health, attestation, and routing signals for your specialist wallet."
          href="/specialist"
        />
        <RoleCard
          title="Attestation Owner"
          desc="Review attestation events, reveal flow state, and audit-oriented judging telemetry."
          href="/attestation"
        />
        <RoleCard
          title="Consumer Owner"
          desc="Review consumer profile, planner run outcomes, and feedback activity on protocol paths."
          href="/consumer"
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-card/30 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function RoleCard({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <Link href={href} className="rounded-xl border border-white/10 bg-card/20 p-5 hover:border-brand-violet/40 transition-colors">
      <p className="text-lg font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground mt-2">{desc}</p>
      <p className="text-sm mt-4 text-brand-green">Open dashboard →</p>
    </Link>
  );
}
