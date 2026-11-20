// Blob credential modes: the legacy token, Vercel OIDC (BLOB_STORE_ID), neither, and both.
// No real Blob or OIDC request is made; the SDK is stubbed. See docs/project/WEB_BLOB_OIDC_EVIDENCE.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig } from "../lib/newsletter/config.ts";
import { BlobStore, type BlobSdk } from "../lib/newsletter/store.ts";
import { MemoryStore } from "../lib/newsletter/store.ts";
import { FakeMailer } from "../lib/newsletter/mailer.ts";

const SECRET = "s".repeat(40);
const base = { NEWSLETTER_ENABLED: "1", NEWSLETTER_SIGNING_SECRET: SECRET, NEWSLETTER_FROM: "a <a@b.co>", RESEND_API_KEY: "re_x", NEWSLETTER_ALLOWED_RECIPIENTS: "@owner-test.example" };

test("blob config: legacy token only reports token mode", () => {
  const r = readConfig({ ...base, BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x_y" });
  assert.equal(r.ok && r.config.blobAuth, "token");
});

test("blob config: OIDC store id only reports oidc mode", () => {
  const r = readConfig({ ...base, BLOB_STORE_ID: "store_abc123" });
  assert.equal(r.ok && r.config.blobAuth, "oidc");
});

test("blob config: neither fails closed and names what is absent", () => {
  const r = readConfig(base);
  assert.equal(r.ok, false);
  if (!r.ok) { assert.match(r.reason, /missing BLOB_STORE_ID \(OIDC\) or BLOB_READ_WRITE_TOKEN \(legacy\)/); }
  // blank values count as absent
  assert.equal(readConfig({ ...base, BLOB_STORE_ID: "  ", BLOB_READ_WRITE_TOKEN: "" }).ok, false);
  // other missing names are listed together with the blob credential
  const both = readConfig({ NEWSLETTER_ENABLED: "1", NEWSLETTER_SIGNING_SECRET: SECRET });
  assert.equal(both.ok, false);
  if (!both.ok) assert.match(both.reason, /NEWSLETTER_FROM, RESEND_API_KEY, BLOB_STORE_ID/);
});

test("blob config: both present reports oidc (the SDK prefers OIDC when it obtains a token) and never echoes a credential", () => {
  const r = readConfig({ ...base, BLOB_STORE_ID: "store_abc123", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_secret_value" });
  assert.equal(r.ok && r.config.blobAuth, "oidc");
  assert.ok(!JSON.stringify(r).includes("vercel_blob_rw_secret_value"));
  assert.ok(!JSON.stringify(r).includes("store_abc123"));
});

test("blob store: identical SDK calls in both modes, with no credential option passed", async () => {
  async function run(): Promise<unknown[]> {
    const calls: unknown[] = [];
    const sdk = {
      async get(pathname: string, options: unknown) { calls.push(["get", pathname, options]); return null; },
      async put(pathname: string, _body: unknown, options: unknown) { calls.push(["put", pathname, options]); return { etag: '"v1"' }; },
      async del(pathname: string, options?: unknown) { calls.push(["del", pathname, options]); },
      async list(options: unknown) { calls.push(["list", options]); return { blobs: [], hasMore: false }; },
    } as unknown as BlobSdk;
    const store = new BlobStore("nl", async () => sdk);
    const contact = { email: "a@owner-test.example", status: "pending" as const, createdAt: 1, confirmedAt: null, unsubscribedAt: null, sendWindowStart: 1, sendCount: 0 };
    await store.getContact("k");
    await store.putContact("k", contact, { version: null });
    await store.putContact("k", contact, { version: '"v1"' });
    await store.deleteContact("k", { version: '"v1"' });
    await store.listContacts();
    return calls;
  }
  const saved = { id: process.env.BLOB_STORE_ID, tok: process.env.BLOB_READ_WRITE_TOKEN };
  try {
    delete process.env.BLOB_STORE_ID; process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_x_y";
    const legacy = await run();
    delete process.env.BLOB_READ_WRITE_TOKEN; process.env.BLOB_STORE_ID = "store_abc123";
    const oidc = await run();
    assert.deepEqual(oidc, legacy);
    assert.ok(!JSON.stringify(oidc).match(/token|storeId|oidc/i), "the store passes no credential option; the SDK reads the environment and request context");
  } finally {
    if (saved.id === undefined) delete process.env.BLOB_STORE_ID; else process.env.BLOB_STORE_ID = saved.id;
    if (saved.tok === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = saved.tok;
  }
});

