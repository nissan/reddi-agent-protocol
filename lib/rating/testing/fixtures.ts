/**
 * Rating and attestation account bytes for tests and mocked screenshots, laid
 * out as the program writes them (programs/pinocchio-escrow/README.md,
 * "Account layouts"). Not used by the app at run time.
 */
import { PublicKey } from "@solana/web3.js";
import { ATTESTATION_ACCOUNT_LEN, RATING_ACCOUNT_LEN, RATING_DISCRIMINATORS, RATING_STATES, type AttestationResolution, type RatingState, ATTESTATION_RESOLUTIONS } from "@reddi/x402-solana/rating";

export interface RatingFixture {
  escrow: PublicKey;
  consumer: PublicKey;
  specialist: PublicKey;
  judge?: PublicKey;
  mint?: PublicKey;
  consumerCommitment?: Uint8Array;
  specialistCommitment?: Uint8Array;
  paid?: bigint;
  openedSlot?: bigint;
  settledSlot?: bigint;
  committedSlot?: bigint;
  state: RatingState;
  consumerScore?: number;
  specialistScore?: number;
  accepted?: boolean;
  attested?: boolean;
  bump?: number;
}

export function encodeRatingAccount(fixture: RatingFixture): Uint8Array {
  const data = Buffer.alloc(RATING_ACCOUNT_LEN);
  Buffer.from(RATING_DISCRIMINATORS["account:RatingAccount"]).copy(data, 0);
  fixture.escrow.toBuffer().copy(data, 8);
  fixture.consumer.toBuffer().copy(data, 40);
  fixture.specialist.toBuffer().copy(data, 72);
  fixture.judge?.toBuffer().copy(data, 104);
  fixture.mint?.toBuffer().copy(data, 136);
  if (fixture.consumerCommitment) Buffer.from(fixture.consumerCommitment).copy(data, 168);
  if (fixture.specialistCommitment) Buffer.from(fixture.specialistCommitment).copy(data, 200);
  data.writeBigUInt64LE(fixture.paid ?? 0n, 232);
  data.writeBigUInt64LE(fixture.openedSlot ?? 0n, 240);
  data.writeBigUInt64LE(fixture.settledSlot ?? 0n, 248);
  data.writeBigUInt64LE(fixture.committedSlot ?? 0n, 256);
  data[264] = RATING_STATES.indexOf(fixture.state);
  data[265] = fixture.consumerScore ?? 0;
  data[266] = fixture.specialistScore ?? 0;
  data[267] = fixture.accepted ? 1 : 0;
  data[268] = fixture.attested ? 1 : 0;
  data[269] = fixture.bump ?? 255;
  return Uint8Array.from(data);
}

export function encodeAttestationAccount(fixture: { escrow: PublicKey; judge: PublicKey; consumer: PublicKey; scores: readonly [number, number, number, number, number]; resolution?: AttestationResolution; createdSlot?: bigint; openedSlot?: bigint }): Uint8Array {
  const data = Buffer.alloc(ATTESTATION_ACCOUNT_LEN);
  Buffer.from(RATING_DISCRIMINATORS["account:AttestationAccount"]).copy(data, 0);
  fixture.escrow.toBuffer().copy(data, 8);
  fixture.judge.toBuffer().copy(data, 40);
  fixture.consumer.toBuffer().copy(data, 72);
  Buffer.from(fixture.scores).copy(data, 104);
  data[109] = ATTESTATION_RESOLUTIONS.indexOf(fixture.resolution ?? "pending");
  data.writeBigUInt64LE(fixture.createdSlot ?? 0n, 110);
  data[118] = 255;
  data.writeBigUInt64LE(fixture.openedSlot ?? 0n, 119);
  return Uint8Array.from(data);
}
