import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  buyerMintFor,
  DEVNET_USDC_MINT,
  lamportsToSolAmount,
  listingForCurrency,
  paymentNetworkForProfile,
  planWalletDirectPayment,
  receiptHeaderForProvider,
  walletDirectPaymentEnabled,
} from "@/lib/payments/wallet-direct-payment";

const provider = Keypair.generate().publicKey.toBase58();
const other = Keypair.generate().publicKey.toBase58();
const payer = Keypair.generate().publicKey.toBase58();
const SIGNATURE = "5".repeat(88);

function challenge(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: "1",
    network: "solana-devnet",
    payTo: provider,
    amount: "0.002",
    currency: "SOL",
    endpoint: "/v1/chat/completions",
    nonce: "nonce-1",
    ...overrides,
  });
}

const solListing = { walletAddress: provider, perCallUsd: 0.01, perCall: { amount: "0.002", currency: "SOL" } };

describe("wallet direct payment (#738)", () => {
  it("is off unless the build flag is set", () => {
    expect(walletDirectPaymentEnabled(undefined)).toBe(false);
    expect(walletDirectPaymentEnabled("")).toBe(false);
    expect(walletDirectPaymentEnabled("0")).toBe(false);
    expect(walletDirectPaymentEnabled("1")).toBe(true);
    expect(walletDirectPaymentEnabled("true")).toBe(true);
  });

  it("maps profiles to payment networks and gives a local profile none", () => {
    expect(paymentNetworkForProfile("devnet")).toBe("solana-devnet");
    expect(paymentNetworkForProfile("mainnet")).toBe("solana-mainnet-beta");
    expect(paymentNetworkForProfile("local-surfpool")).toBeUndefined();
  });

  it("converts lamports to an exact SOL amount", () => {
    expect(lamportsToSolAmount(2_000_000)).toBe("0.002");
    expect(lamportsToSolAmount("1000000000")).toBe("1");
    expect(lamportsToSolAmount(BigInt(1_500_000_001))).toBe("1.500000001");
    expect(lamportsToSolAmount(0)).toBeUndefined();
    expect(lamportsToSolAmount("abc")).toBeUndefined();
  });

  it("holds a US dollar stablecoin to the USD price and refuses to guess a rate for SOL or AUDD", () => {
    expect(listingForCurrency({ walletAddress: provider, perCallUsd: 0.01 }, "USDC")).toEqual({
      ok: true,
      listing: { payTo: provider, amount: "0.010000", currency: "USDC" },
    });
    expect(listingForCurrency({ walletAddress: provider, perCallUsd: 0.01 }, "SOL")).toMatchObject({ ok: false, reason: "listing_price_missing" });
    expect(listingForCurrency({ walletAddress: provider, perCallUsd: 0.01 }, "AUDD")).toMatchObject({ ok: false, reason: "listing_price_missing" });
    expect(listingForCurrency({ walletAddress: provider, perCallUsd: 0 }, "USDC")).toMatchObject({ ok: false });
  });

  it("resolves buyer mints from configuration, then the network's known mints", () => {
    expect(buyerMintFor("SOL", "solana-devnet")).toBeUndefined();
    expect(buyerMintFor("USDC", "solana-devnet")).toBe(DEVNET_USDC_MINT);
    expect(buyerMintFor("PYUSD", "solana-devnet")).toBeUndefined();
    expect(buyerMintFor("PYUSD", "solana-devnet", { PYUSD: other })).toBe(other);
    expect(buyerMintFor("PYUSD", "solana-mainnet-beta")).toBe("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo");
  });

  it("plans a SOL payment that matches the selected listing", () => {
    const plan = planWalletDirectPayment({ challenge: challenge(), listing: solListing, profile: "devnet", spendCap: "0.002", payer });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.totalBaseUnits).toBe(BigInt(2_000_000));
    expect(plan.instructions).toHaveLength(1);
    expect(plan.instructions[0].programId.equals(SystemProgram.programId)).toBe(true);
    expect(plan.instructions[0].keys[1].pubkey.toBase58()).toBe(provider);
    const receipt = plan.receiptFor(SIGNATURE);
    expect(receipt).toMatchObject({ network: "solana-devnet", payTo: provider, amount: "0.002", currency: "SOL", nonce: "nonce-1", signature: SIGNATURE, payer });
    expect(() => plan.receiptFor("mock_tx_signature_abc")).toThrow();
  });

  it.each([
    ["a different payee", { payTo: other }, {}, "wrong_payee"],
    ["a higher price", { amount: "0.003" }, {}, "price_above_listing"],
    ["another network", { network: "solana-mainnet-beta" }, {}, "wrong_network"],
    ["an unsupported currency", { currency: "EURC" }, {}, "wrong_currency"],
    ["a price above the spend cap", {}, { spendCap: "0.001" }, "above_spend_cap"],
  ])("refuses a challenge with %s before any instruction exists", (_name, challengeOverrides, requestOverrides, reason) => {
    const plan = planWalletDirectPayment({
      challenge: challenge(challengeOverrides),
      listing: solListing,
      profile: "devnet",
      spendCap: "0.002",
      payer,
      ...requestOverrides,
    });
    expect(plan).toMatchObject({ ok: false, reason });
  });

  it("refuses when there is no spend cap, no network, no mint or an unreadable challenge", () => {
    expect(planWalletDirectPayment({ challenge: challenge(), listing: solListing, profile: "devnet", payer })).toMatchObject({ ok: false, reason: "spend_cap_missing" });
    expect(planWalletDirectPayment({ challenge: challenge(), listing: solListing, profile: "local-surfpool", spendCap: "1", payer })).toMatchObject({ ok: false, reason: "network_not_supported" });
    expect(planWalletDirectPayment({ challenge: "{not json", listing: solListing, profile: "devnet", spendCap: "1", payer })).toMatchObject({ ok: false, reason: "invalid_challenge" });
    expect(
      planWalletDirectPayment({ challenge: challenge({ currency: "PYUSD", amount: "0.01" }), listing: solListing, profile: "devnet", maxPerCallUsd: 0.01, payer }),
    ).toMatchObject({ ok: false, reason: "mint_not_configured" });
  });

  it("applies the US dollar limit to a USDC challenge", () => {
    const usdc = { challenge: challenge({ currency: "USDC", amount: "0.01" }), listing: { walletAddress: provider, perCallUsd: 0.01 }, profile: "devnet" as const, payer };
    const ok = planWalletDirectPayment({ ...usdc, maxPerCallUsd: 0.01 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.totalBaseUnits).toBe(BigInt(10_000));
    expect(planWalletDirectPayment({ ...usdc, maxPerCallUsd: 0.005 })).toMatchObject({ ok: false, reason: "above_spend_cap" });
  });

  it("forwards only a receipt that carries a real-looking signature", () => {
    const good = { network: "solana-devnet", payTo: provider, amount: "0.002", currency: "SOL", nonce: "n", signature: SIGNATURE, payer, extra: "dropped" };
    const header = receiptHeaderForProvider(good);
    expect(header.ok).toBe(true);
    if (header.ok) {
      expect(JSON.parse(header.header)).toEqual({ network: "solana-devnet", payTo: provider, amount: "0.002", currency: "SOL", nonce: "n", signature: SIGNATURE, payer });
    }
    expect(receiptHeaderForProvider({ ...good, signature: "mock_tx_signature_abc123" })).toMatchObject({ ok: false, reason: "invalid_receipt" });
    expect(receiptHeaderForProvider({ ...good, signature: "" })).toMatchObject({ ok: false });
    expect(receiptHeaderForProvider({ ...good, demo: true })).toMatchObject({ ok: false });
    expect(receiptHeaderForProvider({ ...good, nonce: undefined })).toMatchObject({ ok: false });
    expect(receiptHeaderForProvider(null)).toMatchObject({ ok: false });
    expect(receiptHeaderForProvider("string")).toMatchObject({ ok: false });
  });
});
