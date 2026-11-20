// The marketing site's copy is public copy, so it is held to the repository's public-claim boundary
// (docs/PUBLIC-CLAIM-BOUNDARY.md). This test reads the shared pattern list the repository's own gates use and scans
// every page, component and copy module of this app, line by line. It also proves it can fail (negative control).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CENTRAL_MESSAGE as BOUNDARY_MESSAGE, FORBIDDEN_PUBLIC_CLAIMS, claimIsQualified } from "../../../lib/public-claims/public-claim-boundary-terms.ts";
import { CENTRAL_MESSAGE, DEFAULT_DESCRIPTION, FAQ, STAGE, STATUS } from "../lib/copy.ts";
import { SIGNUP_COPY } from "../lib/newsletter/copy.ts";

const ROOT = join(import.meta.dirname, "..");
function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    return statSync(join(ROOT, rel)).isDirectory() ? files(rel) : /\.(tsx?|md)$/.test(name) ? [rel] : [];
  });
}
const SCANNED = [...files("app"), ...files("components"), "lib/copy.ts", "lib/newsletter/copy.ts", "lib/metadata.ts", "README.md"];

function violations(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) for (const claim of FORBIDDEN_PUBLIC_CLAIMS) if (claim.pattern.test(line) && !claimIsQualified(line, claim)) found.push(`${claim.id}: ${line.trim().slice(0, 140)}`);
  return found;
}

test("no page, component or copy module makes a forbidden public claim", () => {
  assert.ok(SCANNED.length > 12, "the scan found the app's files");
  for (const file of SCANNED) assert.deepEqual(violations(readFileSync(join(ROOT, file), "utf8")), [], file);
});

test("negative control: every forbidden claim's own example is caught", () => {
  for (const claim of FORBIDDEN_PUBLIC_CLAIMS) assert.ok(violations(claim.injectionExample).some((v) => v.startsWith(`${claim.id}:`)), claim.id);
});

test("the central message matches the boundary document's", () => {
  assert.equal(CENTRAL_MESSAGE, `${BOUNDARY_MESSAGE}.`);
});

test("the site says plainly that nothing is on mainnet, wherever it describes itself", () => {
  for (const text of [STAGE, DEFAULT_DESCRIPTION, SIGNUP_COPY.confirmedBody, SIGNUP_COPY.email.text("https://x.example/c"), SIGNUP_COPY.email.html("https://x.example/c")]) assert.match(text, /nothing is on mainnet yet/i);
  assert.match(FAQ.find((f) => f.q === "Can I use it today?")!.a, /nothing runs on Solana mainnet yet/i);
});

test("signup copy promises a notice and never says something can be used now", () => {
  const all = (Object.values(SIGNUP_COPY) as unknown[]).filter((v): v is string => typeof v === "string").join("\n");
  for (const banned of [/\bavailable now\b/i, /\bnow available\b/i, /\blive on mainnet\b/i, /\bwaitlist\b/i, /\bearly access\b/i, /\bjoin \d/i]) assert.doesNotMatch(all, banned);
});

test("every status row links somewhere checkable and planned rows promise no date", () => {
  for (const row of [...STATUS.exists, ...STATUS.building, ...STATUS.planned]) assert.match(row.href, /^https:\/\//, row.item);
  for (const row of STATUS.planned) assert.doesNotMatch(`${row.item} ${row.note}`, /\b(20\d\d|january|february|march|april|may|june|july|august|september|october|november|december|Q[1-4])\b/i, row.item);
});
