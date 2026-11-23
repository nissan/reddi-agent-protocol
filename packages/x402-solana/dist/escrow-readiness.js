"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESCROW_DEVNET_MINTS = exports.ESCROW_MAINNET_MINTS = exports.TREASURY_MIN_LAMPORTS = exports.SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS = void 0;
exports.solPayoutWouldFail = solPayoutWouldFail;
exports.minimumSolPayout = minimumSolPayout;
exports.seedAddress = seedAddress;
exports.freshRefundSeed = freshRefundSeed;
exports.prepareTokenPayout = prepareTokenPayout;
exports.checkTokenAccount = checkTokenAccount;
exports.checkTreasuryReadiness = checkTreasuryReadiness;
exports.token2022MintPosture = token2022MintPosture;
exports.mintPostureChanges = mintPostureChanges;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const rating_1 = require("./rating");
const token_escrow_1 = require("./token-escrow");
/**
 * Launch and payout checks for the V1 escrow program. These guard against
 * payouts that the program would accept but the runtime would refuse: a SOL
 * transfer that leaves the receiver below the rent-exempt minimum, and a token
 * payout to a treasury or refund token account that does not exist yet.
 */
/** Rent-exempt minimum of a plain system account (0 bytes of data). */
exports.SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS = 890880n;
/** The treasury holds at least this much SOL before the first SOL payout, so a small fee never fails on rent. */
exports.TREASURY_MIN_LAMPORTS = 1000000n;
/**
 * True when sending `incomingLamports` to an account holding `currentLamports`
 * would leave it above zero but below the rent-exempt minimum, which the
 * runtime refuses (InsufficientFundsForRent). A zero transfer never fails.
 */
function solPayoutWouldFail(currentLamports, incomingLamports, rentExemptLamports = exports.SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS) {
    if (incomingLamports <= 0n)
        return false;
    return currentLamports + incomingLamports < rentExemptLamports;
}
/**
 * The smallest payout a payee holding `currentLamports` can receive. Zero when
 * the payee is already rent-exempt.
 */
function minimumSolPayout(currentLamports, rentExemptLamports = exports.SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS) {
    return currentLamports >= rentExemptLamports ? 0n : rentExemptLamports - currentLamports;
}
/** `PublicKey.createWithSeed`, synchronously: sha256(base || seed || owner program). */
function seedAddress(base, seed, program) {
    const seedBytes = new TextEncoder().encode(seed);
    if (seedBytes.length > 32)
        throw new Error('a seed is at most 32 bytes');
    return new web3_js_1.PublicKey((0, rating_1.sha256)(Buffer.concat([base.toBuffer(), Buffer.from(seedBytes), program.toBuffer()])));
}
/** The seed of the refund account a settle creates for one lock: the escrow and its lock slot, so a later lock at the same address gets another. */
function freshRefundSeed(escrow, createdSlot) {
    return `rf${createdSlot.toString(36)}${escrow.toBase58()}`.slice(0, 32);
}
/**
 * The accounts a token payout names next to the escrow's own: the treasury's
 * associated token account for the mint, and the account the unused part
 * returns to. Nothing is created unless the options ask for it; a create is
 * idempotent, `funder` pays its rent and must sign the transaction.
 */
