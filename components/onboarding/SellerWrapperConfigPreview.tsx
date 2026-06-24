"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type RailState =
  | "local-dry-run"
  | "devnet-gated"
  | "proof-metadata-only"
  | "live-gated"
  | "custody-supported"
  | "unsupported"
  | "live-payment-approved";

type SellerWrapperRail = {
  id: string;
  asset: "SOL" | "USDC" | "AUDD";
  network: string;
  fixtureState: string;
  runtimeState: RailState;
  amountUnits: string;
  payee: string;
  settlementAccount?: string;
  evidenceRequired: boolean;
  approvalRequired: boolean;
  livePaymentApproved: boolean;
  custodySupported: boolean;
  quote: {
    amount: string;
    expiresAt?: string;
    paymentMode: "dry-run" | "live";
  };
  audd?: {
    mint: string;
    failurePolicy: { mode: string; description: string };
    refundPolicy: { mode: string; description: string };
  };
  notes: string[];
};

type SellerWrapperEndpoint = {
  kind: "mcp" | "http-openapi";
  endpointId: string;
  displayName: string;
  transport: { url: string; auth: "none" };
  wrapper: {
    quoteRoute: string;
    policyPreflightRoute: string;
    invocationRoute: string;
    receiptHook: string;
    evidenceHook: string;
  };
  rails: SellerWrapperRail[];
};

type SellerWrapperPayload = {
  schemaVersion: string;
  mode: string;
  config: {
    schemaVersion: string;
    generatedMode: string;
    endpoints: SellerWrapperEndpoint[];
    guardrails: Record<string, boolean>;
  };
  validation: {
    valid: boolean;
    reasonCodes: string[];
    auditNotes: string[];
  };
  boundaries: Record<string, boolean>;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: SellerWrapperPayload };

const RAIL_COPY: Record<SellerWrapperRail["asset"], string> = {
  SOL: "Program-gated Solana rail",
  USDC: "Dry-run receipt rail",
  AUDD: "Payment-plan proof rail",
};

const STATE_COPY: Record<RailState, string> = {
  "local-dry-run": "Local dry-run",
  "devnet-gated": "Devnet gated",
  "proof-metadata-only": "Proof metadata",
  "live-gated": "Live gated",
  "custody-supported": "Custody supported",
  unsupported: "Unsupported",
  "live-payment-approved": "Live approved",
};

function stateVariant(state: RailState) {
  if (state === "proof-metadata-only" || state === "local-dry-run") return "secondary" as const;
  if (state === "devnet-gated" || state === "live-gated") return "outline" as const;
  return "destructive" as const;
}

function formatTransport(kind: SellerWrapperEndpoint["kind"]) {
  return kind === "mcp" ? "MCP" : "HTTP/OpenAPI";
}

function routeList(endpoint: SellerWrapperEndpoint) {
  return [
    ["quote", endpoint.wrapper.quoteRoute],
    ["policy", endpoint.wrapper.policyPreflightRoute],
    ["invoke", endpoint.wrapper.invocationRoute],
    ["receipt", endpoint.wrapper.receiptHook],
    ["evidence", endpoint.wrapper.evidenceHook],
  ] as const;
}

function truncateAddress(value: string) {
  if (value.length <= 28) return value;
  return `${value.slice(0, 18)}...${value.slice(-8)}`;
}

