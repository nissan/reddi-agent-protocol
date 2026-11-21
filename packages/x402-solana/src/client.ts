import { existsSync, readFileSync } from 'node:fs';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction, type Connection } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { buildX402Challenge, isValidSolanaPublicKey } from './payment';
import { directPaymentProofHeaders, keypairSigner } from './direct-auth';
import type { SolanaPaymentNetwork, X402Challenge, X402PaymentReceipt } from './types';

const DEVNET_NETWORK: SolanaPaymentNetwork = 'solana-devnet';
const DEFAULT_MIN_FEE_LAMPORTS = 5_000;
const APPROVAL_PHRASE = 'EXECUTE_DEVNET_X402_SPECIALIST_CALL';

export type DevnetUsdcTransferResult = {
  signature: string;
  destinationTokenAccount: string;
};

export type DevnetUsdcPaymentClient = {
  getSolBalanceLamports(publicKey: PublicKey): Promise<number>;
  getUsdcBalanceMicroUnits(owner: PublicKey, mint: PublicKey): Promise<bigint>;
  getOrCreateDestinationTokenAccount(payTo: PublicKey, mint: PublicKey): Promise<string>;
  submitUsdcTransfer(input: {
    payer: Keypair;
    payTo: PublicKey;
    mint: PublicKey;
    amountMicroUnits: bigint;
    destinationTokenAccount: string;
    challenge: X402Challenge;
  }): Promise<DevnetUsdcTransferResult>;
};

export type DevnetUsdcPaymentConfig = {
  rpcUrl: string;
  usdcMint: string;
  walletKeypairPath: string;
  endpointAllowlist: string[];
  maxUsdcMicroUnits: bigint | number | string;
  minFeeLamports?: number;
};

export type DevnetUsdcPaymentReadiness = {
  schemaVersion: 'reddi.x402-solana.devnet-usdc-payment-readiness.v1';
  ready: boolean;
  boundary: 'solana-devnet-only-no-mainnet';
  reasons: string[];
  payer: string | null;
  challenge: Pick<X402Challenge, 'network' | 'payTo' | 'amount' | 'currency' | 'endpoint' | 'nonce'>;
  spend: {
    amountMicroUnits: string;
    maxUsdcMicroUnits: string;
    capRespected: boolean;
  };
  balances: {
    solLamports: number | null;
    usdcMicroUnits: string | null;
  };
  destinationTokenAccount: string | null;
};

export type ExecuteDevnetUsdcPaymentInput = {
  challenge: X402Challenge;
  config: DevnetUsdcPaymentConfig;
  client: DevnetUsdcPaymentClient;
  approvalPhrase: typeof APPROVAL_PHRASE;
};

export function loadDevnetKeypair(path: string): Keypair {
  if (!path || !existsSync(path)) throw new Error('devnet_wallet_keypair_unavailable');
  const secret = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(secret)) throw new Error('devnet_wallet_keypair_invalid');
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function assertDevnetRpcUrl(rpcUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error('invalid_devnet_rpc_url');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported_devnet_rpc_url_protocol');
  const host = parsed.hostname.toLowerCase();
  if (host.includes('mainnet')) throw new Error('mainnet_rpc_url_forbidden');
  const allowed = host === 'api.devnet.solana.com' || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.includes('devnet');
  if (!allowed) throw new Error(`unsupported_devnet_rpc_url_host:${parsed.hostname}`);
}

export function assertEndpointAllowed(endpoint: string, allowlist: string[]): void {
  if (!allowlist.length) throw new Error('specialist_endpoint_allowlist_required');
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('invalid_specialist_endpoint_url');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported_specialist_endpoint_protocol');
  if (!allowlist.includes(endpoint)) throw new Error('specialist_endpoint_not_allowlisted');
}

export function usdcAmountToMicroUnits(amount: string | number): bigint {
  const text = String(amount);
  if (!/^\d+(\.\d{1,6})?$/.test(text)) throw new Error('invalid_usdc_amount');
  const [wholeRaw, fracRaw = ''] = text.split('.');
  const whole = BigInt(wholeRaw || '0');
  const frac = BigInt((fracRaw + '000000').slice(0, 6));
  const microUnits = whole * 1_000_000n + frac;
  if (microUnits <= 0n) throw new Error('invalid_usdc_amount');
  return microUnits;
}

function normalizeCap(value: bigint | number | string): bigint {
  const cap = BigInt(value);
  if (cap <= 0n) throw new Error('invalid_devnet_usdc_spend_cap');
  return cap;
}

