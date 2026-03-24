/**
 * Walrus testnet storage helpers.
 * Publisher: https://publisher.walrus-testnet.walrus.space
 * Aggregator: https://aggregator.walrus-testnet.walrus.space
 * No wallet, no tokens, no installation required on testnet.
 */

const WALRUS_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";
const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";
const WALRUS_EPOCHS = 5; // 5 testnet days coverage

export interface WalrusStoreResult {
  blobId: string;          // URL-safe base64 blob ID from Walrus
  blobIdBytes: Uint8Array; // decoded to 32 bytes for on-chain storage
  alreadyCertified: boolean;
}

/**
 * Store a string payload on Walrus testnet.
 * Returns blobId (base64) + blobIdBytes (32 bytes for on-chain storage_ref).
 */
export async function storeOnWalrus(payload: string): Promise<WalrusStoreResult> {
  const res = await fetch(
    `${WALRUS_PUBLISHER}/v1/blobs?epochs=${WALRUS_EPOCHS}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from(payload, "utf8"),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!res.ok) {
    throw new Error(`Walrus store failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();

  // Walrus returns either { newlyCreated: { blobObject: { blobId } } }
  // or { alreadyCertified: { blobId } }
  let blobId: string;
  let alreadyCertified = false;

  if (data.newlyCreated?.blobObject?.blobId) {
    blobId = data.newlyCreated.blobObject.blobId;
  } else if (data.alreadyCertified?.blobId) {
    blobId = data.alreadyCertified.blobId;
    alreadyCertified = true;
  } else {
    throw new Error(`Unexpected Walrus response: ${JSON.stringify(data)}`);
  }

  // Decode base64 blob ID to bytes for on-chain storage
  // Walrus blob IDs are 32-byte values encoded as URL-safe base64
  const blobIdBytes = base64UrlToBytes(blobId);

  return { blobId, blobIdBytes, alreadyCertified };
}

/**
 * Retrieve a blob from Walrus testnet by blob ID.
 */
export async function fetchFromWalrus(blobId: string): Promise<string> {
  const res = await fetch(
    `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`Walrus fetch failed: ${res.status}`);
  return res.text();
}

/**
 * Decode URL-safe base64 string to Uint8Array (32 bytes for Walrus blob IDs).
 */
function base64UrlToBytes(b64: string): Uint8Array {
  // Convert URL-safe base64 to standard base64
  const standard = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard.padEnd(standard.length + (4 - standard.length % 4) % 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
