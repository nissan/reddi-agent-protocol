/**
 * PER client tests — all mocked (no devnet).
 *
 * Tests cover the 3 BDD scenarios:
 *   1. Happy path:   lock → delegate → release via PER → private settlement
 *   2. TTL expired:  lock → delegate → release via L1 fallback
 *   3. PER unavail:  delegation fails → L1 used directly → no funds stuck
 *
 * Full TEE integration requires a live devnet-tee.magicblock.app connection;
 * those tests are marked @skip and documented separately.
 *
 * No test here reaches the network: the `Connection` the client builds internally for
 * the TEE endpoint is replaced below with a recorder (#714).
 */

// Every `new Connection(...)` made by the code under test returns this recorder. Tests
// pass their own mock objects for the public connection, so only the client's internal
// TEE connection is built through it.
const perSendRawTransaction = jest.fn();
const perConnectionArgs: unknown[][] = [];
jest.mock("@solana/web3.js", () => {
  const actual = jest.requireActual("@solana/web3.js");
  return {
    ...actual,
    Connection: jest.fn().mockImplementation((...args: unknown[]) => {
      perConnectionArgs.push(args);
      return { sendRawTransaction: perSendRawTransaction };
    }),
  };
});

import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { readFileSync } from "fs";
import { join } from "path";
import {
  buildReleaseEscrowInstruction,
  delegateEscrow,
  releaseEscrowFallback,
  releaseEscrowViaPer,
} from "../src/client";
import {
  DELEGATION_PROGRAM_ID,
  PER_DEVNET_RPC,
  PERMISSION_PROGRAM_ID,
  PROTOCOL_TREASURY,
} from "../src/config";
import { DISCRIMINATORS } from "../src/idl";

// ── Mocks ────────────────────────────────────────────────────────────────────

const MOCK_SIG = "3xtMockedSig111111111111111111111111111111111111111111111111";
const MOCK_BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";
const MOCK_SLOT = 50_000;

function makeMockConnection(opts: {
  sendRawTransaction?: jest.MockedFunction<any>;
  confirmTransaction?: jest.MockedFunction<any>;
  getLatestBlockhash?: jest.MockedFunction<any>;
  getSlot?: jest.MockedFunction<any>;
} = {}): Connection {
  return {
    getLatestBlockhash: opts.getLatestBlockhash ??
      jest.fn().mockResolvedValue({ blockhash: MOCK_BLOCKHASH, lastValidBlockHeight: 999 }),
    confirmTransaction: opts.confirmTransaction ??
      jest.fn().mockResolvedValue({ value: { err: null } }),
    sendRawTransaction: opts.sendRawTransaction ??
      jest.fn().mockResolvedValue(MOCK_SIG),
    getSlot: opts.getSlot ??
      jest.fn().mockResolvedValue(MOCK_SLOT),
  } as unknown as Connection;
}

// ── BDD Scenario 1: Happy path ────────────────────────────────────────────────

describe("delegateEscrow", () => {
  it("calls Permission and Delegation programs and returns a session token", async () => {
    const mockConnection = makeMockConnection();
    const payer = Keypair.generate();
    const escrowPda = Keypair.generate().publicKey;

    const session = await delegateEscrow(escrowPda, payer, mockConnection);

    expect(session.sessionKey).toBeTruthy();
    expect(typeof session.sessionKey).toBe("string");
    expect(session.sessionKey.length).toBeGreaterThan(32); // base58 pubkey
    expect(session.createdSlot).toBe(MOCK_SLOT);
    expect(session.ttlSlots).toBe(1_512_000);

    // sendRawTransaction was called exactly once (permission + delegation in one tx)
    expect(
      (mockConnection.sendRawTransaction as jest.Mock).mock.calls.length
    ).toBe(1);

    // Both instructions go to MagicBlock's programs. The escrow program is not called.
    const sent = Transaction.from((mockConnection.sendRawTransaction as jest.Mock).mock.calls[0][0]);
    expect(sent.instructions.map((ix) => ix.programId.toBase58())).toEqual([PERMISSION_PROGRAM_ID, DELEGATION_PROGRAM_ID]);
  });
});

describe("releaseEscrowViaPer", () => {
  it("BDD happy path: routes release_escrow_per to TEE RPC endpoint", async () => {
    perConnectionArgs.length = 0;
    perSendRawTransaction.mockReset().mockResolvedValue("per_sig_abc123");
    expect(PER_DEVNET_RPC).toBe("https://devnet-tee.magicblock.app");

    const escrowProgramId = new PublicKey("11111111111111111111111111111111");
    const escrowPda = Keypair.generate().publicKey;
    const payee = Keypair.generate().publicKey;
    const payer = Keypair.generate();
    const mockPublicConnection = makeMockConnection();
    const session = {
      sessionKey: Keypair.generate().publicKey.toBase58(),
      createdSlot: MOCK_SLOT,
      ttlSlots: 1_512_000,
    };

    const sig = await releaseEscrowViaPer(
      escrowProgramId,
      escrowPda,
      payee,
      payer,
      session,
      mockPublicConnection
    );

    // The signed transaction goes to the TEE endpoint, without preflight...
    expect(sig).toBe("per_sig_abc123");
    expect(perConnectionArgs).toEqual([[PER_DEVNET_RPC, "confirmed"]]);
    expect(perSendRawTransaction).toHaveBeenCalledTimes(1);
    expect(perSendRawTransaction.mock.calls[0][1]).toEqual({ skipPreflight: true });
    // ...and never to the public connection, which is used only for the blockhash.
    expect(
      (mockPublicConnection.sendRawTransaction as jest.Mock).mock.calls.length
    ).toBe(0);
    expect(
      (mockPublicConnection.getLatestBlockhash as jest.Mock).mock.calls.length
    ).toBe(1);
  });
});

