/**
 * How a recorded job is shown to its buyer or provider (#740). Pure helpers:
 * nothing here reads the chain or the database.
 */

import { MAINNET_STABLECOIN_MINTS } from "@redditech/x402-solana/payment";

import { DEVNET_USDC_MINT } from "@/lib/payments/wallet-direct-payment";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/;
const UNITS = /^[0-9]{1,30}$/;

function knownToken(mint: string, network: string): { symbol: string; decimals: number } | undefined {
  if (mint === "SOL") return { symbol: "SOL", decimals: 9 };
  if (network === "solana-mainnet") {
    for (const [symbol, address] of Object.entries(MAINNET_STABLECOIN_MINTS)) {
      if (address === mint) return { symbol, decimals: 6 };
    }
  }
  if (network === "solana-devnet" && mint === DEVNET_USDC_MINT) return { symbol: "USDC", decimals: 6 };
  return undefined;
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * The paid amount in the token's own units, from whole base units. Exact string
 * arithmetic, no floating point. A mint this app does not know is shown in base
 * units with the mint named, never guessed as dollars.
 */
export function formatJobAmount(amountBaseUnits: string, mint: string, network: string): string {
  if (!UNITS.test(amountBaseUnits)) return "Amount unavailable";
  const token = knownToken(mint, network);
  if (!token) return `${amountBaseUnits} base units of ${shortAddress(mint)}`;
  const padded = amountBaseUnits.padStart(token.decimals + 1, "0");
  const whole = padded.slice(0, padded.length - token.decimals).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(padded.length - token.decimals).replace(/0+$/, "");
  return `${fraction ? `${whole}.${fraction}` : whole} ${token.symbol}`;
}

/** Explorer link for the job's own network, whatever network this build of the app points at. */
export function jobExplorerTxUrl(txSignature: string, network: string): string | undefined {
  if (!BASE58.test(txSignature)) return undefined;
  if (network === "solana-mainnet") return `https://explorer.solana.com/tx/${txSignature}`;
  if (network === "solana-devnet") return `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`;
  return undefined;
}

export function jobNetworkLabel(network: string): string {
  if (network === "solana-mainnet") return "Mainnet";
  if (network === "solana-devnet") return "Devnet";
  return "Unknown network";
}

export function jobStatusLabel(status: string): string {
  if (status === "delivered") return "Delivered";
  if (status === "failed") return "Paid, not delivered";
  return "Unknown";
}
