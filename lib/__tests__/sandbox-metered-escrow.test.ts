import { createPrivateKey, sign as edSign } from "crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MemoryNonceReplayStore } from "@redditech/x402-solana";
import { escrowAccountFlags, ratingPda } from "@redditech/x402-solana/rating";
import { pauseAddress } from "@redditech/x402-solana/pause";
import vectors from "@/programs/pinocchio-escrow/interface/vectors.json";
import { validateReddiReceiptV2, verifyReddiReceiptV2 } from "@redditech/agent-protocol/receipt-v2";
import { IX, ACCOUNT_DISC } from "@/lib/program";
import devnetProfile from "@/config/networks/devnet.json";
import { findSandboxProviderById, SANDBOX_PROVIDERS, scriptedSandboxAnswer } from "@/lib/sandbox/catalog";
import {
  buildSandboxMeteredLock,
  buildSandboxSettle,
  decodeSandboxEscrow,
  escrowNonceBytes,
  SANDBOX_ESCROW_DISCRIMINATORS,
  SANDBOX_CANCEL_WINDOW_SLOTS,
  SANDBOX_CLAIM_WINDOW_SLOTS,
  SANDBOX_ESCROW_PROGRAM_ID,
  sandboxEscrowAddress,
} from "@/lib/sandbox/escrow";
import { handleSandboxChatCompletion, sandboxModelsListing, type SandboxGatewayDeps } from "@/lib/sandbox/gateway";
import { countTokens, maxChargeLamports, requestInputTokens, SANDBOX_FEE_TREASURY, sandboxFeeBps, settleSandboxCall } from "@/lib/sandbox/pricing";
import { decodeReceiptHeader, isSandboxReceipt, PROVIDER_RECEIPT_HEADER, verifySandboxReceipt } from "@/lib/sandbox/receipt";
import { createSessionKey, paidCallAuthHeaders, sessionDelegationHeaderValue, SOLANA_GENESIS_HASHES, type MessageSigner } from "@/lib/payments/session-auth";
import { parseSandboxPayeeKeys, type SandboxSettleExpectation, type SandboxSettleInput, type SandboxSettleLookup, type SandboxSettler } from "@/lib/sandbox/settle-signer";
import { sandboxBuildOfRecord, type SandboxDeploymentCheck } from "@/lib/sandbox/deployment";

/** The emergency pause account of the sandbox program (`["pause"]`). */
const PAUSE = pauseAddress(SANDBOX_ESCROW_PROGRAM_ID).toBase58();

const ORIGIN = "https://sandbox.example";
const NOW_MS = Date.UTC(2026, 10, 21, 2, 0, 0);
const swift = findSandboxProviderById("swift-infer")!;
const messages = [{ role: "user", content: "Explain exponential backoff in two sentences." }];
const MAX_LAMPORTS = maxChargeLamports(swift, requestInputTokens(messages));
const payerKeypair = Keypair.generate();
const payer = payerKeypair.publicKey;
const signerFor = (keypair: Keypair): MessageSigner => (message) =>
  new Uint8Array(edSign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(keypair.secretKey.slice(0, 32))]), format: "der", type: "pkcs8" })));
const SETTLE_SIG = "3".repeat(88);
const LOCK_SIG = "2".repeat(88);
/** The slot the fake chain is at. Locks are made 10 slots earlier unless a test says otherwise. */
const CURRENT_SLOT = BigInt(1_000_000);

/** Borsh bytes of an EscrowAccount as Anchor writes it. */
function escrowBytes(fields: {
  payer: PublicKey;
  payee: PublicKey;
  amount: bigint;
  nonce: Uint8Array;
  status?: number;
  metered?: boolean;
  /** The payer opted the job in to rating: bit 0x02 of the flag byte. */
  rated?: boolean;
  /** The payer opted the job in to the delivery check: bit 0x04. */
  deliveryChecked?: boolean;
  /** Flag bits a later program might set, ORed into the flag byte. */
  extraFlags?: number;
  session?: PublicKey;
  /** `null` writes the account as the earlier program did, with no windows (149 bytes). */
  windows?: { claim: bigint; cancel: bigint } | null;
  createdSlot?: bigint;
}): Uint8Array {
  const parts: number[] = [...SANDBOX_ESCROW_DISCRIMINATORS.escrowAccount, ...fields.payer.toBytes(), ...fields.payee.toBytes()];
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(fields.amount);
  parts.push(...amount, ...fields.nonce, fields.status ?? 0);
  const time = Buffer.alloc(16);
  time.writeBigInt64LE(BigInt(Math.floor(NOW_MS / 1000)));
  time.writeBigUInt64LE(fields.createdSlot ?? CURRENT_SLOT - BigInt(10), 8);
  parts.push(...time);
  if (fields.windows !== null) {
    const windows = Buffer.alloc(16);
    windows.writeBigUInt64LE(fields.windows?.claim ?? SANDBOX_CLAIM_WINDOW_SLOTS);
    windows.writeBigUInt64LE(fields.windows?.cancel ?? SANDBOX_CANCEL_WINDOW_SLOTS, 8);
    parts.push(...windows);
  }
  parts.push(0);
  if (fields.session) parts.push(1, ...fields.session.toBytes());
  else parts.push(0);
  parts.push(255, (fields.metered === false ? 0 : 1) | (fields.rated ? 2 : 0) | (fields.deliveryChecked ? 4 : 0) | (fields.extraFlags ?? 0));
  // Anchor allocates the full LEN; a None session leaves 32 trailing zero bytes.
  const len = fields.windows === null ? 149 : 165;
  while (parts.length < len) parts.push(0);
  return Uint8Array.from(parts);
}

