import { JupiterSwapV2Client } from "@redditech/x402-solana";

let client: JupiterSwapV2Client | null = null;

export function getJupiterClient(): JupiterSwapV2Client {
  if (client) {
    return client;
  }

  const apiBaseUrl = process.env.JUPITER_API_BASE?.trim() || "https://api.jup.ag/swap/v2";
  const quoteApiBaseUrl = process.env.JUPITER_QUOTE_API_BASE?.trim() || "https://lite-api.jup.ag/swap/v1";
  client = new JupiterSwapV2Client({
    apiBaseUrl,
    quoteApiBaseUrl,
    apiKey: process.env.JUPITER_API_KEY?.trim(),
  });
  return client;
}

export function getJupiterSlippageBps(): number {
  const parsed = Number.parseInt(process.env.JUPITER_SLIPPAGE_BPS ?? "50", 10);
  return Number.isFinite(parsed) ? parsed : 50;
}
