/**
 * Proof that a direct per-call payment is being presented by the wallet that
 * paid it.
 *
 * A confirmed transfer is public: its signature, payer and amount can be read
 * by anyone. Without a proof, someone who sees a buyer's payment could present
 * it first and be served, and the buyer would then be refused as a duplicate.
 * So the request that presents a direct receipt carries a signature over the
 * network, the transaction signature, the payee and the SHA-256 of the request
 * body, made by the wallet that signed the transfer, or by a key that wallet
 * handed this provider for a while (so a browser wallet signs once, not on
 * every call).
 *
 * Headers:
 * - `x402-payment-proof`: base64 of the signature over `directPaymentProofMessage(...)`.
 * - `x402-payment-delegation` (optional): base64 of JSON `{provider, sessionKey, expiresAt, signature}`,
 *   `signature` base64 of the payer's signature over `directPaymentDelegationMessage(...)`.
 *   With it, the proof is signed by `sessionKey`; without it, by the payer.
 *
 * Verification uses Node's crypto; signing takes a callback, so the buyer can
 * sign with a wallet adapter, a Keypair or anything else.
 */
import type { Keypair } from '@solana/web3.js';
import type { HeaderReader } from './provider';
import { decodeBase64, ed25519Sign, ed25519Verify, publicKeyOf } from './ed25519';
import { MAX_SESSION_DELEGATION_SECONDS, sessionBodyHash, type Signer } from './session-auth';
import type { PayerProofCheck, ProvenDirectPayment, SolanaPaymentNetwork } from './types';

export const PAYMENT_PROOF_HEADER = 'x402-payment-proof';
export const PAYMENT_DELEGATION_HEADER = 'x402-payment-delegation';

export interface DirectPaymentDelegation {
  /** The provider's payee wallet. */
  provider: string;
  sessionKey: string;
  /** Whole seconds since the epoch, at most `MAX_SESSION_DELEGATION_SECONDS` ahead. */
  expiresAt: number;
}

export type DirectPaymentProofFailure = {
  ok: false;
  reason: 'payer_proof_required' | 'payer_proof_invalid' | 'payer_proof_expired';
  message: string;
};

/** The text the payer wallet signs to let `sessionKey` prove its direct payments to `provider`. */
export function directPaymentDelegationMessage(d: DirectPaymentDelegation): string {
  return [
    'Reddi Agent Protocol direct payments',
    'I let this key prove my direct payments to this provider.',
    `provider: ${d.provider}`,
    `session key: ${d.sessionKey}`,
    `expires: ${new Date(d.expiresAt * 1000).toISOString()}`,
  ].join('\n');
}

/** The bytes signed for one request that presents a direct payment. */
export function directPaymentProofMessage(input: { network: SolanaPaymentNetwork; txSignature: string; payTo: string; bodyHash: string }): string {
  return ['reddi-direct/1', input.network, input.txSignature, input.payTo, input.bodyHash].join('\n');
}

/** Buyer side: a signer for a server-held Keypair (a browser wallet passes its own `signMessage`). */
export function keypairSigner(keypair: Keypair): Signer {
  return (message) => ed25519Sign(keypair, message);
}

/**
 * Buyer side: the delegation header value, signed once by the payer wallet.
 * Keep it with the session key, in memory only, and reuse it until it expires.
 * Use `delegationExpiresAt()` (a day) for `expiresAt` rather than the maximum.
 */
export async function directPaymentDelegationHeaderValue(d: DirectPaymentDelegation, signWithPayer: Signer): Promise<string> {
  const signature = await signWithPayer(new TextEncoder().encode(directPaymentDelegationMessage(d)));
  return Buffer.from(JSON.stringify({ ...d, signature: Buffer.from(signature).toString('base64') }), 'utf8').toString('base64');
}

/**
 * Buyer side: the headers for one request that presents a direct payment.
 * `sign` is the payer wallet, or the session key named in `delegation`.
 * `body` must be the exact bytes sent.
 */
