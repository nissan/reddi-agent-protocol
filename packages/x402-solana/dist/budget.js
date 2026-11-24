"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESERVATION_STATES = exports.MAX_TOKEN_BUDGET_BASE_UNITS = exports.MAX_SOL_BUDGET_LAMPORTS = exports.RESERVATION_ACCOUNT_LEN = exports.BUDGET_ACCOUNT_LEN = exports.BUDGET_FLAG_CLOSED = exports.BUDGET_FLAG_SPENDER_WAIVES = exports.BUDGET_ALLOWLIST_LEN = exports.MAX_BUDGET_RESERVATIONS = exports.MIN_REVIEW_SLOTS = exports.MAX_BUDGET_JUDGE_SLOTS = exports.MIN_BUDGET_JUDGE_SLOTS = exports.MAX_BUDGET_WINDOW_SLOTS = exports.MIN_BUDGET_WINDOW_SLOTS = exports.BUDGET_DISCRIMINATORS = void 0;
exports.budgetAddress = budgetAddress;
exports.budgetVaultAddress = budgetVaultAddress;
exports.reservationAddress = reservationAddress;
exports.minReservation = minReservation;
exports.budgetWindowsValid = budgetWindowsValid;
exports.openBudgetInstruction = openBudgetInstruction;
exports.reserveInstruction = reserveInstruction;
exports.setPayoutAccountInstruction = setPayoutAccountInstruction;
exports.postFinalInstruction = postFinalInstruction;
exports.waiveInstruction = waiveInstruction;
exports.disputeInstruction = disputeInstruction;
exports.closeBudgetInstruction = closeBudgetInstruction;
exports.payoutInstruction = payoutInstruction;
exports.resolveInstruction = resolveInstruction;
exports.decodeBudget = decodeBudget;
exports.decodeReservation = decodeReservation;
exports.disputeEnds = disputeEnds;
exports.judgeEnds = judgeEnds;
/**
 * Pooled budget: client side of the thirteen budget instructions of
 * `programs/pinocchio-escrow` (README "Pooled budget").
 * `programs/pinocchio-escrow/interface/vectors.json` is the interface;
 * `tests/budget.test.ts` holds every builder and decoder here to that file
 * byte for byte.
 *
 * Nothing here signs or sends. Browser-safe: no `node:crypto`.
 *
 * A person (the payer) locks one total in one token for an open period and
 * names a spender key that their agent holds instead of a wallet. While the
 * budget is open:
 *
 * - the agent's spender key and a provider together reserve a slice for that
 *   provider (`reserveInstruction`, both sign; the same call with a higher
 *   amount raises it);
 * - calls are metered off chain against the slice, and the provider posts
 *   what it is owed, at most its slice (`postFinalInstruction`; a re-post may
 *   only go down);
 * - the payer (or the spender, when the budget allows it) waives disputes on
 *   a posted slice (`waiveInstruction`) so it can be paid at once, or disputes
 *   it (`disputeInstruction`) for the judge.
 *
 * The payer or the spender closes the budget (`closeBudgetInstruction`), or
 * anyone once the open period has ended; what was never reserved goes back at
 * once. A slice is paid (`payoutInstruction`, by anyone) once waived, once its
 * dispute window ended undisputed (`disputeEnds`), or as a full refund once
 * the judge's window ended without a ruling (`judgeEnds`); the judge splits a
 * disputed one (`resolveInstruction`). The same payout call closes a slice
 * that was paid early, once its budget is closed or gone.
 *
 * Every instruction after the open names the budget by its `createdSlot`
 * (read it with `decodeBudget`) and is refused in the slot it was opened in.
 */
const web3_js_1 = require("@solana/web3.js");
/**
 * Anchor-style discriminators: the first 8 bytes of sha256("<kind>:<name>").
 * Fixed here so the module loads in a browser bundle; a test recomputes each.
 */
