/**
 * Which build of the escrow program the sandbox talks to on devnet, and so how it encodes an exit.
 *
 * Builds before the freeze (21 November 2026, `v1-devnet-b71a91e.json`) read trailing slot bytes on
 * an exit of an unrated escrow as a rating of another job and refuse the exit (6051). The freeze
 * build (`v1-devnet-45e9547.json`) requires those bytes on every exit and refuses an exit without
 * them (6053). The delivery-check build (`v1-devnet-9c34fac.json`) encodes those exits the same way;
 * it only adds a trailing account to escrows that opt into the delivery check, which the sandbox
 * never locks. The pooled-Budget build (`v1-devnet-64543ff.json`) adds instructions and keeps that
 * encoding too. An exit encoded for the wrong build leaves the visitor's lock unsettled, so the
 * sandbox reads the encoding from the release record of the build devnet runs, and serves a paid
 * call only once it has checked that the program on devnet is that build: its ProgramData account
 * says it was last deployed in the record's `deployedSlot`.
 *
 * Browser-safe: no keys, no node crypto. Recording an upgrade (filling `deployedSlot` in its
 * release record) moves the sandbox to the new encoding; until then, after an upgrade, the deployed
 * slot no longer matches and paid calls are refused before any lock is asked for.
 */
import { PublicKey } from "@solana/web3.js";
import devnetPreFreeze from "@/config/releases/v1-devnet-b71a91e.json";
import devnetFreeze from "@/config/releases/v1-devnet-45e9547.json";
import devnetDeliveryCheck from "@/config/releases/v1-devnet-9c34fac.json";
import devnetBudget from "@/config/releases/v1-devnet-64543ff.json";
import { SANDBOX_ESCROW_PROGRAM_ID } from "./escrow";

export type SandboxReleaseRecord = {
  network: string;
  commit: string;
  programId: string;
  executableHash: string;
  deployedSlot: number | null;
};

/** The devnet release records the sandbox knows. Add a record here in the change that adds it to config/releases. */
export const SANDBOX_DEVNET_RELEASES: readonly SandboxReleaseRecord[] = [devnetPreFreeze, devnetFreeze, devnetDeliveryCheck, devnetBudget];

/**
 * Whether a build takes the escrow's created_slot after the data of an exit of an unrated escrow,
 * keyed by the build's executable hash. A build missing here is never served. The on-chain check
 * below matches the live program to its record by the ProgramData deployed slot, not by hashing
 * the executable: on devnet only the upgrade authority can redeploy, and every redeploy moves it.
 */
export const NAMES_UNRATED_EXITS_BY_EXECUTABLE_HASH: Readonly<Record<string, boolean>> = {
  [devnetPreFreeze.executableHash]: false,
  [devnetFreeze.executableHash]: true,
  [devnetDeliveryCheck.executableHash]: true,
  [devnetBudget.executableHash]: true,
};

export type SandboxProgramBuild = {
  commit: string;
  executableHash: string;
  deployedSlot: bigint;
  /** An exit of an unrated escrow carries the escrow's created_slot after its data. */
  namesUnratedExits: boolean;
};

/** `message` says why paid calls are paused, in one sentence; the caller adds what it means for the visitor's money. */
export type SandboxDeploymentCheck = { ok: true; build: SandboxProgramBuild } | { ok: false; message: string };

/** The build devnet should be running: the latest deployed devnet record for the sandbox program, when its encoding is known. */
export function sandboxBuildOfRecord(records: readonly SandboxReleaseRecord[] = SANDBOX_DEVNET_RELEASES, programId: PublicKey = SANDBOX_ESCROW_PROGRAM_ID): SandboxProgramBuild | undefined {
  const deployed = records
    .filter((r) => r.network === "devnet" && r.programId === programId.toBase58() && typeof r.deployedSlot === "number" && Number.isSafeInteger(r.deployedSlot))
    .sort((a, b) => (b.deployedSlot as number) - (a.deployedSlot as number));
  const latest = deployed[0];
  if (!latest) return undefined;
  // Two records claiming one deploy slot cannot both be right.
  if (deployed[1] && deployed[1].deployedSlot === latest.deployedSlot) return undefined;
  const namesUnratedExits = NAMES_UNRATED_EXITS_BY_EXECUTABLE_HASH[latest.executableHash];
  if (namesUnratedExits === undefined) return undefined;
  return { commit: latest.commit, executableHash: latest.executableHash, deployedSlot: BigInt(latest.deployedSlot as number), namesUnratedExits };
}

export const UPGRADEABLE_LOADER_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

export type DeploymentAccountReader = (address: PublicKey) => Promise<{ owner: PublicKey; data: Uint8Array } | null>;

const NOT_VERIFIED = "The devnet escrow program is not a build the sandbox knows how to settle with, so paid calls are paused.";
const RPC_UNREADABLE = "The devnet RPC could not be read, so paid calls are paused for a moment.";

/**
 * Checks that the program on devnet is the build of record: an upgradeable program whose ProgramData
 * account was last deployed in the record's slot. Reads two accounts.
 */
export async function checkSandboxDeployment(
  readAccount: DeploymentAccountReader,
  options: { records?: readonly SandboxReleaseRecord[]; programId?: PublicKey } = {},
): Promise<SandboxDeploymentCheck> {
  const programId = options.programId ?? SANDBOX_ESCROW_PROGRAM_ID;
  const build = sandboxBuildOfRecord(options.records, programId);
  if (!build) return { ok: false, message: NOT_VERIFIED };
  let program: Awaited<ReturnType<DeploymentAccountReader>>;
  try {
    program = await readAccount(programId);
  } catch {
    return { ok: false, message: RPC_UNREADABLE };
  }
  // Program account: u32 tag 2, then the ProgramData address.
  if (!program || !program.owner.equals(UPGRADEABLE_LOADER_ID) || program.data.length < 36 || readU32(program.data, 0) !== 2) return { ok: false, message: NOT_VERIFIED };
  const programDataAddress = new PublicKey(program.data.subarray(4, 36));
  let programData: Awaited<ReturnType<DeploymentAccountReader>>;
  try {
    programData = await readAccount(programDataAddress);
  } catch {
    return { ok: false, message: RPC_UNREADABLE };
  }
  // ProgramData account: u32 tag 3, then the slot it was last deployed in (u64 LE).
  if (!programData || !programData.owner.equals(UPGRADEABLE_LOADER_ID) || programData.data.length < 12 || readU32(programData.data, 0) !== 3) return { ok: false, message: NOT_VERIFIED };
  if (readU64(programData.data, 4) !== build.deployedSlot) {
    console.error("[sandbox-deployment] devnet program is not the build of record", { programId: programId.toBase58(), expectedDeployedSlot: build.deployedSlot.toString(), deployedSlot: readU64(programData.data, 4).toString() });
    return { ok: false, message: NOT_VERIFIED };
  }
  return { ok: true, build };
}

/** Remembers a passed check for `ttlMs` (one minute by default). A failed check is not remembered. */
export function cachedSandboxDeploymentCheck(readAccount: DeploymentAccountReader, options: { ttlMs?: number; now?: () => number; records?: readonly SandboxReleaseRecord[]; programId?: PublicKey } = {}): () => Promise<SandboxDeploymentCheck> {
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  let passed: { at: number; check: SandboxDeploymentCheck } | undefined;
  return async () => {
    if (passed && now() - passed.at < ttlMs) return passed.check;
    const check = await checkSandboxDeployment(readAccount, options);
    passed = check.ok ? { at: now(), check } : undefined;
    return check;
  };
}

function readU32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}
