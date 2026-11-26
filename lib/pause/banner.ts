/**
 * What the app tells people while the Reddi Agent Protocol program is paused
 * (docs/EMERGENCY-PAUSE-RUNBOOK.md). Pure, so the banner and the tests share it.
 */
import { PAUSED_MESSAGE, type PauseStatus } from "@redditech/x402-solana/pause";

/** About 400 ms a slot, as the program counts its windows. */
const SLOT_SECONDS = 0.4;

export interface PauseNotice {
  title: string;
  body: string;
}

/**
 * The notice for a pause status, or null when there is nothing to say.
 *
 * A pause account that does not exist yet says nothing here: that only happens
 * between a deploy and its `init_pause`, an operator's window, and the program
 * already refuses the calls it would gate.
 */
export function pauseNotice(status: Pick<PauseStatus, "paused" | "missing" | "pausedUntilSlot" | "slot"> | null): PauseNotice | null {
  if (!status || status.missing || !status.paused) return null;
  const slotsLeft = status.pausedUntilSlot > status.slot ? status.pausedUntilSlot - status.slot : BigInt(0);
  const hours = Math.max(1, Math.ceil((Number(slotsLeft) * SLOT_SECONDS) / 3600));
  const until = hours >= 48 ? `about ${Math.round(hours / 24)} days` : `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
  return {
    title: "Payments are paused.",
    body: `${PAUSED_MESSAGE} The pause ends in ${until} at the latest, sooner once the fix is in.`,
  };
}
