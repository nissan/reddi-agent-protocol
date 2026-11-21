//! Judge attestations tied to a paid job: `attest_quality`,
//! `confirm_attestation`, `dispute_attestation` and `close_attestation`,
//! against the built Pinocchio binary. Covers the scenarios of issue #838 and every refusal.
//! Lamport conservation is asserted on every transaction by the harness.
mod support;

use {
    anchor_lang::prelude::Pubkey, escrow::state::AgentType, solana_keypair::Keypair,
    solana_signer::Signer, support::*,
};

const AMOUNT: u64 = 1_000_000;
const SCORES: [u8; 5] = [9, 8, 10, 1, 7];

struct Court {
    world: World,
    consumer: Keypair,
    specialist: Keypair,
    stranger: Keypair,
    /// Registered as an attestation agent; named on the jobs below.
    judge: Keypair,
    /// Registered as an attestation agent too, but not named.
    rival: Keypair,
    /// Registered as a primary agent only.
    primary: Keypair,
    next_nonce: u8,
}

impl Court {
    fn new() -> Self {
        let mut world = World::new();
        let consumer = world.wallet(1);
        let specialist = world.wallet(2);
        let stranger = world.wallet(3);
        let judge = world.wallet(4);
        let rival = world.wallet(5);
        let primary = world.wallet(6);
        world.register(&judge, AgentType::Attestation);
        world.register(&rival, AgentType::Both);
        world.register(&primary, AgentType::Primary);
        Self {
            world,
            consumer,
            specialist,
            stranger,
            judge,
            rival,
            primary,
            next_nonce: 1,
        }
    }

    fn c(&self) -> Pubkey {
        self.consumer.pubkey()
    }

    fn j(&self) -> Pubkey {
        self.judge.pubkey()
    }

    /// Lock a SOL escrow and opt it into rating, naming `judge`.
    fn locked(&mut self, judge: Option<&Pubkey>) -> (Pubkey, [u8; 16]) {
        let n = nonce(self.next_nonce);
        self.next_nonce += 1;
        let escrow = sol_escrow(&self.c(), n);
        self.world.ok(
            "lock",
            sol_lock(&self.c(), &self.specialist.pubkey(), AMOUNT, n, false),
            &[&self.consumer],
        );
        self.world.ok(
            "open_rating (with a judge)",
            open_rating(&escrow, &self.c(), judge),
            &[&self.consumer],
        );
        (escrow, n)
    }

    /// A paid rated job naming `judge`. Returns its escrow address.
    fn paid(&mut self, judge: Option<&Pubkey>) -> Pubkey {
        let (escrow, n) = self.locked(judge);
        self.world.ok(
            "accept_rating",
            accept_rating(
                &self.world,
                &rating_address(&escrow),
                &self.specialist.pubkey(),
            ),
            &[&self.specialist],
        );
        self.world.ok(
            "release",
            with_rating(
                sol_payout(&self.c(), &self.specialist.pubkey(), n, &self.c(), None),
                &escrow,
            ),
            &[&self.consumer],
        );
        escrow
    }

    /// (reputation, attestation accuracy) of a registered agent.
    fn standing(&self, who: &Pubkey) -> (u16, u16) {
        let agent = self.world.agent(who);
        (agent.reputation_score, agent.attestation_accuracy)
    }
}

