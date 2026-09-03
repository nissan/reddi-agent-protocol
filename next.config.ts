import type { NextConfig } from "next";
import { isLoopbackRpcUrl } from "./lib/config/loopback-endpoint";

const PLAYWRIGHT_SIGNER_BUILD_REFUSAL =
  "NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY is refused unless the build/dev profile is local-surfpool with loopback-only RPC/WS";

function normalizeBuildProfile(raw: string): "local-surfpool" | "devnet" | "mainnet" {
  const value = raw.trim().toLowerCase();
  if (value === "local-surfpool" || value === "local" || value === "localnet" || value === "surfpool") return "local-surfpool";
  if (value === "mainnet" || value === "mainnet-beta") return "mainnet";
  return "devnet";
}

function assertSafePlaywrightSignerBuildEnv(): void {
  if (!process.env.NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY) return;
  const profile = normalizeBuildProfile(process.env.NETWORK_PROFILE ?? process.env.NEXT_PUBLIC_NETWORK_PROFILE ?? "devnet");
  const rpcHttp = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? process.env.NEXT_PUBLIC_RPC_URL ?? process.env.DEMO_DEVNET_RPC ?? (profile === "local-surfpool" ? "http://127.0.0.1:18999" : "");
  const rpcWs = process.env.NEXT_PUBLIC_RPC_WS_ENDPOINT ?? (profile === "local-surfpool" ? "ws://127.0.0.1:19000" : undefined);
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
