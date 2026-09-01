export const SPL_TRANSFER_CHECKED_OBSERVATION_SCHEMA_VERSION = 'reddi.svm-spl-transfer-checked-observation.v1' as const;
export const SPL_TRANSFER_CHECKED_OBSERVER_VERSION = 'reddi.x402-solana.spl-transfer-checked-observer.v1' as const;
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as const;
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EP8pNJGvvnzQ74d7Gkwb' as const;
export const SPL_MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as const;

export type SplTransferCheckedCommitment = 'confirmed' | 'finalized';

export type SplTransferCheckedObservationFailureReason =
  | 'malformed_expected_payment'
  | 'missing_transaction'
  | 'failed_transaction'
  | 'missing_confirmation_metadata'
  | 'wrong_signature'
  | 'no_transfer_checked'
  | 'wrong_token_program'
  | 'wrong_mint'
  | 'wrong_amount'
  | 'wrong_payee'
  | 'wrong_destination'
  | 'wrong_decimals'
  | 'wrong_authority'
  | 'duplicate_matching_transfer'
  | 'missing_memo'
  | 'memo_mismatch'
  | 'replay_detected';

export type SplTransferCheckedExpectedPayment = {
  network: string;
  signature: string;
  mint: string;
  tokenProgram: string;
  payTo: string;
  amountBaseUnits: string;
  destinationTokenAccount?: string;
  authority?: string;
  decimals?: number;
  memo?: string;
  memoRequired?: boolean;
  paymentIntentId?: string;
};

export type SplTransferCheckedObservation = {
  schemaVersion: typeof SPL_TRANSFER_CHECKED_OBSERVATION_SCHEMA_VERSION;
  verifierVersion: typeof SPL_TRANSFER_CHECKED_OBSERVER_VERSION | string;
  network: string;
  signature: string;
  slot: number;
  /** Optional: Solana nodes legitimately report a null blockTime for a confirmed slot. */
  blockTime?: number;
  commitment: SplTransferCheckedCommitment;
  instructionIndex: string;
  innerInstruction: boolean;
  sourceTokenAccount?: string;
  destinationTokenAccount: string;
  destinationOwner: string;
  authority?: string;
  mint: string;
  tokenProgram: string;
  amountBaseUnits: string;
  decimals?: number;
  memo?: string;
  paymentIntentId?: string;
  evidence: {
    source: 'parsed-transaction-fixture' | 'parsed-rpc-transaction';
    grantEligible: false | 'pending_partner_acceptance' | true;
  };
};

export type SplTransferReplayStore = {
  checkAndStore(key: string): boolean | Promise<boolean>;
};

export type VerifySplTransferCheckedObservationInput = {
  parsedTransaction: unknown;
  expected: SplTransferCheckedExpectedPayment;
  commitment: SplTransferCheckedCommitment;
  replayStore?: SplTransferReplayStore;
  evidenceSource?: SplTransferCheckedObservation['evidence']['source'];
  grantEligible?: SplTransferCheckedObservation['evidence']['grantEligible'];
  verifierVersion?: string;
};

export type VerifySplTransferCheckedObservationResult =
  | { ok: true; observation: SplTransferCheckedObservation }
  | {
      ok: false;
      reason: SplTransferCheckedObservationFailureReason;
      message: string;
      expected?: unknown;
      actual?: unknown;
    };

type CollectedInstruction = {
  instruction: Record<string, unknown>;
  instructionIndex: string;
  innerInstruction: boolean;
};

type CandidateMatch = {
  collected: CollectedInstruction;
  info: Record<string, unknown>;
  tokenAmount: Record<string, unknown> | undefined;
  programId: string | undefined;
  sourceTokenAccount?: string;
  destinationTokenAccount?: string;
  authority?: string;
  mint?: string;
  amountBaseUnits?: string;
  decimals?: number;
  ownerStatus: OwnerStatus;
};