#[test]
fn s1_the_named_judge_attests_a_paid_job() {
    let mut t = Court::new();
    let j = t.j();
    let escrow = t.paid(Some(&j));
    assert_eq!(t.world.rating(&rating_address(&escrow)).judge, j);
    let before = t.world.lamports(&j);
    t.world.warp(t.world.slot() + 40);
    t.world.ok(
        "attest_quality",
        attest_quality(&t.world, &escrow, &j, SCORES),
        &[&t.judge],
    );
    let address = attestation_address(&escrow);
    assert_eq!(
        t.world.attestation(&address),
        Attestation {
            escrow,
            judge: j,
            consumer: t.c(),
            scores: SCORES,
            resolution: 0,
            created_slot: t.world.slot(),
            bump: Pubkey::find_program_address(&[b"attestation", escrow.as_ref()], &escrow::id()).1,
            opened_slot: t.world.opened_slot(&rating_address(&escrow)),
        }
    );
    // The judge paid the attestation's rent.
    let rent = t
        .world
        .svm
        .minimum_balance_for_rent_exemption(ATTESTATION_LEN);
    assert_eq!(t.world.lamports(&address), rent);
    assert_eq!(before - t.world.lamports(&j), rent + 5_000);
    // Attesting marks the rating as attested and changes nothing else on
    // it, nor on the judge's record.
    let job = t.world.rating(&rating_address(&escrow));
    assert_eq!((job.state, job.attested, job.accepted), (OPEN, true, true));
    assert_eq!(t.standing(&j), (0, 0));

    // One attestation per job.
    t.world.refused(
        "attest twice",
        attest_quality(&t.world, &escrow, &j, [5; 5]),
        &[&t.judge],
        ALREADY_ATTESTED,
    );
    assert_eq!(t.world.attestation(&address).scores, SCORES);
    t.world.report("Attestation");
}

#[test]
fn s2_nobody_but_the_named_judge_can_attest() {
    let mut t = Court::new();
    let j = t.j();
    let escrow = t.paid(Some(&j));
    let unjudged = t.paid(None);

    for (label, who) in [
        ("another registered judge", &t.rival),
        ("the consumer", &t.consumer),
        ("the specialist", &t.specialist),
        ("a primary agent", &t.primary),
    ] {
        // Registered or not, the signer is checked first when its agent
        // record exists; give each one a record so that is what is tested.
        if !t.world.exists(&agent(&who.pubkey())) {
            let who = Keypair::new_from_array(*who.secret_bytes());
            t.world.register(&who, AgentType::Both);
        }
        t.world.refused(
            label,
            attest_quality(&t.world, &escrow, &who.pubkey(), SCORES),
            &[who],
            UNAUTHORISED_SIGNER,
        );
    }
    // The named judge's agent record with another signer.
    t.world.refused(
        "the rival signing with the judge's record",
        swap(
            attest_quality(&t.world, &escrow, &j, SCORES),
            3,
            t.rival.pubkey(),
        ),
        &[&t.rival],
        UNAUTHORISED_SIGNER,
    );
    // A job with no judge has none: nobody can attest it.
    for who in [&t.judge, &t.rival] {
        t.world.refused(
            "a job with no judge",
            attest_quality(&t.world, &unjudged, &who.pubkey(), SCORES),
            &[who],
            UNAUTHORISED_SIGNER,
        );
    }
    assert!(!t.world.exists(&attestation_address(&escrow)));
    assert!(!t.world.exists(&attestation_address(&unjudged)));
}

#[test]
fn s3_a_job_never_opted_in_refunded_or_not_yet_paid_cannot_be_attested() {
    let mut t = Court::new();
    let j = t.j();

    // Never opted in: there is no rating account.
    let n = nonce(50);
    let plain = sol_escrow(&t.c(), n);
    t.world.ok(
        "lock",
        sol_lock(&t.c(), &t.specialist.pubkey(), AMOUNT, n, false),
        &[&t.consumer],
    );
    t.world.refused(
        "never opted in, locked",
        attest_quality(&t.world, &plain, &j, SCORES),
        &[&t.judge],
        NOT_INITIALIZED,
    );
    t.world.ok(
        "release",
        sol_payout(&t.c(), &t.specialist.pubkey(), n, &t.c(), None),
        &[&t.consumer],
    );
    t.world.refused(
        "never opted in, paid",
        attest_quality(&t.world, &plain, &j, SCORES),
        &[&t.judge],
        NOT_INITIALIZED,
    );

    // Not yet paid.
    let (pending, n) = t.locked(Some(&j));
    t.world.refused(
        "not yet paid",
        attest_quality(&t.world, &pending, &j, SCORES),
        &[&t.judge],
        JOB_NOT_PAID,
    );

    // Declined: the rating account is gone.
    t.world.ok(
        "decline",
        with_rating(sol_cancel(&t.c(), n, &t.specialist.pubkey()), &pending),
        &[&t.specialist],
    );
    t.world.refused(
        "refunded",
        attest_quality(&t.world, &pending, &j, SCORES),
        &[&t.judge],
        NOT_INITIALIZED,
    );
    for escrow in [plain, pending] {
        assert!(!t.world.exists(&attestation_address(&escrow)));
    }
}

