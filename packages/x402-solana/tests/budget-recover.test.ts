import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { BUDGET_DISCRIMINATORS, budgetVaultAddress, closeBudgetInstruction, payoutInstruction, reservationAddress } from '../src/budget';
import {
  BUDGET_GENESIS_HASH,
  BUDGET_PROGRAM_ID,
  budgetFreezeMessage,
  closeBudgetInstructions,
  payoutBudgetInstructions,
  readBudgetStatus,
  type BudgetRecoverReader,
} from '../src/budget-recover';
import { ed25519Verify } from '../src/ed25519';
import { ESCROW_PROTOCOL_TREASURY } from '../src/token-escrow';
import { runCli, USAGE, type CliChain, type CliIo } from '../src/cli';

const PROGRAM = BUDGET_PROGRAM_ID;
const CREATED = 5_000_000n;
const OPEN_SLOTS = 20_000n;
const DISPUTE_SLOTS = 9_000n;
const JUDGE_SLOTS = 3_000n;
const wallet = () => Keypair.generate().publicKey;

type B = { payer: PublicKey; mint?: PublicKey; judge?: PublicKey; unreserved?: bigint; closedSlot?: bigint; createdSlot?: bigint };
function budgetBytes(b: B): Uint8Array {
  const d = Buffer.alloc(349);
  Buffer.from(BUDGET_DISCRIMINATORS['account:Budget']).copy(d, 0);
  b.payer.toBuffer().copy(d, 8);
  wallet().toBuffer().copy(d, 40);
  if (b.judge) b.judge.toBuffer().copy(d, 72);
  if (b.mint) b.mint.toBuffer().copy(d, 104);
  d.writeBigUInt64LE(b.createdSlot ?? CREATED, 152);
  d.writeBigUInt64LE(OPEN_SLOTS, 160);
  d.writeBigUInt64LE(DISPUTE_SLOTS, 168);
  d.writeBigUInt64LE(JUDGE_SLOTS, 176);
  d.writeBigUInt64LE(10_000_000n, 184);
  d.writeBigUInt64LE(b.unreserved ?? 4_000_000n, 192);
  d.writeBigUInt64LE(5_000_000n, 200);
  d.writeBigUInt64LE(b.closedSlot ?? 0n, 336);
  d[346] = b.closedSlot ? 0x02 : 0;
  return Uint8Array.from(d);
}

type S = { budget: PublicKey; payee: PublicKey; state: 0 | 1 | 2 | 3; reserved?: bigint; posted?: bigint; postedSlot?: bigint; disputedSlot?: bigint; waived?: boolean; createdSlot?: bigint };
function sliceBytes(r: S): Uint8Array {
  const d = Buffer.alloc(147);
  Buffer.from(BUDGET_DISCRIMINATORS['account:Reservation']).copy(d, 0);
  r.budget.toBuffer().copy(d, 8);
  d.writeBigUInt64LE(r.createdSlot ?? CREATED, 40);
  r.payee.toBuffer().copy(d, 48);
  r.payee.toBuffer().copy(d, 80);
  d.writeBigUInt64LE(r.reserved ?? 2_000_000n, 112);
  d.writeBigUInt64LE(r.posted ?? 0n, 120);
  d.writeBigUInt64LE(r.postedSlot ?? 0n, 128);
  d.writeBigUInt64LE(r.disputedSlot ?? 0n, 136);
  d[144] = r.state;
  d[145] = r.waived ? 1 : 0;
  return Uint8Array.from(d);
}

