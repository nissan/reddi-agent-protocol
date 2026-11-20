// Newsletter flow (WEB-07, hardened in WEB-25): subscribe, confirm, unsubscribe, delete and broadcast as pure
// functions over a ContactStore, a Mailer and a clock. Routes and scripts are thin wrappers. Generic outcomes
// are returned to callers so an endpoint never reveals whether an address is known. Every state change is a
// compare-and-swap on the stored version and is retried from a fresh read on conflict, so a prefetched
// confirmation racing a one-click unsubscribe can never reinstate the contact, and concurrent subscribes
// count every confirmation email.
import type { NewsletterConfig } from "./config.ts";
import { recipientAllowed } from "./config.ts";
import { SIGNUP_COPY } from "./copy.ts";
import { CATCH_UP_LABEL, catchUpLink } from "./links.ts";
import { logProviderRefusal, type Mailer } from "./mailer.ts";
import type { Broadcast, Contact, ContactStore, Versioned } from "./store.ts";
import { ConflictError, contactKey, normaliseEmail } from "./store.ts";
import { issueToken, verifyToken } from "./tokens.ts";

export type Deps = { store: ContactStore; mailer: Mailer; config: NewsletterConfig; siteUrl: string; now: () => number };

export const MAX_CONFIRM_SENDS_PER_DAY = 3;
export const CAS_RETRIES = 6; // enough for several simultaneous callers on one key to each get a turn
export const BROADCAST_LEASE_MS = 10 * 60 * 1000; // a run that stops without clearing its lease can be resumed after this
// WEB-31 / WEB-04: a pending record whose last confirmation email is older than this is deleted. The privacy page
// prints the same number (lib/policy.ts, checked by tests/policy.test.ts), so the two cannot drift apart.
export const PENDING_RETENTION_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function validEmail(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length <= 254 && EMAIL_RE.test(raw.trim());
}

// Runs `attempt` against a fresh read until the conditional write succeeds or the retries run out.
async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < CAS_RETRIES; i++) {
    try { return await fn(); } catch (error) { if (!(error instanceof ConflictError)) throw error; last = error; }
  }
  throw last;
}

export type SubscribeOutcome = "accepted" | "invalid" | "not-allowed" | "rate-limited" | "already-confirmed" | "unsubscribed-resubscribe-sent";

// Gives a reservation back after a provider failure (WEB-27-S01). Always from a fresh read and always conditional:
// a record this request created and nobody touched since is deleted with a version check; any other record has its
// count decremented with a version check, so a concurrent subscriber's record, status and link survive. If the
// writes keep losing races the reservation is left in place: a lost unit of daily allowance is the safe failure.
async function releaseReservation(deps: Deps, key: string, createdVersion: string | null): Promise<void> {
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    try {
      const fresh = await deps.store.getContact(key);
      if (!fresh) return;
      if (createdVersion !== null && fresh.version === createdVersion) { await deps.store.deleteContact(key, { version: fresh.version }); return; }
      if (fresh.value.sendCount <= 0) return;
      await deps.store.putContact(key, { ...fresh.value, sendCount: fresh.value.sendCount - 1 }, { version: fresh.version });
      return;
    } catch (error) { if (!(error instanceof ConflictError)) return; }
  }
}

