#!/usr/bin/env node
// pin-local-deps.mjs
//
// Before a package is packed or published, replace each `file:../<sibling>`
// dependency with a caret range on that sibling's own version (for example
// `"@redditech/x402-solana": "file:../x402-solana"` becomes `"^0.1.0"`), so the
// published manifest names registry versions and no workspace path.
//
// Usage:
//   node scripts/release/pin-local-deps.mjs packages/provider-kit           # rewrite in place
//   node scripts/release/pin-local-deps.mjs --check packages/provider-kit   # fail if any file:/link:/workspace: spec remains
//
// Node built-ins only. No network.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SECTIONS = ["dependencies", "peerDependencies", "optionalDependencies"];
const LOCAL = /^(file|link|workspace):/;

const args = process.argv.slice(2);
const check = args.includes("--check");
const dirs = args.filter((a) => !a.startsWith("--"));
if (dirs.length === 0) {
  console.error("usage: pin-local-deps.mjs [--check] <package-dir>...");
  process.exit(2);
}

let failed = false;
for (const dir of dirs) {
  const file = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  let changed = false;
  for (const section of SECTIONS) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (!LOCAL.test(spec)) continue;
      if (check) {
        console.error(`${file}: ${section}.${name} is still "${spec}"`);
        failed = true;
        continue;
      }
      if (!spec.startsWith("file:")) {
        console.error(`${file}: ${section}.${name} uses "${spec}", which this script does not rewrite`);
        failed = true;
        continue;
      }
      const sibling = JSON.parse(readFileSync(join(resolve(dir, spec.slice("file:".length)), "package.json"), "utf8"));
      if (sibling.name !== name) {
        console.error(`${file}: ${section}.${name} points at ${sibling.name}`);
        failed = true;
        continue;
      }
      if (sibling.private) {
        console.error(`${file}: ${section}.${name} points at a private package`);
        failed = true;
        continue;
      }
      pkg[section][name] = `^${sibling.version}`;
      console.log(`${file}: ${section}.${name} ${spec} -> ^${sibling.version}`);
      changed = true;
    }
  }
  if (changed) writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  if (check && !failed) console.log(`${file}: no local dependency specs`);
}
process.exit(failed ? 1 : 0);
