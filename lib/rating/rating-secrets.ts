/**
 * The buyer's rated jobs and the score and salt behind each commitment, kept
 * in this browser (#842).
 *
 * A commitment is sha256(rating address, signer, score, salt). The program
 * only accepts a reveal that reproduces it, so a party that loses the salt
 * cannot reveal and is penalised at expiry. The salt is therefore written to
 * durable browser storage, and read back, before the commit is signed, and it
 * can be downloaded as a backup file. It is never sent to a server: nothing
 * here does any network I/O.
 *
 * Records are keyed by the wallet that signs, so two wallets in one browser
 * do not see each other's jobs.
 */
import { PublicKey } from "@solana/web3.js";
import { ratingCommitment, ratingPda } from "@reddi/x402-solana/rating";

const KEY_PREFIX = "reddi.rated-jobs.v1.";
export const RATING_BACKUP_KIND = "reddi-rating-salt-backup";

/** The part of `window.localStorage` this module uses. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RatingSecret {
  /** 1 to 10. */
  score: number;
  /** 32 bytes, hex. */
  saltHex: string;
  /** sha256(rating, signer, score, salt), hex. What the chain holds after the commit. */
  commitmentHex: string;
  savedAt: string;
}

export interface RatedJobRecord {
  version: 1;
  /** The wallet these records belong to: the signer of the commit. */
  wallet: string;
  escrow: string;
  programId: string;
  /** The other party: the provider, for a buyer's record. */
  counterparty?: string;
  judge?: string;
  /** A label the page gave the job, for example the provider's name. */
  label?: string;
  openedAt: string;
  secret?: RatingSecret;
}

export class RatingStorageError extends Error {}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export function hexToBytes(hex: string): Uint8Array | undefined {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function isAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function validSecret(value: unknown): value is RatingSecret {
  if (!value || typeof value !== "object") return false;
  const secret = value as Partial<RatingSecret>;
  return (
    Number.isInteger(secret.score) &&
    (secret.score as number) >= 1 &&
    (secret.score as number) <= 10 &&
    typeof secret.saltHex === "string" &&
    /^[0-9a-f]{64}$/.test(secret.saltHex) &&
    typeof secret.commitmentHex === "string" &&
    /^[0-9a-f]{64}$/.test(secret.commitmentHex) &&
    typeof secret.savedAt === "string"
  );
}

function validRecord(value: unknown, wallet: string): value is RatedJobRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<RatedJobRecord>;
  return record.version === 1 && record.wallet === wallet && isAddress(record.escrow) && isAddress(record.programId) && typeof record.openedAt === "string" && (record.secret === undefined || validSecret(record.secret));
}

function readAll(storage: KeyValueStorage, wallet: string): RatedJobRecord[] {
  let raw: string | null;
  try {
    raw = storage.getItem(KEY_PREFIX + wallet);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is RatedJobRecord => validRecord(entry, wallet)) : [];
  } catch {
    return [];
  }
}

function writeAll(storage: KeyValueStorage, wallet: string, records: RatedJobRecord[]): void {
  const text = JSON.stringify(records);
  try {
    storage.setItem(KEY_PREFIX + wallet, text);
  } catch {
    throw new RatingStorageError("This browser refused to store the rating data.");
  }
  // Private windows and full storage can accept a write and keep nothing.
  let stored: string | null = null;
  try {
    stored = storage.getItem(KEY_PREFIX + wallet);
  } catch {
    // Treated as not stored.
  }
  if (stored !== text) throw new RatingStorageError("This browser did not keep the rating data.");
}

