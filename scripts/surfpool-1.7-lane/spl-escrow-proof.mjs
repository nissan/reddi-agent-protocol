#!/usr/bin/env node
/* Opt-in, offline, version-qualified Surfpool 1.7.0 local proof lane for the classic SPL token
 * escrow. It builds the escrow ELF at the exact committed source, runs the existing validator proof
 * (programs/escrow/tests/local_token_escrow.cjs) unchanged, then runs the same lock/release/refund
 * scenario plus surplus-donation and conservation checks against that same ELF on an embedded
 * Surfpool 1.7.0 runtime, and requires the two lanes to agree.
 *
 * Setup:  npm run setup:surfpool:spl-escrow-1.7
 * Run:    RAP_SURFPOOL_LANE_OUT_DIR=/absolute/fresh/dir npm run test:surfpool:spl-escrow-1.7
 * Linux x64 only. The ELF is built and the validator proof is run with the baseline-owned Agave tree
 * from scripts/solana-baseline-toolchain.sh (cargo-build-sbf 4.1.0, solana-test-validator 4.2.2).
 *
 * Boundaries: embedded SDK only, offline (no remoteRpcUrl), loopback RPC/WS on dynamic ports, keys
 * generated in memory and never printed, explicit fixed program id plus the verified ELF. SOL
 * funding uses the fundSolMany cheatcode; every token balance comes from a fresh local mint and real
 * SPL instructions. Time travel is a local cheatcode; a local `finalized` status is local-runtime
 * evidence, never public settlement. Nothing here deploys, signs for, or reads any remote chain.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLocalOnlyEnvironment,
  localChildEnv,
  startLocalSurfnet,
  stopLocalSurfnetLease,
  waitForPortClosed,
  terminateChildProcess,
  cancelChildEscalations,
} from "../lib/surfpool-sdk-lifecycle.mjs";

const laneDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(laneDir, "../..");
const require = createRequire(import.meta.url);

const PINS = Object.freeze({
  "@solana/surfpool": "1.7.0",
  "@solana/surfpool-linux-x64-gnu": "1.7.0",
  "@solana/kit": "8.6.0",
  "@solana/web3.js": "1.98.4",
  "@solana/spl-token": "0.4.14",
});
const NODE_VERSION = "v24.20.0";
const CARGO_BUILD_SBF = /^solana-cargo-build-sbf 4\.1\.0\b|^cargo-build-sbf 4\.1\.0\b/m;
const TEST_VALIDATOR = /^solana-test-validator 4\.2\.2\b/;
const PROGRAM_ID = "794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD";
const CANCEL_WINDOW_SLOTS = 50_400;
const CREATED_SLOT_OFFSET = 193; // TokenEscrowAccount: disc 8 + 5 keys + amount 8 + nonce 16 + status 1
const SOURCE_DIRTY_PATHS = ["programs/escrow", "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "Anchor.toml"];

assertLocalOnlyEnvironment(process.env);
assert.equal(process.version, NODE_VERSION, `repo-local Node ${NODE_VERSION} required (.mise.toml)`);
assert.equal(`${process.platform}-${process.arch}`, "linux-x64",
  `this lane runs on Linux x64 only (@solana/surfpool-linux-x64-gnu); found ${process.platform}-${process.arch}`);
const versions = installedVersions();
const proofDependencies = resolvedProofDependencies();

const { Surfnet } = require("@solana/surfpool");
const { createSolanaRpc, address } = require("@solana/kit");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } = require("@solana/web3.js");
const token = require("@solana/spl-token");

const runId = `surfpool-1.7-spl-escrow-${randomUUID()}`;
const outDir = path.resolve(process.env.RAP_SURFPOOL_LANE_OUT_DIR?.trim() || path.join(repoRoot, ".tmp", "surfpool-1.7-spl-escrow", runId));
assert(!fs.existsSync(outDir), `RAP_SURFPOOL_LANE_OUT_DIR must not exist yet: ${outDir}`);
const agaveBin = path.join(os.homedir(), ".local/share/solana/reddi-agent-protocol-baseline/install/active_release/bin");
const elfPath = path.join(repoRoot, "target", "deploy", "escrow.so");
const cargoTargetDir = path.join(repoRoot, ".tmp", "surfpool-1.7-spl-escrow-cargo-target");

const evidence = { runId, label: "LOCAL TEST MINT ONLY — not AUDD; local runtime evidence, no devnet or mainnet proof", status: "FAIL" };
const cleanup = [];
let lease;
let activeChild;
let stopReason;
let aborting;
let finishing;
const overallTimeoutMs = 20 * 60_000;
const timeout = setTimeout(() => abortRun("timeout"), overallTimeoutMs);
timeout.unref?.();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => abortRun(signal));

try {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  evidence.source = sourceProvenance();
  evidence.toolchain = { node: process.version, packages: versions, ...agaveToolchain() };
  evidence.elf = buildEscrowElf();
  evidence.validatorLane = await runValidatorProof();
  checkStopped();
  evidence.surfpoolLane = await runSurfpoolProof();
  checkStopped();
  evidence.parity = compareLanes(evidence.validatorLane, evidence.surfpoolLane);
  evidence.status = "PASS";
} catch (error) {
  evidence.failure = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await finish();
}

function finish() {
  finishing ??= writeOutcome();
  return finishing;
}

async function writeOutcome() {
  await aborting;
  if (lease) await stopSurfnet();
  evidence.cleanup = cleanup;
  evidence.stopReason = stopReason ?? null;
  if (stopReason) {
    evidence.status = "FAIL";
    evidence.failure ??= `stopped: ${stopReason}`;
  }
  if (cleanup.some((step) => step.ok === false)) evidence.status = "FAIL";
  if (evidence.status !== "PASS") process.exitCode = stopReason === "timeout" ? 124 : stopReason ? 130 : 1;
  if (fs.existsSync(outDir)) fs.writeFileSync(path.join(outDir, "result.json"), `${JSON.stringify(evidence, jsonBigInt, 2)}\n`, { mode: 0o600 });
  console.log(`[surfpool-1.7] ${evidence.status}; evidence: ${path.join(outDir, "result.json")}`);
  if (evidence.failure) console.error(evidence.failure);
}

/**
 * Interrupt or timeout: stop the embedded Surfnet and the validator proof's whole process group
 * (the proof's validator is its child) now, record the outcome, and exit. A step blocked on RPC
 * would otherwise keep both runtimes alive until its own deadline.
 */
