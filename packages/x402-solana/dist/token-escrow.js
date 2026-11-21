"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESCROW_PROTOCOL_TREASURY = exports.TOKEN_ESCROW_DISCRIMINATORS = void 0;
exports.treasuryTokenAccount = treasuryTokenAccount;
exports.tokenEscrowAddresses = tokenEscrowAddresses;
exports.buildLockTokenEscrowInstruction = buildLockTokenEscrowInstruction;
exports.buildSettleTokenEscrowInstruction = buildSettleTokenEscrowInstruction;
exports.decodeTokenEscrowAccount = decodeTokenEscrowAccount;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
/**
 * Anchor discriminators: the first 8 bytes of sha256("<kind>:<name>"). Fixed
 * here rather than hashed at runtime so this module also loads in a browser
 * bundle, where `node:crypto` is not available. A test recomputes each one.
 */
exports.TOKEN_ESCROW_DISCRIMINATORS = Object.freeze({
    'global:lock_token_escrow': [206, 229, 150, 243, 193, 67, 46, 76],
    'global:lock_metered_token_escrow': [255, 200, 147, 208, 111, 112, 137, 160],
    'global:cancel_token_escrow': [208, 16, 138, 187, 26, 94, 168, 29],
    'global:release_token_escrow': [29, 158, 153, 156, 235, 117, 59, 61],
    'global:settle_token_escrow': [219, 152, 168, 185, 213, 166, 162, 209],
    'account:TokenEscrowAccount': [95, 163, 251, 252, 52, 125, 37, 71],
});
const disc = (kind, name) => {
    const bytes = exports.TOKEN_ESCROW_DISCRIMINATORS[`${kind}:${name}`];
    if (!bytes)
        throw new Error(`unknown discriminator ${kind}:${name}`);
    return Buffer.from(bytes);
};
/** Protocol fee treasury fixed in the escrow program: the Squads vault. */
exports.ESCROW_PROTOCOL_TREASURY = new web3_js_1.PublicKey('5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe');
/** The treasury's associated token account for the escrow mint, which receives token fees. */
function treasuryTokenAccount(t, treasury = exports.ESCROW_PROTOCOL_TREASURY) {
    return (0, spl_token_1.getAssociatedTokenAddressSync)(t.mint, treasury, true, t.tokenProgram);
}
function tokenEscrowAddresses(t) {
    if (t.nonce.length !== 16)
        throw new Error('nonce must be 16 bytes');
    const [escrow, bump] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('token-escrow'), t.payer.toBuffer(), t.nonce], t.programId);
    const [vault] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('token-vault'), escrow.toBuffer()], t.programId);
    return { escrow, vault, bump };
}
const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
function buildLockTokenEscrowInstruction(t) {
    // The on-chain allowlist decides which mint goes with which program; this only rejects any third program.
    if (!t.tokenProgram.equals(spl_token_1.TOKEN_PROGRAM_ID) && !t.tokenProgram.equals(spl_token_1.TOKEN_2022_PROGRAM_ID))
        throw new Error('token program must be classic SPL Token or Token-2022');
    if (t.amount <= 0n || t.amount > 0xffffffffffffffffn)
        throw new Error('amount must be a positive u64');
    if (t.mint.equals(spl_token_1.NATIVE_MINT))
        throw new Error('native mint unsupported');
    const { escrow, vault } = tokenEscrowAddresses(t);
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(t.amount);
    return new web3_js_1.TransactionInstruction({ programId: t.programId,
        data: Buffer.concat([disc('global', t.metered ? 'lock_metered_token_escrow' : 'lock_token_escrow'), amount, Buffer.from(t.nonce)]),
        keys: [meta(escrow, true), meta(vault, true), meta(t.payer, true, true), meta(t.payee), meta(t.mint),
            meta(t.source, true), meta(t.recipient), meta(t.tokenProgram), meta(web3_js_1.SystemProgram.programId)] });
}
/**
 * Destination is always taken from the original lock terms. `authority` signs and defaults to the payer.
 * Release: the program accepts the payer at any time, or the payee once the claim window has elapsed.
 * Settle (`options.actual`): only the payee, and only on a metered escrow; pass the payee as `authority`.
 * The payer never chooses a smaller amount: it releases in full, or refunds once the cancel window has elapsed.
 * Every payout sends 2.5% of the paid amount to the treasury and the rest of the vault back to the payer.
 * Refund: the program accepts the payee at any time (decline), or the payer once the cancel window has elapsed.
 */
function buildSettleTokenEscrowInstruction(t, refund = false, authority = t.payer, options = {}) {
    buildLockTokenEscrowInstruction(t);
    const { escrow, vault } = tokenEscrowAddresses(t);
    if (refund) {
        if (options.actual !== undefined)
            throw new Error('a refund has no settled amount');
        return new web3_js_1.TransactionInstruction({ programId: t.programId,
            data: disc('global', 'cancel_token_escrow'),
            keys: [meta(escrow, true), meta(vault, true), meta(authority, false, true), meta(t.payer, true), meta(t.mint),
                meta(t.source, true), meta(t.tokenProgram)] });
    }
    let data = disc('global', 'release_token_escrow');
    if (options.actual !== undefined) {
        if (!authority.equals(t.payee))
            throw new Error('only the payee settles: pass the payee as the authority');
        if (options.actual <= 0n || options.actual > t.amount)
            throw new Error('settled amount must be above zero and at most the locked amount');
        const actual = Buffer.alloc(8);
        actual.writeBigUInt64LE(options.actual);
        data = Buffer.concat([disc('global', 'settle_token_escrow'), actual]);
    }
    return new web3_js_1.TransactionInstruction({ programId: t.programId, data,
        keys: [meta(escrow, true), meta(vault, true), meta(authority, false, true), meta(t.payer, true), meta(t.mint),
            meta(t.recipient, true), meta(options.treasuryToken ?? treasuryTokenAccount(t), true), meta(options.refundTo ?? t.source, true),
            meta(t.tokenProgram)] });
}
function decodeTokenEscrowAccount(data) {
    if (data.length !== 203 || !data.subarray(0, 8).equals(disc('account', 'TokenEscrowAccount')))
        throw new Error('invalid token escrow layout');
    return {
        payer: new web3_js_1.PublicKey(data.subarray(8, 40)), payee: new web3_js_1.PublicKey(data.subarray(40, 72)),
        mint: new web3_js_1.PublicKey(data.subarray(72, 104)), source: new web3_js_1.PublicKey(data.subarray(104, 136)),
        recipient: new web3_js_1.PublicKey(data.subarray(136, 168)), amount: data.readBigUInt64LE(168),
        nonce: data.subarray(176, 192), status: data[192], createdSlot: data.readBigUInt64LE(193), bump: data[201],
        metered: data[202] === 1,
    };
}
