/**
 * Server only. Sealing of Budget spender keys (audit round 4, S7-claude-03:
 * "per-budget keys, not one HMAC root").
 *
 * Each Budget gets its own random ed25519 key. Its 32-byte seed is stored
 * only sealed with AES-256-GCM under a key-encryption key (KEK) that lives in
 * the server's environment, never in the database. The sealed form names the
 * KEK by id, so KEKs can be rotated: add the new one first in
 * `BUDGET_SPENDER_KEKS`, re-seal every key (the incident route's `reseal` action), then drop the old
 * once no key is sealed under it. A KEK that may be exposed is not fixed by
 * resealing: the spender keys it opened are the same keys, so close those
 * Budgets.
 * The additional data binds a sealed key to its record and public key, so a
 * sealed value copied onto another record does not open.
 *
 * Format: `v1.<kid>.<iv b64url>.<ciphertext b64url>.<tag b64url>`.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { Keypair } from "@solana/web3.js";

export type Kek = { id: string; key: Buffer };

const KID = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Reads `BUDGET_SPENDER_KEKS`: `kid:base64key[,kid:base64key...]`, each key
 * 32 bytes. The first one seals; all of them open. Undefined when unset or
 * malformed, and then no Budget key can be made or used.
 */
export function readKeks(env: Record<string, string | undefined> = process.env): Kek[] | undefined {
  const raw = env.BUDGET_SPENDER_KEKS?.trim();
  if (!raw) return undefined;
  const keks: Kek[] = [];
  for (const part of raw.split(",")) {
    const [id, value, extra] = part.trim().split(":");
    if (extra !== undefined || !id || !KID.test(id) || !value) return undefined;
    const key = Buffer.from(value, "base64");
    if (key.length !== 32 || keks.some((k) => k.id === id)) return undefined;
    keks.push({ id, key });
  }
  return keks.length > 0 ? keks : undefined;
}

function aad(recordId: string, spender: string): Buffer {
  return Buffer.from(`rap-budget-spender/1|${recordId}|${spender}`, "utf8");
}

export function sealSpenderKey(keypair: Keypair, recordId: string, keks: Kek[]): string {
  const kek = keks[0];
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek.key, iv);
  cipher.setAAD(aad(recordId, keypair.publicKey.toBase58()));
  const seed = Buffer.from(keypair.secretKey.subarray(0, 32));
  const body = Buffer.concat([cipher.update(seed), cipher.final()]);
  seed.fill(0);
  return ["v1", kek.id, iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/** The id of the KEK a sealed key is under, or undefined when it is not a sealed key. */
export function sealedKid(sealed: string): string | undefined {
  const [version, kid] = sealed.split(".");
  return version === "v1" && kid && KID.test(kid) ? kid : undefined;
}

/**
 * Opens a sealed key to its 32-byte seed, in a Buffer the caller owns and
 * must wipe (`fill(0)`) when done. Throws if the KEK is unknown, the value was
 * altered, or it belongs to another record or key.
 */
export function openSpenderSeed(sealed: string, recordId: string, spender: string, keks: Kek[]): Buffer {
  const [version, kid, iv, body, tag, extra] = sealed.split(".");
  if (version !== "v1" || extra !== undefined || !kid || !iv || !body || !tag) throw new Error("sealed spender key: bad format");
  const kek = keks.find((k) => k.id === kid);
  if (!kek) throw new Error(`sealed spender key: KEK ${kid} is not configured`);
  const decipher = createDecipheriv("aes-256-gcm", kek.key, Buffer.from(iv, "base64url"));
  decipher.setAAD(aad(recordId, spender));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const seed = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]);
  if (seed.length !== 32 || Keypair.fromSeed(seed).publicKey.toBase58() !== spender) {
    seed.fill(0);
    throw new Error("sealed spender key: does not match its public key");
  }
  return seed;
}

/** Seals `sealed` again under the first (current) KEK. For KEK rotation. */
export function resealSpenderKey(sealed: string, recordId: string, spender: string, keks: Kek[]): string {
  const seed = openSpenderSeed(sealed, recordId, spender, keks);
  try {
    return sealSpenderKey(Keypair.fromSeed(seed), recordId, keks);
  } finally {
    seed.fill(0);
  }
}
