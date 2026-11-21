"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MAX_CHARGE_MULTIPLE = exports.DEFAULT_MAX_OUTPUT_TOKENS = void 0;
exports.providerMeteredTerms = providerMeteredTerms;
exports.estimateInputTokens = estimateInputTokens;
exports.outputLimit = outputLimit;
exports.meteredEstimate = meteredEstimate;
exports.meteredOffer = meteredOffer;
exports.readMeteredPaymentHeader = readMeteredPaymentHeader;
exports.meteredPaymentHeaderValue = meteredPaymentHeaderValue;
exports.checkProviderCluster = checkProviderCluster;
exports.verifyMeteredLock = verifyMeteredLock;
exports.usageFrom = usageFrom;
exports.meteredSettlement = meteredSettlement;
exports.meteredDecline = meteredDecline;
/**
 * The seller side of a per-token (metered) call.
 *
 * A buyer locks the most it will pay in a metered token escrow payable to the
 * provider. The provider reads the lock back from the chain, serves the call,
 * counts the tokens the model reports and settles the actual cost. The escrow
 * program pays 2.5% of that to the protocol treasury, the rest to the
 * provider, and returns the unused maximum to the buyer.
 *
 * Nothing here reads a key or sends a transaction. `meteredSettlement` returns
 * instructions; the operator signs and sends them.
 */
const web3_js_1 = require("@solana/web3.js");
const escrow_readiness_1 = require("./escrow-readiness");
const metered_1 = require("./metered");
const payment_1 = require("./payment");
const token_escrow_1 = require("./token-escrow");
/** Output tokens assumed when the request sets no limit and the operator sets none. */
exports.DEFAULT_MAX_OUTPUT_TOKENS = 1000;
/** The buyer's default maximum, as a multiple of the estimate. The buyer may raise it, never below the estimate. */
exports.DEFAULT_MAX_CHARGE_MULTIPLE = 2;
/**
 * A provider's metered terms. Throws when the currency is not a token
 * currency, a price does not parse, or an address is malformed.
 */
function providerMeteredTerms(input) {
    const currency = (0, payment_1.directPaymentCurrency)(input.currency);
    if (!currency)
        throw new Error(`unsupported currency: ${input.currency}`);
    // SOL settles through the SOL escrow, which has no metered seller path here.
    if (!currency.tokenProgram)
        throw new Error(`${input.currency} is not a token currency: metered calls are priced in USDC, AUDD, PYUSD or USDG`);
    const price = { currency: input.currency, inputPerMillion: input.inputPerMillion, outputPerMillion: input.outputPerMillion };
    if ((0, metered_1.tokenCostBaseUnits)(price, { inputTokens: 1000000, outputTokens: 1000000 }) <= BigInt(0))
        throw new Error('a metered price must be above zero');
    const maxOutputTokens = input.maxOutputTokens ?? exports.DEFAULT_MAX_OUTPUT_TOKENS;
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0)
        throw new Error('maxOutputTokens must be a positive whole number');
    return {
        price,
        programId: new web3_js_1.PublicKey(input.programId),
        mint: new web3_js_1.PublicKey(input.mint),
        tokenProgram: new web3_js_1.PublicKey(currency.tokenProgram),
        payee: new web3_js_1.PublicKey(input.payee),
        maxOutputTokens,
    };
}
/** About four characters a token, over every message. */
function estimateInputTokens(messages) {
    return messages.reduce((total, message) => total + Math.ceil((typeof message.content === 'string' ? message.content : '').length / 4), 0);
}
/** Output limit for this call: the request's own, held to the provider's. */
function outputLimit(terms, requested) {
    return requested !== undefined && Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, terms.maxOutputTokens) : terms.maxOutputTokens;
}
/** The estimate a call is quoted on: the input estimate plus the full output limit. */
function meteredEstimate(terms, messages, requestedMaxTokens) {
    return { inputTokens: estimateInputTokens(messages), outputTokens: outputLimit(terms, requestedMaxTokens) };
}
/** What a 402 tells a buyer about metered payment. The buyer's lock must cover `minimumLockBaseUnits`. */
function meteredOffer(terms, messages, requestedMaxTokens, network) {
    const estimate = meteredEstimate(terms, messages, requestedMaxTokens);
    const decimals = (0, payment_1.directPaymentCurrency)(terms.price.currency).decimals;
    const minimum = (0, metered_1.tokenCostBaseUnits)(terms.price, estimate);
    const suggested = minimum * BigInt(exports.DEFAULT_MAX_CHARGE_MULTIPLE);
    const quote = suggested > BigInt(0) ? (0, metered_1.quoteMeteredCall)(terms.price, estimate, (0, payment_1.baseUnitsToDecimal)(suggested, decimals)) : undefined;
    return {
        settlement: 'metered-escrow',
        ...(network ? { network } : {}),
        currency: terms.price.currency,
        inputPerMillion: terms.price.inputPerMillion,
        outputPerMillion: terms.price.outputPerMillion,
        maxOutputTokens: terms.maxOutputTokens,
        estimate,
        estimatedCost: quote?.estimatedCost ?? '0',
        suggestedMaxCharge: quote?.maxCharge ?? '0',
        suggestedMaxChargeBaseUnits: suggested.toString(),
        estimatedFee: quote?.estimatedFee ?? '0',
        minimumLockBaseUnits: minimum.toString(),
        escrowProgramId: terms.programId.toBase58(),
        mint: terms.mint.toBase58(),
        payTo: terms.payee.toBase58(),
        nonce: '32 lowercase hex characters you choose; the escrow is [token-escrow, payer, nonce]',
    };
}
const NONCE_HEX = /^[0-9a-f]{32}$/;
/** The metered receipt a buyer presents, or undefined when the header is not one. */
function readMeteredPaymentHeader(headers) {
    const value = headers.get('x402-payment') ?? headers.get('x-payment');
    if (!value)
        return undefined;
    const parsed = (0, payment_1.parseX402PaymentHeader)(value);
    if (!parsed || typeof parsed !== 'object' || parsed.settlement !== 'metered-escrow')
        return undefined;
    const record = parsed;
    const nonce = typeof record.nonce === 'string' ? record.nonce.replace(/-/g, '').toLowerCase() : '';
    if (!NONCE_HEX.test(nonce))
        return { error: 'A metered payment names the 16-byte escrow nonce as 32 hex characters.' };
    try {
        return { escrow: new web3_js_1.PublicKey(String(record.escrow)), payer: new web3_js_1.PublicKey(String(record.payer)), nonce: Uint8Array.from(Buffer.from(nonce, 'hex')) };
    }
    catch {
        return { error: 'A metered payment must name the payer and the escrow address.' };
    }
}
/** The value a buyer sends in `x402-payment` once its metered lock is confirmed. */
function meteredPaymentHeaderValue(input) {
    if (input.nonce.length !== 16)
        throw new Error('nonce must be 16 bytes');
    const { escrow } = (0, token_escrow_1.tokenEscrowAddresses)({ programId: input.programId, payer: input.payer, nonce: input.nonce });
    return JSON.stringify({ settlement: 'metered-escrow', escrow: escrow.toBase58(), payer: input.payer.toBase58(), nonce: Buffer.from(input.nonce).toString('hex') });
}
/**
 * Confirms the RPC endpoint serves the network the provider is configured
 * for, so a lock on another cluster is never taken as payment. Run it before
 * trusting any account the endpoint returns.
 */
