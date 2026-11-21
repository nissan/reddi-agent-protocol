import { MAINNET_STABLECOIN_MINTS } from "@redditech/x402-solana/payment";

import { formatJobAmount, jobExplorerTxUrl, jobNetworkLabel, jobStatusLabel, shortAddress } from "@/lib/jobs/job-display";
import { DEVNET_USDC_MINT } from "@/lib/payments/wallet-direct-payment";

const SIG = "5".repeat(88);

describe("job display", () => {
  it("formats SOL with nine decimals and trims trailing zeros", () => {
    expect(formatJobAmount("5000000", "SOL", "solana-devnet")).toBe("0.005 SOL");
    expect(formatJobAmount("1000000000", "SOL", "solana-mainnet")).toBe("1 SOL");
    expect(formatJobAmount("1", "SOL", "solana-mainnet")).toBe("0.000000001 SOL");
  });

  it("formats known stablecoins with six decimals on their own network", () => {
    expect(formatJobAmount("50000", DEVNET_USDC_MINT, "solana-devnet")).toBe("0.05 USDC");
    expect(formatJobAmount("12345678", MAINNET_STABLECOIN_MINTS.USDC, "solana-mainnet")).toBe("12.345678 USDC");
    expect(formatJobAmount("2000000", MAINNET_STABLECOIN_MINTS.AUDD, "solana-mainnet")).toBe("2 AUDD");
  });

  it("keeps large amounts exact", () => {
    expect(formatJobAmount("123456789012345678", MAINNET_STABLECOIN_MINTS.USDC, "solana-mainnet")).toBe("123456789012.345678 USDC");
  });

  it("does not name a currency for a mint it does not know on that network", () => {
    expect(formatJobAmount("50000", MAINNET_STABLECOIN_MINTS.USDC, "solana-devnet")).toMatch(/^50000 base units of /);
    expect(formatJobAmount("50000", DEVNET_USDC_MINT, "solana-mainnet")).toMatch(/^50000 base units of /);
  });

  it("refuses a malformed amount", () => {
    for (const bad of ["", "1.5", "-1", "1e6", "abc"]) expect(formatJobAmount(bad, "SOL", "solana-devnet")).toBe("Amount unavailable");
  });

  it("links the explorer for the job's own network only", () => {
    expect(jobExplorerTxUrl(SIG, "solana-mainnet")).toBe(`https://explorer.solana.com/tx/${SIG}`);
    expect(jobExplorerTxUrl(SIG, "solana-devnet")).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=devnet`);
    expect(jobExplorerTxUrl(SIG, "other")).toBeUndefined();
    expect(jobExplorerTxUrl("x?cluster=evil", "solana-mainnet")).toBeUndefined();
    expect(jobExplorerTxUrl("javascript:alert(1)", "solana-devnet")).toBeUndefined();
  });

  it("labels networks and statuses without inventing a success", () => {
    expect(jobNetworkLabel("solana-mainnet")).toBe("Mainnet");
    expect(jobNetworkLabel("solana-devnet")).toBe("Devnet");
    expect(jobNetworkLabel("x")).toBe("Unknown network");
    expect(jobStatusLabel("delivered")).toBe("Delivered");
    expect(jobStatusLabel("failed")).toBe("Paid, not delivered");
    expect(jobStatusLabel("weird")).toBe("Unknown");
  });

  it("shortens long addresses", () => {
    expect(shortAddress("5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe")).toBe("5CsBuT…3Hxe");
    expect(shortAddress("SOL")).toBe("SOL");
  });
});
