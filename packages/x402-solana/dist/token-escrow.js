"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenEscrowAddresses = tokenEscrowAddresses;
exports.buildLockTokenEscrowInstruction = buildLockTokenEscrowInstruction;
exports.buildSettleTokenEscrowInstruction = buildSettleTokenEscrowInstruction;
exports.decodeTokenEscrowAccount = decodeTokenEscrowAccount;
const node_crypto_1 = require("node:crypto");
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const disc = (kind, name) => (0, node_crypto_1.createHash)('sha256').update(`${kind}:${name}`).digest().subarray(0, 8);
function tokenEscrowAddresses(t) {
    if (t.nonce.length !== 16)
        throw new Error('nonce must be 16 bytes');
    const [escrow, bump] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('token-escrow'), t.payer.toBuffer(), t.nonce], t.programId);
    const [vault] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('token-vault'), escrow.toBuffer()], t.programId);
    return { escrow, vault, bump };
}
const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
function buildLockTokenEscrowInstruction(t) {
    if (!t.tokenProgram.equals(spl_token_1.TOKEN_PROGRAM_ID))
        throw new Error('classic SPL Token only');
    if (t.amount <= 0n || t.amount > 0xffffffffffffffffn)
        throw new Error('amount must be a positive u64');
    if (t.mint.equals(spl_token_1.NATIVE_MINT))
        throw new Error('native mint unsupported');
    const { escrow, vault } = tokenEscrowAddresses(t);
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(t.amount);
    return new web3_js_1.TransactionInstruction({ programId: t.programId,
        data: Buffer.concat([disc('global', 'lock_token_escrow'), amount, Buffer.from(t.nonce)]),
        keys: [meta(escrow, true), meta(vault, true), meta(t.payer, true, true), meta(t.payee), meta(t.mint),
            meta(t.source, true), meta(t.recipient), meta(spl_token_1.TOKEN_PROGRAM_ID), meta(web3_js_1.SystemProgram.programId)] });
}
/** Destination is always taken from the original lock terms. Only payer can settle. */
function buildSettleTokenEscrowInstruction(t, refund = false) {
    buildLockTokenEscrowInstruction(t);
    const { escrow, vault } = tokenEscrowAddresses(t);
    return new web3_js_1.TransactionInstruction({ programId: t.programId,
        data: disc('global', refund ? 'cancel_token_escrow' : 'release_token_escrow'),
        keys: [meta(escrow, true), meta(vault, true), meta(t.payer, true, true), meta(t.mint),
            meta(refund ? t.source : t.recipient, true), meta(spl_token_1.TOKEN_PROGRAM_ID)] });
}
function decodeTokenEscrowAccount(data) {
    if (data.length !== 202 || !data.subarray(0, 8).equals(disc('account', 'TokenEscrowAccount')))
        throw new Error('invalid token escrow layout');
    return {
        payer: new web3_js_1.PublicKey(data.subarray(8, 40)), payee: new web3_js_1.PublicKey(data.subarray(40, 72)),
        mint: new web3_js_1.PublicKey(data.subarray(72, 104)), source: new web3_js_1.PublicKey(data.subarray(104, 136)),
        recipient: new web3_js_1.PublicKey(data.subarray(136, 168)), amount: data.readBigUInt64LE(168),
        nonce: data.subarray(176, 192), status: data[192], createdSlot: data.readBigUInt64LE(193), bump: data[201],
    };
}
