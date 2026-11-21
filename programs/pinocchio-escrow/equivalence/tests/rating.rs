//! Ratings of jobs paid through escrow: `commit_rating`, `reveal_rating`,
//! `expire_rating` and `close_rating`, against the built Pinocchio binary.
//!
//! Covers the scenarios of issues #836 and #837, every refusal of the four
//! instructions, and the deadlines at their boundary slots. Lamport
//! conservation is asserted on every transaction by the harness.
mod support;

use {
    anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction},
    escrow::state::AgentType,
    solana_keypair::Keypair,
    solana_signer::Signer,
    support::*,
};

const AMOUNT: u64 = 1_000_000;
const SALT_C: [u8; 32] = [0xC1; 32];
const SALT_S: [u8; 32] = [0x51; 32];

struct Job {
    world: World,
    consumer: Keypair,
    specialist: Keypair,
    stranger: Keypair,
    next_nonce: u8,
}

/// Who is registered as an agent before the job.
#[derive(Clone, Copy, PartialEq)]
enum Registered {
    Both,
    SpecialistOnly,
    Neither,
}

impl Job {
    fn new(registered: Registered) -> Self {
        let mut world = World::new();
        let (consumer, specialist, stranger) = (world.wallet(1), world.wallet(2), world.wallet(3));
        if registered != Registered::Neither {
            world.register(&specialist, AgentType::Primary);
        }
        if registered == Registered::Both {
            world.register(&consumer, AgentType::Primary);
        }
        Self {
            world,
            consumer,
            specialist,
            stranger,
            next_nonce: 1,
        }
    }

    fn c(&self) -> Pubkey {
        self.consumer.pubkey()
    }

    fn s(&self) -> Pubkey {
        self.specialist.pubkey()
    }

    /// Lock a metered SOL escrow and opt it into rating. Returns the escrow
    /// and its rating address.
    fn locked(&mut self) -> (Pubkey, Pubkey, [u8; 16]) {
        let n = nonce(self.next_nonce);
        self.next_nonce += 1;
        let escrow = sol_escrow(&self.c(), n);
        self.world.ok(
            "lock",
            sol_lock(&self.c(), &self.s(), AMOUNT, n, true),
            &[&self.consumer],
        );
        self.world.ok(
            "open_rating",
            open_rating(&escrow, &self.c(), None),
            &[&self.consumer],
        );
        (escrow, rating_address(&escrow), n)
    }

    /// A rated job the payee has settled: its rating is open.
    fn paid(&mut self) -> Pubkey {
        let (escrow, rating, n) = self.locked();
        self.world.ok(
            "settle",
            with_rating(
                sol_payout(&self.c(), &self.s(), n, &self.s(), Some(600_000)),
                &escrow,
            ),
            &[&self.specialist],
        );
        assert_eq!(self.world.rating(&rating).state, OPEN);
        rating
    }

    fn commit(&self, rating: &Pubkey, who: &Keypair, score: u8, salt: [u8; 32]) -> Instruction {
        commit_rating(
            rating,
            &who.pubkey(),
            commitment(rating, &who.pubkey(), score, salt),
        )
    }

    fn reveal(&self, rating: &Pubkey, who: &Keypair, score: u8, salt: [u8; 32]) -> Instruction {
        reveal_rating(rating, &who.pubkey(), &self.s(), &self.c(), score, salt)
    }

    fn expire(&self, rating: &Pubkey, who: &Keypair) -> Instruction {
        expire_rating(rating, &who.pubkey(), &self.s(), &self.c())
    }

    /// Both commit: the consumer scores the specialist `by_consumer`, the
    /// specialist scores the consumer `by_specialist`.
    fn both_commit(&mut self, rating: &Pubkey, by_consumer: u8, by_specialist: u8) {
        let ix = self.commit(rating, &self.consumer, by_consumer, SALT_C);
        self.world
            .ok("commit_rating (first)", ix, &[&self.consumer]);
        let ix = self.commit(rating, &self.specialist, by_specialist, SALT_S);
        self.world
            .ok("commit_rating (second)", ix, &[&self.specialist]);
        assert_eq!(self.world.rating(rating).state, BOTH_COMMITTED);
    }

    /// (reputation, jobs completed, jobs failed) of a registered party.
    fn standing(&self, who: &Pubkey) -> (u16, u64, u64) {
        let agent = self.world.agent(who);
        (
            agent.reputation_score,
            agent.jobs_completed,
            agent.jobs_failed,
        )
    }
}

// ── #836: a rating counts only for a job paid through escrow ────────────────

