/**
 * What a party can do with a job's rating, worked out from the on-chain rating
 * account and the current slot (#842). Pure: no RPC, no storage, no clock.
 *
 * The rules are the program's (programs/pinocchio-escrow/README.md, "Ratings
 * and attestations"): commit within RATING_COMMIT_SLOTS of the paid
 * settlement, reveal within RATING_REVEAL_SLOTS of the second commitment, a
 * deadline includes its last slot, anyone may expire from the slot after, and
 * only the consumer closes a final rating.
 */
import { RATING_COMMIT_SLOTS, RATING_REVEAL_SLOTS, payerReleaseOpensRating, type RatingAccount } from "@redditech/x402-solana/rating";

/** Rent of a rating account (270 bytes), paid by the buyer at opt-in and returned when the rating is closed. */
export const RATING_RENT_LAMPORTS = 2_021_840n;
/** The rent as SOL, for display: 0.00202184. */
export const RATING_RENT_SOL = "0.00202";
/** What a slot is assumed to last when a deadline is shown as a date. Slots are not exact, so dates are estimates. */
export const ASSUMED_SLOT_MS = 400;
/** Reputation points are stored as 0..10000 and shown as 0.00..100.00. A missed step costs 5.00. */
export const MISSED_STEP_PENALTY_POINTS = "5.00";

export type RatingRole = "buyer" | "seller" | "other";

export type RatingPhase =
  /** No rating account: never opted in, refunded, released before the seller agreed, or already closed. */
  | "none"
  /** Opted in, escrow not paid yet. */
  | "awaiting_payment"
  /** Paid. Each party commits a hidden score. */
  | "commit"
  /** Both committed. Each party reveals. */
  | "reveal"
  /** Both revealed. Final. */
  | "revealed"
  /** A deadline passed and the rating was expired. Final. */
  | "expired";

export type ExpiredOutcome = "nobody_committed" | "buyer_silent" | "seller_silent" | "nobody_revealed" | "buyer_withheld" | "seller_withheld";

export interface RatingView {
  phase: RatingPhase;
  role: RatingRole;
  /** The seller called `accept_rating`. Only meaningful before payment. */
  accepted: boolean;
  /** Before payment: a release by the buyer now would open the rating. False means it would pay and close the job unrated. */
  releaseOpensRating: boolean;
  /** The last slot in which the current phase's step is accepted. Undefined outside the commit and reveal phases. */
  deadlineSlot?: bigint;
  deadlinePassed: boolean;
  buyerCommitted: boolean;
  sellerCommitted: boolean;
  buyerRevealed: boolean;
  sellerRevealed: boolean;
  /** The viewer's own steps, when the viewer is a party. */
  youCommitted: boolean;
  youRevealed: boolean;
  can: {
    commit: boolean;
    reveal: boolean;
    /** Anyone may expire once the deadline has passed. */
    expire: boolean;
    /** Only the buyer, once final: closes the account and returns the rent. */
    close: boolean;
  };
  /** Why the viewer cannot reveal although it is their turn. */
  revealBlocked?: "salt_missing";
  /** Final scores (1 to 10), once revealed. */
  buyerScore?: number;
  sellerScore?: number;
  expiredOutcome?: ExpiredOutcome;
}

export function ratingRole(rating: Pick<RatingAccount, "consumer" | "specialist">, viewer: string | undefined): RatingRole {
  if (!viewer) return "other";
  if (rating.consumer.toBase58() === viewer) return "buyer";
  if (rating.specialist.toBase58() === viewer) return "seller";
  return "other";
}

function expiredOutcome(rating: RatingAccount): ExpiredOutcome {
  const buyer = rating.consumerCommitment !== undefined;
  const seller = rating.specialistCommitment !== undefined;
  if (!buyer && !seller) return "nobody_committed";
  if (buyer && !seller) return "seller_silent";
  if (!buyer && seller) return "buyer_silent";
  const buyerRevealed = rating.consumerScore !== undefined;
  const sellerRevealed = rating.specialistScore !== undefined;
  if (buyerRevealed && !sellerRevealed) return "seller_withheld";
  if (!buyerRevealed && sellerRevealed) return "buyer_withheld";
  return "nobody_revealed";
}

const NONE: RatingView = {
  phase: "none",
  role: "other",
  accepted: false,
  releaseOpensRating: false,
  deadlinePassed: false,
  buyerCommitted: false,
  sellerCommitted: false,
  buyerRevealed: false,
  sellerRevealed: false,
  youCommitted: false,
  youRevealed: false,
  can: { commit: false, reveal: false, expire: false, close: false },
};

export interface RatingViewContext {
  currentSlot: bigint;
  /** The connected wallet, base58. */
  viewer?: string;
  /** The viewer's score and salt for this rating are stored in this browser and match the commitment on chain. */
  hasSecret: boolean;
}

