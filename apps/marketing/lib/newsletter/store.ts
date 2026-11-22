// Contact storage for the newsletter (WEB-07, hardened in WEB-25). One JSON document per contact, keyed by a
// SHA-256 of the normalised address, plus one document per broadcast ledger. Every read returns the document
// with an opaque version tag and every write is conditional on it (compare-and-swap), so two concurrent changes
// cannot silently overwrite each other; a create-only write claims a key exactly once.
// `MemoryStore` backs the unit tests; `BlobStore` uses Vercel Blob (private access) in deployments.
import { createHash } from "node:crypto";

export type ContactStatus = "pending" | "confirmed" | "unsubscribed";
export type Contact = {
  email: string;
  status: ContactStatus;
  createdAt: number;
  confirmedAt: number | null;
  unsubscribedAt: number | null;
  // Confirmation sends in the current window, for the per-address rate limit.
  sendWindowStart: number;
  sendCount: number;
  // When the last confirmation email was sent (WEB-31); the pending-record purge measures its period from here.
  // Records written before WEB-31 lack the field and fall back to `sendWindowStart`.
  lastSentAt?: number | null;
  // WEB-38: the one signup is also the early-access signup. `earlyAccess` is true for a contact created or re-subscribed
  // from the form that says "tell me when there is a build to try"; `earlyAccessAt` is the ISO time it was set.
  // Both are set at subscribe and survive confirm and unsubscribe. Records written before WEB-38 lack them and are
  // treated as not flagged; no migration rewrites them.
  earlyAccess?: boolean;
  earlyAccessAt?: string | null;
};
// `delivered` holds the contact keys already sent, so an interrupted broadcast resumes instead of resending or
// claiming completion; `complete` is set only when every intended recipient has been sent. `runningSince` (WEB-27)
// is the lease a run holds while it sends: a resume must claim it with a conditional write, so two concurrent
// resumes cannot both email the first remaining recipient. Ledgers written before WEB-27 lack the field.
export type Broadcast = { slug: string; sentId: string; sentAt: string; recipients: number; delivered: string[]; complete: boolean; runningSince?: number | null };
// One request counter per client bucket for the durable burst limiter (WEB-27, WEB-28). The bucket name is a keyed
// hash of the client address, so the store never holds an address; the window start lives inside the document, so
// a returning client reuses one document instead of leaving one per minute behind. Stale documents are swept.
export type Limit = { count: number; windowStart: number };

export type Versioned<T> = { value: T; version: string };
// `version: null` means "create only: fail if the document already exists".
export type WriteCondition = { version: string | null };

export class ConflictError extends Error {
  readonly pathname: string;
  constructor(pathname: string) { super(`write conflict on ${pathname}`); this.name = "ConflictError"; this.pathname = pathname; }
}

export interface ContactStore {
  getContact(key: string): Promise<Versioned<Contact> | null>;
  putContact(key: string, contact: Contact, condition: WriteCondition): Promise<string>;
  // Without a condition the delete is unconditional (the owner's deletion action); with one it fails with
  // ConflictError if the document changed since it was read, so a rollback never removes another writer's record.
  deleteContact(key: string, condition?: WriteCondition): Promise<void>;
  listContacts(): Promise<Versioned<Contact>[]>;
  // Contacts whose document was last written before `olderThan` (ms since epoch), for the retention purge. Callers
  // still check each record's own times; a store that cannot tell write times returns every contact.
  listContactsWrittenBefore(olderThan: number): Promise<Versioned<Contact>[]>;
  getBroadcast(slug: string): Promise<Versioned<Broadcast> | null>;
  putBroadcast(broadcast: Broadcast, condition: WriteCondition): Promise<string>;
  getLimit(bucket: string): Promise<Versioned<Limit> | null>;
  putLimit(bucket: string, limit: Limit, condition: WriteCondition): Promise<string>;
  // Removes limiter documents last written before `olderThan` (ms since epoch); returns how many were removed.
  pruneLimits(olderThan: number): Promise<number>;
  // WEB-19: a read-only look at the limiter counters last written at or after `since` (ms since epoch), for the health
  // report. At most `max` documents are read; `truncated` says there were more. Never returns a bucket name.
  listLimitsSince(since: number, max: number): Promise<{ limits: Limit[]; truncated: boolean }>;
  // WEB-48: a read-only, bounded look at the contacts for the health report. Reads at most `max` records, the most
  // recently written first, and says whether there were more (`truncated`, routine above `max` contacts). WEB-50: `listingCut`
  // is separate and means the listing itself hit its page bound, so records the listing never reached may be newer. Writes nothing.
  listRecentContacts(max: number): Promise<{ contacts: Versioned<Contact>[]; truncated: boolean; listingCut: boolean }>;
}

