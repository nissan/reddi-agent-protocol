import {
  adlUseCases,
  buildAdlLivePayload,
  getAdlUseCase,
} from "@/lib/adl/demo-use-cases";

describe("ADL public demo use cases", () => {
  it("ships at least three agent-to-agent payment use cases", () => {
    expect(adlUseCases).toHaveLength(3);
    expect(adlUseCases.every((useCase) => useCase.steps.length >= 5)).toBe(true);
    expect(adlUseCases.every((useCase) => useCase.price.includes("USDC"))).toBe(true);
  });

  it("covers the required payment flow states for every use case", () => {
    const requiredLabels = [/quote/i, /receipt/i];

    for (const useCase of adlUseCases) {
      const labels = useCase.steps.map((step) => step.label).join(" ");
      expect(labels).toMatch(/discover|scope|find/i);
      for (const required of requiredLabels) {
        expect(labels).toMatch(required);
      }
      expect(labels).toMatch(/attest|verify|release/i);
      expect(useCase.steps.some((step) => step.state === "mocked")).toBe(true);
      expect(JSON.stringify(useCase)).not.toMatch(/private key|mainnet transfer/i);
    }
  });

  it("builds a live endpoint payload without storing secrets or enabling mainnet", () => {
    const useCase = getAdlUseCase("research-brief");
    const payload = buildAdlLivePayload(useCase, "https://agent.example.com/run");

    expect(payload).toMatchObject({
      schemaVersion: "reddi.adl.demo-request.v1",
      mode: "live-user-endpoint",
      agentApiAddress: "https://agent.example.com/run",
      useCaseId: "research-brief",
      guardrails: {
        noMainnet: true,
        noStoredSecrets: true,
        userSuppliedEndpointOnly: true,
        mockModeDefault: true,
      },
    });
    expect(payload.expectedPaymentFlow.map((step) => step.id)).toEqual(
      useCase.steps.map((step) => step.id),
    );
  });
});
