import devnetProfile from "@/config/networks/devnet.json";
import { resolveLegacyAnchorProgramIds } from "@/lib/config/legacy-program-ids";

const DISTINCT_PROGRAM = "So11111111111111111111111111111111111111112";

describe("legacy Anchor program ID provenance", () => {
  it("resolves the committed Devnet profile's four roles through the escrow alias", () => {
    const resolved = resolveLegacyAnchorProgramIds(devnetProfile.programs);
    expect(resolved).toEqual({
      escrow: devnetProfile.programs.escrowProgramId,
      registry: devnetProfile.programs.escrowProgramId,
      reputation: devnetProfile.programs.escrowProgramId,
      attestation: devnetProfile.programs.escrowProgramId,
    });
  });

  it("preserves explicit role IDs instead of applying the Devnet alias to other profile shapes", () => {
    const resolved = resolveLegacyAnchorProgramIds({
      escrowProgramId: devnetProfile.programs.escrowProgramId,
      registryProgramId: DISTINCT_PROGRAM,
      reputationProgramId: DISTINCT_PROGRAM,
      attestationProgramId: DISTINCT_PROGRAM,
    });
    expect(resolved.registry).toBe(DISTINCT_PROGRAM);
    expect(resolved.reputation).toBe(DISTINCT_PROGRAM);
    expect(resolved.attestation).toBe(DISTINCT_PROGRAM);
    expect(resolved).not.toEqual(resolveLegacyAnchorProgramIds(devnetProfile.programs));
  });
});