export function validateDevnetUsdcChallenge(challenge: X402Challenge, config: DevnetUsdcPaymentConfig): {
  payTo: PublicKey;
  mint: PublicKey;
  amountMicroUnits: bigint;
  maxUsdcMicroUnits: bigint;
} {
  assertDevnetRpcUrl(config.rpcUrl);
  assertEndpointAllowed(challenge.endpoint, config.endpointAllowlist);
  if (challenge.network !== DEVNET_NETWORK) throw new Error('x402_challenge_not_solana_devnet');
  if (String(challenge.currency).toUpperCase() !== 'USDC') throw new Error('x402_challenge_currency_must_be_USDC');
  if (!challenge.nonce) throw new Error('x402_challenge_nonce_required');
  if (!isValidSolanaPublicKey(challenge.payTo)) throw new Error('x402_challenge_payee_invalid');
  if (!isValidSolanaPublicKey(config.usdcMint)) throw new Error('devnet_usdc_mint_invalid');
  const amountMicroUnits = usdcAmountToMicroUnits(challenge.amount);
  const maxUsdcMicroUnits = normalizeCap(config.maxUsdcMicroUnits);
  if (amountMicroUnits > maxUsdcMicroUnits) throw new Error(`devnet_usdc_spend_cap_exceeded:${amountMicroUnits}>${maxUsdcMicroUnits}`);
  return {
    payTo: new PublicKey(challenge.payTo),
    mint: new PublicKey(config.usdcMint),
    amountMicroUnits,
    maxUsdcMicroUnits,
  };
}

export async function prepareDevnetUsdcPayment(input: {
  challenge: X402Challenge;
  config: DevnetUsdcPaymentConfig;
  client: Pick<DevnetUsdcPaymentClient, 'getSolBalanceLamports' | 'getUsdcBalanceMicroUnits' | 'getOrCreateDestinationTokenAccount'>;
}): Promise<DevnetUsdcPaymentReadiness> {
  const reasons: string[] = [];
  let payer: Keypair | null = null;
  let payTo: PublicKey;
  let mint: PublicKey;
  let amountMicroUnits: bigint;
  let maxUsdcMicroUnits: bigint;
  try {
    ({ payTo, mint, amountMicroUnits, maxUsdcMicroUnits } = validateDevnetUsdcChallenge(input.challenge, input.config));
    payer = loadDevnetKeypair(input.config.walletKeypairPath);
  } catch (error) {
    return readiness(input.challenge, null, '0', String(input.config.maxUsdcMicroUnits), false, reasons.concat(error instanceof Error ? error.message : String(error)), null, null, null);
  }

  const solLamports = await input.client.getSolBalanceLamports(payer.publicKey);
  const usdcMicroUnits = await input.client.getUsdcBalanceMicroUnits(payer.publicKey, mint);
  const destinationTokenAccount = await input.client.getOrCreateDestinationTokenAccount(payTo, mint);
  const minFeeLamports = input.config.minFeeLamports ?? DEFAULT_MIN_FEE_LAMPORTS;
  if (solLamports < minFeeLamports) reasons.push(`insufficient_sol_for_fees:${solLamports}<${minFeeLamports}`);
  if (usdcMicroUnits < amountMicroUnits) reasons.push(`insufficient_usdc:${usdcMicroUnits}<${amountMicroUnits}`);

  return readiness(input.challenge, payer.publicKey.toBase58(), String(amountMicroUnits), String(maxUsdcMicroUnits), amountMicroUnits <= maxUsdcMicroUnits, reasons, solLamports, String(usdcMicroUnits), destinationTokenAccount);
}

function readiness(
  challenge: X402Challenge,
  payer: string | null,
  amountMicroUnits: string,
  maxUsdcMicroUnits: string,
  capRespected: boolean,
  reasons: string[],
  solLamports: number | null,
  usdcMicroUnits: string | null,
  destinationTokenAccount: string | null,
): DevnetUsdcPaymentReadiness {
  return {
    schemaVersion: 'reddi.x402-solana.devnet-usdc-payment-readiness.v1',
    ready: reasons.length === 0,
    boundary: 'solana-devnet-only-no-mainnet',
    reasons,
    payer,
    challenge: {
      network: challenge.network,
      payTo: challenge.payTo,
      amount: challenge.amount,
      currency: challenge.currency,
      endpoint: challenge.endpoint,
      nonce: challenge.nonce,
    },
    spend: { amountMicroUnits, maxUsdcMicroUnits, capRespected },
    balances: { solLamports, usdcMicroUnits },
    destinationTokenAccount,
  };
}

