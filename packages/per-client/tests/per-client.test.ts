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

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  delegateEscrow,
  releaseEscrowFallback,
  releaseEscrowViaPer,
} from "../src/client";
import {
  DELEGATION_PROGRAM_ID,
  PER_DEVNET_RPC,
  PERMISSION_PROGRAM_ID,
} from "../src/config";

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
    expect(sig).toBe("per_sig_SEEDED_FAILURE");
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

  it("BDD TTL expired: fallback succeeds even when delegation state is set", async () => {
    // Simulates the case where escrow was delegated but PER TTL expired.
    // The client switches to L1 fallback — on-chain release_escrow clears delegated_to_per.
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
