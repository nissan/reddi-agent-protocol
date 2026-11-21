jest.mock("server-only", () => ({}));

import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { attestationPda, decodeRatingAccount, RATING_DISCRIMINATORS, ratingPda, type AttestationScores } from "@reddi/x402-solana/rating";
import { encodeAttestationAccount, encodeRatingAccount, type RatingFixture } from "@/lib/rating/testing/fixtures";
import { jobRatingCommitment } from "@/lib/rating/commitment";
import { attestationBelongsToJob, commitJobRating, readJobRating, resolveJobAttestation, revealJobRating, type RatingConnection } from "@/lib/rating/job-rating";
import { findRatedJob, storeRatingSecret, type KeyValueStorage } from "@/lib/rating/rating-secrets";
import { ESCROW_PROGRAM_ID } from "@/lib/program";
import { readAttestationForShownJob, submitAttestationResolution } from "@/lib/onboarding/attestation-resolution";
import { sellerRatingPlan, sellerRatingSalt } from "@/lib/sandbox/seller-rating";

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const PROGRAM = ESCROW_PROGRAM_ID;
const buyer = Keypair.generate();
const seller = Keypair.generate();
const judge = Keypair.generate().publicKey;
const escrow = Keypair.generate().publicKey;
const OPENED = 1_000n;
const SETTLED = 1_010n;
const SCORES: AttestationScores = [8, 7, 9, 6, 10];

type Accounts = Map<string, { owner: PublicKey; data: Uint8Array }>;

function chain(accounts: Accounts, slot = 1_020) {
  const sent: Transaction[] = [];
  const connection: RatingConnection & { getAccountInfo: jest.Mock } = {
    getAccountInfo: jest.fn(async (address: PublicKey) => accounts.get(address.toBase58()) ?? null),
    getSlot: async () => slot,
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 10 }),
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  const wallet = {
    publicKey: buyer.publicKey,
    sendTransaction: jest.fn(async (transaction: Transaction) => {
      sent.push(transaction);
      return "sig";
    }),
  };
  return { connection, wallet, sent };
}

function withRating(fixture: Partial<RatingFixture> & Pick<RatingFixture, "state">, accounts: Accounts = new Map()): Accounts {
  accounts.set(ratingPda(escrow, PROGRAM).toBase58(), {
    owner: PROGRAM,
    data: encodeRatingAccount({ escrow, consumer: buyer.publicKey, specialist: seller.publicKey, judge, openedSlot: OPENED, settledSlot: SETTLED, ...fixture }),
  });
  return accounts;
}

function withAttestation(accounts: Accounts, fixture: Partial<Parameters<typeof encodeAttestationAccount>[0]> = {}): Accounts {
  accounts.set(attestationPda(escrow, PROGRAM).toBase58(), {
    owner: PROGRAM,
    data: encodeAttestationAccount({ escrow, judge, consumer: buyer.publicKey, scores: SCORES, createdSlot: SETTLED + 5n, openedSlot: OPENED, ...fixture }),
  });
  return accounts;
}

const bytes = (value: Uint8Array) => Buffer.from(value).toString("hex");

