"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenCostBaseUnits = tokenCostBaseUnits;
exports.quoteMeteredCall = quoteMeteredCall;
exports.settleMeteredCall = settleMeteredCall;
const payment_1 = require("./payment");
const MILLION = BigInt(1000000);
function perMillionUnits(value, decimals) {
    if (value === '0')
        return BigInt(0);
    const units = (0, payment_1.decimalToBaseUnits)(value, decimals);
    if (units === undefined)
        throw new Error(`per-million price must be a non-negative amount with at most ${decimals} decimal places`);
    return units;
}
function count(value, name) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`${name} must be a whole number of tokens`);
    return BigInt(value);
}
function currencyDecimals(currency) {
    const decimals = (0, payment_1.directPaymentCurrency)(currency)?.decimals;
    if (decimals === undefined)
        throw new Error(`unsupported currency: ${currency}`);
    return decimals;
}
/**
 * Cost of `counts` tokens in base units of the price currency, rounded up to
 * the next base unit so a provider is never paid less than its listed rate.
 */
function tokenCostBaseUnits(price, counts) {
    const decimals = currencyDecimals(price.currency);
    const scaled = count(counts.inputTokens, 'inputTokens') * perMillionUnits(price.inputPerMillion, decimals) +
        count(counts.outputTokens, 'outputTokens') * perMillionUnits(price.outputPerMillion, decimals);
    return (scaled + MILLION - BigInt(1)) / MILLION;
}
/**
 * What a buyer sees before a metered call: the estimated cost and the maximum
 * it authorises. The maximum must cover the estimate.
 */
function quoteMeteredCall(price, estimate, maxCharge, atMs = Date.now()) {
    const decimals = currencyDecimals(price.currency);
    const estimated = tokenCostBaseUnits(price, estimate);
    const max = (0, payment_1.decimalToBaseUnits)(maxCharge, decimals);
    if (max === undefined)
        throw new Error(`maxCharge must be a positive ${price.currency} amount with at most ${decimals} decimal places`);
    if (max < estimated)
        throw new Error('maxCharge must be at least the estimated cost');
    return {
        currency: price.currency,
        estimatedCost: (0, payment_1.baseUnitsToDecimal)(estimated, decimals),
        maxCharge: (0, payment_1.baseUnitsToDecimal)(max, decimals),
        estimatedFee: (0, payment_1.baseUnitsToDecimal)((0, payment_1.protocolFeeBaseUnits)(estimated, (0, payment_1.protocolFeeBpsAt)(atMs), (0, payment_1.protocolFeeCapBaseUnits)(price.currency)), decimals),
    };
}
/**
 * Works out a metered call once the response is in and the real token counts
 * are known. This is the same split the escrow program applies on-chain when
 * the payee settles with `chargedBaseUnits`.
 */
function settleMeteredCall(price, usage, maxCharge, atMs = Date.now()) {
    const decimals = currencyDecimals(price.currency);
    const max = (0, payment_1.decimalToBaseUnits)(maxCharge, decimals);
    if (max === undefined)
        throw new Error(`maxCharge must be a positive ${price.currency} amount with at most ${decimals} decimal places`);
    const actual = tokenCostBaseUnits(price, usage);
    const charged = actual > max ? max : actual;
    const fee = (0, payment_1.protocolFeeBaseUnits)(charged, (0, payment_1.protocolFeeBpsAt)(atMs), (0, payment_1.protocolFeeCapBaseUnits)(price.currency));
    const text = (units) => (0, payment_1.baseUnitsToDecimal)(units, decimals);
    return {
        currency: price.currency,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        actualCost: text(actual),
        charged: text(charged),
        fee: text(fee),
        provider: text(charged - fee),
        refund: text(max - charged),
        capped: actual > max,
        chargedBaseUnits: charged,
    };
}
