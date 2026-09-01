import { describeMalformedProgramIdRefusal, describeQuasarTargetRefusal, shellQuote } from "../quasar-target-gate";

const LOCAL_RPC = "http://127.0.0.1:41337";
const IDS = {
  DEMO_ESCROW_PROGRAM_ID: "VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW",
  DEMO_REGISTRY_PROGRAM_ID: "Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU",
  DEMO_REPUTATION_PROGRAM_ID: "nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6",
  DEMO_ATTESTATION_PROGRAM_ID: "CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex",
};

function lookupFrom(env: Record<string, string>) {
  return (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = env[key]?.trim();
      if (value) return value;
    }
    return undefined;
  };
}

const completeLocalEnv = { ...IDS, DEMO_DEVNET_RPC: LOCAL_RPC };

function withoutKey(env: Record<string, string>, key: string): Record<string, string> {
  const partial = { ...env };
  delete partial[key];
  return partial;
}

describe("Quasar target gate", () => {
  it("accepts a complete four-ID loopback local-surfpool configuration", () => {
    expect(describeQuasarTargetRefusal("local-surfpool", lookupFrom(completeLocalEnv))).toBeUndefined();
  });

  it("refuses the devnet profile and points at the recorded deployment mismatch", () => {
    const refusal = describeQuasarTargetRefusal("devnet", lookupFrom(completeLocalEnv));
    expect(refusal).toContain("devnet");
    expect(refusal).toContain("submissionReady=false");
    expect(refusal).toContain("local-surfpool");
  });

  it("refuses the mainnet profile", () => {
    expect(describeQuasarTargetRefusal("mainnet", lookupFrom(completeLocalEnv))).toContain("refused");
  });

  it("names the forgotten program ID instead of downgrading to legacy-anchor", () => {
    const partial = withoutKey(completeLocalEnv, "DEMO_ATTESTATION_PROGRAM_ID");
    const refusal = describeQuasarTargetRefusal("local-surfpool", lookupFrom(partial));
    expect(refusal).toContain("missing DEMO_ATTESTATION_PROGRAM_ID");
    expect(refusal).toContain("NEXT_PUBLIC_ATTESTATION_PROGRAM_ID");
  });

  it("refuses a malformed program ID", () => {
    const refusal = describeQuasarTargetRefusal(
      "local-surfpool",
      lookupFrom({ ...completeLocalEnv, DEMO_REGISTRY_PROGRAM_ID: "not-a-base58-program-id!" }),
    );
    expect(refusal).toContain("malformed DEMO_REGISTRY_PROGRAM_ID");
  });

  it("refuses a base58-looking program ID that does not decode to a 32-byte public key", () => {
    const refusal = describeQuasarTargetRefusal(
      "local-surfpool",
      lookupFrom({ ...completeLocalEnv, DEMO_REGISTRY_PROGRAM_ID: "22222222222222222222222222222222" }),
    );
    expect(refusal).toContain("malformed DEMO_REGISTRY_PROGRAM_ID");
    expect(refusal).toContain("32-byte");
  });

  it("refuses four program IDs that are not four distinct programs", () => {
    const refusal = describeQuasarTargetRefusal(
      "local-surfpool",
      lookupFrom({ ...completeLocalEnv, DEMO_REPUTATION_PROGRAM_ID: IDS.DEMO_ESCROW_PROGRAM_ID }),
    );
    expect(refusal).toContain("inconsistent DEMO_REPUTATION_PROGRAM_ID");
    expect(refusal).toContain("four distinct programs");
  });

  it("refuses a non-loopback RPC even when every program ID is present", () => {
    const refusal = describeQuasarTargetRefusal(
      "local-surfpool",
      lookupFrom({ ...completeLocalEnv, DEMO_DEVNET_RPC: "https://api.devnet.solana.com" }),
    );
    expect(refusal).toContain("non-loopback DEMO_DEVNET_RPC");
  });

  it("refuses a loopback RPC paired with a non-loopback websocket endpoint", () => {
    const refusal = describeQuasarTargetRefusal(
      "local-surfpool",
      lookupFrom({ ...completeLocalEnv, DEMO_DEVNET_RPC_WS: "wss://api.devnet.solana.com" }),
    );
    expect(refusal).toContain("non-loopback DEMO_DEVNET_RPC_WS");
  });

  it("reports every unmet requirement at once", () => {
    const refusal = describeQuasarTargetRefusal("local-surfpool", lookupFrom({ DEMO_ESCROW_PROGRAM_ID: IDS.DEMO_ESCROW_PROGRAM_ID }));
    expect(refusal).toContain("missing DEMO_REGISTRY_PROGRAM_ID");
    expect(refusal).toContain("missing DEMO_REPUTATION_PROGRAM_ID");
    expect(refusal).toContain("missing DEMO_ATTESTATION_PROGRAM_ID");
    expect(refusal).toContain("missing DEMO_DEVNET_RPC");
  });
});

describe("supplied program id validity is enforced on every profile and target", () => {
  it("accepts every valid supplied id", () => {
    expect(describeMalformedProgramIdRefusal(lookupFrom(completeLocalEnv))).toBeUndefined();
  });

  it("accepts an environment that supplies no ids at all", () => {
    expect(describeMalformedProgramIdRefusal(lookupFrom({}))).toBeUndefined();
  });

  it("names the variable that carries a malformed id", () => {
    const refusal = describeMalformedProgramIdRefusal(
      lookupFrom({ DEMO_ESCROW_PROGRAM_ID: "not-a-key" }),
    );
    expect(refusal).toContain("DEMO_ESCROW_PROGRAM_ID");
    expect(refusal).toContain("NEXT_PUBLIC_ESCROW_PROGRAM_ID");
    expect(refusal).toContain("not-a-key");
  });

  it("names a base58-looking id that does not decode to 32 bytes", () => {
    const refusal = describeMalformedProgramIdRefusal(
      lookupFrom({ NEXT_PUBLIC_REPUTATION_PROGRAM_ID: "22222222222222222222222222222222" }),
    );
    expect(refusal).toContain("DEMO_REPUTATION_PROGRAM_ID");
  });

  it("reports every malformed id at once", () => {
    const refusal = describeMalformedProgramIdRefusal(
      lookupFrom({ DEMO_REGISTRY_PROGRAM_ID: "bad-1", DEMO_ATTESTATION_PROGRAM_ID: "bad-2" }),
    );
    expect(refusal).toContain("DEMO_REGISTRY_PROGRAM_ID");
    expect(refusal).toContain("DEMO_ATTESTATION_PROGRAM_ID");
  });
});

