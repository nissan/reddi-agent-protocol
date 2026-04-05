"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createX402Middleware = createX402Middleware;
exports.createX402Header = createX402Header;
const payment_1 = require("./payment");
const nonce_1 = require("./nonce");
/**
 * Express middleware for x402 payment processing
 * Intercepts requests with x402-request header, validates, and sends payment
 */
function createX402Middleware() {
    return async (req, res, next) => {
        // Check for x402-request header
        const header = req.headers['x402-request'];
        if (!header) {
            return next(); // Not an x402 payment request, continue
        }
        try {
            // Parse the header
            const x402req = (0, payment_1.parseX402Header)(header);
            // Validate payment address format
            if (!(0, payment_1.isValidPaymentAddress)(x402req.paymentAddress)) {
                return res.status(400).json({
                    error: 'invalid_request',
                    detail: 'paymentAddress format invalid',
                });
            }
            // Check for replay attack (duplicate nonce)
            if (!(0, nonce_1.checkAndStoreNonce)(x402req.nonce)) {
                return res.status(409).json({
                    error: 'duplicate_nonce',
                    detail: 'This nonce has already been used',
                });
            }
            // Send the payment (Phase 2 will implement actual Solana transfer)
            const receipt = await (0, payment_1.sendPayment)(x402req);
            // Set response headers
            res.setHeader('x402-payment', JSON.stringify(receipt));
            res.status(200).json({
                message: 'payment_processed',
                receipt,
            });
        }
        catch (error) {
            // Handle different error types
            if (error.message.includes('JSON')) {
                return res.status(400).json({
                    error: 'invalid_request',
                    detail: error.message,
                });
            }
            if (error.message.includes('timeout')) {
                return res.status(503).json({
                    error: 'rpc_timeout',
                    detail: 'Payment confirmation timeout',
                });
            }
            // Generic error
            return res.status(400).json({
                error: 'invalid_request',
                detail: error.message,
            });
        }
    };
}
/**
 * Helper: Create x402-request header from components
 */
function createX402Header(amount, paymentAddress, nonce, currency = 'SOL') {
    return JSON.stringify({ amount, currency, paymentAddress, nonce });
}
