/**
 * Provider receipt signer for the server entry point (#776).
 *
 * The operator points PROVIDER_RECEIPT_KEYPAIR_PATH at a Solana keypair file
 * (a JSON array of 64 bytes: the 32-byte seed followed by the 32-byte public
 * key). The key is read from that file once at start and is never taken from
 * an environment variable, logged, or returned. The file's public key must be
 * the profile's wallet, because a receipt is checked against that wallet.
 *
 * With real payments on and demo payments off, a paid call is expected to
 * return a signed receipt, so the server refuses to start without a usable key.
 */

import { createPrivateKey, sign as edSign } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { signReddiReceiptV2, type ReddiReceiptV2 } from "@reddi/agent-protocol/receipt-v2";
import type { ProviderReceiptStatement } from "./runtime.js";

export type ProviderSignerChoice =
  | { ok: true; sign?: (statement: ProviderReceiptStatement) => Promise<unknown>; description: string }
  | { ok: false; message: string };

export interface ProviderSignerInput {
  keypairPath: string | undefined;
  /** The profile's wallet address. The key file must belong to it. */
  walletAddress: string;
  /** True when real payments are accepted and demo payments are not: receipts are then expected. */
  receiptsExpected: boolean;
  readFile?: (path: string) => string;
  fileMode?: (path: string) => number;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function base58Encode(bytes: Uint8Array): string {
  let value = BigInt(0);
  for (const byte of bytes) value = value * BigInt(256) + BigInt(byte);
  let out = "";
  while (value > BigInt(0)) {
    out = BASE58[Number(value % BigInt(58))] + out;
    value /= BigInt(58);
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function chooseProviderSigner(input: ProviderSignerInput): ProviderSignerChoice {
  const path = input.keypairPath?.trim();
  if (!path) {
    return input.receiptsExpected
      ? { ok: false, message: "real payments are on, so PROVIDER_RECEIPT_KEYPAIR_PATH must name the provider wallet's keypair file" }
      : { ok: true, description: "none" };
  }
  let bytes: number[];
  try {
    // A key file readable by other users is refused, as ssh does.
    const mode = (input.fileMode ?? ((p: string) => statSync(p).mode))(path);
    if ((mode & 0o077) !== 0) return { ok: false, message: "the provider keypair file must not be readable by group or others (chmod 600)" };
    const parsed: unknown = JSON.parse((input.readFile ?? ((p: string) => readFileSync(p, "utf8")))(path));
    if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return { ok: false, message: "the provider keypair file is not a 64-byte Solana keypair" };
    }
    bytes = parsed as number[];
  } catch {
    // The error is not echoed: it could carry file contents.
    return { ok: false, message: "the provider keypair file could not be read" };
  }
  const publicKey = base58Encode(Uint8Array.from(bytes.slice(32)));
  if (publicKey !== input.walletAddress) {
    return { ok: false, message: "the provider keypair file does not belong to this profile's wallet" };
  }
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(bytes.slice(0, 32))]), format: "der", type: "pkcs8" });
  bytes.fill(0);
  const sign = (statement: ProviderReceiptStatement) =>
    // signReddiReceiptV2 validates the statement and refuses a signature that does not verify against providerId,
    // so a file whose two halves disagree can never produce a receipt.
    signReddiReceiptV2(statement as ReddiReceiptV2, (message) => edSign(null, message, privateKey));
  return { ok: true, sign, description: "keypair file" };
}
