"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDevnetKeypair = loadDevnetKeypair;
exports.assertDevnetRpcUrl = assertDevnetRpcUrl;
exports.assertEndpointAllowed = assertEndpointAllowed;
exports.usdcAmountToMicroUnits = usdcAmountToMicroUnits;
exports.validateDevnetUsdcChallenge = validateDevnetUsdcChallenge;
exports.prepareDevnetUsdcPayment = prepareDevnetUsdcPayment;
exports.executeDevnetUsdcPayment = executeDevnetUsdcPayment;
exports.createSolanaDevnetUsdcPaymentClient = createSolanaDevnetUsdcPaymentClient;
exports.challengeFromX402RequestHeader = challengeFromX402RequestHeader;
exports.devnetUsdcPaymentProofHeaders = devnetUsdcPaymentProofHeaders;
const node_fs_1 = require("node:fs");
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const payment_1 = require("./payment");
const direct_auth_1 = require("./direct-auth");
const DEVNET_NETWORK = 'solana-devnet';
const DEFAULT_MIN_FEE_LAMPORTS = 5000;
const APPROVAL_PHRASE = 'EXECUTE_DEVNET_X402_SPECIALIST_CALL';
function loadDevnetKeypair(path) {
    if (!path || !(0, node_fs_1.existsSync)(path))
        throw new Error('devnet_wallet_keypair_unavailable');
    const secret = JSON.parse((0, node_fs_1.readFileSync)(path, 'utf8'));
    if (!Array.isArray(secret))
        throw new Error('devnet_wallet_keypair_invalid');
    return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secret));
}
function assertDevnetRpcUrl(rpcUrl) {
    let parsed;
    try {
        parsed = new URL(rpcUrl);
    }
    catch {
        throw new Error('invalid_devnet_rpc_url');
    }
    if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('unsupported_devnet_rpc_url_protocol');
    const host = parsed.hostname.toLowerCase();
    if (host.includes('mainnet'))
        throw new Error('mainnet_rpc_url_forbidden');
    const allowed = host === 'api.devnet.solana.com' || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.includes('devnet');
    if (!allowed)
        throw new Error(`unsupported_devnet_rpc_url_host:${parsed.hostname}`);
}
function assertEndpointAllowed(endpoint, allowlist) {
    if (!allowlist.length)
        throw new Error('specialist_endpoint_allowlist_required');
    let parsed;
    try {
        parsed = new URL(endpoint);
    }
    catch {
        throw new Error('invalid_specialist_endpoint_url');
    }
    if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('unsupported_specialist_endpoint_protocol');
    if (!allowlist.includes(endpoint))
        throw new Error('specialist_endpoint_not_allowlisted');
}
function usdcAmountToMicroUnits(amount) {
    const text = String(amount);
    if (!/^\d+(\.\d{1,6})?$/.test(text))
        throw new Error('invalid_usdc_amount');
    const [wholeRaw, fracRaw = ''] = text.split('.');
    const whole = BigInt(wholeRaw || '0');
    const frac = BigInt((fracRaw + '000000').slice(0, 6));
    const microUnits = whole * 1000000n + frac;
    if (microUnits <= 0n)
        throw new Error('invalid_usdc_amount');
    return microUnits;
}
function normalizeCap(value) {
    const cap = BigInt(value);
    if (cap <= 0n)
        throw new Error('invalid_devnet_usdc_spend_cap');
    return cap;
}
function validateDevnetUsdcChallenge(challenge, config) {
    assertDevnetRpcUrl(config.rpcUrl);
    assertEndpointAllowed(challenge.endpoint, config.endpointAllowlist);
    if (challenge.network !== DEVNET_NETWORK)
        throw new Error('x402_challenge_not_solana_devnet');
    if (String(challenge.currency).toUpperCase() !== 'USDC')
        throw new Error('x402_challenge_currency_must_be_USDC');
    if (!challenge.nonce)
        throw new Error('x402_challenge_nonce_required');
    if (!(0, payment_1.isValidSolanaPublicKey)(challenge.payTo))
        throw new Error('x402_challenge_payee_invalid');
    if (!(0, payment_1.isValidSolanaPublicKey)(config.usdcMint))
        throw new Error('devnet_usdc_mint_invalid');
    const amountMicroUnits = usdcAmountToMicroUnits(challenge.amount);
    const maxUsdcMicroUnits = normalizeCap(config.maxUsdcMicroUnits);
    if (amountMicroUnits > maxUsdcMicroUnits)
        throw new Error(`devnet_usdc_spend_cap_exceeded:${amountMicroUnits}>${maxUsdcMicroUnits}`);
    return {
        payTo: new web3_js_1.PublicKey(challenge.payTo),
        mint: new web3_js_1.PublicKey(config.usdcMint),
        amountMicroUnits,
        maxUsdcMicroUnits,
    };
}
async function prepareDevnetUsdcPayment(input) {
    const reasons = [];
    let payer = null;
    let payTo;
    let mint;
    let amountMicroUnits;
    let maxUsdcMicroUnits;
    try {
        ({ payTo, mint, amountMicroUnits, maxUsdcMicroUnits } = validateDevnetUsdcChallenge(input.challenge, input.config));
        payer = loadDevnetKeypair(input.config.walletKeypairPath);
    }
    catch (error) {
        return readiness(input.challenge, null, '0', String(input.config.maxUsdcMicroUnits), false, reasons.concat(error instanceof Error ? error.message : String(error)), null, null, null);
    }
    const solLamports = await input.client.getSolBalanceLamports(payer.publicKey);
    const usdcMicroUnits = await input.client.getUsdcBalanceMicroUnits(payer.publicKey, mint);
    const destinationTokenAccount = await input.client.getOrCreateDestinationTokenAccount(payTo, mint);
    const minFeeLamports = input.config.minFeeLamports ?? DEFAULT_MIN_FEE_LAMPORTS;
    if (solLamports < minFeeLamports)
        reasons.push(`insufficient_sol_for_fees:${solLamports}<${minFeeLamports}`);
    if (usdcMicroUnits < amountMicroUnits)
        reasons.push(`insufficient_usdc:${usdcMicroUnits}<${amountMicroUnits}`);
    return readiness(input.challenge, payer.publicKey.toBase58(), String(amountMicroUnits), String(maxUsdcMicroUnits), amountMicroUnits <= maxUsdcMicroUnits, reasons, solLamports, String(usdcMicroUnits), destinationTokenAccount);
}
function readiness(challenge, payer, amountMicroUnits, maxUsdcMicroUnits, capRespected, reasons, solLamports, usdcMicroUnits, destinationTokenAccount) {
    return {
        schemaVersion: 'reddi.x402-solana.devnet-usdc-payment-readiness.v1',
        ready: reasons.length === 0,
        boundary: 'solana-devnet-only-no-mainnet',
        reasons,
        payer,
        challenge: {
            network: challenge.network,
            payTo: challenge.payTo,
            amount: challenge.amount,
            currency: challenge.currency,
            endpoint: challenge.endpoint,
            nonce: challenge.nonce,
        },
        spend: { amountMicroUnits, maxUsdcMicroUnits, capRespected },
        balances: { solLamports, usdcMicroUnits },
        destinationTokenAccount,
    };
}
async function executeDevnetUsdcPayment(input) {
    if (input.approvalPhrase !== APPROVAL_PHRASE)
        throw new Error('missing_devnet_x402_specialist_call_approval_phrase');
    const { payTo, mint, amountMicroUnits } = validateDevnetUsdcChallenge(input.challenge, input.config);
    const payer = loadDevnetKeypair(input.config.walletKeypairPath);
    const readiness = await prepareDevnetUsdcPayment({ challenge: input.challenge, config: input.config, client: input.client });
    if (!readiness.ready)
        throw new Error(`devnet_usdc_payment_not_ready:${readiness.reasons.join(',')}`);
    const destinationTokenAccount = readiness.destinationTokenAccount ?? await input.client.getOrCreateDestinationTokenAccount(payTo, mint);
    const result = await input.client.submitUsdcTransfer({ payer, payTo, mint, amountMicroUnits, destinationTokenAccount, challenge: input.challenge });
    return {
        network: DEVNET_NETWORK,
        payTo: input.challenge.payTo,
        amount: input.challenge.amount,
        currency: 'USDC',
        nonce: input.challenge.nonce,
        signature: result.signature,
        txSignature: result.signature,
        payer: payer.publicKey.toBase58(),
        mint: mint.toBase58(),
        destinationTokenAccount: result.destinationTokenAccount,
    };
}
function createSolanaDevnetUsdcPaymentClient(connection) {
    return {
        async getSolBalanceLamports(publicKey) {
            return connection.getBalance(publicKey, 'confirmed');
        },
        async getUsdcBalanceMicroUnits(owner, mint) {
            const tokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, owner, false, spl_token_1.TOKEN_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID);
            const accountInfo = await connection.getAccountInfo(tokenAccount, 'confirmed');
            if (!accountInfo)
                return 0n;
            const balance = await connection.getTokenAccountBalance(tokenAccount, 'confirmed');
            return BigInt(balance.value.amount);
        },
        async getOrCreateDestinationTokenAccount(payTo, mint) {
            return (0, spl_token_1.getAssociatedTokenAddressSync)(mint, payTo, false, spl_token_1.TOKEN_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID).toBase58();
        },
        async submitUsdcTransfer(input) {
            const sourceTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(input.mint, input.payer.publicKey, false, spl_token_1.TOKEN_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID);
            const destinationTokenAccount = new web3_js_1.PublicKey(input.destinationTokenAccount);
            const tx = new web3_js_1.Transaction();
            const destinationInfo = await connection.getAccountInfo(destinationTokenAccount, 'confirmed');
            if (!destinationInfo) {
                tx.add((0, spl_token_1.createAssociatedTokenAccountInstruction)(input.payer.publicKey, destinationTokenAccount, input.payTo, input.mint, spl_token_1.TOKEN_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
            }
            tx.add((0, spl_token_1.createTransferCheckedInstruction)(sourceTokenAccount, input.mint, destinationTokenAccount, input.payer.publicKey, input.amountMicroUnits, 6, [], spl_token_1.TOKEN_PROGRAM_ID));
            const signature = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [input.payer], { commitment: 'confirmed' });
            return { signature, destinationTokenAccount: destinationTokenAccount.toBase58() };
        },
    };
}
function challengeFromX402RequestHeader(header) {
    const parsed = JSON.parse(header);
    return (0, payment_1.buildX402Challenge)({
        version: typeof parsed.version === 'string' ? parsed.version : '1',
        network: parsed.network,
        payTo: typeof parsed.payTo === 'string' ? parsed.payTo : parsed.paymentAddress,
        amount: parsed.amount,
        currency: parsed.currency,
        endpoint: parsed.endpoint,
        nonce: parsed.nonce,
        memo: typeof parsed.memo === 'string' ? parsed.memo : undefined,
    });
}
/**
 * The proof headers for presenting a devnet USDC receipt with `body`, signed by
 * the same wallet file that paid. Send them with `x402-payment` on the paid retry.
 */
async function devnetUsdcPaymentProofHeaders(input) {
    const payer = loadDevnetKeypair(input.walletKeypairPath);
    const txSignature = input.receipt.signature ?? input.receipt.txSignature;
    if (!txSignature)
        throw new Error('devnet_receipt_signature_missing');
    if (input.receipt.payer !== payer.publicKey.toBase58())
        throw new Error('devnet_receipt_payer_is_not_this_wallet');
    return (0, direct_auth_1.directPaymentProofHeaders)({ network: input.receipt.network, txSignature, payTo: input.receipt.payTo, body: input.body, sign: (0, direct_auth_1.keypairSigner)(payer) });
}
