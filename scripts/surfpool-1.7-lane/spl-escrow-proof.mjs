#!/usr/bin/env node
/* Opt-in, offline, version-qualified Surfpool 1.7.0 local proof lane for the classic SPL token
 * escrow (#746). It builds the escrow ELF at the exact committed source, runs the existing validator
 * proof (archive/anchor-escrow/tests/local_token_escrow.cjs) unchanged, then runs the same scenario (lock
 * refusals, payer release, payee decline, payer refund after the 648,000 slots its lock named, payee claim after
 * the 1,512,000 slots its lock named, stranger refusals and replays) plus near-boundary, surplus-donation and
 * conservation checks against that same ELF on an embedded Surfpool 1.7.0 runtime, and requires the
 * two lanes to agree.
 *
 * Setup:  npm run setup:surfpool:spl-escrow-1.7
 * Run:    RAP_SURFPOOL_LANE_OUT_DIR=/absolute/fresh/dir npm run test:surfpool:spl-escrow-1.7
 * Linux x64 only. The ELF is built and the validator proof is run with the baseline-owned Agave tree
 * from scripts/solana-baseline-toolchain.sh (cargo-build-sbf 4.1.0, solana-test-validator 4.2.2).
 *
 * Boundaries: embedded SDK only, offline (no remoteRpcUrl), loopback RPC/WS on dynamic ports, keys
 * generated in memory and never printed, explicit fixed program id plus the verified ELF. SOL
 * funding uses the fundSolMany cheatcode. The program accepts only allowlisted mints, so the
 * setAccount cheatcode writes a zero-supply stand-in mint, owned by the in-memory payer, at the
 * allowlisted mainnet USDC address; it is not real USDC, and every token balance comes from real
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
const PROGRAM_ID = "DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu";
// Allowlisted in the default build (constants.rs USDC_MAINNET_MINT). Only the address is reused.
const ALLOWLISTED_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// constants.rs PROTOCOL_TREASURY and PROTOCOL_FEE_BPS. Only the address is used: a local token account is created for it.
const PROTOCOL_TREASURY = "5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe";
const PROTOCOL_FEE_BPS = 250;
// Windows are named per escrow at lock, in slots. Every lock here names 648,000 slots (about 3 days) for both its
// claim and its refund window, except the claim-case escrow, which names 1,512,000 (about 7 days) for both, so the
// refund phase runs before any claim is open.
const CANCEL_WINDOW_SLOTS = 648_000;
const CLAIM_WINDOW_SLOTS = 1_512_000;
const CREATED_SLOT_OFFSET = 193; // TokenEscrowAccount: disc 8 + 5 keys + amount 8 + nonce 16 + status 1
const SOURCE_DIRTY_PATHS = ["archive/anchor-escrow", "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "Anchor.toml"];

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

const evidence = { runId, label: "LOCAL STAND-IN MINT at the allowlisted USDC address; not real USDC; local runtime evidence, no devnet or mainnet proof", status: "FAIL" };
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
  for (let dir = path.join(repoRoot, "archive", "anchor-escrow", "tests"); ; dir = path.dirname(dir)) {
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
    escrowTree: git("rev-parse", "HEAD:archive/anchor-escrow"),
    cargoLockBlob: git("rev-parse", "HEAD:Cargo.lock"),
    validatorProofBlob: git("rev-parse", "HEAD:archive/anchor-escrow/tests/local_token_escrow.cjs"),
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
    ["--manifest-path", "archive/anchor-escrow/Cargo.toml", "--sbf-out-dir", "target/deploy"], {
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
  const child = spawn(process.execPath, ["archive/anchor-escrow/tests/local_token_escrow.cjs"], {
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
  // The program only accepts allowlisted mints, so a disposable stand-in mint whose authority is the
  // in-memory payer is written at the allowlisted address before any transaction, as the validator
  // proof does with a genesis account file. Only the address is reused: no real USDC exists here.
  const MINT = new PublicKey(ALLOWLISTED_MINT);
  const mintRent = await conn.getMinimumBalanceForRentExemption(token.MINT_SIZE);
  const accountRent = await conn.getMinimumBalanceForRentExemption(token.ACCOUNT_SIZE);
  const mintData = Buffer.alloc(token.MINT_SIZE);
  token.MintLayout.encode({ mintAuthorityOption: 1, mintAuthority: payer.publicKey, supply: 0n, decimals: 6,
    isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
  lease.surfnet.setAccount(MINT.toBase58(), mintRent, [...mintData], TOKEN.toBase58());
  const installedMint = token.unpackMint(MINT, await conn.getAccountInfo(MINT, "processed"), TOKEN);
  assert(installedMint.mintAuthority.equals(payer.publicKey) && installedMint.decimals === 6 && installedMint.supply === 0n,
    "stand-in mint not installed as written");

  const source = Keypair.generate(), recipient = Keypair.generate(), stray = Keypair.generate();
  const TREASURY = new PublicKey(PROTOCOL_TREASURY);
  // Token fees are only accepted at the treasury's associated token account for the mint.
  const treasuryToken = { publicKey: token.getAssociatedTokenAddressSync(MINT, TREASURY, true, TOKEN) };
  const otherMint = Keypair.generate(), otherSource = Keypair.generate(), otherRecipient = Keypair.generate();
  const nonces = { release: Buffer.alloc(16, 91), decline: Buffer.alloc(16, 92), refund: Buffer.alloc(16, 93), claim: Buffer.alloc(16, 94),
    sweepRelease: Buffer.alloc(16, 95), sweepDecline: Buffer.alloc(16, 96), metered: Buffer.alloc(16, 97) };
  const escrowPda = (nonce) => PublicKey.findProgramAddressSync([Buffer.from("token-escrow"), payer.publicKey.toBuffer(), nonce], PROGRAM)[0];
  const vaultPda = (escrow) => PublicKey.findProgramAddressSync([Buffer.from("token-vault"), escrow.toBuffer()], PROGRAM)[0];
  const vaults = Object.values(nonces).map((nonce) => vaultPda(escrowPda(nonce)));
  const tracked = [payer.publicKey, payee.publicKey, attacker.publicKey, MINT, source.publicKey, recipient.publicKey,
    treasuryToken.publicKey, stray.publicKey,
    otherMint.publicKey, otherSource.publicKey, otherRecipient.publicKey,
    ...Object.values(nonces).flatMap((nonce) => [escrowPda(nonce), vaultPda(escrowPda(nonce))])];

  const lock = (nonce, amount, accounts = { mint: MINT, source: source.publicKey, recipient: recipient.publicKey }, metered = false, windowSlots = CANCEL_WINDOW_SLOTS) => {
    const escrow = escrowPda(nonce), vault = vaultPda(escrow);
    return new TransactionInstruction({ programId: PROGRAM,
      data: Buffer.concat([disc(metered ? "lock_metered_token_escrow" : "lock_token_escrow"), u64(amount), nonce, u64(windowSlots), u64(windowSlots)]), keys: [
      meta(escrow, true), meta(vault, true), meta(payer.publicKey, true, true), meta(payee.publicKey), meta(accounts.mint),
      meta(accounts.source, true), meta(accounts.recipient), meta(TOKEN), meta(SystemProgram.programId),
    ] });
  };
  // Refund: escrow, vault, authority (signer), payer (rent), mint, destination, token program.
  // Release and settle-at-actual-cost add the treasury token account and the payer's refund account before the token program.
  const settle = (nonce, kind, authority, dest = kind === "refund" ? source.publicKey : recipient.publicKey, actual) => {
    const escrow = escrowPda(nonce);
    const head = [meta(escrow, true), meta(vaultPda(escrow), true), meta(authority.publicKey, false, true), meta(payer.publicKey, true),
      meta(MINT), meta(dest, true)];
    if (kind === "refund") return new TransactionInstruction({ programId: PROGRAM, data: disc("cancel_token_escrow"), keys: [...head, meta(TOKEN)] });
    return new TransactionInstruction({ programId: PROGRAM,
      data: kind === "settle" ? Buffer.concat([disc("settle_token_escrow"), u64(actual)]) : disc("release_token_escrow"),
      keys: [...head, meta(treasuryToken.publicKey, true), meta(source.publicKey, true), meta(TOKEN)] });
  };
  const release = (nonce, authority, dest) => settle(nonce, "release", authority, dest);
  const refund = (nonce, authority, dest) => settle(nonce, "refund", authority, dest);
  const settleActual = (nonce, authority, actual) => settle(nonce, "settle", authority, undefined, actual);
  const signersFor = (authority) => (authority === payer ? [payer] : [payer, authority]);

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
  const mintSupply = (state) => state.find((item) => item.key === MINT.toBase58()).account.data.readBigUInt64LE(36);

  const transactions = [];
  const rejections = [];
  const conservationChecks = { tokenCheckpoints: 0, lamportTransactions: 0, rejectedUnchanged: 0 };

  /** Stand-in mint supply equals every unit held by the source, recipient, treasury token account and every escrow vault. */
  function assertTokenConservation(state, label) {
    const held = [source.publicKey, recipient.publicKey, treasuryToken.publicKey, stray.publicKey, ...vaults].reduce((sum, key) => sum + tokenAmount(state, key), 0n);
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

  /** The instruction must fail, leave every tracked account unchanged, and (when named) fail with that program error. */
  async function rejected(label, ix, signers = [payer], expected) {
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
    if (expected) assert.equal(anchorError, expected, `${label}: expected ${expected}`);
    return anchorError;
  }

  const balances = async () => { const s = await accounts(); return [tokenAmount(s, source.publicKey), tokenAmount(s, recipient.publicKey), tokenAmount(s, treasuryToken.publicKey)]; };
  const closed = async (nonce) => {
    const escrow = escrowPda(nonce);
    const [record, vault] = await accounts([escrow, vaultPda(escrow)]);
    return record.account === null && vault.account === null;
  };
  const createdSlotOf = async (nonce) => Number((await accounts([escrowPda(nonce)]))[0].account.data.readBigUInt64LE(CREATED_SLOT_OFFSET));
  /** Closing a settled escrow returns exactly the record and vault rent to the payer, whoever signed. */
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
  async function tokenAccount(label, keypair, mint, owner) {
    return send(`create ${label} token account`, [
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: keypair.publicKey, lamports: accountRent, space: token.ACCOUNT_SIZE, programId: TOKEN }),
      token.createInitializeAccount3Instruction(keypair.publicKey, mint, owner, TOKEN),
    ], [payer, keypair]);
  }
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

  // Token accounts and balances come from real SPL instructions (no token cheatcodes).
  await tokenAccount("source", source, MINT, payer.publicKey);
  await tokenAccount("recipient", recipient, MINT, payee.publicKey);
  await send("create the treasury associated token account", [token.createAssociatedTokenAccountInstruction(payer.publicKey, treasuryToken.publicKey, TREASURY, MINT, TOKEN)]);
  await tokenAccount("stray (attacker-owned)", stray, MINT, attacker.publicKey);
  await send("mint 200000000 to source", [token.createMintToInstruction(MINT, source.publicKey, payer.publicKey, 200_000_000n)]);

  // Lock refusals: zero amount, above the 100-unit cap, and a mint that is not allowlisted.
  await rejected("zero-amount lock", lock(nonces.release, 0), [payer], "ZeroAmount"); check("zero amount lock rejected");
  await rejected("lock above cap", lock(nonces.release, 100_000_001), [payer], "AmountAboveCap"); check("lock above cap rejected");
  await send("create non-allowlisted mint", [
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: otherMint.publicKey, lamports: mintRent, space: token.MINT_SIZE, programId: TOKEN }),
    token.createInitializeMint2Instruction(otherMint.publicKey, 6, payer.publicKey, null, TOKEN),
  ], [payer, otherMint]);
  await tokenAccount("non-allowlisted source", otherSource, otherMint.publicKey, payer.publicKey);
  await tokenAccount("non-allowlisted recipient", otherRecipient, otherMint.publicKey, payee.publicKey);
  await send("mint 1000000 of the non-allowlisted mint", [token.createMintToInstruction(otherMint.publicKey, otherSource.publicKey, payer.publicKey, 1_000_000n)]);
  await rejected("lock a non-allowlisted mint", lock(nonces.release, 400_000,
    { mint: otherMint.publicKey, source: otherSource.publicKey, recipient: otherRecipient.publicKey }), [payer], "MintNotAllowed");
  assert.equal(tokenAmount(await accounts(), otherSource.publicKey), 1_000_000n);
  check("non-allowlisted mint lock rejected");

  // Payer release to the recorded recipient.
  await send("lock 400000", [lock(nonces.release, 400_000)]);
  assert.deepEqual(await balances(), [199_600_000n, 0n, 0n]);
  assert.equal(tokenAmount(await accounts(), vaultPda(escrowPda(nonces.release))), 400_000n); check("exact lock");
  await rejected("release by a stranger", release(nonces.release, attacker), signersFor(attacker), "UnauthorisedSigner");
  check("release by stranger rejected");
  await rejected("payee claim before the claim window", release(nonces.release, payee), signersFor(payee), "ClaimWindowNotElapsed");
  check("early payee claim rejected");
  await rejected("release to wrong recipient", release(nonces.release, payer, stray.publicKey), [payer], "InvalidTokenAccount");
  check("release wrong recipient rejected");
  await rejected("payee settle of an escrow that is not metered", settleActual(nonces.release, payee, 100_000), signersFor(payee), "NotMetered");
  check("payee settle of non-metered escrow rejected");
  const released = await send("release", [release(nonces.release, payer)]);
  assert.deepEqual(await balances(), [199_600_000n, 390_000n, 10_000n]); check("payer release to recorded recipient");
  check("release pays the 2.5% protocol fee to the treasury");
  assert(await closed(nonces.release)); assertClosureRentToPayer(released, nonces.release, "release"); check("release closes escrow record and vault");
  await rejected("release replay", release(nonces.release, payer)); check("release replay rejected");

  // Payee decline at any time, back to the recorded source only.
  await send("lock 200000 for decline", [lock(nonces.decline, 200_000)]);
  assert.deepEqual(await balances(), [199_400_000n, 390_000n, 10_000n]);
  await rejected("decline by a stranger", refund(nonces.decline, attacker), signersFor(attacker), "UnauthorisedSigner");
  check("decline by stranger rejected");
  await rejected("payer refund before the cancel window", refund(nonces.decline, payer), [payer], "CancelWindowNotElapsed");
  check("early payer refund rejected");
  await rejected("decline to wrong destination", refund(nonces.decline, payee, recipient.publicKey), signersFor(payee), "InvalidTokenAccount");
  check("decline wrong destination rejected");
  const declined = await send("payee decline", [refund(nonces.decline, payee)], signersFor(payee));
  assert.deepEqual(await balances(), [199_600_000n, 390_000n, 10_000n]); check("payee decline to recorded source");
  check("refund pays no protocol fee");
  assert(await closed(nonces.decline)); assertClosureRentToPayer(declined, nonces.decline, "decline"); check("decline closes escrow record and vault");
  await rejected("decline replay", refund(nonces.decline, payee), signersFor(payee)); check("decline replay rejected");

  // Metered escrow: the payer locks a maximum, the payee settles the actual cost at any time.
  await send("lock metered maximum 300000", [lock(nonces.metered, 300_000, undefined, true)]);
  assert.deepEqual(await balances(), [199_300_000n, 390_000n, 10_000n]);
  await rejected("metered settle by a stranger", settleActual(nonces.metered, attacker, 120_000), signersFor(attacker), "UnauthorisedSigner");
  check("metered settle by stranger rejected");
  await rejected("metered settle of zero", settleActual(nonces.metered, payee, 0), signersFor(payee), "InvalidSettleAmount");
  await rejected("metered settle above the maximum", settleActual(nonces.metered, payee, 300_001), signersFor(payee), "InvalidSettleAmount");
  check("metered settle outside 1..maximum rejected");
  const settled = await send("payee settles 120000 of 300000", [settleActual(nonces.metered, payee, 120_000)], signersFor(payee));
  // 117,000 to the payee, 3,000 to the treasury, the unused 180,000 back to the payer.
  assert.deepEqual(await balances(), [199_480_000n, 507_000n, 13_000n]); check("metered settle pays actual cost less fee and returns the rest");
  assert(await closed(nonces.metered)); assertClosureRentToPayer(settled, nonces.metered, "metered settle"); check("metered settle closes escrow record and vault");
  await rejected("metered settle replay", settleActual(nonces.metered, payee, 120_000), signersFor(payee)); check("metered settle replay rejected");

  // Two escrows for the time-gated cases.
  await send("lock 150000 for refund", [lock(nonces.refund, 150_000)]);
  await send("lock 100000 for claim", [lock(nonces.claim, 100_000, undefined, false, CLAIM_WINDOW_SLOTS)]);
  assert.deepEqual(await balances(), [199_230_000n, 507_000n, 13_000n]);
  const gatedKeys = [MINT, source.publicKey, recipient.publicKey, treasuryToken.publicKey, escrowPda(nonces.refund), vaultPda(escrowPda(nonces.refund)),
    escrowPda(nonces.claim), vaultPda(escrowPda(nonces.claim))];
  const lockedState = await accounts(gatedKeys);
  const refundCreatedSlot = await createdSlotOf(nonces.refund), claimCreatedSlot = await createdSlotOf(nonces.claim);
  const refundSlot = refundCreatedSlot + CANCEL_WINDOW_SLOTS, claimSlot = claimCreatedSlot + CLAIM_WINDOW_SLOTS;

  // Just before the cancel window: the payer still cannot refund.
  await travel("near cancel boundary", refundSlot - 10);
  await rejected("refund 10 slots before the cancel window", refund(nonces.refund, payer), [payer], "CancelWindowNotElapsed");
  const afterNearCancel = await slots();
  assert(BigInt(afterNearCancel.processed) < BigInt(refundSlot), `near-boundary refund rejection must be evaluated before slot ${refundSlot}`);
  timeTravel.at(-1).afterRejection = afterNearCancel;
  check("refund before cancel window boundary rejected");

  // Past the cancel window, before the claim window: the payer refunds, the payee still cannot claim.
  const cancelTravel = await travel("past cancel window", refundSlot + 100);
  assert.deepEqual(await accounts(gatedKeys), lockedState, "locked accounts must keep identical data/owner/lamports/rentEpoch across time travel");
  check("locked state byte-identical across time travel");
  await rejected("refund by a stranger", refund(nonces.refund, attacker), signersFor(attacker), "UnauthorisedSigner");
  check("refund by stranger rejected");
  await rejected("payee claim after the cancel window, before the claim window", release(nonces.claim, payee), signersFor(payee), "ClaimWindowNotElapsed");
  check("payee claim between windows rejected");
  const refunded = await send("payer refund", [refund(nonces.refund, payer)]);
  cancelTravel.afterFirstPostTravelTransaction = await slots();
  cancelTravel.refundTransactionSlot = transactions.at(-1).slot;
  assert(transactions.at(-1).slot >= refundSlot, "refund landed before the cancel window elapsed");
  assert(transactions.at(-1).slot < claimSlot, "refund phase must run before the claim window");
  assert.deepEqual(await balances(), [199_380_000n, 507_000n, 13_000n]); check("slot-gated payer refund to source");
  assert(await closed(nonces.refund)); assertClosureRentToPayer(refunded, nonces.refund, "refund"); check("refund closes escrow record and vault");
  await rejected("refund replay", refund(nonces.refund, payer)); check("refund replay rejected");
  await rejected("release after refund", release(nonces.refund, payer)); check("release after refund rejected");

  // Just before the claim window: the payee still cannot claim.
  const claimKeys = [MINT, source.publicKey, recipient.publicKey, treasuryToken.publicKey, escrowPda(nonces.claim), vaultPda(escrowPda(nonces.claim))];
  const claimLockedState = await accounts(claimKeys);
  await travel("near claim boundary", claimSlot - 10);
  await rejected("claim 10 slots before the claim window", release(nonces.claim, payee), signersFor(payee), "ClaimWindowNotElapsed");
  const afterNearClaim = await slots();
  assert(BigInt(afterNearClaim.processed) < BigInt(claimSlot), `near-boundary claim rejection must be evaluated before slot ${claimSlot}`);
  timeTravel.at(-1).afterRejection = afterNearClaim;
  check("claim before claim window boundary rejected");

  // Past the claim window: a stranger is still refused, the payee claims to the recorded recipient.
  const claimTravel = await travel("past claim window", claimSlot + 100);
  assert.deepEqual(await accounts(claimKeys), claimLockedState, "claim escrow must keep identical data/owner/lamports/rentEpoch across time travel");
  await rejected("claim by a stranger", release(nonces.claim, attacker), signersFor(attacker), "UnauthorisedSigner");
  check("claim by stranger rejected");
  await rejected("claim to wrong destination", release(nonces.claim, payee, stray.publicKey), signersFor(payee), "InvalidTokenAccount");
  check("claim wrong destination rejected");
  const claimed = await send("payee claim", [release(nonces.claim, payee)], signersFor(payee));
  claimTravel.claimTransactionSlot = transactions.at(-1).slot;
  assert(transactions.at(-1).slot >= claimSlot, "claim landed before the claim window elapsed");
  assert.deepEqual(await balances(), [199_380_000n, 604_500n, 15_500n]); check("slot-gated payee claim to recorded recipient");
  assert(await closed(nonces.claim)); assertClosureRentToPayer(claimed, nonces.claim, "claim"); check("claim closes escrow record and vault");
  await rejected("claim replay", release(nonces.claim, payee), signersFor(payee)); check("claim replay rejected");
  await rejected("refund after claim", refund(nonces.claim, payer)); check("refund after claim rejected");
  const parityBalances = await balances();

  // Surplus donations: on a payout they return to the payer with any unused amount; on a refund they go with the refund.
  await send("lock 100000 for release sweep", [lock(nonces.sweepRelease, 100_000)]);
  await send("donate 7 to release vault", [token.createTransferCheckedInstruction(source.publicKey, MINT,
    vaultPda(escrowPda(nonces.sweepRelease)), payer.publicKey, 7n, 6, [], TOKEN)]);
  const sweptRelease = await send("release with surplus", [release(nonces.sweepRelease, payer)]);
  // 97,500 to the payee, 2,500 to the treasury, and the donated 7 back to the payer's source account.
  assert.deepEqual(await balances(), [199_280_000n, 702_000n, 18_000n]);
  assert(await closed(nonces.sweepRelease)); assertClosureRentToPayer(sweptRelease, nonces.sweepRelease, "release sweep");
  check("release returns surplus donation to the payer");
  await send("lock 50000 for decline sweep", [lock(nonces.sweepDecline, 50_000)]);
  await send("donate 3 to decline vault", [token.createTransferCheckedInstruction(source.publicKey, MINT,
    vaultPda(escrowPda(nonces.sweepDecline)), payer.publicKey, 3n, 6, [], TOKEN)]);
  const sweptDecline = await send("decline with surplus", [refund(nonces.sweepDecline, payee)], signersFor(payee));
  assert.deepEqual(await balances(), [199_280_000n, 702_000n, 18_000n]);
  assert(await closed(nonces.sweepDecline)); assertClosureRentToPayer(sweptDecline, nonces.sweepDecline, "decline sweep");
  check("decline sweeps surplus donation to original source");
  const finalState = await accounts();
  assert.equal(mintSupply(finalState), 200_000_000n);
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
    mint: MINT.toBase58(),
    mintInstall: "setAccount cheatcode writes a zero-supply stand-in mint at the allowlisted address; every balance comes from real SPL instructions",
    tokenProgram: TOKEN.toBase58(),
    decimals: 6,
    cancelWindowSlots: CANCEL_WINDOW_SLOTS,
    claimWindowSlots: CLAIM_WINDOW_SLOTS,
    refundCreatedSlot,
    claimCreatedSlot,
    refundSlot,
    claimSlot,
    balancesAtValidatorParityPoint: { source: parityBalances[0], recipient: parityBalances[1], treasury: parityBalances[2] },
    protocolFeeBps: PROTOCOL_FEE_BPS,
    treasury: PROTOCOL_TREASURY,
    finalBalances: { source: 199_280_000n, recipient: 702_000n, treasury: 18_000n, mintSupply: 200_000_000n },
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
  const covers = {
    "zero, above-cap and non-allowlisted locks refused": ["zero amount lock rejected", "lock above cap rejected", "non-allowlisted mint lock rejected"],
    "exact lock": ["exact lock"],
    "payer release to the recorded recipient": ["payer release to recorded recipient", "release wrong recipient rejected"],
    "payee decline to the recorded source": ["payee decline to recorded source", "decline wrong destination rejected"],
    "payer refund refused before and allowed after the cancel window": ["early payer refund rejected",
      "refund before cancel window boundary rejected", "slot-gated payer refund to source"],
    "payee claim refused before and allowed after the claim window": ["early payee claim rejected", "payee claim between windows rejected",
      "claim before claim window boundary rejected", "slot-gated payee claim to recorded recipient"],
    "stranger refused on every path": ["release by stranger rejected", "decline by stranger rejected", "refund by stranger rejected",
      "claim by stranger rejected"],
    "closed escrow records and vaults": ["release closes escrow record and vault", "decline closes escrow record and vault",
      "refund closes escrow record and vault", "claim closes escrow record and vault"],
    "replay rejection": ["release replay rejected", "decline replay rejected", "refund replay rejected", "release after refund rejected",
      "claim replay rejected", "refund after claim rejected", "metered settle replay rejected"],
    "protocol fee of 2.5% to the treasury on every payout": ["release pays the 2.5% protocol fee to the treasury", "refund pays no protocol fee"],
    "metered escrow settled by the payee at its actual cost": ["metered settle pays actual cost less fee and returns the rest",
      "metered settle by stranger rejected", "metered settle outside 1..maximum rejected", "payee settle of non-metered escrow rejected",
      "metered settle closes escrow record and vault"],
  };
  assert.deepEqual(validator.checks, Object.keys(covers), "validator proof check list changed; update the parity map");
  for (const [validatorCheck, surfpoolChecks] of Object.entries(covers)) {
    for (const name of surfpoolChecks) assert(surfpool.checks.includes(name), `Surfpool lane missing ${name} for ${validatorCheck}`);
  }
  assert.equal(validator.program, surfpool.program);
  assert.equal(validator.escrowElfSha256, evidence.elf.sha256, "validator lane loaded a different ELF");
  assert.equal(surfpool.executables.escrow.deployedElfSha256, evidence.elf.sha256, "Surfpool lane deployed a different ELF");
  assert.equal(validator.mint, surfpool.mint);
  assert.equal(validator.mint, ALLOWLISTED_MINT);
  assert.equal(validator.tokenProgram, surfpool.tokenProgram);
  assert.equal(validator.decimals, surfpool.decimals);
  for (const lane of [validator, surfpool]) {
    assert.equal(lane.cancelWindowSlots, CANCEL_WINDOW_SLOTS);
    assert.equal(lane.claimWindowSlots, CLAIM_WINDOW_SLOTS);
    assert.equal(lane.claimSlot - lane.claimCreatedSlot, CLAIM_WINDOW_SLOTS);
  }
  // The validator proof gates both escrows on the later lock; the Surfpool lane gates each on its own.
  assert.equal(validator.refundSlot - Math.max(validator.refundCreatedSlot, validator.claimCreatedSlot), CANCEL_WINDOW_SLOTS);
  assert.equal(surfpool.refundSlot - surfpool.refundCreatedSlot, CANCEL_WINDOW_SLOTS);
  assert.equal(String(surfpool.balancesAtValidatorParityPoint.source), validator.sourceBalance);
  assert.equal(String(surfpool.balancesAtValidatorParityPoint.recipient), validator.recipientBalance);
  assert.equal(String(surfpool.balancesAtValidatorParityPoint.treasury), validator.treasuryBalance);
  assert.equal(validator.protocolFeeBps, PROTOCOL_FEE_BPS);
  assert.equal(validator.treasury, PROTOCOL_TREASURY);
  return {
    ok: true,
    sameElfSha256: evidence.elf.sha256,
    validatorChecksCovered: covers,
    surfpoolOnlyChecks: surfpool.checks.filter((name) => !Object.values(covers).flat().includes(name)),
    runtimes: { validator: validator.validator, surfpool: surfpool.runtime.getVersion },
    timeMethod: { validator: validator.method, surfpool: "timeTravelToSlot cheatcode on one live embedded runtime; real transactions for every state transition" },
  };
}
