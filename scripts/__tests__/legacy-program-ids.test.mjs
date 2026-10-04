import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const { resolveLegacyAnchorProgramIds } = await import("../../lib/config/legacy-program-ids.ts");
const { validateBrowserWalletApprovalRecord } = await import("../../packages/agent-protocol/dist/browser-wallet-approval.js");
const devnet = JSON.parse(readFileSync(new URL("../../config/networks/devnet.json", import.meta.url), "utf8"));
const approval = JSON.parse(readFileSync(new URL("../fixtures/browser-wallet-devnet-approval/approval.valid.json", import.meta.url), "utf8"));
const DISTINCT_PROGRAM = "So11111111111111111111111111111111111111112";

test("committed Devnet profile aliases all legacy roles through escrow", () => {
  const resolved = resolveLegacyAnchorProgramIds(devnet.programs);
  assert.deepEqual(resolved, {
    escrow: devnet.programs.escrowProgramId,
    registry: devnet.programs.escrowProgramId,
    reputation: devnet.programs.escrowProgramId,
    attestation: devnet.programs.escrowProgramId,
  });
});

test("actual approval validator accepts authoritative alias context and refuses changed role identity", () => {
  const aliased = resolveLegacyAnchorProgramIds(devnet.programs);
  const options = {
    now: "2026-09-03T12:30:00.000Z",
    trustedDevnetProgramIds: aliased,
    trustedDevnetRpcEndpoints: {
      rpcHttp: devnet.solana.rpcHttp,
      rpcWs: devnet.solana.rpcWs,
    },
  };
  assert.equal(validateBrowserWalletApprovalRecord(approval, options).ok, true);

  const changed = resolveLegacyAnchorProgramIds({ ...devnet.programs, registryProgramId: DISTINCT_PROGRAM });
  const refused = validateBrowserWalletApprovalRecord(approval, { ...options, trustedDevnetProgramIds: changed });
  assert.equal(refused.ok, false);
  assert.ok(refused.errors.some((entry) =>
    entry.code === "non_canonical_browser_wallet_identity" && entry.path === "$.programs.ids.registry"));
});

test("explicit non-Devnet role IDs remain distinct and cannot equal stale alias trust context", () => {
  const aliased = resolveLegacyAnchorProgramIds(devnet.programs);
  const distinct = resolveLegacyAnchorProgramIds({
    ...devnet.programs,
    registryProgramId: DISTINCT_PROGRAM,
    reputationProgramId: DISTINCT_PROGRAM,
    attestationProgramId: DISTINCT_PROGRAM,
  });
  assert.equal(distinct.registry, DISTINCT_PROGRAM);
  assert.equal(distinct.reputation, DISTINCT_PROGRAM);
  assert.equal(distinct.attestation, DISTINCT_PROGRAM);
  assert.notDeepEqual(distinct, aliased);
});
