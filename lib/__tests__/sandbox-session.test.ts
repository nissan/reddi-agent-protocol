import { Keypair, PublicKey } from "@solana/web3.js";
import { MemoryNonceReplayStore } from "@reddi/x402-solana";
import { ratingPda } from "@reddi/x402-solana/rating";
import vectors from "@/programs/pinocchio-escrow/interface/vectors.json";
import { findSandboxProviderById } from "@/lib/sandbox/catalog";
import {
  escrowNonceBytes,
  SANDBOX_ESCROW_DISCRIMINATORS,
  SANDBOX_CANCEL_WINDOW_SLOTS,
  SANDBOX_CLAIM_WINDOW_SLOTS,
  SANDBOX_ESCROW_PROGRAM_ID,
  sandboxEscrowAddress,
} from "@/lib/sandbox/escrow";
import {
  handleSandboxChatCompletion,
  SESSION_RECEIPT_HEADER,
  SESSION_STATE_HEADER,
  type SandboxGatewayDeps,
  type SandboxGatewayResponse,
} from "@/lib/sandbox/gateway";
import { countTokens, formatUnits, maxChargeLamports, requestInputTokens, SANDBOX_FEE_TREASURY, sessionCallLamports } from "@/lib/sandbox/pricing";
import {
  decodeReceiptHeader,
  encodeReceiptHeader,
  hashSandboxReceipt,
  isSandboxReceipt,
  PROVIDER_RECEIPT_HEADER,
  SANDBOX_SIMULATED_RECEIPT_HEADER,
  verifySandboxReceipt,
  type SandboxReceipt,
} from "@/lib/sandbox/receipt";
import type { SandboxSettleInput, SandboxSettler } from "@/lib/sandbox/settle-signer";
import { scriptedSandboxAnswer } from "@/lib/sandbox/catalog";
import { networkFeeShare, runSandboxSession, sessionMaxLamports, SESSION_PROMPTS } from "@/lib/sandbox/session-run";

const ORIGIN = "https://sandbox.example";
const NOW_MS = Date.UTC(2026, 10, 21, 2, 0, 0);
const swift = findSandboxProviderById("swift-infer")!;
const messages = [{ role: "user", content: "Explain exponential backoff in two sentences." }];
const MAX_LAMPORTS = maxChargeLamports(swift, requestInputTokens(messages));
const payer = Keypair.generate().publicKey;
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
  parts.push(255, (fields.metered === false ? 0 : 1) | (fields.rated ? 2 : 0));
  // Anchor allocates the full LEN; a None session leaves 32 trailing zero bytes.
  const len = fields.windows === null ? 149 : 165;
  while (parts.length < len) parts.push(0);
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
    readSlot: async () => CURRENT_SLOT,
    settler,
    acceptMeteredSessions: true,
    now: () => NOW_MS,
    newNonce: () => (++counter).toString(16).padStart(32, "a"),
  };
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

const NONCE = "0123456789abcdef0123456789abcdef";
const SESSION_MAX = MAX_LAMPORTS * BigInt(10);

function sessionCall(deps: SandboxGatewayDeps, paymentHeader: string, sequence: number | string, previous?: SandboxReceipt, close = false) {
  const body = { model: swift.model, messages };
  return handleSandboxChatCompletion(
    {
      body,
      rawBody: JSON.stringify(body),
      paymentHeader,
      origin: ORIGIN,
      session: { sequence: String(sequence), close: close ? "close" : null, previousReceipt: previous ? encodeReceiptHeader(previous) : null },
    },
    deps,
  );
}

const simulatedLock = (amountLamports: bigint, overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ simulated: true, settlement: "metered-escrow", network: "solana-devnet", payTo: swift.payTo, currency: "SOL", amount: formatUnits(amountLamports, 9), nonce: NONCE, ...overrides });