exports.BUDGET_DISCRIMINATORS = Object.freeze({
    'global:open_budget': [187, 44, 51, 199, 222, 25, 238, 87],
    'global:open_token_budget': [63, 156, 226, 194, 14, 151, 157, 93],
    'global:reserve': [92, 99, 244, 209, 28, 65, 213, 157],
    'global:set_payout_account': [242, 33, 233, 54, 165, 178, 249, 17],
    'global:post_final': [253, 253, 111, 45, 129, 92, 136, 65],
    'global:waive': [46, 174, 207, 55, 225, 210, 160, 200],
    'global:dispute': [216, 92, 128, 146, 202, 85, 135, 73],
    'global:close_budget': [205, 29, 212, 191, 194, 200, 168, 24],
    'global:close_token_budget': [169, 17, 44, 254, 33, 103, 4, 164],
    'global:payout_budget': [62, 61, 230, 254, 1, 68, 143, 254],
    'global:payout_token_budget': [157, 133, 28, 120, 154, 49, 32, 252],
    'global:resolve_budget': [121, 133, 16, 16, 247, 84, 16, 86],
    'global:resolve_token_budget': [212, 208, 203, 182, 51, 186, 157, 241],
    'account:Budget': [35, 151, 58, 65, 187, 148, 119, 218],
    'account:Reservation': [188, 235, 0, 111, 208, 253, 247, 212],
});
function disc(name) {
    const bytes = exports.BUDGET_DISCRIMINATORS[name];
    if (!bytes)
        throw new Error(`unknown discriminator ${name}`);
    return Buffer.from(bytes);
}
/** Open period and dispute window: about an hour to about 7 days. */
exports.MIN_BUDGET_WINDOW_SLOTS = 9000n;
exports.MAX_BUDGET_WINDOW_SLOTS = 1512000n;
/** The judge's window: about 10 minutes to about 14 days. */
exports.MIN_BUDGET_JUDGE_SLOTS = 1500n;
exports.MAX_BUDGET_JUDGE_SLOTS = 3024000n;
/** After each post the payer has at least this long to dispute: about an hour. */
exports.MIN_REVIEW_SLOTS = 9000n;
exports.MAX_BUDGET_RESERVATIONS = 8;
exports.BUDGET_ALLOWLIST_LEN = 4;
/** Budget flag: the spender may waive disputes for the payer (needs an allowlist). */
exports.BUDGET_FLAG_SPENDER_WAIVES = 0x01;
/** Budget flag set by a close. */
exports.BUDGET_FLAG_CLOSED = 0x02;
exports.BUDGET_ACCOUNT_LEN = 349;
exports.RESERVATION_ACCOUNT_LEN = 147;
/** Caps the program applies to one budget, as for one escrow. */
exports.MAX_SOL_BUDGET_LAMPORTS = 500000000n;
exports.MAX_TOKEN_BUDGET_BASE_UNITS = 100000000n;
exports.RESERVATION_STATES = ['open', 'posted', 'disputed', 'paid'];
const ZERO = new web3_js_1.PublicKey(new Uint8Array(32));
/** The budget of `payer` with this 16-byte nonce: `["budget", payer, nonce]`. */
function budgetAddress(payer, nonce, programId) {
    if (nonce.length !== 16)
        throw new Error('nonce must be 16 bytes');
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('budget'), payer.toBuffer(), Buffer.from(nonce)], programId)[0];
}
/** A token budget's vault, a token account owned by the budget: `["budget-vault", budget]`. */
function budgetVaultAddress(budget, programId) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('budget-vault'), budget.toBuffer()], programId)[0];
}
/** A provider's slice of a budget: `["reservation", budget, payee]`. */
function reservationAddress(budget, payee, programId) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('reservation'), budget.toBuffer(), payee.toBuffer()], programId)[0];
}
/** A registry record, `["agent", owner]` of the same program. */
function agentAddress(owner, programId) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('agent'), owner.toBuffer()], programId)[0];
}
/** The smallest slice of a budget of `total`: 1% of it, at least one base unit. */
function minReservation(total) {
    const floor = total / 100n;
    return floor === 0n ? 1n : floor;
}
/** Whether the program would take these windows. */
function budgetWindowsValid(openSlots, disputeSlots, judgeSlots) {
    return (openSlots >= exports.MIN_BUDGET_WINDOW_SLOTS &&
        openSlots <= exports.MAX_BUDGET_WINDOW_SLOTS &&
        disputeSlots >= exports.MIN_BUDGET_WINDOW_SLOTS &&
        disputeSlots <= exports.MAX_BUDGET_WINDOW_SLOTS &&
        judgeSlots >= exports.MIN_BUDGET_JUDGE_SLOTS &&
        judgeSlots <= exports.MAX_BUDGET_JUDGE_SLOTS);
}
function u64(value, what) {
    if (value < 0n || value > 0xffffffffffffffffn)
        throw new Error(`${what} must be a u64`);
    const out = Buffer.alloc(8);
    out.writeBigUInt64LE(value);
    return out;
}
const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey, isSigner, isWritable });
/**
 * `open_budget` or, with `token`, `open_token_budget`, by the payer. Checks
 * what the program checks about the terms, so a refused open fails here
 * first.
 */