describe("buyer rating steps bind to the job by its opened slot (#842)", () => {
  it("commit stores the salt under the opened slot and hashes the slot into the commitment it signs", async () => {
    const { connection, wallet, sent } = chain(withRating({ state: "open" }));
    const storage = new MemoryStorage();
    const salt = new Uint8Array(32).fill(5);
    const result = await commitJobRating({ connection, wallet, programId: PROGRAM, escrow, storage, score: 9, random: (out) => out.fill(5), expectedOpenedSlot: OPENED });
    expect(result).toEqual({ ok: true, signature: "sig" });
    const stored = findRatedJob(storage, buyer.publicKey.toBase58(), escrow.toBase58());
    expect(stored?.secrets?.[0]).toMatchObject({ openedSlot: "1000", score: 9 });
    const instruction = sent[0].instructions[0];
    expect([...instruction.data.subarray(0, 8)]).toEqual(RATING_DISCRIMINATORS["global:commit_rating"]);
    expect(bytes(instruction.data.subarray(8, 40))).toBe(bytes(jobRatingCommitment(ratingPda(escrow, PROGRAM), OPENED, buyer.publicKey, 9, salt)));
    // Then the job it is for: the opened slot it was hashed with.
    expect(instruction.data).toHaveLength(48);
    expect(instruction.data.readBigUInt64LE(40)).toBe(OPENED);
  });

  it("refuses every step when the rating at the escrow is now another job's than the one shown", async () => {
    const { connection, wallet, sent } = chain(withAttestation(withRating({ state: "open", openedSlot: OPENED + 50n }), { createdSlot: OPENED + 60n, openedSlot: OPENED + 50n }));
    const storage = new MemoryStorage();
    const deps = { connection, wallet, programId: PROGRAM, escrow, expectedOpenedSlot: OPENED };
    for (const result of [await commitJobRating({ ...deps, storage, score: 9 }), await revealJobRating({ ...deps, storage }), await resolveJobAttestation({ ...deps, action: "confirm" })]) {
      expect(result).toMatchObject({ ok: false, signed: false, message: expect.stringMatching(/has changed since it was shown/) });
    }
    expect(sent).toHaveLength(0);
    expect(findRatedJob(storage, buyer.publicKey.toBase58(), escrow.toBase58())).toBeUndefined();
  });

  it("does not reveal with a salt saved for an earlier job at the same rating address", async () => {
    const storage = new MemoryStorage();
    const salt = new Uint8Array(32).fill(3);
    const { commitment } = storeRatingSecret(storage, { wallet: buyer.publicKey.toBase58(), escrow: escrow.toBase58(), programId: PROGRAM.toBase58(), openedSlot: OPENED, score: 6, salt, now: new Date() });
    // The later job at this address happens to hold the same commitment bytes: still not this job's salt.
    const later = withRating({ state: "both_committed", openedSlot: OPENED + 50n, committedSlot: SETTLED + 60n, consumerCommitment: commitment, specialistCommitment: new Uint8Array(32).fill(1) });
    const { connection, wallet, sent } = chain(later);
    expect(await revealJobRating({ connection, wallet, programId: PROGRAM, escrow, storage })).toMatchObject({ ok: false, message: expect.stringMatching(/salt for this commitment is not stored/) });
    expect(sent).toHaveLength(0);
    // For the job it was saved for, it reveals.
    const same = chain(withRating({ state: "both_committed", committedSlot: SETTLED + 5n, consumerCommitment: commitment, specialistCommitment: new Uint8Array(32).fill(1) }));
    expect(await revealJobRating({ connection: same.connection, wallet: same.wallet, programId: PROGRAM, escrow, storage })).toEqual({ ok: true, signature: "sig" });
    expect([...same.sent[0].instructions[0].data.subarray(8, 9)]).toEqual([6]);
  });

  it("shows only an attestation made for this job: same escrow, consumer, judge and opened slot", async () => {
    const accounts = withAttestation(withRating({ state: "open", attested: true }));
    expect((await readJobRating(chain(accounts).connection, escrow, PROGRAM)).attestation?.scores).toEqual([...SCORES]);
    const rating = decodeRatingAccount(accounts.get(ratingPda(escrow, PROGRAM).toBase58())!.data);
    const attestation = { escrow, judge, consumer: buyer.publicKey, scores: [...SCORES] as [number, number, number, number, number], resolution: "pending" as const, createdSlot: OPENED, bump: 255, openedSlot: OPENED };
    expect(attestationBelongsToJob(attestation, rating)).toBe(true);
    expect(attestationBelongsToJob({ ...attestation, openedSlot: OPENED - 1n }, rating)).toBe(false);
    expect(attestationBelongsToJob({ ...attestation, openedSlot: OPENED + 1n }, rating)).toBe(false);
    expect(attestationBelongsToJob({ ...attestation, judge: Keypair.generate().publicKey }, rating)).toBe(false);
    expect(attestationBelongsToJob({ ...attestation, consumer: seller.publicKey }, rating)).toBe(false);
    // A leftover from an earlier job is not shown, so it cannot be confirmed from this job's panel.
    const leftover = withAttestation(withRating({ state: "open", attested: true }), { createdSlot: OPENED - 100n, openedSlot: OPENED - 200n });
    const { connection, wallet, sent } = chain(leftover);
    expect((await readJobRating(connection, escrow, PROGRAM)).attestation).toBeUndefined();
    expect(await resolveJobAttestation({ connection, wallet, programId: PROGRAM, escrow, action: "confirm" })).toMatchObject({ ok: false, message: expect.stringMatching(/no attestation/) });
    expect(sent).toHaveLength(0);
  });
});

