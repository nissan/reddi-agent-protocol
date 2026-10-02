#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [stableIdlPath, alphaIdlPath, stableBinaryPath, alphaBinaryPath, computePath, outputPath] = process.argv.slice(2);
if (![stableIdlPath, alphaIdlPath, stableBinaryPath, alphaBinaryPath, computePath, outputPath].every(Boolean)) {
  throw new Error("usage: compare-evidence.mjs <stable-idl> <alpha-idl> <stable-so> <alpha-so> <compute-log> <output-json>");
}

const stableIdl = JSON.parse(readFileSync(stableIdlPath, "utf8"));
const alphaIdl = JSON.parse(readFileSync(alphaIdlPath, "utf8"));
const stableIx = stableIdl.instructions?.[0];
const alphaIx = alphaIdl.instructions?.[0];

const comparableInstruction = (instruction) => ({
  name: instruction.name,
  discriminator: instruction.discriminator,
  accounts: instruction.accounts.map(({ name, writable = false, signer = false, relations = [] }) => ({
    name,
    writable,
    signer,
    relations,
  })),
  args: instruction.args,
});
const comparableIdl = (idl) => ({
  address: idl.address,
  instruction: comparableInstruction(idl.instructions[0]),
  accounts: idl.accounts,
  types: idl.types,
});

const expectedInstruction = {
  name: "update_agent",
  discriminator: [85, 2, 178, 9, 119, 139, 102, 164],
  accounts: [
    { name: "agent", writable: true, signer: false, relations: [] },
    { name: "owner", writable: false, signer: true, relations: ["agent"] },
  ],
  args: [
    { name: "rate_lamports", type: "u64" },
    { name: "min_reputation", type: "u8" },
    { name: "active", type: "bool" },
  ],
};
if (stableIdl.address !== "794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD") {
  throw new Error("stable generated IDL does not use the canonical RAP program id");
}
if (JSON.stringify(comparableInstruction(stableIx)) !== JSON.stringify(expectedInstruction)) {
  throw new Error("stable generated IDL drifted from the selected update_agent contract");
}
if (JSON.stringify(comparableIdl(stableIdl)) !== JSON.stringify(comparableIdl(alphaIdl))) {
  throw new Error("stable and alpha IDLs differ in their on-wire instruction/account/type contract");
}
if (!stableIx.accounts[0].pda || alphaIx.accounts[0].pda) {
  throw new Error("expected only the stable IDL to expose update_agent PDA derivation metadata");
}

const computeText = readFileSync(computePath, "utf8");
const computeMatch = computeText.match(/PILOT_COMPUTE_UNITS stable=(\d+) alpha=(\d+)/);
if (!computeMatch) throw new Error("compute evidence marker not found");
const stableCu = Number(computeMatch[1]);
const alphaCu = Number(computeMatch[2]);
if (!(stableCu > 0 && alphaCu > 0)) throw new Error("compute observations must be non-zero");

const binary = (path) => {
  const bytes = readFileSync(path);
  return {
    bytes: statSync(path).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
const percentReduction = (stable, alpha) => Number((((stable - alpha) / stable) * 100).toFixed(2));
const stableBinary = binary(stableBinaryPath);
const alphaBinary = binary(alphaBinaryPath);

const evidence = {
  schema: "rap.anchor-v2-update-agent-pilot.v1",
  scope: {
    instruction: "update_agent",
    execution: "isolated instruction-level Mollusk; no transaction or signature",
    authority: "owner signer account metadata is validated; no cryptographic signing occurs",
    claims: "pilot-only, default-off, non-production",
  },
  sources: {
    stableAnchor: "1.1.2",
    alphaAnchorDocs: "https://v2.anchor-lang.com/docs/v2/reference/alpha-limitations/",
    alphaAnchorGit: "https://github.com/otter-sec/anchor.git",
    alphaAnchorRevision: "917b27754a6175cbe41d558f00ec7895390e1819",
    alphaAnchorPackageVersion: "2.0.0-rc.1",
    mollusk: "0.15.1",
    platformTools: "v1.54",
    sbfArchitecture: "v3",
  },
  binary: {
    stable: stableBinary,
    alpha: alphaBinary,
    alphaPercentSmaller: percentReduction(stableBinary.bytes, alphaBinary.bytes),
  },
  computeUnits: {
    status: "observed",
    stable: stableCu,
    alpha: alphaCu,
    alphaPercentFewer: percentReduction(stableCu, alphaCu),
    limitation: "Mollusk's all-enabled default feature profile only; not LiteSVM, devnet, mainnet, transaction, or runtime-equivalence evidence",
  },
  compatibility: {
    generatedIdlWireContract: "equivalent",
    generatedRustClientInstruction: "equivalent_with_explicit_agent_account",
    stablePdaMetadata: "present",
    alphaPdaMetadata: "absent",
    pdaMetadataLimitation: "Anchor v2 alpha omits this stored-bump PDA derivation hint; clients must supply the canonical agent PDA",
    stableTypeScriptIdl: "generated",
    alphaTypeScriptIdl: "generated_type_only",
    alphaTypeScriptRuntime: "not_evaluated_no_stable_v2_package_published",
  },
  deterministicBehavior: "both binaries accepted stable canonical account bytes and produced the same checked field updates",
};

writeFileSync(resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
