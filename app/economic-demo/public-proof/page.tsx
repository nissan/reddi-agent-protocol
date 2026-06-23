import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";

import {
  getPaidWorkflowProofUiFixturePack,
  type PaidWorkflowProofUiCaseFixture,
  type PaidWorkflowProofUiSectionFixture,
} from "@/lib/economic-demo/paid-workflow-proof-ui-fixtures";
import { getPublicProofPageData } from "@/lib/economic-demo/public-proof-page-data";

export const metadata: Metadata = {
  title: "Public Proof Demo",
  description:
    "Read-only public proof rendering for Reddi Agent Protocol economic demo receipts, evidence, attestation, and blocked states.",
};

const flowOrder = [
  "quote",
  "budget_ledger",
  "result",
  "receipt",
  "evidence",
  "attestation_preview",
  "reputation_preview",
] as const;

const sectionShortLabels: Record<PaidWorkflowProofUiSectionFixture["key"], string> = {
  quote: "Quote",
  budget_ledger: "Ledger",
  result: "Result",
  receipt: "Receipt",
  evidence: "Evidence",
  attestation_preview: "Attestation",
  reputation_preview: "Reputation",
};

const stateStyles: Record<PaidWorkflowProofUiSectionFixture["state"], string> = {
  ready: "border-accent-green/40 bg-accent-green/10 text-accent-green",
  planned: "border-primary/40 bg-primary/10 text-primary",
  draft: "border-muted-foreground/40 bg-muted/50 text-muted-foreground",
  binding_ready: "border-accent-green/40 bg-accent-green/10 text-accent-green",
  blocked: "border-destructive/50 bg-destructive/10 text-red-200",
  live_gated: "border-accent-orange/50 bg-accent-orange/10 text-orange-200",
  production_live_disabled: "border-accent-orange/50 bg-accent-orange/10 text-orange-200",
};

