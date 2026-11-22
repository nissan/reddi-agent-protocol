// The marketing site's llms.txt (https://llmstxt.org) points agents at the app's own llms.txt and the files it links.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const REPO = join(ROOT, "..", "..");
const text = readFileSync(join(ROOT, "public", "llms.txt"), "utf8");
const lines = text.split("\n");

test("llms.txt has one H1, a blockquote summary and H2 sections of link lists", () => {
  assert.equal(lines[0], "# Reddi Agent Protocol");
  assert.equal(lines.filter((l) => l.startsWith("# ")).length, 1);
  assert.match(lines.find((l) => l.trim() !== "" && !l.startsWith("# ")) ?? "", /^> /);
  const first = lines.findIndex((l) => l.startsWith("## "));
  assert.ok(first > 0);
  for (const line of lines.slice(first)) {
    if (line.startsWith("## ") || line.trim() === "") continue;
    assert.match(line, /^- \[[^\]]+\]\(https:\/\/[^)\s]+\)(: .+)?$/, line);
  }
});

test("links into the app name files the app serves", () => {
  for (const [, path] of text.matchAll(/\]\(https:\/\/app\.agent-protocol\.reddi\.tech(\/[^)]*)\)/g)) {
    assert.ok(existsSync(join(REPO, "public", path)), path);
  }
});

test("links into this site name its own pages", () => {
  for (const [, path] of text.matchAll(/\]\(https:\/\/agent-protocol\.reddi\.tech(\/[^)]*)\)/g)) {
    const page = path === "/" ? "app/page.tsx" : `app${path}/page.tsx`;
    assert.ok(existsSync(join(ROOT, page)), path);
  }
});

test("keeps the RFS framing, says mainnet is coming and quotes the fee schedule", () => {
  assert.match(text, /solana\.com\/request-for-startups#ai-inference-marketplace/);
  assert.match(text, /Not affiliated with or endorsed by the Solana Foundation/);
  assert.match(text, /Mainnet is coming soon/);
  assert.doesNotMatch(text, /\b(live|running|available) on (Solana )?mainnet\b/i);
  assert.match(text, /5% protocol fee with its 2\.5% launch rate for payouts before 1 April 2027/);
  assert.match(text, /0\.1 SOL cap on SOL payments/);
});
