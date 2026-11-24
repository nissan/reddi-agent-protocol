"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUDGET_RESERVE_HEADER = exports.BUDGET_SIGNATURE_HEADER = exports.BUDGET_PAYMENT_HEADER = void 0;
exports.checkPooledBudgetForProvider = checkPooledBudgetForProvider;
exports.checkReserveTransaction = checkReserveTransaction;
exports.spenderSignedReserve = spenderSignedReserve;
exports.budgetRequestMessage = budgetRequestMessage;
exports.budgetRequestHeaders = budgetRequestHeaders;
exports.readBudgetPaymentHeader = readBudgetPaymentHeader;
exports.verifyPooledBudgetRequest = verifyPooledBudgetRequest;
exports.providerReservation = providerReservation;
/**
 * Pooled budget, provider side: what a provider checks before it joins a
 * budget and before it serves a call paid from one (see `./budget` for the
 * accounts and instructions).
 *
 * The flow, for a provider:
 *
 * 1. A call with no payment is answered 402 with a `PooledBudgetOffer`: the
 *    provider's mint, its price, the slice it wants reserved and the judges
 *    it accepts.
 * 2. The agent's spender key builds `reserve` for that slice, signs it as the
 *    second signer and sends the transaction in `x402-budget-reserve`. The
 *    provider reads the budget, checks it (`checkPooledBudgetForProvider`),
 *    checks the transaction is exactly that reserve and nothing else
 *    (`checkReserveTransaction`), then signs it as payee and fee payer and
 *    sends it. It pays the fee and the slice's rent, which come back when the
 *    slice closes.
 * 3. Every call names the budget instance and a call number in `x402-budget`
 *    and carries the spender's signature over the request in
 *    `x402-budget-signature` (`verifyPooledBudgetRequest`). The spender is a
 *    key the agent holds, so it signs each call itself: no session key.
 * 4. Calls are metered against the slice off chain. The provider posts what
 *    it is owed once, when the budget closes or the calls stop, and is paid
 *    after the dispute window (`disputeEnds`) or at once when the payer
 *    waives.
 *
 * V1 rule: a provider joins only a budget locked in the token it prices in.
 * Nothing here swaps.
 *
 * Nothing here signs for the provider or sends. Verification uses Node's
 * crypto through `./ed25519`.
 */
const web3_js_1 = require("@solana/web3.js");
const ed25519_1 = require("./ed25519");
const session_auth_1 = require("./session-auth");
const budget_1 = require("./budget");
exports.BUDGET_PAYMENT_HEADER = 'x402-budget';
exports.BUDGET_SIGNATURE_HEADER = 'x402-budget-signature';
exports.BUDGET_RESERVE_HEADER = 'x402-budget-reserve';
/**
 * Whether this provider may join `budget` with a slice of `slice` base units
 * now. Pure: the caller reads the budget at `confirmed` or better and the
 * current slot.
 */
