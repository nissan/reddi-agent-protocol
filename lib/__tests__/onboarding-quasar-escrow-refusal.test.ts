/**
 * The onboarding Quasar reputation/attestation surface must refuse before it builds an instruction,
 * touches a signer, or opens an RPC connection, because no lock-created escrow exists to bind to.
 *
 * `Connection` is replaced with a class that throws on construction, so "no RPC" is proven by the
 * call succeeding at all rather than by inspecting the source.
 */
jest.mock("server-only", () => ({}));

const rpcConstructions: string[] = [];

jest.mock("@solana/web3.js", () => {
  const actual = jest.requireActual("@solana/web3.js");
  return {
    ...actual,
    Connection: class {
      constructor(endpoint: string) {
        rpcConstructions.push(endpoint);
        throw new Error(`RPC connection opened to ${endpoint}`);
      }
    },
  };
});

const COMMIT_STORE_SUFFIX = "rating-commits.json";
let storedCommits: unknown[] = [];

jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return {
    ...actual,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: (target: string, ...rest: unknown[]) =>
      typeof target === "string" && target.endsWith(COMMIT_STORE_SUFFIX)
        ? JSON.stringify(storedCommits)
        : (actual.readFileSync as (...args: unknown[]) => unknown)(target, ...rest),
  };
});

const SPECIALIST = "11111111111111111111111111111113";

