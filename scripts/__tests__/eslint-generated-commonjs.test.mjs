import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

// Run from any directory: node --test scripts/__tests__/eslint-generated-commonjs.test.mjs
// No duplicated policy: ESLint discovers the repository's actual configuration.
const cwd = fileURLToPath(new URL("../../", import.meta.url));
const eslint = new ESLint({ cwd });
const requireRule = "@typescript-eslint/no-require-imports";
const anyRule = "@typescript-eslint/no-explicit-any";

async function diagnostics(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  assert.ok(result, `${filePath} must not be silently ignored`);
  assert.equal(result.fatalErrorCount, 0, filePath);
  assert.ok(result.messages.every((message) => message.ruleId !== null),
    `${filePath} must be configured, not ignored or unparseable`);
  return result.messages;
}

test("only retained x402 CommonJS JavaScript admits emitted require calls", async () => {
  const code = 'const dependency = require("./dependency");\nexport { dependency };\n';
  for (const filePath of [
    "packages/x402-solana/dist/client.js",
    "packages/x402-solana/dist/nested/probe.js",
  ]) {
    const messages = await diagnostics(code, filePath);
    assert.equal(messages.filter((message) => message.ruleId === requireRule).length, 0, filePath);
  }

  // Same construct, one boundary changed at a time. These also detect a
  // blanket dist ignore, global relaxation, or extension/package widening.
  for (const filePath of [
    "packages/x402-solana/src/client.ts",
    "packages/x402-solana/src/probe.js",
    "packages/x402-solana/tests/probe.ts",
    "packages/x402-solana/dist/probe.ts",
    "packages/x402-solana/dist/probe.mjs",
    "packages/x402-solana/dist-other/probe.js",
    "packages/agent-protocol/dist/probe.js",
    "scripts/probe.js",
  ]) {
    const messages = await diagnostics(code, filePath);
    assert.equal(messages.filter((message) => message.ruleId === requireRule && message.severity === 2).length, 1, filePath);
  }
});

test("source/API any findings survive in maintained types and generated declarations", async () => {
  for (const filePath of [
    "packages/x402-solana/src/middleware.ts",
    "packages/x402-solana/dist/middleware.d.ts",
    "packages/agent-protocol/dist/probe.d.ts",
  ]) {
    const messages = await diagnostics("export declare const handler: (request: any) => any;\n", filePath);
    assert.equal(messages.filter((message) => message.ruleId === anyRule && message.severity === 2).length, 2, filePath);
  }
});