export async function directPaymentProofHeaders(input: {
  network: SolanaPaymentNetwork;
  txSignature: string;
  payTo: string;
  body: Uint8Array | string;
  sign: Signer;
  delegation?: string;
}): Promise<Record<string, string>> {
  const message = directPaymentProofMessage({ network: input.network, txSignature: input.txSignature, payTo: input.payTo, bodyHash: sessionBodyHash(input.body) });
  const proof = Buffer.from(await input.sign(new TextEncoder().encode(message))).toString('base64');
  return { [PAYMENT_PROOF_HEADER]: proof, ...(input.delegation ? { [PAYMENT_DELEGATION_HEADER]: input.delegation } : {}) };
}

/**
 * Provider side: checks that the request was signed by the wallet that made
 * the payment (`paid.payer`, which the receipt verifier has already tied to
 * the transaction), or by a key it delegated to this provider. `body` is the
 * raw request body exactly as received.
 */
export function verifyDirectPaymentProof(input: {
  headers: HeaderReader;
  paid: ProvenDirectPayment;
  body?: Uint8Array | string;
  nowMs: number;
}): { ok: true; signer: string } | DirectPaymentProofFailure {
  const proofValue = input.headers.get(PAYMENT_PROOF_HEADER);
  if (!proofValue) {
    return { ok: false, reason: 'payer_proof_required', message: `A direct payment must be presented with ${PAYMENT_PROOF_HEADER}: a signature over this request by the wallet that paid.` };
  }
  const invalid = (message: string): DirectPaymentProofFailure => ({ ok: false, reason: 'payer_proof_invalid', message });
  const payer = publicKeyOf(input.paid.payer);
  const payTo = publicKeyOf(input.paid.payTo);
  if (!payer || !payTo) return invalid('The payment does not name a valid payer and payee.');

  let signer = payer;
  const delegationValue = input.headers.get(PAYMENT_DELEGATION_HEADER);
  if (delegationValue) {
    const raw = decodeBase64(delegationValue);
    if (!raw) return invalid('The payment delegation is not base64.');
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(raw.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('The payment delegation is not an object.');
      parsed = value as Record<string, unknown>;
    } catch {
      return invalid('The payment delegation is not JSON.');
    }
    const provider = publicKeyOf(parsed.provider);
    const sessionKey = publicKeyOf(parsed.sessionKey);
    const expiresAt = parsed.expiresAt;
    const signature = typeof parsed.signature === 'string' ? decodeBase64(parsed.signature) : undefined;
    if (!provider || !sessionKey || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || !signature) {
      return invalid('The payment delegation needs provider, sessionKey, a whole-second expiresAt and a signature.');
    }
    if (!provider.equals(payTo)) return invalid('The payment delegation names another provider.');
    const nowSeconds = Math.floor(input.nowMs / 1000);
    if (expiresAt <= nowSeconds) return { ok: false, reason: 'payer_proof_expired', message: 'The payment delegation has expired. Sign a new one with the payer wallet.' };
    if (expiresAt > nowSeconds + MAX_SESSION_DELEGATION_SECONDS) return invalid(`A payment delegation may run for at most ${MAX_SESSION_DELEGATION_SECONDS} seconds.`);
    const delegation: DirectPaymentDelegation = { provider: provider.toBase58(), sessionKey: sessionKey.toBase58(), expiresAt };
    if (!ed25519Verify(payer, new TextEncoder().encode(directPaymentDelegationMessage(delegation)), signature)) {
      return invalid('The payment delegation is not signed by the wallet that paid.');
    }
    signer = sessionKey;
  }

  const proof = decodeBase64(proofValue);
  const message = directPaymentProofMessage({ network: input.paid.network, txSignature: input.paid.txSignature, payTo: payTo.toBase58(), bodyHash: sessionBodyHash(input.body) });
  if (!proof || !ed25519Verify(signer, new TextEncoder().encode(message), proof)) {
    return invalid('The request is not signed by the wallet that paid, or was changed after signing.');
  }
  return { ok: true, signer: signer.toBase58() };
}

/**
 * Provider side: the check to pass to `SolanaReceiptVerifier.verifyReceipt`
 * for one request. `body` is the raw request body exactly as received.
 */
export function directPaymentProofCheck(input: { headers: HeaderReader; body?: Uint8Array | string; nowMs?: number }): PayerProofCheck {
  return (paid) => {
    const result = verifyDirectPaymentProof({ headers: input.headers, paid, body: input.body, nowMs: input.nowMs ?? Date.now() });
    return result.ok ? { ok: true } : result;
  };
}