#[test]
fn s1_an_escrow_that_was_never_opted_in_cannot_be_rated() {
    let mut t = Job::new(Registered::Both);
    let n = nonce(1);
    let escrow = sol_escrow(&t.c(), n);
    let rating = rating_address(&escrow);
    t.world.ok(
        "lock",
        sol_lock(&t.c(), &t.s(), AMOUNT, n, false),
        &[&t.consumer],
    );
    for paid in [false, true] {
        if paid {
            t.world.ok(
                "release",
                sol_payout(&t.c(), &t.s(), n, &t.c(), None),
                &[&t.consumer],
            );
        }
        for who in [&t.consumer, &t.specialist] {
            t.world.refused(
                "commit without a rating account",
                t.commit(&rating, who, 5, SALT_C),
                &[who],
                NOT_INITIALIZED,
            );
            t.world.refused(
                "reveal without a rating account",
                t.reveal(&rating, who, 5, SALT_C),
                &[who],
                NOT_INITIALIZED,
            );
        }
        t.world.refused(
            "expire without a rating account",
            t.expire(&rating, &t.stranger),
            &[&t.stranger],
            NOT_INITIALIZED,
        );
    }
    assert_eq!(t.standing(&t.s()), (0, 0, 0));
    assert_eq!(t.standing(&t.c()), (0, 0, 0));
}

#[test]
fn a_job_that_is_not_paid_yet_cannot_be_rated() {
    let mut t = Job::new(Registered::Both);
    let (_, rating, _) = t.locked();
    for who in [&t.consumer, &t.specialist] {
        t.world.refused(
            "commit before payment",
            t.commit(&rating, who, 5, SALT_C),
            &[who],
            JOB_NOT_PAID,
        );
        t.world.refused(
            "reveal before payment",
            t.reveal(&rating, who, 5, SALT_C),
            &[who],
            JOB_NOT_PAID,
        );
    }
    // Not even after any deadline: a rating waiting for its escrow has none.
    t.world.warp(t.world.slot() + 10 * RATING_COMMIT_SLOTS);
    t.world.refused(
        "expire before payment",
        t.expire(&rating, &t.stranger),
        &[&t.stranger],
        JOB_NOT_PAID,
    );
    t.world.refused(
        "close before payment",
        close_rating(&rating, &t.c()),
        &[&t.consumer],
        RATING_NOT_FINAL,
    );
    assert_eq!(t.world.rating(&rating).state, AWAITING_SETTLEMENT);
}

#[test]
fn s3_both_commit_and_reveal_and_each_score_counts_once() {
    let mut t = Job::new(Registered::Both);
    t.world.set_reputation(&t.s(), 6_000);
    t.world.set_reputation(&t.c(), 4_000);
    let rating = t.paid();
    let settled = t.world.rating(&rating).settled_slot;

    t.world.warp(settled + 100);
    let ix = t.commit(&rating, &t.consumer, 9, SALT_C);
    t.world.ok("commit_rating (first)", ix, &[&t.consumer]);
    let record = t.world.rating(&rating);
    assert_eq!(record.state, OPEN);
    assert_eq!(
        record.consumer_commitment,
        commitment(&rating, &t.c(), 9, SALT_C)
    );
    assert_eq!(record.specialist_commitment, [0; 32]);
    assert_eq!(record.committed_slot, 0);

    t.world.warp(settled + 250);
    let ix = t.commit(&rating, &t.specialist, 4, SALT_S);
    t.world.ok("commit_rating (second)", ix, &[&t.specialist]);
    let record = t.world.rating(&rating);
    assert_eq!(record.state, BOTH_COMMITTED);
    assert_eq!(record.committed_slot, settled + 250);

    // The specialist reveals first; nothing moves until both have.
    let ix = t.reveal(&rating, &t.specialist, 4, SALT_S);
    t.world.ok("reveal_rating (first)", ix, &[&t.specialist]);
    let record = t.world.rating(&rating);
    assert_eq!(
        (record.state, record.consumer_score, record.specialist_score),
        (BOTH_COMMITTED, 0, 4)
    );
    assert_eq!(t.standing(&t.s()), (6_000, 0, 0));
    assert_eq!(t.standing(&t.c()), (4_000, 0, 0));

    let ix = t.reveal(&rating, &t.consumer, 9, SALT_C);
    t.world
        .ok("reveal_rating (second, finalises)", ix, &[&t.consumer]);
    let record = t.world.rating(&rating);
    assert_eq!(
        (record.state, record.consumer_score, record.specialist_score),
        (REVEALED, 9, 4)
    );
    // Nine parts the old score, one part the rating scaled to 0..=10000.
    assert_eq!(t.standing(&t.s()), ((6_000 * 9 + 9_000) / 10, 1, 0));
    assert_eq!(t.standing(&t.c()), ((4_000 * 9 + 4_000) / 10, 1, 0));

    // Final: nothing can be done to it again, and nothing changes (#837 S3).
    for who in [&t.consumer, &t.specialist] {
        t.world.refused(
            "commit on a final rating",
            t.commit(&rating, who, 1, SALT_C),
            &[who],
            ALREADY_FINALISED,
        );
        t.world.refused(
            "reveal on a final rating",
            t.reveal(&rating, who, 9, SALT_C),
            &[who],
            ALREADY_FINALISED,
        );
    }
    t.world.warp(settled + 10 * RATING_COMMIT_SLOTS);
    t.world.refused(
        "expire a final rating",
        t.expire(&rating, &t.stranger),
        &[&t.stranger],
        ALREADY_FINALISED,
    );
    assert_eq!(t.standing(&t.s()), (6_300, 1, 0));
    assert_eq!(t.standing(&t.c()), (4_000, 1, 0));
    t.world.report("Rating");
}

