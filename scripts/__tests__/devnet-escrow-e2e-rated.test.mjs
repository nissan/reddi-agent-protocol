// Offline tests of the rated lane of scripts/devnet-escrow-e2e.cjs: its plan and the instructions it would send.
// No network, no keys: the addresses below are fixed bytes, not wallets.
// Run from any directory: node --test scripts/__tests__/devnet-escrow-e2e-rated.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const script = fileURLToPath(new URL("../devnet-escrow-e2e.cjs", import.meta.url));
const lane = require(script);
const { PublicKey } = require("@solana/web3.js");
const vectors = JSON.parse(readFileSync(`${root}programs/pinocchio-escrow/interface/vectors.json`, "utf8"));

const address = (byte) => new PublicKey(Buffer.alloc(32, byte));
const payer = address(1);
const payee = address(2);
const judge = address(3);
const runId = "unit-test-1";
const selector = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8).toString("hex");
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, lane.PROGRAM)[0];
const plan = lane.ratedPlan({ payer, payee, judge, runId });
const step = (id, from = plan) => {
  const found = from.steps.find((s) => s.id === id);
  assert.ok(found, `plan has no step ${id}`);
  return found;
};
const ids = (from, mode) => from.steps.filter((s) => s.mode === mode && s.kind !== "skip").map((s) => `${s.kind} ${s.id}`);

test("the plan lists the rated lane in order, with a judge", () => {
  assert.deepEqual(ids(plan, "run-rated"), [
    "send job1.lock-and-open-rating",
    "refuse job1.settle-without-rating-account",
    "refuse job1.commit-before-paid",
    "send job1.settle",
    "send job1.commit-consumer",
    "refuse job1.reveal-before-both-committed",
    "send job1.commit-specialist",
    "send job1.reveal-consumer",
    "send job1.reveal-specialist",
    "refuse job1.attest-by-payee",
    "send job1.attest",
    "refuse job1.attest-again",
    "send job1.confirm-attestation",
    "refuse job1.dispute-after-confirm",
    "send job1.close-attestation",
    "send job1.close-rating",
    "send job2.lock-and-open-rating",
    "send job2.accept-rating",
    "refuse job2.accept-rating-again",
    "send job2.release",
    "refuse job2.attest-by-unnamed-judge",
    "send job2.commit-consumer",
    "send decline.lock-and-open-rating",
    "send decline.cancel",
    "send unaccepted.lock-and-open-rating",
    "send unaccepted.release",
    "refuse unaccepted.commit-after-unrated-close",
    "send unrated.lock",
    "refuse unrated.open-rating-in-a-later-slot",
    "refuse unrated.commit-never-opted-in",
    "send unrated.decline",
    "refuse per.delegate_escrow",
    "refuse per.release_escrow_per",
  ]);
  assert.deepEqual(ids(plan, "finish-rated"), ["refuse job2.expire-before-deadline", "send job2.expire-rating", "send job2.close-rating"]);
});

test("each refused case names the exact program error", () => {
  const expected = {
    "job1.settle-without-rating-account": 6033,
    "job1.commit-before-paid": 6039,
    "job1.reveal-before-both-committed": 6011,
    "job1.attest-by-payee": 6000,
    "job1.attest-again": 6048,
    "job1.dispute-after-confirm": 6018,
    "job2.accept-rating-again": 6046,
    "job2.attest-by-unnamed-judge": 6000,
    "unaccepted.commit-after-unrated-close": 3012,
    "unrated.open-rating-in-a-later-slot": 6036,
    "unrated.commit-never-opted-in": 3012,
    "per.delegate_escrow": 101,
    "per.release_escrow_per": 101,
    "job2.expire-before-deadline": 6014,
  };
  const refusals = Object.fromEntries(plan.steps.filter((s) => s.kind === "refuse").map((s) => [s.id, s.mustFailWith]));
  assert.deepEqual(refusals, expected);
  // attest_quality reads the signer's agent record before the judge check.
  assert.equal(step("job1.attest-by-payee").mustFailWithIfSignerUnregistered, 3012);
  assert.equal(lane.customError({ InstructionError: [1, { Custom: 6033 }] }), 6033);
  assert.equal(lane.customError({ InstructionError: [0, "InvalidAccountData"] }), null);
  assert.equal(lane.customError(null), null);
});

