import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const targetPaths = new Set(
  (process.env.QUASAR_REFUSAL_TARGETS || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => path.resolve(entry)),
);
const positiveFixture = process.env.QUASAR_REFUSAL_IMPORT_FIXTURE
  ? path.resolve(process.env.QUASAR_REFUSAL_IMPORT_FIXTURE)
  : null;
const effectsPath = process.env.QUASAR_REFUSAL_EFFECTS;

function record(effect) {
  if (effectsPath) fs.appendFileSync(effectsPath, `${JSON.stringify(effect)}\n`);
}

function isInstrumentedParent(parentURL) {
  if (!parentURL?.startsWith("file:")) return false;
  const parentPath = path.resolve(fileURLToPath(parentURL));
  return targetPaths.has(parentPath) || parentPath === positiveFixture;
}

export async function resolve(specifier, context, nextResolve) {
  if (isInstrumentedParent(context.parentURL)) {
    const sdkImport = !specifier.startsWith("node:") && !specifier.startsWith("file:") && !specifier.startsWith(".") && !path.isAbsolute(specifier);
    record({ type: sdkImport ? "sdk-import" : "business-import", specifier });
    throw new Error(`prohibited import intercepted: ${specifier}`);
  }
  return nextResolve(specifier, context);
}
