/**
 * Sandbox provider signing keys. Server-side only.
 *
 * These are public test keys, not secrets: each one is derived from a fixed,
 * published label, so anyone can recompute it. They hold no funds, control no
 * account, and exist only so sandbox receipts carry a signature a visitor can
 * check. A real provider signs with a key only it holds.
 */
import { fromHex, toHex, utf8Bytes } from "./receipt";

const KEY_LABEL = "rap-devnet-sandbox-provider-key:v1:";
/** PKCS#8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410). */
const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420";

type ProviderKey = { privateKey: CryptoKey; publicKeyHex: string };
const cache = new Map<string, Promise<ProviderKey>>();

async function derive(providerId: string): Promise<ProviderKey> {
  const subtle = globalThis.crypto.subtle;
  const seed = new Uint8Array(await subtle.digest("SHA-256", utf8Bytes(`${KEY_LABEL}${providerId}`)));
  const privateKey = await subtle.importKey("pkcs8", fromHex(`${PKCS8_ED25519_PREFIX}${toHex(seed)}`), { name: "Ed25519" }, true, ["sign"]);
  const jwk = await subtle.exportKey("jwk", privateKey);
  if (typeof jwk.x !== "string") throw new Error("sandbox provider key has no public component");
  const publicKeyHex = toHex(new Uint8Array(Buffer.from(jwk.x, "base64url")));
  return { privateKey, publicKeyHex };
}

function providerKey(providerId: string): Promise<ProviderKey> {
  let key = cache.get(providerId);
  if (!key) {
    key = derive(providerId);
    cache.set(providerId, key);
  }
  return key;
}

export async function sandboxProviderPublicKey(providerId: string): Promise<string> {
  return (await providerKey(providerId)).publicKeyHex;
}

export async function signAsSandboxProvider(providerId: string, payload: string): Promise<{ publicKey: string; value: string }> {
  const key = await providerKey(providerId);
  const signature = await globalThis.crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, utf8Bytes(payload));
  return { publicKey: key.publicKeyHex, value: toHex(new Uint8Array(signature)) };
}
