import type { NextConfig } from "next";
import localSurfpoolProfile from "./config/networks/local-surfpool.json";
import { isLoopbackRpcUrl } from "./lib/config/loopback-endpoint";
import { resolveNetworkProfileNameFromEnv } from "./lib/config/network-profile-name";

const PLAYWRIGHT_SIGNER_BUILD_REFUSAL =
  "NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY is refused unless the build/dev profile is local-surfpool with loopback-only RPC/WS";

function localSurfpoolRpcDefaults(): { rpcHttp: string; rpcWs?: string } {
  const solana = localSurfpoolProfile.solana;
  return { rpcHttp: solana.rpcHttp, rpcWs: solana.rpcWs };
}

function assertSafePlaywrightSignerBuildEnv(): void {
  if (!process.env.NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY) return;
  const profile = resolveNetworkProfileNameFromEnv(process.env);
  const localDefaults = profile === "local-surfpool" ? localSurfpoolRpcDefaults() : undefined;
  const rpcHttp = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? process.env.NEXT_PUBLIC_RPC_URL ?? process.env.DEMO_DEVNET_RPC ?? localDefaults?.rpcHttp ?? "";
  const rpcWs = process.env.NEXT_PUBLIC_RPC_WS_ENDPOINT ?? localDefaults?.rpcWs;
  if (profile !== "local-surfpool" || !isLoopbackRpcUrl(rpcHttp, "http:") || (rpcWs && !isLoopbackRpcUrl(rpcWs, "ws:"))) {
    throw new Error(PLAYWRIGHT_SIGNER_BUILD_REFUSAL);
  }
}

assertSafePlaywrightSignerBuildEnv();

const buildNetworkProfile = (
  process.env.NETWORK_PROFILE ??
  process.env.NEXT_PUBLIC_NETWORK_PROFILE ??
  ""
).trim();
const buildAllowUnsafeEscrowOverride = (process.env.ALLOW_UNSAFE_ESCROW_OVERRIDE ?? "").trim();

const buildEnv: Record<string, string> = {};
if (buildNetworkProfile) buildEnv.NEXT_PUBLIC_BUILD_NETWORK_PROFILE = buildNetworkProfile;
if (buildAllowUnsafeEscrowOverride) {
  buildEnv.NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE = buildAllowUnsafeEscrowOverride;
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  ...(Object.keys(buildEnv).length ? { env: buildEnv } : {}),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]
  },
};

export default nextConfig;
