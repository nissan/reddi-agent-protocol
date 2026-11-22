#!/usr/bin/env node
/**
 * Builds public/llms-full.txt (the llms.txt "full" companion, https://llmstxt.org)
 * from the files it bundles, so the two can never drift.
 *
 *   node scripts/build-llms-full.mjs          write public/llms-full.txt
 *   node scripts/build-llms-full.mjs --check  exit 1 if the checked-in file is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://app.agent-protocol.reddi.tech";
/** The index first, then each bundled file in the order an agent should read it. */
export const LLMS_FULL_SOURCES = ["llms.txt", "skill.md", "provider.md", "pricing.md"];

export function buildLlmsFull(read = (rel) => readFileSync(join(ROOT, "public", rel), "utf8")) {
  const parts = LLMS_FULL_SOURCES.map((rel, i) => {
    const body = read(rel).trim();
    return i === 0 ? body : `<!-- Source: ${ORIGIN}/${rel} -->\n\n${body}`;
  });
  return `${parts.join("\n\n---\n\n")}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = join(ROOT, "public", "llms-full.txt");
  const next = buildLlmsFull();
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(target, "utf8"); } catch {}
    if (current !== next) {
      console.error("public/llms-full.txt is stale. Run: node scripts/build-llms-full.mjs");
      process.exit(1);
    }
    console.log("public/llms-full.txt is current.");
  } else {
    writeFileSync(target, next);
    console.log(`Wrote public/llms-full.txt (${next.length} bytes).`);
  }
}
