import { pinLaunchRateClock } from "@/lib/test-support/launch-clock";
import { MemoryNonceReplayStore } from "@redditech/x402-solana";
import { Keypair } from "@solana/web3.js";
import { findSandboxProviderById, findSandboxScenario, SANDBOX_PROVIDERS } from "@/lib/sandbox/catalog";
import { handleSandboxChatCompletion, sandboxModelsListing, type SandboxGatewayDeps } from "@/lib/sandbox/gateway";
import { formatUnits, maxChargeLamports, requestInputTokens } from "@/lib/sandbox/pricing";
import { decodeReceiptHeader, encodeReceiptHeader, SANDBOX_SIMULATED_RECEIPT_HEADER, type SandboxReceipt } from "@/lib/sandbox/receipt";
import { sandboxBuildOfRecord } from "@/lib/sandbox/deployment";
import { runSandboxWriting, writingProviders } from "@/lib/sandbox/writing-run";
import {
  buildWritingSkill,
  countWords,
  DEFAULT_WRITING_SETTINGS,
  HUMANISER_RULES,
  JARGON_LEVELS,
  parseWritingSettings,
  rewriteSample,
  settingsLine,
  trimToWords,
  WORD_LIMITS,
  WRITING_PIPELINE,
  WRITING_SAMPLE,
  WRITING_STYLES,
  type WritingSettings,
} from "@/lib/sandbox/writing-skill";

const ORIGIN = "https://sandbox.example";

function makeDeps(): SandboxGatewayDeps {
  let counter = 0;
  const unreachable = async () => {
    throw new Error("a writing call must not read the chain");
  };
  return {
    connection: { getGenesisHash: unreachable, getParsedTransaction: unreachable } as unknown as SandboxGatewayDeps["connection"],
    replayStore: new MemoryNonceReplayStore(),
    readAccount: unreachable,
    readSlot: unreachable,
    acceptMeteredSessions: true,
    newNonce: () => (++counter).toString(16).padStart(32, "e"),
  };
}

function gatewayFetch(deps: SandboxGatewayDeps, alter?: (headers: Record<string, string>, call: number) => void): typeof fetch {
  let call = 0;
  return (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    call += 1;
    const response = await handleSandboxChatCompletion({ body: JSON.parse(init.body), rawBody: init.body, paymentHeader: init.headers["x402-payment"], origin: ORIGIN }, deps);
    alter?.(response.headers, call);
    return new Response(response.bodyText, { status: response.status, headers: response.headers });
  }) as unknown as typeof fetch;
}

const EVERY_SETTING: WritingSettings[] = WRITING_STYLES.flatMap((style) => JARGON_LEVELS.flatMap((jargon) => WORD_LIMITS.map((maxWords) => ({ style: style.id, jargon: jargon.id, maxWords }))));

