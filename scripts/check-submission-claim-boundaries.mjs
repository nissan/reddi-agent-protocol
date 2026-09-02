#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "artifacts/final-recording-packet-20260507.md",
      "docs/ECONOMIC-DEMO-JUDGE-PACKET-2026-05-05.md",
      "docs/ECONOMIC-DEMO-PROOF-HIERARCHY-2026-05-07.md",
      "docs/HACKATHON-BOUNTY-SHOWCASE-AUDIT-2026-05-07.md",
      "docs/COLOSSEUM-FINAL-QUASAR-PROOF-MAP-2026-05-06.md",
      "docs/verifiable-agent-protocol/colosseum-frontier-2026-04/NARRATIVE.md",
      "artifacts/economic-demo-submission-prep/latest/SUBMISSION-PREP.md",
    ];

const failures = [];

const requiredByFile = {
  "artifacts/final-recording-packet-20260507.md": [
    "Pay.sh / `reddi-x402` proves sandbox HTTP 402 → payment → HTTP 200 receipt compatibility",
    "Pay.sh capped-session or split-payment settlement completed",
    "Pay.sh evidence proving Umbra private settlement or MagicBlock PER settlement",
    "Umbra private x402 adapter contract is implemented",
    "Umbra private settlement executed",
    "Umbra devnet encrypted-balance deposit completed",
  ],
  "docs/ECONOMIC-DEMO-JUDGE-PACKET-2026-05-05.md": [
    "Pay.sh / `reddi-x402` sandbox compatibility is proven for the single-recipient charge flow",
    "No Pay.sh capped-session or split-payment settlement claim",
    "Pay.sh capped sessions/splits remain probe-only",
    "Umbra private x402 adapter contract is implemented, and bounded devnet encrypted-balance deposit evidence is attached; live/mainnet settlement is not claimed",
    "Umbra devnet encrypted-balance deposit completed",
  ],
  "docs/ECONOMIC-DEMO-PROOF-HIERARCHY-2026-05-07.md": [
    "Pay.sh / `reddi-x402` sandbox charge compatibility",
    "Pay.sh capped-session and split-payment probes",
    "Umbra private x402 adapter-contract proof",
    "Umbra devnet encrypted-balance deposit proof",
    "Does not prove: mainnet payment, production Umbra private settlement, arbitrary-wallet/private payee MagicBlock PER settlement",
  ],
  "docs/HACKATHON-BOUNTY-SHOWCASE-AUDIT-2026-05-07.md": [
    "x402 + Pay.sh / `reddi-x402`",
    "Umbra is now a strong private-payments adapter-contract lane",
    "Umbra devnet encrypted-balance deposit evidence",
    "sessions/splits are probe-only",
    "not a successful arbitrary-wallet/private payee settlement proof",
  ],
  "docs/COLOSSEUM-FINAL-QUASAR-PROOF-MAP-2026-05-06.md": [
    "Live Quasar-native permission/delegation + bounded MagicBlock TEE agent-vault settlement proof; not an arbitrary-wallet/private payee settlement claim",
    "patched Quasar PER executes inside MagicBlock TEE and restores a Quasar-owned AgentVault to base devnet with withdraw-after-settlement evidence",
    "we do not claim arbitrary-wallet/private payee settlement",
  ],
  "docs/verifiable-agent-protocol/colosseum-frontier-2026-04/NARRATIVE.md": [
    "Quasar-native MagicBlock permission/delegation succeeds live",
    "arbitrary-wallet/private payee lamport settlement is not claimed",
    "We do not claim end-to-end arbitrary-wallet/private payee lamport settlement",
  ],
  "artifacts/economic-demo-submission-prep/latest/SUBMISSION-PREP.md": [
    "Pay.sh / reddi-x402 proves sandbox HTTP 402 → payment → HTTP 200 receipt compatibility",
    "Pay.sh capped sessions and split payments are probe-only extension evidence",
    "Pay.sh evidence proves Umbra private settlement or MagicBlock PER settlement",
    "Umbra private x402 adapter contract evidence proves the dependency-injected receiver-claimable UTXO call path",
    "Umbra devnet encrypted-balance deposit completed",
  ],
};