type Accounts = Map<string, { owner: PublicKey; data: Uint8Array }>;

const DEPLOYMENT_OF_RECORD: SandboxDeploymentCheck = { ok: true, build: sandboxBuildOfRecord()! };

type FakeSettleResult = { ok: true; signature: string; feeLamports?: bigint } | { ok: false; message: string } | { ok: false; pending: true; signature: string; message: string };

/** The fee the treasury would receive at today's rate. A fake settle reports it as read from the chain unless told otherwise. */
const feeAtTodaysRate = (actual: bigint) => (actual * sandboxFeeBps()) / BigInt(10_000);

function fakeSettler(available = true, result: FakeSettleResult = { ok: true, signature: SETTLE_SIG }, deployment: SandboxDeploymentCheck = DEPLOYMENT_OF_RECORD, lookupResult: SandboxSettleLookup = { state: "unknown" }) {
  const calls: SandboxSettleInput[] = [];
  const lookups: { signature: string; expected: SandboxSettleExpectation }[] = [];
  const settler: SandboxSettler = {
    canSettle: () => available,
    deployment: async () => deployment,
    async settle(input) {
      calls.push(input);
      if (result.ok) return { ...result, feeLamports: result.feeLamports ?? feeAtTodaysRate(input.actualLamports) };
      return result;
    },
    async lookup(signature, expected) {
      lookups.push({ signature, expected });
      return lookupResult;
    },
  };
  return { settler, calls, lookups };
}

function makeDeps(accounts: Accounts, settler: SandboxSettler | undefined): SandboxGatewayDeps {
  let counter = 0;
  return {
    connection: { getGenesisHash: async () => "", getParsedTransaction: async () => null } as unknown as SandboxGatewayDeps["connection"],
    replayStore: new MemoryNonceReplayStore(),
    readAccount: async (address) => accounts.get(address.toBase58()) ?? null,
    readSlot: async () => CURRENT_SLOT,
    settler,
    now: () => NOW_MS,
    newNonce: () => (++counter).toString(16).padStart(32, "a"),
  };
}