function openBudgetInstruction(input) {
    const allowlist = input.allowlist ?? [];
    const cap = input.perProviderCap ?? 0n;
    if (allowlist.length > exports.BUDGET_ALLOWLIST_LEN)
        throw new Error(`at most ${exports.BUDGET_ALLOWLIST_LEN} allowlisted providers`);
    if (!budgetWindowsValid(input.openSlots, input.disputeSlots, input.judgeSlots))
        throw new Error('budget windows out of range');
    if (input.total <= 0n)
        throw new Error('total must be positive');
    if (input.total > (input.token ? exports.MAX_TOKEN_BUDGET_BASE_UNITS : exports.MAX_SOL_BUDGET_LAMPORTS))
        throw new Error('total above the per-budget cap');
    if (cap > input.total)
        throw new Error('perProviderCap above the total');
    if (!input.judge && allowlist.length === 0)
        throw new Error('a budget needs a judge or an allowlist');
    if (input.spenderMayWaive && allowlist.length === 0)
        throw new Error('the spender may waive only with an allowlist');
    if (input.judge && (input.judge.equals(input.payer) || input.judge.equals(input.spender)))
        throw new Error('the judge must not be the payer or the spender');
    const budget = budgetAddress(input.payer, input.nonce, input.programId);
    const entries = [...allowlist, ...Array(exports.BUDGET_ALLOWLIST_LEN - allowlist.length).fill(ZERO)];
    const data = Buffer.concat([
        disc(input.token ? 'global:open_token_budget' : 'global:open_budget'),
        Buffer.from(input.nonce),
        input.spender.toBuffer(),
        (input.judge ?? ZERO).toBuffer(),
        u64(input.openSlots, 'openSlots'),
        u64(input.disputeSlots, 'disputeSlots'),
        u64(input.judgeSlots, 'judgeSlots'),
        u64(input.total, 'total'),
        u64(cap, 'perProviderCap'),
        Buffer.from([input.spenderMayWaive ? exports.BUDGET_FLAG_SPENDER_WAIVES : 0]),
        ...entries.map((entry) => entry.toBuffer()),
    ]);
    const judge = input.judge ? [meta(agentAddress(input.judge, input.programId))] : [];
    const keys = input.token
        ? [
            meta(budget, true),
            meta(budgetVaultAddress(budget, input.programId), true),
            meta(input.payer, true, true),
            meta(input.token.mint),
            meta(input.token.source, true),
            meta(input.token.tokenProgram),
            meta(web3_js_1.SystemProgram.programId),
            ...judge,
        ]
        : [meta(budget, true), meta(input.payer, true, true), meta(web3_js_1.SystemProgram.programId), ...judge];
    return new web3_js_1.TransactionInstruction({ programId: input.programId, data, keys });
}
/**
 * `reserve`, signed by the spender and the payee (the payee pays the fee and
 * the reservation's rent). `amount` is the slice's new total: a raise sends
 * the higher total. `payoutAccount` is where the payee is paid: the payee
 * itself for SOL (the default), a token account of the budget's mint it owns
 * for tokens.
 */