// Returns a precise outcome for tests; the HTTP layer collapses every outcome but "invalid" to one generic reply.
// The send-count reservation is written before the email goes out, so two concurrent requests can never both
// pass the limit; if the provider then fails, the reservation is given back with conditional writes.
export async function subscribe(deps: Deps, rawEmail: unknown): Promise<SubscribeOutcome> {
  if (!validEmail(rawEmail)) return "invalid";
  const email = normaliseEmail(rawEmail);
  if (!recipientAllowed(deps.config, email)) return "not-allowed"; // no write, no send
  const key = contactKey(email);
  return withRetries(async () => {
    const existing = await deps.store.getContact(key);
    if (existing?.value.status === "confirmed") return "already-confirmed"; // no resend, no state change
    // A new confirmation link must be issued strictly after any unsubscribe so the replay check in confirm() accepts it.
    const now = Math.max(deps.now(), (existing?.value.unsubscribedAt ?? 0) + 1);
    let contact: Contact = existing?.value ?? { email, status: "pending", createdAt: now, confirmedAt: null, unsubscribedAt: null, sendWindowStart: now, sendCount: 0 };
    if (now - contact.sendWindowStart >= DAY) contact = { ...contact, sendWindowStart: now, sendCount: 0 };
    if (contact.sendCount >= MAX_CONFIRM_SENDS_PER_DAY) return "rate-limited";
    // WEB-38: everyone who asks through the form asks to be told about a build. A pending record that is already flagged
    // keeps its original time; an unflagged old record or a re-subscribe after an unsubscribe is flagged from this request.
    const keepFlag = contact.earlyAccess === true && contact.status !== "unsubscribed" && !!contact.earlyAccessAt;
    const flagged = keepFlag ? { earlyAccess: true, earlyAccessAt: contact.earlyAccessAt } : { earlyAccess: true, earlyAccessAt: new Date(now).toISOString() };
    const reserved = { ...contact, ...flagged, sendCount: contact.sendCount + 1, lastSentAt: now };
    const version = await deps.store.putContact(key, reserved, { version: existing?.version ?? null }); // conflict => retry from a fresh read
    const token = issueToken(deps.config.signingSecret, "confirm", key, now);
    const link = `${deps.siteUrl}/newsletter/confirm?t=${encodeURIComponent(token)}`;
    const catchUp = catchUpLink(deps.siteUrl);
    try {
      await deps.mailer.send({
        to: email,
        subject: SIGNUP_COPY.email.subject,
        text: SIGNUP_COPY.email.text(link, catchUp),
        html: SIGNUP_COPY.email.html(link, catchUp),
      });
    } catch (error) {
      logProviderRefusal("confirmation", error); // WEB-59: one named line, operation and status class only
      // Give the reservation back so a provider outage does not consume the address's daily allowance.
      await releaseReservation(deps, key, existing ? null : version);
      throw error;
    }
    return existing?.value.status === "unsubscribed" ? "unsubscribed-resubscribe-sent" : "accepted";
  });
}

export type ConfirmOutcome = "confirmed" | "already-confirmed" | "invalid" | "expired" | "superseded";

export async function confirm(deps: Deps, token: string): Promise<ConfirmOutcome> {
  const now = deps.now();
  const v = verifyToken(deps.config.signingSecret, token, "confirm", now);
  if (!v.ok) return v.reason === "expired" ? "expired" : "invalid";
  return withRetries(async () => {
    const stored = await deps.store.getContact(v.payload.k);
    if (!stored) return "invalid"; // token for an address we never stored (or deleted): nothing to confirm
    const contact = stored.value;
    // Replay safety: a confirmation link issued before an unsubscribe can never resubscribe.
    if (contact.unsubscribedAt !== null && v.payload.iat <= contact.unsubscribedAt) return "superseded";
    if (contact.status === "confirmed") return "already-confirmed";
    await deps.store.putContact(v.payload.k, { ...contact, status: "confirmed", confirmedAt: now }, { version: stored.version });
    return "confirmed";
  });
}

export type UnsubscribeOutcome = "unsubscribed" | "already-unsubscribed" | "invalid";

export async function unsubscribe(deps: Deps, token: string): Promise<UnsubscribeOutcome> {
  const now = deps.now();
  const v = verifyToken(deps.config.signingSecret, token, "unsubscribe", now);
  if (!v.ok) return "invalid";
  return withRetries(async () => {
    const stored = await deps.store.getContact(v.payload.k);
    if (!stored) return "already-unsubscribed"; // nothing stored means nothing will be sent
    if (stored.value.status === "unsubscribed") return "already-unsubscribed";
    await deps.store.putContact(v.payload.k, { ...stored.value, status: "unsubscribed", unsubscribedAt: now }, { version: stored.version });
    return "unsubscribed";
  });
}