#[test]
fn s5_a_wallet_that_is_neither_party_cannot_commit_or_reveal() {
    let mut t = Job::new(Registered::Both);
    let rating = t.paid();
    t.world.refused(
        "stranger commits",
        t.commit(&rating, &t.stranger, 5, SALT_C),
        &[&t.stranger],
        UNAUTHORISED_SIGNER,
    );
    t.both_commit(&rating, 8, 8);
    t.world.refused(
        "stranger reveals",
        t.reveal(&rating, &t.stranger, 8, SALT_C),
        &[&t.stranger],
        UNAUTHORISED_SIGNER,
    );
    // A party named in the data but not signing is no better.
    t.world.refused(
        "consumer named, not signing",
        not_signed(t.reveal(&rating, &t.consumer, 8, SALT_C), 1),
        &[&t.stranger],
        NOT_SIGNER,
    );
    t.world.refused(
        "consumer named for a commit, not signing",
        not_signed(t.commit(&rating, &t.consumer, 8, SALT_C), 1),
        &[&t.stranger],
        NOT_SIGNER,
    );
    assert_eq!(t.standing(&t.s()), (0, 0, 0));
}

// ── commit_rating ───────────────────────────────────────────────────────────

#[test]
fn commit_refuses_a_second_commitment_an_empty_one_and_wrong_accounts() {
    let mut t = Job::new(Registered::Both);
    let rating = t.paid();
    let other = t.paid();
    let agent_account = agent(&t.s());
    let good = t.commit(&rating, &t.consumer, 7, SALT_C);

    t.world.refused(
        "empty commitment",
        commit_rating(&rating, &t.c(), [0; 32]),
        &[&t.consumer],
        EMPTY_COMMITMENT,
    );
    t.world.refused(
        "short data",
        with_args(good.clone(), &[1; 31]),
        &[&t.consumer],
        102,
    );
    t.world.refused(
        "too few accounts",
        {
            let mut ix = good.clone();
            ix.accounts.truncate(1);
            ix
        },
        &[&t.stranger],
        NOT_ENOUGH_KEYS,
    );
    t.world.refused(
        "rating read-only",
        read_only(good.clone(), 0),
        &[&t.consumer],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "a wallet as rating",
        swap(good.clone(), 0, t.stranger.pubkey()),
        &[&t.consumer],
        WRONG_OWNER,
    );
    t.world.refused(
        "an agent record as rating",
        swap(good.clone(), 0, agent_account),
        &[&t.consumer],
        DISCRIMINATOR_MISMATCH,
    );
    let copy = Pubkey::new_from_array([77; 32]);
    let genuine = t.world.svm.get_account(&rating).unwrap();
    t.world.set(copy, genuine);
    t.world.refused(
        "a copy of the rating at another address",
        swap(good.clone(), 0, copy),
        &[&t.consumer],
        CONSTRAINT_SEEDS,
    );

    t.world.ok("commit", good.clone(), &[&t.consumer]);
    t.world.refused(
        "same commitment again",
        good,
        &[&t.consumer],
        ALREADY_COMMITTED,
    );
    t.world.refused(
        "another commitment by the same party",
        t.commit(&rating, &t.consumer, 2, SALT_S),
        &[&t.consumer],
        ALREADY_COMMITTED,
    );
    let ix = t.commit(&rating, &t.specialist, 7, SALT_S);
    t.world.ok("commit", ix, &[&t.specialist]);
    for who in [&t.consumer, &t.specialist] {
        t.world.refused(
            "commit once both have",
            t.commit(&rating, who, 3, SALT_S),
            &[who],
            ALREADY_COMMITTED,
        );
    }
    // The other job's rating was not touched.
    let untouched = t.world.rating(&other);
    assert_eq!(
        (untouched.state, untouched.consumer_commitment),
        (OPEN, [0; 32])
    );
}

#[test]
fn commit_deadline_is_counted_from_the_settlement_and_includes_its_last_slot() {
    let mut t = Job::new(Registered::Both);
    let rating = t.paid();
    let deadline = t.world.rating(&rating).settled_slot + RATING_COMMIT_SLOTS;

    t.world.warp(deadline);
    let ix = t.commit(&rating, &t.consumer, 7, SALT_C);
    t.world.ok("commit in the last slot", ix, &[&t.consumer]);
    t.world.refused(
        "expire in the last slot",
        t.expire(&rating, &t.stranger),
        &[&t.stranger],
        NOT_EXPIRED,
    );

    t.world.warp(deadline + 1);
    t.world.refused(
        "commit one slot late",
        t.commit(&rating, &t.specialist, 7, SALT_S),
        &[&t.specialist],
        COMMIT_DEADLINE_PASSED,
    );
    assert_eq!(t.world.rating(&rating).state, OPEN);
    let ix = t.expire(&rating, &t.stranger);
    t.world
        .ok("expire one slot after the deadline", ix, &[&t.stranger]);
    assert_eq!(t.world.rating(&rating).state, EXPIRED);
}