// WEB-48: the listing is walked at most this many pages (1000 entries each) before the result is marked truncated, so
// the number of list calls is bounded as well as the number of record reads.
export const MAX_CONTACT_LIST_PAGES = 20;
const READ_BATCH = 20;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function contactKey(email: string): string {
  return createHash("sha256").update(normaliseEmail(email)).digest("hex");
}

export class MemoryStore implements ContactStore {
  contacts = new Map<string, Versioned<Contact>>();
  broadcasts = new Map<string, Versioned<Broadcast>>();
  limits = new Map<string, Versioned<Limit>>();
  limitWrittenAt = new Map<string, number>();
  clock: () => number = () => Date.now();
  private counter = 0;
  private write<T>(map: Map<string, Versioned<T>>, key: string, value: T, condition: WriteCondition): string {
    const current = map.get(key);
    if ((current?.version ?? null) !== condition.version) throw new ConflictError(key);
    const version = String(++this.counter);
    map.set(key, { value: structuredClone(value), version });
    return version;
  }
  async getContact(key: string) { const c = this.contacts.get(key); return c ? { value: structuredClone(c.value), version: c.version } : null; }
  async putContact(key: string, contact: Contact, condition: WriteCondition) { return this.write(this.contacts, key, contact, condition); }
  async deleteContact(key: string, condition?: WriteCondition) {
    if (condition && (this.contacts.get(key)?.version ?? null) !== condition.version) throw new ConflictError(key);
    this.contacts.delete(key);
  }
  async listContacts() { return [...this.contacts.values()].map((c) => ({ value: structuredClone(c.value), version: c.version })); }
  async listContactsWrittenBefore(_olderThan: number) { return this.listContacts(); }
  async listRecentContacts(max: number) {
    const sorted = [...this.contacts.values()].sort((a, b) => b.value.createdAt - a.value.createdAt);
    return { contacts: sorted.slice(0, max).map((c) => ({ value: structuredClone(c.value), version: c.version })), truncated: sorted.length > max, listingCut: false };
  }
  async getBroadcast(slug: string) { const b = this.broadcasts.get(slug); return b ? { value: structuredClone(b.value), version: b.version } : null; }
  async putBroadcast(broadcast: Broadcast, condition: WriteCondition) { return this.write(this.broadcasts, broadcast.slug, broadcast, condition); }
  async getLimit(bucket: string) { const l = this.limits.get(bucket); return l ? { value: structuredClone(l.value), version: l.version } : null; }
  async putLimit(bucket: string, limit: Limit, condition: WriteCondition) { const v = this.write(this.limits, bucket, limit, condition); this.limitWrittenAt.set(bucket, this.clock()); return v; }
  async listLimitsSince(since: number, max: number) {
    const recent = [...this.limits].filter(([bucket]) => (this.limitWrittenAt.get(bucket) ?? 0) >= since);
    return { limits: recent.slice(0, max).map(([, v]) => structuredClone(v.value)), truncated: recent.length > max };
  }
  async pruneLimits(olderThan: number) {
    let n = 0;
    for (const [bucket, at] of this.limitWrittenAt) if (at < olderThan) { this.limits.delete(bucket); this.limitWrittenAt.delete(bucket); n++; }
    return n;
  }
}

