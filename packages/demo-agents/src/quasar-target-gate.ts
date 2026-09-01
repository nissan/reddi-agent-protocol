/**
 * Pure configuration policy for the experimental Quasar target.
 *
 * Deliberately free of dotenv, RPC clients, wallets, and module-load side effects so the gate can be
 * exercised directly. Quasar is only ever routed against locally built current-source programs on a
 * loopback Surfnet; every other request is refused rather than silently downgraded to legacy-anchor.
 */
import { isLoopbackRpcUrl } from "../../../lib/config/loopback-endpoint";

export { isLoopbackRpcUrl };

export type QuasarTargetProfile = "local-surfpool" | "devnet" | "mainnet";

export type EnvLookup = (...keys: string[]) => string | undefined;

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function isValidSolanaProgramId(value: string): boolean {
  if (!BASE58_PUBKEY.test(value)) return false;

  let leadingZeroBytes = 0;
  while (leadingZeroBytes < value.length && value[leadingZeroBytes] === "1") leadingZeroBytes += 1;

  let decoded = 0n;
  for (const char of value) decoded = decoded * 58n + BigInt(BASE58_ALPHABET.indexOf(char));

  let significantBytes = 0;
  for (let remaining = decoded; remaining > 0n; remaining >>= 8n) significantBytes += 1;

  return leadingZeroBytes + significantBytes === 32;
}

const PROGRAM_ID_ENV_KEYS: ReadonlyArray<readonly [string, string, string]> = [
  ["escrow", "DEMO_ESCROW_PROGRAM_ID", "NEXT_PUBLIC_ESCROW_PROGRAM_ID"],
  ["registry", "DEMO_REGISTRY_PROGRAM_ID", "NEXT_PUBLIC_REGISTRY_PROGRAM_ID"],
  ["reputation", "DEMO_REPUTATION_PROGRAM_ID", "NEXT_PUBLIC_REPUTATION_PROGRAM_ID"],
  ["attestation", "DEMO_ATTESTATION_PROGRAM_ID", "NEXT_PUBLIC_ATTESTATION_PROGRAM_ID"],
];

/**
 * Explains why a supplied program id cannot be used, on every profile and every target, or returns
 * undefined when every supplied id is a valid 32-byte public key. A typo is attributed to the
 * variable that carries it instead of surfacing later as a bare `Invalid public key input` from
 * whichever script happened to construct a `PublicKey` from it first.
 */
export function describeMalformedProgramIdRefusal(lookup: EnvLookup): string | undefined {
  const malformed: string[] = [];
  for (const [, primaryKey, fallbackKey] of PROGRAM_ID_ENV_KEYS) {
    const value = lookup(primaryKey, fallbackKey);
    if (value === undefined) continue;
    if (!isValidSolanaProgramId(value)) {
      malformed.push(`${primaryKey} (or ${fallbackKey}): ${JSON.stringify(value)}`);
    }
  }
  if (!malformed.length) return undefined;
  return [
    "Supplied demo program ids are malformed and must be valid 32-byte base58 Solana public keys:",
    ...malformed.map((entry) => `\n  - ${entry}`),
  ].join(" ");
}

/**
 * Explains why an explicit `quasar` request cannot be honoured, or returns undefined when the
 * request is a fully specified loopback local-surfpool Quasar configuration.
 */
export function describeQuasarTargetRefusal(profile: QuasarTargetProfile, lookup: EnvLookup): string | undefined {
  if (profile !== "local-surfpool") {
    return [
      `Quasar target requested on the "${profile}" profile, which is refused.`,
      "The recorded Quasar devnet deployment predates the job-binding rework and no longer matches this client;",
      "config/quasar/deployments.json records it as submissionReady=false with explicit ABI/deployment known gaps.",
      "Run the Quasar target only on NETWORK_PROFILE=local-surfpool against locally built current-source programs",
      "(npm run test:surfpool:quasar-critical).",
    ].join(" ");
  }

  const problems: string[] = [];
  const idOwners = new Map<string, string>();
  for (const [label, primaryKey, fallbackKey] of PROGRAM_ID_ENV_KEYS) {
    const value = lookup(primaryKey, fallbackKey);
    if (!value) {
      problems.push(`missing ${primaryKey} (or ${fallbackKey})`);
      continue;
    }
    if (!isValidSolanaProgramId(value)) {
      problems.push(`malformed ${primaryKey}: ${JSON.stringify(value)} is not a valid 32-byte base58 Solana program ID`);
      continue;
    }
    const owner = idOwners.get(value);
    if (owner) {
      problems.push(`inconsistent ${primaryKey}: ${value} duplicates the ${owner} program ID; Quasar requires four distinct programs`);
      continue;
    }
    idOwners.set(value, label);
  }

  const rpc = lookup("DEMO_DEVNET_RPC", "NEXT_PUBLIC_RPC_ENDPOINT");
  if (!rpc) {
    problems.push("missing DEMO_DEVNET_RPC (or NEXT_PUBLIC_RPC_ENDPOINT)");
  } else if (!isLoopbackRpcUrl(rpc)) {
    problems.push(`non-loopback DEMO_DEVNET_RPC: ${rpc} must be an http:// or ws:// loopback URL with an explicit port`);
  }

  const rpcWs = lookup("DEMO_DEVNET_RPC_WS", "NEXT_PUBLIC_RPC_WS_ENDPOINT");
  if (rpcWs && !isLoopbackRpcUrl(rpcWs)) {
    problems.push(`non-loopback DEMO_DEVNET_RPC_WS: ${rpcWs} must be an http:// or ws:// loopback URL with an explicit port`);
  }

  if (!problems.length) return undefined;
  return [
    "Quasar target requested on the local-surfpool profile with an incomplete or inconsistent configuration.",
    "Refusing rather than silently falling back to legacy-anchor, which would send Anchor-encoded instructions",
    "to Quasar program IDs. Fix each of the following and re-run:",
    ...problems.map((problem) => `\n  - ${problem}`),
  ].join(" ");
}

/** Single-quote a value for safe copy/paste into a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}