#[test]
fn attest_refuses_every_wrong_account_and_score() {
    let mut t = Court::new();
    let j = t.j();
    let escrow = t.paid(Some(&j));
    let other = t.paid(Some(&j));
    let primary_job = t.paid(Some(&t.primary.pubkey()));
    let unregistered_job = t.paid(Some(&t.stranger.pubkey()));
    let good = attest_quality(&t.world, &escrow, &j, SCORES);

    t.world.refused(
        "too few accounts",
        {
            let mut ix = good.clone();
            ix.accounts.truncate(4);
            ix
        },
        &[&t.judge],
        NOT_ENOUGH_KEYS,
    );
    t.world.refused(
        "short data",
        with_args(good.clone(), &[5; 4]),
        &[&t.judge],
        102,
    );
    for scores in [[0, 5, 5, 5, 5], [5, 5, 5, 5, 11], [5, 5, 255, 5, 5]] {
        t.world.refused(
            "score out of range",
            attest_quality(&t.world, &escrow, &j, scores),
            &[&t.judge],
            ATTESTATION_SCORE_OUT_OF_RANGE,
        );
    }
    t.world.refused(
        "judge did not sign",
        not_signed(good.clone(), 3),
        &[&t.stranger],
        NOT_SIGNER,
    );
    t.world.refused(
        "judge read-only",
        read_only(good.clone(), 3),
        &[&t.stranger, &t.judge],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "rating read-only",
        read_only(good.clone(), 1),
        &[&t.judge],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "attestation read-only",
        read_only(good.clone(), 0),
        &[&t.judge],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "attestation address of another job",
        swap(good.clone(), 0, attestation_address(&other)),
        &[&t.judge],
        CONSTRAINT_SEEDS,
    );
    t.world.refused(
        "rating of another job with this job's attestation address",
        // Names the other job's slot, so only the address is wrong.
        swap(
            attest_quality_of(
                &escrow,
                &j,
                SCORES,
                t.world.opened_slot(&rating_address(&other)),
            ),
            1,
            rating_address(&other),
        ),
        &[&t.judge],
        CONSTRAINT_SEEDS,
    );
    t.world.refused(
        "a wallet as rating",
        swap(good.clone(), 1, t.stranger.pubkey()),
        &[&t.judge],
        WRONG_OWNER,
    );
    t.world.refused(
        "an agent record as rating",
        swap(good.clone(), 1, agent(&j)),
        &[&t.judge],
        DISCRIMINATOR_MISMATCH,
    );
    let copy = Pubkey::new_from_array([77; 32]);
    let genuine = t.world.svm.get_account(&rating_address(&escrow)).unwrap();
    t.world.set(copy, genuine);
    t.world.refused(
        "a copy of the rating at another address",
        swap(good.clone(), 1, copy),
        &[&t.judge],
        CONSTRAINT_SEEDS,
    );
    t.world.refused(
        "another judge's agent record",
        swap(good.clone(), 2, agent(&t.rival.pubkey())),
        &[&t.judge],
        CONSTRAINT_SEEDS,
    );
    t.world.refused(
        "the rating as the judge's agent record",
        swap(good.clone(), 2, rating_address(&escrow)),
        &[&t.judge],
        DISCRIMINATOR_MISMATCH,
    );
    t.world.refused(
        "not the system program",
        swap(good.clone(), 4, escrow::id()),
        &[&t.judge],
        INVALID_PROGRAM_ID,
    );
    // A named judge that is registered, but not as an attestation agent.
    t.world.refused(
        "a primary agent named as judge",
        attest_quality(&t.world, &primary_job, &t.primary.pubkey(), SCORES),
        &[&t.primary],
        NOT_ATTESTATION_AGENT,
    );
    // A named judge that is not registered at all.
    t.world.refused(
        "an unregistered wallet named as judge",
        attest_quality(&t.world, &unregistered_job, &t.stranger.pubkey(), SCORES),
        &[&t.stranger],
        NOT_INITIALIZED,
    );
    for escrow in [escrow, other, primary_job, unregistered_job] {
        assert!(!t.world.exists(&attestation_address(&escrow)));
    }
    // The good call still goes through.
    t.world.ok("attest", good, &[&t.judge]);
}