async function checkProviderCluster(readGenesisHash, network, expectedGenesisHash) {
    const publicHash = payment_1.SOLANA_GENESIS_HASHES[network];
    if (!publicHash)
        return { ok: false, reason: 'wrong_cluster', message: `Unknown network ${String(network)}.` };
    // A public cluster's hash cannot be replaced. Only a local validator has its own.
    if (expectedGenesisHash !== undefined && network === 'solana-mainnet-beta' && expectedGenesisHash !== publicHash) {
        return { ok: false, reason: 'wrong_cluster', message: 'The mainnet genesis hash cannot be replaced.' };
    }
    let actual;
    try {
        actual = await readGenesisHash();
    }
    catch {
        return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted.' };
    }
    const expected = expectedGenesisHash ?? publicHash;
    return actual === expected ? { ok: true } : { ok: false, reason: 'wrong_cluster', message: `The RPC endpoint is not ${network}.` };
}
/**
 * Checks the lock on chain against this provider's terms: the escrow program,
 * the address the payer and nonce give, still locked, metered, payable to this
 * provider's token account in the accepted mint, and at least `minimum`.
 * The escrow is then remembered, so one lock pays for one call.
 */
async function verifyMeteredLock(input) {
    const { header, terms } = input;
    const expected = (0, token_escrow_1.tokenEscrowAddresses)({ programId: terms.programId, payer: header.payer, nonce: header.nonce }).escrow;
    if (!expected.equals(header.escrow))
        return { ok: false, reason: 'invalid_receipt', message: 'The escrow address is not the one this payer and nonce give.' };
    let account;
    try {
        account = await input.readAccount(header.escrow);
    }
    catch {
        return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted; present the same receipt again.' };
    }
    if (!account)
        return { ok: false, reason: 'invalid_receipt', message: 'No escrow is locked at that address yet.' };
    if (!account.owner.equals(terms.programId))
        return { ok: false, reason: 'invalid_receipt', message: 'That account is not held by the escrow program.' };
    let escrow;
    try {
        escrow = (0, token_escrow_1.decodeTokenEscrowAccount)(Buffer.from(account.data));
    }
    catch {
        return { ok: false, reason: 'invalid_receipt', message: 'That account is not a token escrow.' };
    }
    if (escrow.status !== 0)
        return { ok: false, reason: 'duplicate_nonce', message: 'This escrow has already been settled or cancelled.' };
    if (!escrow.metered)
        return { ok: false, reason: 'invalid_receipt', message: 'This escrow was not locked as a metered escrow.' };
    // The payer may refund once its window has elapsed, so the settlement has to
    // land before then. The time left now is what counts, not the window named
    // at lock: a buyer could lock, wait out most of the window, then make the
    // call. An escrow that states no window, or a slot that cannot be read, is
    // refused.
    if (escrow.cancelWindowSlots === undefined) {
        return { ok: false, reason: 'invalid_receipt', message: 'This escrow states no refund window. Lock a new one with the current program.' };
    }
    let currentSlot;
    try {
        currentSlot = BigInt(await input.readSlot());
    }
    catch {
        return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted; present the same receipt again.' };
    }
    const elapsed = currentSlot > escrow.createdSlot ? currentSlot - escrow.createdSlot : BigInt(0);
    if (escrow.cancelWindowSlots < elapsed + token_escrow_1.SELLER_MIN_CANCEL_WINDOW_SLOTS) {
        return { ok: false, reason: 'invalid_receipt', message: "This escrow's refund window has less than 10 minutes left. Lock a new one with a longer refund window, then make the call straight away." };
    }
    if (!escrow.payer.equals(header.payer))
        return { ok: false, reason: 'invalid_receipt', message: 'The escrow was locked by a different wallet.' };
    if (!escrow.payee.equals(terms.payee))
        return { ok: false, reason: 'wrong_payee', message: 'The escrow pays a different provider.' };
    if (!escrow.mint.equals(terms.mint))
        return { ok: false, reason: 'wrong_currency', message: `The escrow holds a different mint than this provider's ${terms.price.currency}.` };
    // The provider's associated token account for the mint (the helper derives any owner's).
    if (!escrow.recipient.equals((0, token_escrow_1.treasuryTokenAccount)({ mint: terms.mint, tokenProgram: terms.tokenProgram }, terms.payee))) {
        return { ok: false, reason: 'wrong_payee', message: 'The escrow pays a token account this provider does not use.' };
    }
    if (escrow.amount < input.minimum) {
        return { ok: false, reason: 'wrong_amount', message: `The locked maximum is below this request's estimate of ${input.minimum.toString()} base units.` };
    }
    if (!(await input.replayStore.checkAndStore(`metered-escrow:${header.escrow.toBase58()}`))) {
        return { ok: false, reason: 'duplicate_nonce', message: 'This escrow has already paid for a call.' };
    }
    return {
        ok: true,
        payer: escrow.payer,
        maxBaseUnits: escrow.amount,
        terms: {
            programId: terms.programId,
            tokenProgram: terms.tokenProgram,
            payer: escrow.payer,
            payee: escrow.payee,
            mint: escrow.mint,
            source: escrow.source,
            recipient: escrow.recipient,
            amount: escrow.amount,
            nonce: Uint8Array.from(escrow.nonce),
            metered: true,
            ...(escrow.claimWindowSlots !== undefined && escrow.cancelWindowSlots !== undefined
                ? { claimWindowSlots: escrow.claimWindowSlots, cancelWindowSlots: escrow.cancelWindowSlots }
                : {}),
        },
    };
}
/** Token counts from an OpenAI-style usage report, or the estimate from the text when it reports none. */
function usageFrom(upstream, inputEstimate) {
    const usage = upstream.usage;
    const whole = (value) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined);
    const input = whole(usage?.prompt_tokens);
    const output = whole(usage?.completion_tokens);
    if (input !== undefined && output !== undefined)
        return { inputTokens: input, outputTokens: output };
    const choices = upstream.choices;
    const text = typeof choices?.[0]?.message?.content === 'string' ? choices[0].message.content : '';
    return { inputTokens: input ?? inputEstimate, outputTokens: output ?? Math.ceil(text.length / 4) };
}
/**
 * The settle for the tokens used, never above the locked maximum. The unused
 * part goes to the buyer's associated token account, and the transaction first
 * creates it and the treasury's token account if either is missing, so a
 * closed source account or a treasury account not yet created cannot stop the
 * payout. The provider pays rent for anything it creates.
 */
function meteredSettlement(terms, lock, usage) {
    const decimals = (0, payment_1.directPaymentCurrency)(terms.price.currency).decimals;
    const settlement = (0, metered_1.settleMeteredCall)(terms.price, usage, (0, payment_1.baseUnitsToDecimal)(lock.maxBaseUnits, decimals));
    if (settlement.chargedBaseUnits <= BigInt(0))
        throw new Error('nothing to settle');
    const prep = (0, escrow_readiness_1.prepareTokenPayout)(lock.terms, terms.payee);
    const instruction = (0, token_escrow_1.buildSettleTokenEscrowInstruction)(lock.terms, false, terms.payee, {
        actual: settlement.chargedBaseUnits,
        treasuryToken: prep.treasuryToken,
        refundTo: prep.refundTo,
    });
    return { settlement, instruction, instructions: [...prep.instructions, instruction] };
}
/**
 * Declines a verified lock the provider will not serve, for example when the
 * model failed before any work was done: the payee may refund the whole
 * amount to the payer at any time. Returns the instruction for the operator
 * to sign with the provider wallet.
 */
function meteredDecline(terms, lock) {
    return (0, token_escrow_1.buildSettleTokenEscrowInstruction)(lock.terms, true, terms.payee);
}
