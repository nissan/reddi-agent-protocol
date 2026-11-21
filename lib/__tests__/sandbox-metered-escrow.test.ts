import { Keypair, PublicKey } from "@solana/web3.js";
import { MemoryNonceReplayStore } from "@reddi/x402-solana";
import { validateReddiReceiptV2, verifyReddiReceiptV2 } from "@reddi/agent-protocol/receipt-v2";
import { IX, ACCOUNT_DISC } from "@/lib/program";
import devnetProfile from "@/config/networks/devnet.json";
import { findSandboxProviderById, SANDBOX_PROVIDERS } from "@/lib/sandbox/catalog";
import {
  buildSandboxMeteredLock,
  buildSandboxSettle,
  decodeSandboxEscrow,
  escrowNonceBytes,
  SANDBOX_ESCROW_DISCRIMINATORS,
  SANDBOX_ESCROW_PROGRAM_ID,
  sandboxEscrowAddress,
} from "@/lib/sandbox/escrow";
import { handleSandboxChatCompletion, sandboxModelsListing, type SandboxGatewayDeps } from "@/lib/sandbox/gateway";
import { countTokens, maxChargeLamports, requestInputTokens, SANDBOX_FEE_TREASURY, settleSandboxCall } from "@/lib/sandbox/pricing";
import { decodeReceiptHeader, isSandboxReceipt, PROVIDER_RECEIPT_HEADER, verifySandboxReceipt } from "@/lib/sandbox/receipt";
import { parseSandboxPayeeKeys, type SandboxSettleInput, type SandboxSettler } from "@/lib/sandbox/settle-signer";

const ORIGIN = "https://sandbox.example";
const NOW_MS = Date.UTC(2026, 10, 21, 2, 0, 0);
const swift = findSandboxProviderById("swift-infer")!;
const messages = [{ role: "user", content: "Explain exponential backoff in two sentences." }];
const MAX_LAMPORTS = maxChargeLamports(swift, requestInputTokens(messages));
const payer = Keypair.generate().publicKey;
const SETTLE_SIG = "3".repeat(88);
const LOCK_SIG = "2".repeat(88);

/** Borsh bytes of an EscrowAccount as Anchor writes it. */
function escrowBytes(fields: { payer: PublicKey; payee: PublicKey; amount: bigint; nonce: Uint8Array; status?: number; metered?: boolean; session?: PublicKey }): Uint8Array {
  const parts: number[] = [...SANDBOX_ESCROW_DISCRIMINATORS.escrowAccount, ...fields.payer.toBytes(), ...fields.payee.toBytes()];
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(fields.amount);
  parts.push(...amount, ...fields.nonce, fields.status ?? 0);
  const time = Buffer.alloc(16);
  time.writeBigInt64LE(BigInt(Math.floor(NOW_MS / 1000)));
  parts.push(...time, 0);
  if (fields.session) parts.push(1, ...fields.session.toBytes());
  else parts.push(0);
  parts.push(255, fields.metered === false ? 0 : 1);
  // Anchor allocates the full LEN; a None session leaves 32 trailing zero bytes.
  while (parts.length < 149) parts.push(0);
  return Uint8Array.from(parts);
}

type Accounts = Map<string, { owner: PublicKey; data: Uint8Array }>;

function fakeSettler(available = true, result: { ok: true; signature: string } | { ok: false; message: string } = { ok: true, signature: SETTLE_SIG }) {
  const calls: SandboxSettleInput[] = [];
  const settler: SandboxSettler = {
    canSettle: () => available,
    async settle(input) {
      calls.push(input);
      return result;
    },
  };
  return { settler, calls };
}

function makeDeps(accounts: Accounts, settler: SandboxSettler | undefined): SandboxGatewayDeps {
  let counter = 0;
  return {
    connection: { getGenesisHash: async () => "", getParsedTransaction: async () => null } as unknown as SandboxGatewayDeps["connection"],
    replayStore: new MemoryNonceReplayStore(),
    readAccount: async (address) => accounts.get(address.toBase58()) ?? null,
    settler,
    now: () => NOW_MS,
    newNonce: () => (++counter).toString(16).padStart(32, "a"),
  };
}