function callReceipt(response: SandboxGatewayResponse): SandboxReceipt {
  const value = decodeReceiptHeader(response.headers[PROVIDER_RECEIPT_HEADER] ?? response.headers[SANDBOX_SIMULATED_RECEIPT_HEADER]);
  if (!isSandboxReceipt(value)) throw new Error(`no receipt: ${response.bodyText}`);
  return value;
}

function closingReceipt(response: SandboxGatewayResponse): SandboxReceipt {
  const value = decodeReceiptHeader(response.headers[SESSION_RECEIPT_HEADER]);
  if (!isSandboxReceipt(value)) throw new Error("no closing receipt");
  return value;
}

const errorCode = (response: SandboxGatewayResponse) => (response.body.error as { code: string }).code;
const PER_CALL = sessionCallLamports(swift, { inputTokens: requestInputTokens(messages), outputTokens: countTokens(scriptedSandboxAnswer(swift, messages[0].content)) });

async function runSession(deps: SandboxGatewayDeps, header: string, calls: number) {
  const receipts: SandboxReceipt[] = [];
  let last: SandboxGatewayResponse | undefined;
  for (let n = 1; n <= calls; n += 1) {
    last = await sessionCall(deps, header, n, receipts[receipts.length - 1], n === calls);
    expect(last.status).toBe(200);
    receipts.push(callReceipt(last));
  }
  return { receipts, last: last! };
}

