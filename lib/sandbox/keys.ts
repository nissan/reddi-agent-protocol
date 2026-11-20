/**
 * Sandbox provider signing keys. Server-side only.
 *
 * These are public test keys, not secrets: each one is derived from a fixed,
 * published label, so anyone can recompute it. They hold no funds, control no
 * account, and exist only so sandbox receipts carry a signature a visitor can
 * check. A real provider signs with a key only it holds.
 */
import { base58Encode, bytesToBase64, fromHex, toHex, utf8Bytes } from "./receipt";

const KEY_LABEL = "rap-devnet-sandbox-provider-key:v1:";
/** PKCS#8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410). */
const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420";

type ProviderKey = { privateKey: CryptoKey; address: string };
const cache = new Map<string, Promise<ProviderKey>>();

async function derive(providerId: string): Promise<ProviderKey> {
  const subtle = globalThis.crypto.subtle;
  const seed = new Uint8Array(await subtle.digest("SHA-256", utf8Bytes(`${KEY_LABEL}${providerId}`)));
  const privateKey = await subtle.importKey("pkcs8", fromHex(`${PKCS8_ED25519_PREFIX}${toHex(seed)}`), { name: "Ed25519" }, true, ["sign"]);
  const jwk = await subtle.exportKey("jwk", privateKey);
  if (typeof jwk.x !== "string") throw new Error("sandbox provider key has no public component");
  return { privateKey, address: base58Encode(new Uint8Array(Buffer.from(jwk.x, "base64url"))) };
}

function providerKey(providerId: string): Promise<ProviderKey> {
  let key = cache.get(providerId);
  if (!key) {
    key = derive(providerId);
    cache.set(providerId, key);
  }
  return key;
}

/** The provider's test key as a base58 address: the `providerId` of its receipts. */
export async function sandboxProviderAddress(providerId: string): Promise<string> {
  return (await providerKey(providerId)).address;
}

/** Signs the canonical receipt bytes. Returns the base64 signature a receipt proof carries. */
export async function signAsSandboxProvider(providerId: string, payload: string): Promise<{ address: string; signature: string }> {
  const key = await providerKey(providerId);
  const signature = await globalThis.crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, utf8Bytes(payload));
  return { address: key.address, signature: bytesToBase64(new Uint8Array(signature)) };
}
