import { Keypair, PublicKey } from "@solana/web3.js";
import vectors from "@/programs/pinocchio-escrow/interface/vectors.json";
import devnetPreFreeze from "@/config/releases/v1-devnet-b71a91e.json";
import devnetFreeze from "@/config/releases/v1-devnet-45e9547.json";
import { IX } from "@/lib/program";
import { buildSandboxRefund, buildSandboxSettle, SANDBOX_ESCROW_PROGRAM_ID } from "@/lib/sandbox/escrow";
import {
  cachedSandboxDeploymentCheck,
  checkSandboxDeployment,
  NAMES_UNRATED_EXITS_BY_EXECUTABLE_HASH,
  sandboxBuildOfRecord,
  UPGRADEABLE_LOADER_ID,
  type SandboxReleaseRecord,
} from "@/lib/sandbox/deployment";

const PROGRAM_DATA = Keypair.generate().publicKey;

function chain(deployedSlot: bigint | null, overrides: { programOwner?: PublicKey; programTag?: number; dataTag?: number } = {}) {
  const program = Buffer.alloc(36);
  program.writeUInt32LE(overrides.programTag ?? 2, 0);
  PROGRAM_DATA.toBuffer().copy(program, 4);
  const accounts = new Map<string, { owner: PublicKey; data: Uint8Array }>([[SANDBOX_ESCROW_PROGRAM_ID.toBase58(), { owner: overrides.programOwner ?? UPGRADEABLE_LOADER_ID, data: new Uint8Array(program) }]]);
  if (deployedSlot !== null) {
    const data = Buffer.alloc(45 + 16);
    data.writeUInt32LE(overrides.dataTag ?? 3, 0);
    data.writeBigUInt64LE(deployedSlot, 4);
    accounts.set(PROGRAM_DATA.toBase58(), { owner: UPGRADEABLE_LOADER_ID, data: new Uint8Array(data) });
  }
  let reads = 0;
  return {
    reads: () => reads,
    readAccount: async (address: PublicKey) => {
      reads += 1;
      return accounts.get(address.toBase58()) ?? null;
    },
  };
}

const preFreezeSlot = BigInt(devnetPreFreeze.deployedSlot as number);
const freezeSlot = BigInt(devnetFreeze.deployedSlot as number);
const beforeUpgrade: SandboxReleaseRecord[] = [devnetPreFreeze, { ...devnetFreeze, deployedSlot: null }];

