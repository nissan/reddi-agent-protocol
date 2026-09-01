import "server-only";

import { randomBytes } from "crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  ATTESTATION_PROGRAM_ID,
  DEVNET_RPC,
  ESCROW_PROGRAM_ID,
  PROGRAM_TARGET,
  SUBMISSION_BLOCKED,
  SUBMISSION_BLOCKED_REASON,
} from "@/lib/program";
import { buildOnboardingAttestQualityInstruction, onboardingAttestationPda } from "@/lib/onboarding/attestation-instruction";
import { quasarAttestationPda } from "@/lib/quasar/instructions";
import { resolveOnboardingQuasarEscrow } from "@/lib/onboarding/quasar-escrow-binding";

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
  escrowAddress?: string;
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
      ready: true,
      operatorPubkey: keypair.publicKey.toBase58(),
      note: "Operator signer is configured.",
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

export async function submitOnchainOnboardingAttestation(
  input: SubmitOnchainAttestationInput
): Promise<SubmitOnchainAttestationResult> {
  const isQuasar = PROGRAM_TARGET === "quasar";
  if (SUBMISSION_BLOCKED && !isQuasar) {
    throw new Error(SUBMISSION_BLOCKED_REASON);
  }

  const operatorSecret = input.operatorSecretKey || process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY;
  if (!operatorSecret) {
    throw new Error("Missing ONBOARDING_ATTEST_OPERATOR_SECRET_KEY for on-chain attestation.");
  }

  const specialistWallet = new PublicKey(input.walletAddress);
  const consumerWallet = new PublicKey(input.consumerWalletAddress || input.walletAddress);
  const operator = parseOperatorKeypair(operatorSecret);

  const scores: [number, number, number, number, number] = input.scores || [8, 8, 8, 8, 8];
  const jobId = randomBytes(16);

  // Quasar splits escrow/registry/reputation/attestation into four programs: the attestation record
  // is owned by the attestation program and binds to the escrow a lock created. Onboarding never
  // locks one, so this refuses before any instruction, signer, or RPC use until canonical verified
  // lock output is supplied.
  const escrow = isQuasar
    ? resolveOnboardingQuasarEscrow({
        lockRecord: undefined,
        expected: {
          consumer: consumerWallet,
          specialist: specialistWallet,
          escrowProgramId: ESCROW_PROGRAM_ID,
        },
      })
    : undefined;
  const attestProgramId = isQuasar ? ATTESTATION_PROGRAM_ID : ESCROW_PROGRAM_ID;
  const attestPda = isQuasar
    ? quasarAttestationPda(escrow!, ATTESTATION_PROGRAM_ID)
    : onboardingAttestationPda(jobId, ESCROW_PROGRAM_ID);

  const ix = buildOnboardingAttestQualityInstruction({
    target: PROGRAM_TARGET,
    programId: attestProgramId,
    jobId,
    escrow,
    scores,
    consumer: consumerWallet,
    judge: operator.publicKey,
  });

  const conn = new Connection(input.rpcUrl || DEVNET_RPC, "confirmed");
  const { blockhash } = await conn.getLatestBlockhash();

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = operator.publicKey;
  tx.add(ix);
  tx.sign(operator);

  const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction(signature, "confirmed");

  return {
    signature,
    attestationPda: attestPda.toBase58(),
    escrowAddress: escrow?.toBase58(),
    jobIdHex: Buffer.from(jobId).toString("hex"),
    operator: operator.publicKey.toBase58(),
    consumer: consumerWallet.toBase58(),
    specialistWallet: specialistWallet.toBase58(),
  };
}