// ── reveal_rating ───────────────────────────────────────────────────────────

#[test]
fn reveal_refuses_until_both_commit_and_checks_score_and_commitment() {
    let mut t = Job::new(Registered::Both);
    let rating = t.paid();
    let ix = t.commit(&rating, &t.consumer, 7, SALT_C);
    t.world.ok("commit", ix, &[&t.consumer]);
    t.world.refused(
        "reveal before the other side committed",
        t.reveal(&rating, &t.consumer, 7, SALT_C),
        &[&t.consumer],
        BOTH_MUST_COMMIT_FIRST,
    );
    let ix = t.commit(&rating, &t.specialist, 3, SALT_S);
    t.world.ok("commit", ix, &[&t.specialist]);

    for score in [0, 11, 255] {
        t.world.refused(
            "score out of range",
            t.reveal(&rating, &t.consumer, score, SALT_C),
            &[&t.consumer],
            INVALID_SCORE,
        );
    }
    t.world.refused(
        "another score",
        t.reveal(&rating, &t.consumer, 8, SALT_C),
        &[&t.consumer],
        COMMITMENT_MISMATCH,
    );
    t.world.refused(
        "another salt",
        t.reveal(&rating, &t.consumer, 7, SALT_S),
        &[&t.consumer],
        COMMITMENT_MISMATCH,
    );
    t.world.refused(
        "short data",
        with_args(t.reveal(&rating, &t.consumer, 7, SALT_C), &[7; 32]),
        &[&t.consumer],
        102,
    );
    let ix = t.reveal(&rating, &t.consumer, 7, SALT_C);
    t.world.ok("reveal", ix, &[&t.consumer]);
    t.world.refused(
        "reveal twice",
        t.reveal(&rating, &t.consumer, 7, SALT_C),
        &[&t.consumer],
        ALREADY_REVEALED,
    );
    assert_eq!(t.standing(&t.s()), (0, 0, 0));
    assert_eq!(t.world.rating(&rating).state, BOTH_COMMITTED);
}

#[test]
fn s5_a_copied_commitment_cannot_be_opened_by_replaying_the_reveal() {
    let mut t = Job::new(Registered::Both);
    let rating = t.paid();
    // The consumer commits; the specialist copies the bytes it sees on chain.
    let ix = t.commit(&rating, &t.consumer, 2, SALT_C);
    t.world.ok("commit", ix, &[&t.consumer]);
    let copied = t.world.rating(&rating).consumer_commitment;
    t.world.ok(
        "commit the copied bytes",
        commit_rating(&rating, &t.s(), copied),
        &[&t.specialist],
    );
    // The consumer reveals, which publishes its score and salt.
    let ix = t.reveal(&rating, &t.consumer, 2, SALT_C);
    t.world.ok("reveal", ix, &[&t.consumer]);
    // Replaying them does not open the copy: the signer is part of the hash.
    t.world.refused(
        "replay the other side's reveal",
        t.reveal(&rating, &t.specialist, 2, SALT_C),
        &[&t.specialist],
        COMMITMENT_MISMATCH,
    );
    for score in 1..=10 {
        t.world.refused(
            "any score with the other side's salt",
            t.reveal(&rating, &t.specialist, score, SALT_C),
            &[&t.specialist],
            COMMITMENT_MISMATCH,
        );
    }
    assert_eq!(t.world.rating(&rating).state, BOTH_COMMITTED);
    assert_eq!(t.standing(&t.c()), (0, 0, 0));
}

#[test]
fn a_commitment_made_for_another_job_does_not_open_here() {
    let mut t = Job::new(Registered::Both);
    let first = t.paid();
    let second = t.paid();
    // The consumer reuses, on the second job, the commitment it made for the
    // first: same signer, same score, same salt, other rating.
    let reused = commitment(&first, &t.c(), 6, SALT_C);
    t.world.ok(
        "commit",
        commit_rating(&second, &t.c(), reused),
        &[&t.consumer],
    );
    let ix = t.commit(&second, &t.specialist, 6, SALT_S);
    t.world.ok("commit", ix, &[&t.specialist]);
    t.world.refused(
        "reveal of a commitment bound to another rating",
        t.reveal(&second, &t.consumer, 6, SALT_C),
        &[&t.consumer],
        COMMITMENT_MISMATCH,
    );
}