type OwnerStatus =
  | { ok: true; owner: string }
  | { ok: false; reason: 'wrong_payee' | 'wrong_mint' | 'wrong_token_program' | 'wrong_destination'; actual?: unknown };

const POSITIVE_BASE_UNITS = /^[1-9]\d*$/;
const MEMO_PROGRAM_IDS = new Set([SPL_MEMO_PROGRAM_ID, 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo']);

export async function verifySplTransferCheckedObservation(
  input: VerifySplTransferCheckedObservationInput,
): Promise<VerifySplTransferCheckedObservationResult> {
  const malformed = validateExpected(input.expected, input.commitment);
  if (malformed) return malformed;

  const parsed = asRecord(input.parsedTransaction);
  if (!parsed) return failure('missing_transaction', 'parsed transaction is required');
  const meta = asRecord(parsed.meta);
  if (!meta) return failure('missing_transaction', 'parsed transaction metadata is required');
  if (meta.err !== null && meta.err !== undefined) {
    return failure('failed_transaction', 'transaction metadata reports failure', null, meta.err);
  }
  if (!Number.isSafeInteger(parsed.slot) || Number(parsed.slot) <= 0) {
    return failure('missing_confirmation_metadata', 'transaction must include a positive slot confirmation metadata value');
  }
  if (parsed.blockTime !== undefined && parsed.blockTime !== null && (!Number.isSafeInteger(parsed.blockTime) || Number(parsed.blockTime) <= 0)) {
    return failure('missing_confirmation_metadata', 'transaction blockTime must be a positive integer when the node reports one', null, parsed.blockTime);
  }
  const signatures = asArray(asRecord(parsed.transaction)?.signatures);
  if (!signatures?.some((signature) => stringValue(signature) === input.expected.signature)) {
    return failure('wrong_signature', 'parsed transaction signatures must include the expected payment signature', input.expected.signature, signatures);
  }

  const instructions = collectInstructions(parsed);
  const transferChecked = instructions.filter((item) => isTransferChecked(item.instruction));
  if (transferChecked.length === 0) return failure('no_transfer_checked', 'transaction contains no parsed SPL TransferChecked instruction');

  const candidates = transferChecked.map((collected) => buildCandidate(parsed, collected, input.expected));
  const matches = candidates.filter((candidate) => candidateMatches(candidate, input.expected));
  if (matches.length === 0) return candidateFailure(candidates, input.expected);
  if (matches.length > 1) {
    return failure('duplicate_matching_transfer', 'transaction contains more than one matching TransferChecked payment', 1, matches.length);
  }

  const memo = extractMemo(instructions, input.expected.memo);
  if (input.expected.memoRequired === true || input.expected.memo !== undefined) {
    if (!input.expected.memo) return failure('malformed_expected_payment', 'memoRequired requires an expected memo value');
    if (!memo.present) return failure('missing_memo', 'expected memo binding is missing', input.expected.memo);
    if (!memo.matched) return failure('memo_mismatch', 'transaction memo does not match the expected payment binding', input.expected.memo, memo.values);
  }

  if (input.replayStore) {
    const replayKey = `spl-transfer-checked:${input.expected.network}:${input.expected.signature}`;
    const accepted = await input.replayStore.checkAndStore(replayKey);
    if (!accepted) return failure('replay_detected', 'payment signature has already been accepted by the replay store', replayKey);
  }

  const match = matches[0];
  const observation: SplTransferCheckedObservation = {
    schemaVersion: SPL_TRANSFER_CHECKED_OBSERVATION_SCHEMA_VERSION,
    verifierVersion: input.verifierVersion ?? SPL_TRANSFER_CHECKED_OBSERVER_VERSION,
    network: input.expected.network,
    signature: input.expected.signature,
    slot: Number(parsed.slot),
    blockTime: typeof parsed.blockTime === 'number' ? Number(parsed.blockTime) : undefined,
    commitment: input.commitment,
    instructionIndex: match.collected.instructionIndex,
    innerInstruction: match.collected.innerInstruction,
    sourceTokenAccount: match.sourceTokenAccount,
    destinationTokenAccount: match.destinationTokenAccount ?? input.expected.destinationTokenAccount ?? '',
    destinationOwner: input.expected.payTo,
    authority: match.authority,
    mint: input.expected.mint,
    tokenProgram: input.expected.tokenProgram,
    amountBaseUnits: input.expected.amountBaseUnits,
    decimals: match.decimals,
    memo: memo.matched ? input.expected.memo : undefined,
    paymentIntentId: input.expected.paymentIntentId,
    evidence: {
      source: input.evidenceSource ?? 'parsed-transaction-fixture',
      grantEligible: input.grantEligible ?? false,
    },
  };
  return { ok: true, observation };
}

function validateExpected(
  expected: SplTransferCheckedExpectedPayment,
  commitment: SplTransferCheckedCommitment,
): VerifySplTransferCheckedObservationResult | undefined {
  if (!expected || typeof expected !== 'object') return failure('malformed_expected_payment', 'expected payment terms are required');
  if (!isNonEmptyString(expected.network)) return failure('malformed_expected_payment', 'expected network is required');
  if (!isNonEmptyString(expected.signature)) return failure('malformed_expected_payment', 'expected signature is required');
  if (!isNonEmptyString(expected.mint)) return failure('malformed_expected_payment', 'expected mint is required');
  if (!isNonEmptyString(expected.tokenProgram)) return failure('malformed_expected_payment', 'expected token program is required');
  if (!isNonEmptyString(expected.payTo)) return failure('malformed_expected_payment', 'expected payee owner is required');
  if (!isNonEmptyString(expected.amountBaseUnits) || !POSITIVE_BASE_UNITS.test(expected.amountBaseUnits)) {
    return failure('malformed_expected_payment', 'expected amount must be a positive integer base-unit string');
  }
  if (expected.destinationTokenAccount !== undefined && !isNonEmptyString(expected.destinationTokenAccount)) {
    return failure('malformed_expected_payment', 'expected destination token account must be non-empty when present');
  }
  if (expected.authority !== undefined && !isNonEmptyString(expected.authority)) {
    return failure('malformed_expected_payment', 'expected authority must be non-empty when present');
  }
  if (expected.decimals !== undefined && (!Number.isSafeInteger(expected.decimals) || expected.decimals < 0)) {
    return failure('malformed_expected_payment', 'expected decimals must be a non-negative safe integer');
  }
  if (expected.memo !== undefined && !isNonEmptyString(expected.memo)) {
    return failure('malformed_expected_payment', 'expected memo must be non-empty when present');
  }
  if (!['confirmed', 'finalized'].includes(String(commitment))) {
    return failure('missing_confirmation_metadata', 'commitment must be confirmed or finalized');
  }
  return undefined;
}

function collectInstructions(parsed: Record<string, unknown>): CollectedInstruction[] {
  const output: CollectedInstruction[] = [];
  const outer = asArray(asRecord(asRecord(parsed.transaction)?.message)?.instructions);
  if (outer) {
    outer.forEach((instruction, index) => {
      if (asRecord(instruction)) output.push({ instruction: instruction as Record<string, unknown>, instructionIndex: String(index), innerInstruction: false });
    });
  }
  const innerGroups = asArray(asRecord(parsed.meta)?.innerInstructions);
  if (innerGroups) {
    innerGroups.forEach((group) => {
      const record = asRecord(group);
      if (!record) return;
      const parentIndex = Number.isSafeInteger(record.index) ? String(record.index) : 'unknown';
      const inner = asArray(record.instructions);
      if (!inner) return;
      inner.forEach((instruction, index) => {
        if (asRecord(instruction)) {
          output.push({ instruction: instruction as Record<string, unknown>, instructionIndex: `${parentIndex}.${index}`, innerInstruction: true });
        }
      });
    });
  }
  return output;
}

function buildCandidate(
  parsed: Record<string, unknown>,
  collected: CollectedInstruction,
  expected: SplTransferCheckedExpectedPayment,
): CandidateMatch {
  const parsedInstruction = asRecord(collected.instruction.parsed);
  const info = asRecord(parsedInstruction?.info) ?? {};
  const tokenAmount = asRecord(info.tokenAmount);
  const destinationTokenAccount = stringValue(info.destination);
  const mint = stringValue(info.mint);
  const amountBaseUnits = stringValue(tokenAmount?.amount) ?? stringValue(info.amount);
  const programId = publicKeyString(collected.instruction.programId);
  const candidate: CandidateMatch = {
    collected,
    info,
    tokenAmount,
    programId,
    sourceTokenAccount: stringValue(info.source),
    destinationTokenAccount,
    authority: stringValue(info.authority),
    mint,
    amountBaseUnits,
    decimals: numberValue(tokenAmount?.decimals),
    ownerStatus: destinationTokenAccount
      ? tokenAccountOwnedBy(parsed, destinationTokenAccount, expected)
      : { ok: false, reason: 'wrong_destination', actual: undefined },
  };
  return candidate;
}

function candidateMatches(candidate: CandidateMatch, expected: SplTransferCheckedExpectedPayment): boolean {
  if (candidate.programId !== expected.tokenProgram) return false;
  if (candidate.mint !== expected.mint) return false;
  if (expected.destinationTokenAccount !== undefined && candidate.destinationTokenAccount !== expected.destinationTokenAccount) return false;
  if (!candidate.ownerStatus.ok) return false;
  if (candidate.amountBaseUnits !== expected.amountBaseUnits) return false;
  if (expected.decimals !== undefined && candidate.decimals !== expected.decimals) return false;
  if (expected.authority !== undefined && candidate.authority !== expected.authority) return false;
  return true;
}

function candidateFailure(candidates: CandidateMatch[], expected: SplTransferCheckedExpectedPayment): VerifySplTransferCheckedObservationResult {
  const withExpectedProgram = candidates.filter((candidate) => candidate.programId === expected.tokenProgram);
  if (withExpectedProgram.length === 0) {
    return failure('wrong_token_program', 'no TransferChecked instruction used the expected token program', expected.tokenProgram, candidates.map((candidate) => candidate.programId));
  }
  const withExpectedMint = withExpectedProgram.filter((candidate) => candidate.mint === expected.mint);
  if (withExpectedMint.length === 0) {
    return failure('wrong_mint', 'no TransferChecked instruction used the expected mint', expected.mint, withExpectedProgram.map((candidate) => candidate.mint));
  }
  const withExpectedDestination = expected.destinationTokenAccount === undefined
    ? withExpectedMint
    : withExpectedMint.filter((candidate) => candidate.destinationTokenAccount === expected.destinationTokenAccount);
  if (withExpectedDestination.length === 0) {
    return failure('wrong_destination', 'no TransferChecked instruction paid the expected destination token account', expected.destinationTokenAccount, withExpectedMint.map((candidate) => candidate.destinationTokenAccount));
  }
  const withExpectedOwner = withExpectedDestination.filter((candidate) => candidate.ownerStatus.ok);
  if (withExpectedOwner.length === 0) {
    const firstOwnerFailure = withExpectedDestination[0]?.ownerStatus;
    if (firstOwnerFailure && !firstOwnerFailure.ok) {
      return failure(firstOwnerFailure.reason, 'destination token account is not owned by the expected payee for the expected mint/program', expected.payTo, firstOwnerFailure.actual);
    }
    return failure('wrong_payee', 'destination token account is not owned by the expected payee for the expected mint/program', expected.payTo);
  }
  const withExpectedAmount = withExpectedOwner.filter((candidate) => candidate.amountBaseUnits === expected.amountBaseUnits);
  if (withExpectedAmount.length === 0) {
    return failure('wrong_amount', 'no TransferChecked instruction used the exact expected base-unit amount', expected.amountBaseUnits, withExpectedOwner.map((candidate) => candidate.amountBaseUnits));
  }
  if (expected.decimals !== undefined && withExpectedAmount.every((candidate) => candidate.decimals !== expected.decimals)) {
    return failure('wrong_decimals', 'no TransferChecked instruction used the expected decimals', expected.decimals, withExpectedAmount.map((candidate) => candidate.decimals));
  }
  if (expected.authority !== undefined && withExpectedAmount.every((candidate) => candidate.authority !== expected.authority)) {
    return failure('wrong_authority', 'no TransferChecked instruction used the expected transfer authority', expected.authority, withExpectedAmount.map((candidate) => candidate.authority));
  }
  return failure('wrong_amount', 'transaction does not contain a TransferChecked instruction satisfying the expected payment terms');
}

function tokenAccountOwnedBy(
  parsed: Record<string, unknown>,
  tokenAccount: string,
  expected: SplTransferCheckedExpectedPayment,
): OwnerStatus {
  const postTokenBalances = asArray(asRecord(parsed.meta)?.postTokenBalances);
  if (!postTokenBalances) return { ok: false, reason: 'wrong_destination', actual: 'missing_post_token_balances' };
  for (const item of postTokenBalances) {
    const balance = asRecord(item);
    if (!balance) continue;
    const balanceAccount = accountKeyAt(parsed, balance.accountIndex);
    if (balanceAccount !== tokenAccount) continue;
    if (balance.owner !== expected.payTo) return { ok: false, reason: 'wrong_payee', actual: balance.owner };
    if (balance.mint !== expected.mint) return { ok: false, reason: 'wrong_mint', actual: balance.mint };
    if (balance.programId !== undefined && balance.programId !== expected.tokenProgram) {
      return { ok: false, reason: 'wrong_token_program', actual: balance.programId };
    }
    return { ok: true, owner: expected.payTo };
  }
  return { ok: false, reason: 'wrong_destination', actual: tokenAccount };
}

function accountKeyAt(parsed: Record<string, unknown>, accountIndex: unknown): string | undefined {
  if (!Number.isSafeInteger(accountIndex)) return undefined;
  const accountKeys = asArray(asRecord(asRecord(parsed.transaction)?.message)?.accountKeys);
  const key = accountKeys?.[Number(accountIndex)];
  return publicKeyString(key);
}

function extractMemo(instructions: CollectedInstruction[], expectedMemo?: string): { present: boolean; matched: boolean; values: string[] } {
  const values: string[] = [];
  for (const { instruction } of instructions) {
    const programId = publicKeyString(instruction.programId);
    const program = stringValue(instruction.program);
    if (!programId || !MEMO_PROGRAM_IDS.has(programId)) {
      if (program !== 'spl-memo') continue;
    }
    const parsed = instruction.parsed;
    if (typeof parsed === 'string') {
      values.push(parsed);
      continue;
    }
    const parsedRecord = asRecord(parsed);
    const info = parsedRecord ? parsedRecord.info : undefined;
    if (typeof info === 'string') values.push(info);
    if (asRecord(info) && typeof asRecord(info)?.memo === 'string') values.push(String(asRecord(info)?.memo));
  }
  return { present: values.length > 0, matched: expectedMemo !== undefined && values.includes(expectedMemo), values };
}

function isTransferChecked(instruction: Record<string, unknown>): boolean {
  const parsed = asRecord(instruction.parsed);
  return parsed?.type === 'transferChecked';
}

function publicKeyString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.pubkey === 'string') return record.pubkey;
  const pubkeyRecord = asRecord(record.pubkey);
  if (pubkeyRecord && typeof pubkeyRecord.toString === 'function') return String(pubkeyRecord.toString());
  if (typeof record.toString === 'function' && record.toString !== Object.prototype.toString) return String(record.toString());
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? Number(value) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function failure(
  reason: SplTransferCheckedObservationFailureReason,
  message: string,
  expected?: unknown,
  actual?: unknown,
): VerifySplTransferCheckedObservationResult {
  return { ok: false, reason, message, expected, actual };
}
