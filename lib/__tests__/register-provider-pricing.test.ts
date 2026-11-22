import { perTokenPriceProblem, registryRateLamports, sellsAnswers } from "../register/provider-pricing";

const base = { agentType: "primary", inputPerMillionUsd: "3", outputPerMillionUsd: "15", attestationRate: "0.0005" };

describe("provider pricing on the registration page", () => {
  it("writes no per-call rate on chain for a provider priced per token", () => {
    expect(registryRateLamports(base)).toBe(BigInt(0));
  });

  it("keeps the judging fee as the record's rate for a judge or both", () => {
    expect(registryRateLamports({ ...base, agentType: "attestation" })).toBe(BigInt(500_000));
    expect(registryRateLamports({ ...base, agentType: "both", attestationRate: "0.001" })).toBe(BigInt(1_000_000));
    expect(registryRateLamports({ ...base, agentType: "attestation", attestationRate: "nope" })).toBe(BigInt(0));
  });

  it("asks for a usable price per million tokens from anyone selling answers", () => {
    expect(perTokenPriceProblem(base)).toBeNull();
    expect(perTokenPriceProblem({ ...base, inputPerMillionUsd: "0", outputPerMillionUsd: "0.6" })).toBeNull();
    expect(perTokenPriceProblem({ ...base, inputPerMillionUsd: "0", outputPerMillionUsd: "0" })).toMatch(/Set a price/);
    expect(perTokenPriceProblem({ ...base, inputPerMillionUsd: "1.1234567" })).toMatch(/six decimal places/);
    expect(perTokenPriceProblem({ ...base, outputPerMillionUsd: "" })).toMatch(/US dollars/);
    expect(perTokenPriceProblem({ ...base, agentType: "attestation", inputPerMillionUsd: "" })).toBeNull();
    expect(sellsAnswers("both")).toBe(true);
    expect(sellsAnswers("attestation")).toBe(false);
  });
});
