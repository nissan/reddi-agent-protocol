import { describeQuasarTargetRefusal, shellQuote } from "../quasar-target-gate";

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
    const { DEMO_ATTESTATION_PROGRAM_ID: _omitted, ...partial } = completeLocalEnv;
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
