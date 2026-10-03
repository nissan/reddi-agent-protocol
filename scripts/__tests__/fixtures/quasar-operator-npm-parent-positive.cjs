const fs = require("node:fs");
const net = require("node:net");
const tls = require("node:tls");
const https = require("node:https");
const childProcess = require("node:child_process");

for (const effect of [
  () => fs.readFileSync(process.env.QUASAR_REFUSAL_SIGNER_SENTINEL, "utf8"),
  () => net.connect({ host: "invalid.test", port: 443 }),
  () => tls.connect({ host: "invalid.test", port: 443 }),
  () => https.get("https://invalid.test/npm"),
  () => fetch("https://invalid.test/npm"),
  () => childProcess.spawn("sh", ["-c", "synthetic-unpermitted-launch"]),
  () => childProcess.exec(process.env.QUASAR_REFUSAL_NPM_LAUNCH),
]) {
  try {
    effect();
    process.exitCode = 1;
  } catch {}
}
