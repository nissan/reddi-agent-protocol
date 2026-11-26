"use strict";
/**
 * What a payer needs to look after a pooled budget without any app (#1209):
 * read it from the chain, close it, and collect what is owed back, from the
 * budget's address alone; and the message a payer signs to have a relay's
 * signer stop signing for a budget whose agent key leaked.
 *
 * Everything here reads public chain data and builds instructions. Nothing
 * here holds a key or sends a transaction: the caller signs and sends
 * (`./cli` does both for a keypair file the payer names).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUDGET_FREEZE_MAX_AHEAD_SECONDS = exports.BUDGET_FREEZE_MAX_AGE_SECONDS = exports.BUDGET_GENESIS_HASH = exports.BUDGET_PROGRAM_ID = void 0;
exports.budgetFreezeMessage = budgetFreezeMessage;
exports.budgetRecoverReader = budgetRecoverReader;
exports.readBudgetStatus = readBudgetStatus;
exports.closeBudgetInstructions = closeBudgetInstructions;
exports.payoutBudgetInstructions = payoutBudgetInstructions;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const budget_1 = require("./budget");
const token_escrow_1 = require("./token-escrow");
/** The V1 program, at the same address on devnet and mainnet. */
exports.BUDGET_PROGRAM_ID = new web3_js_1.PublicKey('DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu');
const MEMO_PROGRAM_ID = new web3_js_1.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
/** Each network's genesis hash, to tell an RPC on the wrong cluster. */
exports.BUDGET_GENESIS_HASH = Object.freeze({
    'solana-devnet': 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    'solana-mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
});
/** How old (or how far ahead) a freeze request may be when the signer gets it, in seconds. */
exports.BUDGET_FREEZE_MAX_AGE_SECONDS = 600;
exports.BUDGET_FREEZE_MAX_AHEAD_SECONDS = 120;
/**
 * The text a payer's wallet signs (Ed25519, as `signMessage` does) to have
 * the relay's signer stop signing for one budget. It can only freeze: a
 * frozen budget gets no further call or reserve approval, and can still be
 * closed. Signing it again later is harmless.
 */
