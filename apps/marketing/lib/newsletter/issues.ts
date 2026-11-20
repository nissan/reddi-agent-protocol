// Newsletter issues. An update (lib/updates.ts) flagged `newsletterSend: true` is emailed to confirmed subscribers once
// it is published and its date has arrived; the reviewed, merged change that sets the flag is the owner's approval. This
// module holds the rules, independent of HTTP: which updates are due, how the email is built, and the run that sends at
// most one issue through `broadcast`. `broadcast` makes a send idempotent and resumable: its ledger (one document per
// slug, written with compare-and-swap) records who was reached, so an interrupted run resumes without sending anyone a
// second copy and a complete issue is never sent again. Nothing here logs or returns an address.
import { randomUUID } from "node:crypto";
import type { Update } from "../updates.ts";
import { broadcast, countEligible, type Deps, type Issue } from "./flow.ts";
import { catchUpLink, updateLink } from "./links.ts";

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// The part of an update the issue rules need.
export type IssueUpdate = Pick<Update, "slug" | "title" | "summary" | "date" | "status" | "newsletterSend">;

// Update dates are calendar days in Sydney. The daily run is at 23:10 UTC, mid-morning in Sydney on the next calendar
// day there, so an update dated the 5th goes out on the morning of the 5th Sydney time.
export function sydneyDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

// Flagged, published and dated today (Sydney) or earlier. Oldest first. A draft is never due, and neither is a
// published update dated in the future.
export function dueIssues(updates: readonly IssueUpdate[], now: number): IssueUpdate[] {
  const today = sydneyDay(now);
  return updates
    .filter((u) => u.newsletterSend === true && u.status === "published" && u.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.slug.localeCompare(b.slug)));
}

// The issue email: title and summary, a link to the update's page, a link to the status page, and (added by
// `broadcast`) the one-click unsubscribe. It says nothing beyond the update's own title and summary.
export function buildIssue(siteUrl: string, update: Pick<IssueUpdate, "slug" | "title" | "summary">): Issue {
  return {
    slug: update.slug,
    title: update.title,
    summary: update.summary,
    url: updateLink(siteUrl, update.slug),
    catchUpUrl: catchUpLink(siteUrl),
    text: `${update.title}\n\n${update.summary}`,
    html: `<h1>${esc(update.title)}</h1><p>${esc(update.summary)}</p>`,
  };
}

export type IssueState = "unsent" | "partial" | "sent";
export type IssuePlanEntry = { slug: string; date: string; state: IssueState };

// Where each due issue stands in the store: no ledger (unsent), an incomplete ledger (partial: a run was interrupted)
// or a complete one (sent). Read only.
export async function planIssues(deps: Deps, updates: readonly IssueUpdate[]): Promise<IssuePlanEntry[]> {
  const out: IssuePlanEntry[] = [];
  for (const u of dueIssues(updates, deps.now())) {
    const ledger = await deps.store.getBroadcast(u.slug);
    out.push({ slug: u.slug, date: u.date, state: !ledger ? "unsent" : ledger.value.complete ? "sent" : "partial" });
  }
  return out;
}

export type IssuesReport =
  | { outcome: "none-due"; due: number }
  | { outcome: "no-recipients"; slug: string; due: number }
  | { outcome: "in-progress-elsewhere"; slug: string; due: number }
  | { outcome: "sent"; slug: string; due: number; recipients: number; delivered: number; resumed: boolean };

// One run sends at most one issue, the oldest due one that is not complete, to everyone who is confirmed at that
// moment (and, until NEWSLETTER_PUBLIC=1, on the allowlist). An issue that falls due with nobody to send to is
// recorded complete with zero recipients, so it is never emailed to people who join later; they read it on /updates.
// A failure part-way throws: the ledger shows who was reached and the next run resumes the rest.
export async function runIssues(deps: Deps, updates: readonly IssueUpdate[]): Promise<IssuesReport> {
  const due = dueIssues(updates, deps.now());
  let closedEmpty: string | null = null;
  for (const update of due) {
    const ledger = await deps.store.getBroadcast(update.slug);
    if (ledger?.value.complete) continue;
    const result = await broadcast(deps, buildIssue(deps.siteUrl, update), { approved: true, sentId: randomUUID() }, { recordEmpty: true });
    switch (result.outcome) {
      case "sent":
        if (result.recipients === 0 && result.delivered === 0 && !result.resumed) { closedEmpty ??= update.slug; continue; } // closed, nothing sent
        return { outcome: "sent", slug: update.slug, due: due.length, recipients: result.recipients, delivered: result.delivered, resumed: result.resumed };
      case "in-progress-elsewhere": return { outcome: "in-progress-elsewhere", slug: update.slug, due: due.length };
      case "already-sent": case "no-recipients": continue; // completed between the read above and the claim: try the next
      case "not-approved": throw new Error("unreachable: approval is always given here");
    }
  }
  return closedEmpty ? { outcome: "no-recipients", slug: closedEmpty, due: due.length } : { outcome: "none-due", due: due.length };
}

// For a dry run: what the next run would do, as slugs and counts only.
export async function previewIssues(deps: Deps, updates: readonly IssueUpdate[]): Promise<{ wouldReach: number; issues: IssuePlanEntry[] }> {
  return { wouldReach: await countEligible(deps), issues: await planIssues(deps, updates) };
}
