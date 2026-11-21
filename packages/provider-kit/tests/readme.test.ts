import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runCli } from "../src/cli.js";

// The quickstart is followed word for word, so every command and option it
// names must exist in the CLI's own help.
test("every rap-provider command and option in the README is in --help", async () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const out: string[] = [];
  assert.equal(await runCli(["--help"], { out: (line) => out.push(line), err: () => {}, env: {} }), 0);
  const help = out.join("\n");
  const commands = new Set([...readme.matchAll(/rap-provider ([a-z][a-z-]*)((?: --?[a-z-]+(?: "[^"]*"| [^\s-][^\s]*)?)*)/g)].map((m) => m[1] + m[2]));
  assert.ok(commands.size >= 5, "the README names the commands");
  for (const use of commands) {
    const [command, ...rest] = use.split(" ");
    assert.match(help, new RegExp(`^  ${command} `, "m"), `README uses "rap-provider ${command}", which --help does not list`);
    for (const option of rest.filter((part) => part.startsWith("--"))) {
      assert.ok(help.includes(`${option} `), `README uses ${option}, which --help does not list`);
    }
  }
});