async function abortRun(reason) {
  if (stopReason) return;
  stopReason = reason;
  console.error(`[surfpool-1.7] ${reason}: stopping local runtimes`);
  aborting = terminateValidatorProof(activeChild, reason);
  await aborting;
  await finish();
  process.exit(process.exitCode);
}

async function terminateValidatorProof(child, reason) {
  if (!child) return;
  const exited = child.exitCode === null && child.signalCode === null ? new Promise((resolve) => child.once("exit", resolve)) : null;
  terminateChildProcess(child, "SIGINT", { killDelayMs: 15_000 });
  if (exited) await exited;
  // The proof's validator shares the group and may outlive the proof itself; wait for the group.
  const groupGone = await waitForProcessGroupExit(child.pid);
  cancelChildEscalations(child);
  cleanup.push({ step: "validator proof process group terminated", ok: groupGone, reason });
}

/** True once no process in `pid`'s group remains, false if some still do at the deadline. */
async function waitForProcessGroupExit(pid, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
  return !processGroupAlive(pid);
}

function processGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function checkStopped() {
  if (stopReason) throw new Error(`stopped: ${stopReason}`);
}

function jsonBigInt(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(...args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
}

/** Exact installed versions of every pinned lane package, refusing drift from the lockfile. */
function installedVersions() {
  const lock = JSON.parse(fs.readFileSync(path.join(laneDir, "package-lock.json"), "utf8"));
  const result = {};
  for (const [name, pinned] of Object.entries(PINS)) {
    const manifest = path.join(laneDir, "node_modules", name, "package.json");
    assert(fs.existsSync(manifest), `${name} not installed; run npm run setup:surfpool:spl-escrow-1.7`);
    const installed = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
    const locked = lock.packages?.[`node_modules/${name}`];
    assert.equal(installed, pinned, `${name} installed ${installed}; lane pins ${pinned}`);
    assert.equal(locked?.version, pinned, `${name} lockfile resolves ${locked?.version}; lane pins ${pinned}`);
    result[name] = { version: installed, integrity: locked.integrity };
  }
  const nativeDir = path.join(laneDir, "node_modules", "@solana/surfpool-linux-x64-gnu");
  const nativeModule = fs.readdirSync(nativeDir).find((name) => name.endsWith(".node"));
  assert(nativeModule, "Surfpool Linux x64 native module missing");
  result["@solana/surfpool-linux-x64-gnu"].nativeModule = nativeModule;
  result["@solana/surfpool-linux-x64-gnu"].nativeModuleSha256 = sha256(fs.readFileSync(path.join(nativeDir, nativeModule)));
  return result;
}

/**
 * The validator proof's @solana/web3.js and @solana/spl-token: Node resolves them from the nearest
 * ancestor node_modules (normally the root install) and consults NODE_PATH only when none holds them.
 */
function resolvedProofDependencies() {
  const rootLock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
  const dependencies = {};
  for (const name of ["@solana/web3.js", "@solana/spl-token"]) {
    assert.equal(rootLock.packages?.[`node_modules/${name}`]?.version, PINS[name], `root lockfile ${name} differs from the lane pin`);
    const resolved = proofDependency(name);
    assert.equal(resolved.version, PINS[name], `validator proof resolves ${name} ${resolved.version} from ${resolved.path}; lane pins ${PINS[name]}`);
    dependencies[name] = resolved;
  }
  return dependencies;
}

/** The install the proof's require() will load `name` from: nearest ancestor node_modules, else the lane's NODE_PATH. */
function proofDependency(name) {
  const candidates = [];
  for (let dir = path.join(repoRoot, "programs", "escrow", "tests"); ; dir = path.dirname(dir)) {
    candidates.push(path.join(dir, "node_modules", name));
    if (path.dirname(dir) === dir) break;
  }
  candidates.push(path.join(laneDir, "node_modules", name));
  const dir = candidates.find((candidate) => fs.existsSync(path.join(candidate, "package.json")));
  assert(dir, `${name} is not resolvable for the validator proof`);
  return { path: dir, version: JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version };
}

function assertSourcesClean(when) {
  const dirty = git("status", "--porcelain", "--untracked-files=all", "--", ...SOURCE_DIRTY_PATHS);
  assert.equal(dirty, "", `escrow sources differ from HEAD ${when}:\n${dirty}`);
}

function sourceProvenance() {
  assertSourcesClean("; commit or discard before proving");
  return {
    commit: git("rev-parse", "HEAD"),
    escrowTree: git("rev-parse", "HEAD:programs/escrow"),
    cargoLockBlob: git("rev-parse", "HEAD:Cargo.lock"),
    validatorProofBlob: git("rev-parse", "HEAD:programs/escrow/tests/local_token_escrow.cjs"),
  };
}

function agaveToolchain() {
  const cargoBuildSbf = execFileSync(path.join(agaveBin, "cargo-build-sbf"), ["--version"], { encoding: "utf8" }).trim();
  assert.match(cargoBuildSbf, CARGO_BUILD_SBF, `cargo-build-sbf 4.1.0 required in ${agaveBin}`);
  const validator = execFileSync(path.join(agaveBin, "solana-test-validator"), ["--version"], { encoding: "utf8" }).trim();
  assert.match(validator, TEST_VALIDATOR, `solana-test-validator 4.2.2 required in ${agaveBin}`);
  return { cargoBuildSbf, solanaTestValidator: validator };
}

function buildEscrowElf() {
  console.log("[surfpool-1.7] building escrow ELF with pinned cargo-build-sbf");
  execFileSync(path.join(agaveBin, "cargo-build-sbf"),
    ["--manifest-path", "programs/escrow/Cargo.toml", "--sbf-out-dir", "target/deploy"], {
      cwd: repoRoot,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, CARGO_TARGET_DIR: cargoTargetDir, PATH: `${agaveBin}${path.delimiter}${process.env.PATH}` },
    });
  assertSourcesClean("after the build (cargo rewrote a source or lock file; regenerate and commit it first)");
  const bytes = fs.readFileSync(elfPath);
  return { path: "target/deploy/escrow.so", sha256: sha256(bytes), bytes: bytes.length, builtAtCommit: evidence.source.commit };
}

