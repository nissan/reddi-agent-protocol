"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESCROW_DEVNET_MINTS = exports.ESCROW_MAINNET_MINTS = exports.TREASURY_MIN_LAMPORTS = exports.SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS = void 0;
exports.solPayoutWouldFail = solPayoutWouldFail;
exports.minimumSolPayout = minimumSolPayout;
exports.prepareTokenPayout = prepareTokenPayout;
exports.checkTreasuryReadiness = checkTreasuryReadiness;
exports.token2022MintPosture = token2022MintPosture;
exports.mintPostureChanges = mintPostureChanges;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
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
/**
 * Instructions that make sure a token payout's destinations exist: the
 * treasury's associated token account for the mint, and the payer's, which
 * receives the unused part. Both creates are idempotent, so they cost nothing
 * when the accounts are already there. `funder` pays rent for any account it
 * creates and must sign the transaction; for a settle that is the payee.
 */
function prepareTokenPayout(t, funder, treasury = token_escrow_1.ESCROW_PROTOCOL_TREASURY) {
    if (!t.tokenProgram.equals(spl_token_1.TOKEN_PROGRAM_ID) && !t.tokenProgram.equals(spl_token_1.TOKEN_2022_PROGRAM_ID)) {
        throw new Error('token program must be classic SPL Token or Token-2022');
    }
    const treasuryToken = (0, token_escrow_1.treasuryTokenAccount)(t, treasury);
    const refundTo = (0, spl_token_1.getAssociatedTokenAddressSync)(t.mint, t.payer, true, t.tokenProgram);
    return {
        treasuryToken,
        refundTo,
        instructions: [
            (0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(funder, treasuryToken, treasury, t.mint, t.tokenProgram),
            (0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(funder, refundTo, t.payer, t.mint, t.tokenProgram),
        ],
    };
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
 * small fee to land, and a token account owned by the treasury for each mint,
 * under the mint's token program. Nothing is sent.
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
        let ok = false;
        let detail;
        if (!account) {
            detail = 'missing: create the associated token account before the first payout in this mint';
        }
        else if (!account.owner.equals(m.tokenProgram)) {
            detail = `owned by ${account.owner.toBase58()}, expected ${m.tokenProgram.toBase58()}`;
        }
        else if (account.data.length < 72) {
            detail = 'not a token account';
        }
        else {
            const mint = new web3_js_1.PublicKey(account.data.subarray(0, 32));
            const owner = new web3_js_1.PublicKey(account.data.subarray(32, 64));
            if (!mint.equals(m.mint))
                detail = `holds mint ${mint.toBase58()}`;
            else if (!owner.equals(treasury))
                detail = `owned by ${owner.toBase58()}, not the treasury`;
            else {
                ok = true;
                detail = 'exists';
            }
        }
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