test("the two PER selectors are sent as they would be to a build that had them", () => {
  for (const name of ["delegate_escrow", "release_escrow_per"]) {
    const [ix] = step(`per.${name}`).instructions;
    assert.equal(ix.dataHex, selector(name));
    assert.equal(ix.name, name);
  }
});

test("without a judge no judge is named and the attestation steps are skipped", () => {
  const bare = lane.ratedPlan({ payer, payee, runId });
  assert.equal(bare.judge, null);
  assert.deepEqual(bare.steps.filter((s) => s.kind === "skip").map((s) => s.id),
    ["job1.attest", "job1.attest-again", "job1.confirm-attestation", "job1.dispute-after-confirm", "job1.close-attestation", "job2.attest-by-unnamed-judge"]);
  const open = step("job1.lock-and-open-rating", bare).instructions[1];
  assert.equal(open.dataHex, selector("open_rating") + "00".repeat(32));
  assert.ok(!bare.steps.some((s) => s.signer === "judge"));
  // Job 1 differs (its rating names the judge); the other jobs are the same transaction for transaction.
  const rest = (from) => from.steps.filter((s) => !s.id.startsWith("job1.") && s.id !== "job2.attest-by-unnamed-judge");
  assert.deepEqual(rest(bare), rest(plan));
});

test("a rated lock is the lock and open_rating in one transaction, signed by the payer", () => {
  for (const [id, lockName] of [["job1.lock-and-open-rating", "lock_metered_escrow"], ["job2.lock-and-open-rating", "lock_token_escrow"],
    ["decline.lock-and-open-rating", "lock_escrow"], ["unaccepted.lock-and-open-rating", "lock_escrow"]]) {
    const s = step(id);
    assert.equal(s.signer, "payer");
    assert.deepEqual(s.instructions.map((ix) => ix.name), [lockName, "open_rating"]);
    const [lock, open] = s.instructions;
    assert.equal(open.accounts[1].address, lock.accounts[0].address, `${id}: open_rating names the escrow just locked`);
    assert.equal(open.accounts[0].address, pda([Buffer.from("rating"), new PublicKey(lock.accounts[0].address).toBuffer()]).toBase58());
  }
  // Job 1 names the judge; the others name none.
  assert.equal(step("job1.lock-and-open-rating").instructions[1].dataHex, selector("open_rating") + judge.toBuffer().toString("hex"));
  assert.equal(step("job2.lock-and-open-rating").instructions[1].dataHex, selector("open_rating") + "00".repeat(32));
  // The unrated escrow is a plain lock.
  assert.deepEqual(step("unrated.lock").instructions.map((ix) => ix.name), ["lock_escrow"]);
});

test("amounts and windows on the locks", () => {
  const u64 = (hex, at) => Buffer.from(hex, "hex").readBigUInt64LE(at);
  const job1 = step("job1.lock-and-open-rating").instructions[0];
  assert.equal(u64(job1.dataHex, 8), lane.RATED_AMOUNTS.solMeteredMax);
  assert.equal(Buffer.from(job1.dataHex, "hex").subarray(16, 32).toString("hex"), lane.nonceFor(runId, "rated-sol-metered").toString("hex"));
  assert.deepEqual([u64(job1.dataHex, 32), u64(job1.dataHex, 40)], [750n, 1500n]);
  const job2 = step("job2.lock-and-open-rating").instructions[0];
  assert.equal(u64(job2.dataHex, 8), lane.RATED_AMOUNTS.usdcFixed);
  assert.equal(job2.accounts[4].address, lane.USDC.toBase58());
  assert.equal(u64(step("job1.settle").instructions[0].dataHex, 8), lane.RATED_AMOUNTS.solMeteredActual);
  // The fee the lane asserts: 2.5% of the amount paid, rounded down, capped at 0.1 SOL for SOL only.
  assert.equal(lane.fee(8_000_000n, true), 200_000n);
  assert.equal(lane.fee(1_000_000n, false), 25_000n);
  assert.equal(lane.fee(39n, true), 0n);
  assert.equal(lane.fee(10_000_000_000n, true), 100_000_000n);
  assert.equal(lane.fee(10_000_000_000n, false), 250_000_000n);
});