function reserveInstruction(input) {
    return new web3_js_1.TransactionInstruction({
        programId: input.programId,
        data: Buffer.concat([disc('global:reserve'), u64(input.createdSlot, 'createdSlot'), u64(input.amount, 'amount')]),
        keys: [
            meta(input.budget, true),
            meta(reservationAddress(input.budget, input.payee, input.programId), true),
            meta(input.spender, false, true),
            meta(input.payee, true, true),
            meta(agentAddress(input.payee, input.programId)),
            meta(input.payoutAccount ?? input.payee),
            meta(web3_js_1.SystemProgram.programId),
        ],
    });
}
/** `set_payout_account`, by the payee, while its slice is open or posted. */
function setPayoutAccountInstruction(input) {
    return new web3_js_1.TransactionInstruction({
        programId: input.programId,
        data: Buffer.concat([disc('global:set_payout_account'), u64(input.createdSlot, 'createdSlot')]),
        keys: [
            meta(input.budget),
            meta(reservationAddress(input.budget, input.payee, input.programId), true),
            meta(input.payee, false, true),
            meta(input.payoutAccount),
        ],
    });
}
/** `post_final`, by the payee: what it is owed, at most its slice; a re-post may only go down. */
function postFinalInstruction(input) {
    return new web3_js_1.TransactionInstruction({
        programId: input.programId,
        data: Buffer.concat([disc('global:post_final'), u64(input.createdSlot, 'createdSlot'), u64(input.amount, 'amount')]),
        keys: [meta(input.budget), meta(reservationAddress(input.budget, input.payee, input.programId), true), meta(input.payee, false, true)],
    });
}
function hold(name, input) {
    return new web3_js_1.TransactionInstruction({
        programId: input.programId,
        data: Buffer.concat([disc(name), u64(input.createdSlot, 'createdSlot')]),
        keys: [meta(input.budget), meta(reservationAddress(input.budget, input.payee, input.programId), true), meta(input.signer, false, true)],
    });
}
/** `waive`, by the payer (or the spender on a budget that allows it), on a posted slice: it can be paid at once. */
function waiveInstruction(input) {
    return hold('global:waive', input);
}
/** `dispute`, by the payer, on a posted slice of a budget with a judge, before `disputeEnds`. */
function disputeInstruction(input) {
    return hold('global:dispute', { ...input, signer: input.payer });
}
/**
 * `close_budget` or, with `token`, `close_token_budget`: by the payer or the
 * spender any time, by anyone after the open period. Pass `memoProgram` (the
 * SPL Memo program) when the refund account requires incoming memos.
 */
function closeBudgetInstruction(input) {
    const created = u64(input.createdSlot, 'createdSlot');
    if (!input.token) {
        return new web3_js_1.TransactionInstruction({
            programId: input.programId,
            data: Buffer.concat([disc('global:close_budget'), created]),
            keys: [meta(input.budget, true), meta(input.signer, false, true), meta(input.payer, true)],
        });
    }
    return new web3_js_1.TransactionInstruction({
        programId: input.programId,
        data: Buffer.concat([disc('global:close_token_budget'), created]),
        keys: [
            meta(input.budget, true),
            meta(budgetVaultAddress(input.budget, input.programId), true),
            meta(input.signer, false, true),
            meta(input.payer, true),
            meta(input.token.mint),
            meta(input.token.refund, true),
            meta(input.token.tokenProgram),
            ...(input.memoProgram ? [meta(input.memoProgram)] : []),
        ],
    });
}
function exitKeys(input, judge) {
    const reservation = reservationAddress(input.budget, input.payee, input.programId);
    const tail = [...(judge ? [meta(judge, false, true)] : []), ...(input.memoProgram ? [meta(input.memoProgram)] : [])];
    if (!input.token) {
        return [meta(input.budget, true), meta(reservation, true), meta(input.payee, true), meta(input.payer, true), meta(input.treasury, true), ...tail];
    }
    return [
        meta(input.budget, true),
        meta(budgetVaultAddress(input.budget, input.programId), true),
        meta(reservation, true),
        meta(input.payee, true),
        meta(input.payer, true),
        meta(input.token.mint),
        meta(input.token.payoutAccount, true),
        meta(input.token.treasuryToken, true),
        meta(input.token.refund, true),
        meta(input.token.tokenProgram),
        ...tail,
    ];
}
/**
 * `payout_budget` or, with `token`, `payout_token_budget`, by anyone: pays a
 * waived slice, one whose dispute window ended, or refunds one whose judge
 * did not rule in time; closes a slice paid early once its budget is closed
 * or gone. `treasury` is unused for a token budget but kept so one input
 * shape serves both.
 */