/** The payer's delegation to a fresh key and that key's `single` signature over the body (#866). */
async function singleCallAuth(escrow: string, body: string, signer: MessageSigner = signerFor(payerKeypair)) {
  const sessionKey = await createSessionKey();
  const delegation = await sessionDelegationHeaderValue({ genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"], escrow, provider: swift.payTo, sessionKey: sessionKey.publicKey, expiresAt: Math.floor(NOW_MS / 1000) + 600 }, signer);
  const headers = await paidCallAuthHeaders({ genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"], delegation, sessionKey, escrow, body });
  return { delegation: headers["x402-session-delegation"], signature: headers["x402-session-signature"] };
}

/** Sends the request; a metered payment is signed by the payer unless `auth` says otherwise. */
async function call(deps: SandboxGatewayDeps, paymentHeader?: string, auth: "payer" | "none" | MessageSigner = "payer", settleSignature?: string) {
  const body = { model: swift.model, messages };
  const rawBody = JSON.stringify(body);
  let session: { delegation: string; signature: string } | undefined;
  try {
    const parsed = paymentHeader ? (JSON.parse(paymentHeader) as { settlement?: string; escrow?: string }) : undefined;
    if (parsed?.settlement === "metered-escrow" && typeof parsed.escrow === "string" && auth !== "none") {
      session = await singleCallAuth(parsed.escrow, rawBody, auth === "payer" ? undefined : auth);
    }
  } catch {
    // Not JSON: nothing to sign.
  }
  return handleSandboxChatCompletion({ body, rawBody, paymentHeader, origin: ORIGIN, ...(session ? { session } : {}), ...(settleSignature ? { settleSignature } : {}) }, deps);
}

/** The slot a rated lock's rating was opened in: the lock's own. */
const OPENED_SLOT = CURRENT_SLOT - BigInt(10);

/** A rating account awaiting settlement for `escrow`, as the program writes it (270 bytes). */
function ratingBytes(escrow: PublicKey, fields: { openedSlot?: bigint; state?: number } = {}): Uint8Array {
  const data = Buffer.alloc(270);
  Buffer.from(vectors.accounts.find((entry) => entry.name === "rating_awaiting_settlement")!.data_hex, "hex").copy(data, 0, 0, 8);
  escrow.toBuffer().copy(data, 8);
  payer.toBuffer().copy(data, 40);
  new PublicKey(swift.payTo).toBuffer().copy(data, 72);
  data.writeBigUInt64LE(fields.openedSlot ?? OPENED_SLOT, 240);
  data[264] = fields.state ?? 0;
  return data;
}

function lockFor(accounts: Accounts, nonce: string, overrides: Partial<Parameters<typeof escrowBytes>[0]> & { owner?: PublicKey } = {}): string {
  const escrow = sandboxEscrowAddress(payer, nonce);
  accounts.set(escrow.toBase58(), {
    owner: overrides.owner ?? SANDBOX_ESCROW_PROGRAM_ID,
    data: escrowBytes({ payer, payee: new PublicKey(swift.payTo), amount: MAX_LAMPORTS, nonce: escrowNonceBytes(nonce), ...overrides }),
  });
  if (overrides.rated) accounts.set(ratingPda(escrow, SANDBOX_ESCROW_PROGRAM_ID).toBase58(), { owner: SANDBOX_ESCROW_PROGRAM_ID, data: ratingBytes(escrow) });
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
    expect(Buffer.from(SANDBOX_ESCROW_DISCRIMINATORS.cancelEscrow)).toEqual(IX.cancel_escrow);
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
    expect(Array.from(instruction.data.subarray(16, 32))).toEqual(Array.from(escrowNonceBytes(nonce)));
    // Both windows follow, in slots: the provider may claim from the first, the visitor may refund from the second.
    expect(instruction.data.length).toBe(48);
    expect(instruction.data.readBigUInt64LE(32)).toBe(SANDBOX_CLAIM_WINDOW_SLOTS);
    expect(instruction.data.readBigUInt64LE(40)).toBe(SANDBOX_CANCEL_WINDOW_SLOTS);
    expect(SANDBOX_CLAIM_WINDOW_SLOTS <= SANDBOX_CANCEL_WINDOW_SLOTS).toBe(true);
    const custom = buildSandboxMeteredLock({ payer, payee, maxLamports: BigInt(1), challengeNonce: nonce, claimWindowSlots: BigInt(25), cancelWindowSlots: BigInt(2_000) });
    expect([custom.instruction.data.readBigUInt64LE(32), custom.instruction.data.readBigUInt64LE(40)]).toEqual([BigInt(25), BigInt(2_000)]);
    expect(instruction.keys.map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable])).toEqual([
      [escrow.toBase58(), false, true],
      [payer.toBase58(), true, true],
      [payee.toBase58(), false, false],
      ["11111111111111111111111111111111", false, false],
      // The emergency pause account, read only: a lock is refused while the protocol is paused.
      [PAUSE, false, false],
    ]);

    // A build before the freeze refuses the slot on an unrated exit (6051), so the sandbox leaves it off there.
    const deployed = buildSandboxSettle({ escrow, payer, payee, actualLamports: BigInt(207), createdSlot: BigInt(4242), namesUnratedExits: false });
    expect(deployed.data).toHaveLength(16);
    expect(deployed.data.subarray(0, 8)).toEqual(IX.settle_escrow);
    expect(deployed.data.readBigUInt64LE(8)).toBe(BigInt(207));
    expect(buildSandboxSettle({ escrow, payer, payee, actualLamports: BigInt(207), rated: false, createdSlot: BigInt(4242), namesUnratedExits: false }).data).toEqual(deployed.data);
    // No encoding chosen, no settle: a caller must check which build is deployed first.
    expect(() => buildSandboxSettle({ escrow, payer, payee, actualLamports: BigInt(207), createdSlot: BigInt(4242) } as unknown as Parameters<typeof buildSandboxSettle>[0])).toThrow("namesUnratedExits");

    // A program that names every exit gets the slot on an unrated settle too.
    const settle = buildSandboxSettle({ escrow, payer, payee, actualLamports: BigInt(207), createdSlot: BigInt(4242), namesUnratedExits: true });
    expect(deployed.keys).toEqual(settle.keys);
    expect(settle.data.subarray(0, 8)).toEqual(IX.settle_escrow);
    expect(settle.data.readBigUInt64LE(8)).toBe(BigInt(207));
    // The escrow's lock slot follows the data: the settle names this escrow and no later one at its address.
    expect(settle.data).toHaveLength(24);
    expect(settle.data.readBigUInt64LE(16)).toBe(BigInt(4242));
    expect(settle.keys.map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable])).toEqual([
      [escrow.toBase58(), false, true],
      [payer.toBase58(), false, true],
      [payee.toBase58(), true, true],
      [SANDBOX_FEE_TREASURY, false, true],
      ["11111111111111111111111111111111", false, false],
      // A settle pays the provider, so it takes the pause account too, last.
      [PAUSE, false, false],
    ]);
    expect(() => escrowNonceBytes("not-hex")).toThrow();

    // Not rated: exactly the same instruction whether or not `rated` is stated.
    const unrated = buildSandboxSettle({ escrow, payer, payee, actualLamports: BigInt(207), rated: false, createdSlot: BigInt(4242), namesUnratedExits: true });
    expect(unrated.data).toEqual(settle.data);
    expect(unrated.keys).toEqual(settle.keys);
    // Without the lock slot no settle is built, rated or not: the program would refuse it.
    for (const rated of [false, true]) {
      expect(() => buildSandboxSettle({ escrow, payer, payee, actualLamports: BigInt(207), rated, createdSlot: undefined as unknown as bigint, namesUnratedExits: true })).toThrow("createdSlot");
    }
    // Rated: the escrow's rating account follows the five usual accounts, writable; the data is the same.
    const rated = buildSandboxSettle({ escrow, payer, payee, actualLamports: BigInt(207), rated: true, createdSlot: BigInt(4242), namesUnratedExits: false });
    expect(rated.data).toEqual(settle.data);
    expect(rated.keys.slice(0, 5)).toEqual(settle.keys.slice(0, 5));
    // The rating account follows the usual accounts; the pause account stays last.
    expect(rated.keys.slice(5).map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable])).toEqual([
      [ratingPda(escrow, SANDBOX_ESCROW_PROGRAM_ID).toBase58(), false, true],
      [PAUSE, false, false],
    ]);
  });

  it("builds the rated settle of the program's interface vector, byte for byte", () => {
    const vector = vectors.instructions.find((entry) => entry.name === "settle_escrow")!;
    const at = (name: string) => new PublicKey(vector.accounts.find((meta) => meta.name === name)!.address);
    expect(at("treasury").toBase58()).toBe(SANDBOX_FEE_TREASURY);
    const settle = buildSandboxSettle({ escrow: at("escrow"), payer: at("payer"), payee: at("payee"), actualLamports: BigInt(600_000), rated: true, createdSlot: BigInt(1000), programId: new PublicKey(vectors.program_id), namesUnratedExits: true });
    expect(settle.data.toString("hex")).toBe(vector.data_hex);
    expect(settle.keys.map((key) => ({ address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable }))).toEqual(
      vector.accounts.map(({ address, signer, writable }) => ({ address, signer, writable })),
    );
  });

  it("reads the flag byte by its bits: metered 0x01, rated 0x02", () => {
    const base = { payer, payee: new PublicKey(swift.payTo), amount: BigInt(9), nonce: escrowNonceBytes("ffeeddccbbaa99887766554433221100") };
    const cases: [{ metered?: boolean; rated?: boolean }, number, boolean, boolean][] = [
      [{ metered: false }, 0, false, false],
      [{}, 1, true, false],
      [{ metered: false, rated: true }, 2, false, true],
      [{ rated: true }, 3, true, true],
    ];
    for (const [fields, byte, metered, rated] of cases) {
      for (const layout of [{}, { session: new PublicKey(SANDBOX_FEE_TREASURY) }] as const) {
        const bytes = escrowBytes({ ...base, ...fields, ...layout });
        expect(decodeSandboxEscrow(bytes)).toMatchObject({ metered, rated });
        // The package's own reader agrees on every layout.
        expect(escrowAccountFlags(bytes)).toEqual({ kind: "sol", metered, rated, deliveryChecked: false, unknownBits: 0 });
      }
      expect(escrowBytes({ ...base, ...fields })[132]).toBe(byte);
    }
    // The program's own example of a rated metered SOL escrow.
    const example = Buffer.from(vectors.accounts.find((entry) => entry.name === "sol_escrow_rated_metered")!.data_hex, "hex");
    expect(decodeSandboxEscrow(example)).toMatchObject({ metered: true, rated: true, status: "locked", amount: BigInt(1_000_000), claimWindowSlots: BigInt(1_500), cancelWindowSlots: BigInt(4_500) });
    // And of a delivery-checked metered one (bit 0x04), which the gateway refuses.
    const checked = Buffer.from(vectors.accounts.find((entry) => entry.name === "sol_escrow_delivery_checked_metered")!.data_hex, "hex");
    expect(decodeSandboxEscrow(checked)).toMatchObject({ metered: true, rated: false, deliveryChecked: true, unknownFlagBits: 0 });
    expect(escrowAccountFlags(checked)).toEqual({ kind: "sol", metered: true, rated: false, deliveryChecked: true, unknownBits: 0 });
  });

  it("decodes an escrow account with and without a PER session key, and refuses other bytes", () => {
    const nonce = escrowNonceBytes("ffeeddccbbaa99887766554433221100");
    const base = { payer, payee: new PublicKey(swift.payTo), amount: BigInt(9), nonce };
    expect(decodeSandboxEscrow(escrowBytes(base))).toMatchObject({
      amount: BigInt(9),
      status: "locked",
      metered: true,
      claimWindowSlots: SANDBOX_CLAIM_WINDOW_SLOTS,
      cancelWindowSlots: SANDBOX_CANCEL_WINDOW_SLOTS,
    });
    expect(decodeSandboxEscrow(escrowBytes({ ...base, windows: { claim: BigInt(25), cancel: BigInt(250) } }))).toMatchObject({ claimWindowSlots: BigInt(25), cancelWindowSlots: BigInt(250), metered: true });
    // An account the earlier program wrote has no windows and is 16 bytes shorter; the program refuses it, and so does the decoder.
    expect(decodeSandboxEscrow(escrowBytes({ ...base, windows: null }))).toBeUndefined();
    expect(decodeSandboxEscrow(escrowBytes({ ...base, windows: null, session: Keypair.generate().publicKey, metered: false }))).toBeUndefined();
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

  it("declines a rated metered escrow before serving by default, and leaves the lock unremembered", async () => {
    const accounts: Accounts = new Map();
    const { settler, calls } = fakeSettler();
    const deps = makeDeps(accounts, settler);
    const nonce = nonceOf(await call(deps));
    const escrow = lockFor(accounts, nonce, { rated: true });
    const response = await call(deps, meteredHeader(nonce, escrow));
    expect(response.status).not.toBe(200);
    expect(response.body.reason).toBe("unsupported_receipt");
    expect(JSON.stringify(response.body)).toContain("opted in to rating");
    expect(response.headers[PROVIDER_RECEIPT_HEADER]).toBeUndefined();
    expect(response.body.choices).toBeUndefined();
    expect(calls).toHaveLength(0);
    // Not remembered as used: the same lock is served once the gateway accepts rated escrows.
    const accepted = await call({ ...deps, acceptRatedEscrows: true }, meteredHeader(nonce, escrow));
    expect(accepted.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].rated).toBe(true);
    expect(calls[0].createdSlot).toBe(OPENED_SLOT);
  });

  it("declines a delivery-checked escrow before serving, even when it accepts rated escrows, and leaves the lock unremembered", async () => {
    const accounts: Accounts = new Map();
    const { settler, calls } = fakeSettler();
    const deps = { ...makeDeps(accounts, settler), acceptRatedEscrows: true };
    const nonce = nonceOf(await call(deps));
    for (const rated of [false, true]) {
      const escrow = lockFor(accounts, nonce, { rated, deliveryChecked: true });
      const response = await call(deps, meteredHeader(nonce, escrow));
      expect(response.body.reason).toBe("unsupported_receipt");
      expect(JSON.stringify(response.body)).toContain("delivery check");
      expect(response.headers[PROVIDER_RECEIPT_HEADER]).toBeUndefined();
      expect(calls).toHaveLength(0);
    }
    // Not remembered: the same lock without the bit is served.
    const escrow = lockFor(accounts, nonce);
    expect((await call(deps, meteredHeader(nonce, escrow))).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("declines an escrow with flag bits it does not know before serving, and leaves the lock unremembered", async () => {
    const accounts: Accounts = new Map();
    const { settler, calls } = fakeSettler();
    const deps = { ...makeDeps(accounts, settler), acceptRatedEscrows: true };
    const nonce = nonceOf(await call(deps));
    for (const extraFlags of [0x08, 0x40, 0xf8]) {
      const escrow = lockFor(accounts, nonce, { extraFlags });
      expect(decodeSandboxEscrow(accounts.get(escrow)!.data)).toMatchObject({ unknownFlagBits: extraFlags });
      const response = await call(deps, meteredHeader(nonce, escrow));
      expect(response.body.reason).toBe("unsupported_receipt");
      expect(JSON.stringify(response.body)).toContain("options this provider does not know");
      expect(response.headers[PROVIDER_RECEIPT_HEADER]).toBeUndefined();
      expect(calls).toHaveLength(0);
    }
    const escrow = lockFor(accounts, nonce);
    expect((await call(deps, meteredHeader(nonce, escrow))).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("when set to accept rated escrows, tells the settler to pass the rating account; an unrated one is settled as before", async () => {
    for (const rated of [true, false]) {
      const accounts: Accounts = new Map();
      const { settler, calls } = fakeSettler();
      const deps = { ...makeDeps(accounts, settler), acceptRatedEscrows: true };
      const nonce = nonceOf(await call(deps));
      const escrow = lockFor(accounts, nonce, { rated });
      const response = await call(deps, meteredHeader(nonce, escrow));
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0].rated).toBe(rated);
      // Every settle names its escrow by the lock slot; a rated job's rating opened in that slot.
      expect(calls[0].createdSlot).toBe(CURRENT_SLOT - BigInt(10));
      expect(calls[0].escrow.toBase58()).toBe(escrow);
    }
  });

  it("refuses a rated escrow whose rating account is missing, another escrow's or past settlement, before serving", async () => {
    for (const rating of ["missing", "other", "paid", "earlier job"] as const) {
      const accounts: Accounts = new Map();
      const { settler, calls } = fakeSettler();
      const deps = { ...makeDeps(accounts, settler), acceptRatedEscrows: true };
      const nonce = nonceOf(await call(deps));
      const escrow = lockFor(accounts, nonce, { rated: true });
      const address = ratingPda(new PublicKey(escrow), SANDBOX_ESCROW_PROGRAM_ID).toBase58();
      if (rating === "missing") accounts.delete(address);
      if (rating === "other") accounts.set(address, { owner: SANDBOX_ESCROW_PROGRAM_ID, data: ratingBytes(Keypair.generate().publicKey) });
      if (rating === "earlier job") accounts.set(address, { owner: SANDBOX_ESCROW_PROGRAM_ID, data: ratingBytes(new PublicKey(escrow), { openedSlot: OPENED_SLOT - BigInt(1) }) });
      if (rating === "paid") accounts.set(address, { owner: SANDBOX_ESCROW_PROGRAM_ID, data: ratingBytes(new PublicKey(escrow), { state: 1 }) });
      const response = await call(deps, meteredHeader(nonce, escrow));
      expect(response.body.reason).toBe("invalid_receipt");
      expect(JSON.stringify(response.body)).toContain("rating account");
      expect(calls).toHaveLength(0);
    }
  });

  it("still refuses a rated escrow that is not metered", async () => {
    const accounts: Accounts = new Map();
    const { settler, calls } = fakeSettler();
    const deps = makeDeps(accounts, settler);
    const nonce = nonceOf(await call(deps));
    const response = await call({ ...deps, acceptRatedEscrows: true }, meteredHeader(nonce, lockFor(accounts, nonce, { metered: false, rated: true })));
    expect(response.body.reason).toBe("invalid_receipt");
    expect(calls).toHaveLength(0);
  });

  it("settles an unrated escrow with rated false whatever the setting", async () => {
    for (const acceptRatedEscrows of [undefined, false, true]) {
      const accounts: Accounts = new Map();
      const { settler, calls } = fakeSettler();
      const deps = { ...makeDeps(accounts, settler), ...(acceptRatedEscrows === undefined ? {} : { acceptRatedEscrows }) };
      const nonce = nonceOf(await call(deps));
      expect((await call(deps, meteredHeader(nonce, lockFor(accounts, nonce)))).status).toBe(200);
      expect(calls.map((entry) => entry.rated)).toEqual([false]);
    }
  });

  it("refuses a lock that does not match the challenge, without settling", async () => {
    const other = Keypair.generate().publicKey;
    const cases: { name: string; setup: (accounts: Accounts, nonce: string) => string; header?: (nonce: string, escrow: string) => string; reason: string }[] = [
      { name: "missing account", setup: (_accounts, nonce) => sandboxEscrowAddress(payer, nonce).toBase58(), reason: "invalid_receipt" },
      { name: "wrong owner", setup: (accounts, nonce) => lockFor(accounts, nonce, { owner: other }), reason: "invalid_receipt" },
      { name: "wrong amount", setup: (accounts, nonce) => lockFor(accounts, nonce, { amount: MAX_LAMPORTS - BigInt(1) }), reason: "wrong_amount" },
      { name: "wrong payee", setup: (accounts, nonce) => lockFor(accounts, nonce, { payee: other }), reason: "wrong_payee" },
      { name: "not metered", setup: (accounts, nonce) => lockFor(accounts, nonce, { metered: false }), reason: "invalid_receipt" },
      { name: "refund window too short", setup: (accounts, nonce) => lockFor(accounts, nonce, { windows: { claim: BigInt(1), cancel: BigInt(1_499) } }), reason: "invalid_receipt" },
      // A long window named at lock, most of it already used up before the call.
      { name: "refund window nearly over", setup: (accounts, nonce) => lockFor(accounts, nonce, { createdSlot: CURRENT_SLOT - BigInt(3_001) }), reason: "invalid_receipt" },
      { name: "refund window already open", setup: (accounts, nonce) => lockFor(accounts, nonce, { createdSlot: CURRENT_SLOT - BigInt(10_000) }), reason: "invalid_receipt" },
      { name: "earlier-format lock", setup: (accounts, nonce) => lockFor(accounts, nonce, { windows: null }), reason: "invalid_receipt" },
      { name: "already released", setup: (accounts, nonce) => lockFor(accounts, nonce, { status: 1 }), reason: "duplicate_nonce" },
      { name: "escrow for another nonce", setup: (accounts) => lockFor(accounts, "0".repeat(32)), reason: "invalid_receipt" },
      { name: "payer who did not lock", setup: (accounts, nonce) => lockFor(accounts, nonce), header: (nonce, escrow) => meteredHeader(nonce, escrow, { payer: other.toBase58() }), reason: "session_auth_invalid" },
    ];
    for (const entry of cases) {
      const accounts: Accounts = new Map();
      const { settler, calls } = fakeSettler();
      const deps = makeDeps(accounts, settler);
      const nonce = nonceOf(await call(deps));
      const escrow = entry.setup(accounts, nonce);
      const response = await call(deps, (entry.header ?? meteredHeader)(nonce, escrow));
      // A payer the caller cannot sign for is refused by the auth check (#866), before the chain is read.
      expect([entry.name, response.body.reason ?? (response.body.error as { code?: string } | undefined)?.code]).toEqual([entry.name, entry.reason]);
      expect(response.headers[PROVIDER_RECEIPT_HEADER]).toBeUndefined();
      expect(calls).toHaveLength(0);
    }
  });

  it("accepts a lock with exactly the minimum left, and nothing when the slot cannot be read", async () => {
    for (const overrides of [{ createdSlot: CURRENT_SLOT - BigInt(3_000) }] as const) {
      const accounts: Accounts = new Map();
      const { settler, calls } = fakeSettler();
      const deps = makeDeps(accounts, settler);
      const nonce = nonceOf(await call(deps));
      const response = await call(deps, meteredHeader(nonce, lockFor(accounts, nonce, overrides)));
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
    }

    const accounts: Accounts = new Map();
    const { settler, calls } = fakeSettler();
    const deps = makeDeps(accounts, settler);
    const nonce = nonceOf(await call(deps));
    const header = meteredHeader(nonce, lockFor(accounts, nonce));
    const blind = await call({ ...deps, readSlot: async () => Promise.reject(new Error("rpc down")) }, header);
    expect(blind.body.reason).toBe("unsupported_receipt");
    expect(calls).toHaveLength(0);
    expect((await call({ ...deps, readSlot: undefined }, header)).body.reason).toBe("unsupported_receipt");
    // Nothing was remembered, so the same lock is good once the chain can be read.
    expect((await call(deps, header)).status).toBe(200);
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

  it("offers and serves a metered escrow only while devnet runs the program build of record (audit S7-Codex-R2-06)", async () => {
    const accounts: Accounts = new Map();
    const paused = fakeSettler(true, undefined, { ok: false, message: "The devnet escrow program is not a build the sandbox knows how to settle with, so paid calls are paused." });
    const deps = makeDeps(accounts, paused.settler);
    const challenge = await call(deps);
    expect((challenge.body.sandbox as Record<string, unknown>).meteredPayment).toBeUndefined();
    const nonce = nonceOf(challenge);
    const escrow = lockFor(accounts, nonce);
    const response = await call(deps, meteredHeader(nonce, escrow));
    expect(response.status).toBe(402);
    expect(response.body.reason).toBe("unsupported_receipt");
    expect(String((response.body.error as { message: string }).message)).toContain("paused");
    expect(response.body.choices).toBeUndefined();
    expect(paused.calls).toHaveLength(0);
    const rows = (await sandboxModelsListing(paused.settler)).data as { rap: { meteredEscrow: { available: boolean } } }[];
    expect(rows.every((row) => row.rap.meteredEscrow.available === false)).toBe(true);
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
      // Rated escrows are declined unless the operator turned them on (#842).
      // Studios take simulated payments only, so they never offer an escrow.
      expect(row.rap.meteredEscrow).toEqual({ available: provider.behaviour !== "offline" && !provider.simulatedOnly, programId: SANDBOX_ESCROW_PROGRAM_ID.toBase58(), acceptsRatedEscrows: false });
    }
    const rated = (await sandboxModelsListing(fakeSettler(true).settler, true)).data as { rap: { meteredEscrow: { acceptsRatedEscrows: boolean } } }[];
    expect(rated.every((row) => row.rap.meteredEscrow.acceptsRatedEscrows === true)).toBe(true);
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

describe("sandbox metered escrow: single calls are signed by the payer (#866)", () => {
  it("refuses an unsigned call or one signed by another wallet with 401, before reading the chain", async () => {
    const reads: string[] = [];
    const deps = makeDeps(new Map(), fakeSettler().settler);
    const readAccount = deps.readAccount!;
    deps.readAccount = async (address) => {
      reads.push(address.toBase58());
      return readAccount(address);
    };
    const nonce = "0".repeat(31) + "1";
    const escrow = sandboxEscrowAddress(payer, nonce).toBase58();
    const header = JSON.stringify({ settlement: "metered-escrow", network: "solana-devnet", payTo: swift.payTo, amount: "x", currency: "SOL", nonce, escrow, lockSignature: LOCK_SIG, payer: payer.toBase58() });
    const unsigned = await call(deps, header, "none");
    expect(unsigned.status).toBe(401);
    expect((unsigned.body.error as { code?: string }).code).toBe("session_auth_required");
    const stranger = await call(deps, header, signerFor(Keypair.generate()));
    expect(stranger.status).toBe(401);
    expect((stranger.body.error as { code?: string }).code).toBe("session_auth_invalid");
    expect(reads).toHaveLength(0);
  });
});

describe("sandbox metered escrow: a settle whose outcome is unknown (audit S7-Codex-R2-04, R2-05)", () => {
  const PENDING_SIG = "4".repeat(88);

  it("never says nothing was charged when the settle was sent but not confirmed, and names the settle", async () => {
    const accounts: Accounts = new Map();
    const { settler } = fakeSettler(true, { ok: false, pending: true, signature: PENDING_SIG, message: "The settle transaction was sent, but devnet did not confirm whether it landed." });
    const deps = makeDeps(accounts, settler);
    const nonce = nonceOf(await call(deps));
    const escrow = lockFor(accounts, nonce);
    const response = await call(deps, meteredHeader(nonce, escrow));
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ charged: "unknown", escrow, settleSignature: PENDING_SIG, error: { code: "settle_pending" } });
    expect(response.bodyText).not.toMatch(/nothing was charged/i);
    expect(response.bodyText).toContain("do not cancel");
    expect(response.body.choices).toBeUndefined();
    expect(response.headers[PROVIDER_RECEIPT_HEADER]).toBeUndefined();
  });

  it("gives the payer the answer on a retry naming the settle, once it has landed, with the fee the chain took", async () => {
    const accounts: Accounts = new Map();
    const answer = scriptedSandboxAnswer(swift, messages[messages.length - 1].content);
    const expected = settleSandboxCall(swift, { inputTokens: requestInputTokens(messages), outputTokens: countTokens(answer) }, MAX_LAMPORTS);
    // The chain took 5% (a settle that landed after the switch), whatever today's rate is.
    const chainFee = (expected.amount * BigInt(500)) / BigInt(10_000);
    const { settler, calls, lookups } = fakeSettler(true, { ok: false, pending: true, signature: PENDING_SIG, message: "unknown" }, DEPLOYMENT_OF_RECORD, { state: "settled", feeLamports: chainFee });
    const deps = makeDeps(accounts, settler);
    const nonce = nonceOf(await call(deps));
    const escrow = lockFor(accounts, nonce);
    expect((await call(deps, meteredHeader(nonce, escrow))).status).toBe(202);
    // The settle landed and closed the escrow.
    accounts.delete(escrow);
    const retry = await call(deps, meteredHeader(nonce, escrow), "payer", PENDING_SIG);
    expect(retry.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(lookups).toEqual([{ signature: PENDING_SIG, expected: { escrow: new PublicKey(escrow), payer, payee: new PublicKey(swift.payTo), actualLamports: expected.amount } }]);
    const receipt = decodeReceiptHeader(retry.headers[PROVIDER_RECEIPT_HEADER]);
    if (!isSandboxReceipt(receipt)) throw new Error("no receipt");
    expect(receipt.receipt.payment).toMatchObject({ txSignature: PENDING_SIG, amount: expected.amount.toString(), fee: { amount: chainFee.toString(), treasury: SANDBOX_FEE_TREASURY }, payer: payer.toBase58() });
    expect(verifyReddiReceiptV2(receipt)).toMatchObject({ ok: true });
    // Another wallet cannot collect it.
    const stranger = await call(deps, meteredHeader(nonce, escrow), signerFor(Keypair.generate()), PENDING_SIG);
    expect(stranger.status).toBe(401);
    expect(stranger.body.choices).toBeUndefined();
    // One settle pays for one answer: the payer cannot collect it again (audit S7-claude2-04).
    const again = await call(deps, meteredHeader(nonce, escrow), "payer", PENDING_SIG);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: "payment_already_used" } });
    expect(again.body.choices).toBeUndefined();
    expect(again.headers[PROVIDER_RECEIPT_HEADER]).toBeUndefined();
  });

  it("does not use up the settle on a retry that finds it unconfirmed", async () => {
    const accounts: Accounts = new Map();
    const chain: { lookup: { state: "unknown" } | { state: "settled"; feeLamports: bigint } } = { lookup: { state: "unknown" } };
    const { settler } = fakeSettler(true, { ok: false, pending: true, signature: PENDING_SIG, message: "unknown" }, DEPLOYMENT_OF_RECORD, { state: "unknown" });
    settler.lookup = async () => chain.lookup;
    const deps = makeDeps(accounts, settler);
    const nonce = nonceOf(await call(deps));
    const escrow = lockFor(accounts, nonce);
    await call(deps, meteredHeader(nonce, escrow));
    expect((await call(deps, meteredHeader(nonce, escrow), "payer", PENDING_SIG)).status).toBe(202);
    chain.lookup = { state: "settled", feeLamports: BigInt(1) };
    expect((await call(deps, meteredHeader(nonce, escrow), "payer", PENDING_SIG)).status).toBe(200);
  });

  it("keeps the retry pending while devnet has not confirmed, and says so when the settle did not land", async () => {
    for (const [lookup, status, charged] of [[{ state: "unknown" }, 202, "unknown"], [{ state: "failed" }, 502, false]] as const) {
      const accounts: Accounts = new Map();
      const { settler } = fakeSettler(true, { ok: false, pending: true, signature: PENDING_SIG, message: "unknown" }, DEPLOYMENT_OF_RECORD, lookup);
      const deps = makeDeps(accounts, settler);
      const nonce = nonceOf(await call(deps));
      const escrow = lockFor(accounts, nonce);
      await call(deps, meteredHeader(nonce, escrow));
      const retry = await call(deps, meteredHeader(nonce, escrow), "payer", PENDING_SIG);
      expect(retry.status).toBe(status);
      expect(retry.body.charged).toBe(charged);
      expect(retry.body.choices).toBeUndefined();
    }
  });

  it("signs the fee the settle paid the treasury, not the server clock's rate (audit S7-Codex-R2-05)", async () => {
    const accounts: Accounts = new Map();
    const { settler } = fakeSettler(true, { ok: true, signature: SETTLE_SIG, feeLamports: BigInt(7) });
    const deps = makeDeps(accounts, settler);
    const nonce = nonceOf(await call(deps));
    const escrow = lockFor(accounts, nonce);
    const response = await call(deps, meteredHeader(nonce, escrow));
    expect(response.status).toBe(200);
    const receipt = decodeReceiptHeader(response.headers[PROVIDER_RECEIPT_HEADER]);
    if (!isSandboxReceipt(receipt)) throw new Error("no receipt");
    expect(receipt.receipt.payment?.fee).toEqual({ amount: "7", treasury: SANDBOX_FEE_TREASURY });
  });
});
