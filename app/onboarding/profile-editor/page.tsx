"use client";

/**
 * #385 — Generated RAP profile review editor.
 *
 * Thin UI surface over the #575 analyser-handoff contracts and the #576
 * onboarding state machine via `lib/onboarding/profile-review.ts`. Every
 * accept/reject decision comes from `runOnboardingAnalyserHandoff`; field
 * provenance is the #575 five-way partition (discovered / inferred /
 * user_provided / verified / blocked); save/continue uses the #576 blocking-
 * gate semantics and records a local read-model transition only.
 *
 * Boundary: fixture-backed drafts. Zero live network calls, no publish, no
 * pay, no endpoint invocation, no secret storage, no trust or reputation
 * mutation. Sections the profile-draft contract does not carry render
 * honestly as unavailable.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PROFILE_FIELD_LABELS,
  PROFILE_REVIEW_SCENARIOS,
  buildProfileDiff,
  buildProfileReviewViewModel,
  evaluateProfileGate,
  recordProfileContinueDecision,
  runProfileReview,
  type ProfileContinueDecision,
  type ProfileEditableFieldKey,
  type ProfileFieldIssue,
  type ProfileFieldRow,
  type ProfileReviewEdits,
  type ProfileReviewScenarioId,
} from "@/lib/onboarding/profile-review";

const PROVENANCE_CHIP: Record<string, string> = {
  discovered: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  inferred: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  user_provided: "border-[#9945FF]/40 bg-[#9945FF]/10 text-[#c69cff]",
  verified: "border-green-500/30 bg-green-500/10 text-green-300",
  blocked: "border-red-500/30 bg-red-950/40 text-red-300",
};

const READINESS_CHIP: Record<string, string> = {
  ready: "border-green-500/30 bg-green-500/10 text-green-300",
  needs_operator_review: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  blocked: "border-red-500/30 bg-red-950/40 text-red-300",
};

const DIFF_CHIP: Record<string, string> = {
  unchanged: "border-white/10 bg-white/5 text-muted-foreground",
  operator_edited: PROVENANCE_CHIP.user_provided,
  inferred: PROVENANCE_CHIP.inferred,
  generated_added: PROVENANCE_CHIP.discovered,
  blocked: PROVENANCE_CHIP.blocked,
};

const EMPTY_EDITS: ProfileReviewEdits = {};

/**
 * #386 continue path: which readiness-gate fixture scenario corresponds to
 * each editor scenario (complete drafts land on the ready gates; missing
 * payment fields land on the payment-blocked gates; inferred execute-risk
 * drafts land on the trust-blocked gates).
 */
const READINESS_GATE_SCENARIO_BY_PROFILE: Record<ProfileReviewScenarioId, string> = {
  complete: "ready",
  "missing-required": "blocked-payment",
  "inferred-warnings": "blocked-trust",
};