/** The current validator proof, run byte-for-byte as committed. */
async function runValidatorProof() {
  const dir = path.join(outDir, "validator");
  const childTmp = path.join(outDir, "validator-tmp");
  fs.mkdirSync(childTmp, { mode: 0o700 });
  const env = localChildEnv({ RAP_LOCAL_TEST_DIR: dir, RAP_TEST_VALIDATOR: path.join(agaveBin, "solana-test-validator"),
    NODE_PATH: path.join(laneDir, "node_modules") }, { repoRoot, childTmpDir: childTmp });
  console.log("[surfpool-1.7] running unchanged validator proof");
  // Its own process group, so an interrupt reaches the validator it spawned as well.
  const child = spawn(process.execPath, ["programs/escrow/tests/local_token_escrow.cjs"], {
    cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  activeChild = child;
  const log = fs.createWriteStream(path.join(outDir, "validator-proof.log"), { mode: 0o600 });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const exitCode = await new Promise((resolve) => child.once("exit", (code, signal) => resolve(code ?? signal)));
  activeChild = undefined;
  await new Promise((resolve) => log.end(resolve));
  const groupGone = await waitForProcessGroupExit(child.pid);
  if (!groupGone) try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
  cleanup.push({ step: "validator proof process group exited", ok: groupGone });
  checkStopped();
  assert.equal(exitCode, 0, "validator proof failed; see validator-proof.log");
  const result = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8"));
  const probe = await waitForPortClosed(result.rpc, { timeoutMs: 20_000 })
    .then(() => ({ ok: true }), (error) => ({ ok: false, error: String(error?.message ?? error) }));
  cleanup.push({ step: "validator proof stopped its own validator", rpcPortRefused: probe.ok, ...probe });
  assert(probe.ok, `validator proof left its RPC endpoint open: ${probe.error}`);
  return { ...result, dependencies: proofDependencies };
}

async function runSurfpoolProof() {
  const config = {}; // Lifecycle helper forces offline:true, airdropSol:0, blockProductionMode:"transaction".
  lease = await startLocalSurfnet(Surfnet, { config, readinessTimeoutMs: 20_000 });
  const startedAt = Date.now();
  const rpcUrl = lease.rpcUrl;
  const rpc = createSolanaRpc(rpcUrl);
  const conn = new Connection(rpcUrl, "confirmed");
  const raw = async (method, params = []) => {
    const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const payload = await response.json();
    if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
    return payload.result;
  };
  const slots = async () => Object.fromEntries(await Promise.all(["processed", "confirmed", "finalized"]
    .map(async (commitment) => [commitment, await rpc.getSlot({ commitment }).send()])));

  const PROGRAM = new PublicKey(PROGRAM_ID);
  const TOKEN = token.TOKEN_PROGRAM_ID;
  const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
  const u64 = (value) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
  const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });

  const runtime = {
    surfpoolSdk: versions["@solana/surfpool"].version,
    rpcLoopback: true,
    wsLoopback: true,
    config: { offline: true, airdropSol: 0, blockProductionMode: "transaction", remoteRpcUrl: null, featureOverrides: "none (SDK default feature set)" },
    getVersion: await raw("getVersion"),
    surfnetInfo: (await raw("surfnet_getSurfnetInfo")).value?.startup,
    readinessAttempts: lease.readinessAttempts,
  };
  assert.equal(runtime.getVersion["surfnet-version"], "1.7.0", "embedded runtime must report surfnet-version 1.7.0");

  // Deploy the verified ELF at the explicit fixed program id; no keypair discovery.
  const elfBytes = fs.readFileSync(elfPath);
  assert.equal(sha256(elfBytes), evidence.elf.sha256, "ELF changed after build");
  assert.equal(lease.surfnet.deploy({ programId: PROGRAM_ID, soPath: elfPath }), PROGRAM_ID);
  const executables = { escrow: await programProvenance(PROGRAM_ID, elfBytes), tokenkeg: await programProvenance(TOKEN.toBase58()) };

  const payer = Keypair.generate(), payee = Keypair.generate(), attacker = Keypair.generate();
  lease.surfnet.fundSolMany([payer, payee, attacker].map((kp) => ({ address: kp.publicKey.toBase58(), lamports: 10_000_000_000 })));
  const mint = Keypair.generate(), source = Keypair.generate(), recipient = Keypair.generate();
  const nonces = { release: Buffer.alloc(16, 91), refund: Buffer.alloc(16, 92), sweepRelease: Buffer.alloc(16, 93), sweepRefund: Buffer.alloc(16, 94) };
  const escrowPda = (nonce) => PublicKey.findProgramAddressSync([Buffer.from("token-escrow"), payer.publicKey.toBuffer(), nonce], PROGRAM)[0];
  const vaultPda = (escrow) => PublicKey.findProgramAddressSync([Buffer.from("token-vault"), escrow.toBuffer()], PROGRAM)[0];
  const vaults = Object.values(nonces).map((nonce) => vaultPda(escrowPda(nonce)));
  const tracked = [payer.publicKey, payee.publicKey, attacker.publicKey, mint.publicKey, source.publicKey, recipient.publicKey,
    ...Object.values(nonces).flatMap((nonce) => [escrowPda(nonce), vaultPda(escrowPda(nonce))])];

  const lock = (nonce, amount) => {
    const escrow = escrowPda(nonce), vault = vaultPda(escrow);
    return new TransactionInstruction({ programId: PROGRAM, data: Buffer.concat([disc("lock_token_escrow"), u64(amount), nonce]), keys: [
      meta(escrow, true), meta(vault, true), meta(payer.publicKey, true, true), meta(payee.publicKey), meta(mint.publicKey),
      meta(source.publicKey, true), meta(recipient.publicKey), meta(TOKEN), meta(SystemProgram.programId),
    ] });
  };
  const settle = (nonce, refund, signer = payer.publicKey, dest = refund ? source.publicKey : recipient.publicKey) => {
    const escrow = escrowPda(nonce);
    return new TransactionInstruction({ programId: PROGRAM, data: disc(refund ? "cancel_token_escrow" : "release_token_escrow"), keys: [
      meta(escrow, true), meta(vaultPda(escrow), true), meta(signer, true, true), meta(mint.publicKey), meta(dest, true), meta(TOKEN),
    ] });
  };

  /** Lossless account state (bigint lamports and rentEpoch) for every tracked key. */
  async function accounts(keys = tracked) {
    const { value } = await rpc.getMultipleAccounts(keys.map((key) => address(key.toBase58())), { encoding: "base64", commitment: "processed" }).send();
    return value.map((account, i) => ({ key: keys[i].toBase58(), account: account && {
      lamports: account.lamports, owner: account.owner, executable: account.executable, rentEpoch: account.rentEpoch,
      data: Buffer.from(account.data[0], "base64"),
    } }));
  }
  const lamportSum = (state) => state.reduce((sum, { account }) => sum + (account?.lamports ?? 0n), 0n);
  const tokenAmount = (state, key) => {
    const entry = state.find((item) => item.key === key.toBase58());
    return entry.account ? entry.account.data.readBigUInt64LE(64) : 0n;
  };
  const mintSupply = (state) => state.find((item) => item.key === mint.publicKey.toBase58()).account.data.readBigUInt64LE(36);

  const transactions = [];
  const rejections = [];
  const conservationChecks = { tokenCheckpoints: 0, lamportTransactions: 0, rejectedUnchanged: 0 };

  /** Mint supply equals every token unit held by the source, recipient and every escrow vault. */
  function assertTokenConservation(state, label) {
    if (!state.find((item) => item.key === mint.publicKey.toBase58()).account) return;
    const held = [source.publicKey, recipient.publicKey, ...vaults].reduce((sum, key) => sum + tokenAmount(state, key), 0n);
    assert.equal(held, mintSupply(state), `token conservation broken at ${label}`);
    conservationChecks.tokenCheckpoints += 1;
  }

  async function send(label, ixs, signers = [payer]) {
    const before = await accounts();
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("processed");
    const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.sign(...signers);
    const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    const deadline = Date.now() + 30_000;
    let status;
    while (Date.now() < deadline) {
      status = (await conn.getSignatureStatuses([signature])).value[0];
      if (status?.err) throw new Error(`${label}: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === "finalized") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(status?.confirmationStatus, "finalized", `${label}: local finalized status not observed`);
    const landed = await rpc.getTransaction(signature, { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 0 }).send();
    assert(landed?.meta && landed.meta.err === null, `${label}: transaction meta missing or failed`);
    const fee = landed.meta.fee;
    // Per-transaction lamport conservation from the runtime's own balances: only the fee leaves.
    const preSum = landed.meta.preBalances.reduce((a, b) => a + b, 0n);
    const postSum = landed.meta.postBalances.reduce((a, b) => a + b, 0n);
    assert.equal(postSum, preSum - fee, `${label}: lamports not conserved in transaction meta`);
    // Independent lamport conservation over every tracked account, read before and after.
    const after = await accounts();
    assert.equal(lamportSum(after), lamportSum(before) - fee, `${label}: tracked lamports not conserved`);
    assertTokenConservation(after, label);
    conservationChecks.lamportTransactions += 1;
    transactions.push({ label, signature, slot: landed.slot, fee, observedStatus: status.confirmationStatus });
    return { signature, before, after, fee };
  }

  async function rejected(label, ix, signers = [payer]) {
    const before = await accounts();
    const error = await send(label, [ix], signers).then(() => null, (err) => err);
    assert(error, `${label}: expected rejection, transaction succeeded`);
    const after = await accounts();
    for (let i = 0; i < before.length; i++) {
      assert.deepEqual(after[i], before[i], `${label}: rejected transaction changed ${before[i].key}`);
    }
    conservationChecks.rejectedUnchanged += 1;
    const logs = error.transactionLogs ?? error.logs ?? [];
    const anchorError = String(logs.join("\n") + error.message).match(/Error Code: (\w+)/)?.[1] ?? null;
    rejections.push({ label, anchorError });
    return anchorError;
  }

  const balances = async () => { const s = await accounts(); return [tokenAmount(s, source.publicKey), tokenAmount(s, recipient.publicKey)]; };
  const closed = async (nonce) => {
    const escrow = escrowPda(nonce);
    const [record, vault] = await accounts([escrow, vaultPda(escrow)]);
    return record.account === null && vault.account === null;
  };
  /** Closing a settled escrow returns exactly the record and vault rent to the payer. */
  function assertClosureRentToPayer(result, nonce, label) {
    const escrow = escrowPda(nonce);
    const lam = (state, key) => state.find((item) => item.key === key.toBase58()).account?.lamports ?? 0n;
    const rent = lam(result.before, escrow) + lam(result.before, vaultPda(escrow));
    assert(rent > 0n, `${label}: escrow record and vault must hold rent before settlement`);
    assert.equal(lam(result.after, payer.publicKey), lam(result.before, payer.publicKey) - result.fee + rent,
      `${label}: closure rent did not return exactly to payer`);
  }
  const checks = [];
  const check = (name) => checks.push(name);

  // Fresh local mint and token accounts with real SPL instructions (no token cheatcodes).
  const mintRent = await conn.getMinimumBalanceForRentExemption(token.MINT_SIZE);
  const accountRent = await conn.getMinimumBalanceForRentExemption(token.ACCOUNT_SIZE);
  await send("create mint", [
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: mintRent, space: token.MINT_SIZE, programId: TOKEN }),
    token.createInitializeMint2Instruction(mint.publicKey, 6, payer.publicKey, null, TOKEN),
  ], [payer, mint]);
  for (const [account, owner, label] of [[source, payer.publicKey, "source"], [recipient, payee.publicKey, "recipient"]]) {
    await send(`create ${label} token account`, [
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: account.publicKey, lamports: accountRent, space: token.ACCOUNT_SIZE, programId: TOKEN }),
      token.createInitializeAccount3Instruction(account.publicKey, mint.publicKey, owner, TOKEN),
    ], [payer, account]);
  }
  await send("mint 1000000 to source", [token.createMintToInstruction(mint.publicKey, source.publicKey, payer.publicKey, 1_000_000n)]);

  // Release path: zero amount, exact lock, wrong signer, wrong recipient, release, closure, replay.
  assert.equal(await rejected("zero-amount lock", lock(nonces.release, 0)), "ZeroAmount"); check("zero amount lock rejected");
  await send("lock 400000", [lock(nonces.release, 400_000)]);
  assert.deepEqual(await balances(), [600_000n, 0n]);
  assert.equal(tokenAmount(await accounts(), vaultPda(escrowPda(nonces.release))), 400_000n); check("exact lock");
  // The escrow PDA is derived from the recorded payer, so another signer fails its seed constraint.
  assert.equal(await rejected("release by wrong signer", settle(nonces.release, false, attacker.publicKey), [payer, attacker]), "ConstraintSeeds");
  check("release wrong signer rejected");
  assert.equal(await rejected("release to wrong recipient", settle(nonces.release, false, payer.publicKey, source.publicKey)), "InvalidTokenAccount");
  check("release wrong recipient rejected");
  const released = await send("release", [settle(nonces.release, false)]);
  assert.deepEqual(await balances(), [600_000n, 400_000n]); check("payer-authorized recorded-recipient release");
  assert(await closed(nonces.release)); assertClosureRentToPayer(released, nonces.release, "release"); check("release closes escrow record and vault");
  await rejected("release replay", settle(nonces.release, false)); check("release replay rejected");

  // Refund path: early refund, near-boundary refund, time travel, wrong signer/destination, refund, closure, replay.
  await send("lock 200000 for refund", [lock(nonces.refund, 200_000)]);
  assert.equal(await rejected("early refund", settle(nonces.refund, true)), "CancelWindowNotElapsed"); check("early refund rejected");
  const refundEscrow = escrowPda(nonces.refund);
  const snapshotKeys = [mint.publicKey, source.publicKey, recipient.publicKey, refundEscrow, vaultPda(refundEscrow)];
  const lockedState = await accounts(snapshotKeys);
  const createdSlot = Number(lockedState[3].account.data.readBigUInt64LE(CREATED_SLOT_OFFSET));
  const refundSlot = createdSlot + CANCEL_WINDOW_SLOTS;
  const timeTravel = [];
  async function travel(label, slot) {
    const before = await slots();
    const epochInfo = lease.surfnet.timeTravelToSlot(slot);
    const immediately = await slots();
    assert(Number(immediately.processed) >= slot, `${label}: processed slot ${immediately.processed} below time-travel target ${slot}`);
    assert.equal(epochInfo.absoluteSlot, slot, `${label}: time travel returned ${epochInfo.absoluteSlot}`);
    const entry = { label, target: slot, before, epochInfo, immediatelyAfter: immediately };
    timeTravel.push(entry);
    return entry;
  }
  await travel("near boundary", refundSlot - 10);
  assert.equal(await rejected("refund 10 slots before window", settle(nonces.refund, true)), "CancelWindowNotElapsed");
  const afterNearBoundary = await slots();
  assert(BigInt(afterNearBoundary.processed) < BigInt(refundSlot), `near-boundary rejection must be evaluated before slot ${refundSlot}`);
  timeTravel.at(-1).afterRejection = afterNearBoundary;
  check("refund before cancel window boundary rejected");
  const windowTravel = await travel("past window", refundSlot + 100);
  const travelledState = await accounts(snapshotKeys);
  assert.deepEqual(travelledState, lockedState, "locked accounts must keep identical data/owner/lamports/rentEpoch across time travel");
  check("locked state byte-identical across time travel");
  assert.equal(await rejected("refund by wrong signer", settle(nonces.refund, true, attacker.publicKey), [payer, attacker]), "ConstraintSeeds");
  check("refund wrong signer rejected");
  assert.equal(await rejected("refund to wrong destination", settle(nonces.refund, true, payer.publicKey, recipient.publicKey)), "InvalidTokenAccount");
  check("refund wrong destination rejected");
  const refunded = await send("refund", [settle(nonces.refund, true)]);
  windowTravel.afterFirstPostTravelTransaction = await slots();
  windowTravel.refundTransactionSlot = transactions.at(-1).slot;
  assert(transactions.at(-1).slot >= refundSlot, "refund landed before the cancel window elapsed");
  assert.deepEqual(await balances(), [600_000n, 400_000n]); check("slot-gated original-source refund");
  assert(await closed(nonces.refund)); assertClosureRentToPayer(refunded, nonces.refund, "refund"); check("refund closes escrow record and vault");
  await rejected("refund replay", settle(nonces.refund, true)); check("refund replay rejected");
  await rejected("release after refund", settle(nonces.refund, false)); check("release after refund rejected");
  const parityBalances = await balances();

  // Surplus donation sweep: unsolicited vault tokens go to the recorded beneficiary on both rails.
  await send("lock 100000 for release sweep", [lock(nonces.sweepRelease, 100_000)]);
  await send("donate 7 to release vault", [token.createTransferCheckedInstruction(source.publicKey, mint.publicKey,
    vaultPda(escrowPda(nonces.sweepRelease)), payer.publicKey, 7n, 6, [], TOKEN)]);
  const sweptRelease = await send("release with surplus", [settle(nonces.sweepRelease, false)]);
  assert.deepEqual(await balances(), [499_993n, 500_007n]);
  assert(await closed(nonces.sweepRelease)); assertClosureRentToPayer(sweptRelease, nonces.sweepRelease, "release sweep");
  check("release sweeps surplus donation to recorded recipient");
  await send("lock 50000 for refund sweep", [lock(nonces.sweepRefund, 50_000)]);
  await send("donate 3 to refund vault", [token.createTransferCheckedInstruction(source.publicKey, mint.publicKey,
    vaultPda(escrowPda(nonces.sweepRefund)), payer.publicKey, 3n, 6, [], TOKEN)]);
  const sweepCreated = Number((await accounts([escrowPda(nonces.sweepRefund)]))[0].account.data.readBigUInt64LE(CREATED_SLOT_OFFSET));
  await travel("sweep refund window", sweepCreated + CANCEL_WINDOW_SLOTS + 100);
  const sweptRefund = await send("refund with surplus", [settle(nonces.sweepRefund, true)]);
  assert.deepEqual(await balances(), [499_993n, 500_007n]);
  assert(await closed(nonces.sweepRefund)); assertClosureRentToPayer(sweptRefund, nonces.sweepRefund, "refund sweep");
  check("refund sweeps surplus donation to original source");
  const finalState = await accounts();
  assert.equal(mintSupply(finalState), 1_000_000n);
  check("token conservation at every checkpoint");
  check("lamport conservation for every transaction and closure");

  return {
    runtime,
    executables,
    rent: { mint: mintRent, tokenAccount: accountRent, escrowRecord: released.before.find((s) => s.key === escrowPda(nonces.release).toBase58()).account.lamports },
    commitment: {
      transactionStatusObserved: [...new Set(transactions.map((tx) => tx.observedStatus))],
      note: "local runtime statuses; a local finalized status is not public-cluster settlement",
    },
    timeTravel,
    program: PROGRAM_ID,
    mint: mint.publicKey.toBase58(),
    tokenProgram: TOKEN.toBase58(),
    decimals: 6,
    createdSlot,
    refundSlot,
    balancesAtValidatorParityPoint: { source: parityBalances[0], recipient: parityBalances[1] },
    finalBalances: { source: 499_993n, recipient: 500_007n, mintSupply: 1_000_000n },
    transactions,
    rejections,
    conservationChecks,
    checks,
    elapsedMs: Date.now() - startedAt,
  };

  /** Owner, executable flag and programdata hash; for the escrow, the deployed bytes must be the ELF. */
  async function programProvenance(programId, expectedElf) {
    const [program] = await accounts([new PublicKey(programId)]);
    assert(program.account?.executable, `${programId} must be executable`);
    const result = { programId, owner: program.account.owner, executable: true, programAccountSha256: sha256(program.account.data) };
    if (program.account.owner === "BPFLoaderUpgradeab1e11111111111111111111111") {
      const programData = new PublicKey(program.account.data.subarray(4, 36));
      const [data] = await accounts([programData]);
      assert(data.account, `${programId} programdata missing`);
      const header = 45; // UpgradeableLoaderState::ProgramData metadata
      const deployed = data.account.data.subarray(header);
      result.programData = programData.toBase58();
      result.programDataSha256 = sha256(data.account.data);
      result.deployedElfSha256 = sha256(deployed.subarray(0, expectedElf ? expectedElf.length : deployed.length));
      if (expectedElf) {
        assert(deployed.subarray(0, expectedElf.length).equals(expectedElf), "deployed escrow bytes differ from the verified ELF");
        assert(deployed.subarray(expectedElf.length).every((b) => b === 0), "deployed escrow programdata has non-zero trailing bytes");
      }
    }
    return result;
  }
}

async function stopSurfnet() {
  const { rpcUrl, wsUrl } = lease;
  try {
    const stop = await stopLocalSurfnetLease(lease);
    lease.stop(); // idempotent after a confirmed stop
    const rpcClosed = await waitForPortClosed(rpcUrl);
    const wsClosed = await waitForPortClosed(wsUrl);
    cleanup.push({ step: "Surfnet stopped", ok: rpcClosed && wsClosed, stopAttempts: stop.attempts, rpcPortRefused: rpcClosed, wsPortRefused: wsClosed });
  } catch (error) {
    cleanup.push({ step: "Surfnet stopped", ok: false, error: String(error?.message ?? error) });
  } finally {
    lease = undefined;
  }
}

/** The two lanes must agree on every outcome the unchanged validator proof records. */
function compareLanes(validator, surfpool) {
  const validatorChecks = ["exact lock", "payer-authorized recorded-recipient release", "slot-gated original-source refund",
    "closed escrow records and vaults", "replay rejection"];
  assert.deepEqual(validator.checks, validatorChecks, "validator proof check list changed; update the parity map");
  const covers = {
    "exact lock": ["exact lock"],
    "payer-authorized recorded-recipient release": ["payer-authorized recorded-recipient release", "release wrong signer rejected", "release wrong recipient rejected"],
    "slot-gated original-source refund": ["early refund rejected", "slot-gated original-source refund"],
    "closed escrow records and vaults": ["release closes escrow record and vault", "refund closes escrow record and vault"],
    "replay rejection": ["release replay rejected", "refund replay rejected", "release after refund rejected"],
  };
  for (const [validatorCheck, surfpoolChecks] of Object.entries(covers)) {
    for (const name of surfpoolChecks) assert(surfpool.checks.includes(name), `Surfpool lane missing ${name} for ${validatorCheck}`);
  }
  assert.equal(validator.program, surfpool.program);
  assert.equal(validator.escrowElfSha256, evidence.elf.sha256, "validator lane loaded a different ELF");
  assert.equal(surfpool.executables.escrow.deployedElfSha256, evidence.elf.sha256, "Surfpool lane deployed a different ELF");
  assert.equal(validator.tokenProgram, surfpool.tokenProgram);
  assert.equal(validator.decimals, surfpool.decimals);
  assert.equal(validator.refundSlot - validator.createdSlot, CANCEL_WINDOW_SLOTS);
  assert.equal(surfpool.refundSlot - surfpool.createdSlot, CANCEL_WINDOW_SLOTS);
  assert.equal(String(surfpool.balancesAtValidatorParityPoint.source), validator.sourceBalance);
  assert.equal(String(surfpool.balancesAtValidatorParityPoint.recipient), validator.recipientBalance);
  return {
    ok: true,
    sameElfSha256: evidence.elf.sha256,
    validatorChecksCovered: covers,
    surfpoolOnlyChecks: surfpool.checks.filter((name) => !Object.values(covers).flat().includes(name)),
    runtimes: { validator: validator.validator, surfpool: surfpool.runtime.getVersion },
    timeMethod: { validator: validator.method, surfpool: "timeTravelToSlot cheatcode on one live embedded runtime; real transactions for every state transition" },
  };
}
