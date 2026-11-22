"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, type Connection } from "@solana/web3.js";

import { JobRatingPanelView, type RatingBusy } from "@/components/rating/JobRatingPanelView";
import { describeAttestationResolutionRefusal } from "@/lib/onboarding/attestation-resolution";
import { ESCROW_PROGRAM_ID } from "@/lib/program";
import {
  closeJobRating,
  commitJobRating,
  expireJobRating,
  readJobRating,
  resolveJobAttestation,
  revealJobRating,
  snapshotView,
  type JobRatingSnapshot,
  type RatingConnection,
  type RatingStepDeps,
  type RatingStepResult,
} from "@/lib/rating/job-rating";
import { browserRatingStorage, findRatedJob, importRatingBackup, ratingBackupFile, secretForJob } from "@/lib/rating/rating-secrets";

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; snapshot: JobRatingSnapshot };

const DONE_TEXT: Record<RatingBusy, string> = {
  commit: "Your score is submitted and hidden. Download the salt backup now and keep it private.",
  reveal: "Your score is revealed.",
  expire: "The rating was expired and now has its final result.",
  close: "The rating was closed and the rent returned to your wallet.",
  confirm: "You confirmed the attestation.",
  dispute: "You disputed the attestation.",
};

/**
 * One job's rating, read from its on-chain rating account, with the steps the
 * connected wallet can take. Every step is signed by that wallet in the
 * browser; nothing is sent to an app server.
 *
 * Renders nothing for a job that has no rating account unless `showWhenNone`
 * is set, so jobs paid without rating get no rating controls.
 */
export function JobRatingPanel({
  escrow,
  programId = ESCROW_PROGRAM_ID,
  showWhenNone = false,
  connection: givenConnection,
}: {
  escrow: string;
  programId?: PublicKey;
  showWhenNone?: boolean;
  /** The cluster the job is on, when it is not the app's own (the sandbox is always devnet). */
  connection?: Connection;
}) {
  const { connection: appConnection } = useConnection();
  const connection = givenConnection ?? appConnection;
  const { publicKey, sendTransaction } = useWallet();
  const wallet = publicKey?.toBase58();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState<RatingBusy | undefined>();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | undefined>();
  // Bumped when the stored secret changes, so the view re-reads storage.
  const [storageVersion, setStorageVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const escrowKey = useMemo(() => {
    try {
      return new PublicKey(escrow);
    } catch {
      return undefined;
    }
  }, [escrow]);
  const chain = connection as unknown as RatingConnection;

  const refresh = useCallback(async () => {
    if (!escrowKey) {
      setLoaded({ state: "error", message: "That is not a valid escrow address." });
      return;
    }
    try {
      setLoaded({ state: "ready", snapshot: await readJobRating(chain, escrowKey, programId) });
    } catch {
      setLoaded({ state: "error", message: "The rating could not be read from the network." });
    }
  }, [chain, escrowKey, programId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!escrowKey) {
        if (!cancelled) setLoaded({ state: "error", message: "That is not a valid escrow address." });
        return;
      }
      try {
        const snapshot = await readJobRating(chain, escrowKey, programId);
        if (!cancelled) setLoaded({ state: "ready", snapshot });
      } catch {
        if (!cancelled) setLoaded({ state: "error", message: "The rating could not be read from the network." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chain, escrowKey, programId]);

  const storage = browserRatingStorage();
  const snapshot = loaded.state === "ready" ? loaded.snapshot : undefined;
  const view = useMemo(
    () => (snapshot ? snapshotView(snapshot, wallet, browserRatingStorage()) : undefined),
    // storageVersion: the stored secret is read inside snapshotView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, wallet, storageVersion],
  );
  const record = wallet && storage ? findRatedJob(storage, wallet, escrow) : undefined;

  async function run(step: RatingBusy, action: (deps: RatingStepDeps<RatingConnection>) => Promise<RatingStepResult>) {
    if (!publicKey || !sendTransaction || !escrowKey) {
      setNotice({ tone: "error", text: "Connect the wallet that paid for this job." });
      return;
    }
    setBusy(step);
    setNotice(undefined);
    try {
      // The job shown: a step is refused if the rating at this escrow is by then another job's.
      const expectedOpenedSlot = snapshot?.rating?.openedSlot;
      const result = await action({ connection: chain, wallet: { publicKey, sendTransaction: sendTransaction as unknown as RatingStepDeps<RatingConnection>["wallet"]["sendTransaction"] }, programId, escrow: escrowKey, expectedOpenedSlot });
      setStorageVersion((version) => version + 1);
      setNotice(result.ok ? { tone: "ok", text: DONE_TEXT[step] } : { tone: "error", text: result.message });
      if (result.ok || result.signed) await refresh();
    } finally {
      setBusy(undefined);
    }
  }

  function downloadBackup() {
    const file = record ? ratingBackupFile(record) : undefined;
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup(file: File | undefined) {
    if (!file || !wallet || !storage) return;
    const result = importRatingBackup(storage, wallet, await file.text());
    setStorageVersion((version) => version + 1);
    const thisJob = result.ok && result.record.escrow === escrow && snapshot?.rating !== undefined && secretForJob(result.record, snapshot.rating.openedSlot) !== undefined;
    setNotice(result.ok ? { tone: "ok", text: thisJob ? "Backup imported. You can reveal now." : "Backup imported, but it is for a different job." } : { tone: "error", text: result.message });
  }

  if (loaded.state === "loading") return <div className="h-24 animate-pulse rounded-xl bg-well" aria-busy="true" data-testid="job-rating-loading" />;
  if (loaded.state === "error") {
    return (
      <div className="rounded-xl border border-line bg-paper p-4 text-sm text-ink" role="alert">
        {loaded.message}{" "}
        <button type="button" className="text-brand-violet hover:opacity-80" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  }
  if (!snapshot || !view) return null;
  if (view.phase === "none" && !showWhenNone) return null;

  const refusal = describeAttestationResolutionRefusal();
  return (
    <>
      <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importBackup(event.target.files?.[0])} />
      <JobRatingPanelView
        escrow={escrow}
        rating={snapshot.rating}
        attestation={snapshot.attestation}
        view={view}
        currentSlot={snapshot.currentSlot}
        readAtMs={snapshot.readAtMs}
        score={score}
        onScoreChange={setScore}
        backupAvailable={snapshot.rating !== undefined && secretForJob(record, snapshot.rating.openedSlot) !== undefined}
        busy={busy}
        notice={notice}
        onRefresh={() => void refresh()}
        onCommit={() => void run("commit", (deps) => commitJobRating({ ...deps, storage, score }))}
        onReveal={() => void run("reveal", (deps) => revealJobRating({ ...deps, storage }))}
        onExpire={() => void run("expire", expireJobRating)}
        onClose={() => void run("close", closeJobRating)}
        onDownloadBackup={downloadBackup}
        onImportBackup={() => fileInput.current?.click()}
        onResolveAttestation={(action) => {
          if (refusal) {
            setNotice({ tone: "error", text: refusal });
            return;
          }
          void run(action, (deps) => resolveJobAttestation({ ...deps, action }));
        }}
      />
    </>
  );
}