// The moment the pending-record retention period is measured from: the last confirmation send. Records written
// before WEB-31 lack `lastSentAt`; their last send happened somewhere inside the day that began at `sendWindowStart`,
// so the end of that window stands in. That is never earlier than the real last send, so a legacy record is kept at
// least the full period and at most one day longer; it is never deleted early.
export function lastConfirmationSendAt(contact: Contact): number {
  return contact.lastSentAt ?? contact.sendWindowStart + DAY;
}

export type PruneReport = { examined: number; pending: number; stale: number; removed: number; skipped: number; dryRun: boolean; days: number };

// WEB-31 retention purge: deletes pending records whose last confirmation email is older than `days`. Confirmed and
// unsubscribed records are never touched (an unsubscribed record is what keeps an old confirmation link refused).
// Every delete is conditional on the version read, so a visitor who confirms or asks for a new link while the purge
// runs keeps their record: that delete loses the race and is counted as skipped, never retried. A dry run only
// counts. The report carries counts only, so a scheduled run can log it without ever logging an address or key.
export async function prunePending(deps: Deps, options: { days?: number; dryRun?: boolean } = {}): Promise<PruneReport> {
  const days = options.days ?? PENDING_RETENTION_DAYS;
  if (!Number.isFinite(days) || days <= 0) throw new RangeError("retention period must be a positive number of days");
  const dryRun = options.dryRun ?? false;
  const cutoff = deps.now() - days * DAY;
  const report: PruneReport = { examined: 0, pending: 0, stale: 0, removed: 0, skipped: 0, dryRun, days };
  for (const c of await deps.store.listContacts()) {
    report.examined++;
    if (c.value.status !== "pending") continue;
    report.pending++;
    if (lastConfirmationSendAt(c.value) >= cutoff) continue;
    report.stale++;
    if (dryRun) continue;
    try { await deps.store.deleteContact(contactKey(c.value.email), { version: c.version }); report.removed++; }
    catch (error) { if (!(error instanceof ConflictError)) throw error; report.skipped++; }
  }
  return report;
}

// Deletion request: removes the record entirely (the documented retention action).
export async function deleteContact(deps: Deps, rawEmail: string): Promise<"deleted"> {
  await deps.store.deleteContact(contactKey(normaliseEmail(rawEmail)));
  return "deleted";
}

// Broadcast eligibility, shared by the newsletter send and the early-access list: confirmed (so never pending or
// unsubscribed) and, under the partial-start contract, on the allowlist.
function eligible(deps: Deps, c: Contact): boolean {
  return c.status === "confirmed" && recipientAllowed(deps.config, c.email);
}

// How many contacts a broadcast would reach right now (a count, never an address): for dry runs and the health report.
export async function countEligible(deps: Deps): Promise<number> {
  return (await deps.store.listContacts()).filter((c) => eligible(deps, c.value)).length;
}

// WEB-38: the confirmed contacts who asked to be told when there is a build to try, for a future early-access message.
// Same eligibility as a broadcast, plus the flag; an unsubscribed contact keeps the flag in the record but is excluded
// here because unsubscribing ends both promises. Records without the flag (written before WEB-38) are not included.
// This only selects; nothing here sends.
export async function earlyAccessRecipients(deps: Deps): Promise<Contact[]> {
  return (await deps.store.listContacts()).map((c) => c.value).filter((c) => eligible(deps, c) && c.earlyAccess === true);
}

export type ContactCounts = { total: number; pending: number; confirmed: number; unsubscribed: number; earlyAccessConfirmed: number; earlyAccessPending: number; earlyAccessUnsubscribed: number };

