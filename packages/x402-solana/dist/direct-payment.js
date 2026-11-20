"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDirectPaymentInstructions = buildDirectPaymentInstructions;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const payment_1 = require("./payment");
/**
 * Instructions for one direct per-call payment. With fee terms in the challenge
 * the buyer pays the listed amount in total: the provider's share to the payee
 * and the fee to the treasury, in the same transaction. This builds instructions
 * only. It signs nothing and sends nothing.
 *
 * The split is recomputed from the listed amount and the stated rate, and must
 * match the stated amounts exactly, so a challenge cannot make the buyer pay
 * more than the listed price or route more than the stated rate to the fee.
 */
function buildDirectPaymentInstructions(input) {
    const { challenge, payer } = input;
    const currency = (0, payment_1.directPaymentCurrency)(challenge.currency);
    if (currency === undefined)
        throw new Error(`unsupported direct payment currency: ${challenge.currency}`);
    const decimals = currency.decimals;
    const price = (0, payment_1.decimalToBaseUnits)(challenge.amount, decimals);
    if (price === undefined)
        throw new Error('challenge amount is not a valid positive amount');
    const payTo = new web3_js_1.PublicKey(challenge.payTo);
    let providerUnits = price;
    let feeUnits = BigInt(0);
    let treasury;
    if (challenge.fee) {
        const maxFeeBps = input.maxFeeBps ?? payment_1.PROTOCOL_FEE_BPS;
        if (challenge.fee.bps > maxFeeBps)
            throw new Error(`challenge fee of ${challenge.fee.bps} bps exceeds the accepted ${maxFeeBps} bps`);
        // The ceiling is the buyer's own rule for the currency, never the challenge's.
        feeUnits = (0, payment_1.protocolFeeBaseUnits)(price, challenge.fee.bps, (0, payment_1.protocolFeeCapBaseUnits)(challenge.currency));
        providerUnits = price - feeUnits;
        const statedFee = challenge.fee.amount === '0' ? BigInt(0) : (0, payment_1.decimalToBaseUnits)(challenge.fee.amount, decimals);
        const statedProvider = (0, payment_1.decimalToBaseUnits)(challenge.fee.providerAmount, decimals);
        if (statedFee !== feeUnits || statedProvider !== providerUnits) {
            throw new Error('challenge fee terms do not add up to the listed amount at the stated rate');
        }
        treasury = new web3_js_1.PublicKey(challenge.fee.payTo);
        if (treasury.equals(payTo))
            throw new Error('fee treasury must differ from the payee');
    }
    if (currency.tokenProgram === undefined) {
        const instructions = [web3_js_1.SystemProgram.transfer({ fromPubkey: payer, toPubkey: payTo, lamports: providerUnits })];
        if (treasury && feeUnits > BigInt(0))
            instructions.push(web3_js_1.SystemProgram.transfer({ fromPubkey: payer, toPubkey: treasury, lamports: feeUnits }));
        return instructions;
    }
    const mint = input.mint ?? (challenge.currency === 'USDC' ? input.usdcMint : undefined);
    if (!mint)
        throw new Error(`a configured mint is required for a ${challenge.currency} payment`);
    // PYUSD and USDG are Token-2022 mints; their token accounts derive from that program.
    const tokenProgram = new web3_js_1.PublicKey(currency.tokenProgram);
    // Owners may be program-derived addresses, such as a multisig vault.
    const tokenAccountOf = (owner) => (0, spl_token_1.getAssociatedTokenAddressSync)(mint, owner, true, tokenProgram);
    const source = input.payerTokenAccount ?? tokenAccountOf(payer);
    const transfer = (owner, units) => (0, spl_token_1.createTransferCheckedInstruction)(source, mint, tokenAccountOf(owner), payer, units, decimals, [], tokenProgram);
    const instructions = [transfer(payTo, providerUnits)];
    if (treasury && feeUnits > BigInt(0))
        instructions.push(transfer(treasury, feeUnits));
    return instructions;
}
