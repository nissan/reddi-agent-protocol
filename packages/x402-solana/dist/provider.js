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
exports.checkMeteredPayout = checkMeteredPayout;
exports.verifyMeteredLock = verifyMeteredLock;
exports.meteredEscrowReplayKey = meteredEscrowReplayKey;
exports.usageFrom = usageFrom;
exports.meteredSettlement = meteredSettlement;
exports.confirmMeteredSettlement = confirmMeteredSettlement;
exports.meteredDecline = meteredDecline;
exports.meteredRatingAccount = meteredRatingAccount;
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
const spl_token_1 = require("@solana/spl-token");
const escrow_readiness_1 = require("./escrow-readiness");
const metered_1 = require("./metered");
const payment_1 = require("./payment");
const rating_1 = require("./rating");
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
        ...(input.payoutAccount ? { payoutAccount: new web3_js_1.PublicKey(input.payoutAccount) } : {}),
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
 * Reads every account a settle of this escrow would pay into and says whether
 * the payout can land: the provider's token account (or its recovery
 * account), the treasury's, and the buyer's account for the unused part. Each
 * must exist under the mint's token program, be initialised, not frozen, hold
 * the mint, have the right owner and not require a memo.
 *
 * Nothing is created by default. `allowPayerAssociatedAccount` lets the
 * unused part go to the payer's associated token account when the recorded
 * source no longer works; `createRefundAccount` lets the provider pay to
 * create that account when it does not exist at all.
 */
async function checkMeteredPayout(input) {
    const { terms, escrow } = input;
    const token = { mint: terms.mint, tokenProgram: terms.tokenProgram };
    const treasury = input.treasury ?? token_escrow_1.ESCROW_PROTOCOL_TREASURY;
    const treasuryToken = (0, token_escrow_1.treasuryTokenAccount)(token, treasury);
    const notReady = (message) => ({ ok: false, reason: 'provider_not_ready', message });
    try {
        let payTo;
        if (!(0, escrow_readiness_1.checkTokenAccount)(escrow.recipient, await input.readAccount(escrow.recipient), { ...token, owner: terms.payee }).ok) {
            const recovery = terms.payoutAccount;
            if (!recovery || recovery.equals(escrow.recipient) || !(0, escrow_readiness_1.checkTokenAccount)(recovery, await input.readAccount(recovery), { ...token, owner: terms.payee }).ok) {
                return notReady(`This provider's ${terms.price.currency} account cannot receive payment right now. Nothing was accepted; your lock is untouched.`);
            }
            payTo = recovery;
        }
        if (!(0, escrow_readiness_1.checkTokenAccount)(treasuryToken, await input.readAccount(treasuryToken), { ...token, owner: treasury }).ok) {
            return notReady(`The protocol treasury cannot receive ${terms.price.currency} right now, so this provider is not taking payment in it. Nothing was accepted; your lock is untouched.`);
        }
        let harvestWithheldFees = false;
        if (terms.tokenProgram.equals(spl_token_1.TOKEN_2022_PROGRAM_ID)) {
            const mint = await input.readAccount(terms.mint);
            if (!mint || !mint.owner.equals(spl_token_1.TOKEN_2022_PROGRAM_ID))
                return notReady(`The ${terms.price.currency} mint could not be read. Nothing was accepted; your lock is untouched.`);
            try {
                harvestWithheldFees = (0, spl_token_1.getTransferFeeConfig)((0, spl_token_1.unpackMint)(terms.mint, { data: Buffer.from(mint.data), owner: mint.owner, lamports: 0, executable: false }, spl_token_1.TOKEN_2022_PROGRAM_ID)) !== null;
            }
            catch {
                return notReady(`The ${terms.price.currency} mint could not be read. Nothing was accepted; your lock is untouched.`);
            }
        }
        const base = { ...(payTo ? { payTo } : {}), treasuryToken, harvestWithheldFees };
        const refundTarget = { ...token, owner: escrow.payer };
        const source = await input.readAccount(escrow.source);
        if ((0, escrow_readiness_1.checkTokenAccount)(escrow.source, source, refundTarget).ok)
            return { ok: true, payout: { ...base, refundTo: escrow.source } };
        if (input.allowPayerAssociatedAccount || input.createRefundAccount) {
            const associated = (0, spl_token_1.getAssociatedTokenAddressSync)(terms.mint, escrow.payer, true, terms.tokenProgram);
            const held = associated.equals(escrow.source) ? source : await input.readAccount(associated);
            if ((0, escrow_readiness_1.checkTokenAccount)(associated, held, refundTarget).ok)
                return { ok: true, payout: { ...base, refundTo: associated } };
            // Only an account that does not exist can be created. A frozen or memo-requiring one stays as it is.
            if (input.createRefundAccount && held === null)
                return { ok: true, payout: { ...base, refundTo: associated, createRefundAccount: true } };
        }
        return {
            ok: false,
            reason: 'refund_account_unusable',
            message: `The ${terms.price.currency} account that funded this lock is closed, frozen or requires a memo, so the unused part could not be returned to you. Nothing was accepted. Restore that account and present the same lock again, or refund the lock once its refund window opens.`,
        };
    }
    catch {
        return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted; present the same receipt again.' };
    }
}
/**
 * Checks the lock on chain against this provider's terms: the escrow program,
 * the address the payer and nonce give, still locked, metered, payable to this
 * provider's token account in the accepted mint, and at least `minimum`. Then
 * checks that the payout can land (`checkMeteredPayout`), using the source
 * account the lock recorded for the unused part, so a call is refused before
 * any work is done rather than left unpaid after it.
 * The escrow is then remembered, so one lock pays for one call.
 *
 * An escrow the buyer opted in to rating is refused (`rated_escrow_declined`)
 * before anything is served or remembered, unless `acceptRatedEscrows` is
 * true. `readAccount` must read at `confirmed` commitment or better for that
 * answer to be final (see `AccountReader`).
 */
