export type QuasarReadModelProjection = {
  listingId: string;
  backing: "metadata_only" | "offchain_preview";
  guardrails: {
    instructionBuilt: false;
    walletSigning: false;
    rpcCall: false;
    programDeploy: false;
    reputationMutated: false;
  };
};

export function projectQuasarReadModel(listingId: string): QuasarReadModelProjection {
  return {
    listingId,
    backing: "metadata_only",
    guardrails: {
      instructionBuilt: false,
      walletSigning: false,
      rpcCall: false,
      programDeploy: false,
      reputationMutated: false,
    },
  };
}
