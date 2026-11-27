"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAUSED_MESSAGE = exports.PAUSE_ERRORS = exports.PAUSE_SLOTS = exports.PAUSE_STATE_LEN = exports.PAUSE_SEED = void 0;
exports.pauseAddress = pauseAddress;
exports.pauseAccountMeta = pauseAccountMeta;
exports.withPauseAccount = withPauseAccount;
exports.decodePauseState = decodePauseState;
exports.readPauseStatus = readPauseStatus;
exports.isPausedError = isPausedError;
/**
 * Emergency pause of the Reddi Agent Protocol program.
 *
 * The program keeps one pause account at `["pause"]`. While the protocol is
 * paused it refuses new money coming in (escrow locks, budget opens,
 * reserves) and payouts to providers (release, claim, settle, and any
 * budget payout or judge's ruling that pays the provider something). Every
 * refund keeps working: cancels, budget closes, disputes, a payout or ruling
 * that pays the provider nothing.
 *
 * The instructions a pause can refuse take the pause account as their LAST
 * account, after any rating, delivery or memo account. `withPauseAccount`
 * appends it. A lock, release, settle, budget open or reserve without it is
 * refused with `PauseAccountRequired` (6102); a budget payout or judge's
 * resolve without it is treated as paused (refund only). Instructions the
 * pause never refuses ignore it, so appending it to every instruction of the
 * program is safe, and so is sending it to a program build that predates
 * the pause (it ignores trailing accounts).
 */
const web3_js_1 = require("@solana/web3.js");
exports.PAUSE_SEED = 'pause';
/** `account:PauseState`, 89 bytes. */
exports.PAUSE_STATE_LEN = 89;
/** About 7 days: how long one pause lasts unless the admin renews it. */
exports.PAUSE_SLOTS = 1512000n;
/** Program error numbers of the pause. */
exports.PAUSE_ERRORS = Object.freeze({
    ProtocolPaused: 6101,
    PauseAccountRequired: 6102,
    NotPauseAuthority: 6103,
    AlreadyPaused: 6104,
    InvalidGuardian: 6105,
});
/** Plain-language text for a refusal because the protocol is paused. */
exports.PAUSED_MESSAGE = 'Reddi Agent Protocol is paused while an issue is checked. New payments and payouts to providers are on hold; refunds and closing a Budget still work.';
function pauseAddress(programId) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from(exports.PAUSE_SEED)], programId)[0];
}
/** The read-only account meta the gated instructions take last. */
function pauseAccountMeta(programId) {
    return { pubkey: pauseAddress(programId), isSigner: false, isWritable: false };
}
/** `ix` with the pause account appended, unless it is already last. */
function withPauseAccount(ix) {
    const pause = pauseAddress(ix.programId);
    const last = ix.keys[ix.keys.length - 1];
    if (last && last.pubkey.equals(pause))
        return ix;
    ix.keys.push({ pubkey: pause, isSigner: false, isWritable: false });
    return ix;
}
/** Decode the pause account's data. Throws on a wrong size. */
function decodePauseState(data) {
    if (data.length < exports.PAUSE_STATE_LEN)
        throw new Error('not a pause account');
    const view = Buffer.from(data);
    return {
        guardian: new web3_js_1.PublicKey(view.subarray(8, 40)),
        pausedUntilSlot: view.readBigUInt64LE(40),
        pausedAtSlot: view.readBigUInt64LE(48),
        lastBy: new web3_js_1.PublicKey(view.subarray(56, 88)),
    };
}
/** Read whether the program is paused now. */
async function readPauseStatus(connection, programId) {
    const [info, slot] = await Promise.all([
        connection.getAccountInfo(pauseAddress(programId), 'confirmed'),
        connection.getSlot('confirmed'),
    ]);
    if (!info || !info.owner.equals(programId)) {
        return { paused: true, missing: true, pausedUntilSlot: 0n, slot: BigInt(slot) };
    }
    const state = decodePauseState(info.data);
    return {
        paused: BigInt(slot) < state.pausedUntilSlot,
        missing: false,
        pausedUntilSlot: state.pausedUntilSlot,
        slot: BigInt(slot),
    };
}
/** Whether `error` (a send/simulate error or its logs) is the program's pause refusal. */
function isPausedError(error) {
    const text = error instanceof Error ? `${error.message} ${String(error.logs ?? '')}` : String(error);
    return /ProtocolPaused|Error Number: 6101|custom program error: 0x17d5\b/.test(text);
}
