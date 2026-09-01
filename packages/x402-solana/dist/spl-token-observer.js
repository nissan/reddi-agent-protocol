"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPL_MEMO_PROGRAM_ID = exports.TOKEN_2022_PROGRAM_ID = exports.SPL_TOKEN_PROGRAM_ID = exports.SPL_TRANSFER_CHECKED_OBSERVER_VERSION = exports.SPL_TRANSFER_CHECKED_OBSERVATION_SCHEMA_VERSION = void 0;
exports.verifySplTransferCheckedObservation = verifySplTransferCheckedObservation;
exports.SPL_TRANSFER_CHECKED_OBSERVATION_SCHEMA_VERSION = 'reddi.svm-spl-transfer-checked-observation.v1';
exports.SPL_TRANSFER_CHECKED_OBSERVER_VERSION = 'reddi.x402-solana.spl-transfer-checked-observer.v1';
exports.SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
exports.TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EP8pNJGvvnzQ74d7Gkwb';
exports.SPL_MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const POSITIVE_BASE_UNITS = /^[1-9]\d*$/;
const MEMO_PROGRAM_IDS = new Set([exports.SPL_MEMO_PROGRAM_ID, 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo']);
async function verifySplTransferCheckedObservation(input) {
    const malformed = validateExpected(input.expected, input.commitment);
    if (malformed)
        return malformed;
    const parsed = asRecord(input.parsedTransaction);
    if (!parsed)
        return failure('missing_transaction', 'parsed transaction is required');
    const meta = asRecord(parsed.meta);
    if (!meta)
        return failure('missing_transaction', 'parsed transaction metadata is required');
    if (meta.err !== null && meta.err !== undefined) {
        return failure('failed_transaction', 'transaction metadata reports failure', null, meta.err);
    }
    if (!Number.isSafeInteger(parsed.slot) || Number(parsed.slot) <= 0 || !Number.isSafeInteger(parsed.blockTime) || Number(parsed.blockTime) <= 0) {
        return failure('missing_confirmation_metadata', 'transaction must include positive slot and blockTime confirmation metadata');
    }
    const signatures = asArray(asRecord(parsed.transaction)?.signatures);
    if (!signatures?.some((signature) => stringValue(signature) === input.expected.signature)) {
        return failure('wrong_signature', 'parsed transaction signatures must include the expected payment signature', input.expected.signature, signatures);
    }
    const instructions = collectInstructions(parsed);
    const transferChecked = instructions.filter((item) => isTransferChecked(item.instruction));
    if (transferChecked.length === 0)
        return failure('no_transfer_checked', 'transaction contains no parsed SPL TransferChecked instruction');
    const candidates = transferChecked.map((collected) => buildCandidate(parsed, collected, input.expected));
    const matches = candidates.filter((candidate) => candidateMatches(candidate, input.expected));
    if (matches.length === 0)
        return candidateFailure(candidates, input.expected);
    if (matches.length > 1) {
        return failure('duplicate_matching_transfer', 'transaction contains more than one matching TransferChecked payment', 1, matches.length);
    }
    const memo = extractMemo(instructions, input.expected.memo);
    if (input.expected.memoRequired === true || input.expected.memo !== undefined) {
        if (!input.expected.memo)
            return failure('malformed_expected_payment', 'memoRequired requires an expected memo value');
        if (!memo.present)
            return failure('missing_memo', 'expected memo binding is missing', input.expected.memo);
        if (!memo.matched)
            return failure('memo_mismatch', 'transaction memo does not match the expected payment binding', input.expected.memo, memo.values);
    }
    if (input.replayStore) {
        const replayKey = `spl-transfer-checked:${input.expected.network}:${input.expected.signature}`;
        const accepted = await input.replayStore.checkAndStore(replayKey);
        if (!accepted)
            return failure('replay_detected', 'payment signature has already been accepted by the replay store', replayKey);
    }
    const match = matches[0];
    const observation = {
        schemaVersion: exports.SPL_TRANSFER_CHECKED_OBSERVATION_SCHEMA_VERSION,
        verifierVersion: input.verifierVersion ?? exports.SPL_TRANSFER_CHECKED_OBSERVER_VERSION,
        network: input.expected.network,
        signature: input.expected.signature,
        slot: Number(parsed.slot),
        blockTime: Number(parsed.blockTime),
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
function validateExpected(expected, commitment) {
    if (!expected || typeof expected !== 'object')
        return failure('malformed_expected_payment', 'expected payment terms are required');
    if (!isNonEmptyString(expected.network))
        return failure('malformed_expected_payment', 'expected network is required');
    if (!isNonEmptyString(expected.signature))
        return failure('malformed_expected_payment', 'expected signature is required');
    if (!isNonEmptyString(expected.mint))
        return failure('malformed_expected_payment', 'expected mint is required');
    if (!isNonEmptyString(expected.tokenProgram))
        return failure('malformed_expected_payment', 'expected token program is required');
    if (!isNonEmptyString(expected.payTo))
        return failure('malformed_expected_payment', 'expected payee owner is required');
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
function collectInstructions(parsed) {
    const output = [];
    const outer = asArray(asRecord(asRecord(parsed.transaction)?.message)?.instructions);
    if (outer) {
        outer.forEach((instruction, index) => {
            if (asRecord(instruction))
                output.push({ instruction: instruction, instructionIndex: String(index), innerInstruction: false });
        });
    }
    const innerGroups = asArray(asRecord(parsed.meta)?.innerInstructions);
    if (innerGroups) {
        innerGroups.forEach((group) => {
            const record = asRecord(group);
            if (!record)
                return;
            const parentIndex = Number.isSafeInteger(record.index) ? String(record.index) : 'unknown';
            const inner = asArray(record.instructions);
            if (!inner)
                return;
            inner.forEach((instruction, index) => {
                if (asRecord(instruction)) {
                    output.push({ instruction: instruction, instructionIndex: `${parentIndex}.${index}`, innerInstruction: true });
                }
            });
        });
    }
    return output;
}
function buildCandidate(parsed, collected, expected) {
    const parsedInstruction = asRecord(collected.instruction.parsed);
    const info = asRecord(parsedInstruction?.info) ?? {};
    const tokenAmount = asRecord(info.tokenAmount);
    const destinationTokenAccount = stringValue(info.destination);
    const mint = stringValue(info.mint);
    const amountBaseUnits = stringValue(tokenAmount?.amount) ?? stringValue(info.amount);
    const programId = publicKeyString(collected.instruction.programId);
    const candidate = {
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
function candidateMatches(candidate, expected) {
    if (candidate.programId !== expected.tokenProgram)
        return false;
    if (candidate.mint !== expected.mint)
        return false;
    if (expected.destinationTokenAccount !== undefined && candidate.destinationTokenAccount !== expected.destinationTokenAccount)
        return false;
    if (!candidate.ownerStatus.ok)
        return false;
    if (candidate.amountBaseUnits !== expected.amountBaseUnits)
        return false;
    if (expected.decimals !== undefined && candidate.decimals !== expected.decimals)
        return false;
    if (expected.authority !== undefined && candidate.authority !== expected.authority)
        return false;
    return true;
}
function candidateFailure(candidates, expected) {
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
function tokenAccountOwnedBy(parsed, tokenAccount, expected) {
    const postTokenBalances = asArray(asRecord(parsed.meta)?.postTokenBalances);
    if (!postTokenBalances)
        return { ok: false, reason: 'wrong_destination', actual: 'missing_post_token_balances' };
    for (const item of postTokenBalances) {
        const balance = asRecord(item);
        if (!balance)
            continue;
        const balanceAccount = accountKeyAt(parsed, balance.accountIndex);
        if (balanceAccount !== tokenAccount)
            continue;
        if (balance.owner !== expected.payTo)
            return { ok: false, reason: 'wrong_payee', actual: balance.owner };
        if (balance.mint !== expected.mint)
            return { ok: false, reason: 'wrong_mint', actual: balance.mint };
        if (balance.programId !== undefined && balance.programId !== expected.tokenProgram) {
            return { ok: false, reason: 'wrong_token_program', actual: balance.programId };
        }
        return { ok: true, owner: expected.payTo };
    }
    return { ok: false, reason: 'wrong_destination', actual: tokenAccount };
}
function accountKeyAt(parsed, accountIndex) {
    if (!Number.isSafeInteger(accountIndex))
        return undefined;
    const accountKeys = asArray(asRecord(asRecord(parsed.transaction)?.message)?.accountKeys);
    const key = accountKeys?.[Number(accountIndex)];
    return publicKeyString(key);
}
function extractMemo(instructions, expectedMemo) {
    const values = [];
    for (const { instruction } of instructions) {
        const programId = publicKeyString(instruction.programId);
        const program = stringValue(instruction.program);
        if (!programId || !MEMO_PROGRAM_IDS.has(programId)) {
            if (program !== 'spl-memo')
                continue;
        }
        const parsed = instruction.parsed;
        if (typeof parsed === 'string') {
            values.push(parsed);
            continue;
        }
        const parsedRecord = asRecord(parsed);
        const info = parsedRecord ? parsedRecord.info : undefined;
        if (typeof info === 'string')
            values.push(info);
        if (asRecord(info) && typeof asRecord(info)?.memo === 'string')
            values.push(String(asRecord(info)?.memo));
    }
    return { present: values.length > 0, matched: expectedMemo !== undefined && values.includes(expectedMemo), values };
}
function isTransferChecked(instruction) {
    const parsed = asRecord(instruction.parsed);
    return parsed?.type === 'transferChecked';
}
function publicKeyString(value) {
    if (typeof value === 'string')
        return value;
    const record = asRecord(value);
    if (!record)
        return undefined;
    if (typeof record.pubkey === 'string')
        return record.pubkey;
    const pubkeyRecord = asRecord(record.pubkey);
    if (pubkeyRecord && typeof pubkeyRecord.toString === 'function')
        return String(pubkeyRecord.toString());
    if (typeof record.toString === 'function' && record.toString !== Object.prototype.toString)
        return String(record.toString());
    return undefined;
}
function stringValue(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function numberValue(value) {
    return Number.isSafeInteger(value) ? Number(value) : undefined;
}
function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function asArray(value) {
    return Array.isArray(value) ? value : undefined;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function failure(reason, message, expected, actual) {
    return { ok: false, reason, message, expected, actual };
}
