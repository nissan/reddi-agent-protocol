const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const net = require("node:net");
const tls = require("node:tls");
const http = require("node:http");
const https = require("node:https");
const dgram = require("node:dgram");
const moduleBuiltin = require("node:module");

const originalAppendFileSync = fs.appendFileSync.bind(fs);
const originalSpawn = childProcess.spawn.bind(childProcess);
const effectsPath = process.env.QUASAR_REFUSAL_EFFECTS;
const signerSentinel = process.env.QUASAR_REFUSAL_SIGNER_SENTINEL
  ? path.resolve(process.env.QUASAR_REFUSAL_SIGNER_SENTINEL)
  : null;
const targetPaths = new Set(
  (process.env.QUASAR_REFUSAL_TARGETS || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => path.resolve(entry)),
);
const positiveFixture = process.env.QUASAR_REFUSAL_EFFECT_FIXTURE
  ? path.resolve(process.env.QUASAR_REFUSAL_EFFECT_FIXTURE)
  : null;
const npmParent = process.env.QUASAR_REFUSAL_NPM_PARENT
  ? path.resolve(process.env.QUASAR_REFUSAL_NPM_PARENT)
  : null;
const npmLaunch = process.env.QUASAR_REFUSAL_NPM_LAUNCH;
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isNpmParent = Boolean(invokedPath) && invokedPath === npmParent;

if (invokedPath && (isNpmParent || targetPaths.has(invokedPath) || invokedPath === positiveFixture)) {
  const record = (effect) => {
    if (effectsPath) originalAppendFileSync(effectsPath, `${JSON.stringify(effect)}\n`);
  };
  const reject = (type, detail) => {
    record({ type, detail: String(detail || "") });
    throw new Error(`${type} intercepted`);
  };
  const signerPath = (value) => typeof value === "string" && signerSentinel && path.resolve(value) === signerSentinel;

  for (const method of ["readFileSync", "openSync", "createReadStream"]) {
    const original = fs[method].bind(fs);
    fs[method] = function instrumentedFileRead(file, ...args) {
      if (signerPath(file)) return reject("signer-read", file);
      return original(file, ...args);
    };
  }
  for (const method of ["readFile", "open"]) {
    const original = fs[method].bind(fs);
    fs[method] = function instrumentedFileRead(file, ...args) {
      if (signerPath(file)) return reject("signer-read", file);
      return original(file, ...args);
    };
  }
  const originalPromiseRead = fs.promises.readFile.bind(fs.promises);
  fs.promises.readFile = async function instrumentedPromiseRead(file, ...args) {
    if (signerPath(file)) return reject("signer-read", file);
    return originalPromiseRead(file, ...args);
  };

  for (const [owner, methods, type] of [
    [net, ["connect", "createConnection"], "network"],
    [tls, ["connect"], "network"],
    [http, ["request", "get"], "http"],
    [https, ["request", "get"], "http"],
    [dgram, ["createSocket"], "socket"],
    [childProcess, ["exec", "execFile", "fork", "spawn", "execSync", "execFileSync", "spawnSync"], "child-process"],
  ]) {
    for (const method of methods) owner[method] = (...args) => reject(type, `${method}:${String(args[0] || "")}`);
  }
  if (isNpmParent && npmLaunch) {
    childProcess.spawn = (command, args, ...rest) => {
      if (Array.isArray(args) && args.at(-1) === npmLaunch) return originalSpawn(command, args, ...rest);
      return reject("child-process", `spawn:${String(command || "")}`);
    };
  }
  globalThis.fetch = (...args) => reject("fetch", args[0]);
  moduleBuiltin.syncBuiltinESMExports();
}