describe("sandbox: help us write better", () => {
  it("lists the scenario with the two writing providers in order, simulated-only, at per-token prices", () => {
    const scenario = findSandboxScenario("write-better")!;
    expect(scenario.title).toBe("Help us write better");
    expect(scenario.providerIds).toEqual(WRITING_PIPELINE.map((step) => step.providerId));
    for (const provider of writingProviders()) {
      expect(provider.simulatedOnly).toBe(true);
      expect(provider.model).toMatch(/^sandbox\//);
      expect(provider.media).toBeUndefined();
      expect(Number(provider.pricing.outputPerMillionUsd)).toBeGreaterThan(0);
      expect(provider.writing?.does).toBeTruthy();
    }
    const payees = SANDBOX_PROVIDERS.map((provider) => provider.payTo);
    expect(new Set(payees).size).toBe(payees.length);
  });

  it("reads the settings back out of the request and refuses anything off the menu", () => {
    expect(parseWritingSettings(`Build it.\n${settingsLine(DEFAULT_WRITING_SETTINGS)}`)).toEqual(DEFAULT_WRITING_SETTINGS);
    expect(parseWritingSettings("Settings: style=pirate; jargon=eli5; maxWords=80")).toBeUndefined();
    expect(parseWritingSettings("Settings: style=friendly; jargon=eli5; maxWords=81")).toBeUndefined();
    expect(parseWritingSettings("no settings here")).toBeUndefined();
  });

  it("keeps every rewrite inside its word limit, main point first, and free of em dashes", () => {
    for (const settings of EVERY_SETTING) {
      const rewrite = rewriteSample(settings);
      expect(countWords(rewrite)).toBeLessThanOrEqual(settings.maxWords);
      expect(countWords(rewrite)).toBeGreaterThan(10);
      expect(rewrite.startsWith("This weekend")).toBe(true);
      expect(rewrite).not.toMatch(/—/);
    }
    // The longest limit keeps the whole rewrite; the shortest cuts whole sentences.
    expect(rewriteSample({ ...DEFAULT_WRITING_SETTINGS, maxWords: 150 }).length).toBeGreaterThan(rewriteSample({ ...DEFAULT_WRITING_SETTINGS, maxWords: 40 }).length);
    expect(trimToWords("One two three four five six.", 3)).toBe("One two three");
  });

  it("builds a skill that names the settings, and every skill differs", () => {
    const skills = new Set(EVERY_SETTING.map(buildWritingSkill));
    expect(skills.size).toBe(EVERY_SETTING.length);
    const skill = buildWritingSkill({ style: "academic", jargon: "eli5", maxWords: 40 });
    expect(skill).toMatch(/^---\nname: write-like-me-academic-eli5-40\n/);
    expect(skill).toContain("40 words or fewer");
    expect(skill).toContain("## Voice: academic");
    expect(skill).toContain("## Jargon: explain like I'm 5");
    expect(HUMANISER_RULES).toContain("https://app.agent-protocol.reddi.tech/agent-setup");
  });

  it("pays each provider in turn and returns the skill, the rewrite and two checked receipts with the 2.5% fee", async () => {
    const settings: WritingSettings = { style: "professional", jargon: "some-jargon", maxWords: 40 };
    const steps: string[] = [];
    const result = await runSandboxWriting({ settings, fetchImpl: gatewayFetch(makeDeps()), onStep: (row) => steps.push(row.provider.id) });
    if (!result.ok) throw new Error(result.message);
    expect(steps).toEqual(["reddi-writing-style", "reddi-humaniser"]);
    expect(result.exchanges).toHaveLength(4);
    expect(result.rewrite).toBe(rewriteSample(settings));
    expect(result.skill).toBe(`${buildWritingSkill(settings)}\n\n${HUMANISER_RULES}\n`);
    for (const row of result.rows) {
      const payment = row.receipt!.receipt.payment!;
      expect(row.checked).toBe(true);
      expect(row.receipt!.receipt.declaredModel).toBe(row.provider.model);
      expect(payment.settlement).toBe("metered-escrow");
      expect(payment.metered?.outputTokens).toBe(String(row.outputTokens));
      expect(payment.amount).toBe(row.costLamports.toString());
      expect(BigInt(payment.fee.amount)).toBe((row.costLamports * BigInt(250)) / BigInt(10_000));
      expect(row.costLamports + row.refundedLamports).toBe(row.maxLamports);
      expect(row.costLamports > BigInt(0)).toBe(true);
    }
    // The humaniser was sent the skill Writing Style built.
    expect(String((result.exchanges[3].request.body as { messages: { content: string }[] }).messages[0].content)).toContain(buildWritingSkill(settings));
    expect(result.totalLamports).toBe(result.rows[0].costLamports + result.rows[1].costLamports);
  });

  it("stops at a receipt that bills more than the answer, and does not call the humaniser", async () => {
    const result = await runSandboxWriting({
      settings: DEFAULT_WRITING_SETTINGS,
      fetchImpl: gatewayFetch(makeDeps(), (headers, call) => {
        if (call !== 2) return;
        const receipt = decodeReceiptHeader(headers[SANDBOX_SIMULATED_RECEIPT_HEADER]) as SandboxReceipt;
        receipt.receipt.payment!.amount = "999999";
        headers[SANDBOX_SIMULATED_RECEIPT_HEADER] = encodeReceiptHeader(receipt);
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.rows).toHaveLength(1);
    expect(result.exchanges).toHaveLength(2);
    expect(!result.ok && result.message).toMatch(/^Reddi Writing Style:/);
  });

  it("refuses a receipt signed by a key other than the listed one", async () => {
    const result = await runSandboxWriting({ settings: DEFAULT_WRITING_SETTINGS, fetchImpl: gatewayFetch(makeDeps()), providerReceiptIds: { "reddi-writing-style": Keypair.generate().publicKey.toBase58() } });
    expect(result.ok).toBe(false);
    expect(result.rows).toHaveLength(1);
  });

  it("refuses a devnet transfer to a writing provider before reading the chain, and lists it as simulated-only", async () => {
    const provider = findSandboxProviderById("reddi-humaniser")!;
    const messages = [{ role: "user", content: `Rewrite this.\n${settingsLine(DEFAULT_WRITING_SETTINGS)}\n\nText:\n${WRITING_SAMPLE}` }];
    const amount = formatUnits(maxChargeLamports(provider, requestInputTokens(messages)), 9);
    const header = { network: "solana-devnet", payTo: provider.payTo, amount, currency: "SOL", nonce: "f".repeat(32), txSignature: "4".repeat(88), payer: Keypair.generate().publicKey.toBase58() };
    const body = { model: provider.model, messages };
    const response = await handleSandboxChatCompletion({ body, rawBody: JSON.stringify(body), paymentHeader: JSON.stringify(header), origin: ORIGIN }, makeDeps());
    expect(response.status).toBe(402);
    expect(response.body).toMatchObject({ reason: "unsupported_receipt" });
    const listing = (await sandboxModelsListing({ canSettle: () => true, deployment: async () => ({ ok: true, build: sandboxBuildOfRecord()! }), settle: async () => ({ ok: false, message: "" }), lookup: async () => ({ state: "unknown" }) })) as { data: { rap: { providerId: string; simulatedPaymentsOnly?: boolean; writing?: unknown } }[] };
    const entry = listing.data.find((item) => item.rap.providerId === provider.id)!;
    expect(entry.rap.simulatedPaymentsOnly).toBe(true);
    expect(entry.rap.writing).toEqual(provider.writing);
  });
});

// Fee terms built from the current time stay at the launch rate after 1 April 2027.
pinLaunchRateClock();