function PreviewSkeleton() {
  return (
    <Card size="sm" aria-busy="true">
      <CardHeader>
        <div className="h-5 w-52 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-md animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="h-4 w-20 animate-pulse rounded bg-muted-foreground/20" />
            <div className="mt-3 h-3 w-full animate-pulse rounded bg-muted-foreground/20" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted-foreground/20" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card size="sm" className="border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
          Seller-wrapper config unavailable
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>No wrapper endpoints returned</CardTitle>
        <CardDescription>
          The onboarding API responded, but no seller-wrapper endpoint configs were available.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

export function SellerWrapperConfigPreview() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/onboarding/seller-wrapper-config", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body?.ok || !body.result) {
        throw new Error(body?.error || "Seller-wrapper config request failed.");
      }
      setState({ status: "ready", payload: body.result });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Seller-wrapper config request failed.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copiedJson = useMemo(() => {
    if (state.status !== "ready") return "";
    return JSON.stringify(state.payload.config, null, 2);
  }, [state]);

  async function copyConfig() {
    if (!copiedJson) return;
    try {
      await navigator.clipboard.writeText(copiedJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (state.status === "loading") return <PreviewSkeleton />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={load} />;

  const { payload } = state;
  const endpoints = payload.config.endpoints;
  const allRailMap = new Map<string, SellerWrapperRail>();
  for (const endpoint of endpoints) {
    for (const rail of endpoint.rails) {
      allRailMap.set(`${rail.id}:${rail.network}`, rail);
    }
  }
  const allRails = Array.from(allRailMap.values());
  const boundaryDenied = Object.entries(payload.boundaries).filter(([, allowed]) => allowed === false);

  if (!endpoints.length) return <EmptyState />;

  return (
    <section className="space-y-4" aria-labelledby="seller-wrapper-config-heading">
      <Card size="sm">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 id="seller-wrapper-config-heading" className="flex items-center gap-2 font-display text-base leading-snug font-semibold">
                <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
                Seller-wrapper config preview
              </h2>
              <CardDescription>
                Onboarding preview for MCP and HTTP/OpenAPI wrapper configs. This panel reads a local API preview only.
              </CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={copyConfig} className="w-full sm:w-auto">
              {copied ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {copied ? "Copied config" : "Copy config JSON"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {allRails.map((rail) => (
              <article key={`${rail.id}:${rail.network}`} className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{rail.asset}</h3>
                    <p className="text-xs text-muted-foreground">{RAIL_COPY[rail.asset]}</p>
                  </div>
                  <Badge variant={stateVariant(rail.runtimeState)}>{STATE_COPY[rail.runtimeState]}</Badge>
                </div>
                <dl className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Network</dt>
                    <dd className="font-mono tabular-nums">{rail.network}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Payment mode</dt>
                    <dd className="font-mono tabular-nums">{rail.quote.paymentMode}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="font-mono tabular-nums">
                      {rail.quote.amount} {rail.amountUnits}
                    </dd>
                  </div>
                </dl>
                {rail.audd && (
                  <div className="mt-3 rounded-md border border-border bg-background/60 p-2 text-xs">
                    <p className="font-medium">AUDD proof metadata</p>
                    <p className="mt-1 font-mono text-muted-foreground break-all">{truncateAddress(rail.audd.mint)}</p>
                    <p className="mt-2 text-muted-foreground">{rail.audd.failurePolicy.description}</p>
                    <p className="mt-1 text-muted-foreground">{rail.audd.refundPolicy.description}</p>
                  </div>
                )}
              </article>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {endpoints.map((endpoint) => (
              <div key={endpoint.endpointId} className="rounded-lg border border-border bg-background/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{formatTransport(endpoint.kind)}</Badge>
                  <h3 className="text-sm font-semibold">{endpoint.displayName}</h3>
                </div>
                <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{endpoint.transport.url}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {routeList(endpoint).map(([label, route]) => (
                    <div key={label} className="rounded-md border border-border bg-muted/20 p-2">
                      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
                      <p className="mt-1 break-all font-mono text-xs">{route}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={payload.validation.valid ? "secondary" : "destructive"}>
                {payload.validation.valid ? "Validation pass" : "Validation fail"}
              </Badge>
              <Badge variant="outline">{payload.mode}</Badge>
              <Badge variant="outline">{payload.config.generatedMode}</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              {boundaryDenied.map(([name]) => (
                <div key={name} className="flex items-center gap-2 rounded-md border border-border bg-background/60 p-2">
                  <CheckCircle2 className="size-3.5 text-primary" aria-hidden="true" />
                  <span>{name.replace(/([A-Z])/g, " $1").toLowerCase()} disabled</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              AUDD is shown beside SOL and USDC as payment-plan/proof metadata for v0.1. This preview does not
              approve wallet signing, RPC calls, provider invocation, live payment, custody expansion, hosted writes,
              or settlement-finality claims.
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