function world(slot: bigint) {
  const accounts = new Map<string, { owner: PublicKey; data: Uint8Array }>();
  const slices: { address: PublicKey; data: Uint8Array }[] = [];
  const sent: Transaction[] = [];
  const state = { slot, genesis: BUDGET_GENESIS_HASH['solana-mainnet-beta'] };
  const reader: BudgetRecoverReader = {
    readAccount: async (a) => accounts.get(a.toBase58()) ?? null,
    reservations: async (budget) => slices.filter((s) => new PublicKey(s.data.subarray(8, 40)).equals(budget)),
    slot: async () => state.slot,
  };
  const chain: CliChain = {
    ...reader,
    genesisHash: async () => state.genesis,
    latestBlockhash: async () => Keypair.generate().publicKey.toBase58(),
    sendAndConfirm: async (tx) => {
      if (!tx.verifySignatures()) throw new Error('not signed');
      sent.push(tx);
      return `sig${sent.length}`;
    },
  };
  const addBudget = (b: B) => {
    const budget = wallet();
    accounts.set(budget.toBase58(), { owner: PROGRAM, data: budgetBytes(b) });
    return budget;
  };
  const addSlice = (s: S) => {
    const address = reservationAddress(s.budget, s.payee, PROGRAM);
    slices.push({ address, data: sliceBytes(s) });
    return address;
  };
  return { accounts, state, reader, chain, sent, addBudget, addSlice };
}

function io(w: ReturnType<typeof world>, files: Record<string, string> = {}, fetchImpl?: CliIo['fetch']) {
  const out: string[] = [];
  const err: string[] = [];
  const rpcs: string[] = [];
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const cli: CliIo = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    env: {},
    readFile: (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
    nowMs: () => 1_800_000_000_000,
    fetch:
      fetchImpl ??
      (async (url, init) => {
        requests.push({ url, body: JSON.parse(init.body) });
        return { status: 200, text: async () => '{"ok":true}' };
      }),
    chain: (rpc) => {
      rpcs.push(rpc);
      return w.chain;
    },
  };
  return { cli, out, err, rpcs, requests };
}

const keyFile = (k: Keypair) => JSON.stringify([...k.secretKey]);

