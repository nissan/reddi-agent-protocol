import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

import {
  buildBuyerPaidWorkflowRouteModel,
  type BuyerPaidWorkflowBlockedCase,
  type BuyerPaidWorkflowLedgerRow,
  type BuyerPaidWorkflowRouteModel,
  type BuyerPaidWorkflowRouteModelFailClosed,
  type BuyerPaidWorkflowSection,
  type BuyerPaidWorkflowTimelineMilestone,
} from "@/lib/economic-demo/buyer-paid-workflow-route-model";
import { getPaidWorkflowProofUiFixturePack } from "@/lib/economic-demo/paid-workflow-proof-ui-fixtures";

export const metadata: Metadata = {
  title: "Buyer Paid Workflow (No-Spend Shell)",
  description:
    "No-spend buyer paid-workflow route: quote, budget ledger, execution timeline, result, receipt/proof, evidence, and fail-closed boundary states from deterministic fixtures.",
};

const journeyOrder = [
  "Quote",
  "Budget",
  "Execution",
  "Result",
  "Receipt",
  "Evidence",
] as const;

function formatFlagLabel(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function compactRef(value: string) {
  if (value.length <= 44) return value;
  return `${value.slice(0, 18)}...${value.slice(-14)}`;
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

function RefList({ refs, label }: { refs: string[]; label: string }) {
  if (refs.length === 0) {
    return (
      <p className="mt-3 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
        No public ref for this preview state.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-1.5" aria-label={label}>
      {refs.slice(0, 4).map((ref) => (
        <li
          key={ref}
          className="break-all rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-xs text-muted-foreground"
        >
          {compactRef(ref)}
        </li>
      ))}
    </ul>
  );
}

function JourneySection({
  testId,
  section,
  badgeTone = "success",
  children,
}: {
  testId: string;
  section: BuyerPaidWorkflowSection;
  badgeTone?: "success" | "warning" | "neutral";
  children?: React.ReactNode;
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-4" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{section.detail}</p>
        </div>
        <StatusBadge tone={badgeTone}>{section.primaryLabel}</StatusBadge>
      </div>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{section.state}</p>
      {children}
      <RefList refs={section.refs} label={`${section.title} refs`} />
    </article>
  );
}

function FailClosedPanel({
  model,
  testId,
  heading,
}: {
  model: BuyerPaidWorkflowRouteModelFailClosed;
  testId: string;
  heading: string;
}) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4" data-testid={testId}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-200" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-red-100">{heading}</p>
          <p className="mt-1 font-mono text-xs text-red-100/80">{model.reasonCode}</p>
          <p className="mt-2 text-sm text-red-100/90">{model.message}</p>
          <p className="mt-2 text-xs text-red-100/70">
            Fail-closed states claim nothing: no {model.neverClaims.join(", no ")}.
          </p>
        </div>
      </div>
    </div>
  );
}

function ledgerRowTone(row: BuyerPaidWorkflowLedgerRow): "success" | "warning" | "danger" | "neutral" {
  if (row.availability === "blocked") return "danger";
  if (row.availability === "unavailable") return "warning";
  if (row.state === "unspent_zero" || row.state === "remaining_full_budget") return "success";
  return "neutral";
}

function LedgerRow({ row }: { row: BuyerPaidWorkflowLedgerRow }) {
  return (
    <li
      className="rounded-md border border-border bg-muted/30 p-3"
      data-testid={`paid-workflow-ledger-row-${row.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{row.label}</p>
          {row.party && <p className="mt-0.5 font-mono text-xs text-muted-foreground">{row.party}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">
            {row.amountUsdc === null ? "unavailable" : `${row.amountUsdc} USDC`}
          </span>
          <StatusBadge tone={ledgerRowTone(row)}>{row.state.replaceAll("_", " ")}</StatusBadge>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{row.detail}</p>
      {row.refs.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${row.label} source refs`}>
          {row.refs.slice(0, 3).map((ref) => (
            <li
              key={ref}
              className="break-all rounded-md border border-border bg-background/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {compactRef(ref)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-md border border-border bg-background/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          No fixture ref: row is explicitly {row.availability}.
        </p>
      )}
    </li>
  );
}

function TimelineMilestone({ milestone }: { milestone: BuyerPaidWorkflowTimelineMilestone }) {
  return (
    <li
      className="relative pb-5 pl-8 last:pb-0"
      data-testid={`paid-workflow-timeline-${milestone.id}`}
    >
      <span
        className="absolute left-0 top-0.5 inline-flex size-5 items-center justify-center rounded-full border border-border bg-muted/40 font-mono text-[10px] text-muted-foreground"
        aria-hidden="true"
      >
        {milestone.order}
      </span>
      <span className="absolute bottom-0 left-2.5 top-6 w-px bg-border last:hidden" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{milestone.label}</h3>
        <StatusBadge tone={milestone.status === "preview_only" ? "neutral" : "success"}>
          {milestone.status.replaceAll("_", " ")}
        </StatusBadge>
        <StatusBadge tone="warning">{milestone.stateLabel}</StatusBadge>
      </div>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{milestone.summary}</p>
      {milestone.refs.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${milestone.label} refs`}>
          {milestone.refs.slice(0, 3).map((ref) => (
            <li
              key={ref}
              className="break-all rounded-md border border-border bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {compactRef(ref)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-md border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          No public ref: preview-only milestone.
        </p>
      )}
      {milestone.recordedDevnetRef && (
        <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/80">
          devnet_proof_metadata: {milestone.recordedDevnetRef}
        </p>
      )}
    </li>
  );
}

function BlockedCaseCard({ item }: { item: BuyerPaidWorkflowBlockedCase }) {
  return (
    <article
      className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"
      data-testid={`paid-workflow-blocked-${item.sourceCase}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="danger">{item.kindLabel}</StatusBadge>
        <StatusBadge>{item.rail}</StatusBadge>
        <StatusBadge>{item.supportState.replaceAll("_", " ")}</StatusBadge>
      </div>
      <h3 className="mt-3 text-sm font-semibold text-red-100">{item.sourceCase.replaceAll("_", " ")}</h3>
      <ul className="mt-2 space-y-2 text-sm text-red-100/90">
        {item.blockedBy.slice(0, 3).map((blocked, index) => (
          <li key={`${blocked.code}:${blocked.path}:${index}`}>
            <span className="font-mono text-xs">{blocked.code}</span>
            <span className="mx-2 text-red-100/60">-</span>
            {blocked.message}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-red-100/70">
        {item.boundaryLabels[item.boundaryLabels.length - 1] ?? "Fail-closed fixture state only."}
      </p>
      <p className="mt-2 rounded-md border border-destructive/40 bg-background/20 px-2 py-1 font-mono text-[10px] text-red-100/80">
        spent {item.spendState.spentUsdc} USDC | refunds {item.spendState.refundsIssued} | spending and
        mutation stay false
      </p>
    </article>
  );
}

export default function BuyerPaidWorkflowPage() {
  const model: BuyerPaidWorkflowRouteModel = buildBuyerPaidWorkflowRouteModel();

  // Deterministic preview of the empty fail-closed contract: the same builder
  // fed an empty case list. This is what the route renders if the fixture
  // contract ever yields nothing.
  const emptyPack = getPaidWorkflowProofUiFixturePack();
  const emptyPreview = buildBuyerPaidWorkflowRouteModel({
    fixturePack: { ...emptyPack, cases: [] },
  });

  return (
    <div className="bg-background" data-testid="paid-workflow-route">
      <section className="border-b border-border bg-muted/20">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="success">No-spend fixture</StatusBadge>
                <StatusBadge tone="warning">Live-gated</StatusBadge>
                <StatusBadge tone="warning">Production live disabled</StatusBadge>
              </div>
              <h1 className="mt-4 text-3xl font-semibold text-foreground sm:text-4xl">
                Buyer paid workflow — no-spend shell
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
                The buyer journey from quote to budget ledger to execution timeline to result,
                receipt, and evidence, rendered entirely from deterministic no-network fixtures under
                the #497 route state contract. Nothing on this page signs, spends, settles,
                publishes, or mutates trust.
              </p>
            </div>
            <Link
              href="/economic-demo/public-proof"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <FileText className="mr-2 size-4" aria-hidden="true" />
              Open public proof page
            </Link>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        {model.status === "fail_closed" ? (
          <FailClosedPanel
            model={model}
            testId="paid-workflow-fail-closed"
            heading="Buyer paid-workflow contract failed closed"
          />
        ) : (
          <>
            <section
              className="rounded-lg border border-border bg-card p-5"
              aria-label="Copy modes"
              data-testid="paid-workflow-copy-modes"
            >
              <h2 className="text-lg font-semibold text-foreground">What each state label means</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Copy modes follow the #497 copy boundary matrix and the Discover / Decide / Prove
                boundaries doc; the fail-closed reading wins.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {model.copyModes.map((mode) => (
                  <div
                    key={mode.mode}
                    className="rounded-md border border-border bg-muted/30 p-3"
                    data-testid={`paid-workflow-copy-mode-${mode.mode}`}
                  >
                    <p className="text-sm font-semibold text-foreground">{mode.label}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{mode.mode}</p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{mode.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            <section aria-label="Buyer journey" className="space-y-4">
              <ol
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
                aria-label="Buyer journey order"
                data-testid="paid-workflow-journey-rail"
              >
                {journeyOrder.map((label, index) => (
                  <li key={label} className="min-w-0">
                    <div className="flex min-h-14 items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
                      <span className="min-w-0 truncate">{label}</span>
                      {index < journeyOrder.length - 1 ? (
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <ShieldCheck className="size-4 shrink-0 text-accent-green" aria-hidden="true" />
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              <div className="grid gap-4 lg:grid-cols-2">
                <JourneySection testId="paid-workflow-quote" section={model.quote}>
                  <dl className="mt-3 space-y-1.5">
                    {model.quote.lines.map((line) => (
                      <div key={line.label} className="flex items-center justify-between gap-3 text-sm">
                        <dt className="text-muted-foreground">{line.label}</dt>
                        <dd className="font-mono text-xs text-foreground">{line.value}</dd>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-sm">
                      <dt className="font-medium text-foreground">Quoted total</dt>
                      <dd className="font-mono text-sm font-semibold text-foreground">
                        {model.quote.totalUsdc.toFixed(6)} {model.quote.currency}
                      </dd>
                    </div>
                  </dl>
                </JourneySection>

                <JourneySection testId="paid-workflow-budget" section={model.budget} badgeTone="neutral">
                  <p className="mt-3 text-sm text-muted-foreground">
                    {model.budget.downstreamProfileIds.length} downstream specialist profiles planned;
                    downstream calls executed:{" "}
                    <span className="font-mono text-foreground">{model.budget.downstreamCallsExecuted}</span>.
                    Row-level allocation, remaining, and refund states are in the budget ledger below.
                  </p>
                </JourneySection>
              </div>

              <article
                className="rounded-lg border border-border bg-card p-4"
                aria-label="Budget ledger"
                data-testid="paid-workflow-ledger"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Budget ledger</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Every row is traced to a fixture/read-model ref or explicitly marked
                      unavailable/blocked. Planned allocations reconcile exactly to the buyer budget;
                      spent stays an authoritative zero.
                    </p>
                  </div>
                  <StatusBadge tone="success">allocations reconciled</StatusBadge>
                </div>
                <p className="mt-2 font-mono text-xs text-muted-foreground">{model.ledger.state}</p>
                <dl
                  className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"
                  data-testid="paid-workflow-ledger-totals"
                >
                  {[
                    { label: "Buyer budget", value: `${model.ledger.buyerBudgetUsdc} ${model.ledger.currency}` },
                    { label: "Allocated (planned)", value: `${model.ledger.allocatedUsdc} ${model.ledger.currency}` },
                    { label: "Spent", value: `${model.ledger.spentUsdc} ${model.ledger.currency}` },
                    { label: "Remaining (unspent)", value: `${model.ledger.remainingIfUnspentUsdc} ${model.ledger.currency}` },
                  ].map((item) => (
                    <div key={item.label} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                      <dt className="text-xs text-muted-foreground">{item.label}</dt>
                      <dd className="mt-0.5 font-mono text-sm font-semibold text-foreground">{item.value}</dd>
                    </div>
                  ))}
                </dl>
                <ul className="mt-3 space-y-2" aria-label="Budget ledger rows">
                  {model.ledger.rows.map((row) => (
                    <LedgerRow key={row.id} row={row} />
                  ))}
                </ul>
              </article>

              <article
                className="rounded-lg border border-border bg-card p-4"
                aria-label="Execution timeline"
                data-testid="paid-workflow-timeline"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Execution timeline</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Milestones come from the {model.executionTimeline.recordedDevnetIssueRef} recorded
                      dry-run rehearsal and the fixture pack; nothing here executed live. Recorded-devnet
                      metadata labels reference{" "}
                      <span className="font-mono text-xs">{model.executionTimeline.sourceRunbookPath}</span>.
                    </p>
                  </div>
                  <StatusBadge tone="neutral">no live execution</StatusBadge>
                </div>
                <p className="mt-2 font-mono text-xs text-muted-foreground">{model.executionTimeline.state}</p>
                <ol className="mt-4" aria-label="Execution timeline milestones">
                  {model.executionTimeline.milestones.map((milestone) => (
                    <TimelineMilestone key={milestone.id} milestone={milestone} />
                  ))}
                </ol>
              </article>

              <div className="grid gap-4 lg:grid-cols-2">
                <JourneySection testId="paid-workflow-result" section={model.result} />
                <JourneySection testId="paid-workflow-receipt" section={model.receipt}>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Payment proof is rendered as refs and hashes only
                    (<span className="font-mono">{model.receipt.paymentProofLabel}</span>); no settlement
                    finality or custody is implied.
                  </p>
                </JourneySection>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <JourneySection testId="paid-workflow-evidence" section={model.evidence} />
                <JourneySection
                  testId="paid-workflow-attestation-preview"
                  section={model.attestationPreview}
                  badgeTone="neutral"
                />
                <JourneySection
                  testId="paid-workflow-reputation-preview"
                  section={model.reputationPreview}
                  badgeTone="neutral"
                />
              </div>
            </section>

            <section
              className="rounded-lg border border-border bg-card p-5"
              aria-label="Evidence boundary states"
              data-testid="paid-workflow-boundary-states"
            >
              <h2 className="text-lg font-semibold text-foreground">Evidence boundary states</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Every state below fails closed. Blocked proof-chain cases come from the rail-neutral
                fixture pack; none of them can mint a reddi.receipt.v1 binding.
              </p>

              <div className="mt-4 space-y-4">
                {emptyPreview.status === "fail_closed" && (
                  <div data-testid="paid-workflow-empty-state">
                    <p className="mb-2 text-sm font-medium text-foreground">
                      Empty contract (rendered by feeding the builder an empty case list)
                    </p>
                    <FailClosedPanel
                      model={emptyPreview}
                      testId="paid-workflow-empty-state-panel"
                      heading="Empty fixture contract fails closed"
                    />
                  </div>
                )}

                <div className="grid gap-4 lg:grid-cols-2" data-testid="paid-workflow-blocked-states">
                  {model.blockedCases.map((item) => (
                    <BlockedCaseCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            </section>

            <section
              className="rounded-lg border border-border bg-card p-5"
              aria-label="Unsupported rail states"
              data-testid="paid-workflow-unsupported-rail"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">Second rail: support states</h2>
                <StatusBadge tone="warning">draft</StatusBadge>
                <StatusBadge>{model.unsupportedRail.schemaVersion}</StatusBadge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Real second-rail data: webhook-derived card-rail receipts cap at probe-only, and any
                live settlement claim on this rail fails closed.
              </p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {model.unsupportedRail.rows.map((row) => (
                  <article
                    key={row.supportState}
                    className="rounded-md border border-border bg-muted/30 p-4"
                    data-testid={`paid-workflow-rail-state-${row.supportState}`}
                  >
                    <StatusBadge tone={row.supportState.startsWith("unsupported") ? "danger" : "warning"}>
                      {row.supportState.replaceAll("_", " ")}
                    </StatusBadge>
                    <p className="mt-2 text-xs text-muted-foreground">{row.standard}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{row.description}</p>
                    <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                      {row.claimBoundary.map((line) => (
                        <li key={line} className="rounded-md border border-border bg-background/40 px-2 py-1">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2" aria-label="Devnet and live gating">
              <article
                className="rounded-lg border border-border bg-card p-5"
                data-testid="paid-workflow-recorded-devnet"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">Recorded devnet metadata</h2>
                  <StatusBadge>{model.recordedDevnet.state.replaceAll("_", " ")}</StatusBadge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  The {model.recordedDevnet.issueRef} reference rehearsal is a no-live dry run
                  (<span className="font-mono text-xs">{model.recordedDevnet.mode}</span>). Real metering
                  stays at authoritative zeros: {model.recordedDevnet.realMetering.devnetTransactions}{" "}
                  devnet transactions, {model.recordedDevnet.realMetering.paidRequests} paid requests,{" "}
                  {model.recordedDevnet.realMetering.usdcSettled} USDC settled.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Operator runbook: <span className="font-mono">{model.recordedDevnet.runbookPath}</span>
                </p>
                <ol className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  {model.recordedDevnet.steps.map((step, index) => (
                    <li key={step.step} className="flex gap-2">
                      <span className="font-mono text-xs text-muted-foreground/80">{index + 1}.</span>
                      <span>
                        <span className="font-medium capitalize text-foreground">
                          {step.step.replaceAll("_", " ")}
                        </span>{" "}
                        — {step.summary}
                      </span>
                    </li>
                  ))}
                </ol>
              </article>

              <div className="space-y-4">
                <article
                  className="rounded-lg border border-accent-orange/50 bg-accent-orange/10 p-5"
                  data-testid="paid-workflow-live-gate"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-orange-100">Optional fresh devnet run</h2>
                    <StatusBadge tone="warning">approval required</StatusBadge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-orange-100/90">{model.liveGate.detail}</p>
                  <p className="mt-2 text-xs text-orange-100/80">
                    Operator approval ref:{" "}
                    <span className="font-mono">
                      {model.liveGate.operatorApprovalRef === null ? "none recorded" : "review required"}
                    </span>
                  </p>
                  <p className="mt-1 font-mono text-xs text-orange-100/70">{model.liveGate.state}</p>
                </article>

                <article
                  className="rounded-lg border border-accent-orange/50 bg-accent-orange/10 p-5"
                  data-testid="paid-workflow-production-disabled"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-orange-100">Production disabled</h2>
                    <StatusBadge tone="warning">disabled by default</StatusBadge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-orange-100/90">{model.productionDisabled.detail}</p>
                  <p className="mt-1 font-mono text-xs text-orange-100/70">{model.productionDisabled.state}</p>
                </article>
              </div>
            </section>

            <section
              className="rounded-lg border border-border bg-card p-5"
              aria-label="Boundary flags"
              data-testid="paid-workflow-boundary-flags"
            >
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold text-foreground">Hard boundaries</h2>
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckCircle2 className="size-5 text-accent-green" aria-hidden="true" />
                  All live flags false
                </p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                The full #497 16-flag grid: twelve fixture-pack flags plus the four contract-only
                flags (production AUDD rail, default USDC auto-pay, mainnet settlement, Pay.sh
                production activation).
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.keys(model.hardBoundaryFlags).map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                  >
                    <span className="text-muted-foreground">{formatFlagLabel(key)}</span>
                    <span className="font-mono text-xs text-accent-green">false</span>
                  </div>
                ))}
              </div>
            </section>

            <section
              className="rounded-lg border border-border bg-muted/30 p-5"
              aria-label="Copy boundaries"
              data-testid="paid-workflow-copy-boundaries"
            >
              <div className="flex items-start gap-3">
                <LockKeyhole className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-semibold text-foreground">What this page never claims</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    No {model.neverClaims.join(", no ")}. This shell renders refs, hashes, support
                    states, and fail-closed reasons only.
                  </p>
                  <ul className="mt-3 grid gap-2 text-sm text-muted-foreground lg:grid-cols-2">
                    {model.copyBoundaries.map((boundary) => (
                      <li key={boundary} className="rounded-md border border-border bg-background/40 p-3">
                        {boundary}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