describe("sandbox sessions (#863)", () => {
  it("S1, simulated: ten calls under one lock chain their receipts and settle the running total once", async () => {
    const deps = makeDeps(new Map(), undefined);
    const { receipts, last } = await runSession(deps, simulatedLock(SESSION_MAX), 10);
    expect(last.headers[SESSION_STATE_HEADER]).toBe("settled");
    for (const [index, receipt] of receipts.entries()) {
      const s = receipt.receipt.session!;
      expect(receipt.receipt.payment).toBeUndefined();
      expect(s).toMatchObject({ escrow: `simulated:${NONCE}`, sequence: String(index + 1), closed: false, cumulativeCost: (PER_CALL * BigInt(index + 1)).toString(), maxAmount: SESSION_MAX.toString() });
      expect(s.payer).toBeUndefined();
      if (index > 0) expect(s.previousReceiptHash).toBe(await hashSandboxReceipt(receipts[index - 1].receipt));
      else expect(s.previousReceiptHash).toBeUndefined();
    }
    const closing = closingReceipt(last);
    const total = PER_CALL * BigInt(10);
    expect(closing.receipt.session).toMatchObject({ sequence: "11", inputTokens: "0", outputTokens: "0", closed: true, cumulativeCost: total.toString(), previousReceiptHash: await hashSandboxReceipt(receipts[9].receipt) });
    expect(closing.receipt.payment).toMatchObject({ amount: total.toString(), settlement: "metered-escrow", fee: { amount: ((total * BigInt(250)) / BigInt(10_000)).toString(), treasury: SANDBOX_FEE_TREASURY }, metered: { maxAmount: SESSION_MAX.toString(), refunded: (SESSION_MAX - total).toString() } });
    expect(closing.receipt.payment!.txSignature).toBeUndefined();
    // Every receipt in the chain verifies against the request and response it covers.
    const verified = await verifySandboxReceipt({ receipt: receipts[0], requestBody: JSON.stringify({ model: swift.model, messages }), responseBody: "x", model: swift.model });
    expect(verified.checks.find((check) => check.id === "signature")?.passed).toBe(true);
  });

  it("S1, devnet: three calls on one metered escrow settle once, for the running total", async () => {
    const accounts: Accounts = new Map();
    const escrow = lockFor(accounts, NONCE, { amount: SESSION_MAX });
    const { settler, calls } = fakeSettler();
    const deps = makeDeps(accounts, settler);
    const header = meteredHeader(NONCE, escrow);
    const { receipts, last } = await runSession(deps, header, 3);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ actualLamports: PER_CALL * BigInt(3), rated: false });
    expect(calls[0].escrow.toBase58()).toBe(escrow);
    expect(receipts.every((r) => r.receipt.schemaVersion === "reddi.receipt.v2" && r.receipt.session!.payer === payer.toBase58())).toBe(true);
    const closing = closingReceipt(last);
    expect(closing.receipt.payment).toMatchObject({ txSignature: SETTLE_SIG, payer: payer.toBase58(), amount: (PER_CALL * BigInt(3)).toString() });
  });

  it("S2: refuses a call whose worst case would pass the lock, before serving it", async () => {
    const deps = makeDeps(new Map(), undefined);
    const header = simulatedLock(MAX_LAMPORTS);
    const first = await sessionCall(deps, header, 1);
    expect(first.status).toBe(200);
    const second = await sessionCall(deps, header, 2, callReceipt(first));
    expect(second.status).toBe(409);
    expect(errorCode(second)).toBe("session_max_reached");
    expect(second.headers[SANDBOX_SIMULATED_RECEIPT_HEADER]).toBeUndefined();
  });

  it("S3: refuses a replayed or skipped sequence", async () => {
    const deps = makeDeps(new Map(), undefined);
    const header = simulatedLock(SESSION_MAX);
    const first = await sessionCall(deps, header, 1);
    expect(errorCode(await sessionCall(deps, header, 1))).toBe("session_sequence_invalid");
    expect(errorCode(await sessionCall(deps, header, 3, callReceipt(first)))).toBe("session_sequence_invalid");
    expect(errorCode(await sessionCall(deps, header, 2))).toBe("session_sequence_invalid");
    expect(errorCode(await sessionCall(deps, header, 0))).toBe("session_sequence_invalid");
    expect((await sessionCall(deps, header, 2, callReceipt(first))).status).toBe(200);
  });

  it("refuses a previous receipt whose running total was edited", async () => {
    const deps = makeDeps(new Map(), undefined);
    const header = simulatedLock(SESSION_MAX);
    const first = callReceipt(await sessionCall(deps, header, 1));
    const forged = { ...first, receipt: { ...first.receipt, session: { ...first.receipt.session!, cumulativeCost: "1" } } };
    expect(errorCode(await sessionCall(deps, header, 2, forged))).toBe("session_sequence_invalid");
  });

  it("refuses a previous receipt from a different lock", async () => {
    const deps = makeDeps(new Map(), undefined);
    const first = callReceipt(await sessionCall(deps, simulatedLock(SESSION_MAX), 1));
    expect(errorCode(await sessionCall(deps, simulatedLock(SESSION_MAX, { nonce: "f".repeat(32) }), 2, first))).toBe("session_invalid");
  });

  it("S4: refuses a call after the session closed", async () => {
    const deps = makeDeps(new Map(), undefined);
    const header = simulatedLock(SESSION_MAX);
    const closed = await sessionCall(deps, header, 1, undefined, true);
    expect(errorCode(await sessionCall(deps, header, 3, closingReceipt(closed)))).toBe("session_closed");
  });

  it("refuses an escrow that was settled already", async () => {
    const accounts: Accounts = new Map();
    const escrow = lockFor(accounts, NONCE, { amount: SESSION_MAX, status: 1 });
    const deps = makeDeps(accounts, fakeSettler().settler);
    expect(errorCode(await sessionCall(deps, meteredHeader(NONCE, escrow), 1))).toBe("session_closed");
  });

  it("refuses sessions on a rated escrow", async () => {
    const accounts: Accounts = new Map();
    const escrow = lockFor(accounts, NONCE, { amount: SESSION_MAX, rated: true });
    const deps = { ...makeDeps(accounts, fakeSettler().settler), acceptRatedEscrows: true };
    expect(errorCode(await sessionCall(deps, meteredHeader(NONCE, escrow), 1))).toBe("session_invalid");
  });

  it("refuses new calls when the refund window is about to open", async () => {
    const accounts: Accounts = new Map();
    const escrow = lockFor(accounts, NONCE, { amount: SESSION_MAX, createdSlot: CURRENT_SLOT - SANDBOX_CANCEL_WINDOW_SLOTS + BigInt(100) });
    const deps = makeDeps(accounts, fakeSettler().settler);
    expect(errorCode(await sessionCall(deps, meteredHeader(NONCE, escrow), 1))).toBe("session_window_closing");
  });

  it("refuses devnet escrow sessions unless the gateway is set to serve them", async () => {
    const accounts: Accounts = new Map();
    const escrow = lockFor(accounts, NONCE, { amount: SESSION_MAX });
    const deps = { ...makeDeps(accounts, fakeSettler().settler), acceptMeteredSessions: false };
    expect(errorCode(await sessionCall(deps, meteredHeader(NONCE, escrow), 1))).toBe("session_invalid");
  });

  it("does not settle when the settle fails, and says the lock stays refundable", async () => {
    const accounts: Accounts = new Map();
    const escrow = lockFor(accounts, NONCE, { amount: SESSION_MAX });
    const deps = makeDeps(accounts, fakeSettler(true, { ok: false, message: "Devnet refused the settle." }).settler);
    const response = await sessionCall(deps, meteredHeader(NONCE, escrow), 1, undefined, true);
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ charged: false, escrow });
  });
});

