import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseProviderConfig } from "../src/config.js";
import { provider } from "./helpers.js";

const exampleDir = new URL("../../examples/first-party/", import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(name, exampleDir)), "utf8")) as Record<string, unknown>;

for (const name of ["script-writer.provider.json", "humaniser.provider.json"]) {
  test(`${name} is priced per token on the mid tier, keeps its instructions in a private file, and refuses to run until filled in`, () => {
    const file = load(name);
    assert.deepEqual({ ...(file.price as object), maxOutputTokens: undefined }, { currency: "USDC", inputPerMillion: "3", outputPerMillion: "15", maxOutputTokens: undefined });
    assert.match(String(file.systemPromptFile), /\.prompt\.private\.txt$/);
    assert.equal(file.systemPrompt, undefined);
    assert.equal((file.upstream as { mock: boolean }).mock, true);

    // As published, the placeholders stop it.
    assert.equal(parseProviderConfig(file, {}).ok, false);
    // Filled in, it parses with the stated price.
    const filled = parseProviderConfig({ ...file, wallet: provider.publicKey.toBase58(), publicUrl: "https://provider.example", model: "example/mid-tier" }, {});
    assert.ok(filled.ok, filled.ok ? "" : filled.errors.join("\n"));
    assert.equal(filled.config.terms.price.inputPerMillion, "3");
    assert.equal(filled.config.terms.price.outputPerMillion, "15");
  });
}

test("the private instruction files are never published", () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { files: string[] };
  assert.ok(pkg.files.includes("!examples/**/*.private.txt"));
  const ignore = readFileSync(fileURLToPath(new URL("../../../../.gitignore", import.meta.url)), "utf8");
  assert.match(ignore, /^\*\.prompt\.private\.txt$/m);
});
