/**
 * #1151: the app switches to mainnet cleanly. Budgets run on mainnet; single paid calls stay on
 * devnet; launch copy switches on one setting; the mainnet profile unblocks only when the committed
 * mainnet.json records the deployment.
 */
import {
  appNetwork,
  isDevnetOnlyRoute,
  mainnetLaunchLive,
  perCallPaymentsRefusedOnThisBuild,
  stageCopy,
} from "@/lib/config/launch-stage";

describe("launch stage (#1151)", () => {
  it("defaults to devnet with the devnet copy", () => {
    expect(appNetwork({})).toBe("devnet");
    expect(mainnetLaunchLive({})).toBe(false);
    expect(perCallPaymentsRefusedOnThisBuild({})).toBe(false);
    expect(stageCopy({}).stage).toBe("Running on Solana devnet. Mainnet is coming soon.");
    expect(stageCopy({}).feeLabel).toBe("fee (planned)");
  });

  it("ignores the launch switch on a devnet build", () => {
    const env = { NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "devnet", NEXT_PUBLIC_RAP_MAINNET_LIVE: "true" };
    expect(mainnetLaunchLive(env)).toBe(false);
    expect(stageCopy(env).stage).toMatch(/devnet\. Mainnet is coming soon/);
  });

  it("keeps the devnet copy on a mainnet build until the switch is set to exactly true", () => {
    for (const value of [undefined, "", "1", "yes", "TRUE"]) {
      const env = { NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "mainnet", NEXT_PUBLIC_RAP_MAINNET_LIVE: value };
      expect(mainnetLaunchLive(env)).toBe(false);
      expect(stageCopy(env).feeLabel).toBe("fee (planned)");
    }
  });

  it("switches stage and fee copy together on a live mainnet build", () => {
    const env = { NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "mainnet", NEXT_PUBLIC_RAP_MAINNET_LIVE: "true" };
    expect(mainnetLaunchLive(env)).toBe(true);
    const copy = stageCopy(env);
    expect(copy.stage).toBe("Budgets run on Solana mainnet. Single paid calls run on devnet with test funds for now.");
    expect(copy.feeLabel).toBe("fee");
    expect(copy.perCallNetwork).toMatch(/devnet with test funds/);
    expect(`${copy.stage} ${copy.perCallNetwork}`).not.toMatch(/coming soon/i);
  });

  it("refuses single paid calls on every mainnet build, live or not", () => {
    expect(perCallPaymentsRefusedOnThisBuild({ NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "mainnet" })).toBe(true);
    expect(perCallPaymentsRefusedOnThisBuild({ NETWORK_PROFILE: "mainnet-beta", NEXT_PUBLIC_RAP_MAINNET_LIVE: "true" })).toBe(true);
    expect(perCallPaymentsRefusedOnThisBuild({ NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "local-surfpool" })).toBe(false);
  });

  it("knows which routes always pay on devnet", () => {
    for (const path of ["/try", "/pass", "/planner", "/sandbox", "/sandbox/budget", "/try/x"]) expect(isDevnetOnlyRoute(path)).toBe(true);
    for (const path of ["/", "/budget", "/jobs", "/trying", "/passport", null, undefined]) expect(isDevnetOnlyRoute(path)).toBe(false);
  });
});

describe("mainnet profile unblocks only on a recorded deployment (#1151)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.dontMock("@/config/networks/mainnet.json");
    jest.resetModules();
    process.env = { ...originalEnv, DEMO_DISABLE_DOTENV: "true", NETWORK_PROFILE: "mainnet" };
    for (const key of ["NEXT_PUBLIC_DEMO_PROGRAM_TARGET", "NEXT_PUBLIC_ESCROW_PROGRAM_ID", "NEXT_PUBLIC_RPC_ENDPOINT", "NEXT_PUBLIC_RPC_URL"]) delete process.env[key];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("names the V1 release id with PER fallback off, and stays blocked while not_deployed", async () => {
    const mainnet = (await import("@/config/networks/mainnet.json")).default as {
      programs: Record<string, string>;
      features: { allowPerFallback: boolean };
    };
    expect(mainnet.programs.escrowProgramId).toBe("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
    expect(mainnet.programs.mainnetDeploymentStatusNote).toBe("not_deployed");
    expect(mainnet.features.allowPerFallback).toBe(false);

    const { getNetworkProfile, MAINNET_DEPLOYMENT_RECORDED } = await import("@/lib/config/network");
    const profile = getNetworkProfile();
    expect(MAINNET_DEPLOYMENT_RECORDED).toBe(false);
    expect(profile.programs.submissionReady).toBe(false);
    expect(profile.programs.deploymentStatus).toBe("mainnet-not-deployed");
    expect(profile.features.allowPerFallback).toBe(false);
  });

  async function withDeployedRecord() {
    const real = jest.requireActual("@/config/networks/mainnet.json") as { programs: Record<string, string> };
    jest.doMock("@/config/networks/mainnet.json", () => ({
      __esModule: true,
      default: { ...real, programs: { ...real.programs, mainnetDeploymentStatusNote: "deployed" } },
    }));
    return import("@/lib/config/network");
  }

  it("is submission-ready once mainnet.json records the deployment", async () => {
    const { getNetworkProfile, MAINNET_DEPLOYMENT_RECORDED } = await withDeployedRecord();
    const profile = getNetworkProfile();
    expect(MAINNET_DEPLOYMENT_RECORDED).toBe(true);
    expect(profile.programs.submissionReady).toBe(true);
    expect(profile.programs.deploymentStatus).toBe("mainnet-deployed");
    expect(profile.programs.activationGate).toBeUndefined();
    expect(profile.programs.knownGaps).toEqual([]);
    expect(profile.programs.escrowProgramId).toBe("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
    expect(profile.solana.cluster).toBe("mainnet-beta");
  });

  it("still refuses a program override and a foreign RPC on a deployed mainnet", async () => {
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = "11111111111111111111111111111111";
    process.env.NEXT_PUBLIC_RPC_ENDPOINT = "https://api.devnet.solana.com";
    const { getNetworkProfile } = await withDeployedRecord();
    const profile = getNetworkProfile();
    expect(profile.programs.escrowProgramId).toBe("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
    expect(profile.programs.submissionReady).toBe(false);
    expect(profile.solana.rpcHttp).toBe("https://api.mainnet-beta.solana.com");
  });

  it("does not take the deployment from the environment", async () => {
    process.env.MAINNET_DEPLOYMENT_STATUS_NOTE = "deployed";
    process.env.mainnetDeploymentStatusNote = "deployed";
    const { getNetworkProfile } = await import("@/lib/config/network");
    expect(getNetworkProfile().programs.submissionReady).toBe(false);
  });

  it("refuses a Quasar target on a deployed mainnet without claiming the deployment is missing", async () => {
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    const { getNetworkProfile } = await withDeployedRecord();
    const profile = getNetworkProfile();
    expect(profile.programs.target).toBe("legacy-anchor");
    expect(profile.programs.submissionReady).toBe(false);
    const gaps = profile.programs.knownGaps.join(" ");
    expect(gaps).toMatch(/Quasar program target was requested for mainnet/);
    expect(gaps).not.toMatch(/No audited mainnet program deployment/);
  });
});