#[test]
fn reveal_deadline_is_counted_from_the_second_commitment_and_includes_its_last_slot() {
    let mut t = Job::new(Registered::Both);
    let rating = t.paid();
    let settled = t.world.rating(&rating).settled_slot;
    // The second commitment lands in the last slot of the commit window, so
    // the two deadlines are told apart.
    let ix = t.commit(&rating, &t.consumer, 7, SALT_C);
    t.world.ok("commit", ix, &[&t.consumer]);
    t.world.warp(settled + RATING_COMMIT_SLOTS);
    let ix = t.commit(&rating, &t.specialist, 3, SALT_S);
    t.world.ok("commit", ix, &[&t.specialist]);
    let deadline = settled + RATING_COMMIT_SLOTS + RATING_REVEAL_SLOTS;
    assert_eq!(
        t.world.rating(&rating).committed_slot + RATING_REVEAL_SLOTS,
        deadline
    );

    t.world.warp(deadline);
    t.world.refused(
        "expire in the last slot",
        t.expire(&rating, &t.stranger),
        &[&t.stranger],
        NOT_EXPIRED,
    );
    let ix = t.reveal(&rating, &t.consumer, 7, SALT_C);
    t.world.ok("reveal in the last slot", ix, &[&t.consumer]);

    // #837 S4: the late side cannot reveal after the deadline.
    t.world.warp(deadline + 1);
    t.world.refused(
        "reveal one slot late",
        t.reveal(&rating, &t.specialist, 3, SALT_S),
        &[&t.specialist],
        REVEAL_DEADLINE_PASSED,
    );
    assert_eq!(t.world.rating(&rating).state, BOTH_COMMITTED);
}

#[test]
fn reveal_and_expire_refuse_every_wrong_account() {
    let mut t = Job::new(Registered::Both);
    let rating = t.paid();
    let other = t.paid();
    t.both_commit(&rating, 7, 3);
    t.world.register(&t.stranger, AgentType::Both);
    let (spec_agent, cons_agent, strange_agent) =
        (agent(&t.s()), agent(&t.c()), agent(&t.stranger.pubkey()));
    let unregistered = agent(&key(42).pubkey());
    let copy = Pubkey::new_from_array([77; 32]);
    let genuine = t.world.svm.get_account(&rating).unwrap();
    t.world.set(copy, genuine);
    // Past the reveal deadline, so `expire_rating` would otherwise succeed.
    let committed = t.world.rating(&rating).committed_slot;

    for expire in [false, true] {
        let (good, signer) = if expire {
            t.world.warp(committed + RATING_REVEAL_SLOTS + 1);
            (t.expire(&rating, &t.stranger), &t.stranger)
        } else {
            (t.reveal(&rating, &t.consumer, 7, SALT_C), &t.consumer)
        };
        let mut refuse = |label: &str, ix: Instruction, code: u32| {
            t.world.refused(label, ix, &[signer], code);
        };
        refuse(
            "too few accounts",
            {
                let mut ix = good.clone();
                ix.accounts.truncate(3);
                ix
            },
            NOT_ENOUGH_KEYS,
        );
        refuse(
            "rating read-only",
            read_only(good.clone(), 0),
            CONSTRAINT_MUT,
        );
        refuse(
            "a wallet as rating",
            swap(good.clone(), 0, key(42).pubkey()),
            NOT_INITIALIZED,
        );
        refuse(
            "an agent record as rating",
            swap(good.clone(), 0, strange_agent),
            DISCRIMINATOR_MISMATCH,
        );
        refuse(
            "a copy of the rating at another address",
            swap(good.clone(), 0, copy),
            CONSTRAINT_SEEDS,
        );
        refuse(
            "specialist agent read-only",
            read_only(good.clone(), 2),
            CONSTRAINT_MUT,
        );
        refuse(
            "consumer agent read-only",
            read_only(good.clone(), 3),
            CONSTRAINT_MUT,
        );
        refuse(
            "another agent as the specialist's",
            swap(good.clone(), 2, strange_agent),
            CONSTRAINT_SEEDS,
        );
        refuse(
            "another agent as the consumer's",
            swap(good.clone(), 3, strange_agent),
            CONSTRAINT_SEEDS,
        );
        refuse(
            "an unregistered agent address as the specialist's",
            swap(good.clone(), 2, unregistered),
            CONSTRAINT_SEEDS,
        );
        refuse(
            "a wallet as the consumer's agent",
            swap(good.clone(), 3, key(42).pubkey()),
            CONSTRAINT_SEEDS,
        );
        refuse(
            "the rating as an agent",
            swap(good.clone(), 2, rating),
            DISCRIMINATOR_MISMATCH,
        );
        refuse(
            "the two agents swapped",
            swap(swap(good.clone(), 2, cons_agent), 3, spec_agent),
            CONSTRAINT_SEEDS,
        );
        refuse(
            "the specialist's agent twice",
            swap(good.clone(), 3, spec_agent),
            DUPLICATE_MUTABLE,
        );
        refuse(
            "the consumer's agent twice",
            swap(good.clone(), 2, cons_agent),
            DUPLICATE_MUTABLE,
        );
        if expire {
            t.world.refused(
                "caller did not sign",
                not_signed(good.clone(), 1),
                &[&t.consumer],
                NOT_SIGNER,
            );
        }
    }
    // Nothing above moved anything.
    assert_eq!(t.world.rating(&rating).state, BOTH_COMMITTED);
    assert_eq!(t.world.rating(&other).state, OPEN);
    assert_eq!(t.standing(&t.s()), (0, 0, 0));
    assert_eq!(t.standing(&t.c()), (0, 0, 0));
}