test("every instruction matches the interface vectors: selector, account count, signer and writable flags", () => {
  const byName = new Map(vectors.instructions.map((v) => [v.name, v]));
  const seen = new Set();
  for (const s of plan.steps) {
    for (const ix of s.instructions ?? []) {
      const vector = byName.get(ix.name);
      if (!vector) continue;
      const what = `${s.id} ${ix.name}`;
      // The vectors show the exits of a rated escrow. The two exits sent without the rating account on purpose
      // (the 6033 refusal and the decline of the unrated escrow) are one account shorter.
      const unrated = s.id === "job1.settle-without-rating-account" || s.id === "unrated.decline";
      const accounts = unrated ? vector.accounts.slice(0, -1) : vector.accounts;
      assert.equal(ix.dataHex.slice(0, 16), vector.selector_hex, `${what}: selector`);
      assert.equal(ix.dataHex.length, vector.data_hex.length, `${what}: data length`);
      assert.equal(ix.accounts.length, accounts.length, `${what}: account count`);
      ix.accounts.forEach((account, i) => {
        assert.equal(account.writable, accounts[i].writable, `${what}: account ${i} (${accounts[i].name}) writable`);
        // Who signs a release or a cancel depends on the case: checked in the next test.
        if (!["release_escrow", "cancel_escrow", "cancel_token_escrow"].includes(ix.name)) {
          assert.equal(account.signer, accounts[i].signer, `${what}: account ${i} (${accounts[i].name}) signer`);
        }
      });
      if (!unrated && /^(release|settle|cancel)_/.test(ix.name)) {
        const rating = pda([Buffer.from("rating"), new PublicKey(ix.accounts[0].address).toBuffer()]).toBase58();
        assert.equal(ix.accounts.at(-1).address, rating, `${what}: the rating account is the last account`);
      }
      seen.add(ix.name);
    }
  }
  // Every rating and attestation instruction the lane can exercise is in the plan.
  for (const name of ["open_rating", "accept_rating", "commit_rating", "reveal_rating", "expire_rating", "close_rating", "attest_quality",
    "confirm_attestation", "dispute_attestation", "close_attestation", "settle_escrow", "release_escrow", "cancel_escrow", "release_token_escrow"]) {
    assert.ok(seen.has(name), `${name} is not exercised`);
  }
});

test("each transaction is signed by one party, and a seller's or judge's never carries the payer's signature", () => {
  const wallets = { payer: payer.toBase58(), payee: payee.toBase58(), judge: judge.toBase58() };
  for (const s of plan.steps) {
    if (!s.instructions) continue;
    const signed = new Set(s.instructions.flatMap((ix) => ix.accounts.filter((a) => a.signer).map((a) => a.address)));
    assert.deepEqual([...signed], [wallets[s.signer]], `${s.id}: signers`);
  }
  assert.equal(step("job1.settle").signer, "payee");
  assert.equal(step("job2.accept-rating").signer, "payee");
  assert.equal(step("job2.release").signer, "payer");
  assert.equal(step("decline.cancel").signer, "payee");
  assert.equal(step("unaccepted.release").signer, "payer");
});

test("payouts go to the treasury the program fixes", () => {
  assert.equal(step("job1.settle").instructions[0].accounts[3].address, lane.TREASURY.toBase58());
  assert.equal(step("unaccepted.release").instructions[0].accounts[3].address, lane.TREASURY.toBase58());
  assert.equal(step("job2.release").instructions[0].accounts[6].address, lane.TREASURY_USDC.toBase58());
});

test("commitments are sha256(rating, signer, score, salt) and the reveals open them", () => {
  const { commitment } = vectors;
  // The package's built output, which the script loads, against the vector.
  const built = require(`${root}packages/x402-solana/dist/rating.js`);
  assert.equal(Buffer.from(built.ratingCommitment(new PublicKey(commitment.rating), new PublicKey(commitment.signer), commitment.score,
    Buffer.from(commitment.salt_hex, "hex"))).toString("hex"), commitment.sha256_hex);
  for (const [commitId, revealId, signer, role, score] of [
    ["job1.commit-consumer", "job1.reveal-consumer", payer, "payer", lane.RATED_SCORES.job1Consumer],
    ["job1.commit-specialist", "job1.reveal-specialist", payee, "payee", lane.RATED_SCORES.job1Specialist],
  ]) {
    const commit = step(commitId).instructions[0];
    const reveal = step(revealId).instructions[0];
    const salt = lane.saltFor(runId, "job1", role);
    assert.equal(reveal.dataHex, selector("reveal_rating") + Buffer.from([score]).toString("hex") + salt.toString("hex"));
    const rating = new PublicKey(commit.accounts[0].address);
    const expected = createHash("sha256").update(Buffer.concat([rating.toBuffer(), signer.toBuffer(), Buffer.from([score]), salt])).digest("hex");
    assert.equal(commit.dataHex, selector("commit_rating") + expected);
    assert.equal(rating.toBase58(), plan.escrows.job1.rating);
    // Agent addresses: the specialist's, then the consumer's.
    assert.deepEqual(reveal.accounts.slice(2).map((a) => a.address),
      [pda([Buffer.from("agent"), payee.toBuffer()]).toBase58(), pda([Buffer.from("agent"), payer.toBuffer()]).toBase58()]);
  }
  assert.notEqual(lane.saltFor(runId, "job1", "payer").toString("hex"), lane.saltFor(runId, "job1", "payee").toString("hex"));
});

