import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // x402's tsc build emits CommonJS into tracked dist JavaScript, retained for
  // file: consumers (docs/PACKAGE-ARTIFACT-POLICY.md). Only the emitted module
  // format is exempt: maintained source and declaration/API rules stay active.
  // Regression: node --test scripts/__tests__/eslint-generated-commonjs.test.mjs
  {
    files: ["packages/x402-solana/dist/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // CommonJS files (e.g. `node --require` preload fixtures) must use require().
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
