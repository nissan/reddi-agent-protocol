#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { compileJsonSchema, formatSchemaErrors } from "./lib/json-schema-subset.mjs";

const repoRoot = process.cwd();
const compatibilityPath = path.join(repoRoot, "config/quasar/runtime-compatibility.json");
const schemaPath = path.join(repoRoot, "config/quasar/runtime-compatibility.schema.json");
const deploymentsPath = path.join(repoRoot, "config/quasar/deployments.json");

function fail(message, detail) {
  console.error(`[quasar-runtime-compat] FAIL: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${label} could not be read as JSON`, `${path.relative(repoRoot, filePath)}: ${error.message}`);
  }
}

// The committed schema is a gate input, not documentation: a schema that cannot be read or compiled
// means this check cannot prove what it claims, so it refuses rather than skipping to the semantic
// checks and reporting OK on an unvalidated document.
const schema = readJson(schemaPath, "the compatibility schema");
let validateCompatibility;
try {
  validateCompatibility = compileJsonSchema(schema);
} catch (error) {
  fail("the compatibility schema could not be compiled", `config/quasar/runtime-compatibility.schema.json: ${error.message}`);
}

const compatibility = readJson(compatibilityPath, "the compatibility inventory");

// Schema first. Everything below assumes the document's shape, and a syntactically unsafe selector
// (absolute, backslash-separated, traversing, or with an empty segment) must be refused here rather
// than reaching fs.existsSync, where a traversing path can resolve to a real file outside the repo.
const schemaErrors = validateCompatibility(compatibility);
if (schemaErrors.length > 0) {
  fail(
    `config/quasar/runtime-compatibility.json violates its schema (${schemaErrors.length} violation(s))`,
    formatSchemaErrors(schemaErrors),
  );
}

const deployments = readJson(deploymentsPath, "the deployment inventory");
const entries = compatibility.demoCriticalPaths;

const allowed = new Set(compatibility.allowedStatuses);
for (const entry of entries) {
  if (!allowed.has(entry.status)) {
    fail(`unsupported compatibility status: ${entry.status}`, entry.path);
  }
  // JSON Schema settled the path's text; only the filesystem can settle the rest.
  if (!fs.existsSync(path.join(repoRoot, entry.path))) {
    fail("compatibility entry references missing path", entry.path);
  }
}

const blocked = entries.filter((entry) => entry.status === "anchor-layout-only" || entry.status === "blocked-pending-quasar-port");
if (deployments.submissionReady === true && blocked.length > 0) {
  fail(
    "deployment inventory cannot be submissionReady=true while Quasar runtime blockers remain",
    blocked.map((entry) => `- ${entry.path}: ${entry.status}`).join("\n"),
  );
}

const programSource = fs.readFileSync(path.join(repoRoot, "lib/program.ts"), "utf8");
const networkSource = fs.readFileSync(path.join(repoRoot, "lib/config/network.ts"), "utf8");
if (!programSource.includes("PROGRAM_COMPATIBILITY") || !networkSource.includes("quasar-layout-unverified")) {
  fail("runtime config must expose quasar-layout-unverified compatibility metadata in Quasar mode");
}

console.log(`[quasar-runtime-compat] OK: audited ${entries.length} demo-critical paths against ${path.basename(schemaPath)}`);
if (blocked.length > 0) {
  console.log(`[quasar-runtime-compat] BLOCKED: ${blocked.length} paths require Quasar port/verification before submissionReady=true`);
}