describe("sandbox program build of record (audit S7-Codex-R2-06)", () => {
  it("knows the encoding of every devnet release record, by executable hash", () => {
    expect(NAMES_UNRATED_EXITS_BY_EXECUTABLE_HASH[devnetPreFreeze.executableHash]).toBe(false);
    expect(NAMES_UNRATED_EXITS_BY_EXECUTABLE_HASH[devnetFreeze.executableHash]).toBe(true);
    expect(devnetFreeze.commit.startsWith("45e9547")).toBe(true);
  });

  it("takes the latest deployed devnet record of the sandbox program", () => {
    // Before the upgrade was recorded, the pre-freeze build was chosen.
    expect(sandboxBuildOfRecord(beforeUpgrade)).toMatchObject({ commit: devnetPreFreeze.commit, deployedSlot: preFreezeSlot, namesUnratedExits: false });
    // Today: devnet runs the freeze build (upgraded in slot 525663342), so its encoding is chosen.
    expect(freezeSlot).toBe(BigInt(525_663_342));
    expect(sandboxBuildOfRecord()).toMatchObject({ commit: devnetFreeze.commit, deployedSlot: freezeSlot, namesUnratedExits: true });
  });

  it("chooses no build when the latest record is unknown, ambiguous, or for another program", () => {
    expect(sandboxBuildOfRecord([{ ...devnetFreeze, executableHash: "00", deployedSlot: 530_000_000 }, devnetPreFreeze])).toBeUndefined();
    expect(sandboxBuildOfRecord([devnetPreFreeze, { ...devnetFreeze, deployedSlot: devnetPreFreeze.deployedSlot }])).toBeUndefined();
    expect(sandboxBuildOfRecord([devnetPreFreeze], Keypair.generate().publicKey)).toBeUndefined();
    expect(sandboxBuildOfRecord([{ ...devnetPreFreeze, network: "mainnet" }])).toBeUndefined();
    expect(sandboxBuildOfRecord([])).toBeUndefined();
  });

  it("passes only when the program on devnet was last deployed in the record's slot", async () => {
    expect(await checkSandboxDeployment(chain(freezeSlot).readAccount)).toMatchObject({ ok: true, build: { namesUnratedExits: true } });
    // The old build's slot, or devnet upgraded to another build not yet recorded: refused, whatever it is.
    expect(await checkSandboxDeployment(chain(preFreezeSlot).readAccount)).toMatchObject({ ok: false });
    expect(await checkSandboxDeployment(chain(freezeSlot + BigInt(1)).readAccount)).toMatchObject({ ok: false });
    expect(await checkSandboxDeployment(chain(null).readAccount)).toMatchObject({ ok: false });
    expect(await checkSandboxDeployment(chain(freezeSlot, { programOwner: Keypair.generate().publicKey }).readAccount)).toMatchObject({ ok: false });
    expect(await checkSandboxDeployment(chain(freezeSlot, { programTag: 3 }).readAccount)).toMatchObject({ ok: false });
    expect(await checkSandboxDeployment(chain(freezeSlot, { dataTag: 2 }).readAccount)).toMatchObject({ ok: false });
    expect(await checkSandboxDeployment(async () => { throw new Error("rpc down"); })).toMatchObject({ ok: false });
    // Before the upgrade was recorded, the pre-freeze build passed and the freeze slot did not.
    expect(await checkSandboxDeployment(chain(preFreezeSlot).readAccount, { records: beforeUpgrade })).toMatchObject({ ok: true, build: { namesUnratedExits: false } });
    expect(await checkSandboxDeployment(chain(freezeSlot).readAccount, { records: beforeUpgrade })).toMatchObject({ ok: false });
  });

  it("remembers a pass for a minute, and never a failure", async () => {
    let now = 0;
    const passing = chain(freezeSlot);
    const check = cachedSandboxDeploymentCheck(passing.readAccount, { now: () => now });
    await check();
    await check();
    expect(passing.reads()).toBe(2);
    now = 60_001;
    await check();
    expect(passing.reads()).toBe(4);
    const failing = chain(null);
    const refused = cachedSandboxDeploymentCheck(failing.readAccount, { now: () => now });
    await refused();
    await refused();
    expect(failing.reads()).toBe(4);
  });

  it("encodes each build's exits as that build takes them", () => {
    const escrow = Keypair.generate().publicKey;
    const payer = Keypair.generate().publicKey;
    const payee = Keypair.generate().publicKey;
    const createdSlot = BigInt(4242);
    const settle = (namesUnratedExits: boolean) => buildSandboxSettle({ escrow, payer, payee, actualLamports: BigInt(207), createdSlot, namesUnratedExits });
    // Pre-freeze build: no slot on an unrated exit. Freeze build: the slot after `actual`, as the program README and vectors give it.
    expect(settle(false).data).toHaveLength(16);
    const named = settle(true);
    expect(named.data.subarray(0, 8)).toEqual(IX.settle_escrow);
    expect(named.data.readBigUInt64LE(16)).toBe(createdSlot);
    const ratedVector = vectors.instructions.find((entry) => entry.name === "settle_escrow")!;
    // The unrated settle of the freeze build is the rated vector's data with the same slot (the rating only adds an account).
    expect(ratedVector.data_hex.length).toBe(named.data.toString("hex").length);
    const refund = (namesUnratedExits: boolean) => buildSandboxRefund({ escrow, payer, createdSlot, namesUnratedExits });
    expect(refund(false).data).toHaveLength(8);
    expect(refund(true).data).toHaveLength(16);
    expect(refund(true).data.readBigUInt64LE(8)).toBe(createdSlot);
  });
});