describe("funding recovery hint", () => {
  it("quotes an RPC URL so it survives copy/paste into a shell", () => {
    expect(shellQuote(LOCAL_RPC)).toBe(`'${LOCAL_RPC}'`);
  });

  it("neutralises embedded quotes and shell metacharacters", () => {
    const hostile = "http://127.0.0.1:1'; rm -rf /tmp/x; echo '";
    const quoted = shellQuote(hostile);
    expect(quoted.startsWith("'")).toBe(true);
    expect(quoted.endsWith("'")).toBe(true);
    // Every embedded single quote is closed, escaped, and reopened, so no bare quote survives.
    expect(quoted.slice(1, -1).split("'\\''").join("")).not.toContain("'");
  });
});

describe("program ID resolution has no Quasar devnet defaults", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    for (const key of [
      "NETWORK_PROFILE", "NEXT_PUBLIC_NETWORK_PROFILE",
      "NEXT_PUBLIC_DEMO_PROGRAM_TARGET", "HACKATHON_DEMO_TARGET", "DEMO_PROGRAM_TARGET",
      "DEMO_ESCROW_PROGRAM_ID", "NEXT_PUBLIC_ESCROW_PROGRAM_ID",
      "DEMO_REGISTRY_PROGRAM_ID", "NEXT_PUBLIC_REGISTRY_PROGRAM_ID",
      "DEMO_REPUTATION_PROGRAM_ID", "NEXT_PUBLIC_REPUTATION_PROGRAM_ID",
      "DEMO_ATTESTATION_PROGRAM_ID", "NEXT_PUBLIC_ATTESTATION_PROGRAM_ID",
      "DEMO_DEVNET_RPC", "NEXT_PUBLIC_RPC_ENDPOINT", "DEMO_DEVNET_RPC_WS", "NEXT_PUBLIC_RPC_WS_ENDPOINT",
    ]) delete process.env[key];
    // Without this, dotenv would repopulate exactly the keys this suite just cleared from a
    // gitignored .env.devnet, so the assertions would describe the machine, not the resolver.
    process.env.DEMO_DISABLE_DOTENV = "true";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("never resolves a recorded Quasar devnet program ID as a silent default", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    const config = await import("../config");

    expect(config.PROGRAM_TARGET).toBe("legacy-anchor");
    for (const id of [
      config.ESCROW_PROGRAM_ID,
      config.REGISTRY_PROGRAM_ID,
      config.REPUTATION_PROGRAM_ID,
      config.ATTESTATION_PROGRAM_ID,
    ]) {
      expect(Object.values(IDS)).not.toContain(id);
    }
  });

  it("resolves exactly the four explicitly supplied IDs on a complete local-surfpool config", async () => {
    process.env.NETWORK_PROFILE = "local-surfpool";
    process.env.DEMO_PROGRAM_TARGET = "quasar";
    process.env.DEMO_DEVNET_RPC = LOCAL_RPC;
    Object.assign(process.env, IDS);

    const config = await import("../config");

    expect(config.PROGRAM_TARGET).toBe("quasar");
    expect(config.ESCROW_PROGRAM_ID).toBe(IDS.DEMO_ESCROW_PROGRAM_ID);
    expect(config.REGISTRY_PROGRAM_ID).toBe(IDS.DEMO_REGISTRY_PROGRAM_ID);
    expect(config.REPUTATION_PROGRAM_ID).toBe(IDS.DEMO_REPUTATION_PROGRAM_ID);
    expect(config.ATTESTATION_PROGRAM_ID).toBe(IDS.DEMO_ATTESTATION_PROGRAM_ID);
  });

  it("throws on import when Quasar is requested with an incomplete config, before any RPC client exists", async () => {
    process.env.NETWORK_PROFILE = "local-surfpool";
    process.env.DEMO_PROGRAM_TARGET = "quasar";
    process.env.DEMO_DEVNET_RPC = LOCAL_RPC;
    process.env.DEMO_ESCROW_PROGRAM_ID = IDS.DEMO_ESCROW_PROGRAM_ID;

    await expect(import("../config")).rejects.toThrow(/missing DEMO_REGISTRY_PROGRAM_ID/);
  });

  it("refuses a malformed supplied id on the default legacy-anchor lane, before any PublicKey is built", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.DEMO_ESCROW_PROGRAM_ID = "not-a-key";

    await expect(import("../config")).rejects.toThrow(/DEMO_ESCROW_PROGRAM_ID/);
  });

  it("refuses a malformed supplied id on the local-surfpool legacy-anchor lane", async () => {
    process.env.NETWORK_PROFILE = "local-surfpool";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "not-a-key";

    await expect(import("../config")).rejects.toThrow(/DEMO_REGISTRY_PROGRAM_ID/);
  });

  it("refuses the devnet Quasar route on import", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.DEMO_PROGRAM_TARGET = "quasar";

    await expect(import("../config")).rejects.toThrow(/submissionReady=false/);
  });
});