#[test]
fn a_job_can_be_attested_once_its_rating_is_final() {
    let mut t = Court::new();
    let j = t.j();
    let escrow = t.paid(Some(&j));
    let rating = rating_address(&escrow);
    let settled = t.world.rating(&rating).settled_slot;
    t.world.warp(settled + RATING_COMMIT_SLOTS + 1);
    t.world.ok(
        "expire",
        expire_rating(&rating, &j, &t.specialist.pubkey(), &t.c()),
        &[&t.judge],
    );
    t.world.ok(
        "attest",
        attest_quality(&t.world, &escrow, &j, SCORES),
        &[&t.judge],
    );
    // The attestation outlives the rating account.
    t.world
        .ok("close", close_rating(&rating, &t.c()), &[&t.consumer]);
    t.world.ok(
        "confirm",
        resolve_attestation(&escrow, &j, &t.c(), true),
        &[&t.consumer],
    );
    assert_eq!(
        t.world
            .attestation(&attestation_address(&escrow))
            .resolution,
        1
    );
}

#[test]
fn s4_s5_only_the_jobs_buyer_resolves_and_only_once() {
    for confirm in [true, false] {
        let mut t = Court::new();
        let j = t.j();
        t.world.set_reputation(&j, 6_000);
        let escrow = t.paid(Some(&j));
        t.world.ok(
            "attest",
            attest_quality(&t.world, &escrow, &j, SCORES),
            &[&t.judge],
        );
        let address = attestation_address(&escrow);

        // S4: nobody but the buyer.
        for who in [&t.specialist, &t.judge, &t.rival, &t.stranger] {
            for verdict in [true, false] {
                t.world.refused(
                    "someone else resolves",
                    resolve_attestation(&escrow, &j, &who.pubkey(), verdict),
                    &[who],
                    UNAUTHORISED_SIGNER,
                );
            }
        }
        t.world.refused(
            "the buyer named, not signing",
            not_signed(resolve_attestation(&escrow, &j, &t.c(), confirm), 2),
            &[&t.stranger],
            NOT_SIGNER,
        );
        assert_eq!(t.world.attestation(&address).resolution, 0);
        assert_eq!(t.standing(&j), (6_000, 0));

        let label = if confirm {
            "confirm_attestation"
        } else {
            "dispute_attestation"
        };
        t.world.ok(
            label,
            resolve_attestation(&escrow, &j, &t.c(), confirm),
            &[&t.consumer],
        );
        if confirm {
            assert_eq!(t.world.attestation(&address).resolution, 1);
            // Accuracy up by 10.00; a top score folded into reputation.
            assert_eq!(t.standing(&j), ((6_000 * 9 + 10_000) / 10, 1_000));
        } else {
            assert_eq!(t.world.attestation(&address).resolution, 2);
            assert_eq!(t.standing(&j), (6_000 - RATING_EXPIRE_PENALTY, 0));
        }

        // S5: once.
        let after = t.standing(&j);
        for verdict in [true, false] {
            t.world.refused(
                "resolve again",
                resolve_attestation(&escrow, &j, &t.c(), verdict),
                &[&t.consumer],
                ATTESTATION_ALREADY_RESOLVED,
            );
        }
        assert_eq!(t.standing(&j), after);
        t.world.report("Attestation resolved");
    }
}