describe('budget-recover: a payer looks after a budget from its address alone (#1209)', () => {
  it('reads a budget and says what each slice waits for', async () => {
    const w = world(CREATED + 100n);
    const payer = wallet();
    const budget = w.addBudget({ payer, judge: wallet() });
    const [open, posted, waived, paid] = [wallet(), wallet(), wallet(), wallet()];
    w.addSlice({ budget, payee: open, state: 0 });
    w.addSlice({ budget, payee: posted, state: 1, posted: 900n, postedSlot: CREATED + 50n });
    w.addSlice({ budget, payee: waived, state: 1, posted: 700n, postedSlot: CREATED + 50n, waived: true });
    w.addSlice({ budget, payee: paid, state: 3 });
    // A slice of an earlier budget at the same address is not this budget's.
    w.addSlice({ budget, payee: wallet(), state: 1, createdSlot: CREATED - 1n });
    const status = await readBudgetStatus(w.reader, budget);
    if (!status.found) throw new Error('not found');
    expect(status.open).toBe(true);
    expect(status.anyoneMayClose).toBe(false);
    expect(status.slices).toHaveLength(4);
    const of = (p: PublicKey) => status.slices.find((s) => s.reservation.payee.equals(p))!;
    expect(of(open)).toMatchObject({ payable: false, payableAtSlot: null });
    expect(of(posted)).toMatchObject({ payable: false, payableAtSlot: null });
    expect(of(waived).payable).toBe(true);
    expect(of(paid).payable).toBe(false);
    expect(payoutBudgetInstructions(status, payer).map((g) => g.slice.reservation.payee.toBase58())).toEqual([waived.toBase58()]);
    expect(await readBudgetStatus(w.reader, wallet())).toMatchObject({ found: false, reason: 'no_account' });
    const notOurs = wallet();
    w.accounts.set(notOurs.toBase58(), { owner: wallet(), data: budgetBytes({ payer }) });
    expect(await readBudgetStatus(w.reader, notOurs)).toMatchObject({ found: false, reason: 'not_a_budget' });
  });

  it('after the close: slices become payable when the dispute window ends, a disputed one when the judge window ends', async () => {
    const closedSlot = CREATED + 1_000n;
    const w = world(closedSlot + 10n);
    const payer = wallet();
    const budget = w.addBudget({ payer, judge: wallet(), closedSlot });
    const [open, posted, late, disputed, paid] = [wallet(), wallet(), wallet(), wallet(), wallet()];
    w.addSlice({ budget, payee: open, state: 0 });
    w.addSlice({ budget, payee: posted, state: 1, posted: 900n, postedSlot: CREATED + 50n });
    // Posted just before the close: the review time (9,000 slots from the post) is what counts when it is later.
    w.addSlice({ budget, payee: late, state: 1, posted: 900n, postedSlot: closedSlot + 5n });
    w.addSlice({ budget, payee: disputed, state: 2, posted: 900n, postedSlot: CREATED + 50n, disputedSlot: closedSlot + 2n });
    w.addSlice({ budget, payee: paid, state: 3 });
    const at = async (slot: bigint) => {
      w.state.slot = slot;
      const s = await readBudgetStatus(w.reader, budget);
      if (!s.found) throw new Error('not found');
      return Object.fromEntries(s.slices.map((x) => [x.reservation.payee.toBase58(), x]));
    };
    let s = await at(closedSlot + 10n);
    expect(s[open.toBase58()]).toMatchObject({ payable: false, payableAtSlot: closedSlot + DISPUTE_SLOTS });
    expect(s[posted.toBase58()]).toMatchObject({ payable: false, payableAtSlot: closedSlot + DISPUTE_SLOTS });
    expect(s[late.toBase58()]).toMatchObject({ payable: false, payableAtSlot: closedSlot + 5n + 9_000n });
    expect(s[disputed.toBase58()]).toMatchObject({ payable: false, payableAtSlot: closedSlot + 2n + JUDGE_SLOTS });
    expect(s[paid.toBase58()].payable).toBe(true);
    s = await at(closedSlot + 2n + JUDGE_SLOTS);
    expect(s[disputed.toBase58()].payable).toBe(true);
    expect(s[open.toBase58()].payable).toBe(false);
    s = await at(closedSlot + DISPUTE_SLOTS);
    expect(s[open.toBase58()].payable).toBe(true);
    expect(s[posted.toBase58()].payable).toBe(true);
    expect(s[late.toBase58()].payable).toBe(false);
    s = await at(closedSlot + 5n + 9_000n);
    expect(Object.values(s).every((x) => x.payable)).toBe(true);
  });

  it('builds the same close and payout the program builders give, for SOL and for a token budget', async () => {
    const w = world(CREATED + OPEN_SLOTS);
    const payer = wallet();
    const sol = w.addBudget({ payer });
    const waived = wallet();
    w.addSlice({ budget: sol, payee: waived, state: 1, posted: 700n, waived: true });
    const status = await readBudgetStatus(w.reader, sol);
    if (!status.found) throw new Error('not found');
    expect(closeBudgetInstructions(status, payer)).toEqual([closeBudgetInstruction({ programId: PROGRAM, budget: sol, createdSlot: CREATED, signer: payer, payer })]);
    const [group] = payoutBudgetInstructions(status, payer);
    expect(group.instructions).toEqual([payoutInstruction({ programId: PROGRAM, budget: sol, createdSlot: CREATED, payee: waived, payer, treasury: ESCROW_PROTOCOL_TREASURY })]);
    // The open period has ended here, so a stranger may close; before it, only the payer.
    const stranger = wallet();
    expect(closeBudgetInstructions(status, stranger)[0].keys[1]).toMatchObject({ pubkey: stranger, isSigner: true });
    w.state.slot = CREATED + OPEN_SLOTS - 1n;
    const early = await readBudgetStatus(w.reader, sol);
    if (!early.found) throw new Error('not found');
    expect(() => closeBudgetInstructions(early, stranger)).toThrow('only_the_payer_may_close_before_the_open_period_ends');
    expect(closeBudgetInstructions(early, payer)).toHaveLength(1);

    for (const tokenProgram of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const mint = wallet();
      w.accounts.set(mint.toBase58(), { owner: tokenProgram, data: new Uint8Array(82) });
      const token = w.addBudget({ payer, mint });
      const payee = wallet();
      w.addSlice({ budget: token, payee, state: 1, posted: 700n, waived: true });
      const t = await readBudgetStatus(w.reader, token);
      if (!t.found) throw new Error('not found');
      expect(t.tokenProgram!.equals(tokenProgram)).toBe(true);
      const refund = getAssociatedTokenAddressSync(mint, payer, true, tokenProgram);
      const [ata, close] = closeBudgetInstructions(t, payer);
      expect(ata.keys[1].pubkey.equals(refund)).toBe(true);
      const closeKeys = close.keys.map((k) => k.pubkey.toBase58());
      expect(closeKeys.slice(0, 7)).toEqual([token, budgetVaultAddress(token, PROGRAM), payer, payer, mint, refund, tokenProgram].map((k) => k.toBase58()));
      // Token-2022 refunds carry the memo program, in case the payer's account requires memos.
      expect(close.keys.length).toBe(tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? 8 : 7);
      const [pay] = payoutBudgetInstructions(t, payer);
      const payoutKeys = pay.instructions[1].keys.map((k) => k.pubkey.toBase58());
      expect(payoutKeys).toContain(getAssociatedTokenAddressSync(mint, ESCROW_PROTOCOL_TREASURY, true, tokenProgram).toBase58());
      expect(payoutKeys).toContain(refund.toBase58());
      expect(payoutKeys).toContain(payee.toBase58());
    }
    // A mint that is not a token mint on this cluster is a wrong RPC or address, not a budget to act on.
    const odd = w.addBudget({ payer, mint: wallet() });
    await expect(readBudgetStatus(w.reader, odd)).rejects.toThrow(/mint/);
    expect(() => closeBudgetInstructions({ ...status, open: false }, payer)).toThrow('budget_already_closed');
  });

  it('the freeze message names the network, payer and budget, and only the payer\'s signature verifies', () => {
    const payer = Keypair.generate();
    const request = { network: 'solana-mainnet-beta' as const, budget: wallet().toBase58(), payer: payer.publicKey.toBase58(), issuedAt: 1_800_000_000 };
    const text = new TextDecoder().decode(budgetFreezeMessage(request));
    expect(text.startsWith('Reddi Agent Protocol: freeze my Budget\n')).toBe(true);
    for (const part of [request.network, request.budget, request.payer, String(request.issuedAt)]) expect(text).toContain(part);
    expect(text).not.toBe(new TextDecoder().decode(budgetFreezeMessage({ ...request, network: 'solana-devnet' })));
  });
});

