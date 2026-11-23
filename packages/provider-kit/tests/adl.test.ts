import assert from "node:assert/strict";
import test from "node:test";
import { checkAdlConformance, parseAdlDocument, providerTermsFromAdl } from "@redditech/agent-protocol/adl";
import { MemoryNonceReplayStore } from "@redditech/x402-solana";
import { ADL_PATH, maxPerCall, providerAdl, providerAdlText } from "../src/adl.js";
import { runCli } from "../src/cli.js";
import { createProviderHandler, providerMetadata } from "../src/handler.js";
import { config, fakeChain, provider, USDC } from "./helpers.js";

test("the provider's ADL passes Level 3 and says what the config says", () => {
  const c = config();
  const { text, report } = providerAdlText(c);
  assert.equal(report.status, "pass", JSON.stringify(report));
  const parsed = parseAdlDocument(text);
  assert.ok(parsed.ok);
  const read = providerTermsFromAdl(parsed.document);
  assert.ok(read.ok);
  assert.deepEqual(read.terms, {
    name: "test-provider",
    description: "For tests.",
    declaredModel: "test/model-1",
    endpointUrl: "http://localhost:8787",
    mode: "live",
    network: "solana-devnet",
    currency: "USDC",
    mint: USDC.toBase58(),
    payTo: provider.publicKey.toBase58(),
    price: { per: "token", inputPerMillion: "3", outputPerMillion: "15", maxPerCall: maxPerCall(c) },
  });
});

test("the most a call can cost covers a full request body, the system prompt and the output limit", () => {
  // A 1,000,000-byte body is at most 1,000,000 input tokens at $3/M, plus 500 output tokens at $15/M.
  assert.equal(maxPerCall(config()), "3.0075");
  // A 4,000-byte system prompt adds at most 4,008 input tokens (8 for its message wrapper).
  assert.equal(maxPerCall(config({ systemPrompt: "x".repeat(4_000) })), "3.019524");
});

test("a mainnet provider's ADL names the allowlisted mint", () => {
  const c = config({ network: "solana-mainnet-beta", rpcUrl: "https://rpc.example.org", publicUrl: "https://provider.example.org" });
  const doc = providerAdl(c) as { extensions: { x402: { intents: { asset: { mint: string } }[] } } };
  assert.equal(doc.extensions.x402.intents[0].asset.mint, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(checkAdlConformance(doc as never).status, "pass");
});

test("the provider serves its ADL and links it from its metadata", async () => {
  const c = config();
  const handler = createProviderHandler(c, { chain: fakeChain(), upstream: { complete: async () => ({}) } as never, replayStore: new MemoryNonceReplayStore(), signMessage: () => new Uint8Array(64) });
  const response = await handler(new Request(`http://localhost:8787${ADL_PATH}`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/yaml/);
  assert.equal(await response.text(), providerAdlText(c).text);
  assert.equal(providerMetadata(c).adl, `http://localhost:8787${ADL_PATH}`);
});

test("rap-provider adl prints the document, or the report with --json", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { configFile } = await import("./helpers.js");
  const path = join(mkdtempSync(join(tmpdir(), "rap-adl-")), "provider.json");
  writeFileSync(path, JSON.stringify(configFile()));
  const out: string[] = [];
  const err: string[] = [];
  const io = { out: (t: string) => out.push(t), err: (t: string) => err.push(t), env: {} };
  assert.equal(await runCli(["adl", "--config", path], io), 0, err.join("\n"));
  assert.match(out[0], /^apiVersion: reddiagent\.dev\/v0\.3/);
  assert.equal(await runCli(["adl", "--config", path, "--json"], io), 0);
  assert.equal(JSON.parse(out[1]).achievedLevel, 3);
});
