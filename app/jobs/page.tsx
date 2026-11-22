"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";

import { currentAccessToken, WalletSignIn } from "@/components/auth/WalletSignIn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { JobsExample } from "@/components/jobs/JobsExample";
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
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-14 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="section-label mb-3">My jobs</p>
            <h1 className="text-4xl leading-[1.05] sm:text-5xl">Every call you paid for, with its receipt.</h1>
            <p className="mt-3 text-lg leading-relaxed text-ink-muted">
              Paid calls recorded for your wallet, as the buyer or as the provider. A job appears here
              only after the payment was checked on chain.
            </p>
          </div>
          <Link
            href="/planner"
            className="rounded border-2 border-ink px-4 py-2.5 text-sm font-bold text-ink no-underline hover:bg-ink hover:text-paper"
          >
            New run
          </Link>
        </div>

        {view.state === "not_configured" ? (
          <div className="rounded-md border border-line-strong bg-paper-raised p-5 text-[15px] text-ink" data-testid="jobs-not-configured">
            <p>
              Saved jobs are not switched on for this deployment yet. Runs made here still appear in{" "}
              <Link href="/runs" className="font-semibold text-ink underline underline-offset-4">
                run history
              </Link>
              .
            </p>
          </div>
        ) : null}

        {view.state === "signed_out" ? (
          <div className="space-y-4 rounded-md border border-line-strong bg-paper-raised p-5 text-[15px] text-ink" data-testid="jobs-signed-out">
            <p>Connect your wallet and sign in to see your jobs. Signing in asks your wallet to sign a message. It does not move funds.</p>
            <WalletSignIn />
          </div>
        ) : null}

        {view.state === "not_configured" || view.state === "signed_out" ? <JobsExample /> : null}

        {view.state === "loading" ? (
          <div className="space-y-4" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-md border border-line bg-paper-raised" />
            ))}
          </div>
        ) : null}

        {view.state === "error" ? (
          <div className="space-y-3 rounded-md border border-line-strong bg-paper-raised p-5 text-[15px] text-ink" role="alert">
            <p>{view.message}</p>
            <Button size="sm" variant="outline" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : null}

        {view.state === "ready" && view.jobs.length === 0 ? (
          <div className="rounded-md border border-line bg-paper-raised p-5 text-[15px] text-ink-muted" data-testid="jobs-empty">
            No jobs yet. A job is saved when you pay a provider from your wallet in the planner while signed in.
          </div>
        ) : null}

        {view.state === "ready" && view.jobs.length > 0 ? (
          <ul className="space-y-4" data-testid="jobs-list">
            {view.jobs.map((job) => {
              const explorer = jobExplorerTxUrl(job.txSignature, job.network);
              const mine = address && job.providerWallet === address;
              return (
                <li key={job.id}>
                  <div className="space-y-2 rounded-md border border-line bg-paper-raised p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-ink">{job.declaredModel || "Model not stated"}</h2>
                      <Badge variant="outline" className={job.status === "delivered" ? "border-brand-green text-brand-green" : "border-line-strong text-ink"}>
                        {jobStatusLabel(job.status)}
                      </Badge>
                      <Badge variant="outline" className="border-line text-ink-muted">
                        {jobNetworkLabel(job.network)}
                      </Badge>
                      <Badge variant="outline" className="border-line text-ink-muted">
                        {mine ? "You were paid" : "You paid"}
                      </Badge>
                    </div>
                    <p className="text-sm text-ink">
                      {formatJobAmount(job.amountBaseUnits, job.mint, job.network)} to <span className="font-mono">{shortAddress(job.providerWallet)}</span>
                    </p>
                    <p className="text-xs text-ink-muted">
                      {when(job.createdAt)}
                      {explorer ? (
                        <>
                          {" · "}
                          <a href={explorer} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-violet underline underline-offset-4">
                            View payment
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