describe('x402-solana budget command (RAP-MB7-S1: no app needed)', () => {
  it('status prints the budget from the chain, as text and as JSON', async () => {
    const w = world(CREATED + 100n);
    const payer = wallet();
    const budget = w.addBudget({ payer });
    w.addSlice({ budget, payee: wallet(), state: 1, posted: 700n, waived: true });
    const a = io(w);
    expect(await runCli(['budget', 'status', budget.toBase58(), '--rpc', 'https://rpc.example'], a.cli)).toBe(0);
    expect(a.rpcs).toEqual(['https://rpc.example']);
    expect(a.out.join('\n')).toContain(`Budget ${budget.toBase58()} on solana-mainnet-beta`);
    expect(a.out.join('\n')).toContain('payout now');
    const b = io(w);
    expect(await runCli(['budget', 'status', budget.toBase58(), '--rpc', 'https://rpc.example', '--json'], b.cli)).toBe(0);
    expect(JSON.parse(b.out.join('\n'))).toMatchObject({ network: 'solana-mainnet-beta', payer: payer.toBase58(), closed: false, unreserved: '4000000', slices: [{ payable: true, state: 'posted', waived: true }] });
  });

  it('close: the payer closes early with their own keypair; a stranger cannot before the open period ends but can after', async () => {
    const w = world(CREATED + 100n);
    const payer = Keypair.generate();
    const stranger = Keypair.generate();
    const budget = w.addBudget({ payer: payer.publicKey });
    const files = { 'payer.json': keyFile(payer), 'stranger.json': keyFile(stranger) };
    const early = io(w, files);
    expect(await runCli(['budget', 'close', budget.toBase58(), '--rpc', 'https://rpc.example', '--keypair', 'stranger.json'], early.cli)).toBe(1);
    expect(early.err.join(' ')).toContain('only the payer');
    expect(w.sent).toHaveLength(0);
    const own = io(w, files);
    expect(await runCli(['budget', 'close', budget.toBase58(), '--rpc', 'https://rpc.example', '--keypair', 'payer.json'], own.cli)).toBe(0);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].instructions).toEqual([closeBudgetInstruction({ programId: PROGRAM, budget, createdSlot: CREATED, signer: payer.publicKey, payer: payer.publicKey })]);
    expect(own.out.join('\n')).toContain('confirmed as sig1');
    expect(own.out.join('\n')).toContain(`returns to ${payer.publicKey.toBase58()}`);
    w.state.slot = CREATED + OPEN_SLOTS;
    const late = io(w, files);
    expect(await runCli(['budget', 'close', budget.toBase58(), '--rpc', 'https://rpc.example', '--keypair', 'stranger.json'], late.cli)).toBe(0);
    expect(w.sent[1].feePayer!.equals(stranger.publicKey)).toBe(true);
    // The refund still goes to the payer, whoever sends the close.
    expect(w.sent[1].instructions[0].keys[2].pubkey.equals(payer.publicKey)).toBe(true);
  });

  it('close and payout without a keypair print unsigned transactions to sign in a wallet; payout settles each payable slice', async () => {
    const closedSlot = CREATED + 1_000n;
    const w = world(closedSlot + DISPUTE_SLOTS);
    const payer = Keypair.generate();
    const open = w.addBudget({ payer: payer.publicKey });
    const a = io(w);
    expect(await runCli(['budget', 'close', open.toBase58(), '--rpc', 'https://rpc.example'], a.cli)).toBe(0);
    const unsigned = Transaction.from(Buffer.from(a.out[1], 'base64'));
    expect(unsigned.feePayer!.equals(payer.publicKey)).toBe(true);
    expect(unsigned.instructions).toHaveLength(1);
    expect(w.sent).toHaveLength(0);

    const closed = w.addBudget({ payer: payer.publicKey, closedSlot });
    const [p1, p2] = [wallet(), wallet()];
    w.addSlice({ budget: closed, payee: p1, state: 0 });
    w.addSlice({ budget: closed, payee: p2, state: 1, posted: 700n, postedSlot: CREATED + 10n });
    const b = io(w, { 'payer.json': keyFile(payer) });
    expect(await runCli(['budget', 'payout', closed.toBase58(), '--rpc', 'https://rpc.example', '--keypair', 'payer.json'], b.cli)).toBe(0);
    expect(w.sent).toHaveLength(2);
    expect(b.out.filter((l) => l.includes('confirmed as'))).toHaveLength(2);
    const again = io(w);
    expect(await runCli(['budget', 'close', closed.toBase58(), '--rpc', 'https://rpc.example'], again.cli)).toBe(1);
    expect(again.err.join(' ')).toContain('already closed');
    w.state.slot = closedSlot + 1n;
    const waiting = io(w);
    expect(await runCli(['budget', 'payout', closed.toBase58(), '--rpc', 'https://rpc.example'], waiting.cli)).toBe(0);
    expect(waiting.out[0]).toContain('No slice can be settled right now');
    expect(waiting.out.join('\n')).toContain(`payout from slot ${closedSlot + DISPUTE_SLOTS}`);
  });

  it('freeze signs the request with the payer\'s keypair and sends only the signature, never the key', async () => {
    const w = world(CREATED);
    const payer = Keypair.generate();
    const budget = wallet();
    const a = io(w, { 'payer.json': keyFile(payer) });
    expect(await runCli(['budget', 'freeze', budget.toBase58(), '--signer', 'https://signer.example', '--network', 'solana-mainnet-beta', '--keypair', 'payer.json'], a.cli)).toBe(0);
    expect(a.requests).toHaveLength(1);
    const { url, body } = a.requests[0];
    expect(url).toBe('https://signer.example/api/v1/freeze');
    expect(Object.keys(body).sort()).toEqual(['budget', 'issuedAt', 'network', 'payer', 'signature']);
    expect(body).toMatchObject({ network: 'solana-mainnet-beta', budget: budget.toBase58(), payer: payer.publicKey.toBase58(), issuedAt: 1_800_000_000 });
    const message = budgetFreezeMessage({ network: 'solana-mainnet-beta', budget: budget.toBase58(), payer: payer.publicKey.toBase58(), issuedAt: 1_800_000_000 });
    expect(ed25519Verify(payer.publicKey, message, Buffer.from(body.signature as string, 'base64'))).toBe(true);
    expect(JSON.stringify(body)).not.toContain(Buffer.from(payer.secretKey.subarray(0, 32)).toString('base64').slice(0, 20));
    // The network can be read from an RPC instead.
    const viaRpc = io(w, { 'payer.json': keyFile(payer) });
    expect(await runCli(['budget', 'freeze', budget.toBase58(), '--signer', 'https://signer.example', '--rpc', 'https://rpc.example', '--keypair', 'payer.json'], viaRpc.cli)).toBe(0);
    expect(viaRpc.requests[0].body.network).toBe('solana-mainnet-beta');
    // A refusal is shown and fails the command.
    const refused = io(w, { 'payer.json': keyFile(payer) }, async () => ({ status: 403, text: async () => '{"ok":false,"code":"not_the_payer"}' }));
    expect(await runCli(['budget', 'freeze', budget.toBase58(), '--signer', 'https://signer.example', '--network', 'solana-devnet', '--keypair', 'payer.json'], refused.cli)).toBe(1);
    expect(refused.err.join(' ')).toContain('not_the_payer');
  });

  it('refuses bad input without sending anything, and never prints a keypair file', async () => {
    const w = world(CREATED);
    const payer = Keypair.generate();
    const budget = w.addBudget({ payer: payer.publicKey });
    const files = { 'bad.json': '{"secret":"do-not-print-me"}', 'payer.json': keyFile(payer) };
    const run = async (args: string[]) => {
      const a = io(w, files);
      return { code: await runCli(args, a.cli), text: [...a.out, ...a.err].join('\n'), requests: a.requests };
    };
    expect((await run([])).text).toBe(USAGE);
    expect((await run(['budget', 'drain', budget.toBase58()])).code).toBe(2);
    expect((await run(['budget', 'status', 'not-an-address', '--rpc', 'https://rpc.example'])).code).toBe(1);
    expect((await run(['budget', 'status', budget.toBase58()])).text).toContain('--rpc');
    expect((await run(['budget', 'status', budget.toBase58(), '--rpc'])).code).toBe(1);
    expect((await run(['budget', 'status', budget.toBase58(), '--rpc', 'https://rpc.example', '--force', 'x'])).code).toBe(1);
    const bad = await run(['budget', 'close', budget.toBase58(), '--rpc', 'https://rpc.example', '--keypair', 'bad.json']);
    expect(bad.code).toBe(1);
    expect(bad.text).not.toContain('do-not-print-me');
    expect((await run(['budget', 'close', budget.toBase58(), '--rpc', 'https://rpc.example', '--keypair', 'missing.json'])).code).toBe(1);
    for (const signer of ['http://signer.example', 'https://signer.example/api', 'nonsense']) {
      const r = await run(['budget', 'freeze', budget.toBase58(), '--signer', signer, '--network', 'solana-devnet', '--keypair', 'payer.json']);
      expect([signer, r.code, r.requests.length]).toEqual([signer, 1, 0]);
    }
    expect((await run(['budget', 'freeze', budget.toBase58(), '--signer', 'https://signer.example', '--network', 'solana-devnet'])).code).toBe(1);
    expect((await run(['budget', 'freeze', budget.toBase58(), '--signer', 'https://signer.example', '--keypair', 'payer.json'])).code).toBe(1);
    expect((await run(['budget', 'freeze', budget.toBase58(), '--signer', 'https://signer.example', '--network', 'testnet', '--keypair', 'payer.json'])).code).toBe(1);
    w.state.genesis = 'someOtherCluster';
    expect((await run(['budget', 'status', budget.toBase58(), '--rpc', 'https://rpc.example'])).text).toContain('not Solana mainnet or devnet');
    expect(w.sent).toHaveLength(0);
  });
});
