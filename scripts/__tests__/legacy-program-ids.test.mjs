import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const { resolveLegacyAnchorProgramIds } = await import("../../lib/config/legacy-program-ids.ts");
const devnet = JSON.parse(readFileSync(new URL("../../config/networks/devnet.json", import.meta.url), "utf8"));
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

