/**
 * The provider wallet's key. It signs two things: the settle transaction that
 * collects a call's payment, and the receipt the buyer gets.
 *
 * The key is read once at start from a Solana keypair file (the JSON array of
 * 64 numbers `solana-keygen` writes). It is never taken from the config file,
 * logged or returned, and a file other users can read is refused.
 */
import { createPrivateKey, sign as edSign, type KeyObject } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";

export interface ProviderKey {
  /** Signs transactions. Hold it only inside the chain adapter. */
  keypair: Keypair;
  /** Ed25519 signature over a message, for receipts. */
  signMessage(message: Uint8Array): Uint8Array;
}

export type ProviderKeyResult = { ok: true; key: ProviderKey } | { ok: false; message: string };

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export function loadProviderKey(input: { keypairPath: string | undefined; wallet: string; readFile?: (path: string) => string; fileMode?: (path: string) => number }): ProviderKeyResult {
  const raw = input.keypairPath?.trim();
  if (!raw) return { ok: false, message: "no key file is configured: set keypairPath in the config or RAP_PROVIDER_KEYPAIR_PATH" };
  const path = expandHome(raw);
  let bytes: number[];
  try {
    const mode = (input.fileMode ?? ((p: string) => statSync(p).mode))(path);
    if ((mode & 0o077) !== 0) return { ok: false, message: "the key file must not be readable by group or others (run: chmod 600 on it)" };
    const parsed: unknown = JSON.parse((input.readFile ?? ((p: string) => readFileSync(p, "utf8")))(path));
    if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return { ok: false, message: "the key file is not a 64-byte Solana keypair" };
    }
    bytes = parsed as number[];
  } catch {
    // The error is not echoed: it could carry file contents.
    return { ok: false, message: "the key file could not be read" };
  }
  let keypair: Keypair;
  try {
    // Refuses a file whose public half does not belong to its secret half.
    keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    return { ok: false, message: "the key file is not a valid Solana keypair" };
  } finally {
    bytes.fill(0);
  }
  if (keypair.publicKey.toBase58() !== input.wallet) return { ok: false, message: "the key file does not belong to the wallet in the config" };
  const privateKey: KeyObject = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(keypair.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  return { ok: true, key: { keypair, signMessage: (message) => edSign(null, message, privateKey) } };
}
