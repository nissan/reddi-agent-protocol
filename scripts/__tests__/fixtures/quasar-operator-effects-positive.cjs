const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const childProcess = require("node:child_process");

for (const effect of [
  () => fs.readFileSync(process.env.QUASAR_REFUSAL_SIGNER_SENTINEL, "utf8"),
  () => net.connect({ host: "invalid.test", port: 1 }),
  () => http.get("http://invalid.test/"),
  () => fetch("http://invalid.test/"),
  () => childProcess.spawn("synthetic-command"),
]) {
  try { effect(); } catch {}
}

fs.mkdirSync(process.env.QUASAR_REFUSAL_ARTIFACT_SENTINEL, { recursive: true });
