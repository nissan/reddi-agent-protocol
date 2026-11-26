#!/usr/bin/env node
"use strict";
/**
 * `npx @redditech/x402-solana budget status|close|payout|freeze <budget>`:
 * a payer's way to look after a pooled budget with nothing but its address,
 * an RPC endpoint and their own wallet (#1209). No app, relay or account is
 * needed for `status`, `close` and `payout`: they read the chain and send
 * ordinary transactions. `freeze` asks a relay's signer to stop signing for
 * the budget, on the payer's signature.
 *
 * The keypair file (`--keypair`, a Solana CLI JSON file) is read on this
 * machine only, to sign; it is never sent anywhere. Without it, `close` and
 * `payout` print the unsigned transactions (base64) to sign in a wallet.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultIo = exports.USAGE = void 0;
exports.runCli = runCli;
const node_fs_1 = require("node:fs");
const web3_js_1 = require("@solana/web3.js");
const budget_recover_1 = require("./budget-recover");
const ed25519_1 = require("./ed25519");
exports.USAGE = `Usage: x402-solana budget <command> <budget address> [options]

Commands
  status   Show the budget and each provider's slice, read from the chain.
  close    Close the budget: what was never reserved returns to the payer at once.
           The payer can close at any time; anyone can once the open period has ended.
  payout   Settle every slice that can be settled now: pays what a provider posted
           and returns the rest (or all of an unposted or timed-out slice) to the payer.
  freeze   Ask the relay's signer to sign nothing more for this budget (leaked agent key).
           Signed by the payer's wallet. The budget can still be closed.

Options
  --rpc <url>        Solana RPC endpoint (or SOLANA_RPC_URL). Needed by status, close, payout.
  --keypair <path>   Solana CLI keypair file that signs and pays the fee. For close before the
                     open period ends, and for freeze, it must be the payer's.
  --program <id>     The program, default ${budget_recover_1.BUDGET_PROGRAM_ID.toBase58()}.
  --signer <url>     For freeze: the relay signer's https origin.
  --network <name>   For freeze without --rpc: solana-mainnet-beta or solana-devnet.
  --json             Print status as JSON.
`;
function connectionChain(rpc, programId) {
    const connection = new web3_js_1.Connection(rpc, 'confirmed');
    return {
        ...(0, budget_recover_1.budgetRecoverReader)(connection, programId),
        genesisHash: () => connection.getGenesisHash(),
        latestBlockhash: async () => (await connection.getLatestBlockhash('confirmed')).blockhash,
        async sendAndConfirm(tx) {
            const signature = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' });
            for (let i = 0; i < 60; i += 1) {
                const status = (await connection.getSignatureStatuses([signature])).value[0];
                if (status?.err)
                    throw new Error(`the transaction failed on chain: ${JSON.stringify(status.err)} (${signature})`);
                if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized')
                    return signature;
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            throw new Error(`not confirmed in time; check ${signature} before sending again`);
        },
    };
}
const defaultIo = () => ({
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    env: process.env,
    readFile: (path) => (0, node_fs_1.readFileSync)(path, 'utf8'),
    nowMs: () => Date.now(),
    fetch: async (url, init) => {
        const response = await fetch(url, init);
        return { status: response.status, text: () => response.text() };
    },
    chain: connectionChain,
});
exports.defaultIo = defaultIo;
class CliError extends Error {
}
const fail = (message) => {
    throw new CliError(message);
};
const VALUE_FLAGS = ['rpc', 'keypair', 'program', 'signer', 'network'];
function parse(argv) {
    const words = [];
    const flags = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--json')
            flags.json = true;
        else if (arg.startsWith('--')) {
            const name = arg.slice(2);
            if (!VALUE_FLAGS.includes(name))
                fail(`Unknown option ${arg}.`);
            const value = argv[i + 1];
            if (value === undefined || value.startsWith('--'))
                fail(`${arg} needs a value.`);
            flags[name] = value;
            i += 1;
        }
        else
            words.push(arg);
    }
    return { words, flags };
}
function publicKey(value, what) {
    try {
        return new web3_js_1.PublicKey(value ?? '');
    }
    catch {
        return fail(`${what} is not a Solana address.`);
    }
}
function keypair(path, io) {
    try {
        const bytes = JSON.parse(io.readFile(path));
        if (!Array.isArray(bytes) || bytes.length !== 64)
            throw new Error('not a keypair file');
        return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(bytes));
    }
    catch {
        // Never echo the file's contents.
        return fail(`Could not read a Solana keypair from ${path} (expected the JSON array the Solana CLI writes).`);
    }
}
function networkOf(genesis) {
    return Object.keys(budget_recover_1.BUDGET_GENESIS_HASH).find((n) => budget_recover_1.BUDGET_GENESIS_HASH[n] === genesis);
}
function describe(status, network) {
    const a = status.account;
    const unit = a.mint ? `base units of ${a.mint.toBase58()}` : 'lamports';
    const lines = [
        `Budget ${status.budget.toBase58()} on ${network}`,
        `  payer            ${a.payer.toBase58()}`,
        `  token            ${a.mint ? a.mint.toBase58() : 'SOL'}`,
        `  total            ${a.total} ${unit}`,
        `  never reserved   ${a.unreserved} (returns to the payer at the close)`,
        `  state            ${a.closed ? `closed at slot ${a.closedSlot}` : status.anyoneMayClose ? 'open; the open period has ended, anyone may close it' : `open until slot ${a.openEnds} (now ${status.slot}); the payer may close it now`}`,
        `  judge            ${a.judge ? a.judge.toBase58() : 'none'}`,
        `  slices           ${status.slices.length}`,
    ];
    for (const slice of status.slices) {
        const r = slice.reservation;
        lines.push(`  - provider ${r.payee.toBase58()}: ${r.state}${r.waived ? ' (waived)' : ''}, reserved ${r.reserved}, posted ${r.state === 'open' ? '-' : r.finalAmount}`, `      ${slice.payable ? 'payout now' : slice.payableAtSlot !== null ? `payout from slot ${slice.payableAtSlot}` : 'not payable yet'}: ${slice.note}`);
    }
    return lines;
}
const jsonStatus = (status, network) => ({
    network,
    budget: status.budget.toBase58(),
    slot: status.slot.toString(),
    payer: status.account.payer.toBase58(),
    mint: status.account.mint?.toBase58() ?? null,
    total: status.account.total.toString(),
    unreserved: status.account.unreserved.toString(),
    closed: status.account.closed,
    openEnds: status.account.openEnds.toString(),
    anyoneMayClose: status.anyoneMayClose,
    judge: status.account.judge?.toBase58() ?? null,
    slices: status.slices.map((s) => ({
        address: s.address.toBase58(),
        provider: s.reservation.payee.toBase58(),
        state: s.reservation.state,
        waived: s.reservation.waived,
        reserved: s.reservation.reserved.toString(),
        posted: s.reservation.finalAmount.toString(),
        payable: s.payable,
        payableAtSlot: s.payableAtSlot?.toString() ?? null,
        note: s.note,
    })),
});
async function send(chain, instructions, feePayer, signer, io, label) {
    const tx = new web3_js_1.Transaction({ feePayer, recentBlockhash: await chain.latestBlockhash() });
    tx.add(...instructions);
    if (!signer) {
        io.out(`${label}: unsigned transaction (base64), fee payer ${feePayer.toBase58()}. Sign and send it with your wallet within about a minute:`);
        io.out(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'));
        return;
    }
    tx.sign(signer);
    io.out(`${label}: sent, confirmed as ${await chain.sendAndConfirm(tx)}`);
}
async function freeze(budget, flags, io) {
    const origin = (() => {
        try {
            const url = new URL(flags.signer ?? fail('freeze needs --signer <the relay signer\'s https origin>.'));
            return url.protocol === 'https:' && (url.pathname === '/' || url.pathname === '') && !url.search && !url.username ? url.origin : undefined;
        }
        catch (error) {
            if (error instanceof CliError)
                throw error;
            return undefined;
        }
    })();
    if (!origin)
        fail('--signer must be an https origin with nothing after it.');
    const payer = keypair(flags.keypair ?? fail('freeze needs --keypair <the payer\'s keypair file>: only the payer can freeze a budget.'), io);
    let network = flags.network;
    const rpc = flags.rpc ?? io.env.SOLANA_RPC_URL;
    if (!network && rpc)
        network = networkOf(await io.chain(rpc, budget_recover_1.BUDGET_PROGRAM_ID).genesisHash());
    if (network !== 'solana-devnet' && network !== 'solana-mainnet-beta')
        fail('freeze needs --network solana-mainnet-beta or solana-devnet (or --rpc to read it from).');
    const request = { network: network, budget: budget.toBase58(), payer: payer.publicKey.toBase58(), issuedAt: Math.floor(io.nowMs() / 1000) };
    const signature = Buffer.from((0, ed25519_1.ed25519Sign)(payer, (0, budget_recover_1.budgetFreezeMessage)(request))).toString('base64');
    const response = await io.fetch(`${origin}/api/v1/freeze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, signature }) });
    const text = (await response.text()).slice(0, 500);
    if (response.status !== 200)
        fail(`The signer refused (${response.status}): ${text}`);
    io.out(`Frozen: the signer signs nothing more for ${request.budget}, except its close.`);
    io.out('Next: run `budget close` to get back what was never reserved, then `budget payout` once slices can be settled.');
}
/** Runs one command. Returns the process exit code. */
async function runCli(argv, io = (0, exports.defaultIo)()) {
    try {
        const { words, flags } = parse(argv);
        if (words.length === 0 || words[0] === 'help') {
            io.out(exports.USAGE);
            return 0;
        }
        const [group, command, address] = words;
        if (group !== 'budget' || !['status', 'close', 'payout', 'freeze'].includes(command ?? '') || words.length !== 3) {
            io.err(exports.USAGE);
            return 2;
        }
        const budget = publicKey(address, 'The budget');
        if (command === 'freeze') {
            await freeze(budget, flags, io);
            return 0;
        }
        const rpc = flags.rpc ?? io.env.SOLANA_RPC_URL ?? fail('Give an RPC endpoint with --rpc <url> (or SOLANA_RPC_URL).');
        const programId = flags.program ? publicKey(flags.program, '--program') : budget_recover_1.BUDGET_PROGRAM_ID;
        const chain = io.chain(rpc, programId);
        const network = networkOf(await chain.genesisHash()) ?? fail('That RPC is not Solana mainnet or devnet.');
        const status = await (0, budget_recover_1.readBudgetStatus)(chain, budget, programId);
        if (!status.found) {
            return fail(status.reason === 'no_account'
                ? `No account at ${budget.toBase58()} on ${network}. A budget's account goes away once it is closed and every slice is settled, so there may be nothing left to collect. Check the address and the network.`
                : `${budget.toBase58()} is not a budget of program ${programId.toBase58()} on ${network}.`);
        }
        if (command === 'status') {
            if (flags.json)
                io.out(JSON.stringify(jsonStatus(status, network), null, 2));
            else
                for (const line of describe(status, network))
                    io.out(line);
            return 0;
        }
        const signer = flags.keypair ? keypair(flags.keypair, io) : undefined;
        const feePayer = signer?.publicKey ?? status.account.payer;
        if (command === 'close') {
            if (!status.open)
                fail('This budget is already closed. Run `budget payout` to settle its slices.');
            if (!feePayer.equals(status.account.payer) && !status.anyoneMayClose) {
                fail(`Before the open period ends (slot ${status.account.openEnds}, now ${status.slot}) only the payer ${status.account.payer.toBase58()} can close this budget: use the payer's keypair.`);
            }
            await send(chain, (0, budget_recover_1.closeBudgetInstructions)(status, feePayer), feePayer, signer, io, 'Close');
            io.out(`What was never reserved (${status.account.unreserved}) returns to ${status.account.payer.toBase58()}. Run \`budget status\` to see when each slice can be settled.`);
            return 0;
        }
        const groups = (0, budget_recover_1.payoutBudgetInstructions)(status, feePayer);
        if (groups.length === 0) {
            io.out('No slice can be settled right now:');
            for (const line of describe(status, network).slice(8))
                io.out(line);
            return 0;
        }
        for (const group of groups) {
            await send(chain, group.instructions, feePayer, signer, io, `Payout for provider ${group.slice.reservation.payee.toBase58()}`);
        }
        return 0;
    }
    catch (error) {
        if (error instanceof CliError) {
            io.err(error.message);
            return 1;
        }
        io.err(error instanceof Error ? error.message : 'failed');
        return 1;
    }
}
if (require.main === module) {
    void runCli(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    });
}
