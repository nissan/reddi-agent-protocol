import { Keypair } from "@solana/web3.js";
import { ratingPda, sha256 } from "@reddi/x402-solana/rating";
import { jobRatingCommitment } from "@/lib/rating/commitment";
import {
  findRatedJob,
  importRatingBackup,
  listRatedJobs,
  matchingRatingSecret,
  newRatingSalt,
  ratingBackupFile,
  secretForJob,
  RatingStorageError,
  rememberRatedJob,
  storeRatingSecret,
  type KeyValueStorage,
} from "@/lib/rating/rating-secrets";

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const PROGRAM = Keypair.generate().publicKey;
const WALLET = Keypair.generate().publicKey;
const ESCROW = Keypair.generate().publicKey;
const wallet = WALLET.toBase58();
const escrow = ESCROW.toBase58();
const programId = PROGRAM.toBase58();
const SALT = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const NOW = new Date("2026-11-21T00:00:00.000Z");
const OPENED = 4_242n;
const store = (storage: KeyValueStorage, score = 8, salt = SALT, openedSlot = OPENED) => storeRatingSecret(storage, { wallet, escrow, programId, openedSlot, score, salt, now: NOW });
const commitmentOf = (score: number, salt: Uint8Array, openedSlot = OPENED) => jobRatingCommitment(ratingPda(ESCROW, PROGRAM), openedSlot, WALLET, score, salt);
const job = (commitment: Uint8Array | undefined, openedSlot = OPENED) => ({ openedSlot, commitment });