async function verifyMeteredLock(input) {
    const purpose = input.purpose ?? 'call';
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
    if (escrow.rated && input.acceptRatedEscrows !== true) {
        return { ok: false, reason: 'rated_escrow_declined', message: 'This escrow was opted in to rating, and this provider does not take rated jobs. Nothing was accepted or served. Lock a new escrow without rating, and refund this one once its refund window opens.' };
    }
    // The payer may refund once its window has elapsed, so the settlement has to
    // land before then. The time left now is what counts, not the window named
    // at lock: a buyer could lock, wait out most of the window, then make the
    // call. An escrow that states no window, or a slot that cannot be read, is
    // refused.
    if (escrow.cancelWindowSlots === undefined) {
        return { ok: false, reason: 'invalid_receipt', message: 'This escrow states no refund window. Lock a new one with the current program.' };
    }
    if (purpose !== 'session-settle') {
        let currentSlot;
        try {
            currentSlot = BigInt(await input.readSlot());
        }
        catch {
            return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted; present the same receipt again.' };
        }
        const elapsed = currentSlot > escrow.createdSlot ? currentSlot - escrow.createdSlot : BigInt(0);
        if (escrow.cancelWindowSlots < elapsed + token_escrow_1.SELLER_MIN_CANCEL_WINDOW_SLOTS) {
            return purpose === 'session-call'
                ? { ok: false, reason: 'session_window_closing', message: "This session's refund window has less than 10 minutes left, so it takes no more calls and is settled now. Lock a new escrow to go on." }
                : { ok: false, reason: 'invalid_receipt', message: "This escrow's refund window has less than 10 minutes left. Lock a new one with a longer refund window, then make the call straight away." };
        }
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
    // A rated job is named by its rating's opened slot: read it now, with the
    // lock this provider is about to serve, and keep it for the settle.
    let openedSlot;
    if (escrow.rated) {
        let ratingAccount;
        try {
            ratingAccount = await input.readAccount((0, rating_1.ratingPda)(header.escrow, terms.programId));
        }
        catch {
            return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted; present the same receipt again.' };
        }
        let rating;
        try {
            rating = ratingAccount && ratingAccount.owner.equals(terms.programId) ? (0, rating_1.decodeRatingAccount)(Buffer.from(ratingAccount.data)) : undefined;
        }
        catch {
            rating = undefined;
        }
        if (!rating || !rating.escrow.equals(header.escrow) || rating.state !== 'awaiting_settlement') {
            return { ok: false, reason: 'invalid_receipt', message: "This escrow is opted in to rating, but its rating account could not be read as this job's. Nothing was accepted." };
        }
        openedSlot = rating.openedSlot;
    }
    const payout = await checkMeteredPayout({ terms, escrow, readAccount: input.readAccount, ...(input.treasury ? { treasury: input.treasury } : {}) });
    if (!payout.ok)
        return payout;
    if (purpose === 'call' && !(await input.replayStore.checkAndStore(meteredEscrowReplayKey(header.escrow)))) {
        return { ok: false, reason: 'duplicate_nonce', message: 'This escrow has already paid for a call.' };
    }
    return {
        ok: true,
        payer: escrow.payer,
        payout: payout.payout,
        rated: escrow.rated,
        createdSlot: escrow.createdSlot,
        ...(openedSlot !== undefined ? { openedSlot } : {}),
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
/** The replay-store key that marks an escrow as taken, by a single call or by a session's first call. */
function meteredEscrowReplayKey(escrow) {
    return `metered-escrow:${escrow.toBase58()}`;
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
 * The settle for the tokens used, never above the locked maximum. It pays
 * into the accounts checked with the lock (`lock.payout`), or into `payout`
 * when the caller has checked them again. Nothing is created unless that
 * check chose to create the buyer's token account. The settle of a rated
 * lock carries the escrow's rating account after the usual accounts and the
 * job's opened slot (`lock.openedSlot`) after its data; for a lock that is
 * not rated the instruction is unchanged.
 */
function meteredSettlement(terms, lock, usage, payout = lock.payout) {
    const decimals = (0, payment_1.directPaymentCurrency)(terms.price.currency).decimals;
    const settlement = (0, metered_1.settleMeteredCall)(terms.price, usage, (0, payment_1.baseUnitsToDecimal)(lock.maxBaseUnits, decimals));
    if (settlement.chargedBaseUnits <= BigInt(0))
        throw new Error('nothing to settle');
    const prep = (0, escrow_readiness_1.prepareTokenPayout)(lock.terms, terms.payee, undefined, { refundTo: payout.refundTo, createRefundAccount: payout.createRefundAccount === true });
    const instruction = (0, rating_1.withRatingAccount)((0, token_escrow_1.buildSettleTokenEscrowInstruction)(lock.terms, false, terms.payee, {
        actual: settlement.chargedBaseUnits,
        treasuryToken: payout.treasuryToken,
        refundTo: payout.refundTo,
        ...(payout.payTo ? { payTo: payout.payTo } : {}),
        ...(payout.harvestWithheldFees ? { harvestWithheldFees: true } : {}),
    }), lock.rated === true, lock.openedSlot);
    return { settlement, instruction, instructions: [...prep.instructions, instruction] };
}
/**
 * The amounts a settle actually moved, from the confirmed transaction: it
 * must have succeeded, called the escrow program and named this escrow (and,
 * when `expected.rating` is given, that rating account: pass
 * `meteredRatingAccount(lock)` for a rated lock). Accounts the transaction
 * names beyond those are not held against it. The
 * provider's credit and the treasury's fee are read from the balance changes,
 * not from what the provider intended. Refused when the buyer got back less
 * than the maximum less the amount billed, or more was billed than was
 * locked: a receipt cannot state that honestly. A mint that charges a
 * non-zero transfer fee would land here on every settle, since each transfer
 * arrives short; the accepted Token-2022 mints are watched to stay at zero.
 */
function confirmMeteredSettlement(record, expected) {
    if (!record)
        return { ok: false, reason: 'not_found' };
    if (record.failed)
        return { ok: false, reason: 'failed' };
    if (!record.programIds.includes(expected.programId.toBase58()) || !record.accounts.includes(expected.escrow.toBase58()))
        return { ok: false, reason: 'wrong_transaction' };
    if (expected.rating && !record.accounts.includes(expected.rating.toBase58()))
        return { ok: false, reason: 'wrong_transaction' };
    const mint = expected.mint.toBase58();
    const change = (account) => {
        const row = record.tokenBalances.find((b) => b.account === account.toBase58() && b.mint === mint);
        return row ? row.after - row.before : BigInt(0);
    };
    const providerBaseUnits = change(expected.destination);
    const feeBaseUnits = change(expected.treasuryToken);
    const returned = change(expected.refundTo);
    const paidBaseUnits = providerBaseUnits + feeBaseUnits;
    if (providerBaseUnits <= BigInt(0) || feeBaseUnits < BigInt(0) || returned < BigInt(0) || paidBaseUnits > expected.maxBaseUnits)
        return { ok: false, reason: 'amounts_do_not_add_up' };
    const refundedBaseUnits = expected.maxBaseUnits - paidBaseUnits;
    if (returned < refundedBaseUnits)
        return { ok: false, reason: 'amounts_do_not_add_up' };
    return { ok: true, paidBaseUnits, feeBaseUnits, providerBaseUnits, refundedBaseUnits, surplusBaseUnits: returned - refundedBaseUnits };
}
/**
 * Declines a verified lock the provider will not serve, for example when the
 * model failed before any work was done: the payee may refund the whole
 * amount to the payer at any time. The program sends a decline to the source
 * account the lock recorded, which the lock check found usable. Returns the
 * instruction for the operator to sign with the provider wallet. The decline
 * of a rated lock carries the rating account, which the program closes: a
 * job that was not paid is not rated.
 */
function meteredDecline(terms, lock) {
    return (0, rating_1.withRatingAccount)((0, token_escrow_1.buildSettleTokenEscrowInstruction)(lock.terms, true, terms.payee, lock.payout.harvestWithheldFees ? { harvestWithheldFees: true } : {}), lock.rated === true, lock.openedSlot);
}
/** The rating account a rated lock's settle and decline carry, or undefined for a lock that is not rated. */
function meteredRatingAccount(lock) {
    return lock.rated === true ? (0, rating_1.ratingPda)((0, token_escrow_1.tokenEscrowAddresses)(lock.terms).escrow, lock.terms.programId) : undefined;
}