// Counts only: no address, key or timestamp, so the owner can report the size of the list safely.
export function countContacts(contacts: Contact[]): ContactCounts {
  const n: ContactCounts = { total: contacts.length, pending: 0, confirmed: 0, unsubscribed: 0, earlyAccessConfirmed: 0, earlyAccessPending: 0, earlyAccessUnsubscribed: 0 };
  for (const c of contacts) {
    n[c.status]++;
    if (c.earlyAccess === true) { if (c.status === "confirmed") n.earlyAccessConfirmed++; else if (c.status === "pending") n.earlyAccessPending++; else n.earlyAccessUnsubscribed++; }
  }
  return n;
}

// WEB-40: the server-side funnel, from the contact store alone (so it counts visitors who declined measurement too).
// Numbers only: no address, no key, no individual time. `confirmedAt` is already stored by the confirm write (a
// compare-and-swap), so nothing is added to the records; a confirmed record without a usable time (written before
// the field existed, or null) is counted as `confirmedTimeUnknown` and left out of the per-day and delay figures.
// "Never confirmed" is a pending contact whose signup (`createdAt`) is older than two days. The confirmation link is
// valid for 48 hours, so by then it has expired and the contact can only be an unconfirmed signup. Pending records
// are purged after PENDING_RETENTION_DAYS, so the count covers only those still retained.
export const NEVER_CONFIRMED_AFTER_MS = 2 * DAY;
export const FUNNEL_DAYS = 14;
export type FunnelReport = {
  confirmed: number;
  confirmedEarlyAccess: number;
  pending: number;
  pendingOlderThanTwoDays: number;
  // pendingOlderThanTwoDays / pending (null when nothing is pending).
  neverConfirmedShareOfPending: number | null;
  // pendingOlderThanTwoDays / contacts whose signup is older than two days (null when there are none): the share of
  // matured signups that never confirmed, the deliverability signal WEB-30 reads.
  neverConfirmedShareOfMatured: number | null;
  maturedSignups: number;
  confirmedTimeUnknown: number;
  // Median minutes from signup to confirmation among confirmed contacts with a known time (null when none).
  medianMinutesToConfirm: number | null;
  // UTC calendar days, oldest first, last FUNNEL_DAYS including today.
  confirmationsPerDay: { day: string; confirmed: number }[];
};

const ratio = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000);

export function funnelReport(contacts: Contact[], now: number): FunnelReport {
  const r = { confirmed: 0, confirmedEarlyAccess: 0, pending: 0, pendingOlderThanTwoDays: 0, maturedSignups: 0, confirmedTimeUnknown: 0 };
  const perDay = new Map<string, number>();
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  for (let i = FUNNEL_DAYS - 1; i >= 0; i--) perDay.set(new Date(today.getTime() - i * DAY).toISOString().slice(0, 10), 0);
  const delays: number[] = [];
  for (const c of contacts) {
    const matured = typeof c.createdAt === "number" && now - c.createdAt > NEVER_CONFIRMED_AFTER_MS;
    if (matured) r.maturedSignups++;
    if (c.status === "pending") { r.pending++; if (matured) r.pendingOlderThanTwoDays++; }
    if (c.status === "confirmed") {
      r.confirmed++;
      if (c.earlyAccess === true) r.confirmedEarlyAccess++;
    }
    if (c.status !== "pending") {
      // A contact who confirmed and later unsubscribed still confirmed once; only the confirmation time matters here.
      const at = c.confirmedAt;
      if (typeof at !== "number" || !Number.isFinite(at)) { if (c.status === "confirmed") r.confirmedTimeUnknown++; continue; }
      const day = new Date(at).toISOString().slice(0, 10);
      if (perDay.has(day)) perDay.set(day, (perDay.get(day) ?? 0) + 1);
      if (typeof c.createdAt === "number" && at >= c.createdAt) delays.push(at - c.createdAt);
    }
  }
  delays.sort((a, b) => a - b);
  const median = delays.length === 0 ? null : delays.length % 2 ? delays[(delays.length - 1) / 2] : (delays[delays.length / 2 - 1] + delays[delays.length / 2]) / 2;
  return {
    ...r,
    neverConfirmedShareOfPending: ratio(r.pendingOlderThanTwoDays, r.pending),
    neverConfirmedShareOfMatured: ratio(r.pendingOlderThanTwoDays, r.maturedSignups),
    medianMinutesToConfirm: median === null ? null : Math.round((median / 60_000) * 10) / 10,
    confirmationsPerDay: [...perDay].map(([day, confirmed]) => ({ day, confirmed })),
  };
}