function checkPooledBudgetForProvider(input) {
    const b = input.budget;
    const refuse = (reason, message) => ({ ok: false, reason, message });
    if (b.createdSlot !== input.createdSlot)
        return refuse('budget_instance_mismatch', 'That budget was closed and opened again since the call was made. Name the budget as it is now.');
    const mintMatches = b.mint === null ? input.mint === null : input.mint !== null && b.mint.equals(input.mint);
    if (!mintMatches)
        return refuse('budget_currency_not_accepted', 'This budget is locked in a token this provider is not paid in. It cannot pay this provider.');
    if (b.closed)
        return refuse('budget_closed', 'This budget is closed and takes no new reservations.');
    if (input.currentSlot + input.minOpenSlotsLeft >= b.openEnds)
        return refuse('budget_closing', 'This budget closes too soon for this provider to join it.');
    if (b.judge !== null && !input.acceptedJudges.some((j) => j.equals(b.judge)))
        return refuse('budget_judge_not_accepted', 'This provider does not accept the judge this budget names.');
    if (b.allowlist.length > 0 && !b.allowlist.some((p) => p.equals(input.payee)))
        return refuse('budget_not_allowlisted', 'This budget is limited to other providers.');
    const cap = b.perProviderCap === 0n ? b.total : b.perProviderCap;
    if (input.slice > cap)
        return refuse('budget_cap_too_small', 'This budget caps each provider below the slice this provider needs.');
    if (input.slice < (0, budget_1.minReservation)(b.total))
        return refuse('budget_cap_too_small', 'The slice is below the least this budget reserves.');
    const delta = input.slice - (input.reservedNow ?? 0n);
    if (delta > b.unreserved)
        return refuse('budget_funds_too_low', 'This budget has too little left unreserved for the slice.');
    if (!input.hasReservation && b.reservations >= budget_1.MAX_BUDGET_RESERVATIONS)
        return refuse('budget_full', 'This budget already has as many providers as it can hold.');
    return { ok: true };
}
/**
 * Checks a reserve the spender signed before the provider signs it: the fee
 * payer is the provider, its only instructions are compute-budget ones and
 * one `reserve` that is exactly the one this provider would build for this
 * budget, payee and payout account, with an amount from `minAmount` to
 * `maxAmount`, and the spender's signature over it is valid. A provider that
 * signs only what passes here pays fees and rent for nothing else.
 */
function checkReserveTransaction(input) {
    const refuse = (message) => ({ ok: false, reason: 'invalid_reserve', message });
    const bytes = (0, ed25519_1.decodeBase64)(input.transactionBase64);
    if (!bytes)
        return refuse('The reserve is not base64.');
    let tx;
    try {
        tx = web3_js_1.Transaction.from(bytes);
    }
    catch {
        return refuse('The reserve is not a legacy transaction.');
    }
    if (!tx.feePayer?.equals(input.payee))
        return refuse('The reserve must name this provider as fee payer.');
    const reserves = tx.instructions.filter((ix) => !ix.programId.equals(web3_js_1.ComputeBudgetProgram.programId));
    if (reserves.length !== 1)
        return refuse('The reserve must hold one reserve instruction and nothing else.');
    const ix = reserves[0];
    if (ix.data.length !== 24)
        return refuse('That instruction is not a reserve.');
    const amount = ix.data.readBigUInt64LE(16);
    const expected = (0, budget_1.reserveInstruction)({ programId: input.programId, budget: input.budget, createdSlot: input.createdSlot, spender: input.spender, payee: input.payee, amount, payoutAccount: input.payoutAccount });
    if (!sameInstruction(ix, expected))
        return refuse('That reserve is not for this budget, provider and payout account.');
    if (amount < input.minAmount || amount > input.maxAmount)
        return refuse('The reserve amount is outside what this provider offered.');
    const signers = tx.signatures.map((s) => s.publicKey.toBase58()).sort();
    const wanted = [input.payee.toBase58(), input.spender.toBase58()].sort();
    if (signers.length !== 2 || signers[0] !== wanted[0] || signers[1] !== wanted[1])
        return refuse('The reserve must be signed by the spender and this provider only.');
    const spenderSig = tx.signatures.find((s) => s.publicKey.equals(input.spender))?.signature;
    if (!spenderSig || !(0, ed25519_1.ed25519Verify)(input.spender, tx.serializeMessage(), spenderSig))
        return refuse('The spender has not signed this reserve.');
    return { ok: true, amount, transaction: tx };
}
function sameInstruction(a, b) {
    return a.programId.equals(b.programId) && Buffer.from(a.data).equals(Buffer.from(b.data)) && a.keys.length === b.keys.length
        && a.keys.every((k, i) => k.pubkey.equals(b.keys[i].pubkey) && k.isSigner === b.keys[i].isSigner && k.isWritable === b.keys[i].isWritable);
}
/** The buyer side of step 2: a reserve signed by the spender, for the provider to check, sign and send. */
async function spenderSignedReserve(input) {
    const payee = new web3_js_1.PublicKey(input.offer.payee);
    const tx = new web3_js_1.Transaction({ feePayer: payee, recentBlockhash: input.recentBlockhash });
    tx.add((0, budget_1.reserveInstruction)({ programId: new web3_js_1.PublicKey(input.offer.programId), budget: input.budget, createdSlot: input.createdSlot, spender: input.spender, payee, amount: input.amount, payoutAccount: new web3_js_1.PublicKey(input.offer.payoutAccount) }));
    const signature = await input.signWithSpender(tx.serializeMessage());
    tx.addSignature(input.spender, Buffer.from(signature));
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}
/**
 * The message the spender signs for one call: the cluster, the action, the
 * budget instance, this provider, the call number and the SHA-256 of the
 * body. Naming the provider stops a call signed for one provider being
 * replayed to another; the call number stops a replay to the same one.
 */
