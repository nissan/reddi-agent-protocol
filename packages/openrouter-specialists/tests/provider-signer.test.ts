import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { REDDI_RECEIPT_V2_VERSION, hashReddiReceiptV2Body, verifyReddiReceiptV2, type SignedReddiReceiptV2 } from "@redditech/agent-protocol/receipt-v2";
import { chooseProviderSigner, type ProviderReceiptStatement } from "../src/index.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let value = BigInt(0);
  for (const byte of bytes) value = value * BigInt(256) + BigInt(byte);
  let out = "";
  while (value > BigInt(0)) { out = BASE58[Number(value % BigInt(58))] + out; value /= BigInt(58); }
  for (const byte of bytes) { if (byte !== 0) break; out = "1" + out; }
  return out;
}

// A throwaway keypair generated per run, in the Solana file layout. Never a real wallet.
function throwawayKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { address: base58(pub), fileText: JSON.stringify([...seed, ...pub]) };
}

function withKeyFile<T>(text: string, mode: number, run: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "provider-signer-"));
  const path = join(dir, "provider.json");
  try {
    writeFileSync(path, text, { mode: 0o600 });
    chmodSync(path, mode);
    return run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function statementFor(address: string): ProviderReceiptStatement {
  return {
    schemaVersion: REDDI_RECEIPT_V2_VERSION,
    providerId: address,
    declaredModel: "test-model",
    requestHash: hashReddiReceiptV2Body("{}"),
    responseHash: hashReddiReceiptV2Body("[]"),
    payment: { network: "solana-devnet", txSignature: "5".repeat(88), currency: "SOL", amount: "1000", fee: { amount: "0" }, settlement: "direct" },
    issuedAt: "2026-11-20T09:00:00Z",
  };
}

test("no key file is fine while receipts are not expected, and a refusal when they are", () => {
  assert.deepEqual(chooseProviderSigner({ keypairPath: undefined, walletAddress: "x", receiptsExpected: false }), { ok: true, description: "none" });
  const refused = chooseProviderSigner({ keypairPath: "  ", walletAddress: "x", receiptsExpected: true });
  assert.equal(refused.ok, false);
  assert.match((refused as { message: string }).message, /PROVIDER_RECEIPT_KEYPAIR_PATH/);
});

test("a key file for the profile's wallet signs a receipt that verifies offline", async () => {
  const key = throwawayKeypair();
  const choice = withKeyFile(key.fileText, 0o600, (path) => chooseProviderSigner({ keypairPath: path, walletAddress: key.address, receiptsExpected: true }));
  assert.equal(choice.ok, true);
  if (!choice.ok || !choice.sign) throw new Error("expected a signer");
  assert.equal(choice.description, "keypair file");
  const signed = (await choice.sign(statementFor(key.address))) as SignedReddiReceiptV2;
  const verified = await verifyReddiReceiptV2(signed, { providerId: key.address });
  assert.equal(verified.ok, true);
  const tampered = { ...signed, receipt: { ...signed.receipt, declaredModel: "bigger-model" } };
  assert.equal((await verifyReddiReceiptV2(tampered, { providerId: key.address })).ok, false);
});

test("a key file for another wallet is refused", () => {
  const key = throwawayKeypair();
  const other = throwawayKeypair();
  const choice = withKeyFile(key.fileText, 0o600, (path) => chooseProviderSigner({ keypairPath: path, walletAddress: other.address, receiptsExpected: true }));
  assert.deepEqual(choice, { ok: false, message: "the provider keypair file does not belong to this profile's wallet" });
});

test("a key file other users can read is refused", () => {
  const key = throwawayKeypair();
  for (const mode of [0o640, 0o604, 0o644]) {
    const choice = withKeyFile(key.fileText, mode, (path) => chooseProviderSigner({ keypairPath: path, walletAddress: key.address, receiptsExpected: false }));
    assert.equal(choice.ok, false);
    assert.match((choice as { message: string }).message, /chmod 600/);
  }
});

test("a missing or malformed key file is refused without echoing its contents", () => {
  const missing = chooseProviderSigner({ keypairPath: "/nonexistent/provider.json", walletAddress: "x", receiptsExpected: false });
  assert.deepEqual(missing, { ok: false, message: "the provider keypair file could not be read" });
  for (const text of ["SECRET-not-json", "[1,2,3]", JSON.stringify(new Array(64).fill(256)), '{"secret":"SECRET"}']) {
    const choice = withKeyFile(text, 0o600, (path) => chooseProviderSigner({ keypairPath: path, walletAddress: "x", receiptsExpected: false }));
    assert.equal(choice.ok, false);
    assert.doesNotMatch((choice as { message: string }).message, /SECRET/);
  }
});