// `catchUpUrl` (a tagged link) adds the "Catch up on earlier updates" line after the read link; an issue without it is unchanged.
export type Issue = { slug: string; title: string; summary: string; url: string; html: string; text: string; catchUpUrl?: string;
  // WEB-61: an optional extra for one recipient (their own signed early-access build link). Returns null for anyone who is not due one. Added after the read links, before the unsubscribe line.
  forRecipient?: (contact: Contact, key: string, now: number) => { text: string; html: string } | null };
export type BroadcastOutcome =
  | { outcome: "sent"; sentId: string; sentAt: string; recipients: number; delivered: number; resumed: boolean }
  | { outcome: "already-sent"; sentId: string; sentAt: string; recipients: number }
  | { outcome: "not-approved" }
  | { outcome: "no-recipients" }
  | { outcome: "in-progress-elsewhere" };

// Exactly one complete broadcast per slug. `approval` is the owner's explicit send approval recorded by the caller;
// publishing to main alone never reaches this function with approval set. The ledger is claimed with a create-only
// write, so two overlapping runs cannot both start; a resume claims the existing ledger with a conditional write of
// its `runningSince` lease (WEB-27), so two concurrent resumes cannot both email the first remaining recipient.
// Progress is written per recipient with compare-and-swap, so a mailer failure stops the run with the ledger showing
// who was reached (and the lease cleared), and the next approved run resumes with the remaining recipients under the
// original sentId. `recipients` is recomputed on completion so it always equals the number actually delivered.
// "already-sent" is returned only for a complete ledger.
//
// Automatic issues (WEB-55) pass `options`; the owner script passes none and behaves exactly as before.
//  - `audience` narrows the eligible contacts further (confirmed at or before the issue's due moment, or confirmed
//    inside its welcome window). It can only remove recipients, never add one beyond `eligible`.
//  - `reopen` lets the run act on a COMPLETE ledger: only contacts in the audience who are not already in `delivered`
//    are sent to, under the same lease and per-recipient compare-and-swap, and the ledger stays complete throughout, so
//    a crash leaves nothing worse than the documented one-recipient window. With nobody left it writes nothing.
//  - `recordEmpty` writes a complete ledger with zero recipients when there is nobody to send to (create-only), so an
//    issue with no audience at its due moment is closed rather than left waiting for later subscribers.
export type BroadcastOptions = { audience?: (c: Contact) => boolean; reopen?: boolean; recordEmpty?: boolean };
export async function broadcast(deps: Deps, issue: Issue, approval: { approved: boolean; sentId: string }, options: BroadcastOptions = {}): Promise<BroadcastOutcome> {
  if (!approval.approved) return { outcome: "not-approved" };
  const existing = await deps.store.getBroadcast(issue.slug);
  if (existing?.value.complete && !options.reopen) return { outcome: "already-sent", sentId: existing.value.sentId, sentAt: existing.value.sentAt, recipients: existing.value.recipients };
  const confirmed = (await deps.store.listContacts()).map((c) => c.value).filter((c) => eligible(deps, c) && (options.audience?.(c) ?? true));
  const delivered = new Set(existing?.value.delivered ?? []);
  const remaining = confirmed.filter((c) => !delivered.has(contactKey(c.email)));
  if (existing?.value.complete && remaining.length === 0) return { outcome: "no-recipients" }; // a reopened ledger with nobody new: no write
  if (!existing && remaining.length === 0) {
    if (!options.recordEmpty) return { outcome: "no-recipients" };
    const at = new Date(deps.now()).toISOString();
    const empty: Broadcast = { slug: issue.slug, sentId: approval.sentId, sentAt: at, recipients: 0, delivered: [], complete: true, runningSince: null };
    try { await deps.store.putBroadcast(empty, { version: null }); } // create-only: a concurrent run that claimed the slug wins
    catch (error) { if (error instanceof ConflictError) return { outcome: "in-progress-elsewhere" }; throw error; }
    return { outcome: "sent", sentId: empty.sentId, sentAt: at, recipients: 0, delivered: 0, resumed: false };
  }
  let ledger: Versioned<Broadcast>;
  const now = deps.now();
  if (existing) {
    const lease = existing.value.runningSince ?? null;
    if (lease !== null && now - lease < BROADCAST_LEASE_MS) return { outcome: "in-progress-elsewhere" }; // another run holds the lease
    const claimed: Broadcast = { ...existing.value, runningSince: now };
    try { ledger = { value: claimed, version: await deps.store.putBroadcast(claimed, { version: existing.version }) }; } // claim the resume exactly once
    catch (error) { if (error instanceof ConflictError) return { outcome: "in-progress-elsewhere" }; throw error; }
  } else {
    const fresh: Broadcast = { slug: issue.slug, sentId: approval.sentId, sentAt: new Date(now).toISOString(), recipients: confirmed.length, delivered: [], complete: false, runningSince: now };
    try { ledger = { value: fresh, version: await deps.store.putBroadcast(fresh, { version: null }) }; } // claim the slug exactly once
    catch (error) { if (error instanceof ConflictError) return { outcome: "in-progress-elsewhere" }; throw error; }
  }
  for (const c of remaining) {
    const key = contactKey(c.email);
    const unsub = `${deps.siteUrl}/api/newsletter/unsubscribe?t=${encodeURIComponent(issueToken(deps.config.signingSecret, "unsubscribe", key, deps.now()))}`;
    const unsubPage = `${deps.siteUrl}/newsletter/unsubscribe?t=${encodeURIComponent(issueToken(deps.config.signingSecret, "unsubscribe", key, deps.now()))}`;
    const extra = issue.forRecipient?.(c, key, deps.now()) ?? null;
    try {
      await deps.mailer.send({
        to: c.email,
        subject: issue.title,
        text: `${issue.text}\n\nRead on the site: ${issue.url}${issue.catchUpUrl ? `\n\n${CATCH_UP_LABEL}: ${issue.catchUpUrl}` : ""}${extra ? `\n\n${extra.text}` : ""}\n\nUnsubscribe: ${unsubPage}`,
        html: `${issue.html}<p><a href="${issue.url}">Read on the site</a></p>${issue.catchUpUrl ? `<p><a href="${issue.catchUpUrl}">${CATCH_UP_LABEL}</a></p>` : ""}${extra ? extra.html : ""}<p><a href="${unsubPage}">Unsubscribe</a> with one click. You're receiving this because you confirmed your subscription at battleblocks.app.</p>`,
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
    } catch (error) {
      logProviderRefusal("issue", error); // WEB-59: one named line, operation and status class only
      // Release the lease so the owner can resume at once; if this write loses, the lease expires on its own.
      try { await deps.store.putBroadcast({ ...ledger.value, runningSince: null }, { version: ledger.version }); } catch { /* lease expires after BROADCAST_LEASE_MS */ }
      throw error;
    }
    // Each progress write also renews the lease, so a long run (thousands of recipients, a rate-limited mailer) is never mistaken for a crashed one.
    const next = { ...ledger.value, delivered: [...ledger.value.delivered, key], runningSince: deps.now() };
    ledger = { value: next, version: await deps.store.putBroadcast(next, { version: ledger.version }) }; // a conflict here means another run touched the ledger: stop rather than double-send
  }
  const complete: Broadcast = { ...ledger.value, recipients: ledger.value.delivered.length, complete: true, runningSince: null };
  await deps.store.putBroadcast(complete, { version: ledger.version });
  return { outcome: "sent", sentId: complete.sentId, sentAt: complete.sentAt, recipients: complete.recipients, delivered: complete.delivered.length, resumed: existing !== null };
}
