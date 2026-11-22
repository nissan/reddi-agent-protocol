"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseX402Challenge = parseX402Challenge;
exports.planBuyerDirectPayment = planBuyerDirectPayment;
const direct_payment_1 = require("./direct-payment");
const payment_1 = require("./payment");
const NETWORKS = ['solana-devnet', 'solana-mainnet-beta', 'solana-testnet'];
function refuse(reason, message) {
    return { ok: false, reason, message };
}
/** Reads a provider challenge without trusting its shape. Returns undefined when a required field is missing or mistyped. */
function parseX402Challenge(value) {
    let candidate = value;
    if (typeof value === 'string') {
        try {
            candidate = JSON.parse(value);
        }
        catch {
            return undefined;
        }
    }
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
        return undefined;
    const c = candidate;
    const isText = (v) => typeof v === 'string' && v.length > 0;
    if (!isText(c.network) || !NETWORKS.includes(c.network))
        return undefined;
    if (!isText(c.payTo) || !(0, payment_1.isValidSolanaPublicKey)(c.payTo))
        return undefined;
    if (!isText(c.currency) || !isText(c.nonce) || !isText(c.endpoint))
        return undefined;
    if (typeof c.amount !== 'string' && typeof c.amount !== 'number')
        return undefined;
    if (c.memo !== undefined && typeof c.memo !== 'string')
        return undefined;
    let fee;
    if (c.fee !== undefined) {
        const f = c.fee;
        if (!f || typeof f !== 'object')
            return undefined;
        if (typeof f.bps !== 'number' || !Number.isInteger(f.bps) || f.bps < 0)
            return undefined;
        if (!isText(f.payTo) || !(0, payment_1.isValidSolanaPublicKey)(f.payTo))
            return undefined;
        if (!isText(f.amount) || !isText(f.providerAmount))
            return undefined;
        if (f.cap !== undefined && !isText(f.cap))
            return undefined;
        fee = { bps: f.bps, payTo: f.payTo, amount: f.amount, providerAmount: f.providerAmount, ...(isText(f.cap) ? { cap: f.cap } : {}) };
    }
    const challenge = {
        version: isText(c.version) ? c.version : '1',
        network: c.network,
        payTo: c.payTo,
        amount: c.amount,
        currency: c.currency,
        endpoint: c.endpoint,
        nonce: c.nonce,
    };
    if (typeof c.memo === 'string')
        challenge.memo = c.memo;
    if (fee)
        challenge.fee = fee;
    return challenge;
}
/**
 * Decides whether a buyer should pay a provider's challenge, and if so builds
 * the payment instructions. Every check runs before any instruction exists:
 * the challenge must name the wallet's network, the provider and currency of
 * the listing the buyer selected, a price no higher than the listed price and
 * the buyer's spend cap, and fee terms that add up at an accepted rate.
 *
 * This signs nothing and sends nothing. The wallet does both.
 */
function planBuyerDirectPayment(input) {
    const challenge = parseX402Challenge(input.challenge);
    if (!challenge)
        return refuse('invalid_challenge', 'the provider challenge is missing a required field or is not valid');
    if (challenge.network !== input.network) {
        return refuse('wrong_network', `the challenge is for ${challenge.network} but the wallet is on ${input.network}`);
    }
    if (challenge.payTo !== input.listing.payTo) {
        return refuse('wrong_payee', 'the challenge pays a different wallet from the selected listing');
    }
    if (challenge.currency !== input.listing.currency) {
        return refuse('wrong_currency', `the challenge asks for ${challenge.currency} but the listing is priced in ${input.listing.currency}`);
    }
    const currency = (0, payment_1.directPaymentCurrency)(challenge.currency);
    const decimals = currency?.decimals;
    if (currency === undefined || decimals === undefined)
        return refuse('wrong_currency', `direct payment in ${challenge.currency} is not supported`);
    const price = (0, payment_1.decimalToBaseUnits)(challenge.amount, decimals);
    const listed = (0, payment_1.decimalToBaseUnits)(input.listing.amount, decimals);
    const cap = (0, payment_1.decimalToBaseUnits)(input.spendCap, decimals);
    if (price === undefined)
        return refuse('invalid_challenge', 'the challenge amount is not a valid positive amount');
    if (listed === undefined)
        return refuse('price_above_listing', 'the selected listing has no valid price to compare against');
    if (cap === undefined)
        return refuse('above_spend_cap', 'a spend cap greater than zero is required');
    if (price > listed)
        return refuse('price_above_listing', 'the challenge asks for more than the listed price');
    if (price > cap)
        return refuse('above_spend_cap', 'the challenge asks for more than the spend cap');
    const tokenMint = currency.tokenProgram === undefined
        ? undefined
        : input.mint ?? (challenge.currency === 'USDC' ? input.usdcMint : undefined);
    let instructions;
    try {
        instructions = (0, direct_payment_1.buildDirectPaymentInstructions)({
            challenge,
            payer: input.payer,
            mint: tokenMint,
            payerTokenAccount: input.payerTokenAccount,
            maxFeeBps: input.maxFeeBps ?? (0, payment_1.protocolFeeBpsAt)(),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'payment instructions could not be built';
        return refuse(/fee/.test(message) ? 'fee_terms_rejected' : 'invalid_challenge', message);
    }
    const payer = input.payer.toBase58();
    const mint = tokenMint?.toBase58();
    return {
        ok: true,
        challenge,
        instructions,
        totalBaseUnits: price,
        fee: challenge.fee,
        receiptFor(signature) {
            if (!signature || /^mock_/i.test(signature))
                throw new Error('a real transaction signature is required');
            const receipt = {
                network: challenge.network,
                payTo: challenge.payTo,
                amount: challenge.amount,
                currency: challenge.currency,
                nonce: challenge.nonce,
                signature,
                payer,
            };
            if (mint)
                receipt.mint = mint;
            return receipt;
        },
    };
}
