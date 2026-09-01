import type { NextConfig } from "next";

const buildNetworkProfile = (
  process.env.NEXT_PUBLIC_NETWORK_PROFILE ??
  process.env.NETWORK_PROFILE ??
  ""
).trim();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  ...(buildNetworkProfile
    ? { env: { NEXT_PUBLIC_NETWORK_PROFILE: buildNetworkProfile } }
    : {}),
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
