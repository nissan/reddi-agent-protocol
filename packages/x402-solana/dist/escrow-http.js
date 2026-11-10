"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EscrowPurchaseError = exports.EscrowSeller = exports.escrowRequestHash = void 0;
exports.escrowTerms = escrowTerms;
exports.createEscrowChallenge = createEscrowChallenge;
exports.verifyEscrowLock = verifyEscrowLock;
exports.buyWithEscrow = buyWithEscrow;
const node_crypto_1 = require("node:crypto");
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const token_escrow_1 = require("./token-escrow");
const escrowRequestHash = (body) => (0, node_crypto_1.createHash)('sha256').update(body).digest('hex');
exports.escrowRequestHash = escrowRequestHash;
function escrowTerms(c) {
    if (c.scheme !== 'rap-spl-escrow-v1' || !['solana-local-validator', 'solana-devnet'].includes(c.network))
        throw new Error('unsupported escrow scheme/network');
    if (!/^[0-9a-f]{32}$/.test(c.nonce) || !/^[1-9][0-9]*$/.test(c.amount))
        throw new Error('invalid escrow nonce/amount');
    if (!Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 255)
        throw new Error('invalid mint decimals');
    const t = { tokenProgram: new web3_js_1.PublicKey(c.tokenProgram), programId: new web3_js_1.PublicKey(c.programId), payer: new web3_js_1.PublicKey(c.payer), payee: new web3_js_1.PublicKey(c.payee),
        mint: new web3_js_1.PublicKey(c.mint), source: new web3_js_1.PublicKey(c.source), recipient: new web3_js_1.PublicKey(c.recipient), amount: BigInt(c.amount), nonce: Buffer.from(c.nonce, 'hex') };
    (0, token_escrow_1.buildLockTokenEscrowInstruction)(t); // Validate u64 and native-mint boundary before signing.
    return t;
}
function createEscrowChallenge(input) {
    const c = { ...input, scheme: 'rap-spl-escrow-v1', nonce: (0, node_crypto_1.randomBytes)(16).toString('hex') };
    escrowTerms(c);
    if (!Number.isSafeInteger(c.expiresAt) || c.expiresAt <= Date.now() || !/^[a-f0-9]{64}$/.test(c.requestHash))
        throw new Error('invalid challenge lifetime/request hash');
    return c;
}
/** Read-only verification against a trusted RPC. No caller-supplied state or token identity. */
async function verifyEscrowLock(connection, c, proof) {
    const t = escrowTerms(c);
    if (!Number.isSafeInteger(c.expiresAt) || Date.now() >= c.expiresAt || proof.nonce !== c.nonce || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(proof.lockSignature))
        throw new Error('invalid or expired payment proof');
    if (await connection.getGenesisHash() !== c.genesisHash)
        throw new Error('wrong cluster');
    const tx = await connection.getTransaction(proof.lockSignature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta || tx.meta.err)
        throw new Error('lock transaction missing or failed');
    const ix = (0, token_escrow_1.buildLockTokenEscrowInstruction)(t);
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const found = tx.transaction.message.compiledInstructions.some(i => keys.get(i.programIdIndex)?.equals(t.programId)
        && Buffer.from(i.data).equals(ix.data) && i.accountKeyIndexes.length === ix.keys.length
        && i.accountKeyIndexes.every((k, n) => keys.get(k)?.equals(ix.keys[n].pubkey))
        && tx.transaction.message.isAccountSigner(i.accountKeyIndexes[2]));
    if (!found)
        throw new Error('signature does not prove this lock');
    const { escrow, vault, bump } = (0, token_escrow_1.tokenEscrowAddresses)(t);
    const state = await connection.getAccountInfo(escrow, { commitment: 'finalized', minContextSlot: tx.slot });
    if (!state || !state.owner.equals(t.programId))
        throw new Error('escrow missing or wrong owner');
    const decoded = (0, token_escrow_1.decodeTokenEscrowAccount)(state.data);
    for (const field of ['payer', 'payee', 'mint', 'source', 'recipient']) {
        if (!decoded[field].equals(t[field]))
            throw new Error(`wrong escrow ${field}`);
    }
    if (decoded.amount !== t.amount || !decoded.nonce.equals(Buffer.from(t.nonce)) || decoded.status !== 0 || decoded.bump !== bump || decoded.createdSlot !== BigInt(tx.slot))
        throw new Error('escrow terms mismatch');
    const mintInfo = await connection.getAccountInfo(t.mint, { commitment: 'finalized', minContextSlot: tx.slot });
    if (!mintInfo || (0, spl_token_1.unpackMint)(t.mint, mintInfo, t.tokenProgram).decimals !== c.decimals)
        throw new Error('mint decimals mismatch');
    const info = await connection.getAccountInfo(vault, { commitment: 'finalized', minContextSlot: tx.slot });
    if (!info)
        throw new Error('vault missing');
    const token = (0, spl_token_1.unpackAccount)(vault, info, spl_token_1.TOKEN_PROGRAM_ID);
    if (!token.owner.equals(escrow) || !token.mint.equals(t.mint) || token.amount < t.amount || !token.isInitialized || token.isFrozen)
        throw new Error('vault mismatch');
    return { ...proof, scheme: c.scheme, status: 'locked', escrow: escrow.toBase58(), amount: c.amount, mint: c.mint, requestHash: c.requestHash, slot: tx.slot };
}
/** Single-process replay protection. Use durable atomic storage for multiple sellers/workers. */
class EscrowSeller {
    constructor(connection) {
        this.connection = connection;
        this.pending = new Map();
        this.busy = new Set();
    }
    issue(input) {
        for (const [nonce, c] of this.pending)
            if (c.expiresAt <= Date.now())
                this.pending.delete(nonce);
        if (this.pending.size >= 1000)
            throw new Error('challenge capacity exceeded');
        const c = createEscrowChallenge(input);
        this.pending.set(c.nonce, c);
        return c;
    }
    async accept(endpoint, body, proof) {
        const c = this.pending.get(proof.nonce);
        if (!c || this.busy.has(c.nonce) || c.endpoint !== endpoint || c.requestHash !== (0, exports.escrowRequestHash)(body))
            throw new Error('unknown, replayed or mismatched challenge');
        this.busy.add(c.nonce);
        try {
            const receipt = await verifyEscrowLock(this.connection, c, proof);
            this.pending.delete(c.nonce);
            return receipt;
        }
        finally {
            this.busy.delete(c.nonce);
        }
    }
}
exports.EscrowSeller = EscrowSeller;
/** Recovery context survives a paid retry/transport failure; never auto-pay twice. */
class EscrowPurchaseError extends Error {
    constructor(message, challenge, proof) {
        super(message);
        this.challenge = challenge;
        this.proof = proof;
        this.name = 'EscrowPurchaseError';
    }
}
exports.EscrowPurchaseError = EscrowPurchaseError;
/** At most one approved lock and one retry; transport and signing remain caller-owned. */
async function buyWithEscrow(input) {
    const first = await input.request();
    if (first.status !== 402)
        throw new Error('expected HTTP 402');
    const c = JSON.parse(first.headers.get('x402-request') ?? 'null');
    if (!c || !Number.isSafeInteger(c.expiresAt) || c.endpoint !== input.endpoint || c.requestHash !== (0, exports.escrowRequestHash)(input.body) || c.expiresAt <= Date.now())
        throw new Error('challenge request mismatch');
    escrowTerms(c);
    await input.approve(c); // Caller must pin cluster/program/mint/payer/recipient and a raw-unit spend cap.
    const proof = { nonce: c.nonce, lockSignature: await input.lock(c) };
    try {
        const retry = await input.request(proof);
        if (retry.status !== 200)
            throw new Error(`paid retry failed: ${retry.status}; retain lock proof for recovery`);
        const receipt = JSON.parse(retry.headers.get('x402-receipt') ?? 'null');
        if (!receipt || !Number.isSafeInteger(receipt.slot) || receipt.slot < 0 || receipt.scheme !== c.scheme || receipt.status !== 'locked' || receipt.nonce !== c.nonce
            || receipt.lockSignature !== proof.lockSignature || receipt.amount !== c.amount || receipt.mint !== c.mint
            || receipt.requestHash !== c.requestHash || receipt.escrow !== (0, token_escrow_1.tokenEscrowAddresses)(escrowTerms(c)).escrow.toBase58())
            throw new Error('invalid seller receipt');
        return { result: await retry.json(), receipt };
    }
    catch (error) {
        throw new EscrowPurchaseError(error instanceof Error ? error.message : String(error), c, proof);
    }
}