/** The wallet's rated jobs, newest first. Unreadable or foreign entries are skipped. */
export function listRatedJobs(storage: KeyValueStorage, wallet: string): RatedJobRecord[] {
  return readAll(storage, wallet).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

export function findRatedJob(storage: KeyValueStorage, wallet: string, escrow: string): RatedJobRecord | undefined {
  return readAll(storage, wallet).find((record) => record.escrow === escrow);
}

/** Remembers a job the wallet opted in to rating (or looked up). Keeps a secret already stored for it. */
export function rememberRatedJob(storage: KeyValueStorage, job: Omit<RatedJobRecord, "version" | "secret">): RatedJobRecord {
  const records = readAll(storage, job.wallet);
  const existing = records.find((record) => record.escrow === job.escrow);
  const record: RatedJobRecord = { ...existing, ...job, version: 1, ...(existing?.secret ? { secret: existing.secret } : {}) };
  writeAll(storage, job.wallet, [record, ...records.filter((entry) => entry.escrow !== job.escrow)]);
  return record;
}

/** A fresh 32-byte salt from the platform's random source. */
export function newRatingSalt(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): Uint8Array {
  const salt = random(new Uint8Array(32));
  if (salt.length !== 32 || salt.every((byte) => byte === 0)) throw new Error("no random salt available");
  return salt;
}

/**
 * Builds the commitment for `score` under `salt` and stores both for `wallet`,
 * replacing any secret stored for this job before. Call it only while the
 * chain holds no commitment from this wallet. Throws `RatingStorageError`
 * when the browser did not keep the data, in which case nothing may be signed.
 */
export function storeRatingSecret(
  storage: KeyValueStorage,
  input: { wallet: string; escrow: string; programId: string; score: number; salt: Uint8Array; now: Date; counterparty?: string },
): { record: RatedJobRecord; commitment: Uint8Array } {
  const programId = new PublicKey(input.programId);
  const commitment = ratingCommitment(ratingPda(new PublicKey(input.escrow), programId), new PublicKey(input.wallet), input.score, input.salt);
  const records = readAll(storage, input.wallet);
  const existing = records.find((record) => record.escrow === input.escrow);
  const record: RatedJobRecord = {
    ...(existing ?? { version: 1, wallet: input.wallet, escrow: input.escrow, programId: input.programId, openedAt: input.now.toISOString() }),
    ...(input.counterparty && !existing?.counterparty ? { counterparty: input.counterparty } : {}),
    secret: { score: input.score, saltHex: toHex(input.salt), commitmentHex: toHex(commitment), savedAt: input.now.toISOString() },
  };
  writeAll(storage, input.wallet, [record, ...records.filter((entry) => entry.escrow !== input.escrow)]);
  return { record, commitment };
}

/**
 * The stored score and salt for a job, when they reproduce `onChainCommitment`.
 * A stored secret for a commit that never landed, or for another attempt, does
 * not match and is not returned: revealing with it would be refused.
 */
export function matchingRatingSecret(record: RatedJobRecord | undefined, onChainCommitment: Uint8Array | undefined): { score: number; salt: Uint8Array } | undefined {
  if (!record?.secret || !onChainCommitment) return undefined;
  if (record.secret.commitmentHex !== toHex(onChainCommitment)) return undefined;
  const salt = hexToBytes(record.secret.saltHex);
  if (!salt) return undefined;
  const expected = ratingCommitment(ratingPda(new PublicKey(record.escrow), new PublicKey(record.programId)), new PublicKey(record.wallet), record.secret.score, salt);
  return toHex(expected) === record.secret.commitmentHex ? { score: record.secret.score, salt } : undefined;
}

/** The backup file for one job: a small JSON document the buyer keeps. It holds the salt, so it is private until the reveal. */
export function ratingBackupFile(record: RatedJobRecord): { filename: string; text: string } | undefined {
  if (!record.secret) return undefined;
  return {
    filename: `rating-salt-${record.escrow.slice(0, 8)}.json`,
    text: JSON.stringify({ kind: RATING_BACKUP_KIND, note: "Keep this file private until you have revealed your rating. Without the salt you cannot reveal, and you lose reputation points.", ...record }, null, 2),
  };
}

export type RatingBackupImport = { ok: true; record: RatedJobRecord } | { ok: false; message: string };

/** Reads a backup file back in for `wallet`. The salt is checked against the commitment the file names before anything is stored. */
export function importRatingBackup(storage: KeyValueStorage, wallet: string, text: string): RatingBackupImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file is not a rating backup." };
  }
  if (!parsed || typeof parsed !== "object" || (parsed as { kind?: unknown }).kind !== RATING_BACKUP_KIND) return { ok: false, message: "That file is not a rating backup." };
  const { kind: _kind, note: _note, ...rest } = parsed as Record<string, unknown>;
  void _kind;
  void _note;
  if ((rest as { wallet?: unknown }).wallet !== wallet) return { ok: false, message: "That backup belongs to a different wallet. Connect the wallet that made the commitment." };
  if (!validRecord(rest, wallet) || !rest.secret) return { ok: false, message: "That backup is incomplete or damaged." };
  const record = rest as RatedJobRecord;
  const salt = hexToBytes(record.secret!.saltHex)!;
  const expected = ratingCommitment(ratingPda(new PublicKey(record.escrow), new PublicKey(record.programId)), new PublicKey(wallet), record.secret!.score, salt);
  if (toHex(expected) !== record.secret!.commitmentHex) return { ok: false, message: "The salt in that backup does not match its commitment." };
  try {
    writeAll(storage, wallet, [record, ...readAll(storage, wallet).filter((entry) => entry.escrow !== record.escrow)]);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The backup could not be stored." };
  }
  return { ok: true, record };
}

/** `window.localStorage`, or undefined where there is none (server render, storage blocked). */
export function browserRatingStorage(): KeyValueStorage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}