function call(deps: SandboxGatewayDeps, paymentHeader?: string) {
  const body = { model: swift.model, messages };
  return handleSandboxChatCompletion({ body, rawBody: JSON.stringify(body), paymentHeader, origin: ORIGIN }, deps);
}

function lockFor(accounts: Accounts, nonce: string, overrides: Partial<Parameters<typeof escrowBytes>[0]> & { owner?: PublicKey } = {}): string {
  const escrow = sandboxEscrowAddress(payer, nonce);
  accounts.set(escrow.toBase58(), {
    owner: overrides.owner ?? SANDBOX_ESCROW_PROGRAM_ID,
    data: escrowBytes({ payer, payee: new PublicKey(swift.payTo), amount: MAX_LAMPORTS, nonce: escrowNonceBytes(nonce), ...overrides }),
  });
  return escrow.toBase58();
}

function meteredHeader(nonce: string, escrow: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ settlement: "metered-escrow", network: "solana-devnet", payTo: swift.payTo, amount: "x", currency: "SOL", nonce, escrow, lockSignature: LOCK_SIG, payer: payer.toBase58(), ...overrides });
}

const nonceOf = (response: { body: Record<string, unknown> }) => (response.body.x402 as { nonce: string }).nonce;

describe("sandbox metered escrow: instructions and layout", () => {
  it("uses the discriminators lib/program.ts derives and the devnet program from the network profile", () => {
    expect(Buffer.from(SANDBOX_ESCROW_DISCRIMINATORS.lockMeteredEscrow)).toEqual(IX.lock_metered_escrow);
    expect(Buffer.from(SANDBOX_ESCROW_DISCRIMINATORS.settleEscrow)).toEqual(IX.settle_escrow);
    expect(Buffer.from(SANDBOX_ESCROW_DISCRIMINATORS.escrowAccount)).toEqual(ACCOUNT_DISC.EscrowAccount);
    expect(SANDBOX_ESCROW_PROGRAM_ID.toBase58()).toBe(devnetProfile.programs.escrowProgramId);
  });

  it("builds the lock and settle the program expects", () => {
    const nonce = "0123456789abcdef0123456789abcdef";
    const payee = new PublicKey(swift.payTo);
    const { instruction, escrow } = buildSandboxMeteredLock({ payer, payee, maxLamports: BigInt(5380), challengeNonce: nonce });
    expect(escrow.equals(PublicKey.findProgramAddressSync([Buffer.from("escrow"), payer.toBytes(), escrowNonceBytes(nonce)], SANDBOX_ESCROW_PROGRAM_ID)[0])).toBe(true);
    expect(instruction.data.subarray(0, 8)).toEqual(IX.lock_metered_escrow);
    expect(instruction.data.readBigUInt64LE(8)).toBe(BigInt(5380));
    expect(Array.from(instruction.data.subarray(16))).toEqual(Array.from(escrowNonceBytes(nonce)));
    expect(instruction.keys.map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable])).toEqual([
      [escrow.toBase58(), false, true],
      [payer.toBase58(), true, true],
      [payee.toBase58(), false, false],
      ["11111111111111111111111111111111", false, false],
    ]);

    const settle = buildSandboxSettle({ escrow, payer, payee, actualLamports: BigInt(207) });
    expect(settle.data.subarray(0, 8)).toEqual(IX.settle_escrow);
    expect(settle.data.readBigUInt64LE(8)).toBe(BigInt(207));
    expect(settle.keys.map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable])).toEqual([
      [escrow.toBase58(), false, true],
      [payer.toBase58(), false, true],
      [payee.toBase58(), true, true],
      [SANDBOX_FEE_TREASURY, false, true],
      ["11111111111111111111111111111111", false, false],
    ]);
    expect(() => escrowNonceBytes("not-hex")).toThrow();
  });

  it("decodes an escrow account with and without a PER session key, and refuses other bytes", () => {
    const nonce = escrowNonceBytes("ffeeddccbbaa99887766554433221100");
    const base = { payer, payee: new PublicKey(swift.payTo), amount: BigInt(9), nonce };
    expect(decodeSandboxEscrow(escrowBytes(base))).toMatchObject({ amount: BigInt(9), status: "locked", metered: true });
    expect(decodeSandboxEscrow(escrowBytes({ ...base, session: Keypair.generate().publicKey, metered: false }))).toMatchObject({ metered: false });
    expect(decodeSandboxEscrow(escrowBytes({ ...base, status: 1 }))?.status).toBe("released");
    const wrongDisc = escrowBytes(base);
    wrongDisc[0] ^= 1;
    expect(decodeSandboxEscrow(wrongDisc)).toBeUndefined();
    expect(decodeSandboxEscrow(escrowBytes(base).slice(0, 40))).toBeUndefined();
  });
});