function formatFlagLabel(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function formatStateLabel(label: string) {
  return label.replaceAll("_", " ");
}

function compactRef(value: string) {
  if (value.length <= 44) return value;
  return `${value.slice(0, 18)}...${value.slice(-14)}`;
}

function caseTitle(item: PaidWorkflowProofUiCaseFixture) {
  return item.sourceCase.replaceAll("_", " ");
}

function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "success" | "warning" | "danger" | "neutral";
}) {
  const toneClass =
    tone === "success"
      ? "border-accent-green/40 bg-accent-green/10 text-accent-green"
      : tone === "warning"
        ? "border-accent-orange/50 bg-accent-orange/10 text-orange-200"
        : tone === "danger"
          ? "border-destructive/50 bg-destructive/10 text-red-200"
          : "border-border bg-muted/40 text-muted-foreground";

  return (
    <span className={`inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function SectionPanel({ section }: { section: PaidWorkflowProofUiSectionFixture }) {
  return (
    <article
      className="rounded-lg border border-border bg-card p-4"
      data-testid={`proof-section-${section.key}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{section.detail}</p>
        </div>
        <span
          className={`inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${stateStyles[section.state]}`}
        >
          {section.primaryLabel}
        </span>
      </div>
      {section.refs.length > 0 ? (
        <ul className="mt-3 space-y-1.5" aria-label={`${section.title} refs`}>
          {section.refs.slice(0, 4).map((ref) => (
            <li
              key={ref}
              className="break-all rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-xs text-muted-foreground"
            >
              {compactRef(ref)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
          No public ref for this preview state.
        </p>
      )}
    </article>
  );
}

function FlowRail({ item }: { item: PaidWorkflowProofUiCaseFixture }) {
  return (
    <ol
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
      aria-label={`${caseTitle(item)} proof flow`}
      data-testid={`proof-flow-${item.id}`}
    >
      {flowOrder.map((key, index) => {
        const section = item.sections.find((candidate) => candidate.key === key);
        const blocked = section?.state === "blocked";
        return (
          <li key={key} className="min-w-0">
            <div
              className={`flex min-h-16 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                blocked
                  ? "border-destructive/50 bg-destructive/10 text-red-100"
                  : "border-border bg-muted/30 text-foreground"
              }`}
            >
              <span className="min-w-0 truncate">{sectionShortLabels[key]}</span>
              {index < flowOrder.length - 1 ? (
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4 shrink-0 text-accent-green" aria-hidden="true" />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function CasePanel({ item }: { item: PaidWorkflowProofUiCaseFixture }) {
  const isHappyPath = item.status === "no_network_no_spend_happy_path";
  return (
    <section
      className="space-y-4 border-t border-border py-8 first:border-t-0 first:pt-0"
      data-testid={`proof-case-${item.id}`}
      id={item.id}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={isHappyPath ? "success" : "danger"}>
              {isHappyPath ? "No-network no-spend happy path" : "Blocked fail-closed"}
            </StatusBadge>
            <StatusBadge>{item.rail}</StatusBadge>
            <StatusBadge>{item.paymentProofLabel.replaceAll("_", " ")}</StatusBadge>
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">{caseTitle(item)}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Support state: <span className="font-mono text-foreground">{item.supportState}</span>
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm lg:w-80">
          <p className="font-medium text-foreground">Viewport fixture coverage</p>
          <ul className="mt-2 space-y-1.5 text-muted-foreground">
            {item.viewports.map((viewport) => (
              <li key={viewport.viewport} className="flex items-center justify-between gap-3">
                <span className="capitalize">{viewport.viewport}</span>
                <span className="font-mono text-xs">
                  {viewport.width}x{viewport.height}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <FlowRail item={item} />

      {item.blockedBy.length > 0 && (
        <div
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"
          data-testid={`blocked-reason-${item.id}`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-200" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-red-100">Blocked before payment proof is accepted</p>
              <ul className="mt-2 space-y-2 text-sm text-red-100/90">
                {item.blockedBy.map((blocked, index) => (
                  <li key={`${blocked.code}:${blocked.path}:${index}`}>
                    <span className="font-mono text-xs">{blocked.code}</span>
                    <span className="mx-2 text-red-100/60">-</span>
                    {blocked.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {item.sections.map((section) => (
          <SectionPanel key={section.key} section={section} />
        ))}
      </div>
    </section>
  );
}

export default function PublicProofPage() {
  const publicProof = getPublicProofPageData();
  const fixturePack = getPaidWorkflowProofUiFixturePack(publicProof);
  const happyPath = fixturePack.cases.find((item) => item.id === fixturePack.happyPathCaseId);
  const blockedCases = fixturePack.cases.filter((item) => item.status === "blocked");
  const trueBoundaryFlags = Object.entries(fixturePack.boundaryFlags).filter(([, value]) => value);

  return (
    <div className="bg-background">
      <section className="border-b border-border bg-muted/20">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="success">Fixture zero-spend</StatusBadge>
                <StatusBadge tone="warning">Production live disabled</StatusBadge>
                <StatusBadge>{fixturePack.schemaVersion}</StatusBadge>
              </div>
              <h1 className="mt-4 text-3xl font-semibold text-foreground sm:text-4xl">
                Public proof rendering for the paid workflow ledger
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
                Deterministic proof-chain UI for quote, budget ledger, result, receipt, EvidenceArchive,
                attestation draft, reputation draft, and fail-closed payment states.
              </p>
            </div>
            <Link
              href="/api/economic-demo/public-proof-page-data"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <FileText className="mr-2 size-4" aria-hidden="true" />
              Open data contract
            </Link>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <section className="grid gap-4 lg:grid-cols-4" aria-label="Proof summary">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Quoted total</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-foreground">
              {publicProof.quote.totalUsdc.toFixed(6)} {publicProof.quote.currency}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Includes downstream, attestor, orchestrator, and rail fee lines.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Policy decision</p>
            <p className="mt-2 text-lg font-semibold text-foreground">{publicProof.policyDecision.status}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {publicProof.policyDecision.reasonCodes.join(", ")}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Receipt cases</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-foreground">
              {fixturePack.cases.length}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {blockedCases.length} fail closed before payment proof acceptance.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Boundary drift</p>
            <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-foreground">
              <CheckCircle2 className="size-5 text-accent-green" aria-hidden="true" />
              {trueBoundaryFlags.length === 0 ? "All live flags false" : "Review required"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Wallet, RPC, provider, custody, reputation, publication, and live payment stay disabled.
            </p>
          </div>
        </section>

        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-label="State labels and blocked cases"
          data-testid="public-proof-state-labels"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">State labels</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {publicProof.stateLabels.map((label) => (
                  <StatusBadge key={label}>{formatStateLabel(label)}</StatusBadge>
                ))}
              </div>
            </div>
            <div className="lg:max-w-xl">
              <h2 className="text-lg font-semibold text-foreground">Hard boundaries</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {Object.keys(fixturePack.boundaryFlags).map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                  >
                    <span className="text-muted-foreground">{formatFlagLabel(key)}</span>
                    <span className="font-mono text-xs text-accent-green">false</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          className="rounded-lg border border-border bg-card p-5"
          aria-label="Public proof cases"
          data-testid="public-proof-cases"
        >
          {happyPath && <CasePanel item={happyPath} />}
          {blockedCases.map((item) => (
            <CasePanel key={item.id} item={item} />
          ))}
        </section>

        <section className="rounded-lg border border-border bg-muted/30 p-5" aria-label="Copy boundaries">
          <div className="flex items-start gap-3">
            <LockKeyhole className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Copy boundaries</h2>
              <ul className="mt-3 grid gap-2 text-sm text-muted-foreground lg:grid-cols-2">
                {fixturePack.copyBoundaries.map((boundary) => (
                  <li key={boundary} className="rounded-md border border-border bg-background/40 p-3">
                    {boundary}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5" aria-label="Receipt evidence handoff">
          <div className="flex items-start gap-3">
            <ReceiptText className="mt-0.5 size-5 shrink-0 text-accent-green" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Receipt and evidence handoff</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                This page renders refs, hashes, support states, and blocked reasons only. It does not
                execute Pay.sh, call Tempo, sign with a wallet, call RPC, mutate reputation, publish to a
                hosted registry, or claim settlement finality.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
