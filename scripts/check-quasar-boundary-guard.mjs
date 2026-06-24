#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.cwd();
const CHECK_NAME = "quasar-boundary-guard";
const PROGRAM_BOUNDARY_MARKER = "@quasar-program-boundary";

const DEFAULT_PROTECTED_PATHS = [
  "packages/agent-protocol/src",
];

const PROGRAM_BOUNDARY_PATHS = [
  "experiments/",
  "lib/program.ts",
  "lib/register/",
  "packages/demo-agents/",
  "packages/per-client/",
  "scripts/check-devnet-agent-pdas.ts",
  "scripts/run-quasar-",
  "scripts/run-surfpool-",
];

const SCANNABLE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".sh",
  ".ts",
  ".tsx",
]);

const FORBIDDEN_SURFACES = [
  {
    id: "instruction-builder",
    description: "Solana/Quasar instruction builders or transaction assembly",
    patterns: [
      /\bTransactionInstruction\b/,
      /\b(AccountMeta|SystemProgram|ComputeBudgetProgram)\b/,
      /\b(create|build|make)[A-Za-z0-9_]*(Instruction|Transaction)\b/,
      /\b(add|compile|serialize)\s*\([^)]*\b(Transaction|Instruction)\b/,
      /from\s+["'](?:@solana\/web3\.js|@solana\/spl-token|@coral-xyz\/anchor)["']/,
    ],
  },
  {
    id: "transaction-signing",
    description: "transaction signing, sending, or wallet/keypair loading",
    patterns: [
      /\bKeypair\.(fromSecretKey|generate)\b/,
      /\b(load|read|parse)[A-Za-z0-9_]*(Keypair|Wallet|Secret)\b/,
      /\b(sign|partialSign|signTransaction|signAllTransactions)\b/,
      /\b(sendAndConfirmTransaction|sendRawTransaction|sendTransaction)\b/,
    ],
  },
  {
    id: "rpc-client-probe",
    description: "Solana RPC/client construction or account probes",
    patterns: [
      /\bnew\s+Connection\s*\(/,
      /\b(connection|client)\.(getAccountInfo|getBalance|getLatestBlockhash|getProgramAccounts|getSignatureStatuses|getTransaction|requestAirdrop|simulateTransaction)\s*\(/,
      /\b(clusterApiUrl|RpcClient|rpcUrl|rpcEndpoint)\b/,
      /from\s+["'](?:@solana\/web3\.js|@magicblock-labs\/ephemeral-rollups-sdk)["']/,
    ],
  },
  {
    id: "surfpool-devnet-call",
    description: "Surfpool/devnet/MagicBlock network calls",
    patterns: [
      /\bsurfpool\s+(?:start|run|scenario|smoke|test)\b/i,
      /\bdevnet-tee\.magicblock\.app\b/i,
      /\bapi\.devnet\.solana\.com\b/i,
      /\bsolana\s+(?:airdrop|balance|cluster-version|confirm|program|transfer)\b/,
      /\b(smoke|run):quasar:per-devnet\b/,
    ],
  },
  {
    id: "program-deploy-migration",
    description: "program deploy, upgrade, or migration command path",
    patterns: [
      /\bsolana\s+program\s+(?:deploy|write-buffer|set-upgrade-authority)\b/,
      /\b(anchor|quasar)\s+(?:deploy|migrate|upgrade|build)\b/,
      /\b(BPFUpgradeableLoader|upgradeAuthority|migration)\b/,
      /\bdeploy[A-Za-z0-9_]*(Program|Quasar|Escrow|Registry|Reputation|Attestation)\b/,
    ],
  },
  {
    id: "pda-account-layout-mutation",
    description: "PDA derivation, account-layout mutation, or raw account serialization",
    patterns: [
      /\b(PublicKey\.)?(findProgramAddressSync|findProgramAddress|createProgramAddressSync|createProgramAddress)\b/,
      /\b(BufferLayout|borsh|AccountLayout|MintLayout|TOKEN_PROGRAM_ID)\b/,
      /\b(writeBigUInt64LE|writeUInt8|writeInt32LE|Buffer\.alloc)\b/,
      /\b(accountMetas|accountLayout)\b/,
    ],
  },
  {
    id: "quasar-state-mutation",
    description: "Quasar registry, escrow, reputation, attestation, or PER state mutation",
    patterns: [
      /\b(register|update|close|settle|commit|reveal|attest|dispute|delegate|undelegate)[A-Za-z0-9_]*(Agent|Listing|Escrow|Reputation|Attestation|Vault|Per|PER|Quasar)\b/,
      /\bquasar[A-Za-z0-9_]*\.(?:register|update|settle|commit|reveal|attest|dispute|delegate|undelegate|send|deploy)\b/,
      /\b(reputationMutated|quasarInstructionBuilt)\s*:\s*true\b/,
      /\b(instructionFlow|registrationIntent)\s*:\s*["'](?:built|register|update)["']/,
    ],
  },
];

function usage() {
  return [
    "Usage: node scripts/check-quasar-boundary-guard.mjs [--changed|--staged] [path ...]",
    "",
    "Default scans configured package/read-model protected paths.",
    "--changed/--staged scan touched files only when they are under configured package/read-model protected paths.",
    `Files with forbidden surfaces fail unless they live in a program-boundary path or contain ${PROGRAM_BOUNDARY_MARKER}.`,
  ].join("\n");
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isScannableFile(filePath) {
  return SCANNABLE_EXTENSIONS.has(path.extname(filePath)) && fs.existsSync(path.join(repoRoot, filePath));
}

function walkFiles(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [normalizePath(relativePath)].filter(isScannableFile);
  if (!stat.isDirectory()) return [];

  const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-tests") return [];
    return walkFiles(path.join(relativePath, entry.name));
  });
}

function filesFromGit(args) {
  const output = execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isProtectedSourceFile(filePath) {
  return DEFAULT_PROTECTED_PATHS.some((scope) => filePath === scope || filePath.startsWith(`${scope}/`));
}

function resolveTargets(argv) {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true, files: [] };
  }

  const useChanged = args.includes("--changed");
  const useStaged = args.includes("--staged");
  const explicitPaths = args.filter((arg) => !arg.startsWith("--"));
  const unknownFlags = args.filter((arg) => arg.startsWith("--") && !["--changed", "--staged"].includes(arg));
  if (unknownFlags.length) {
    throw new Error(`unknown option(s): ${unknownFlags.join(", ")}`);
  }

  if (useChanged && useStaged) {
    throw new Error("choose only one of --changed or --staged");
  }

  if (explicitPaths.length > 0) {
    return {
      mode: "explicit",
      files: unique(explicitPaths.flatMap((target) => walkFiles(normalizePath(target)))),
    };
  }

  if (useStaged) {
    return {
      mode: "staged",
      files: unique(filesFromGit(["diff", "--name-only", "--cached"])
        .map(normalizePath)
        .filter((file) => isProtectedSourceFile(file) && isScannableFile(file))),
    };
  }

  if (useChanged) {
    let changed = [];
    try {
      changed = filesFromGit(["diff", "--name-only", "origin/main...HEAD"]);
    } catch {
      changed = filesFromGit(["diff", "--name-only", "HEAD"]);
    }
    const untracked = filesFromGit(["ls-files", "--others", "--exclude-standard"]);
    return {
      mode: "changed",
      files: unique([...changed, ...untracked]
        .map(normalizePath)
        .filter((file) => isProtectedSourceFile(file) && isScannableFile(file))),
    };
  }

  return {
    mode: "default",
    files: unique(DEFAULT_PROTECTED_PATHS.flatMap((target) => walkFiles(target))),
  };
}

function isProgramBoundaryPath(filePath) {
  return PROGRAM_BOUNDARY_PATHS.some((scope) => (
    scope.endsWith("/") ? filePath.startsWith(scope) : filePath === scope || filePath.startsWith(scope)
  ));
}

function scanFile(filePath) {
  const absolutePath = path.join(repoRoot, filePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const programBoundary = isProgramBoundaryPath(filePath) || source.includes(PROGRAM_BOUNDARY_MARKER);
  const lines = source.split(/\r?\n/);
  const findings = [];

  for (const surface of FORBIDDEN_SURFACES) {
    for (const pattern of surface.patterns) {
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          findings.push({
            file: filePath,
            line: index + 1,
            surface: surface.id,
            description: surface.description,
            snippet: line.trim().slice(0, 180),
            programBoundary,
          });
        }
      }
    }
  }

  return findings;
}

export function checkFiles(files) {
  const findings = unique(files).flatMap(scanFile);
  const failures = findings.filter((finding) => !finding.programBoundary);
  const handoffs = findings.filter((finding) => finding.programBoundary);
  return {
    ok: failures.length === 0,
    filesScanned: unique(files).length,
    failures,
    handoffs,
    forbiddenSurfaces: FORBIDDEN_SURFACES.map(({ id, description }) => ({ id, description })),
    protectedPaths: DEFAULT_PROTECTED_PATHS,
    programBoundaryMarker: PROGRAM_BOUNDARY_MARKER,
  };
}

function formatFinding(finding) {
  return [
    `- ${finding.file}:${finding.line} [${finding.surface}] ${finding.description}`,
    `  ${finding.snippet}`,
  ].join("\n");
}

function unique(items) {
  return [...new Set(items)];
}

function main() {
  let targets;
  try {
    targets = resolveTargets(process.argv.slice(2));
  } catch (error) {
    console.error(`[${CHECK_NAME}] FAIL: ${error.message}`);
    console.error(usage());
    process.exit(1);
  }

  if (targets.help) {
    console.log(usage());
    return;
  }

  const result = checkFiles(targets.files);
  if (!result.ok) {
    console.error(`[${CHECK_NAME}] FAIL: forbidden Solana/Quasar mutation surfaces found in package/read-model lane`);
    console.error(result.failures.map(formatFinding).join("\n"));
    console.error(`Declare ${PROGRAM_BOUNDARY_MARKER} or move the change under a program-boundary path, then use the #441 promotion checklist.`);
    process.exit(1);
  }

  console.log(`[${CHECK_NAME}] OK: scanned ${result.filesScanned} file(s); no package/read-model boundary violations`);
  if (result.handoffs.length) {
    console.log(`[${CHECK_NAME}] program-boundary handoffs: ${result.handoffs.length}`);
  }
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (executedPath === fileURLToPath(import.meta.url)) {
  main();
}