describe("attestation resolution checks the job shown to the signer (#842)", () => {
  const shown = { escrow, judge, consumer: buyer.publicKey, openedSlot: OPENED };

  function deps(accounts: Accounts) {
    const { connection } = chain(accounts);
    const sendTransaction = jest.fn(async () => "sig");
    const full = { ...connection, getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 10 }), confirmTransaction: async () => ({ value: { err: null } }) };
    return { getConnection: () => full as never, sendTransaction, connection };
  }

  it("resolves the pending attestation of the shown job, at the derived address", async () => {
    const d = deps(withAttestation(withRating({ state: "open", attested: true })));
    const outcome = await submitAttestationResolution({ action: "dispute", consumer: buyer.publicKey, operator: judge.toBase58(), escrow: escrow.toBase58(), openedSlot: OPENED }, d);
    expect(outcome).toEqual({ ok: true, signature: "sig" });
    const transaction = (d.sendTransaction.mock.calls[0] as unknown as [Transaction])[0];
    expect(transaction.instructions[0].keys[0].pubkey.equals(attestationPda(escrow, PROGRAM))).toBe(true);
    // The decision names the job: the opened slot the attestation stores.
    expect(transaction.instructions[0].data).toHaveLength(16);
    expect(transaction.instructions[0].data.readBigUInt64LE(8)).toBe(OPENED);
  });

  it("the buyer's panel names the attestation's opened slot in its decision", async () => {
    const { connection, wallet, sent } = chain(withAttestation(withRating({ state: "open", attested: true })));
    expect(await resolveJobAttestation({ connection, wallet, programId: PROGRAM, escrow, action: "confirm", expectedOpenedSlot: OPENED })).toEqual({ ok: true, signature: "sig" });
    expect(sent[0].instructions[0].data.readBigUInt64LE(8)).toBe(OPENED);
  });

  it("refuses when the job shown is not the attested one: other escrow, judge or consumer", async () => {
    const otherEscrow = Keypair.generate().publicKey;
    const accounts = withAttestation(withRating({ state: "open", attested: true }));
    // The shown escrow's attestation address holds an attestation that names another escrow.
    accounts.set(attestationPda(otherEscrow, PROGRAM).toBase58(), { owner: PROGRAM, data: encodeAttestationAccount({ escrow, judge, consumer: buyer.publicKey, scores: SCORES, openedSlot: OPENED }) });
    const cases: [Partial<typeof shown>, RegExp][] = [
      [{ escrow: otherEscrow }, /another escrow/],
      [{ judge: Keypair.generate().publicKey }, /another judge/],
      [{ consumer: seller.publicKey }, /another buyer/],
    ];
    for (const [override, message] of cases) {
      await expect(readAttestationForShownJob(chain(accounts).connection as never, { ...shown, ...override }, PROGRAM)).rejects.toThrow(message);
    }
    const d = deps(accounts);
    const outcome = await submitAttestationResolution({ action: "confirm", consumer: buyer.publicKey, operator: Keypair.generate().publicKey.toBase58(), escrow: escrow.toBase58(), openedSlot: OPENED }, d);
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/another judge/) });
    expect(d.sendTransaction).not.toHaveBeenCalled();
  });

  it("refuses an explicit attestation address that is not derived from the shown escrow, before reading it", async () => {
    const accounts = withAttestation(withRating({ state: "open", attested: true }));
    const elsewhere = Keypair.generate().publicKey;
    accounts.set(elsewhere.toBase58(), accounts.get(attestationPda(escrow, PROGRAM).toBase58())!);
    const d = deps(accounts);
    const outcome = await submitAttestationResolution({ action: "confirm", consumer: buyer.publicKey, operator: judge.toBase58(), escrow: escrow.toBase58(), attestationPda: elsewhere.toBase58(), openedSlot: OPENED }, d);
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/not the attestation of the job shown/) });
    expect(d.connection.getAccountInfo).not.toHaveBeenCalled();
    expect(d.sendTransaction).not.toHaveBeenCalled();
    // The derived address itself is accepted.
    const ok = await submitAttestationResolution({ action: "confirm", consumer: buyer.publicKey, operator: judge.toBase58(), escrow: escrow.toBase58(), attestationPda: attestationPda(escrow, PROGRAM).toBase58(), openedSlot: OPENED }, deps(accounts));
    expect(ok).toEqual({ ok: true, signature: "sig" });
  });

  it("refuses a resolved attestation, one from an earlier job at the address, and a shown job that has been replaced", async () => {
    const resolved = withAttestation(withRating({ state: "open", attested: true }), { resolution: "confirmed" });
    await expect(readAttestationForShownJob(chain(resolved).connection as never, shown, PROGRAM)).rejects.toThrow(/already confirmed/);
    const earlier = withAttestation(withRating({ state: "open", attested: true }), { createdSlot: OPENED - 1n, openedSlot: OPENED - 10n });
    await expect(readAttestationForShownJob(chain(earlier).connection as never, shown, PROGRAM)).rejects.toThrow(/earlier job/);
    const replaced = withAttestation(withRating({ state: "open", attested: true, openedSlot: OPENED + 9n }), { createdSlot: OPENED + 20n, openedSlot: OPENED + 9n });
    await expect(readAttestationForShownJob(chain(replaced).connection as never, shown, PROGRAM)).rejects.toThrow(/no longer the job/);
    // The attestation of the shown job stays decidable after its rating account has been closed: the slot is on the attestation.
    const ratingClosed = withAttestation(new Map());
    await expect(readAttestationForShownJob(chain(ratingClosed).connection as never, shown, PROGRAM)).resolves.toMatchObject({ openedSlot: OPENED });
    await expect(readAttestationForShownJob(chain(new Map()).connection as never, shown, PROGRAM)).rejects.toThrow(/no attestation/);
  });
});

