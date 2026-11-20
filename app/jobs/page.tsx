"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";

import { currentAccessToken, WalletSignIn } from "@/components/auth/WalletSignIn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatJobAmount, jobExplorerTxUrl, jobNetworkLabel, jobStatusLabel, shortAddress } from "@/lib/jobs/job-display";
import type { JobSummary } from "@/lib/jobs/job-store";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type View =
  | { state: "not_configured" }
  | { state: "signed_out" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; jobs: JobSummary[] };

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

const LOAD_FAILED = "Your jobs could not be loaded right now.";

/** Reads the signed-in user's jobs. Never throws; the result is the view to show. */
async function fetchJobs(): Promise<View> {
  if (!getBrowserSupabase()) return { state: "not_configured" };
  const token = await currentAccessToken().catch(() => undefined);
  if (!token) return { state: "signed_out" };
  try {
    const response = await fetch("/api/jobs", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; jobs?: JobSummary[]; error?: { message?: string } } | null;
    if (response.status === 401) return { state: "signed_out" };
    if (!response.ok || !body?.ok || !Array.isArray(body.jobs)) return { state: "error", message: body?.error?.message ?? LOAD_FAILED };
    return { state: "ready", jobs: body.jobs };
  } catch {
    return { state: "error", message: LOAD_FAILED };
  }
}

export default function MyJobsPage() {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58();
  const [view, setView] = useState<View>(() => (getBrowserSupabase() ? { state: "loading" } : { state: "not_configured" }));

  // Reload when the connected wallet or the sign-in state changes.
  useEffect(() => {
    let cancelled = false;
    const show = () => void fetchJobs().then((next) => (cancelled ? undefined : setView(next)));
    show();
    const subscription = getBrowserSupabase()?.auth.onAuthStateChange(show);
    return () => {
      cancelled = true;
      subscription?.data.subscription.unsubscribe();
    };
  }, [address]);

  function retry() {
    setView({ state: "loading" });
    void fetchJobs().then(setView);
  }

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader
          label="Account"
          title="My jobs"
          subtitle="Paid calls recorded for your wallet, as the buyer or as the provider. A job appears here only after the payment was checked on chain."
          actions={
            <Link href="/planner">
              <Button size="sm">New run</Button>
            </Link>
          }
        />

        {view.state === "not_configured" ? (
          <Card className="p-6 text-sm text-gray-300" data-testid="jobs-not-configured">
            Saved jobs are not switched on for this deployment yet. Runs made here still appear in{" "}
            <Link href="/runs" className="text-indigo-300 hover:text-indigo-200">
              run history
            </Link>
            .
          </Card>
        ) : null}

        {view.state === "signed_out" ? (
          <Card className="space-y-4 p-6 text-sm text-gray-300" data-testid="jobs-signed-out">
            <p>Connect your wallet and sign in to see your jobs. Signing in asks your wallet to sign a message. It does not move funds.</p>
            <WalletSignIn />
          </Card>
        ) : null}

        {view.state === "loading" ? (
          <div className="space-y-4" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-surface glow-border" />
            ))}
          </div>
        ) : null}

        {view.state === "error" ? (
          <Card className="space-y-3 p-6 text-sm text-gray-300" role="alert">
            <p>{view.message}</p>
            <Button size="sm" variant="outline" onClick={retry}>
              Try again
            </Button>
          </Card>
        ) : null}

        {view.state === "ready" && view.jobs.length === 0 ? (
          <Card className="p-6 text-sm text-gray-300" data-testid="jobs-empty">
            No jobs yet. A job is saved when you pay a specialist from your wallet in the planner while signed in.
          </Card>
        ) : null}

        {view.state === "ready" && view.jobs.length > 0 ? (
          <ul className="space-y-4" data-testid="jobs-list">
            {view.jobs.map((job) => {
              const explorer = jobExplorerTxUrl(job.txSignature, job.network);
              const mine = address && job.providerWallet === address;
              return (
                <li key={job.id}>
                  <Card className="space-y-2 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium text-white">{job.declaredModel || "Model not stated"}</h2>
                      <Badge variant="outline" className={job.status === "delivered" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}>
                        {jobStatusLabel(job.status)}
                      </Badge>
                      <Badge variant="outline" className="border-white/10 bg-white/5 text-gray-300">
                        {jobNetworkLabel(job.network)}
                      </Badge>
                      <Badge variant="outline" className="border-white/10 bg-white/5 text-gray-300">
                        {mine ? "You were paid" : "You paid"}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-300">
                      {formatJobAmount(job.amountBaseUnits, job.mint, job.network)} to <span className="font-mono">{shortAddress(job.providerWallet)}</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      {when(job.createdAt)}
                      {explorer ? (
                        <>
                          {" · "}
                          <a href={explorer} target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-indigo-200">
                            View payment
                          </a>
                        </>
                      ) : null}
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
