/**
 * Sandbox reputation: a running average a visitor can watch move.
 *
 * It is a teaching model kept in the visitor's own browser tab, seeded from the
 * catalog. It is not the on-chain reputation program and nothing is written to
 * a chain or a database.
 */
import type { SandboxProvider } from "./catalog";

export type SandboxReputation = { score: number; receipts: number };

export type SandboxReputationEvent = {
  /** The receipt verified against the request and answer the buyer holds. */
  receiptVerified: boolean;
  /** The simulated attestor spot check passed. */
  spotCheckPassed: boolean;
};

export const SANDBOX_RATING_GOOD = 5;
export const SANDBOX_RATING_BAD = 1;

export function sandboxRatingFor(event: SandboxReputationEvent): number {
  return event.receiptVerified && event.spotCheckPassed ? SANDBOX_RATING_GOOD : SANDBOX_RATING_BAD;
}

/** Folds one rated call into the running average, rounded to two decimals. */
export function applySandboxReputation(current: SandboxReputation, event: SandboxReputationEvent): SandboxReputation {
  return applySandboxRating(current, sandboxRatingFor(event));
}

/** Folds a buyer's own 1 to 5 star rating of one receipted call into the running average. */
export function applySandboxRating(current: SandboxReputation, stars: number): SandboxReputation {
  const clamped = Math.min(SANDBOX_RATING_GOOD, Math.max(SANDBOX_RATING_BAD, Math.round(stars)));
  const receipts = current.receipts + 1;
  const score = (current.score * current.receipts + clamped) / receipts;
  return { score: Math.round(score * 100) / 100, receipts };
}

export function initialSandboxReputation(providers: readonly SandboxProvider[]): Record<string, SandboxReputation> {
  return Object.fromEntries(providers.map((provider) => [provider.id, { ...provider.reputation }]));
}
