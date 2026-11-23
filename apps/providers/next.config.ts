import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// The provider kit comes from packages/provider-kit, outside this app, so the
// build and its file tracing start at the repository root.
const root = fileURLToPath(new URL("../..", import.meta.url));

const config: NextConfig = {
  poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
  // Loaded by Node as they are: the kit and its Solana libraries are not bundled.
  serverExternalPackages: ["@redditech/provider-kit", "pg"],
};

export default config;