describe("the sandbox provider's own rating is bound to the job (#842)", () => {
  const key = Keypair.generate();
  const rating = (fixture: Partial<RatingFixture> & Pick<RatingFixture, "state">) =>
    decodeRatingAccount(encodeRatingAccount({ escrow, consumer: buyer.publicKey, specialist: key.publicKey, openedSlot: OPENED, settledSlot: SETTLED, ...fixture }));

  it("derives a different salt for each job at the same rating address", () => {
    const address = ratingPda(escrow, PROGRAM);
    expect(bytes(sellerRatingSalt(key.secretKey, address, OPENED))).not.toBe(bytes(sellerRatingSalt(key.secretKey, address, OPENED + 1n)));
  });

  it("commits with the opened slot hashed in, and reveals only the commitment it made for this job", () => {
    const plan = sellerRatingPlan(rating({ state: "open" }), { programId: PROGRAM, keypair: key, score: 10, currentSlot: SETTLED + 1n });
    expect(plan.step).toBe("commit");
    const address = ratingPda(escrow, PROGRAM);
    const expected = jobRatingCommitment(address, OPENED, key.publicKey, 10, sellerRatingSalt(key.secretKey, address, OPENED));
    if (plan.step !== "commit") return;
    expect(bytes(plan.instruction.data.subarray(8, 40))).toBe(bytes(expected));

    const reveal = sellerRatingPlan(rating({ state: "both_committed", committedSlot: SETTLED + 2n, consumerCommitment: new Uint8Array(32).fill(1), specialistCommitment: expected }), { programId: PROGRAM, keypair: key, score: 3, currentSlot: SETTLED + 3n });
    expect(reveal.step).toBe("reveal");
    // A later job at the same address carrying the earlier commitment: this server cannot open it.
    const later = sellerRatingPlan(rating({ state: "both_committed", openedSlot: OPENED + 7n, committedSlot: SETTLED + 2n, consumerCommitment: new Uint8Array(32).fill(1), specialistCommitment: expected }), { programId: PROGRAM, keypair: key, score: 10, currentSlot: SETTLED + 3n });
    expect(later).toEqual({ step: "none", reason: "commitment_unknown" });
  });

  it("never acts on a rating that names another specialist", () => {
    const other = Keypair.generate();
    expect(sellerRatingPlan(rating({ state: "open" }), { programId: PROGRAM, keypair: other, score: 10, currentSlot: SETTLED + 1n })).toEqual({ step: "none", reason: "not_ours" });
  });
});

