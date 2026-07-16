"use client";

/**
 * #384 — AI onboarding assistant guided intake flow.
 *
 * Thin UI surface over the #575 analyser-handoff contracts and the #576
 * onboarding state machine via `lib/onboarding/intake-flow.ts`. All
 * accept/reject decisions come from `validateOnboardingIntakeDescriptor`
 * inside `runOnboardingAnalyserHandoff`; this page only renders outcomes.
 *
 * Boundary: analysis is static/fixture-backed. Zero live network calls,
 * no publish, no pay, no paid endpoint invocation, no secret storage.
 * Live endpoint inspection is not yet enabled — #459 owns that adapter.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INTAKE_DRYRUN_URL_MARKERS,
  INTAKE_SOURCE_OPTIONS,
  getIntakeSourceOption,
  runIntakeDryRunAnalysis,
  type IntakeAnalysisOutcome,
  type IntakeFormInput,
  type IntakeManualSeedInput,
  type IntakeSourceOptionId,
} from "@/lib/onboarding/intake-flow";

type IntakeStep = "source" | "consent" | "analysis";

const EMPTY_MANUAL_SEED: IntakeManualSeedInput = {
  displayName: "",
  description: "",
  contactRef: "",
  capabilityLines: "",
  endpointUrl: "",
};

const SAMPLE_URLS: Record<Exclude<IntakeSourceOptionId, "manual-seed">, string> = {
  "endpoint-url": "https://fixtures.example.com/agents/summarizer/invoke",
  "ai-catalog-url": "https://fixtures.example.com/.well-known/ai-catalog.json",
  "mcp-card-url": "https://fixtures.example.com/mcp/server-card.json",
  "openapi-url": "https://fixtures.example.com/openapi/service.json",
  "a2a-card-url": "https://fixtures.example.com/.well-known/agent-card.json",
};

const READINESS_CHIP: Record<string, string> = {
  ready: "border-green-500/30 bg-green-500/10 text-green-300",
  needs_operator_review: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  blocked: "border-red-500/30 bg-red-950/40 text-red-300",
};

export default function OnboardingIntakePage() {
  const [step, setStep] = useState<IntakeStep>("source");
  const [optionId, setOptionId] = useState<IntakeSourceOptionId>("mcp-card-url");
  const [sourceUrl, setSourceUrl] = useState("");
  const [manualSeed, setManualSeed] = useState<IntakeManualSeedInput>(EMPTY_MANUAL_SEED);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(1);
  const [outcome, setOutcome] = useState<IntakeAnalysisOutcome | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const option = getIntakeSourceOption(optionId);
  const inputReady =
    option.inputMode === "manual" ? true : sourceUrl.trim().length > 0;

  function buildFormInput(): IntakeFormInput {
    return {
      optionId,
      ...(option.inputMode === "url" ? { sourceUrl } : {}),
      ...(option.inputMode === "manual" ? { manualSeed } : {}),
    };
  }

  function runAnalysis(nextAttempt: number) {
    setStep("analysis");
    setLoading(true);
    setOutcome(null);
    setAttempt(nextAttempt);
    const formInput = buildFormInput();
    timerRef.current = setTimeout(() => {
      const result = runIntakeDryRunAnalysis(formInput, nextAttempt);
      if (result.status === "blocked_secret") {
        // Discard credential-shaped input immediately: never stored, never echoed.
        setSourceUrl("");
        setManualSeed(EMPTY_MANUAL_SEED);
      }
      setOutcome(result);
      setLoading(false);
    }, 900);
  }

  function startOver() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStep("source");
    setOutcome(null);
    setLoading(false);
    setAttempt(1);
    setConsentAccepted(false);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8" data-testid="intake-page">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.24em] text-[#14F195]">AI onboarding assistant</p>
        <h1 className="text-3xl font-bold">Guided intake — analyze an existing agent source</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Start a RAP-compatible onboarding draft from an endpoint URL, AI Catalog entry, MCP card,
          OpenAPI description, A2A card, or a manual profile seed. Analysis is static and
          fixture-backed: nothing is fetched, invoked, published, or paid during intake.
        </p>
        <div className="flex flex-wrap gap-2 text-xs" data-testid="intake-boundary-badges">
          {["Dry-run / fixture-backed", "No live probe (#459 pending)", "No publish", "No pay", "No secret storage"].map(
            (badge) => (
              <span key={badge} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-muted-foreground">
                {badge}
              </span>
            ),
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Prefer the classic path? Use{" "}
          <Link href="/register" className="text-[#14F195] hover:text-emerald-200">manual registration</Link>{" "}
          or the{" "}
          <Link href="/onboarding" className="text-[#14F195] hover:text-emerald-200">specialist onboarding wizard</Link>.
        </p>
      </header>

      {step === "source" && (
        <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-5" data-testid="intake-source-step">
          <div>
            <h2 className="text-lg font-semibold">1. Choose the source to analyze</h2>
            <p className="text-sm text-muted-foreground">
              Each input maps onto an onboarding source kind from the analyser contract
              (reddi.onboarding-intake-descriptor.v1).
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {INTAKE_SOURCE_OPTIONS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                data-testid={`intake-source-option-${candidate.id}`}
                onClick={() => setOptionId(candidate.id)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  candidate.id === optionId
                    ? "border-[#14F195]/60 bg-[#14F195]/10"
                    : "border-white/10 bg-black/20 hover:border-white/25"
                }`}
              >
                <p className="font-medium">{candidate.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{candidate.description}</p>
                <p className="mt-2 font-mono text-[11px] text-[#9945FF]">→ {candidate.sourceKind}</p>
              </button>
            ))}
          </div>

          {option.inputMode === "url" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="intake-source-url">{option.label}</Label>
                <Input
                  id="intake-source-url"
                  data-testid="intake-source-url-input"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder={option.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Public HTTPS only. Private/localhost hosts and credential-shaped URLs are rejected
                  fail-closed before analysis. The URL is recorded as an untrusted source reference —
                  it is never called.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="intake-sample-url"
                  onClick={() => setSourceUrl(SAMPLE_URLS[optionId as Exclude<IntakeSourceOptionId, "manual-seed">])}
                >
                  Use sample fixture URL
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="intake-sample-empty"
                  onClick={() => setSourceUrl(`https://fixtures.example.com/${INTAKE_DRYRUN_URL_MARKERS.empty}/card.json`)}
                >
                  Empty fixture (no results)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="intake-sample-unreachable"
                  onClick={() =>
                    setSourceUrl(`https://fixtures.example.com/${INTAKE_DRYRUN_URL_MARKERS.unreachable}/card.json`)
                  }
                >
                  Interruption fixture (retryable error)
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Dry-run fixture routing: because live inspection is not yet enabled, URLs containing{" "}
                <code className="rounded bg-black/30 px-1">{INTAKE_DRYRUN_URL_MARKERS.empty}</code> or{" "}
                <code className="rounded bg-black/30 px-1">{INTAKE_DRYRUN_URL_MARKERS.unreachable}</code> select the
                matching static fixture variant.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2" data-testid="intake-manual-seed-form">
              <div className="space-y-1.5">
                <Label htmlFor="intake-manual-displayname">Display name</Label>
                <Input
                  id="intake-manual-displayname"
                  data-testid="intake-manual-displayname"
                  value={manualSeed.displayName}
                  onChange={(event) => setManualSeed({ ...manualSeed, displayName: event.target.value })}
                  placeholder="My summarizer agent"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake-manual-contact">Contact reference (optional)</Label>
                <Input
                  id="intake-manual-contact"
                  data-testid="intake-manual-contact"
                  value={manualSeed.contactRef ?? ""}
                  onChange={(event) => setManualSeed({ ...manualSeed, contactRef: event.target.value })}
                  placeholder="operator:my-team"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake-manual-description">Description</Label>
                <Input
                  id="intake-manual-description"
                  data-testid="intake-manual-description"
                  value={manualSeed.description}
                  onChange={(event) => setManualSeed({ ...manualSeed, description: event.target.value })}
                  placeholder="What the agent does"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake-manual-capabilities">Capabilities (one per line: name — description)</Label>
                <textarea
                  id="intake-manual-capabilities"
                  data-testid="intake-manual-capabilities"
                  value={manualSeed.capabilityLines}
                  onChange={(event) => setManualSeed({ ...manualSeed, capabilityLines: event.target.value })}
                  placeholder={"summarize-document — Summarize a provided document\ntranslate-text — Translate between languages"}
                  rows={4}
                  className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-[#14F195]/50"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to see the no-results state — capability fit cannot be assessed without at
                  least one capability.
                </p>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake-manual-endpoint">Endpoint URL (optional, never called)</Label>
                <Input
                  id="intake-manual-endpoint"
                  data-testid="intake-manual-endpoint"
                  value={manualSeed.endpointUrl ?? ""}
                  onChange={(event) => setManualSeed({ ...manualSeed, endpointUrl: event.target.value })}
                  placeholder="https://api.example.com/agent"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Next: consent and data-sharing boundary.</p>
            <Button
              type="button"
              data-testid="intake-continue"
              disabled={!inputReady}
              onClick={() => setStep("consent")}
            >
              Continue
            </Button>
          </div>
        </section>
      )}

      {step === "consent" && (
        <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-5" data-testid="intake-consent-step">
          <div>
            <h2 className="text-lg font-semibold">2. Consent and data-sharing boundary</h2>
            <p className="text-sm text-muted-foreground">
              Per the Discover / Decide / Prove model, discovery metadata never grants trust, payment,
              invocation, or publication approval. Review what this analysis will and will not do.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[#14F195]/25 bg-[#14F195]/5 p-4 space-y-2">
              <p className="text-sm font-semibold text-[#14F195]">What happens</p>
              <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
                <li>Your input is validated locally against the onboarding intake contract (fail-closed).</li>
                <li>
                  A <span className="text-white">static, fixture-backed</span> analysis renders the dry-run
                  pathway: capability inventory, RAP profile draft, readiness lanes, and a draft-state
                  read model.
                </li>
                <li>Imported metadata enters as untrusted content; every field carries provenance (discovered / inferred / user-provided / blocked). Nothing is verified at intake.</li>
                <li>The draft stays local to this page. Nothing is persisted when you leave.</li>
              </ul>
            </div>
            <div className="rounded-xl border border-red-500/25 bg-red-950/20 p-4 space-y-2">
              <p className="text-sm font-semibold text-red-300">What never happens here</p>
              <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
                <li>
                  <span className="text-white">No live endpoint inspection.</span> Your URL is never fetched,
                  probed, or invoked — live source adapters are a future issue (#459) and are labelled
                  not-yet-enabled.
                </li>
                <li>No publication, no hosted or registry write, no listing goes public.</li>
                <li>No payment, no paid endpoint invocation, no wallet or RPC call.</li>
                <li>
                  No secret storage: credential-shaped input is rejected fail-closed and immediately
                  discarded, never stored or transmitted.
                </li>
                <li>Imported content can never self-assert trust, verification, or payment approval.</li>
              </ul>
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
            <input
              type="checkbox"
              data-testid="intake-consent-checkbox"
              checked={consentAccepted}
              onChange={(event) => setConsentAccepted(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#14F195]"
            />
            <span className="text-muted-foreground">
              I understand this is a static, fixture-backed dry-run analysis inside the boundary above, and
              that operator review gates everything downstream.
            </span>
          </label>

          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="outline" data-testid="intake-back" onClick={() => setStep("source")}>
              Back
            </Button>
            <Button
              type="button"
              data-testid="intake-run-analysis"
              disabled={!consentAccepted}
              onClick={() => runAnalysis(1)}
            >
              Run fixture-backed analysis
            </Button>
          </div>
        </section>
      )}

      {step === "analysis" && (
        <section className="space-y-5" data-testid="intake-analysis-step">
          {loading && (
            <div
              className="rounded-2xl border border-white/10 bg-card/30 p-8 text-center space-y-3"
              data-testid="intake-loading"
              role="status"
            >
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#14F195]/30 border-t-[#14F195]" />
              <p className="text-sm font-medium">Static analysis in progress…</p>
              <p className="text-xs text-muted-foreground">
                Fixture-backed dry run — no network request is being made.
              </p>
            </div>
          )}

          {!loading && outcome?.status === "analyser_error" && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5 space-y-3" data-testid="intake-error">
              <h2 className="text-lg font-semibold text-amber-200">Analysis interrupted</h2>
              <p className="text-sm text-muted-foreground">{outcome.message}</p>
              <div className="flex gap-2">
                <Button type="button" data-testid="intake-retry" onClick={() => runAnalysis(attempt + 1)}>
                  Retry analysis
                </Button>
                <Button type="button" variant="outline" data-testid="intake-start-over" onClick={startOver}>
                  Start over
                </Button>
              </div>
            </div>
          )}

          {!loading && outcome?.status === "invalid_url" && (
            <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-5 space-y-3" data-testid="intake-invalid-url">
              <h2 className="text-lg font-semibold text-red-300">URL rejected</h2>
              <p className="text-sm text-muted-foreground">
                The source URL failed the fail-closed intake validation. Only public HTTPS URLs are
                accepted — private, localhost, and link-local hosts are blocked, and malformed URLs
                cannot be recorded as source references.
              </p>
              <ul className="space-y-1 text-xs font-mono text-red-200/90">
                {outcome.errors.map((error, index) => (
                  <li key={`${error.code}-${index}`}>
                    {error.code} @ {error.path}
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" data-testid="intake-start-over" onClick={startOver}>
                Fix input
              </Button>
            </div>
          )}

          {!loading && outcome?.status === "blocked_secret" && (
            <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-5 space-y-3" data-testid="intake-blocked-secret">
              <h2 className="text-lg font-semibold text-red-300">Credential-shaped input blocked</h2>
              <p className="text-sm text-muted-foreground">
                The input contained credential-shaped material (an API key, bearer token, private key, or a
                secret-shaped query parameter) and was rejected fail-closed with{" "}
                <code className="rounded bg-black/30 px-1 font-mono text-xs">credential_leakage_rejected</code>.
              </p>
              <p className="text-sm text-white">
                The submitted value was discarded. It was never stored, transmitted, or displayed.
              </p>
              <ul className="space-y-1 text-xs font-mono text-red-200/90">
                {outcome.errors
                  .filter((error) => error.code === "credential_leakage_rejected")
                  .map((error, index) => (
                    <li key={`${error.code}-${index}`}>{error.code}</li>
                  ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Intake never needs secrets: auth requirements are recorded as names/hints only (for
                example, &quot;api-key header&quot;), never values.
              </p>
              <Button type="button" variant="outline" data-testid="intake-start-over" onClick={startOver}>
                Start over without the secret
              </Button>
            </div>
          )}

          {!loading && outcome?.status === "blocked" && (
            <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-5 space-y-3" data-testid="intake-blocked">
              <h2 className="text-lg font-semibold text-red-300">Intake blocked fail-closed</h2>
              <p className="text-sm text-muted-foreground">
                The intake descriptor was rejected by the analyser contract. Nothing was analysed.
              </p>
              <ul className="space-y-1 text-xs font-mono text-red-200/90">
                {outcome.errors.map((error, index) => (
                  <li key={`${error.code}-${index}`}>
                    {error.code} @ {error.path}
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" data-testid="intake-start-over" onClick={startOver}>
                Start over
              </Button>
            </div>
          )}

          {!loading && outcome?.status === "empty" && (
            <div className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="intake-empty">
              <h2 className="text-lg font-semibold">No capabilities found</h2>
              <p className="text-sm text-muted-foreground">
                The static snapshot for this source declared no capabilities, so capability fit cannot be
                assessed and the draft stays blocked. Because live endpoint inspection is not yet enabled
                (#459), a bare endpoint cannot be expanded automatically — add capabilities with the manual
                profile seed instead.
              </p>
              {outcome.readModel && (
                <p className="text-xs text-muted-foreground">
                  Draft <code className="rounded bg-black/30 px-1 font-mono">{outcome.readModel.draftId}</code> recorded
                  in state <span className="font-mono text-amber-200">{outcome.readModel.state}</span> with readiness{" "}
                  <span className="font-mono text-red-300">{outcome.handoff.readiness.overall}</span>.
                </p>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" data-testid="intake-start-over" onClick={startOver}>
                  Choose another source
                </Button>
                <Link
                  href="/register"
                  className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
                >
                  Go to manual registration
                </Link>
              </div>
            </div>
          )}

          {!loading && outcome?.status === "analysed" && (
            <div className="space-y-5" data-testid="intake-results">
              <div className="rounded-2xl border border-[#14F195]/30 bg-[#14F195]/5 p-5 space-y-2">
                <h2 className="text-lg font-semibold">Draft created from static analysis</h2>
                <p className="text-sm text-muted-foreground">
                  Source kind <code className="rounded bg-black/30 px-1 font-mono text-xs">{outcome.handoff.intake.sourceKind}</code>{" "}
                  → profile draft{" "}
                  <code className="rounded bg-black/30 px-1 font-mono text-xs">{outcome.handoff.rapProfileDraft.profileId}</code>.
                  Everything below is a dry-run draft awaiting operator review; nothing is public, payable, or trusted.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="intake-capabilities">
                <h3 className="text-base font-semibold">Capability inventory (untrusted imported content)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs text-muted-foreground">
                        <th className="py-2 pr-3">Capability</th>
                        <th className="py-2 pr-3">Side-effect risk</th>
                        <th className="py-2 pr-3">Provenance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outcome.handoff.capabilityInventory.entries.map((entry) => (
                        <tr key={entry.capabilityId} className="border-b border-white/5">
                          <td className="py-2 pr-3 font-mono text-xs">{entry.name.value ?? "(blocked)"}</td>
                          <td className="py-2 pr-3">
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs">
                              {entry.sideEffectRisk.value ?? "unknown"}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{entry.name.provenance}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="intake-readiness">
                <h3 className="text-base font-semibold">
                  Readiness lanes — overall{" "}
                  <span className={`ml-1 rounded-full border px-2 py-0.5 text-xs ${READINESS_CHIP[outcome.handoff.readiness.overall]}`}>
                    {outcome.handoff.readiness.overall}
                  </span>
                </h3>
                <ul className="space-y-2">
                  {outcome.handoff.readiness.lanes.map((laneItem) => (
                    <li key={laneItem.lane} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${READINESS_CHIP[laneItem.status]}`}>
                        {laneItem.status}
                      </span>
                      <span className="font-mono text-xs">{laneItem.lane}</span>
                      <span className="text-xs text-muted-foreground">{laneItem.recommendations[0]}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="intake-state-machine">
                <h3 className="text-base font-semibold">Onboarding draft state (local read model)</h3>
                <p className="text-sm">
                  Draft <code className="rounded bg-black/30 px-1 font-mono text-xs">{outcome.readModel.draftId}</code> is in
                  state <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-xs text-amber-200">{outcome.readModel.state}</span>
                </p>
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Blocking gates still open:</p>
                  <ul className="space-y-1 text-xs">
                    {outcome.readModel.blockingGates.map((gate) => (
                      <li key={gate.gate} className="font-mono text-amber-200/90">
                        {gate.gate}: {gate.reasonCodes.join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-xs text-muted-foreground">
                  Allowed next states:{" "}
                  <span className="font-mono">{outcome.nextStates.join(", ")}</span>. All transitions are
                  local read-model events; approval, publication, and payment activation stay operator-gated.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="intake-listing-states">
                <h3 className="text-base font-semibold">Listing draft states</h3>
                <ul className="space-y-1.5 text-xs">
                  {outcome.handoff.listingExportDraft.states.map((state) => (
                    <li key={state.code} className="flex items-start gap-2">
                      <span
                        className={`mt-0.5 rounded-full border px-2 py-0.5 font-mono ${
                          state.severity === "blocked"
                            ? READINESS_CHIP.blocked
                            : state.severity === "warning"
                              ? READINESS_CHIP.needs_operator_review
                              : "border-white/10 bg-white/5 text-muted-foreground"
                        }`}
                      >
                        {state.code}
                      </span>
                      <span className="text-muted-foreground">{state.message}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="intake-guardrails">
                <h3 className="text-base font-semibold">Analyser guardrails (all disabled by contract)</h3>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {Object.entries(outcome.handoff.guardrails).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs">
                      <span className="font-mono text-muted-foreground">{key}</span>{" "}
                      <span className="font-semibold text-red-300">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" data-testid="intake-start-over" onClick={startOver}>
                  Analyze another source
                </Button>
                <Link
                  href="/register"
                  className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
                >
                  Continue via manual registration
                </Link>
                <Link
                  href="/manager/listings"
                  className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
                >
                  Operator review queue
                </Link>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