#[test]
fn resolve_refuses_every_wrong_account() {
    let mut t = Court::new();
    let j = t.j();
    let escrow = t.paid(Some(&j));
    let unattested = t.paid(Some(&j));
    t.world.ok(
        "attest",
        attest_quality(&t.world, &escrow, &j, SCORES),
        &[&t.judge],
    );
    let good = resolve_attestation(&escrow, &j, &t.c(), true);

    t.world.refused(
        "too few accounts",
        {
            let mut ix = good.clone();
            ix.accounts.truncate(2);
            ix
        },
        &[&t.stranger],
        NOT_ENOUGH_KEYS,
    );
    t.world.refused(
        "attestation read-only",
        read_only(good.clone(), 0),
        &[&t.consumer],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "judge's record read-only",
        read_only(good.clone(), 1),
        &[&t.consumer],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "no attestation at the address",
        swap(good.clone(), 0, attestation_address(&unattested)),
        &[&t.consumer],
        NOT_INITIALIZED,
    );
    t.world.refused(
        "the rating as attestation",
        swap(good.clone(), 0, rating_address(&escrow)),
        &[&t.consumer],
        DISCRIMINATOR_MISMATCH,
    );
    let copy = Pubkey::new_from_array([78; 32]);
    let genuine = t
        .world
        .svm
        .get_account(&attestation_address(&escrow))
        .unwrap();
    t.world.set(copy, genuine);
    t.world.refused(
        "a copy of the attestation at another address",
        swap(good.clone(), 0, copy),
        &[&t.consumer],
        CONSTRAINT_SEEDS,
    );
    t.world.refused(
        "another judge's record",
        swap(good.clone(), 1, agent(&t.rival.pubkey())),
        &[&t.consumer],
        CONSTRAINT_SEEDS,
    );
    t.world.refused(
        "the attestation as the judge's record",
        swap(good.clone(), 1, attestation_address(&escrow)),
        &[&t.consumer],
        DISCRIMINATOR_MISMATCH,
    );
    assert_eq!(t.standing(&j), (0, 0));
    assert_eq!(t.standing(&t.rival.pubkey()), (0, 0));
    t.world.ok("confirm", good, &[&t.consumer]);
    assert_eq!(t.standing(&j), (1_000, 1_000));
}

#[test]
fn a_job_the_specialist_never_agreed_to_rate_cannot_be_attested() {
    let mut t = Court::new();
    let j = t.j();
    let (escrow, n) = t.locked(Some(&j));
    t.world.ok(
        "release, not accepted",
        with_rating(
            sol_payout(&t.c(), &t.specialist.pubkey(), n, &t.c(), None),
            &escrow,
        ),
        &[&t.consumer],
    );
    assert!(!t.world.exists(&rating_address(&escrow)));
    t.world.refused(
        "attest a job that is paid but not rated",
        attest_quality(&t.world, &escrow, &j, SCORES),
        &[&t.judge],
        NOT_INITIALIZED,
    );
    assert!(!t.world.exists(&attestation_address(&escrow)));
}