function ProvenanceChip({ provenance }: { provenance: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${PROVENANCE_CHIP[provenance] ?? PROVENANCE_CHIP.discovered}`}
      data-provenance={provenance}
    >
      {provenance}
    </span>
  );
}

function FieldValue({ row }: { row: ProfileFieldRow }) {
  if (row.value === null) {
    return (
      <span className="text-xs text-red-300/90">
        unavailable{row.blockedReason ? ` — ${row.blockedReason}` : ""}
      </span>
    );
  }
  return <span className="break-all text-xs text-white/90">{row.value}</span>;
}

export default function ProfileReviewEditorPage() {
  const [scenarioId, setScenarioId] = useState<ProfileReviewScenarioId>("complete");
  const [formValues, setFormValues] = useState<ProfileReviewEdits>(EMPTY_EDITS);
  const [appliedEdits, setAppliedEdits] = useState<ProfileReviewEdits>(EMPTY_EDITS);
  const [issues, setIssues] = useState<ProfileFieldIssue[]>([]);
  const [secretDiscarded, setSecretDiscarded] = useState(false);
  const [deferralReason, setDeferralReason] = useState("");
  const [decision, setDecision] = useState<ProfileContinueDecision | null>(null);
  const inputRefs = useRef<Partial<Record<ProfileEditableFieldKey, HTMLInputElement | null>>>({});

  const review = useMemo(() => runProfileReview(scenarioId, appliedEdits), [scenarioId, appliedEdits]);
  const viewModel = useMemo(
    () => (review.status === "review" ? buildProfileReviewViewModel(review.handoff, review.overriddenKeys) : null),
    [review],
  );
  const diffRows = useMemo(
    () => (review.status === "review" ? buildProfileDiff(scenarioId, review.handoff, review.overriddenKeys) : []),
    [review, scenarioId],
  );
  const gate = review.status === "review" ? evaluateProfileGate(review.handoff, deferralReason) : null;
  const decided = decision !== null && decision.ok;

  function selectScenario(id: ProfileReviewScenarioId) {
    setScenarioId(id);
    setFormValues(EMPTY_EDITS);
    setAppliedEdits(EMPTY_EDITS);
    setIssues([]);
    setSecretDiscarded(false);
    setDeferralReason("");
    setDecision(null);
  }

  function issueFor(field: ProfileEditableFieldKey): ProfileFieldIssue | undefined {
    return issues.find((issue) => issue.field === field);
  }

  function applyEdits() {
    const outcome = runProfileReview(scenarioId, formValues);
    if (outcome.status === "review") {
      setAppliedEdits(formValues);
      setIssues([]);
      setSecretDiscarded(false);
      setDecision(null);
      return;
    }
    setIssues(outcome.issues);
    if (outcome.status === "blocked_secret") {
      // Discard credential-shaped input immediately: never kept, never echoed.
      setFormValues(appliedEdits);
      setSecretDiscarded(true);
    } else {
      setSecretDiscarded(false);
    }
    const firstField = outcome.issues.find((issue) => issue.field !== "form")?.field as
      | ProfileEditableFieldKey
      | undefined;
    if (firstField && inputRefs.current[firstField]) {
      inputRefs.current[firstField]?.focus();
    }
  }

  function continueReview() {
    if (review.status !== "review") return;
    const result = recordProfileContinueDecision(review.handoff, review.readModel, deferralReason);
    setDecision(result);
  }

  function renderEditableInput(row: ProfileFieldRow, placeholder: string) {
    const field = row.editable;
    if (!field) return null;
    const issue = issueFor(field);
    const errorId = `profile-editor-error-${field}`;
    return (
      <div className="space-y-1.5" key={field}>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`profile-editor-field-${field}`}>
            {PROFILE_FIELD_LABELS[field]}
            {row.required ? <span aria-hidden="true" className="ml-1 text-red-300">*</span> : null}
            {row.required ? <span className="sr-only"> (required)</span> : null}
          </Label>
          <ProvenanceChip provenance={row.provenance} />
        </div>
        <Input
          id={`profile-editor-field-${field}`}
          data-testid={`profile-editor-field-${field}`}
          ref={(element) => {
            inputRefs.current[field] = element;
          }}
          value={formValues[field] ?? ""}
          onChange={(event) => setFormValues({ ...formValues, [field]: event.target.value })}
          placeholder={row.value ?? placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={decided}
          aria-required={row.required ? true : undefined}
          aria-invalid={issue ? true : undefined}
          aria-describedby={issue ? errorId : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Current: <FieldValue row={row} />
          {row.value === null && row.required ? " — required before this lane can pass review." : ""}
        </p>
        {issue && (
          <p id={errorId} className="text-xs text-red-300" data-testid={`profile-editor-inline-error-${field}`}>
            {issue.code}: {issue.message}. <span className="text-red-200/90">{issue.recovery}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8" data-testid="profile-editor-page">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.24em] text-[#14F195]">AI onboarding assistant</p>
        <h1 className="text-3xl font-bold">Generated RAP profile — review &amp; edit</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Review an AI-generated RAP profile draft before it can become a listing. Every field carries
          provenance (discovered / inferred / user-provided / verified / blocked), operator edits are
          re-validated fail-closed, and continuing records a local read-model decision only — nothing
          becomes public, payable, or trusted here.
        </p>
        <div className="flex flex-wrap gap-2 text-xs" data-testid="profile-editor-boundary-badges">
          {["Fixture-backed draft", "Local read model only", "No publish", "No pay", "No invoke", "No secret storage"].map(
            (badge) => (
              <span key={badge} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-muted-foreground">
                {badge}
              </span>
            ),
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Drafts come from the{" "}
          <Link href="/onboarding/intake" className="text-[#14F195] hover:text-emerald-200">
            guided intake flow
          </Link>
          ; intake drafts stay local to that page, so this editor reviews the matching fixture-backed
          generated drafts until draft persistence lands.
        </p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-4" data-testid="profile-editor-scenarios">
        <div>
          <h2 className="text-lg font-semibold">1. Choose a generated profile draft</h2>
          <p className="text-sm text-muted-foreground">
            Static fixture drafts generated by the analyser handoff (reddi.onboarding-rap-profile-draft.v1).
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {PROFILE_REVIEW_SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              data-testid={`profile-editor-scenario-${scenario.id}`}
              onClick={() => selectScenario(scenario.id)}
              aria-pressed={scenario.id === scenarioId}
              className={`rounded-xl border p-4 text-left transition-colors ${
                scenario.id === scenarioId
                  ? "border-[#14F195]/60 bg-[#14F195]/10"
                  : "border-white/10 bg-black/20 hover:border-white/25"
              }`}
            >
              <p className="font-medium">{scenario.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{scenario.description}</p>
              <p className="mt-2 font-mono text-[11px] text-[#9945FF]">→ {scenario.sourceKind}</p>
            </button>
          ))}
        </div>
      </section>

      {review.status === "review" && viewModel && gate && (
        <>
          <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="profile-editor-provenance-legend">
            <h2 className="text-lg font-semibold">Field provenance</h2>
            <p className="text-sm text-muted-foreground">
              Five-way provenance from the analyser contract. Imported metadata is untrusted data;
              verification requires evidence refs, so nothing is verified at this stage.
            </p>
            <div className="flex flex-wrap gap-3">
              {(Object.entries(viewModel.provenanceCounts) as [string, number][]).map(([provenance, count]) => (
                <span key={provenance} className="flex items-center gap-1.5 text-xs" data-testid={`profile-editor-provenance-count-${provenance}`}>
                  <ProvenanceChip provenance={provenance} />
                  <span className="text-muted-foreground">× {count}</span>
                </span>
              ))}
            </div>
            {viewModel.provenanceCounts.verified === 0 && (
              <p className="text-xs text-muted-foreground">
                verified × 0 is expected: a field only becomes verified when backed by non-empty evidence
                refs during operator review — never at generation time.
              </p>
            )}
          </section>

          {issues.length > 0 && (
            <div
              className="rounded-2xl border border-red-500/30 bg-red-950/20 p-5 space-y-2"
              role="alert"
              data-testid="profile-editor-issues"
            >
              <h2 className="text-base font-semibold text-red-300">
                {secretDiscarded ? "Credential-shaped input blocked" : "Edits rejected fail-closed"}
              </h2>
              {secretDiscarded && (
                <p className="text-sm text-white">
                  The submitted value was discarded. It was never stored, transmitted, or displayed.
                </p>
              )}
              <ul className="space-y-1.5 text-xs">
                {issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`} className="text-red-200/90">
                    <span className="font-mono">{issue.code}</span>
                    {issue.field !== "form" ? ` — ${PROFILE_FIELD_LABELS[issue.field]}` : ""}: {issue.message}.{" "}
                    <span className="text-muted-foreground">{issue.recovery}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">The draft was not changed — the last valid state is still shown below.</p>
            </div>
          )}

          <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-4" data-testid="profile-editor-identity">
            <h2 className="text-lg font-semibold">2. Identity</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {viewModel.identity.filter((row) => row.editable).map((row) =>
                renderEditableInput(row, row.editable === "contactRef" ? "operator:my-team" : "Operator-supplied value"),
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Source kind:</span>
              <code className="rounded bg-black/30 px-1 font-mono">
                {viewModel.identity.find((row) => row.key === "identity.sourceKind")?.value}
              </code>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-4" data-testid="profile-editor-capabilities">
            <h2 className="text-lg font-semibold">3. Capability tags (untrusted imported content)</h2>
            <div className="flex flex-wrap gap-2" data-testid="profile-editor-capability-tags">
              {viewModel.capabilityTags.map((tag) => (
                <span key={tag.tag} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-xs">
                  <span className="font-mono">{tag.tag}</span>
                  <ProvenanceChip provenance={tag.provenance} />
                </span>
              ))}
            </div>
            <div className="space-y-4">
              {viewModel.capabilities.map((capability) => (
                <div
                  key={capability.capabilityId}
                  className={`rounded-xl border p-4 space-y-2 ${
                    capability.riskWarning ? "border-amber-500/30 bg-amber-950/10" : "border-white/10 bg-black/20"
                  }`}
                  data-testid={`profile-editor-capability-${capability.tag}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{capability.tag}</span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs">
                      risk: {capability.sideEffectRisk}
                    </span>
                    <ProvenanceChip provenance={capability.riskProvenance} />
                  </div>
                  {capability.riskWarning && (
                    <p className="text-xs text-amber-200" data-testid={`profile-editor-inferred-warning-${capability.tag}`}>
                      ⚠ {capability.riskWarning}
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-xs text-muted-foreground">
                          <th className="py-1.5 pr-3">Field</th>
                          <th className="py-1.5 pr-3">Value</th>
                          <th className="py-1.5 pr-3">Provenance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {capability.fields.map((row) => (
                          <tr key={row.key} className="border-b border-white/5">
                            <td className="py-1.5 pr-3 text-xs text-muted-foreground">{row.label}</td>
                            <td className="py-1.5 pr-3"><FieldValue row={row} /></td>
                            <td className="py-1.5 pr-3"><ProvenanceChip provenance={row.provenance} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-4" data-testid="profile-editor-invocation">
              <h2 className="text-lg font-semibold">4. Invocation &amp; downstream</h2>
              {viewModel.invocation.filter((row) => row.editable).map((row) =>
                renderEditableInput(row, "https://api.example.com/agent"),
              )}
              <ul className="space-y-1.5 text-xs">
                {viewModel.invocation
                  .filter((row) => !row.editable)
                  .map((row) => (
                    <li key={row.key} className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">{row.label}:</span>
                      <FieldValue row={row} />
                    </li>
                  ))}
              </ul>
              <div className="space-y-1.5 text-xs" data-testid="profile-editor-auth">
                <p className="font-semibold text-white/90">Auth requirements (names/hints only, never values)</p>
                {viewModel.authRequirements.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                    {viewModel.authRequirements.map((hint) => (
                      <li key={hint}>{hint}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-red-300/90">
                    unavailable — no auth requirements declared in imported metadata; confirm before wrapping.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-4" data-testid="profile-editor-payment">
              <h2 className="text-lg font-semibold">5. Pricing &amp; payment metadata</h2>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Status:</span>
                <span
                  className={`rounded-full border px-2 py-0.5 font-mono ${
                    viewModel.payment.status === "declared_unverified" ? READINESS_CHIP.needs_operator_review : READINESS_CHIP.blocked
                  }`}
                  data-testid="profile-editor-payment-status"
                >
                  {viewModel.payment.status}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-muted-foreground">
                  activation: {viewModel.payment.activation}
                </span>
              </div>
              {viewModel.payment.missingFields.length > 0 && (
                <p className="text-xs text-red-300" data-testid="profile-editor-payment-missing">
                  Missing required payment fields: {viewModel.payment.missingFields.join(", ")} — supply them
                  below or defer with a reason to continue.
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {viewModel.payment.rows.map((row) => renderEditableInput(row, PROFILE_FIELD_LABELS[row.editable!]))}
              </div>
              <div className="space-y-1 text-xs text-muted-foreground" data-testid="profile-editor-pricing">
                {viewModel.pricing.map((row) => (
                  <p key={row.key} className="flex flex-wrap items-center gap-2">
                    <span>{row.label}:</span> <FieldValue row={row} /> <ProvenanceChip provenance={row.provenance} />
                  </p>
                ))}
              </div>
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="profile-editor-trust">
              <h2 className="text-lg font-semibold">6. Trust state</h2>
              <ul className="space-y-1.5 text-xs">
                {viewModel.trust.map((row) => (
                  <li key={row.key} className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">{row.label}:</span>
                    <FieldValue row={row} />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Imported content can never self-assert trust; snapshot authenticity is not trust in the
                agent or its provider.
              </p>
            </section>

            <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="profile-editor-policy">
              <h2 className="text-lg font-semibold">7. Policy &amp; evidence expectations</h2>
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-white/90">Policy requirements</p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {viewModel.policyRequirements.map((item) => (
                    <li key={item} className="font-mono">{item}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-white/90">Evidence expectations</p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {viewModel.evidenceExpectations.map((item) => (
                    <li key={item} className="font-mono">{item}</li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="profile-editor-unavailable">
            <h2 className="text-lg font-semibold">Not carried by the profile-draft contract</h2>
            <p className="text-sm text-muted-foreground">
              These #385 sections have no distinct field on reddi.onboarding-rap-profile-draft.v1 and render
              honestly as unavailable rather than being fabricated.
            </p>
            <ul className="grid gap-2 text-xs md:grid-cols-2">
              {viewModel.unavailableSections.map((section) => (
                <li key={section.id} className="rounded-lg border border-white/10 bg-black/20 p-3" data-testid={`profile-editor-unavailable-${section.id}`}>
                  <p className="font-semibold text-white/90">
                    {section.label} <span className="ml-1 font-mono text-red-300/90">unavailable</span>
                  </p>
                  <p className="mt-1 text-muted-foreground">{section.note}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="profile-editor-diff">
            <h2 className="text-lg font-semibold">8. Diff — discovered metadata vs generated profile</h2>
            <p className="text-sm text-muted-foreground">
              What the imported snapshot declared versus what the generated RAP profile draft now carries
              (including analyser-added policy posture and operator edits).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Field</th>
                    <th className="py-2 pr-3">Discovered metadata</th>
                    <th className="py-2 pr-3">Generated profile</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {diffRows.map((row) => (
                    <tr key={row.field} className="border-b border-white/5" data-diff-status={row.status}>
                      <td className="py-2 pr-3 text-xs">{row.field}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {row.discovered ?? <span className="text-white/40">—</span>}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {row.generated ?? <span className="text-red-300/90">unavailable</span>}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${DIFF_CHIP[row.status]}`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3" data-testid="profile-editor-readiness">
            <h2 className="text-lg font-semibold">
              9. Readiness lanes — overall{" "}
              <span className={`ml-1 rounded-full border px-2 py-0.5 text-xs ${READINESS_CHIP[review.handoff.readiness.overall]}`} data-testid="profile-editor-readiness-overall">
                {review.handoff.readiness.overall}
              </span>
            </h2>
            <ul className="space-y-2">
              {review.handoff.readiness.lanes.map((lane) => (
                <li key={lane.lane} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${READINESS_CHIP[lane.status]}`}>{lane.status}</span>
                  <span className="font-mono text-xs">{lane.lane}</span>
                  <span className="text-xs text-muted-foreground">{lane.recommendations[0]}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-4" data-testid="profile-editor-gate">
            <h2 className="text-lg font-semibold">10. Save &amp; continue (local read-model decision)</h2>
            <p className="text-sm text-muted-foreground">
              Draft <code className="rounded bg-black/30 px-1 font-mono text-xs">{review.readModel.draftId}</code> is in
              state{" "}
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-xs text-amber-200">
                {decided && decision.ok ? decision.readModel.state : review.readModel.state}
              </span>
              . Continuing records a state-machine transition locally; no publication, payment activation,
              or trust change ever results from it.
            </p>

            {!decided && gate.blocked && (
              <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 space-y-3" data-testid="profile-editor-blocking">
                <p className="text-sm font-semibold text-red-300">Blocking readiness issues</p>
                <ul className="space-y-1 text-xs text-red-200/90">
                  {gate.blockedLanes.map((lane) => (
                    <li key={lane.lane}>
                      <span className="font-mono">{lane.lane}</span>: {lane.recommendations[0]} (
                      {lane.reasonCodes.join(", ")})
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Resolve the issues above (e.g. supply the missing payment fields), or explicitly defer them
                  with a reason. Deferral is recorded on the local read model only.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-editor-deferral-reason">Deferral reason (required to continue while blocked)</Label>
                  <textarea
                    id="profile-editor-deferral-reason"
                    data-testid="profile-editor-deferral-reason"
                    value={deferralReason}
                    onChange={(event) => setDeferralReason(event.target.value)}
                    rows={2}
                    placeholder="e.g. Payment metadata arrives from the provider next week; deferring payment setup."
                    className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-[#14F195]/50"
                    aria-describedby="profile-editor-deferral-hint"
                  />
                  <p id="profile-editor-deferral-hint" className="text-xs text-muted-foreground">
                    The reason is recorded verbatim in the transition&apos;s audit record.
                  </p>
                </div>
              </div>
            )}

            {!decided && (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" data-testid="profile-editor-apply" onClick={applyEdits}>
                  Apply edits &amp; regenerate draft
                </Button>
                <Button
                  type="button"
                  data-testid="profile-editor-continue"
                  disabled={!gate.canContinue}
                  onClick={continueReview}
                >
                  {gate.continueLabel}
                </Button>
                {!gate.canContinue && (
                  <p className="text-xs text-red-300" data-testid="profile-editor-continue-blocked-hint">
                    Save/continue is disabled until blocking readiness issues are resolved or explicitly
                    deferred with a reason.
                  </p>
                )}
              </div>
            )}

            {decision && !decision.ok && (
              <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 space-y-1 text-xs" role="alert" data-testid="profile-editor-decision-error">
                {decision.errors.map((error, index) => (
                  <p key={index} className="font-mono text-red-200/90">
                    {error.code} @ {error.path}: {error.message}
                  </p>
                ))}
              </div>
            )}

            {decided && decision.ok && (
              <div className="rounded-xl border border-[#14F195]/30 bg-[#14F195]/5 p-4 space-y-3" data-testid="profile-editor-decision">
                <p className="text-sm font-semibold">
                  {decision.deferred ? "Blocking issues deferred — decision recorded" : "Review saved — decision recorded"}
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>
                    Transition:{" "}
                    <span className="font-mono text-white/90">
                      {decision.record.from} → {decision.record.to}
                    </span>{" "}
                    (scope: <span className="font-mono">{decision.record.scope}</span>)
                  </li>
                  <li>
                    Audit reason: <span className="text-white/90">{decision.record.reason}</span>
                  </li>
                  <li>
                    Open blocking gates:{" "}
                    <span className="font-mono">
                      {decision.readModel.blockingGates.map((blockingGate) => blockingGate.gate).join(", ") || "none"}
                    </span>
                  </li>
                  <li>
                    Allowed next states: <span className="font-mono">{decision.nextStates.join(", ")}</span>
                  </li>
                </ul>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="profile-editor-publication-ledger">
                  {Object.entries(decision.readModel.publication).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[11px]">
                      <span className="font-mono text-muted-foreground">{key}</span>{" "}
                      <span className="font-semibold text-red-300">{String(value)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Publication ledger stays hard-false: this decision is a local read-model event with no
                  publication side effects (published_candidate remains internal-only under #395).
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/onboarding/readiness-gate?scenario=${READINESS_GATE_SCENARIO_BY_PROFILE[scenarioId]}`}
                    data-testid="profile-editor-readiness-gate-entry"
                    className="inline-flex min-h-9 items-center rounded-lg border border-[#14F195]/30 bg-[#14F195]/5 px-3 text-sm text-[#14F195] hover:border-[#14F195]/60"
                  >
                    Continue to payment &amp; readiness gates →
                  </Link>
                  <Button type="button" variant="outline" data-testid="profile-editor-reset" onClick={() => selectScenario(scenarioId)}>
                    Start a new review
                  </Button>
                </div>
              </div>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/onboarding/intake"
              className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
            >
              Back to guided intake
            </Link>
            <Link
              href="/register"
              className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
            >
              Manual registration
            </Link>
            <Link
              href="/manager/listings"
              className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
            >
              Operator review queue
            </Link>
            <Link
              href="/onboarding/readiness-gate"
              data-testid="profile-editor-readiness-gate-footer-link"
              className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
            >
              Payment &amp; readiness gates
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
