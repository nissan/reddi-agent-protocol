import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// The judge's code is the main app's lib/budget, outside this folder, and its
// dependencies are installed at the repository root (vercel.json), so the build
// and its file tracing start at the root.
const root = fileURLToPath(new URL("../..", import.meta.url));

const config: NextConfig = {
  poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default config;
