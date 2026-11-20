import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSandboxUrl } from "../lib/sandbox.ts";
import { APEX_ORIGIN, resolveIndexable, resolveSiteUrl, robotsRules } from "../lib/site.ts";

test("sandbox link: only a well-formed https address opens it", () => {
  assert.equal(resolveSandboxUrl(undefined), null);
  assert.equal(resolveSandboxUrl(""), null);
  assert.equal(resolveSandboxUrl("http://sandbox.example"), null);
  assert.equal(resolveSandboxUrl("javascript:alert(1)"), null);
  assert.equal(resolveSandboxUrl("not a url"), null);
  assert.equal(resolveSandboxUrl(" https://sandbox.example/try "), "https://sandbox.example/try");
});

test("canonical origin: production is the public host, previews use their own address", () => {
  assert.equal(APEX_ORIGIN, "https://agent-protocol.reddi.tech");
  assert.equal(resolveSiteUrl({ VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app" }), APEX_ORIGIN);
  assert.equal(resolveSiteUrl({ VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" }), "https://x.vercel.app");
  assert.equal(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://a.example/" }), "https://a.example");
});

test("indexing stays off unless production and the owner's switch are both set", () => {
  assert.equal(resolveIndexable({ VERCEL_ENV: "production", NODE_ENV: "production" }), false);
  assert.equal(resolveIndexable({ VERCEL_ENV: "preview", SITE_PUBLIC: "1" }), false);
  assert.equal(resolveIndexable({ NODE_ENV: "production", SITE_PUBLIC: "1" }), false);
  assert.equal(resolveIndexable({ VERCEL_ENV: "production", NODE_ENV: "production", SITE_PUBLIC: "1" }), true);
  assert.deepEqual(robotsRules(false, APEX_ORIGIN), { rules: { userAgent: "*", disallow: "/" } });
  assert.deepEqual(robotsRules(true, APEX_ORIGIN).rules.disallow, ["/api/", "/newsletter/"]);
});