// ── Parties that are not registered agents ──────────────────────────────────

#[test]
fn an_unregistered_consumer_rates_a_registered_provider() {
    let mut t = Job::new(Registered::SpecialistOnly);
    t.world.set_reputation(&t.s(), 5_000);
    let rating = t.paid();
    t.both_commit(&rating, 10, 6);
    let cons_agent = agent(&t.c());
    assert!(!t.world.exists(&cons_agent));

    // The consumer's agent address is still checked.
    t.world.refused(
        "another address for the unregistered consumer",
        swap(
            t.reveal(&rating, &t.consumer, 10, SALT_C),
            3,
            agent(&t.stranger.pubkey()),
        ),
        &[&t.consumer],
        CONSTRAINT_SEEDS,
    );
    let ix = t.reveal(&rating, &t.consumer, 10, SALT_C);
    t.world.ok("reveal_rating (first)", ix, &[&t.consumer]);
    let ix = t.reveal(&rating, &t.specialist, 6, SALT_S);
    t.world.ok(
        "reveal_rating (second, one party unregistered)",
        ix,
        &[&t.specialist],
    );
    assert_eq!(t.world.rating(&rating).state, REVEALED);
    assert_eq!(t.standing(&t.s()), ((5_000 * 9 + 10_000) / 10, 1, 0));
    // The consumer's score is on the rating account, and nothing was created
    // at its agent address.
    assert_eq!(t.world.rating(&rating).specialist_score, 6);
    assert!(!t.world.exists(&cons_agent));
    t.world.report("Rating, unregistered consumer");
}

#[test]
fn a_party_that_registers_later_or_deregisters_is_handled_as_it_stands_at_the_end() {
    let mut t = Job::new(Registered::SpecialistOnly);
    let rating = t.paid();
    t.both_commit(&rating, 3, 8);
    // The specialist leaves the registry; the consumer joins it.
    t.world.deregister(&key(2));
    t.world.register(&key(1), AgentType::Primary);
    let ix = t.reveal(&rating, &t.consumer, 3, SALT_C);
    t.world.ok("reveal", ix, &[&t.consumer]);
    let ix = t.reveal(&rating, &t.specialist, 8, SALT_S);
    t.world.ok("reveal", ix, &[&t.specialist]);
    assert_eq!(t.world.rating(&rating).state, REVEALED);
    assert_eq!(t.standing(&t.c()), (800, 1, 0));
    assert!(!t.world.exists(&agent(&t.s())));
}

#[test]
fn two_unregistered_parties_can_finish_a_rating_and_nothing_else_changes() {
    let mut t = Job::new(Registered::Neither);
    let rating = t.paid();
    t.both_commit(&rating, 1, 10);
    let ix = t.reveal(&rating, &t.specialist, 10, SALT_S);
    t.world.ok("reveal", ix, &[&t.specialist]);
    let ix = t.reveal(&rating, &t.consumer, 1, SALT_C);
    t.world.ok("reveal", ix, &[&t.consumer]);
    let record = t.world.rating(&rating);
    assert_eq!(
        (record.state, record.consumer_score, record.specialist_score),
        (REVEALED, 1, 10)
    );
    assert!(!t.world.exists(&agent(&t.c())));
    assert!(!t.world.exists(&agent(&t.s())));
}

// ── #837: expire_rating gives every unfinished rating a final result ────────

#[test]
fn expire_with_nobody_committed_changes_no_reputation() {
    let mut t = Job::new(Registered::Both);
    t.world.set_reputation(&t.s(), 6_000);
    t.world.set_reputation(&t.c(), 6_000);
    let rating = t.paid();
    let deadline = t.world.rating(&rating).settled_slot + RATING_COMMIT_SLOTS;
    t.world.warp(deadline);
    t.world.refused(
        "expire in the last slot of the commit window",
        t.expire(&rating, &t.stranger),
        &[&t.stranger],
        NOT_EXPIRED,
    );
    t.world.warp(deadline + 1);
    let ix = t.expire(&rating, &t.stranger);
    t.world
        .ok("expire_rating (nobody committed)", ix, &[&t.stranger]);
    assert_eq!(t.world.rating(&rating).state, EXPIRED);
    assert_eq!(t.standing(&t.s()), (6_000, 0, 0));
    assert_eq!(t.standing(&t.c()), (6_000, 0, 0));
    t.world.report("Expire");
}