describe("onboarding Quasar reputation/attestation refuses without a lock-created escrow", () => {
  const originalEnv = process.env;

  async function operatorSecretKey(): Promise<string> {
    const { Keypair } = jest.requireActual("@solana/web3.js");
    return JSON.stringify([...Keypair.generate().secretKey]);
  }

  beforeEach(() => {
    jest.resetModules();
    rpcConstructions.length = 0;
    storedCommits = [];
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_RPC_ENDPOINT;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    delete process.env.DEMO_DEVNET_RPC;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  async function useQuasarTarget(operatorSecret?: string) {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = operatorSecret ?? await operatorSecretKey();
    const { PROGRAM_TARGET } = await import("@/lib/program");
    expect(PROGRAM_TARGET).toBe("quasar");
  }

  it("commitReputationRating returns the canonical reason and never opens an RPC connection", async () => {
    await useQuasarTarget();
    const { commitReputationRating } = await import("@/lib/onboarding/reputation-signal");
    const { QUASAR_ESCROW_UNAVAILABLE_REASON } = await import("@/lib/onboarding/quasar-escrow-binding");

    const result = await commitReputationRating("run-1", 8, SPECIALIST);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(QUASAR_ESCROW_UNAVAILABLE_REASON);
    expect(rpcConstructions).toEqual([]);
  });

  it("revealReputationRating refuses a stored commit with the canonical reason, before any RPC", async () => {
    await useQuasarTarget();
    storedCommits = [
      {
        runId: "run-1",
        jobIdHex: "00".repeat(16),
        score: 8,
        saltHex: "11".repeat(32),
        commitHashHex: "22".repeat(32),
        specialistWallet: SPECIALIST,
        ratingPda: "11111111111111111111111111111114",
        commitTx: "sig",
        createdAt: new Date().toISOString(),
        revealed: false,
      },
    ];

    const { revealReputationRating } = await import("@/lib/onboarding/reputation-signal");
    const { QUASAR_ESCROW_UNAVAILABLE_REASON } = await import("@/lib/onboarding/quasar-escrow-binding");

    const result = await revealReputationRating("run-1");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(QUASAR_ESCROW_UNAVAILABLE_REASON);
    // The pre-fix ordering surfaced an internal ReferenceError here instead of the canonical reason.
    expect(result.ok === false && result.error).not.toMatch(/before initialization/);
    expect(rpcConstructions).toEqual([]);
  });

  it("submitOnchainOnboardingAttestation refuses before constructing a signer transaction or RPC", async () => {
    await useQuasarTarget();
    const { submitOnchainOnboardingAttestation } = await import("@/lib/onboarding/onchain-attestation");
    const { QUASAR_ESCROW_UNAVAILABLE_REASON } = await import("@/lib/onboarding/quasar-escrow-binding");

    await expect(
      submitOnchainOnboardingAttestation({
        walletAddress: SPECIALIST,
        operatorSecretKey: await operatorSecretKey(),
      }),
    ).rejects.toThrow(QUASAR_ESCROW_UNAVAILABLE_REASON);

    expect(rpcConstructions).toEqual([]);
  });

  it("Quasar missing-lock refusal happens before operator signer parsing", async () => {
    await useQuasarTarget("not a JSON keypair");
    const { commitReputationRating, revealReputationRating } = await import("@/lib/onboarding/reputation-signal");
    const { submitOnchainOnboardingAttestation } = await import("@/lib/onboarding/onchain-attestation");
    const { QUASAR_ESCROW_UNAVAILABLE_REASON } = await import("@/lib/onboarding/quasar-escrow-binding");

    const commit = await commitReputationRating("run-1", 8, SPECIALIST);
    expect(commit.ok).toBe(false);
    expect(commit.ok === false && commit.error).toBe(QUASAR_ESCROW_UNAVAILABLE_REASON);

    const reveal = await revealReputationRating("run-1");
    expect(reveal.ok).toBe(false);
    expect(reveal.ok === false && reveal.error).toBe(QUASAR_ESCROW_UNAVAILABLE_REASON);

    await expect(
      submitOnchainOnboardingAttestation({
        walletAddress: SPECIALIST,
        operatorSecretKey: "not a JSON keypair",
      }),
    ).rejects.toThrow(QUASAR_ESCROW_UNAVAILABLE_REASON);

    for (const error of [commit.ok === false && commit.error, reveal.ok === false && reveal.error]) {
      expect(error).not.toMatch(/SECRET_KEY|JSON byte array|Invalid/);
    }
    expect(rpcConstructions).toEqual([]);
  });

  it("consumer confirm/dispute refuses before a connection is opened or an operator key is parsed", async () => {
    await useQuasarTarget();
    const { submitAttestationResolution } = await import("@/lib/onboarding/attestation-resolution");
    const { QUASAR_ESCROW_UNAVAILABLE_REASON } = await import("@/lib/onboarding/quasar-escrow-binding");
    const { PublicKey } = jest.requireActual("@solana/web3.js") as typeof import("@solana/web3.js");

    const getConnection = jest.fn(() => {
      throw new Error("connection opened");
    });
    const sendTransaction = jest.fn(async () => "never");

    for (const action of ["confirm", "dispute"] as const) {
      const outcome = await submitAttestationResolution(
        {
          action,
          consumer: new PublicKey(SPECIALIST),
          // Deliberately unparseable: reaching PublicKey parsing would surface as a different error.
          operator: "not a base58 operator",
          jobIdHex: "not a job id",
          escrow: "",
        },
        { getConnection, sendTransaction },
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.error).toBe(QUASAR_ESCROW_UNAVAILABLE_REASON);
    }

    expect(getConnection).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(rpcConstructions).toEqual([]);
  });

  it("the same confirm/dispute path reaches its connection step on legacy-anchor, so the refusal is what stops it", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "legacy-anchor";

    const { describeAttestationResolutionRefusal, submitAttestationResolution } = await import(
      "@/lib/onboarding/attestation-resolution"
    );
    const { PublicKey } = jest.requireActual("@solana/web3.js") as typeof import("@solana/web3.js");

    expect(describeAttestationResolutionRefusal()).toBeUndefined();

    const getConnection = jest.fn(() => {
      throw new Error("connection opened");
    });
    const sendTransaction = jest.fn(async () => "never");

    const outcome = await submitAttestationResolution(
      {
        action: "confirm",
        consumer: new PublicKey(SPECIALIST),
        operator: SPECIALIST,
        jobIdHex: "00112233445566778899aabbccddeeff",
        escrow: "",
      },
      { getConnection, sendTransaction },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBe("connection opened");
    expect(getConnection).toHaveBeenCalledTimes(1);
  });

  it("the refusal is scoped to the Quasar target: legacy-anchor still reaches its RPC step", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "legacy-anchor";
    process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = await operatorSecretKey();

    const { PROGRAM_TARGET } = await import("@/lib/program");
    expect(PROGRAM_TARGET).toBe("legacy-anchor");

    const { commitReputationRating } = await import("@/lib/onboarding/reputation-signal");
    const { QUASAR_ESCROW_UNAVAILABLE_REASON } = await import("@/lib/onboarding/quasar-escrow-binding");

    const result = await commitReputationRating("run-1", 8, SPECIALIST);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).not.toBe(QUASAR_ESCROW_UNAVAILABLE_REASON);
    expect(rpcConstructions.length).toBeGreaterThan(0);
  });
});
