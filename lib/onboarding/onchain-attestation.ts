import "server-only";

import { Keypair } from "@solana/web3.js";
import { PROGRAM_TARGET, SUBMISSION_BLOCKED, SUBMISSION_BLOCKED_REASON } from "@/lib/program";
import { QUASAR_ESCROW_UNAVAILABLE_REASON } from "@/lib/onboarding/quasar-escrow-binding";
import { RATING_FLOW_UNAVAILABLE_REASON } from "@/lib/onboarding/rating-flow-availability";

export type SubmitOnchainAttestationInput = {
  walletAddress: string;
  consumerWalletAddress?: string;
  rpcUrl?: string;
  operatorSecretKey?: string;
  scores?: [number, number, number, number, number];
};

export type SubmitOnchainAttestationResult = {
  signature: string;
  attestationPda: string;
  jobIdHex: string;
  operator: string;
  consumer: string;
  specialistWallet: string;
};

export type OnchainAttestationOperatorStatus = {
  ready: boolean;
  operatorPubkey?: string;
  note: string;
};

function parseOperatorKeypair(secret: string): Keypair {
  const trimmed = secret.trim();

  if (!trimmed.startsWith("[")) {
    throw new Error(
      "ONBOARDING_ATTEST_OPERATOR_SECRET_KEY must be a JSON byte array (e.g. [12,34,...])."
    );
  }

  const arr = JSON.parse(trimmed) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

export function getOnchainAttestationOperatorStatus(
  secret = process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY
): OnchainAttestationOperatorStatus {
  if (!secret) {
    return {
      ready: false,
      note: "Missing ONBOARDING_ATTEST_OPERATOR_SECRET_KEY.",
    };
  }

  try {
    const keypair = parseOperatorKeypair(secret);
    return {
      // The key parses, but there is nothing it can submit: see `submitOnchainOnboardingAttestation`.
      ready: false,
      operatorPubkey: keypair.publicKey.toBase58(),
      note: `Operator signer is configured, but not used. ${RATING_FLOW_UNAVAILABLE_REASON}`,
    };
  } catch (error) {
    return {
      ready: false,
      note:
        error instanceof Error
          ? error.message
          : "Invalid ONBOARDING_ATTEST_OPERATOR_SECRET_KEY format.",
    };
  }
}

/**
 * Fails closed. This used to sign `attest_quality` with the operator key for a random job id.
 * The V1 program accepts an attestation only from the judge named on the rating account of a job
 * paid through escrow, so there is nothing this flow could submit; see
 * `rating-flow-availability.ts`. The refusals keep their order: Quasar target, blocked profile,
 * then this one, all before any operator key is read, any instruction is built or any RPC is
 * opened. `buildOnboardingAttestQualityInstruction` has the instruction the app rating flow (#842)
 * will use.
 */
export async function submitOnchainOnboardingAttestation(
  _input: SubmitOnchainAttestationInput
): Promise<SubmitOnchainAttestationResult> {
  if (PROGRAM_TARGET === "quasar") {
    throw new Error(QUASAR_ESCROW_UNAVAILABLE_REASON);
  }
  if (SUBMISSION_BLOCKED) {
    throw new Error(SUBMISSION_BLOCKED_REASON);
  }
  throw new Error(RATING_FLOW_UNAVAILABLE_REASON);
}
