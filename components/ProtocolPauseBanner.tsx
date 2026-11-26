"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { readPauseStatus } from "@redditech/x402-solana/pause";
import { LimitNotice } from "@/components/ui/limit-notice";
import { ESCROW_PROGRAM_ID } from "@/lib/program";
import { pauseNotice, type PauseNotice } from "@/lib/pause/banner";

/** How often an open page looks again. */
const REFRESH_MS = 300_000;

/**
 * Shows on every page while the program is paused: new payments and payouts to
 * providers are on hold, refunds still work. Reads the pause account once on
 * load and every five minutes; says nothing when it cannot read it.
 */
export default function ProtocolPauseBanner() {
  const { connection } = useConnection();
  const [notice, setNotice] = useState<PauseNotice | null>(null);

  useEffect(() => {
    let live = true;
    const look = () =>
      readPauseStatus(connection, ESCROW_PROGRAM_ID)
        .then((status) => {
          if (live) setNotice(pauseNotice(status));
        })
        .catch(() => {
          // An RPC hiccup is not a pause: keep what was shown.
        });
    void look();
    const timer = setInterval(look, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [connection]);

  if (!notice) return null;
  return (
    <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8" data-testid="protocol-pause-banner" role="status">
      <LimitNotice tone="warning" title={notice.title} className="text-xs sm:text-sm">
        {notice.body}
      </LimitNotice>
    </div>
  );
}
