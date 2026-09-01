import type { NextConfig } from "next";

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