function budgetFreezeMessage(request) {
    return new TextEncoder().encode([
        'Reddi Agent Protocol: freeze my Budget',
        'The RAP relay must sign nothing more for this Budget, except its close.',
        `network: ${request.network}`,
        `payer: ${request.payer}`,
        `budget: ${request.budget}`,
        `issued at: ${request.issuedAt}`,
    ].join('\n'));
}
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
    let n = 0n;
    for (const b of bytes)
        n = (n << 8n) | BigInt(b);
    let out = '';
    while (n > 0n) {
        out = BASE58[Number(n % 58n)] + out;
        n /= 58n;
    }
    for (const b of bytes) {
        if (b !== 0)
            break;
        out = `1${out}`;
    }
    return out;
}
/** A reader over a web3.js `Connection` (or anything shaped like one). */
function budgetRecoverReader(connection, programId = exports.BUDGET_PROGRAM_ID) {
    return {
        async readAccount(address) {
            const info = await connection.getAccountInfo(address);
            return info ? { owner: info.owner, data: Uint8Array.from(info.data) } : null;
        },
        async reservations(budget) {
            const found = await connection.getProgramAccounts(programId, {
                filters: [
                    { dataSize: budget_1.RESERVATION_ACCOUNT_LEN },
                    { memcmp: { offset: 0, bytes: base58(Uint8Array.from(budget_1.BUDGET_DISCRIMINATORS['account:Reservation'])) } },
                    { memcmp: { offset: 8, bytes: budget.toBase58() } },
                ],
            });
            return found.map((x) => ({ address: x.pubkey, data: Uint8Array.from(x.account.data) }));
        },
        async slot() {
            return BigInt(await connection.getSlot());
        },
    };
}
function sliceStatus(budget, address, reservation, slot) {
    const at = (payableAtSlot, note, waiting) => slot >= payableAtSlot ? { address, reservation, payable: true, payableAtSlot: null, note } : { address, reservation, payable: false, payableAtSlot, note: waiting };
    if (reservation.state === 'paid') {
        return budget.closed
            ? { address, reservation, payable: true, payableAtSlot: null, note: 'Already paid; a payout only closes its account.' }
            : { address, reservation, payable: false, payableAtSlot: null, note: 'Already paid; its account closes after the budget does.' };
    }
    if (reservation.state === 'posted' && reservation.waived) {
        return { address, reservation, payable: true, payableAtSlot: null, note: 'Waived: pays the provider what it posted and returns the rest of the slice.' };
    }
    if (reservation.state === 'disputed') {
        return at((0, budget_1.judgeEnds)(budget, reservation), 'The judge did not rule in time: the whole slice returns to the payer.', 'Disputed: waiting for the judge, or for the judge window to end.');
    }
    if (!budget.closed) {
        return { address, reservation, payable: false, payableAtSlot: null, note: 'Close the budget first: the dispute window starts at the close.' };
    }
    const posted = reservation.state === 'posted';
    return at((0, budget_1.disputeEnds)(budget, reservation), posted ? 'The dispute window ended: pays the provider what it posted and returns the rest of the slice.' : 'Nothing was posted: the whole slice returns to the payer.', posted ? 'Posted: payable when the dispute window ends (dispute it before then if it is wrong).' : 'Nothing posted yet: returns to the payer when the dispute window ends.');
}
/** Reads a budget and its slices from its address alone. */
async function readBudgetStatus(reader, budget, programId = exports.BUDGET_PROGRAM_ID) {
    const info = await reader.readAccount(budget);
    if (!info)
        return { found: false, budget, reason: 'no_account' };
    let account;
    try {
        if (!info.owner.equals(programId))
            throw new Error('not owned by the program');
        account = (0, budget_1.decodeBudget)(info.data);
    }
    catch {
        return { found: false, budget, reason: 'not_a_budget' };
    }
    let tokenProgram = null;
    if (account.mint) {
        const mint = await reader.readAccount(account.mint);
        if (!mint || !(mint.owner.equals(spl_token_1.TOKEN_PROGRAM_ID) || mint.owner.equals(spl_token_1.TOKEN_2022_PROGRAM_ID)))
            throw new Error("the budget's mint is not a token mint on this cluster");
        tokenProgram = mint.owner;
    }
    const slot = await reader.slot();
    const slices = [];
    for (const found of await reader.reservations(budget)) {
        let reservation;
        try {
            reservation = (0, budget_1.decodeReservation)(found.data);
        }
        catch {
            continue;
        }
        // A slice of an earlier budget at the same address is not this budget's.
        if (!reservation.budget.equals(budget) || reservation.budgetCreatedSlot !== account.createdSlot)
            continue;
        slices.push(sliceStatus(account, found.address, reservation, slot));
    }
    slices.sort((a, b) => a.address.toBase58().localeCompare(b.address.toBase58()));
    return { found: true, budget, programId, account, slot, tokenProgram, slices, open: !account.closed, anyoneMayClose: !account.closed && slot >= account.openEnds };
}
function payerTokenAccount(status) {
    return (0, spl_token_1.getAssociatedTokenAddressSync)(status.account.mint, status.account.payer, true, status.tokenProgram);
}
const memo = (status) => (status.tokenProgram?.equals(spl_token_1.TOKEN_2022_PROGRAM_ID) ? { memoProgram: MEMO_PROGRAM_ID } : {});
/**
 * The instructions that close a budget: what was never reserved goes back to
 * the payer at once. `signer` is who signs and pays the fee: the payer at any
 * time, anyone once the open period has ended. For a token budget the
 * payer's associated token account is created first if it is missing.
 */
function closeBudgetInstructions(status, signer) {
    if (!status.open)
        throw new Error('budget_already_closed');
    if (!signer.equals(status.account.payer) && !status.anyoneMayClose)
        throw new Error('only_the_payer_may_close_before_the_open_period_ends');
    const base = { programId: status.programId, budget: status.budget, createdSlot: status.account.createdSlot, signer, payer: status.account.payer };
    if (!status.account.mint)
        return [(0, budget_1.closeBudgetInstruction)(base)];
    const refund = payerTokenAccount(status);
    return [
        (0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(signer, refund, status.account.payer, status.account.mint, status.tokenProgram),
        (0, budget_1.closeBudgetInstruction)({ ...base, token: { mint: status.account.mint, refund, tokenProgram: status.tokenProgram }, ...memo(status) }),
    ];
}
/**
 * One group of instructions per slice a payout would settle now (anyone may
 * send them; `feePayer` pays the fee and any missing token account). Send
 * each group as its own transaction. The money can only go to the provider's
 * recorded account, the treasury and the payer.
 */
function payoutBudgetInstructions(status, feePayer, treasury = token_escrow_1.ESCROW_PROTOCOL_TREASURY) {
    return status.slices
        .filter((slice) => slice.payable)
        .map((slice) => {
        const base = { programId: status.programId, budget: status.budget, createdSlot: status.account.createdSlot, payee: slice.reservation.payee, payer: status.account.payer, treasury };
        if (!status.account.mint)
            return { slice, instructions: [(0, budget_1.payoutInstruction)(base)] };
        const mint = status.account.mint;
        const tokenProgram = status.tokenProgram;
        const refund = payerTokenAccount(status);
        const treasuryToken = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, treasury, true, tokenProgram);
        return {
            slice,
            instructions: [
                (0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(feePayer, refund, status.account.payer, mint, tokenProgram),
                (0, budget_1.payoutInstruction)({ ...base, token: { mint, payoutAccount: slice.reservation.payoutAccount, treasuryToken, refund, tokenProgram }, ...memo(status) }),
            ],
        };
    });
}
