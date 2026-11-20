jest.mock("server-only", () => ({}));

import type { Listing } from "@/lib/listings/listing-store";

const BUYER = "7Y6oUj3vCz7xqGmJmT7Q7m4mGkq3rq9t7u7Hq3iJ1dQp";
const PROVIDER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const USER_ID = "3f2c1a7e-0b6d-4c1e-9a55-2f0f6a1d9b10";
const SIGNATURE = "5".repeat(88);
const HASH = "a".repeat(64);
const SERVICE_KEY = "test-service-role-key";
const ANON_KEY = "public-anon-key";
const TOKEN = "b".repeat(40);
const LAMPORTS = 2_000_000;

const listing: Listing = {
  wallet: PROVIDER, displayName: "Fast summaries", endpointUrl: "https://provider.example/v1", declaredModels: [], capabilities: {},
  pricePerCallBaseUnits: String(LAMPORTS), priceMint: "SOL", network: "solana-devnet", status: "listed", healthStatus: "pass", lastSeenAt: null, updatedAt: null,
};

function receipt(overrides: Record<string, unknown> = {}) {
  return { network: "solana-devnet", payTo: PROVIDER, amount: "0.002", currency: "SOL", nonce: "nonce-1", signature: SIGNATURE, payer: BUYER, ...overrides };
}

/** A parsed transaction in which `from` sends `lamports` to `to` with the system program. */
function solTransfer(from: string, to: string, lamports: number) {
  return {
    blockTime: Math.floor(Date.now() / 1000),
    meta: { err: null },
    transaction: {
      message: {
        accountKeys: [{ pubkey: from, signer: true }, { pubkey: to, signer: false }],
        instructions: [{ program: "system", programId: "11111111111111111111111111111111", parsed: { type: "transfer", info: { source: from, destination: to, lamports } } }],
      },
    },
  };
}

