"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { JobRatingPanel } from "@/components/rating/JobRatingPanel";
import { Button } from "@/components/ui/button";
import { ESCROW_PROGRAM_ID } from "@/lib/program";
import { browserRatingStorage, importRatingBackup, listRatedJobs, rememberRatedJob, type RatedJobRecord } from "@/lib/rating/rating-secrets";

function isAddress(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

/**
 * The connected wallet's rated jobs, each with its rating panel. The list is
 * kept in this browser (it is where the salts are); a job from another
 * browser can be added by its escrow address or by importing its backup file.
 */
export function RatedJobsList() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58();
  const [jobs, setJobs] = useState<RatedJobRecord[]>([]);
  const [lookup, setLookup] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const storage = browserRatingStorage();
    // Reads browser storage, which exists only after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobs(wallet && storage ? listRatedJobs(storage, wallet) : []);
  }, [wallet]);

  function addByEscrow() {
    const storage = browserRatingStorage();
    const escrow = lookup.trim();
    if (!wallet || !storage) return;
    if (!isAddress(escrow)) {
      setNote("That is not a valid escrow address.");
      return;
    }
    try {
      rememberRatedJob(storage, { wallet, escrow, programId: ESCROW_PROGRAM_ID.toBase58(), openedAt: new Date().toISOString() });
      setJobs(listRatedJobs(storage, wallet));
      setLookup("");
      setNote(null);
    } catch {
      setNote("This browser could not store the job.");
    }
  }

  async function importBackup(file: File | undefined) {
    const storage = browserRatingStorage();
    if (!file || !wallet || !storage) return;
    const result = importRatingBackup(storage, wallet, await file.text());
    setNote(result.ok ? "Backup imported." : result.message);
    if (result.ok) setJobs(listRatedJobs(storage, wallet));
  }

  if (!wallet) {
    return (
      <p className="text-sm text-gray-400" data-testid="rated-jobs-connect">
        Connect the wallet you paid with to see the jobs you opted in to rating.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="rated-jobs">
      {jobs.length === 0 ? (
        <p className="text-sm text-gray-400" data-testid="rated-jobs-empty">
          No rated jobs are stored in this browser for this wallet. A job appears here when you pay with &quot;Rate this job&quot; turned on. Jobs paid without rating have nothing to rate.
        </p>
      ) : (
        <ul className="space-y-4">
          {jobs.map((job) => (
            <li key={job.escrow} className="space-y-2">
              {job.label ? <p className="text-sm text-white">{job.label}</p> : null}
              <JobRatingPanel escrow={job.escrow} programId={new PublicKey(job.programId)} showWhenNone />
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
        <summary className="cursor-pointer text-gray-200">Rated a job in another browser?</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-5 text-gray-400">
            Add the job by its escrow address to see its state. To reveal a score you submitted elsewhere you also need the salt: import the backup file you downloaded there.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-border bg-page px-3 py-2 font-mono text-xs text-white"
              placeholder="Escrow address"
              aria-label="Escrow address"
              value={lookup}
              onChange={(event) => setLookup(event.target.value)}
            />
            <Button size="sm" variant="outline" onClick={addByEscrow}>
              Add job
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
              Import backup file
            </Button>
            <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importBackup(event.target.files?.[0])} />
          </div>
          {note ? (
            <p className="text-xs text-gray-300" role="status">
              {note}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}
