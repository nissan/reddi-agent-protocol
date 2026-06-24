import assert from "node:assert/strict";
import test from "node:test";
import { checkFiles } from "../check-quasar-boundary-guard.mjs";

const fixture = (name) => `scripts/fixtures/quasar-boundary-guard/${name}`;

test("allows read-model files that keep Quasar state off-chain", () => {
  const result = checkFiles([fixture("allowed-read-model.ts")]);

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
});

test("rejects instruction builder imports in package/read-model lanes", () => {
  const result = checkFiles([fixture("forbidden-instruction-builder.ts")]);

  assert.equal(result.ok, false);
  assert.match(result.failures.map((finding) => finding.surface).join(","), /instruction-builder/);
});

test("rejects wallet loading and RPC probes", () => {
  const result = checkFiles([fixture("forbidden-wallet-rpc.ts")]);

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((finding) => finding.surface === "transaction-signing"));
  assert.ok(result.failures.some((finding) => finding.surface === "rpc-client-probe"));
});

test("rejects deploy and migration command references", () => {
  const result = checkFiles([fixture("forbidden-deploy-migration.ts")]);

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((finding) => finding.surface === "program-deploy-migration"));
});

test("records explicit program-boundary handoffs without failing package/read-model guard", () => {
  const result = checkFiles([fixture("program-boundary-handoff.ts")]);

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
  assert.ok(result.handoffs.some((finding) => finding.surface === "instruction-builder"));
});
