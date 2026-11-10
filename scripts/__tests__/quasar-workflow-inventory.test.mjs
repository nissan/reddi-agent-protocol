import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");
const FREEZE = "docs/QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md";

/** Workflow files whose text mentions Quasar, and the inventory section of the freeze decision. */
export function unlistedQuasarWorkflows(workflows, inventory) {
  return Object.entries(workflows)
    .filter(([, text]) => /quasar/i.test(text))
    .map(([name]) => name)
    .filter((name) => !inventory.includes(`.github/workflows/${name}`))
    .sort();
}

function inventorySection() {
  const text = readFileSync(join(ROOT, FREEZE), "utf8");
  const start = text.indexOf("## Retained workflow inventory");
  assert.notEqual(start, -1, `${FREEZE} has no "Retained workflow inventory" section`);
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

test("every workflow that mentions Quasar is named in the freeze decision's inventory", () => {
  const workflows = Object.fromEntries(
    readdirSync(WORKFLOWS)
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => [name, readFileSync(join(WORKFLOWS, name), "utf8")]),
  );
  assert.ok(Object.keys(workflows).length > 0, "no workflow files were read");
  assert.deepEqual(unlistedQuasarWorkflows(workflows, inventorySection()), []);
});

test("a new workflow that mentions Quasar is reported until the inventory names it", () => {
  const inventory = "[A](../.github/workflows/listed.yml)";
  const workflows = {
    "listed.yml": "run: npm run test:surfpool:quasar-critical",
    "new-lane.yml": "paths: ['experiments/quasar-escrow/**']",
    "unrelated.yml": "run: npm test",
  };
  assert.deepEqual(unlistedQuasarWorkflows(workflows, inventory), ["new-lane.yml"]);
  assert.deepEqual(
    unlistedQuasarWorkflows(workflows, `${inventory} [B](../.github/workflows/new-lane.yml)`),
    [],
  );
});