export async function executeDevnetUsdcPayment(input: ExecuteDevnetUsdcPaymentInput): Promise<X402PaymentReceipt> {
  if (input.approvalPhrase !== APPROVAL_PHRASE) throw new Error('missing_devnet_x402_specialist_call_approval_phrase');
  const { payTo, mint, amountMicroUnits } = validateDevnetUsdcChallenge(input.challenge, input.config);
  const payer = loadDevnetKeypair(input.config.walletKeypairPath);
  const readiness = await prepareDevnetUsdcPayment({ challenge: input.challenge, config: input.config, client: input.client });
  if (!readiness.ready) throw new Error(`devnet_usdc_payment_not_ready:${readiness.reasons.join(',')}`);
  const destinationTokenAccount = readiness.destinationTokenAccount ?? await input.client.getOrCreateDestinationTokenAccount(payTo, mint);
  const result = await input.client.submitUsdcTransfer({ payer, payTo, mint, amountMicroUnits, destinationTokenAccount, challenge: input.challenge });
  return {
    network: DEVNET_NETWORK,
    payTo: input.challenge.payTo,
    amount: input.challenge.amount,
    currency: 'USDC',
    nonce: input.challenge.nonce,
    signature: result.signature,
    txSignature: result.signature,
    payer: payer.publicKey.toBase58(),
    mint: mint.toBase58(),
    destinationTokenAccount: result.destinationTokenAccount,
  };
}

export function createSolanaDevnetUsdcPaymentClient(connection: Connection): DevnetUsdcPaymentClient {
  return {
    async getSolBalanceLamports(publicKey: PublicKey): Promise<number> {
      return connection.getBalance(publicKey, 'confirmed');
    },

    async getUsdcBalanceMicroUnits(owner: PublicKey, mint: PublicKey): Promise<bigint> {
      const tokenAccount = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      const accountInfo = await connection.getAccountInfo(tokenAccount, 'confirmed');
      if (!accountInfo) return 0n;
      const balance = await connection.getTokenAccountBalance(tokenAccount, 'confirmed');
      return BigInt(balance.value.amount);
    },

    async getOrCreateDestinationTokenAccount(payTo: PublicKey, mint: PublicKey): Promise<string> {
      return getAssociatedTokenAddressSync(mint, payTo, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID).toBase58();
    },

    async submitUsdcTransfer(input): Promise<DevnetUsdcTransferResult> {
      const sourceTokenAccount = getAssociatedTokenAddressSync(input.mint, input.payer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      const destinationTokenAccount = new PublicKey(input.destinationTokenAccount);
      const tx = new Transaction();
      const destinationInfo = await connection.getAccountInfo(destinationTokenAccount, 'confirmed');
      if (!destinationInfo) {
        tx.add(createAssociatedTokenAccountInstruction(
          input.payer.publicKey,
          destinationTokenAccount,
          input.payTo,
          input.mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ));
      }
      tx.add(createTransferCheckedInstruction(
        sourceTokenAccount,
        input.mint,
        destinationTokenAccount,
        input.payer.publicKey,
        input.amountMicroUnits,
        6,
        [],
        TOKEN_PROGRAM_ID,
      ));
      const signature = await sendAndConfirmTransaction(connection, tx, [input.payer], { commitment: 'confirmed' });
      return { signature, destinationTokenAccount: destinationTokenAccount.toBase58() };
    },
  };
}

export function challengeFromX402RequestHeader(header: string): X402Challenge {
  const parsed = JSON.parse(header);
  return buildX402Challenge({
    version: typeof parsed.version === 'string' ? parsed.version : '1',
    network: parsed.network,
    payTo: typeof parsed.payTo === 'string' ? parsed.payTo : parsed.paymentAddress,
    amount: parsed.amount,
    currency: parsed.currency,
    endpoint: parsed.endpoint,
    nonce: parsed.nonce,
    memo: typeof parsed.memo === 'string' ? parsed.memo : undefined,
  });
}

/**
 * The proof headers for presenting a devnet USDC receipt with `body`, signed by
 * the same wallet file that paid. Send them with `x402-payment` on the paid retry.
 */
export async function devnetUsdcPaymentProofHeaders(input: { receipt: X402PaymentReceipt; body: Uint8Array | string; walletKeypairPath: string }): Promise<Record<string, string>> {
  const payer = loadDevnetKeypair(input.walletKeypairPath);
  const txSignature = input.receipt.signature ?? input.receipt.txSignature;
  if (!txSignature) throw new Error('devnet_receipt_signature_missing');
  if (input.receipt.payer !== payer.publicKey.toBase58()) throw new Error('devnet_receipt_payer_is_not_this_wallet');
  return directPaymentProofHeaders({ network: input.receipt.network, txSignature, payTo: input.receipt.payTo, body: input.body, sign: keypairSigner(payer) });
}
