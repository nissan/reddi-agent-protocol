'use strict';
const http = require('node:http');
const assert = require('node:assert/strict');
const { Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const rap = require('../dist');
// Original synthetic board, not a Soloku catalogue board, asset or proof.
const syntheticRequest = { size: 3, regions: ['a','a','b','a','b','b','c','c','c'], empty: [1,2,3,5,6,7] };
function analyze(puzzle) {
  assert.deepEqual(Object.keys(puzzle).sort(), ['empty','regions','size']);
  assert.equal(puzzle.size, 3); assert.equal(puzzle.regions.length, 9);
  assert(puzzle.regions.every(x => typeof x === 'string' && /^[abc]$/.test(x)));
  assert(Array.isArray(puzzle.empty) && puzzle.empty.every(x => Number.isInteger(x) && x >= 0 && x < 9));
  const solutions = [];
  // Exhaustive bounded exact count: one avatar per row, column and region, no diagonal rule.
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    const cells = [a, 3+b, 6+c];
    if (new Set([a,b,c]).size === 3 && new Set(cells.map(i => puzzle.regions[i])).size === 3 && cells.every(i => !puzzle.empty.includes(i))) solutions.push(cells);
  }
  return { kind: 'synthetic-exact-count-v1', requestHash: rap.escrowRequestHash(JSON.stringify(puzzle)), count: solutions.length, solutions };
}
function checkAnalysis(puzzle, result) {
  // Independent enumeration over all 3-cell combinations; not Soloku's T0–T2 deduction checker.
  const solutions = [];
  for (let a=0; a<9; a++) for (let b=a+1; b<9; b++) for (let c=b+1; c<9; c++) {
    const cells = [a,b,c];
    if (cells.some(i => puzzle.empty.includes(i))) continue;
    if (new Set(cells.map(i => Math.floor(i/3))).size !== 3 || new Set(cells.map(i => i%3)).size !== 3 || new Set(cells.map(i => puzzle.regions[i])).size !== 3) continue;
    solutions.push(cells);
  }
  assert.equal(result.kind, 'synthetic-exact-count-v1');
  assert.equal(result.requestHash, rap.escrowRequestHash(JSON.stringify(puzzle)));
  assert.equal(result.count, solutions.length); assert.deepEqual(result.solutions, solutions);
}
/** Config contains explicit mint/program/decimals; no symbol-based currency resolution. */
async function startSeller(connection, config) {
  const seller = new rap.EscrowSeller(connection);
  let endpoint;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/analyze') { res.writeHead(404).end(); return; }
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 4096) throw new Error('request too large'); chunks.push(chunk); }
      const body = Buffer.concat(chunks).toString('utf8');
      const puzzle = JSON.parse(body); const result = analyze(puzzle);
      const header = req.headers['x402-payment'];
      if (!header) {
        const challenge = seller.issue({ ...config, endpoint, requestHash: rap.escrowRequestHash(body), expiresAt: Date.now() + 180000 });
        res.writeHead(402, { 'x402-request': JSON.stringify(challenge), 'content-type': 'application/json' }).end(JSON.stringify({ error: 'escrow_required' })); return;
      }
      const receipt = await seller.accept(endpoint, body, JSON.parse(header));
      res.writeHead(200, { 'x402-receipt': JSON.stringify(receipt), 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (e) { res.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  endpoint = `http://127.0.0.1:${server.address().port}/analyze`;
  return { endpoint, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
async function runBuyer(connection, payer, config, endpoint) {
  // This executable example refuses devnet signing even if handed a devnet config.
  assert.equal(config.network, 'solana-local-validator');
  const rpc = new URL(connection.rpcEndpoint);
  assert.equal(rpc.hostname, '127.0.0.1'); assert.equal(rpc.protocol, 'http:');
  let challenge;
  const body = JSON.stringify(syntheticRequest);
  const purchase = await rap.buyWithEscrow({ endpoint, body,
    request: proof => fetch(endpoint, { method: 'POST', body, headers: proof ? { 'x402-payment': JSON.stringify(proof) } : {} }),
    approve: async c => {
      for (const k of ['network','genesisHash','programId','payer','payee','mint','source','recipient','tokenProgram','decimals','amount']) assert.equal(c[k], config[k], `unapproved ${k}`);
      assert.equal(c.payer, payer.publicKey.toBase58());
      assert(BigInt(c.amount) <= 400000n, 'raw-unit spend cap exceeded');
      assert.equal(await connection.getGenesisHash(), c.genesisHash);
      challenge = c;
    },
    lock: async c => sendAndConfirmTransaction(connection, new Transaction().add(rap.buildLockTokenEscrowInstruction(rap.escrowTerms(c))), [payer], { commitment: 'finalized' }),
  });
  return { ...purchase, challenge };
}
module.exports = { startSeller, runBuyer, syntheticRequest, analyze, checkAnalysis };
