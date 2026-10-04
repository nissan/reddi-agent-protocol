export type LegacyAnchorProgramIds = {
  escrow: string;
  registry: string;
  reputation: string;
  attestation: string;
};

export type LegacyAnchorProgramConfig = {
  escrowProgramId: string;
  registryProgramId?: string;
  reputationProgramId?: string;
  attestationProgramId?: string;
};

/**
 * Resolve the stable legacy-Anchor profile contract. Profiles that do not register distinct
 * registry, reputation, or attestation programs intentionally alias those roles to escrow.
 * Supplying a distinct role ID preserves it, including for non-Devnet profiles.
 */
export function resolveLegacyAnchorProgramIds(programs: LegacyAnchorProgramConfig): LegacyAnchorProgramIds {
  return {
    escrow: programs.escrowProgramId,
    registry: programs.registryProgramId ?? programs.escrowProgramId,
    reputation: programs.reputationProgramId ?? programs.escrowProgramId,
    attestation: programs.attestationProgramId ?? programs.escrowProgramId,
  };
}
