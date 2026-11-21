import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { applyPlannerFeedback } from "@/lib/onboarding/specialist-index";
import { listPlannerRuns } from "@/lib/onboarding/planner-execution";

export type PlannerFeedbackInput = {
  runId: string;
  score: number;
  agreesWithAttestation?: boolean;
  notes?: string;
};

export type PlannerFeedbackRecord = {
  id: string;
  runId: string;
  walletAddress: string;
  score: number;
  agreesWithAttestation?: boolean;
  notes?: string;
  createdAt: string;
  reputationCommit?: {
    ok: boolean;
    txSignature?: string;
    commitHash?: string;
    ratingPda?: string;
    error?: string;
  };
};

const FEEDBACK_PATH = join(process.cwd(), "data", "onboarding", "planner-feedback.json");

function readAll(): PlannerFeedbackRecord[] {
  try {
    return JSON.parse(readFileSync(FEEDBACK_PATH, "utf8")) as PlannerFeedbackRecord[];
  } catch {
    return [];
  }
}

function writeAll(records: PlannerFeedbackRecord[]) {
  mkdirSync(join(process.cwd(), "data", "onboarding"), { recursive: true });
  writeFileSync(FEEDBACK_PATH, JSON.stringify(records, null, 2));
}

export async function recordPlannerFeedback(input: PlannerFeedbackInput) {
  if (!input.runId?.trim()) {
    throw new Error("runId is required.");
  }
  if (!Number.isFinite(input.score) || input.score < 1 || input.score > 10) {
    throw new Error("score must be between 1 and 10.");
  }

  const { results } = listPlannerRuns();
  const run = results.find((r) => r.runId === input.runId);
  if (!run) {
    throw new Error("planner run not found.");
  }
  if (!run.selectedWallet) {
    throw new Error("planner run does not have selected wallet metadata.");
  }

  const record: PlannerFeedbackRecord = {
    id: `pf_${Date.now().toString(36)}`,
    runId: input.runId,
    walletAddress: run.selectedWallet,
    score: input.score,
    agreesWithAttestation: input.agreesWithAttestation,
    notes: input.notes?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };

  const records = readAll();
  records.push(record);
  writeAll(records);

  const indexUpdate = applyPlannerFeedback(run.selectedWallet, {
    score: input.score,
    agreesWithAttestation: input.agreesWithAttestation,
    at: record.createdAt,
  });

  // Off-chain only. On-chain ratings are made by the buyer's own wallet, for a job paid through an
  // escrow the buyer opted in to rating (components/rating, #842); nothing here signs or sends.
  return {
    ok: true,
    record,
    indexUpdate,
    /** Always undefined now: kept so callers that report it (the MCP signal tool) say "not committed". */
    reputationCommit: undefined as PlannerFeedbackRecord["reputationCommit"],
    storagePath: FEEDBACK_PATH,
  };
}

export function listPlannerFeedback() {
  return {
    ok: true,
    results: readAll(),
    storagePath: FEEDBACK_PATH,
  };
}