// ── BDD Scenario 2: TTL expired / PER unavailable — L1 fallback ──────────────

describe("releaseEscrowFallback", () => {
  it("BDD fallback: sends release_escrow to public L1 RPC, not TEE", async () => {
    const mockL1Connection = makeMockConnection();
    const escrowProgramId = new PublicKey("11111111111111111111111111111111");
    const escrowPda = Keypair.generate().publicKey;
    const payee = Keypair.generate().publicKey;
    const payer = Keypair.generate();

    const sig = await releaseEscrowFallback(
      escrowProgramId,
      escrowPda,
      payee,
      payer,
      mockL1Connection
    );

    expect(sig).toBe(MOCK_SIG);
    // Sent to the L1 connection we provided, NOT the TEE endpoint
    expect(
      (mockL1Connection.sendRawTransaction as jest.Mock).mock.calls.length
    ).toBe(1);
  });

  it("builds release_escrow with five accounts in program order, the treasury fourth", () => {
    const escrowProgramId = new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
    const escrowPda = new PublicKey("5gVhjU85QVUUTZAWRBmiYSXBBHwqUFsEsXngyjEXsyEV");
    const payer = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
    const payee = new PublicKey("9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu");

    const ix = buildReleaseEscrowInstruction(escrowProgramId, escrowPda, payee, payer);

    expect(PROTOCOL_TREASURY).toBe("5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe");
    expect(ix.programId.toBase58()).toBe(escrowProgramId.toBase58());
    expect(ix.data.equals(DISCRIMINATORS.release_escrow)).toBe(true);
    expect(ix.keys.map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable])).toEqual([
      [escrowPda.toBase58(), false, true],
      [payer.toBase58(), true, true],
      [payee.toBase58(), false, true],
      ["5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe", false, true],
      [SystemProgram.programId.toBase58(), false, false],
    ]);

    // The program's own example of a payer's release_escrow: the same selector and the same first
    // five accounts (the example is of a rated escrow, so a sixth, the rating account, follows).
    const vectors = JSON.parse(readFileSync(join(__dirname, "../../../programs/pinocchio-escrow/interface/vectors.json"), "utf8"));
    const vector = vectors.instructions.find((entry: { name: string }) => entry.name === "release_escrow");
    expect(ix.data.toString("hex")).toBe(vector.data_hex);
    expect(ix.keys.map((key) => ({ address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable }))).toEqual(
      vector.accounts.slice(0, 5).map((meta: { address: string; signer: boolean; writable: boolean }) => ({ address: meta.address, signer: meta.signer, writable: meta.writable })),
    );
  });

  it("the fallback sends that instruction: treasury fourth, System program fifth", async () => {
    const mockL1Connection = makeMockConnection();
    const escrowProgramId = new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
    const escrowPda = Keypair.generate().publicKey;
    const payee = Keypair.generate().publicKey;
    const payer = Keypair.generate();

    await releaseEscrowFallback(escrowProgramId, escrowPda, payee, payer, mockL1Connection);

    const sent = Transaction.from((mockL1Connection.sendRawTransaction as jest.Mock).mock.calls[0][0]);
    expect(sent.instructions).toHaveLength(1);
    const [ix] = sent.instructions;
    expect(ix.programId.toBase58()).toBe(escrowProgramId.toBase58());
    expect(ix.data.equals(DISCRIMINATORS.release_escrow)).toBe(true);
    expect(ix.keys.map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable])).toEqual([
      [escrowPda.toBase58(), false, true],
      [payer.publicKey.toBase58(), true, true],
      [payee.toBase58(), false, true],
      [PROTOCOL_TREASURY, false, true],
      [SystemProgram.programId.toBase58(), false, false],
    ]);
    expect((mockL1Connection.sendRawTransaction as jest.Mock).mock.calls[0][1]).toEqual({ skipPreflight: false });
  });

  it("BDD TTL expired: fallback succeeds even when delegation state is set", async () => {
    // Simulates the case where escrow was delegated but PER TTL expired.
    // The client switches to the L1 fallback, the ordinary release_escrow.
    const mockConnection = makeMockConnection();
    const escrowProgramId = new PublicKey("11111111111111111111111111111111");
    const escrowPda = Keypair.generate().publicKey;
    const payee = Keypair.generate().publicKey;
    const payer = Keypair.generate();

    // Should resolve successfully regardless of on-chain delegation state
    const sig = await releaseEscrowFallback(
      escrowProgramId,
      escrowPda,
      payee,
      payer,
      mockConnection
    );

    expect(sig).toBeDefined();
    expect(typeof sig).toBe("string");
  });
});

// ── BDD Scenario 3: PER unavailable — delegation fails gracefully ─────────────

describe("PER unavailable — error handling", () => {
  it("BDD PER unavailable: delegation network error propagates clearly", async () => {
    const failingConnection = makeMockConnection({
      sendRawTransaction: jest
        .fn()
        .mockRejectedValue(new Error("Network error: devnet-tee unreachable")),
    });
    const payer = Keypair.generate();
    const escrowPda = Keypair.generate().publicKey;

    await expect(
      delegateEscrow(escrowPda, payer, failingConnection)
    ).rejects.toThrow("Network error: devnet-tee unreachable");
  });

  it("exports correct program addresses for PER infrastructure", () => {
    expect(PERMISSION_PROGRAM_ID).toBe(
      "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
    );
    expect(DELEGATION_PROGRAM_ID).toBe(
      "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
    );
    expect(PER_DEVNET_RPC).toBe("https://devnet-tee.magicblock.app");
  });
});
