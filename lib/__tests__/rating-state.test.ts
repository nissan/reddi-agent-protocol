import { Keypair } from "@solana/web3.js";
import { decodeRatingAccount, RATING_COMMIT_SLOTS, RATING_REVEAL_SLOTS } from "@redditech/x402-solana/rating";
import { encodeRatingAccount, type RatingFixture } from "@/lib/rating/testing/fixtures";
import { estimatedSlotDate, expiredOutcomeText, ratingView, timeLeftLabel } from "@/lib/rating/rating-state";

const escrow = Keypair.generate().publicKey;
const consumer = Keypair.generate().publicKey;
const specialist = Keypair.generate().publicKey;
const BUYER = consumer.toBase58();
const SELLER = specialist.toBase58();
const C = new Uint8Array(32).fill(1);
const S = new Uint8Array(32).fill(2);

const rating = (fixture: Partial<RatingFixture> & Pick<RatingFixture, "state">) => decodeRatingAccount(encodeRatingAccount({ escrow, consumer, specialist, ...fixture }));
const view = (fixture: Parameters<typeof rating>[0], currentSlot: bigint, viewer: string | undefined = BUYER, hasSecret = true) => ratingView(rating(fixture), { currentSlot, viewer, hasSecret });

describe("rating view (#842)", () => {
  it("has nothing to do for a job with no rating account", () => {
    expect(ratingView(undefined, { currentSlot: 5n, viewer: BUYER, hasSecret: false })).toMatchObject({ phase: "none", can: { commit: false, reveal: false, expire: false, close: false } });
  });

  it("before payment: shows whether the seller agreed, and whether a buyer release would open the rating", () => {
    expect(view({ state: "awaiting_settlement" }, 10n)).toMatchObject({ phase: "awaiting_payment", accepted: false, releaseOpensRating: false, can: { commit: false, expire: false } });
    expect(view({ state: "awaiting_settlement", accepted: true }, 10n)).toMatchObject({ accepted: true, releaseOpensRating: true });
  });

  it("commit phase: either party may commit once, until the deadline's last slot", () => {
    const settledSlot = 1_000n;
    const deadline = settledSlot + RATING_COMMIT_SLOTS;
    expect(view({ state: "open", settledSlot }, settledSlot)).toMatchObject({ phase: "commit", role: "buyer", deadlineSlot: deadline, deadlinePassed: false, can: { commit: true, reveal: false, expire: false, close: false } });
    expect(view({ state: "open", settledSlot }, settledSlot, SELLER).can.commit).toBe(true);
    // The deadline includes its last slot; expiry opens the slot after.
    expect(view({ state: "open", settledSlot }, deadline).can).toMatchObject({ commit: true, expire: false });
    expect(view({ state: "open", settledSlot }, deadline + 1n)).toMatchObject({ deadlinePassed: true, can: { commit: false, expire: true } });
    // Already committed: nothing more to do but wait.
    expect(view({ state: "open", settledSlot, consumerCommitment: C }, settledSlot)).toMatchObject({ youCommitted: true, buyerCommitted: true, sellerCommitted: false, can: { commit: false } });
    expect(view({ state: "open", settledSlot, consumerCommitment: C }, settledSlot, SELLER)).toMatchObject({ youCommitted: false, can: { commit: true } });
  });

  it("a wallet that is neither party can only expire", () => {
    const stranger = Keypair.generate().publicKey.toBase58();
    expect(view({ state: "open", settledSlot: 1n }, 2n, stranger)).toMatchObject({ role: "other", can: { commit: false, expire: false } });
    expect(view({ state: "open", settledSlot: 1n }, 2n + RATING_COMMIT_SLOTS, stranger).can).toMatchObject({ commit: false, expire: true });
    // No wallet connected (a default parameter would turn `undefined` into the buyer, so call ratingView directly).
    expect(ratingView(rating({ state: "open", settledSlot: 1n }), { currentSlot: 2n, viewer: undefined, hasSecret: false }).role).toBe("other");
  });

  it("reveal phase: counted from the second commitment, and needs the stored salt", () => {
    const committedSlot = 50_000n;
    const both = { state: "both_committed" as const, settledSlot: 1_000n, committedSlot, consumerCommitment: C, specialistCommitment: S };
    const deadline = committedSlot + RATING_REVEAL_SLOTS;
    expect(view(both, committedSlot)).toMatchObject({ phase: "reveal", deadlineSlot: deadline, can: { commit: false, reveal: true, expire: false } });
    const noSalt = view(both, committedSlot, BUYER, false);
    expect(noSalt.can.reveal).toBe(false);
    expect(noSalt.revealBlocked).toBe("salt_missing");
    expect(view(both, deadline).can.reveal).toBe(true);
    const late = view(both, deadline + 1n);
    expect(late).toMatchObject({ deadlinePassed: true, can: { reveal: false, expire: true } });
    expect(late.revealBlocked).toBeUndefined();
    // The buyer has revealed and waits for the seller.
    expect(view({ ...both, consumerScore: 9 }, committedSlot)).toMatchObject({ youRevealed: true, buyerRevealed: true, sellerRevealed: false, can: { reveal: false } });
    expect(view({ ...both, consumerScore: 9 }, committedSlot, SELLER).can.reveal).toBe(true);
  });

  it("final: only the buyer reclaims the rent", () => {
    const done = { state: "revealed" as const, consumerCommitment: C, specialistCommitment: S, consumerScore: 9, specialistScore: 10 };
    expect(view(done, 9n)).toMatchObject({ phase: "revealed", buyerScore: 9, sellerScore: 10, can: { commit: false, reveal: false, expire: false, close: true } });
    expect(view(done, 9n, SELLER).can.close).toBe(false);
    expect(view({ state: "expired" }, 9n).can).toMatchObject({ close: true, expire: false });
  });

  it.each([
    [{}, "nobody_committed"],
    [{ consumerCommitment: C }, "seller_silent"],
    [{ specialistCommitment: S }, "buyer_silent"],
    [{ consumerCommitment: C, specialistCommitment: S }, "nobody_revealed"],
    [{ consumerCommitment: C, specialistCommitment: S, consumerScore: 7 }, "seller_withheld"],
    [{ consumerCommitment: C, specialistCommitment: S, specialistScore: 7 }, "buyer_withheld"],
  ] as const)("expired %j ended as %s", (fixture, outcome) => {
    expect(view({ state: "expired", ...fixture }, 9n).expiredOutcome).toBe(outcome);
  });

  it("words an expiry from the viewer's side", () => {
    expect(expiredOutcomeText("buyer_silent", "buyer")).toMatch(/^You did not commit .* lost 5\.00 reputation points/);
    expect(expiredOutcomeText("seller_withheld", "buyer")).toMatch(/^The provider committed but did not reveal/);
    expect(expiredOutcomeText("nobody_committed", "other")).toMatch(/No reputation changed/);
  });
});

describe("deadline maths (#842)", () => {
  it("turns a slot into an estimated date at 400 ms per slot", () => {
    const now = Date.UTC(2026, 10, 21, 0, 0, 0);
    // The whole commit window: 1,512,000 slots is exactly 7 days.
    expect(estimatedSlotDate(100n + RATING_COMMIT_SLOTS, 100n, now).toISOString()).toBe("2026-11-28T00:00:00.000Z");
    expect(estimatedSlotDate(100n, 100n, now).getTime()).toBe(now);
    expect(estimatedSlotDate(100n, 250n, now).getTime()).toBe(now - 60_000);
  });

  it("says how long is left", () => {
    expect(timeLeftLabel(100n + RATING_COMMIT_SLOTS, 100n)).toBe("in about 7 days");
    expect(timeLeftLabel(100n + 9_000n * 5n, 100n)).toBe("in about 5 hours");
    expect(timeLeftLabel(100n + 1_500n, 100n)).toBe("in about 10 minutes");
    expect(timeLeftLabel(100n + 10n, 100n)).toBe("in under a minute");
    expect(timeLeftLabel(100n, 100n)).toBe("in under a minute");
    expect(timeLeftLabel(100n, 101n)).toBe("passed");
  });
});