test("the attestation is of job 1, by the judge, at the address derived from the escrow", () => {
  const attest = step("job1.attest").instructions[0];
  const escrow = new PublicKey(plan.escrows.job1.escrow);
  assert.equal(attest.dataHex, selector("attest_quality") + Buffer.from(lane.RATED_SCORES.attestation).toString("hex"));
  assert.deepEqual(attest.accounts.slice(0, 4).map((a) => a.address), [
    pda([Buffer.from("attestation"), escrow.toBuffer()]).toBase58(),
    plan.escrows.job1.rating,
    pda([Buffer.from("agent"), judge.toBuffer()]).toBase58(),
    judge.toBase58(),
  ]);
  assert.equal(plan.attestation, attest.accounts[0].address);
  // It comes after the reveals and before the buyer closes the rating account.
  const order = plan.steps.map((s) => s.id);
  assert.ok(order.indexOf("job1.reveal-specialist") < order.indexOf("job1.attest"));
  assert.ok(order.indexOf("job1.close-attestation") < order.indexOf("job1.close-rating"));
});

test("escrow addresses derive from the run id, and differ from the unrated lane's", () => {
  const sol = (label) => pda([Buffer.from("escrow"), payer.toBuffer(), lane.nonceFor(runId, label)]).toBase58();
  assert.equal(plan.escrows.job1.escrow, sol("rated-sol-metered"));
  assert.equal(plan.escrows.decline.escrow, sol("rated-sol-decline"));
  assert.equal(plan.escrows.unaccepted.escrow, sol("rated-sol-unaccepted"));
  assert.equal(plan.escrows.unrated.escrow, sol("rated-sol-unrated"));
  assert.equal(plan.escrows.job2.escrow, pda([Buffer.from("token-escrow"), payer.toBuffer(), lane.nonceFor(runId, "rated-usdc-fixed")]).toBase58());
  assert.equal(new Set(Object.values(plan.escrows).map((e) => e.escrow)).size, 5);
  const other = lane.ratedPlan({ payer, payee, judge, runId: "unit-test-2" });
  assert.notEqual(other.escrows.job1.escrow, plan.escrows.job1.escrow);
  assert.ok(lane.RATED_LABELS.every((label) => label.startsWith("rated-")));
});

test("the lane refuses parties that cannot rate each other", () => {
  assert.throws(() => lane.ratedLane({ payer, payee: payer, runId }), /payer and payee must differ/);
  assert.throws(() => lane.ratedLane({ payer, payee, judge: payee, runId }), /judge must be neither/);
  assert.throws(() => lane.ratedLane({ payer, payee, judge: payer, runId }), /judge must be neither/);
  assert.throws(() => lane.ratedLane({ payer, payee, runId: "no" }), /run id/);
});

test("register_agent data and accounts", () => {
  const ix = lane.registerAgent({ owner: judge, agentType: 1, model: "rap-devnet-e2e-judge" });
  const name = Buffer.from("rap-devnet-e2e-judge");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(name.length);
  const rate = Buffer.alloc(8);
  rate.writeBigUInt64LE(1000n);
  assert.equal(ix.data.toString("hex"), selector("register_agent") + "01" + length.toString("hex") + name.toString("hex") + rate.toString("hex") + "00");
  assert.deepEqual(ix.keys.map((k) => [k.pubkey.toBase58(), k.isWritable, k.isSigner]), [
    [pda([Buffer.from("agent"), judge.toBuffer()]).toBase58(), true, false],
    [judge.toBase58(), true, true],
    ["1nc1nerator11111111111111111111111111111111", true, false],
    ["11111111111111111111111111111111", false, false],
  ]);
});