#[test]
fn a_resolved_attestation_can_be_closed_by_its_judge() {
    for confirm in [true, false] {
        let mut t = Court::new();
        let j = t.j();
        let escrow = t.paid(Some(&j));
        let address = attestation_address(&escrow);
        t.world.ok(
            "attest",
            attest_quality(&t.world, &escrow, &j, SCORES),
            &[&t.judge],
        );
        let good = close_attestation(&escrow, &j);

        // Unresolved and inside the window: not yet.
        t.world.refused(
            "close an unresolved attestation",
            good.clone(),
            &[&t.judge],
            ATTESTATION_NOT_CLOSABLE,
        );
        t.world.ok(
            "resolve",
            resolve_attestation(&escrow, &j, &t.c(), confirm),
            &[&t.consumer],
        );
        let standing = t.standing(&j);

        for who in [&t.consumer, &t.rival, &t.stranger] {
            t.world.refused(
                "someone else closes",
                close_attestation(&escrow, &who.pubkey()),
                &[who],
                UNAUTHORISED_SIGNER,
            );
        }
        t.world.refused(
            "judge did not sign",
            not_signed(good.clone(), 1),
            &[&t.stranger],
            NOT_SIGNER,
        );
        t.world.refused(
            "attestation read-only",
            read_only(good.clone(), 0),
            &[&t.judge],
            CONSTRAINT_MUT,
        );
        t.world.refused(
            "judge read-only",
            read_only(good.clone(), 1),
            &[&t.stranger, &t.judge],
            CONSTRAINT_MUT,
        );
        t.world.refused(
            "the rating as attestation",
            swap(good.clone(), 0, rating_address(&escrow)),
            &[&t.judge],
            DISCRIMINATOR_MISMATCH,
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

        let rent = t.world.lamports(&address);
        let before = t.world.lamports(&j);
        t.world.ok("close_attestation", good.clone(), &[&t.judge]);
        assert_eq!(t.world.lamports(&j) - before, rent - 5_000);
        assert!(!t.world.exists(&address));
        assert!(t.world.data(&address).is_empty());
        // Closing changes nothing on the judge's record, and it is gone.
        assert_eq!(t.standing(&j), standing);
        t.world
            .refused("close twice", good, &[&t.judge], NOT_INITIALIZED);
        // Closing does not make room for a second attestation of this job,
        // which the buyer could confirm again.
        assert!(t.world.rating(&rating_address(&escrow)).attested);
        t.world.refused(
            "attest the same job again after closing",
            attest_quality(&t.world, &escrow, &j, [10; 5]),
            &[&t.judge],
            ALREADY_ATTESTED,
        );
        for verdict in [true, false] {
            t.world.refused(
                "resolve a closed attestation",
                resolve_attestation(&escrow, &j, &t.c(), verdict),
                &[&t.consumer],
                NOT_INITIALIZED,
            );
        }
        t.world.report("Close attestation");
    }
}

#[test]
fn an_unresolved_attestation_can_be_closed_only_after_its_window() {
    let mut t = Court::new();
    let j = t.j();
    let escrow = t.paid(Some(&j));
    t.world.warp(t.world.slot() + 500);
    t.world.ok(
        "attest",
        attest_quality(&t.world, &escrow, &j, SCORES),
        &[&t.judge],
    );
    let created = t
        .world
        .attestation(&attestation_address(&escrow))
        .created_slot;
    assert_eq!(created, t.world.slot());

    t.world.warp(created + RATING_COMMIT_SLOTS);
    t.world.refused(
        "close in the last slot of the window",
        close_attestation(&escrow, &j),
        &[&t.judge],
        ATTESTATION_NOT_CLOSABLE,
    );
    t.world.warp(created + RATING_COMMIT_SLOTS + 1);
    t.world.ok(
        "close one slot after the window",
        close_attestation(&escrow, &j),
        &[&t.judge],
    );
    assert!(!t.world.exists(&attestation_address(&escrow)));
    assert_eq!(t.standing(&j), (0, 0));
    // The consumer has nothing left to dispute.
    t.world.refused(
        "dispute after the judge closed it",
        resolve_attestation(&escrow, &j, &t.c(), false),
        &[&t.consumer],
        NOT_INITIALIZED,
    );
}

#[test]
fn an_attestation_of_a_judge_that_deregistered_is_still_resolved() {
    for confirm in [true, false] {
        let mut t = Court::new();
        let j = t.j();
        let escrow = t.paid(Some(&j));
        t.world.ok(
            "attest",
            attest_quality(&t.world, &escrow, &j, SCORES),
            &[&t.judge],
        );
        t.world.deregister(&key(4));
        assert!(!t.world.exists(&agent(&j)));

        // The judge's agent address is still checked.
        t.world.refused(
            "another judge's record for the deregistered judge",
            swap(
                resolve_attestation(&escrow, &j, &t.c(), confirm),
                1,
                agent(&t.rival.pubkey()),
            ),
            &[&t.consumer],
            CONSTRAINT_SEEDS,
        );
        t.world.refused(
            "a wallet for the deregistered judge",
            swap(
                resolve_attestation(&escrow, &j, &t.c(), confirm),
                1,
                t.stranger.pubkey(),
            ),
            &[&t.consumer],
            CONSTRAINT_SEEDS,
        );
        t.world.refused(
            "someone else resolves",
            resolve_attestation(&escrow, &j, &t.stranger.pubkey(), confirm),
            &[&t.stranger],
            UNAUTHORISED_SIGNER,
        );
        t.world.ok(
            "resolve, judge deregistered",
            resolve_attestation(&escrow, &j, &t.c(), confirm),
            &[&t.consumer],
        );
        assert_eq!(
            t.world
                .attestation(&attestation_address(&escrow))
                .resolution,
            if confirm { 1 } else { 2 }
        );
        // Nothing was created at the judge's agent address, and no other
        // record moved.
        assert!(!t.world.exists(&agent(&j)));
        assert_eq!(t.standing(&t.rival.pubkey()), (0, 0));
        t.world.refused(
            "resolve again",
            resolve_attestation(&escrow, &j, &t.c(), !confirm),
            &[&t.consumer],
            ATTESTATION_ALREADY_RESOLVED,
        );
        // The judge can still take its rent back.
        t.world
            .ok("close", close_attestation(&escrow, &j), &[&t.judge]);
    }
}

#[test]
fn a_closed_attestation_frees_the_address_for_a_later_job() {
    let mut t = Court::new();
    let j = t.j();
    let escrow = t.paid(Some(&j));
    let rating = rating_address(&escrow);
    t.world.ok(
        "attest",
        attest_quality(&t.world, &escrow, &j, SCORES),
        &[&t.judge],
    );
    t.world.ok(
        "dispute",
        resolve_attestation(&escrow, &j, &t.c(), false),
        &[&t.consumer],
    );
    t.world
        .ok("close", close_attestation(&escrow, &j), &[&t.judge]);
    // Finish and close the first job's rating, then reuse payer and nonce.
    let settled = t.world.rating(&rating).settled_slot;
    t.world.warp(settled + RATING_COMMIT_SLOTS + 1);
    t.world.ok(
        "expire",
        expire_rating(&rating, &j, &t.specialist.pubkey(), &t.c()),
        &[&t.judge],
    );
    t.world.ok(
        "close rating",
        close_rating(&rating, &t.c()),
        &[&t.consumer],
    );
    t.next_nonce = 1;
    assert_eq!(t.paid(Some(&j)), escrow);
    t.world.ok(
        "attest again",
        attest_quality(&t.world, &escrow, &j, [3; 5]),
        &[&t.judge],
    );
    let fresh = t.world.attestation(&attestation_address(&escrow));
    assert_eq!((fresh.scores, fresh.resolution), ([3; 5], 0));
}

/// A judge that has switched its agent record off does not attest until it
/// switches it on again.
#[test]
fn a_judge_whose_record_is_not_active_cannot_attest() {
    let mut t = Court::new();
    let j = t.j();
    let escrow = t.paid(Some(&j));
    let rate = t.world.agent(&j).rate_lamports;
    let floor = t.world.agent(&j).min_reputation;
    t.world.ok(
        "switch the judge off",
        update_agent(&j, rate, floor, false),
        &[&t.judge],
    );
    t.world.refused(
        "attest while not active",
        attest_quality(&t.world, &escrow, &j, SCORES),
        &[&t.judge],
        JUDGE_NOT_ACTIVE,
    );
    assert!(!t.world.rating(&rating_address(&escrow)).attested);
    t.world.ok(
        "switch the judge on",
        update_agent(&j, rate, floor, true),
        &[&t.judge],
    );
    t.world.ok(
        "attest",
        attest_quality(&t.world, &escrow, &j, SCORES),
        &[&t.judge],
    );
    // An attestation made while active is still resolved after the judge
    // switches off.
    t.world.ok(
        "switch the judge off again",
        update_agent(&j, rate, floor, false),
        &[&t.judge],
    );
    t.world.ok(
        "confirm",
        resolve_attestation(&escrow, &j, &t.c(), true),
        &[&t.consumer],
    );
    assert_eq!(t.standing(&j), (1_000, 1_000));
}
