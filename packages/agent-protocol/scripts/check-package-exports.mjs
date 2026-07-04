#!/usr/bin/env node
// check-package-exports.mjs
//
// npm publication readiness guard.
//
// Root-cause fix for a defect where a change could commit source but not the
// compiled dist/, leaving package.json "exports" pointing at files that do not
// exist. A publish would then ship broken subpaths (e.g. `import ... from
// "@reddi/agent-protocol/receipts"` resolving to a missing ./dist/receipts.js),
// and the ordinary test suite would stay green because it imports from dist via
// paths TypeScript happens to have emitted for the modules under test.
//
// This script reads package.json "exports" (plus top-level "main"/"types") and
// asserts EVERY declared target file exists on disk. It is meant to run AFTER
// `npm run build`. Node built-ins only, no dependencies, fully offline.
//
// Exit 0 when every target resolves; non-zero with a clear listing otherwise.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(scriptDir, '..');
const pkgPath = join(pkgDir, 'package.json');

/** Collected problems: { source, target, resolved } */
const missing = [];
/** Every (source -> resolved) pair we verified, for the success summary. */
let checkedCount = 0;

function resolveTarget(relTarget) {
  // Exports/main/types targets are package-relative POSIX-ish paths like
  // "./dist/receipts.js". resolve() normalises them against the package dir.
  return resolve(pkgDir, relTarget);
}

function checkTarget(source, relTarget) {
  if (typeof relTarget !== 'string') {
    missing.push({
      source,
      target: String(relTarget),
      resolved: '(not a string target)',
    });
    return;
  }
  const resolved = resolveTarget(relTarget);
  checkedCount += 1;
  if (!existsSync(resolved)) {
    missing.push({ source, target: relTarget, resolved });
  }
}

function main() {
  if (!existsSync(pkgPath)) {
    console.error(`check-package-exports: cannot find package.json at ${pkgPath}`);
    process.exit(1);
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    console.error(`check-package-exports: package.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  // 1. Top-level "main" and "types" must resolve.
  if (typeof pkg.main === 'string') {
    checkTarget('main', pkg.main);
  }
  if (typeof pkg.types === 'string') {
    checkTarget('types', pkg.types);
  }

  // 2. Every "exports" subpath: assert each "types" and "import" (and any other
  //    string condition, e.g. "require"/"default", or a bare string target)
  //    points at an existing file.
  const exportsField = pkg.exports;
  if (exportsField && typeof exportsField === 'object') {
    for (const [subpath, entry] of Object.entries(exportsField)) {
      if (typeof entry === 'string') {
        // e.g. "./package.json": "./package.json"
        checkTarget(`exports["${subpath}"]`, entry);
      } else if (entry && typeof entry === 'object') {
        for (const [condition, target] of Object.entries(entry)) {
          checkTarget(`exports["${subpath}"].${condition}`, target);
        }
      } else {
        missing.push({
          source: `exports["${subpath}"]`,
          target: String(entry),
          resolved: '(unsupported exports entry shape)',
        });
      }
    }
  }

  if (missing.length > 0) {
    console.error('check-package-exports: FAIL — package.json points at files that do not exist on disk.');
    console.error('This usually means the build has not run or compiled dist/ was not committed.');
    console.error('');
    for (const m of missing) {
      console.error(`  MISSING  ${m.source}`);
      console.error(`           declared: ${m.target}`);
      console.error(`           resolved: ${m.resolved}`);
    }
    console.error('');
    console.error(`check-package-exports: ${missing.length} missing target(s) out of ${checkedCount} checked.`);
    console.error('Run `npm run build` and ensure dist/ is committed, then re-run this check.');
    process.exit(1);
  }

  console.log(`check-package-exports: OK — all ${checkedCount} export/main/types target(s) exist on disk.`);
}

main();