describe("rating salt storage (#842)", () => {
  it("makes a fresh 32-byte salt and refuses a random source that returns zeros", () => {
    const a = newRatingSalt();
    const b = newRatingSalt();
    expect(a).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(() => newRatingSalt((bytes) => bytes)).toThrow(/no random salt/);
  });

  it("stores the score and salt with the commitment the program will hold", () => {
    const storage = new MemoryStorage();
    const { commitment, record } = store(storage);
    const expected = commitmentOf(8, SALT);
    expect(Buffer.from(commitment).equals(Buffer.from(expected))).toBe(true);
    expect(record.secrets).toEqual([expect.objectContaining({ openedSlot: "4242", score: 8, saltHex: Buffer.from(SALT).toString("hex"), commitmentHex: Buffer.from(expected).toString("hex") })]);
    // Durable: a second read of the same storage finds it.
    expect(matchingRatingSecret(findRatedJob(storage, wallet, escrow), job(expected))).toEqual({ score: 8, salt: SALT });
  });

  it("keeps each wallet's jobs apart and lists the newest first", () => {
    const storage = new MemoryStorage();
    const other = Keypair.generate().publicKey.toBase58();
    rememberRatedJob(storage, { wallet, escrow, programId, openedAt: "2026-11-20T00:00:00.000Z", label: "first" });
    const second = Keypair.generate().publicKey.toBase58();
    rememberRatedJob(storage, { wallet, escrow: second, programId, openedAt: "2026-11-21T00:00:00.000Z" });
    expect(listRatedJobs(storage, wallet).map((job) => job.escrow)).toEqual([second, escrow]);
    expect(listRatedJobs(storage, other)).toEqual([]);
  });

  it("remembering a job again keeps the salt already stored for it", () => {
    const storage = new MemoryStorage();
    const { commitment } = store(storage);
    rememberRatedJob(storage, { wallet, escrow, programId, openedAt: NOW.toISOString(), label: "again" });
    expect(findRatedJob(storage, wallet, escrow)).toMatchObject({ label: "again" });
    expect(matchingRatingSecret(findRatedJob(storage, wallet, escrow), job(commitment))).toBeDefined();
  });

  it("does not offer a stored secret for a different commitment on chain", () => {
    const storage = new MemoryStorage();
    store(storage);
    const elsewhere = commitmentOf(3, new Uint8Array(32).fill(7));
    expect(matchingRatingSecret(findRatedJob(storage, wallet, escrow), job(elsewhere))).toBeUndefined();
    expect(matchingRatingSecret(findRatedJob(storage, wallet, escrow), job(undefined))).toBeUndefined();
    expect(matchingRatingSecret(undefined, job(elsewhere))).toBeUndefined();
  });

  it("throws when the browser refuses or silently drops the write, so nothing is signed without a stored salt", () => {
    const refusing: KeyValueStorage = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(() => store(refusing)).toThrow(RatingStorageError);
    const dropping: KeyValueStorage = { getItem: () => null, setItem: () => undefined };
    expect(() => store(dropping)).toThrow(/did not keep/);
  });

  it("skips unreadable and foreign entries instead of failing", () => {
    const storage = new MemoryStorage();
    storage.setItem(`reddi.rated-jobs.v2.${wallet}`, "{not json");
    expect(listRatedJobs(storage, wallet)).toEqual([]);
    storage.setItem(`reddi.rated-jobs.v2.${wallet}`, JSON.stringify([{ version: 2, wallet: "someone-else", escrow, programId, openedAt: "x" }, { version: 2, wallet, escrow: "not-an-address", programId, openedAt: "x" }, { version: 2, wallet, escrow, programId, openedAt: "x", secrets: [{ score: 8, saltHex: "00".repeat(32), commitmentHex: "00".repeat(32), savedAt: "x" }] }]));
    expect(listRatedJobs(storage, wallet)).toEqual([]);
  });

  it("writes a backup file and reads it back in another browser", () => {
    const first = new MemoryStorage();
    const { commitment } = store(first);
    const file = ratingBackupFile(findRatedJob(first, wallet, escrow)!);
    expect(file?.filename).toBe(`rating-salt-${escrow.slice(0, 8)}-4242.json`);
    expect(ratingBackupFile({ version: 2, wallet, escrow, programId, openedAt: NOW.toISOString() })).toBeUndefined();

    const second = new MemoryStorage();
    expect(importRatingBackup(second, wallet, file!.text)).toMatchObject({ ok: true, record: { escrow } });
    expect(matchingRatingSecret(findRatedJob(second, wallet, escrow), job(commitment))).toEqual({ score: 8, salt: SALT });
  });

  it("refuses a backup for another wallet, a tampered one, and a file that is not a backup", () => {
    const storage = new MemoryStorage();
    store(storage);
    const text = ratingBackupFile(findRatedJob(storage, wallet, escrow)!)!.text;
    const fresh = new MemoryStorage();
    expect(importRatingBackup(fresh, Keypair.generate().publicKey.toBase58(), text)).toMatchObject({ ok: false, message: expect.stringMatching(/different wallet/) });
    const tampered = JSON.parse(text);
    tampered.secrets[0].score = 2;
    expect(importRatingBackup(fresh, wallet, JSON.stringify(tampered))).toMatchObject({ ok: false, message: expect.stringMatching(/does not match its commitment/) });
    expect(importRatingBackup(fresh, wallet, "{}")).toMatchObject({ ok: false });
    expect(importRatingBackup(fresh, wallet, "nope")).toMatchObject({ ok: false });
    expect(listRatedJobs(fresh, wallet)).toEqual([]);
  });

  it("hashes the opened slot into the commitment exactly as the program README states", () => {
    const rating = ratingPda(ESCROW, PROGRAM);
    const slot = Buffer.alloc(8);
    slot.writeBigUInt64LE(OPENED);
    const preimage = Buffer.concat([rating.toBuffer(), slot, WALLET.toBuffer(), Buffer.from([8]), Buffer.from(SALT)]);
    expect(Buffer.from(commitmentOf(8, SALT)).equals(Buffer.from(sha256(preimage)))).toBe(true);
    expect(Buffer.from(commitmentOf(8, SALT, OPENED + 1n)).equals(Buffer.from(commitmentOf(8, SALT)))).toBe(false);
  });

  it("never offers a salt stored for one job to a later job at the same rating address", () => {
    const storage = new MemoryStorage();
    const { commitment } = store(storage, 8, SALT, OPENED);
    const record = findRatedJob(storage, wallet, escrow);
    // The later job (another opened slot) has no secret, even if its chain commitment were the same bytes.
    expect(secretForJob(record, OPENED + 10n)).toBeUndefined();
    expect(matchingRatingSecret(record, job(commitment, OPENED + 10n))).toBeUndefined();
    // A secret stored for the later job sits beside the earlier one, each under its own slot.
    const later = new Uint8Array(32).fill(9);
    const second = store(storage, 4, later, OPENED + 10n).commitment;
    const both = findRatedJob(storage, wallet, escrow);
    expect(both?.secrets?.map((secret) => secret.openedSlot)).toEqual(["4252", "4242"]);
    expect(matchingRatingSecret(both, job(second, OPENED + 10n))).toEqual({ score: 4, salt: later });
    expect(matchingRatingSecret(both, job(commitment, OPENED))).toEqual({ score: 8, salt: SALT });
    expect(matchingRatingSecret(both, job(second, OPENED))).toBeUndefined();
  });

  it("refuses a backup whose opened slot was changed to pass it off for another job", () => {
    const storage = new MemoryStorage();
    store(storage);
    const moved = JSON.parse(ratingBackupFile(findRatedJob(storage, wallet, escrow)!)!.text);
    moved.secrets[0].openedSlot = "9999";
    expect(importRatingBackup(new MemoryStorage(), wallet, JSON.stringify(moved))).toMatchObject({ ok: false, message: expect.stringMatching(/does not match its commitment/) });
  });
});