test("agent records are read past the model name, and scores fold as the program folds them", () => {
  const record = Buffer.alloc(150);
  createHash("sha256").update("account:AgentAccount").digest().copy(record, 0, 0, 8);
  record[40] = 2;
  const model = Buffer.from("some-model");
  record.writeUInt32LE(model.length, 41);
  model.copy(record, 45);
  const t = 45 + model.length;
  record.writeUInt16LE(7300, t + 9);
  record.writeBigUInt64LE(12n, t + 11);
  record.writeBigUInt64LE(3n, t + 19);
  record[t + 35] = 1;
  record.writeUInt16LE(2000, t + 36);
  assert.deepEqual(lane.decodeAgent(record), { agentType: 2, reputation: 7300, jobsCompleted: 12n, jobsFailed: 3n, active: true, accuracy: 2000 });
  assert.throws(() => lane.decodeAgent(Buffer.alloc(150)), /not an agent record/);
  // (reputation * 9 + score * 1000) / 10, rounded down, at most 10000.
  assert.equal(lane.foldRating(0, 9), 900);
  assert.equal(lane.foldRating(7300, 8), 7370);
  assert.equal(lane.foldRating(7301, 8), 7370);
  assert.equal(lane.foldRating(10000, 10), 10000);
});

test("the expiry date is the slot after the commit deadline, at 400 ms a slot", () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  const fresh = lane.expiryEstimate({ settledSlot: 1000n, currentSlot: 1000, now });
  assert.equal(fresh.expireFromSlot, "1513001");
  assert.equal(fresh.slotsRemaining, "1512001");
  // 1,512,000 slots are 7 days; one more slot is 0.4 s.
  assert.equal(fresh.estimatedEarliest, "2026-11-28T12:00:00.400Z");
  assert.equal(lane.expiryEstimate({ settledSlot: 1000n, currentSlot: 1_513_000, now }).slotsRemaining, "1");
  assert.equal(lane.expiryEstimate({ settledSlot: 1000n, currentSlot: 1_513_001, now }).slotsRemaining, "0");
  assert.equal(lane.expiryEstimate({ settledSlot: 1000n, currentSlot: 9_000_000, now }).slotsRemaining, "0");
});

test("plan-rated --offline prints the plan and opens no connection", () => {
  const env = { PATH: process.env.PATH, RAP_E2E_PAYER: payer.toBase58(), RAP_E2E_PAYEE: payee.toBase58(), RAP_E2E_JUDGE: judge.toBase58(),
    RAP_E2E_RUN_ID: runId, RAP_E2E_RPC: "http://127.0.0.1:1" };
  const printed = JSON.parse(execFileSync(process.execPath, [script, "plan-rated", "--offline"], { env, encoding: "utf8" }));
  assert.equal(printed.mode, "plan-rated");
  assert.equal(printed.offline, true);
  assert.equal(printed.cluster, undefined);
  assert.deepEqual(printed.plan, JSON.parse(JSON.stringify(plan)));
  // Without the judge address the output says what is skipped.
  const bare = JSON.parse(execFileSync(process.execPath, [script, "plan-rated", "--offline"], { env: { ...env, RAP_E2E_JUDGE: "" }, encoding: "utf8" }));
  assert.match(bare.note, /attestation steps are skipped/);
});

test("signing modes stop before the network when their inputs are missing, and --offline is for plan-rated only", () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, RAP_E2E_RPC: "http://127.0.0.1:1", ...env }, encoding: "utf8" });
  for (const mode of ["run-rated", "finish-rated"]) {
    const noRunId = run([mode]);
    assert.equal(noRunId.status, 1);
    assert.match(noRunId.stderr, /RAP_E2E_RUN_ID is required/);
    const noKeys = run([mode], { RAP_E2E_RUN_ID: runId });
    assert.equal(noKeys.status, 1);
    assert.match(noKeys.stderr, /RAP_E2E_PAYER_KEYPAIR is required/);
  }
  const offlineRun = run(["run-rated", "--offline"], { RAP_E2E_RUN_ID: runId });
  assert.equal(offlineRun.status, 1);
  assert.match(offlineRun.stderr, /--offline goes with plan-rated only/);
  const unknown = run(["rated"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /mode must be one of: plan, run, finish-refund, finish-claim, plan-rated, run-rated, finish-rated/);
  assert.deepEqual(lane.MODES, ["plan", "run", "finish-refund", "finish-claim", "plan-rated", "run-rated", "finish-rated"]);
});