describe("job records for wallet-paid calls (#740)", () => {
  const originalFetch = global.fetch;
  const env = { ...process.env };
  type Call = { url: string; init: { method: string; headers: Record<string, string>; body?: string } };

  beforeEach(() => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...env };
  });

  function mockStore(status = 201, rows: unknown = [{ id: "0b0e7c1e-7a57-4d0e-b3f0-1c2d3e4f5a6b" }]) {
    const calls: Call[] = [];
    global.fetch = jest.fn(async (url: string, init: Call["init"]) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/v1/user")) return { ok: true, status: 200, json: async () => ({ id: USER_ID, identities: [{ provider: "web3", provider_id: `web3:solana:${BUYER}` }] }) };
      return { ok: status < 300, status, json: async () => rows };
    }) as unknown as typeof fetch;
    return calls;
  }

  async function run(options: { tx?: unknown; receipt?: unknown; listing?: Listing; session?: { userId: string; wallet: string }; profile?: "devnet" | "mainnet" | "local-surfpool"; noConnection?: boolean } = {}) {
    const { verifyAndRecordPaidCall } = await import("@/lib/jobs/paid-call");
    const getParsedTransaction = jest.fn(async () => (options.tx === undefined ? solTransfer(BUYER, PROVIDER, LAMPORTS) : options.tx));
    const outcome = await verifyAndRecordPaidCall(
      { receipt: options.receipt ?? receipt(), listing: options.listing ?? listing, profile: options.profile ?? "devnet", requestHash: HASH, responseHash: HASH, declaredModel: "ollama-local", delivered: true, session: options.session },
      options.noConnection ? {} : { connection: { getParsedTransaction } as never },
    );
    return { outcome, getParsedTransaction };
  }

  it("records a job only after the chain shows the listed price paid to the listed wallet", async () => {
    const calls = mockStore();
    const { outcome, getParsedTransaction } = await run({ session: { userId: USER_ID, wallet: BUYER } });
    expect(outcome).toEqual({ recorded: true, jobId: "0b0e7c1e-7a57-4d0e-b3f0-1c2d3e4f5a6b" });
    expect(getParsedTransaction).toHaveBeenCalledWith(SIGNATURE, expect.anything());
    const write = calls.find((c) => c.url.includes("/rest/v1/jobs"))!;
    expect(write.init.headers.apikey).toBe(SERVICE_KEY);
    expect(JSON.parse(write.init.body!)).toMatchObject({
      buyer_wallet: BUYER, buyer_user_id: USER_ID, provider_wallet: PROVIDER, network: "solana-devnet", declared_model: "ollama-local",
      request_hash: HASH, response_hash: HASH, amount_base_units: String(LAMPORTS), mint: "SOL", tx_signature: SIGNATURE, status: "delivered",
    });
  });

  it("does not link the job to a signed-in account whose wallet is not the payer", async () => {
    const calls = mockStore();
    await run({ session: { userId: USER_ID, wallet: PROVIDER } });
    expect(JSON.parse(calls.find((c) => c.url.includes("/rest/v1/jobs"))!.init.body!).buyer_user_id).toBeNull();
  });

  it.each([
    ["the transaction paid less than the listed price", { tx: solTransfer(BUYER, PROVIDER, LAMPORTS - 1) }],
    ["the transaction paid someone else", { tx: solTransfer(BUYER, BUYER, LAMPORTS) }],
    ["the transaction is missing", { tx: null }],
    ["the transaction failed", { tx: { ...solTransfer(BUYER, PROVIDER, LAMPORTS), meta: { err: { InstructionError: [0, "Custom"] } } } }],
    ["the receipt names a different amount from the listing", { receipt: receipt({ amount: "0.000001" }) }],
    ["the receipt names a different provider", { receipt: receipt({ payTo: BUYER }) }],
    ["the receipt is in a currency the listing is not priced in", { receipt: receipt({ currency: "USDC" }) }],
    ["the receipt is a demo receipt", { receipt: receipt({ demo: true }) }],
    ["the receipt has no payer", { receipt: receipt({ payer: undefined }) }],
    ["the receipt is not an object", { receipt: "paid, trust me" }],
    ["the listing belongs to another network", { listing: { ...listing, network: "solana-mainnet" as const } }],
    ["the profile has no payment network", { profile: "local-surfpool" as const }],
    ["no RPC is configured", { noConnection: true }],
  ])("records nothing when %s", async (_name, options) => {
    const calls = mockStore();
    const { outcome } = await run(options);
    expect(outcome.recorded).toBe(false);
    expect(calls.filter((c) => c.url.includes("/rest/v1/jobs"))).toHaveLength(0);
  });

  it("refuses every mainnet receipt while no fee decision is configured", async () => {
    const calls = mockStore();
    const { outcome } = await run({ profile: "mainnet", listing: { ...listing, network: "solana-mainnet" }, receipt: receipt({ network: "solana-mainnet-beta" }) });
    expect(outcome.recorded).toBe(false);
    expect(calls.filter((c) => c.url.includes("/rest/v1/jobs"))).toHaveLength(0);
  });

  it("reports a second record for the same transaction as already recorded", async () => {
    mockStore(409);
    const { outcome } = await run();
    expect(outcome).toEqual({ recorded: false, reason: "already_recorded" });
  });

  it("reports a database failure as not recorded", async () => {
    mockStore(500);
    expect((await run()).outcome).toEqual({ recorded: false, reason: "store_unavailable" });
  });

  it("refuses to write a malformed job", async () => {
    const calls = mockStore();
    const { recordVerifiedJob } = await import("@/lib/jobs/job-store");
    const base = { buyerWallet: BUYER, providerWallet: PROVIDER, network: "solana-devnet" as const, declaredModel: "m", requestHash: HASH, amountBaseUnits: "1", mint: "SOL", txSignature: SIGNATURE, status: "delivered" as const };
    for (const bad of [{ amountBaseUnits: "0" }, { amountBaseUnits: "1.5" }, { txSignature: "mock_tx_signature" }, { requestHash: "nope" }, { buyerWallet: "x" }, { mint: "USDC" }, { buyerUserId: "someone" }]) {
      expect(await recordVerifiedJob({ ...base, ...bad })).toEqual({ ok: false, code: "invalid_job" });
    }
    expect(calls).toHaveLength(0);
  });

  it("lists a user's jobs with their own session so the database picks the rows", async () => {
    const calls = mockStore(200, [{ id: "job-1", provider_wallet: PROVIDER, network: "solana-devnet", declared_model: "m", amount_base_units: 2000000, mint: "SOL", tx_signature: SIGNATURE, status: "delivered", created_at: "2026-11-20T00:00:00Z" }, { nope: true }]);
    const { GET } = await import("@/app/api/jobs/route");
    const res = await GET(new Request("https://app.example/api/jobs", { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]).toMatchObject({ id: "job-1", amountBaseUnits: "2000000", txSignature: SIGNATURE });
    const read = calls.find((c) => c.url.includes("/rest/v1/jobs"))!;
    expect(read.init.headers).toEqual({ apikey: ANON_KEY, authorization: `Bearer ${TOKEN}` });
    expect(JSON.stringify(read.init.headers)).not.toContain(SERVICE_KEY);
  });

  it("refuses the jobs list without a session", async () => {
    const calls = mockStore();
    const { GET } = await import("@/app/api/jobs/route");
    expect((await GET(new Request("https://app.example/api/jobs"))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