function payoutInstruction(input) {
    return new web3_js_1.TransactionInstruction({
        programId: input.programId,
        data: Buffer.concat([disc(input.token ? 'global:payout_token_budget' : 'global:payout_budget'), u64(input.createdSlot, 'createdSlot')]),
        keys: exitKeys(input),
    });
}
/** `resolve_budget` or `resolve_token_budget`, by the judge: `payout` (at most the posted amount) to the payee before the fee. */
function resolveInstruction(input) {
    return new web3_js_1.TransactionInstruction({
        programId: input.programId,
        data: Buffer.concat([
            disc(input.token ? 'global:resolve_token_budget' : 'global:resolve_budget'),
            u64(input.createdSlot, 'createdSlot'),
            u64(input.payout, 'payout'),
        ]),
        keys: exitKeys(input, input.judge),
    });
}
/** Reads a budget account. Throws for bytes that are not one. */
function decodeBudget(accountData) {
    const data = Buffer.from(accountData);
    if (data.length < exports.BUDGET_ACCOUNT_LEN || !data.subarray(0, 8).equals(disc('account:Budget')))
        throw new Error('invalid budget account');
    const key = (at) => new web3_js_1.PublicKey(data.subarray(at, at + 32));
    const optional = (at) => (key(at).equals(ZERO) ? null : key(at));
    const allowlist = [];
    for (let i = 0; i < exports.BUDGET_ALLOWLIST_LEN; i++) {
        const entry = key(208 + 32 * i);
        if (!entry.equals(ZERO))
            allowlist.push(entry);
    }
    const createdSlot = data.readBigUInt64LE(152);
    const openSlots = data.readBigUInt64LE(160);
    return {
        payer: key(8),
        spender: key(40),
        judge: optional(72),
        mint: optional(104),
        nonce: Uint8Array.from(data.subarray(136, 152)),
        createdSlot,
        openSlots,
        disputeSlots: data.readBigUInt64LE(168),
        judgeSlots: data.readBigUInt64LE(176),
        total: data.readBigUInt64LE(184),
        unreserved: data.readBigUInt64LE(192),
        perProviderCap: data.readBigUInt64LE(200),
        allowlist,
        closedSlot: data.readBigUInt64LE(336),
        reservations: data[344],
        unsettled: data[345],
        spenderMayWaive: (data[346] & exports.BUDGET_FLAG_SPENDER_WAIVES) !== 0,
        closed: (data[346] & exports.BUDGET_FLAG_CLOSED) !== 0,
        openEnds: createdSlot + openSlots,
    };
}
/** Reads a reservation account. Throws for bytes that are not one. */
function decodeReservation(accountData) {
    const data = Buffer.from(accountData);
    if (data.length < exports.RESERVATION_ACCOUNT_LEN || !data.subarray(0, 8).equals(disc('account:Reservation')))
        throw new Error('invalid reservation account');
    const state = exports.RESERVATION_STATES[data[144]];
    if (state === undefined)
        throw new Error('invalid reservation state');
    return {
        budget: new web3_js_1.PublicKey(data.subarray(8, 40)),
        budgetCreatedSlot: data.readBigUInt64LE(40),
        payee: new web3_js_1.PublicKey(data.subarray(48, 80)),
        payoutAccount: new web3_js_1.PublicKey(data.subarray(80, 112)),
        reserved: data.readBigUInt64LE(112),
        finalAmount: data.readBigUInt64LE(120),
        lastPostSlot: data.readBigUInt64LE(128),
        disputedSlot: data.readBigUInt64LE(136),
        state,
        waived: data[145] !== 0,
    };
}
/**
 * The first slot at which the payer can no longer dispute `reservation`, and
 * at which an undisputed one may be paid: the budget's dispute window from
 * its close, never earlier than `MIN_REVIEW_SLOTS` after the last post. Null
 * while the budget is open (the window has not started).
 */
function disputeEnds(budget, reservation) {
    if (!budget.closed)
        return null;
    const window = budget.closedSlot + budget.disputeSlots;
    const review = reservation.lastPostSlot + exports.MIN_REVIEW_SLOTS;
    return review > window ? review : window;
}
/** The first slot at which a disputed reservation refunds in full without the judge. Null unless disputed. */
function judgeEnds(budget, reservation) {
    if (reservation.state !== 'disputed')
        return null;
    return reservation.disputedSlot + budget.judgeSlots;
}