function budgetRequestMessage(input) {
    return `reddi-budget/1 ${input.genesisHash} ${input.action} ${input.budget}@${input.createdSlot} ${input.provider} ${input.sequence} ${input.bodyHash}`;
}
/** The two headers a buyer sends with a budget-paid call. */
async function budgetRequestHeaders(input, signWithSpender) {
    const header = { budget: input.budget.toBase58(), createdSlot: input.createdSlot.toString(), sequence: input.sequence };
    const message = budgetRequestMessage({ genesisHash: input.genesisHash, action: input.action, budget: header.budget, createdSlot: input.createdSlot, provider: input.provider.toBase58(), sequence: input.sequence, bodyHash: (0, session_auth_1.sessionBodyHash)(input.body) });
    const signature = await signWithSpender(new TextEncoder().encode(message));
    return { [exports.BUDGET_PAYMENT_HEADER]: Buffer.from(JSON.stringify(header)).toString('base64'), [exports.BUDGET_SIGNATURE_HEADER]: Buffer.from(signature).toString('base64') };
}
/** Reads `x402-budget`. Undefined when it is absent; an error when it is malformed. */
function readBudgetPaymentHeader(value) {
    if (value === undefined)
        return undefined;
    try {
        const raw = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
        if (typeof raw.budget !== 'string' || typeof raw.createdSlot !== 'string' || !/^\d{1,20}$/.test(raw.createdSlot))
            return { error: 'x402-budget must name a budget and its createdSlot.' };
        if (!Number.isSafeInteger(raw.sequence) || raw.sequence < 0)
            return { error: 'x402-budget must carry a call number.' };
        return { budget: new web3_js_1.PublicKey(raw.budget), createdSlot: BigInt(raw.createdSlot), sequence: raw.sequence };
    }
    catch {
        return { error: 'x402-budget is not base64 JSON.' };
    }
}
/** Checks the spender's signature over one call. `spender` comes from the budget account read on chain, never from the request. */
function verifyPooledBudgetRequest(input) {
    const signature = input.signatureHeader === undefined ? undefined : (0, ed25519_1.decodeBase64)(input.signatureHeader);
    if (!signature || signature.length !== 64)
        return { ok: false, reason: 'budget_signature_invalid', message: 'A budget call needs the spender signature in x402-budget-signature.' };
    const message = budgetRequestMessage({ genesisHash: input.genesisHash, action: input.action, budget: input.budget.toBase58(), createdSlot: input.createdSlot, provider: input.provider.toBase58(), sequence: input.sequence, bodyHash: (0, session_auth_1.sessionBodyHash)(input.body) });
    if (!(0, ed25519_1.ed25519Verify)(input.spender, new TextEncoder().encode(message), signature))
        return { ok: false, reason: 'budget_signature_invalid', message: 'The spender signature does not match this call.' };
    return { ok: true };
}
/** The reservation this provider holds in a budget. */
function providerReservation(budget, payee, programId) {
    return (0, budget_1.reservationAddress)(budget, payee, programId);
}
