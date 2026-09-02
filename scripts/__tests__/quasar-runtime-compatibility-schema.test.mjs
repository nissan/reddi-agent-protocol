import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { compileJsonSchema } from "../lib/json-schema-subset.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const checkerPath = path.join(repoRoot, "scripts/check-quasar-runtime-compatibility.mjs");
const schemaPath = path.join(repoRoot, "config/quasar/runtime-compatibility.schema.json");
const inventoryPath = path.join(repoRoot, "config/quasar/runtime-compatibility.json");

const liveSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const liveInventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));

/**
 * A minimal repository the real checker can run against, so every case below goes through the
 * committed script rather than re-deriving its rules. Only the files the checker reads are staged;
 * `path` selectors resolve against this root, so a fixture can present a valid selector without
 * depending on the real tree.
 */
const stagedRoots = [];
after(() => {
  for (const root of stagedRoots) fs.rmSync(root, { recursive: true, force: true });
});

function stageFixtureRepo(inventory, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rap-quasar-compat-"));
  stagedRoots.push(root);
  fs.mkdirSync(path.join(root, "config/quasar"), { recursive: true });
  fs.mkdirSync(path.join(root, "lib/config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config/quasar/runtime-compatibility.schema.json"), JSON.stringify(options.schema ?? liveSchema, null, 2));
  fs.writeFileSync(path.join(root, "config/quasar/runtime-compatibility.json"), JSON.stringify(inventory, null, 2));
  fs.writeFileSync(path.join(root, "config/quasar/deployments.json"), JSON.stringify({ submissionReady: false }, null, 2));
  for (const relativePath of options.files ?? []) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "fixture\n");
  }
  for (const relativePath of options.directories ?? []) {
    fs.mkdirSync(path.join(root, relativePath), { recursive: true });
  }
  // Written last: these two carry sentinels the checker greps for, and a fixture selector is allowed
  // to name either of them.
  fs.writeFileSync(path.join(root, "lib/program.ts"), "export const PROGRAM_COMPATIBILITY = {};\n");
  fs.writeFileSync(path.join(root, "lib/config/network.ts"), "const status = \"quasar-layout-unverified\";\n");
  return root;
}