describe("sandbox metered escrow: gateway", () => {
  it("settles the actual tokens with the provider key and returns a metered reddi.receipt.v2", async () => {
    const accounts: Accounts = new Map();
    const { settler, calls } = fakeSettler();
    const deps = makeDeps(accounts, settler);
    const challenge = await call(deps);
    expect((challenge.body.sandbox as Record<string, unknown>).meteredPayment).toContain(SANDBOX_ESCROW_PROGRAM_ID.toBase58());
    const nonce = nonceOf(challenge);
    const escrow = lockFor(accounts, nonce);
    const response = await call(deps, meteredHeader(nonce, escrow));
    expect(response.status).toBe(200);

    const answer = (response.body.choices as { message: { content: string } }[])[0].message.content;
    const expected = settleSandboxCall(swift, { inputTokens: requestInputTokens(messages), outputTokens: countTokens(answer) }, MAX_LAMPORTS);
    expect(calls).toHaveLength(1);
    expect(calls[0].actualLamports).toBe(expected.amount);
    expect(calls[0].escrow.toBase58()).toBe(escrow);
    expect(calls[0].payee.toBase58()).toBe(swift.payTo);

    const receipt = decodeReceiptHeader(response.headers[PROVIDER_RECEIPT_HEADER]);
    expect(isSandboxReceipt(receipt)).toBe(true);
    if (!isSandboxReceipt(receipt)) return;
    expect(receipt.receipt.schemaVersion).toBe("reddi.receipt.v2");
    expect(receipt.receipt.payment).toMatchObject({
      txSignature: SETTLE_SIG,
      payer: payer.toBase58(),
      amount: expected.amount.toString(),
      settlement: "metered-escrow",
      metered: { maxAmount: MAX_LAMPORTS.toString(), refunded: expected.refunded.toString() },
    });
    expect(validateReddiReceiptV2(receipt.receipt)).toMatchObject({ ok: true });
    expect(verifyReddiReceiptV2(receipt)).toMatchObject({ ok: true });
    const checked = await verifySandboxReceipt({ receipt, model: swift.model, requestBody: JSON.stringify({ model: swift.model, messages }), responseBody: response.bodyText, expectedPayment: { amount: MAX_LAMPORTS.toString(), payer: payer.toBase58() } });
    expect(checked.ok).toBe(true);

    // One lock settles one call.
    const again = await call(deps, meteredHeader(nonce, escrow));
    expect(again.status).toBe(409);
    expect(calls).toHaveLength(1);
  });

  it("refuses a lock that does not match the challenge, without settling", async () => {
    const other = Keypair.generate().publicKey;
    const cases: { name: string; setup: (accounts: Accounts, nonce: string) => string; header?: (nonce: string, escrow: string) => string; reason: string }[] = [
      { name: "missing account", setup: (_accounts, nonce) => sandboxEscrowAddress(payer, nonce).toBase58(), reason: "invalid_receipt" },
      { name: "wrong owner", setup: (accounts, nonce) => lockFor(accounts, nonce, { owner: other }), reason: "invalid_receipt" },
      { name: "wrong amount", setup: (accounts, nonce) => lockFor(accounts, nonce, { amount: MAX_LAMPORTS - BigInt(1) }), reason: "wrong_amount" },
      { name: "wrong payee", setup: (accounts, nonce) => lockFor(accounts, nonce, { payee: other }), reason: "wrong_payee" },
      { name: "not metered", setup: (accounts, nonce) => lockFor(accounts, nonce, { metered: false }), reason: "invalid_receipt" },
      { name: "already released", setup: (accounts, nonce) => lockFor(accounts, nonce, { status: 1 }), reason: "duplicate_nonce" },
      { name: "escrow for another nonce", setup: (accounts) => lockFor(accounts, "0".repeat(32)), reason: "invalid_receipt" },
      { name: "payer who did not lock", setup: (accounts, nonce) => lockFor(accounts, nonce), header: (nonce, escrow) => meteredHeader(nonce, escrow, { payer: other.toBase58() }), reason: "invalid_receipt" },
    ];
    for (const entry of cases) {
      const accounts: Accounts = new Map();
      const { settler, calls } = fakeSettler();
      const deps = makeDeps(accounts, settler);
      const nonce = nonceOf(await call(deps));
      const escrow = entry.setup(accounts, nonce);
      const response = await call(deps, (entry.header ?? meteredHeader)(nonce, escrow));
      expect([entry.name, response.body.reason]).toEqual([entry.name, entry.reason]);
      expect(response.headers[PROVIDER_RECEIPT_HEADER]).toBeUndefined();
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses metered payments when the server holds no key for the provider", async () => {
    const accounts: Accounts = new Map();
    const deps = makeDeps(accounts, fakeSettler(false).settler);
    const challenge = await call(deps);
    expect((challenge.body.sandbox as Record<string, unknown>).meteredPayment).toBeUndefined();
    const nonce = nonceOf(challenge);
    const response = await call(deps, meteredHeader(nonce, lockFor(accounts, nonce)));
    expect(response.status).toBe(402);
    expect(response.body.reason).toBe("unsupported_receipt");
  });

  it("does not answer when the settle fails, and says the lock can be cancelled", async () => {
    const accounts: Accounts = new Map();
    const deps = makeDeps(accounts, fakeSettler(true, { ok: false, message: "The settle transaction failed on devnet." }).settler);
    const nonce = nonceOf(await call(deps));
    const escrow = lockFor(accounts, nonce);
    const response = await call(deps, meteredHeader(nonce, escrow));
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ charged: false, escrow });
    expect(response.body.choices).toBeUndefined();
    expect(response.headers[PROVIDER_RECEIPT_HEADER]).toBeUndefined();
  });

  it("lists metered availability per provider, never for an offline one", async () => {
    const listing = await sandboxModelsListing(fakeSettler(true).settler);
    const rows = listing.data as { rap: { providerId: string; meteredEscrow: { available: boolean; programId: string } } }[];
    for (const row of rows) {
      const provider = SANDBOX_PROVIDERS.find((entry) => entry.id === row.rap.providerId)!;
      expect(row.rap.meteredEscrow).toEqual({ available: provider.behaviour !== "offline", programId: SANDBOX_ESCROW_PROGRAM_ID.toBase58() });
    }
    const none = (await sandboxModelsListing()).data as { rap: { meteredEscrow: { available: boolean } } }[];
    expect(none.every((row) => row.rap.meteredEscrow.available === false)).toBe(true);
  });
});

describe("sandbox payee keys", () => {
  it("keeps only keys whose address is the catalog payee", () => {
    const stranger = Keypair.generate();
    expect(parseSandboxPayeeKeys(undefined).size).toBe(0);
    expect(parseSandboxPayeeKeys("not json").size).toBe(0);
    expect(parseSandboxPayeeKeys(JSON.stringify({ "swift-infer": Array.from(stranger.secretKey) })).size).toBe(0);
    expect(parseSandboxPayeeKeys(JSON.stringify({ "swift-infer": [1, 2, 3] })).size).toBe(0);
  });
});