function prepareTokenPayout(t, funder, treasury = token_escrow_1.ESCROW_PROTOCOL_TREASURY, options = {}) {
    if (!t.tokenProgram.equals(spl_token_1.TOKEN_PROGRAM_ID) && !t.tokenProgram.equals(spl_token_1.TOKEN_2022_PROGRAM_ID)) {
        throw new Error('token program must be classic SPL Token or Token-2022');
    }
    const treasuryToken = (0, token_escrow_1.treasuryTokenAccount)(t, treasury);
    const payerToken = (0, spl_token_1.getAssociatedTokenAddressSync)(t.mint, t.payer, true, t.tokenProgram);
    if (options.createRefundAccount && options.freshRefundAccount)
        throw new Error('create the associated account or a fresh one, not both');
    if (options.createRefundAccount && options.refundTo && !options.refundTo.equals(payerToken)) {
        throw new Error("only the payer's associated token account can be created here");
    }
    const instructions = [];
    if (options.createTreasuryAccount)
        instructions.push((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(funder, treasuryToken, treasury, t.mint, t.tokenProgram));
    if (options.createRefundAccount)
        instructions.push((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(funder, payerToken, t.payer, t.mint, t.tokenProgram));
    if (options.freshRefundAccount) {
        const fresh = options.freshRefundAccount;
        const account = seedAddress(funder, fresh.seed, t.tokenProgram);
        if (options.refundTo && !options.refundTo.equals(account))
            throw new Error('refundTo must be the fresh account');
        instructions.push(web3_js_1.SystemProgram.createAccountWithSeed({ fromPubkey: funder, basePubkey: funder, seed: fresh.seed, newAccountPubkey: account, lamports: Number(fresh.lamports), space: fresh.space, programId: t.tokenProgram }), (0, spl_token_1.createInitializeAccount3Instruction)(account, t.mint, t.payer, t.tokenProgram));
        return { treasuryToken, refundTo: account, instructions };
    }
    return { treasuryToken, refundTo: options.refundTo ?? payerToken, instructions };
}
/**
 * Whether a token account can receive a transfer of `mint` right now: it
 * exists under the mint's token program, is initialised and not frozen, holds
 * the mint, belongs to `owner` when one is named, and does not require a memo
 * on incoming transfers (the escrow program sends none). Reads the whole
 * account, not only its first fields.
 */
function checkTokenAccount(address, account, expected) {
    if (!account)
        return { ok: false, problem: 'missing', detail: 'missing' };
    if (!account.owner.equals(expected.tokenProgram)) {
        return { ok: false, problem: 'wrong_program', detail: `owned by ${account.owner.toBase58()}, expected ${expected.tokenProgram.toBase58()}` };
    }
    let token;
    try {
        token = (0, spl_token_1.unpackAccount)(address, { data: Buffer.from(account.data), owner: account.owner, lamports: 0, executable: false }, expected.tokenProgram);
    }
    catch {
        return { ok: false, problem: 'not_token_account', detail: 'not a token account' };
    }
    if (!token.isInitialized)
        return { ok: false, problem: 'uninitialised', detail: 'not initialised' };
    if (!token.mint.equals(expected.mint))
        return { ok: false, problem: 'wrong_mint', detail: `holds mint ${token.mint.toBase58()}` };
    if (expected.owner && !token.owner.equals(expected.owner))
        return { ok: false, problem: 'wrong_owner', detail: `owned by ${token.owner.toBase58()}` };
    if (token.isFrozen)
        return { ok: false, problem: 'frozen', detail: 'frozen by the issuer' };
    if ((0, spl_token_1.getMemoTransfer)(token)?.requireIncomingTransferMemos)
        return { ok: false, problem: 'memo_required', detail: 'requires a memo on incoming transfers' };
    return { ok: true, amount: token.amount };
}
/** The mainnet allowlist of the V1 escrow program (programs/pinocchio-escrow/program/src/consts.rs). */
exports.ESCROW_MAINNET_MINTS = Object.freeze([
    { symbol: 'USDC', mint: new web3_js_1.PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), tokenProgram: spl_token_1.TOKEN_PROGRAM_ID },
    { symbol: 'AUDD', mint: new web3_js_1.PublicKey('AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw'), tokenProgram: spl_token_1.TOKEN_PROGRAM_ID },
    { symbol: 'PYUSD', mint: new web3_js_1.PublicKey('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo'), tokenProgram: spl_token_1.TOKEN_2022_PROGRAM_ID },
    { symbol: 'USDG', mint: new web3_js_1.PublicKey('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH'), tokenProgram: spl_token_1.TOKEN_2022_PROGRAM_ID },
]);
/** The devnet build's extra mint (devnet USDC). */
exports.ESCROW_DEVNET_MINTS = Object.freeze([
    { symbol: 'USDC (devnet)', mint: new web3_js_1.PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'), tokenProgram: spl_token_1.TOKEN_PROGRAM_ID },
]);
/**
 * Read-only check that the treasury can receive every payout: enough SOL for a
 * small fee to land, and for each mint a token account under the mint's token
 * program that the treasury owns, initialised, not frozen and not requiring a
 * memo. Nothing is sent.
 */
async function checkTreasuryReadiness(lookup, mints = exports.ESCROW_MAINNET_MINTS, treasury = token_escrow_1.ESCROW_PROTOCOL_TREASURY) {
    const items = [];
    const sol = await lookup(treasury);
    const lamports = BigInt(sol?.lamports ?? 0);
    items.push({
        name: 'Treasury SOL balance',
        address: treasury.toBase58(),
        ok: lamports >= exports.TREASURY_MIN_LAMPORTS,
        detail: `${lamports} lamports held, at least ${exports.TREASURY_MIN_LAMPORTS} needed`,
    });
    for (const m of mints) {
        const ata = (0, spl_token_1.getAssociatedTokenAddressSync)(m.mint, treasury, true, m.tokenProgram);
        const account = await lookup(ata);
        const check = checkTokenAccount(ata, account, { mint: m.mint, tokenProgram: m.tokenProgram, owner: treasury });
        const ok = check.ok;
        const detail = check.ok
            ? 'exists, initialised and not frozen'
            : check.problem === 'missing'
                ? 'missing: create the associated token account before the first payout in this mint'
                : check.problem === 'wrong_owner'
                    ? `${check.detail}, not the treasury`
                    : check.detail;
        items.push({ name: `Treasury ${m.symbol} token account`, address: ata.toBase58(), ok, detail });
    }
    return { ok: items.every((i) => i.ok), items };
}
const addressOrNull = (key) => (key && !key.equals(web3_js_1.PublicKey.default) ? key.toBase58() : null);
/** Reads the posture from a Token-2022 mint account's raw data. */
function token2022MintPosture(data, address = web3_js_1.PublicKey.default) {
    const mint = (0, spl_token_1.unpackMint)(address, { data: Buffer.from(data), owner: spl_token_1.TOKEN_2022_PROGRAM_ID, lamports: 0, executable: false }, spl_token_1.TOKEN_2022_PROGRAM_ID);
    const fee = (0, spl_token_1.getTransferFeeConfig)(mint);
    const pausable = (0, spl_token_1.getPausableConfig)(mint);
    return {
        extensionTypes: (0, spl_token_1.getExtensionTypes)(mint.tlvData).map(Number).sort((a, b) => a - b),
        transferHookProgram: addressOrNull((0, spl_token_1.getTransferHook)(mint)?.programId),
        transferFee: fee
            ? {
                olderBps: fee.olderTransferFee.transferFeeBasisPoints,
                newerBps: fee.newerTransferFee.transferFeeBasisPoints,
                newerEpoch: fee.newerTransferFee.epoch.toString(),
                newerMaximumFee: fee.newerTransferFee.maximumFee.toString(),
            }
            : null,
        permanentDelegate: addressOrNull((0, spl_token_1.getPermanentDelegate)(mint)?.delegate),
        freezeAuthority: addressOrNull(mint.freezeAuthority),
        mintCloseAuthority: addressOrNull((0, spl_token_1.getMintCloseAuthority)(mint)?.closeAuthority),
        pausable: pausable ? { authority: addressOrNull(pausable.authority), paused: Boolean(pausable.paused) } : null,
    };
}
/** Each field that differs from the recorded posture, as "field: before -> after". Empty when nothing changed. */
function mintPostureChanges(recorded, current) {
    const changes = [];
    for (const key of Object.keys(recorded)) {
        const before = JSON.stringify(recorded[key]);
        const after = JSON.stringify(current[key]);
        if (before !== after)
            changes.push(`${key}: ${before} -> ${after}`);
    }
    return changes;
}