describe("seller-ratings cron gating (#842)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });

  async function call(env: Record<string, string | undefined>, authorization?: string) {
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const sweep = jest.fn(async () => []);
    jest.doMock("@/lib/sandbox/seller-rating", () => ({ ...jest.requireActual("@/lib/sandbox/seller-rating"), sweepSellerRatings: sweep }));
    const { GET } = await import("@/app/api/cron/seller-ratings/route");
    const response = await GET(new Request("http://localhost/api/cron/seller-ratings", { headers: authorization ? { authorization } : {} }));
    return { status: response.status, body: await response.json(), sweep };
  }

  const key = JSON.stringify({ "atlas-review": Array.from(Keypair.generate().secretKey) });

  it("does nothing while rated escrows are not accepted, even with a valid secret", async () => {
    const result = await call({ SANDBOX_ACCEPT_RATED_ESCROWS: undefined, CRON_SECRET: "s", SANDBOX_DEVNET_PAYEE_KEYS: key }, "Bearer s");
    expect(result).toMatchObject({ status: 200, body: { enabled: false, steps: 0 } });
    expect(result.sweep).not.toHaveBeenCalled();
  });

  it("fails closed without CRON_SECRET, and refuses a caller without it", async () => {
    const unset = await call({ SANDBOX_ACCEPT_RATED_ESCROWS: "true", CRON_SECRET: undefined, SANDBOX_DEVNET_PAYEE_KEYS: key });
    expect(unset.status).toBe(503);
    expect(unset.sweep).not.toHaveBeenCalled();
    jest.resetModules();
    const wrong = await call({ SANDBOX_ACCEPT_RATED_ESCROWS: "true", CRON_SECRET: "s", SANDBOX_DEVNET_PAYEE_KEYS: key }, "Bearer nope");
    expect(wrong.status).toBe(401);
    expect(wrong.sweep).not.toHaveBeenCalled();
  });

  it("sweeps with the configured settle keys only, and with none configured signs nothing", async () => {
    const none = await call({ SANDBOX_ACCEPT_RATED_ESCROWS: "true", CRON_SECRET: "s", SANDBOX_DEVNET_PAYEE_KEYS: undefined }, "Bearer s");
    expect(none).toMatchObject({ status: 200, body: { steps: 0 } });
    expect(none.sweep).not.toHaveBeenCalled();
    jest.resetModules();
    // Keys are taken only from the settle-key parser (which keeps only keys matching the catalog's payTo).
    const provider = Keypair.generate();
    const parse = jest.fn(() => new Map([["atlas-review", provider]]));
    jest.doMock("@/lib/sandbox/settle-signer", () => ({ ...jest.requireActual("@/lib/sandbox/settle-signer"), parseSandboxPayeeKeys: parse }));
    const ran = await call({ SANDBOX_ACCEPT_RATED_ESCROWS: "true", CRON_SECRET: "s", SANDBOX_DEVNET_PAYEE_KEYS: "configured" }, "Bearer s");
    expect(parse).toHaveBeenCalledWith("configured");
    expect(ran.status).toBe(200);
    const keypairs = (ran.sweep.mock.calls[0] as unknown as [{ keypairs: Keypair[] }])[0].keypairs;
    expect(keypairs.map((keypair) => keypair.publicKey.toBase58())).toEqual([provider.publicKey.toBase58()]);
  });
});