export function ratingView(rating: RatingAccount | undefined, context: RatingViewContext): RatingView {
  if (!rating) return NONE;
  const role = ratingRole(rating, context.viewer);
  const party = role !== "other";
  const buyerCommitted = rating.consumerCommitment !== undefined;
  const sellerCommitted = rating.specialistCommitment !== undefined;
  const buyerRevealed = rating.consumerScore !== undefined;
  const sellerRevealed = rating.specialistScore !== undefined;
  const youCommitted = role === "buyer" ? buyerCommitted : role === "seller" ? sellerCommitted : false;
  const youRevealed = role === "buyer" ? buyerRevealed : role === "seller" ? sellerRevealed : false;
  const base = { role, accepted: rating.accepted, releaseOpensRating: false, buyerCommitted, sellerCommitted, buyerRevealed, sellerRevealed, youCommitted, youRevealed };
  const none = { commit: false, reveal: false, expire: false, close: false };

  switch (rating.state) {
    case "awaiting_settlement":
      return { ...base, phase: "awaiting_payment", releaseOpensRating: payerReleaseOpensRating(rating), deadlinePassed: false, can: none };
    case "open": {
      const deadlineSlot = rating.settledSlot + RATING_COMMIT_SLOTS;
      const deadlinePassed = context.currentSlot > deadlineSlot;
      return { ...base, phase: "commit", deadlineSlot, deadlinePassed, can: { ...none, commit: party && !youCommitted && !deadlinePassed, expire: deadlinePassed } };
    }
    case "both_committed": {
      const deadlineSlot = rating.committedSlot + RATING_REVEAL_SLOTS;
      const deadlinePassed = context.currentSlot > deadlineSlot;
      const yourTurn = party && !youRevealed && !deadlinePassed;
      return {
        ...base,
        phase: "reveal",
        deadlineSlot,
        deadlinePassed,
        can: { ...none, reveal: yourTurn && context.hasSecret, expire: deadlinePassed },
        ...(yourTurn && !context.hasSecret ? { revealBlocked: "salt_missing" as const } : {}),
      };
    }
    case "revealed":
      return { ...base, phase: "revealed", deadlinePassed: false, can: { ...none, close: role === "buyer" }, buyerScore: rating.consumerScore, sellerScore: rating.specialistScore };
    case "expired":
      return {
        ...base,
        phase: "expired",
        deadlinePassed: true,
        can: { ...none, close: role === "buyer" },
        buyerScore: rating.consumerScore,
        sellerScore: rating.specialistScore,
        expiredOutcome: expiredOutcome(rating),
      };
  }
}

/**
 * When a slot is expected, given the slot now and the time now. An estimate:
 * slots are assumed to last ASSUMED_SLOT_MS, and the real pace varies.
 */
export function estimatedSlotDate(targetSlot: bigint, currentSlot: bigint, nowMs: number): Date {
  return new Date(nowMs + Number(targetSlot - currentSlot) * ASSUMED_SLOT_MS);
}

/** "in 6 days", "in 3 hours", "in 12 minutes", or "passed". */
export function timeLeftLabel(targetSlot: bigint, currentSlot: bigint): string {
  if (currentSlot > targetSlot) return "passed";
  const minutes = Math.floor((Number(targetSlot - currentSlot) * ASSUMED_SLOT_MS) / 60_000);
  if (minutes < 1) return "in under a minute";
  if (minutes < 120) return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in about ${hours} hours`;
  return `in about ${Math.floor(hours / 24)} days`;
}

/** Plain words for how an expired rating ended, from the viewer's side. */
export function expiredOutcomeText(outcome: ExpiredOutcome, role: RatingRole): string {
  const who = (side: "buyer" | "seller") => (role === side ? "You" : side === "buyer" ? "The buyer" : "The provider");
  switch (outcome) {
    case "nobody_committed":
      return "Neither side committed a score before the deadline. No reputation changed.";
    case "nobody_revealed":
      return "Both sides committed but neither revealed before the deadline. No reputation changed.";
    case "buyer_silent":
    case "seller_silent": {
      const silent = outcome === "buyer_silent" ? "buyer" : "seller";
      return `${who(silent)} did not commit a score before the deadline and lost ${MISSED_STEP_PENALTY_POINTS} reputation points, with one failed job recorded.`;
    }
    case "buyer_withheld":
    case "seller_withheld": {
      const withheld = outcome === "buyer_withheld" ? "buyer" : "seller";
      return `${who(withheld)} committed but did not reveal before the deadline and lost ${MISSED_STEP_PENALTY_POINTS} reputation points. The score the other side revealed was counted.`;
    }
  }
}
