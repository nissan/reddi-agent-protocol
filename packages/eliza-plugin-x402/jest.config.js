/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  moduleNameMapper: {
    "^@reddi/x402-solana$": "<rootDir>/../x402-solana/src/index.ts",
    "^@elizaos/core$": "<rootDir>/tests/__mocks__/@elizaos/core.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          esModuleInterop: true,
          skipLibCheck: true,
        },
      },
    ],
  },
};