/** A fetch that serves the sandbox route from the gateway, as the browser would reach it. */
function gatewayFetch(deps: SandboxGatewayDeps, alter?: (headers: Record<string, string>) => void): typeof fetch {
  return (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    const h = init.headers;
    const response = await handleSandboxChatCompletion(
      {
        body: JSON.parse(init.body),
        rawBody: init.body,
        paymentHeader: h["x402-payment"],
        origin: ORIGIN,
        session: { sequence: h["x402-session-sequence"], close: h["x402-session"], previousReceipt: h["x-reddi-session-previous-receipt"] },
      },
      deps,
    );
    alter?.(response.headers);
    return new Response(response.bodyText, { status: response.status, headers: response.headers });
  }) as unknown as typeof fetch;
}

describe("sandbox: run a session scenario (#863)", () => {
  it("runs ten calls under one lock, checks every receipt against its own count, and settles once", async () => {
    const rows: number[] = [];
    const result = await runSandboxSession({ provider: swift, fetchImpl: gatewayFetch(makeDeps(new Map(), undefined)), onCall: (row) => rows.push(row.sequence) });
    if (!result.ok) throw new Error(result.message);
    expect(rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.rows.every((row) => row.checked)).toBe(true);
    expect(result.maxLamports).toBe(sessionMaxLamports(swift));
    expect(result.totalLamports).toBe(result.rows.reduce((sum, row) => sum + row.costLamports, BigInt(0)));
    expect(result.closing.receipt.payment!.amount).toBe(result.totalLamports.toString());
    expect(result.refundedLamports + result.totalLamports).toBe(result.maxLamports);
    expect(result.exchanges).toHaveLength(SESSION_PROMPTS.length + 1);
  });

  it("stops at the first receipt that does not match the visitor's own count", async () => {
    let n = 0;
    const result = await runSandboxSession({
      provider: swift,
      fetchImpl: gatewayFetch(makeDeps(new Map(), undefined), (headers) => {
        n += 1;
        if (n !== 4) return;
        const receipt = decodeReceiptHeader(headers[SANDBOX_SIMULATED_RECEIPT_HEADER]) as SandboxReceipt;
        receipt.receipt.session!.cumulativeCost = "999999";
        headers[SANDBOX_SIMULATED_RECEIPT_HEADER] = encodeReceiptHeader(receipt);
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.rows).toHaveLength(3);
    expect(!result.ok && result.message).toMatch(/Call 3/);
  });

  it("shows network fees falling from about 11% per call to about 1% for ten calls", () => {
    expect(networkFeeShare(1)).toBeCloseTo(0.112, 3);
    expect(networkFeeShare(10)).toBeCloseTo(0.0112, 4);
    expect(networkFeeShare(50)).toBeCloseTo(0.00225, 5);
  });
});