function runChecker(root) {
  const result = spawnSync(process.execPath, [checkerPath], { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function inventoryWithPaths(paths) {
  return {
    updatedAt: "2026-09-02",
    phase: 5,
    target: "quasar",
    summary: "fixture inventory",
    allowedStatuses: ["quasar-ready"],
    submissionReadyRule: "fixture rule",
    demoCriticalPaths: paths.map((selector) => ({
      path: selector,
      surface: "fixture",
      status: "quasar-ready",
      reason: "fixture",
    })),
  };
}

test("the committed inventory passes the committed schema through the real checker", () => {
  const result = runChecker(repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK: audited \d+ demo-critical paths against runtime-compatibility\.schema\.json/);
});

test("every selector in the committed inventory is schema-valid", () => {
  const validate = compileJsonSchema(liveSchema);
  assert.deepEqual(validate(liveInventory), []);
});

// The syntactic forms the schema pattern owns. Each must be refused by the real checker before it
// reaches the filesystem: `..` in particular can otherwise resolve to a real file outside the repo
// and satisfy the existence check.
const REJECTED_SELECTORS = [
  ["empty", ""],
  ["absolute POSIX", "/etc/passwd"],
  ["Windows drive", "C:/Windows/System32"],
  ["Windows UNC", "//server/share/file"],
  ["backslash separator", "lib\\config\\network.ts"],
  ["backslash-only", "lib\\program.ts"],
  ["dot segment", "./lib/program.ts"],
  ["bare dot", "."],
  ["traversal segment", "../secrets.txt"],
  ["bare traversal", ".."],
  ["embedded traversal", "lib/../../secrets.txt"],
  ["interior dot segment", "lib/./program.ts"],
  ["double slash", "lib//program.ts"],
  ["trailing slash", "lib/"],
  ["leading slash", "/lib/program.ts"],
];

for (const [label, selector] of REJECTED_SELECTORS) {
  test(`the checker refuses a ${label} selector`, () => {
    const root = stageFixtureRepo(inventoryWithPaths([selector]), { files: ["lib/program.ts"] });
    const result = runChecker(root);
    assert.equal(result.status, 1, `expected refusal for ${JSON.stringify(selector)}\n${result.stdout}`);
    assert.match(result.stderr, /violates its schema/);
    assert.match(result.stderr, /#\/demoCriticalPaths\/0\/path:/);
    assert.equal(result.stderr.includes("references missing path"), false, "the schema must refuse before the filesystem check");
  });
}

test("the checker accepts nested file and directory selectors", () => {
  const selectors = ["lib/config/network.ts", "app/onboarding/page.tsx", "packages/demo-agents/src", "lib", ".github/workflows/ci.yml"];
  const root = stageFixtureRepo(inventoryWithPaths(selectors), {
    files: ["lib/config/network.ts", "app/onboarding/page.tsx", ".github/workflows/ci.yml"],
    directories: ["packages/demo-agents/src"],
  });
  const result = runChecker(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK: audited 5 demo-critical paths/);
});

// The non-empty contracts the checker used to enforce in code (`!entry.surface || !entry.status ||
// !entry.reason`) and that the schema now owns. An audited demo-critical path with a blank surface
// or reason records no boundary and no justification at all.
for (const field of ["surface", "status", "reason"]) {
  for (const [label, value] of [["empty", ""], ["whitespace-only", "   "], ["newline-only", "\n"]]) {
    test(`the checker refuses a ${label} ${field}`, () => {
      const inventory = inventoryWithPaths(["lib/program.ts"]);
      inventory.demoCriticalPaths[0][field] = value;
      // A blank status must be refused by the schema even when the document also declares it
      // allowed, so the status enum cannot readmit what the shape contract rejects.
      if (field === "status") inventory.allowedStatuses = [value];
      const root = stageFixtureRepo(inventory, { files: ["lib/program.ts"] });
      const result = runChecker(root);
      assert.equal(result.status, 1, `expected refusal for ${field}=${JSON.stringify(value)}\n${result.stdout}`);
      assert.match(result.stderr, /violates its schema/);
      assert.match(result.stderr, new RegExp(`#/demoCriticalPaths/0/${field}:`));
      assert.equal(result.stdout.includes("OK: audited"), false);
    });
  }
}

test("a blank allowedStatuses entry is refused", () => {
  const inventory = inventoryWithPaths(["lib/program.ts"]);
  inventory.allowedStatuses = ["quasar-ready", " "];
  const root = stageFixtureRepo(inventory, { files: ["lib/program.ts"] });
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /#\/allowedStatuses\/1:/);
});

test("a status outside allowedStatuses is still refused after the shape check passes", () => {
  const inventory = inventoryWithPaths(["lib/program.ts"]);
  inventory.demoCriticalPaths[0].status = "invented-status";
  const root = stageFixtureRepo(inventory, { files: ["lib/program.ts"] });
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported compatibility status: invented-status/);
});

test("a schema-valid selector that does not exist is still refused by the filesystem check", () => {
  const root = stageFixtureRepo(inventoryWithPaths(["lib/not-here.ts"]), { files: ["lib/program.ts"] });
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /references missing path/);
});

test("a malformed entry type is refused with its JSON path", () => {
  const inventory = inventoryWithPaths(["lib/program.ts"]);
  inventory.demoCriticalPaths[0].path = 42;
  const root = stageFixtureRepo(inventory, { files: ["lib/program.ts"] });
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /#\/demoCriticalPaths\/0\/path: expected string but found integer/);
});

test("a missing required field and an unknown field are both refused", () => {
  const inventory = inventoryWithPaths(["lib/program.ts"]);
  delete inventory.demoCriticalPaths[0].reason;
  inventory.demoCriticalPaths[0].note = "not in the schema";
  const root = stageFixtureRepo(inventory, { files: ["lib/program.ts"] });
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /#\/demoCriticalPaths\/0\/reason: is required but missing/);
  assert.match(result.stderr, /#\/demoCriticalPaths\/0\/note: is not a permitted property/);
});

test("an empty demoCriticalPaths array is refused", () => {
  const root = stageFixtureRepo(inventoryWithPaths([]), { files: ["lib/program.ts"] });
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /#\/demoCriticalPaths: must have at least 1 item/);
});

test("a schema the validator cannot compile is refused rather than skipped", () => {
  const schema = structuredClone(liveSchema);
  schema.properties.demoCriticalPaths.items.properties.path = { $ref: "#/$defs/path" };
  const root = stageFixtureRepo(inventoryWithPaths(["lib/program.ts"]), { schema, files: ["lib/program.ts"] });
  const result = runChecker(root);
  assert.equal(result.status, 1, "an uncompilable schema must fail the gate, not fall through to the semantic checks");
  assert.match(result.stderr, /schema could not be compiled/);
  assert.match(result.stderr, /unsupported schema keyword "\$ref"/);
  assert.equal(result.stdout.includes("OK: audited"), false);
});

test("an unreadable schema is refused rather than skipped", () => {
  const root = stageFixtureRepo(inventoryWithPaths(["lib/program.ts"]), { files: ["lib/program.ts"] });
  fs.writeFileSync(path.join(root, "config/quasar/runtime-compatibility.schema.json"), "{ not json");
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /schema could not be read as JSON/);
  assert.equal(result.stdout.includes("OK: audited"), false);
});

test("schema violations are reported deterministically and bounded", () => {
  const inventory = inventoryWithPaths(Array.from({ length: 40 }, () => "../escape"));
  const root = stageFixtureRepo(inventory, { files: ["lib/program.ts"] });
  const first = runChecker(root);
  const second = runChecker(root);
  assert.equal(first.status, 1);
  assert.equal(first.stderr, second.stderr, "the same document must produce byte-identical diagnostics");
  assert.match(first.stderr, /40 violation\(s\)/);
  assert.match(first.stderr, /\.\.\.and 20 further violation\(s\)/);
  assert.equal(first.stderr.split("\n").filter((line) => line.startsWith("- ")).length, 21);
});
