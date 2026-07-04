import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This test is the in-suite half of the npm-publication-readiness guard
// (the CLI half is scripts/check-package-exports.mjs). It makes `npm test`
// ITSELF catch the defect where package.json "exports" points at compiled
// files that were never built or committed, so a publish would ship broken
// subpaths. `npm test` runs the build first, so dist/ is present here.
//
// Compiled test runs from dist-tests/*.test.js, so the package root is one
// directory up from this file's location at runtime.
const testDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(testDir, '..');
const pkgPath = join(pkgDir, 'package.json');

type ExportsField = Record<string, string | Record<string, string> | unknown>;

interface Pkg {
  main?: string;
  types?: string;
  exports?: ExportsField;
}

function loadPkg(): Pkg {
  return JSON.parse(readFileSync(pkgPath, 'utf8')) as Pkg;
}

/** Every declared (source label -> package-relative target) pair. */
function collectTargets(pkg: Pkg): Array<{ source: string; target: string }> {
  const targets: Array<{ source: string; target: string }> = [];

  if (typeof pkg.main === 'string') {
    targets.push({ source: 'main', target: pkg.main });
  }
  if (typeof pkg.types === 'string') {
    targets.push({ source: 'types', target: pkg.types });
  }

  const exportsField = pkg.exports;
  if (exportsField && typeof exportsField === 'object') {
    for (const [subpath, entry] of Object.entries(exportsField)) {
      if (typeof entry === 'string') {
        targets.push({ source: `exports["${subpath}"]`, target: entry });
      } else if (entry && typeof entry === 'object') {
        for (const [condition, target] of Object.entries(entry as Record<string, unknown>)) {
          assert.equal(
            typeof target,
            'string',
            `exports["${subpath}"].${condition} must be a string target`,
          );
          targets.push({
            source: `exports["${subpath}"].${condition}`,
            target: target as string,
          });
        }
      } else {
        assert.fail(`exports["${subpath}"] has an unsupported shape: ${String(entry)}`);
      }
    }
  }

  return targets;
}

describe('package.json exports resolution guard', () => {
  it('resolves every declared target to a file that exists in dist/', () => {
    const pkg = loadPkg();
    const targets = collectTargets(pkg);

    // Sanity: the package must declare a non-trivial set of targets, otherwise
    // an empty/broken exports map would vacuously "pass".
    assert.ok(targets.length > 0, 'package.json declares no export/main/types targets');

    const missing: string[] = [];
    for (const { source, target } of targets) {
      const resolved = resolve(pkgDir, target);
      if (!existsSync(resolved)) {
        missing.push(`${source} -> ${target} (resolved: ${resolved})`);
      }
    }

    assert.deepEqual(
      missing,
      [],
      `package.json points at ${missing.length} file(s) that do not exist on disk:\n  ${missing.join('\n  ')}\n` +
        'Run `npm run build` and commit dist/.',
    );
  });

  it('declares every top-level exports subpath with a resolvable types+import (or string) target', () => {
    const pkg = loadPkg();
    assert.ok(pkg.exports && typeof pkg.exports === 'object', 'package.json has no exports map');

    for (const [subpath, entry] of Object.entries(pkg.exports as ExportsField)) {
      if (typeof entry === 'string') {
        // bare-string targets (e.g. "./package.json") are checked in the other test
        continue;
      }
      assert.ok(entry && typeof entry === 'object', `exports["${subpath}"] must be an object or string`);
      const conditions = entry as Record<string, string>;
      // Module-shaped subpaths must expose both a types and an import target so
      // consumers get typings and ESM resolution; missing either breaks tooling.
      assert.ok(
        typeof conditions.types === 'string',
        `exports["${subpath}"] is missing a "types" target`,
      );
      assert.ok(
        typeof conditions.import === 'string',
        `exports["${subpath}"] is missing an "import" target`,
      );
    }
  });
});