#[test]
fn expire_with_one_commitment_penalises_the_silent_side() {
    for consumer_committed in [true, false] {
        let mut t = Job::new(Registered::Both);
        t.world.set_reputation(&t.s(), 6_000);
        t.world.set_reputation(&t.c(), 300);
        let rating = t.paid();
        let deadline = t.world.rating(&rating).settled_slot + RATING_COMMIT_SLOTS;
        let committer = if consumer_committed { key(1) } else { key(2) };
        let ix = t.commit(&rating, &committer, 7, SALT_C);
        t.world.ok("commit", ix, &[&committer]);
        t.world.warp(deadline);
        t.world.refused(
            "expire before the deadline",
            t.expire(&rating, &t.stranger),
            &[&t.stranger],
            NOT_EXPIRED,
        );
        t.world.warp(deadline + 1);
        let ix = t.expire(&rating, &t.stranger);
        t.world
            .ok("expire_rating (one committed)", ix, &[&t.stranger]);
        assert_eq!(t.world.rating(&rating).state, EXPIRED);
        if consumer_committed {
            assert_eq!(t.standing(&t.s()), (5_500, 0, 1));
            assert_eq!(t.standing(&t.c()), (300, 0, 0));
        } else {
            assert_eq!(t.standing(&t.s()), (6_000, 0, 0));
            // The penalty stops at zero.
            assert_eq!(t.standing(&t.c()), (0, 0, 1));
        }
        // Final (#837 S3).
        t.world.refused(
            "expire again",
            t.expire(&rating, &t.consumer),
            &[&t.consumer],
            ALREADY_FINALISED,
        );
        t.world.refused(
            "late commit on an expired rating",
            t.commit(&rating, &t.specialist, 7, SALT_S),
            &[&t.specialist],
            ALREADY_FINALISED,
        );
    }
}

#[test]
fn s1_s2_expire_after_one_reveal_counts_it_and_penalises_the_withholder() {
    for consumer_revealed in [true, false] {
        let mut t = Job::new(Registered::Both);
        t.world.set_reputation(&t.s(), 6_000);
        t.world.set_reputation(&t.c(), 2_000);
        let rating = t.paid();
        t.both_commit(&rating, 8, 3);
        let deadline = t.world.rating(&rating).committed_slot + RATING_REVEAL_SLOTS;
        let ix = if consumer_revealed {
            t.reveal(&rating, &t.consumer, 8, SALT_C)
        } else {
            t.reveal(&rating, &t.specialist, 3, SALT_S)
        };
        let revealer = if consumer_revealed { key(1) } else { key(2) };
        t.world.ok("reveal", ix, &[&revealer]);

        // S2: not before the deadline.
        t.world.warp(deadline);
        t.world.refused(
            "expire before the reveal deadline",
            t.expire(&rating, &t.stranger),
            &[&t.stranger],
            NOT_EXPIRED,
        );
        assert_eq!(t.standing(&t.s()), (6_000, 0, 0));

        // S1: after it, anyone can.
        t.world.warp(deadline + 1);
        let ix = t.expire(&rating, &t.stranger);
        t.world
            .ok("expire_rating (one revealed)", ix, &[&t.stranger]);
        let record = t.world.rating(&rating);
        assert_eq!(record.state, EXPIRED);
        if consumer_revealed {
            // The consumer's 8 counts for the specialist, who then loses 5.00
            // for withholding; the specialist's own score is never counted.
            assert_eq!(
                t.standing(&t.s()),
                ((6_000 * 9 + 8_000) / 10 - RATING_EXPIRE_PENALTY, 1, 0)
            );
            assert_eq!(t.standing(&t.c()), (2_000, 1, 0));
            assert_eq!((record.consumer_score, record.specialist_score), (8, 0));
        } else {
            assert_eq!(
                t.standing(&t.c()),
                ((2_000 * 9 + 3_000) / 10 - RATING_EXPIRE_PENALTY, 1, 0)
            );
            assert_eq!(t.standing(&t.s()), (6_000, 1, 0));
            assert_eq!((record.consumer_score, record.specialist_score), (0, 3));
        }

        // S3 and S4: final, and the withheld reveal is refused.
        let (late, score, salt) = if consumer_revealed {
            (key(2), 3, SALT_S)
        } else {
            (key(1), 8, SALT_C)
        };
        t.world.refused(
            "the withheld reveal, after expiry",
            t.reveal(&rating, &late, score, salt),
            &[&late],
            ALREADY_FINALISED,
        );
        t.world.refused(
            "expire again",
            t.expire(&rating, &t.stranger),
            &[&t.stranger],
            ALREADY_FINALISED,
        );
        t.world.refused(
            "commit again",
            t.commit(&rating, &late, score, salt),
            &[&late],
            ALREADY_FINALISED,
        );
        t.world.report("Expire after one reveal");
    }
}

#[test]
fn expire_with_both_committed_and_nobody_revealed_changes_no_reputation() {
    let mut t = Job::new(Registered::Both);
    t.world.set_reputation(&t.s(), 6_000);
    t.world.set_reputation(&t.c(), 6_000);
    let rating = t.paid();
    t.both_commit(&rating, 8, 3);
    let deadline = t.world.rating(&rating).committed_slot + RATING_REVEAL_SLOTS;
    t.world.warp(deadline);
    t.world.refused(
        "expire before the reveal deadline",
        t.expire(&rating, &t.consumer),
        &[&t.consumer],
        NOT_EXPIRED,
    );
    t.world.warp(deadline + 1);
    let ix = t.expire(&rating, &t.consumer);
    t.world.ok("expire", ix, &[&t.consumer]);
    assert_eq!(t.world.rating(&rating).state, EXPIRED);
    assert_eq!(t.standing(&t.s()), (6_000, 0, 0));
    assert_eq!(t.standing(&t.c()), (6_000, 0, 0));
}