// Vercel Blob implementation. Documents live under newsletter/contacts/<key>.json,
// newsletter/broadcasts/<slug>.json and newsletter/limits/<bucket>.json with private access. Credentials are resolved by the SDK itself from the environment and request context (no option is passed): with BLOB_STORE_ID and a Vercel OIDC token it uses OIDC, otherwise the legacy BLOB_READ_WRITE_TOKEN (docs/project/WEB_BLOB_OIDC_EVIDENCE.md).
// Reads go through the SDK's get() with useCache: false, because every state change overwrites the same
// pathname and a CDN-cached read would keep serving a stale status. The blob ETag is the version tag:
// writes pass it as `ifMatch`, and create-only writes use `allowOverwrite: false`. Only "not found" maps to
// null; a precondition failure maps to ConflictError; any other failure throws. The create-only collision is
// recognised by the SDK's typed error where it throws one and otherwise by its message; the exact error the real
// store returns is recorded by the owner's `newsletter-admin.mjs probe` run (WEB-27).
export type BlobSdk = Pick<typeof import("@vercel/blob"), "get" | "put" | "del" | "list"> & { BlobPreconditionFailedError?: typeof import("@vercel/blob").BlobPreconditionFailedError };

export class BlobStore implements ContactStore {
  private readonly prefix: string;
  private readonly sdkLoader: () => Promise<BlobSdk>;
  constructor(prefix = "newsletter", sdkLoader: () => Promise<BlobSdk> = () => import("@vercel/blob")) { this.prefix = prefix; this.sdkLoader = sdkLoader; }
  private contactPath(key: string) { return `${this.prefix}/contacts/${key}.json`; }
  private broadcastPath(slug: string) { return `${this.prefix}/broadcasts/${slug}.json`; }
  private limitPath(bucket: string) { return `${this.prefix}/limits/${bucket}.json`; }
  private isConflict(sdk: BlobSdk, error: unknown): boolean {
    const name = error instanceof Error ? error.name : "";
    const Precondition = sdk.BlobPreconditionFailedError;
    return (Precondition !== undefined && error instanceof Precondition) || name === "BlobPreconditionFailedError" || /already exists/i.test(String(error));
  }
  private async read<T>(pathname: string): Promise<Versioned<T> | null> {
    const { get } = await this.sdkLoader();
    const result = await get(pathname, { access: "private", useCache: false });
    if (result === null) return null; // the SDK returns null for a missing blob
    if (result.statusCode !== 200 || !result.stream) throw new Error(`blob read of ${pathname} returned ${result.statusCode}`);
    return { value: JSON.parse(await new Response(result.stream).text()) as T, version: result.blob.etag };
  }
  private async write(pathname: string, value: unknown, condition: WriteCondition): Promise<string> {
    const sdk = await this.sdkLoader();
    const base = { access: "private" as const, addRandomSuffix: false, contentType: "application/json" };
    try {
      const result = condition.version === null
        ? await sdk.put(pathname, JSON.stringify(value), { ...base, allowOverwrite: false })
        : await sdk.put(pathname, JSON.stringify(value), { ...base, ifMatch: condition.version });
      return result.etag;
    } catch (error) {
      if (this.isConflict(sdk, error)) throw new ConflictError(pathname);
      throw error;
    }
  }
  async getContact(key: string) { return this.read<Contact>(this.contactPath(key)); }
  async putContact(key: string, contact: Contact, condition: WriteCondition) { return this.write(this.contactPath(key), contact, condition); }
  async deleteContact(key: string, condition?: WriteCondition) {
    const sdk = await this.sdkLoader();
    const pathname = this.contactPath(key);
    try { await (condition && condition.version !== null ? sdk.del(pathname, { ifMatch: condition.version }) : sdk.del(pathname)); }
    catch (error) { if (this.isConflict(sdk, error)) throw new ConflictError(pathname); throw error; }
  }
  async listContacts() {
    const { list } = await this.sdkLoader();
    const out: Versioned<Contact>[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: `${this.prefix}/contacts/`, cursor, limit: 1000 });
      out.push(...await this.readContacts(page.blobs.map((b) => b.pathname)));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }
  // Reads in parallel batches, so a long list costs a fraction of one sequential read per record.
  private async readContacts(pathnames: string[]): Promise<Versioned<Contact>[]> {
    const out: Versioned<Contact>[] = [];
    for (let i = 0; i < pathnames.length; i += READ_BATCH) {
      const batch = await Promise.all(pathnames.slice(i, i + READ_BATCH).map((p) => this.read<Contact>(p)));
      for (const c of batch) if (c) out.push(c);
    }
    return out;
  }
  // The listing carries each document's upload time, so only records old enough to be stale are read.
  async listContactsWrittenBefore(olderThan: number) {
    const { list } = await this.sdkLoader();
    const out: Versioned<Contact>[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: `${this.prefix}/contacts/`, cursor, limit: 1000 });
      out.push(...await this.readContacts(page.blobs.filter((b) => new Date(b.uploadedAt).getTime() < olderThan).map((b) => b.pathname)));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }
  async listRecentContacts(max: number) {
    const { list } = await this.sdkLoader();
    const entries: { pathname: string; at: number }[] = [];
    let cursor: string | undefined; let pages = 0; let listingCut = false;
    do {
      if (pages++ >= MAX_CONTACT_LIST_PAGES) { listingCut = true; break; }
      const page = await list({ prefix: `${this.prefix}/contacts/`, cursor, limit: 1000 });
      for (const b of page.blobs) entries.push({ pathname: b.pathname, at: new Date(b.uploadedAt).getTime() });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    entries.sort((a, b) => b.at - a.at); // a record's last write is never older than its creation, so recent signups sort first
    const contacts: Versioned<Contact>[] = [];
    const chosen = entries.slice(0, max);
    for (let i = 0; i < chosen.length; i += 20) {
      const batch = await Promise.all(chosen.slice(i, i + 20).map((e) => this.read<Contact>(e.pathname)));
      for (const c of batch) if (c) contacts.push(c);
    }
    return { contacts, truncated: entries.length > max, listingCut }; // WEB-50: `truncated` is the routine cap; `listingCut` means newer records may sit in pages never listed
  }
  async getBroadcast(slug: string) { return this.read<Broadcast>(this.broadcastPath(slug)); }
  async putBroadcast(broadcast: Broadcast, condition: WriteCondition) { return this.write(this.broadcastPath(broadcast.slug), broadcast, condition); }
  async getLimit(bucket: string) { return this.read<Limit>(this.limitPath(bucket)); }
  async putLimit(bucket: string, limit: Limit, condition: WriteCondition) { return this.write(this.limitPath(bucket), limit, condition); }
  async listLimitsSince(since: number, max: number) {
    const { list } = await this.sdkLoader();
    const recent: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: `${this.prefix}/limits/`, cursor, limit: 1000 });
      for (const b of page.blobs) if (new Date(b.uploadedAt).getTime() >= since) recent.push(b.pathname);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const limits: Limit[] = [];
    for (const pathname of recent.slice(0, max)) { const l = await this.read<Limit>(pathname); if (l) limits.push(l.value); }
    return { limits, truncated: recent.length > max };
  }
  async pruneLimits(olderThan: number) {
    const { list, del } = await this.sdkLoader();
    let cursor: string | undefined; let n = 0;
    do {
      const page = await list({ prefix: `${this.prefix}/limits/`, cursor, limit: 1000 });
      const stale = page.blobs.filter((b) => new Date(b.uploadedAt).getTime() < olderThan).map((b) => b.pathname);
      if (stale.length) { await del(stale); n += stale.length; }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return n;
  }
}
