"use client";

import { useEffect, useState } from "react";
import { LimitNotice } from "@/components/ui/limit-notice";
import { pauseNotice, readPauseStatusBody, type PauseNotice } from "@/lib/pause/banner";

/** How often an open page looks again. */
const REFRESH_MS = 300_000;

/**
 * Shows on every page while the program is paused: new payments and payouts to
 * providers are on hold, refunds still work. Asks this app's /api/pause-status
 * (one cached chain read for everyone) on load and every five minutes; says
 * nothing when it cannot tell.
 */
export default function ProtocolPauseBanner() {
  const [notice, setNotice] = useState<PauseNotice | null>(null);

  useEffect(() => {
    let live = true;
    const look = () =>
      fetch("/api/pause-status")
        .then((response) => (response.ok ? response.json() : null))
        .then((body: unknown) => {
          if (live) setNotice(pauseNotice(readPauseStatusBody(body)));
        })
        .catch(() => {
          // A failed read is not a pause: keep what was shown.
        });
    void look();
    const timer = setInterval(look, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (!notice) return null;
  return (
    <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8" data-testid="protocol-pause-banner" role="status">
      <LimitNotice tone="warning" title={notice.title} className="text-xs sm:text-sm">
        {notice.body}
      </LimitNotice>
    </div>
  );
}