#[test]
fn expire_skips_a_withholder_that_is_not_registered() {
    let mut t = Job::new(Registered::Neither);
    t.world.register(&key(1), AgentType::Primary);
    t.world.set_reputation(&t.c(), 2_000);
    let rating = t.paid();
    t.both_commit(&rating, 8, 3);
    let ix = t.reveal(&rating, &t.consumer, 8, SALT_C);
    t.world.ok("reveal", ix, &[&t.consumer]);
    let deadline = t.world.rating(&rating).committed_slot + RATING_REVEAL_SLOTS;
    t.world.warp(deadline + 1);
    let ix = t.expire(&rating, &t.stranger);
    t.world.ok("expire", ix, &[&t.stranger]);
    assert_eq!(t.world.rating(&rating).state, EXPIRED);
    assert_eq!(t.standing(&t.c()), (2_000, 1, 0));
    assert!(!t.world.exists(&agent(&t.s())));
}

// ── close_rating ────────────────────────────────────────────────────────────

#[test]
fn close_rating_is_refused_until_the_result_is_final_and_pays_the_consumer() {
    let mut t = Job::new(Registered::Both);
    let rating = t.paid();
    let close = close_rating(&rating, &t.c());

    t.world.refused(
        "close an open rating",
        close.clone(),
        &[&t.consumer],
        RATING_NOT_FINAL,
    );
    t.both_commit(&rating, 8, 3);
    t.world.refused(
        "close with both committed",
        close.clone(),
        &[&t.consumer],
        RATING_NOT_FINAL,
    );
    let ix = t.reveal(&rating, &t.consumer, 8, SALT_C);
    t.world.ok("reveal", ix, &[&t.consumer]);
    t.world.refused(
        "close with one revealed",
        close.clone(),
        &[&t.consumer],
        RATING_NOT_FINAL,
    );
    let ix = t.reveal(&rating, &t.specialist, 3, SALT_S);
    t.world.ok("reveal", ix, &[&t.specialist]);

    // Final. Only the consumer, who paid the rent, closes it.
    t.world.refused(
        "the specialist closes",
        close_rating(&rating, &t.s()),
        &[&t.specialist],
        UNAUTHORISED_SIGNER,
    );
    t.world.refused(
        "a stranger closes",
        close_rating(&rating, &t.stranger.pubkey()),
        &[&t.stranger],
        UNAUTHORISED_SIGNER,
    );
    t.world.refused(
        "consumer did not sign",
        not_signed(close.clone(), 1),
        &[&t.stranger],
        NOT_SIGNER,
    );
    t.world.refused(
        "rating read-only",
        read_only(close.clone(), 0),
        &[&t.consumer],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "consumer read-only",
        read_only(close.clone(), 1),
        &[&t.stranger, &t.consumer],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "an agent record as rating",
        swap(close.clone(), 0, agent(&t.c())),
        &[&t.consumer],
        DISCRIMINATOR_MISMATCH,
    );
    t.world.refused(
        "too few accounts",
        {
            let mut ix = close.clone();
            ix.accounts.truncate(1);
            ix
        },
        &[&t.stranger],
        NOT_ENOUGH_KEYS,
    );

    let rent = t.world.lamports(&rating);
    let before = t.world.lamports(&t.c());
    t.world.ok("close_rating", close.clone(), &[&t.consumer]);
    assert_eq!(t.world.lamports(&t.c()) - before, rent - 5_000);
    assert!(!t.world.exists(&rating));
    assert!(t.world.data(&rating).is_empty());

    t.world
        .refused("close twice", close, &[&t.consumer], NOT_INITIALIZED);
    t.world.refused(
        "commit on a closed rating",
        t.commit(&rating, &t.consumer, 8, SALT_C),
        &[&t.consumer],
        NOT_INITIALIZED,
    );
    // Reputation was counted once and closing did not change it.
    assert_eq!(t.standing(&t.s()), (800, 1, 0));
    t.world.report("Close");
}

#[test]
fn close_rating_works_on_an_expired_rating() {
    let mut t = Job::new(Registered::Neither);
    let rating = t.paid();
    let deadline = t.world.rating(&rating).settled_slot + RATING_COMMIT_SLOTS;
    t.world.warp(deadline + 1);
    t.world.refused(
        "close before it is expired",
        close_rating(&rating, &t.c()),
        &[&t.consumer],
        RATING_NOT_FINAL,
    );
    let ix = t.expire(&rating, &t.specialist);
    t.world.ok("expire", ix, &[&t.specialist]);
    t.world
        .ok("close", close_rating(&rating, &t.c()), &[&t.consumer]);
    assert!(!t.world.exists(&rating));
}