const forbiddenStaleMagicBlockPatterns = [
  /delegated Quasar (?:program )?(?:execution|image)[^\n]*(?:fails|failed|currently fails)/i,
  /MagicBlock TEE[^\n]*(?:fails|failed) at instruction start/i,
  /settlement is blocked at TEE execution/i,
  /Quasar-on-MagicBlock-TEE execution is blocked/i,
  /TEE execution blocker/i,
  /current MagicBlock TEE authorization proof/i,
  /private authorization proof/i,
  /MagicBlock delegation only,? no PER settlement/i,
  /base-layer vault settlement remain unclaimed/i,
];

const forbiddenSafeClaimPatterns = [
  /successful public Jupiter devnet swap(?![\s\S]{0,120}(?:not|No|without))/i,
  /live\/mainnet Jupiter swap(?![\s\S]{0,120}(?:not|No|without))/i,
  /judge wallet (?:was )?charged/i,
  /mainnet settlement (?:is )?supported/i,
  /Pay\.sh[^\n]*(?:capped-session|capped session|split-payment|split payment)[^\n]*(?:settlement completed|completed settlement|settled)/i,
  /Pay\.sh[^\n]*(?:Umbra private settlement|MagicBlock PER settlement)[^\n]*(?:proves|proved|settled|completed)/i,
];

const SUBMISSION_PREP_LATEST = "artifacts/economic-demo-submission-prep/latest/SUBMISSION-PREP.md";

/**
 * `artifacts/economic-demo-submission-prep/latest` is a generated convenience
 * symlink that is deliberately not committed — only the timestamped run
 * directories are. Resolve the newest committed run rather than requiring an
 * artifact the repository does not contain. See docs/PUBLIC-CLAIM-BOUNDARY.md
 * § Evidence artifacts that are not committed.
 */
function resolveSubmissionPrep() {
  if (existsSync(SUBMISSION_PREP_LATEST)) return SUBMISSION_PREP_LATEST;
  const parent = join("artifacts", "economic-demo-submission-prep");
  if (!existsSync(parent)) return SUBMISSION_PREP_LATEST;
  const newest = readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{8}T\d{6}Z$/.test(entry.name))
    .map((entry) => join(parent, entry.name, "SUBMISSION-PREP.md"))
    .filter((path) => existsSync(path))
    .sort()
    .at(-1);
  return newest ?? SUBMISSION_PREP_LATEST;
}

for (const file of files) {
  const resolved = file === SUBMISSION_PREP_LATEST ? resolveSubmissionPrep() : file;
  if (!existsSync(resolved)) {
    failures.push(`${file}: missing file`);
    continue;
  }
  const text = readFileSync(resolved, "utf8");
  for (const phrase of requiredByFile[file] ?? []) {
    if (!text.includes(phrase)) failures.push(`${file}: missing required boundary phrase: ${phrase}`);
  }
  const safeSection = text.split(/(?:Do not claim|Not safe to say yet|What is explicitly not claimed|Hard no-go list unless Nissan explicitly approves)/i)[0] ?? text;
  for (const pattern of forbiddenSafeClaimPatterns) {
    if (pattern.test(safeSection)) failures.push(`${file}: forbidden overclaim in safe/proven section: ${pattern}`);
  }
  for (const pattern of forbiddenStaleMagicBlockPatterns) {
    if (pattern.test(text)) failures.push(`${file}: stale MagicBlock TEE execution boundary phrase: ${pattern}`);
  }
  for (const [index, line] of safeSection.split(/\r?\n/).entries()) {
    if (/MagicBlock/i.test(line) && /(?:successful PER settlement|settled PER|PER settlement proof)/i.test(line) && !/(?:not|No|without|blocked|weak)/i.test(line)) {
      failures.push(`${file}:${index + 1}: forbidden MagicBlock PER settlement overclaim: ${line.trim()}`);
    }
    if (/Umbra/i.test(line) && /(?:SDK live\/devnet integration is complete|SDK devnet transaction flow is complete|SDK\/devnet private settlement completed|private settlement executed|live private settlement|devnet smoke passed|mainnet settlement completed|production settlement completed|settlement completed)/i.test(line) && !/(?:not|No|without|planned|current evidence|does not prove|not executed|not claimed)/i.test(line)) {
      failures.push(`${file}:${index + 1}: forbidden Umbra execution overclaim: ${line.trim()}`);
    }
  }
}

if (failures.length) {
  console.error("[submission-claim-boundaries] FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[submission-claim-boundaries] OK: checked ${files.length} file(s)`);
