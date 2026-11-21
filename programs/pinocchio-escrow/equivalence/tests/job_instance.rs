//! What is signed for one rated job cannot be used on another.
//!
//! An escrow address is free again once its escrow has ended, and so is the
//! rating address derived from it: the same payer can lock again under the
//! same nonce, for the same payee. The two jobs then share every address.
//! What tells them apart is the slot the rating was opened in. A rated
//! escrow cannot end in that slot, so two ratings at one address never share
//! it, and `accept_rating`, the commitments and `attest_quality` all name it.
//!
//! The case that matters: a specialist signs `accept_rating`, or a settle or
//! claim, for a job it read, the transaction is held back, the payer ends that
//! job and locks a different one at the same address (another amount, another
//! judge), and the held transaction then lands. It must not agree to the new
//! job. Every exit of a rated escrow, `accept_rating`, `commit_rating`,
//! `attest_quality` and the consumer's decision on an attestation therefore
//! name the job.
mod support;

use {
    anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction},
    escrow::{state::AgentType, USDC_MAINNET_MINT},
    solana_keypair::Keypair,
    solana_signer::Signer,
    support::*,
};

const RATING_JUST_OPENED: u32 = 6050;
const RATING_JOB_MISMATCH: u32 = 6051;
const SALT: [u8; 32] = [0x5C; 32];

#[test]
fn an_acceptance_signed_for_one_job_is_refused_for_the_next_at_the_same_address() {
    let mut world = World::new();
    let (consumer, specialist, judge_a, judge_b) = (
        world.wallet(1),
        world.wallet(2),
        world.wallet(4),
        world.wallet(5),
    );
    let (c, s) = (consumer.pubkey(), specialist.pubkey());
    world.register(&specialist, AgentType::Primary);
    let record = world.svm.get_account(&agent(&s));
    let n = nonce(1);
    let escrow = sol_escrow(&c, n);
    let rating = rating_address(&escrow);

    // Job A: 1,000,000 lamports, judge A. The specialist reads it and signs
    // its agreement, which is not processed yet.
    world.ok(
        "lock A",
        sol_lock(&c, &s, 1_000_000, n, false),
        &[&consumer],
    );
    world.ok(
        "open A",
        open_rating(&escrow, &c, Some(&judge_a.pubkey())),
        &[&consumer],
    );
    let job_a = world.rating(&rating);
    let signed_for_a = accept_rating(&world, &rating, &s);

    // The payer ends job A (paid, and unrated because nobody agreed) and
    // locks job B under the same nonce: one lamport, another judge.
    world.ok(
        "release A",
        with_rating(sol_payout(&c, &s, n, &c, None), &escrow),
        &[&consumer],
    );
    assert!(!world.exists(&rating) && !world.exists(&escrow));
    world.ok("lock B", sol_lock(&c, &s, 1, n, false), &[&consumer]);
    world.ok(
        "open B",
        open_rating(&escrow, &c, Some(&judge_b.pubkey())),
        &[&consumer],
    );
    let job_b = world.rating(&rating);
    // Same payer, nonce, specialist and addresses; a different job.
    assert_eq!(
        (job_a.escrow, job_a.consumer, job_a.specialist),
        (job_b.escrow, job_b.consumer, job_b.specialist)
    );
    assert_ne!(job_a.judge, job_b.judge);
    assert!(job_b.opened_slot > job_a.opened_slot);

    // The agreement signed for A does not apply to B.
    world.refused(
        "acceptance signed for job A, on job B",
        signed_for_a,
        &[&specialist],
        RATING_JOB_MISMATCH,
    );
    for wrong in [0, job_b.opened_slot - 1, job_b.opened_slot + 1, u64::MAX] {
        world.refused(
            "acceptance naming another slot",
            accept_rating_of(&rating, &s, wrong),
            &[&specialist],
            RATING_JOB_MISMATCH,
        );
    }
    {
        // The slot is required: the old call without data is refused.
        let mut bare = accept_rating_of(&rating, &s, job_b.opened_slot);
        bare.data.truncate(8);
        assert!(world.send(&[bare], &[&specialist]).is_err());
    }
    assert!(!world.rating(&rating).accepted);

    // A fresh agreement, made for B, works.
    world.ok(
        "acceptance signed for job B",
        accept_rating(&world, &rating, &s),
        &[&specialist],
    );
    assert!(world.rating(&rating).accepted);
    world.ok(
        "release B",
        with_rating(sol_payout(&c, &s, n, &c, None), &escrow),
        &[&consumer],
    );
    let rated = world.rating(&rating);
    assert_eq!((rated.state, rated.paid), (OPEN, 1));
    assert_eq!(world.svm.get_account(&agent(&s)), record);
}

#[test]
fn a_commitment_or_attestation_made_for_one_job_is_refused_for_the_next() {
    let mut world = World::new();
    let (consumer, specialist, judge, anyone) = (
        world.wallet(1),
        world.wallet(2),
        world.wallet(4),
        world.wallet(6),
    );
    let (c, s, j) = (consumer.pubkey(), specialist.pubkey(), judge.pubkey());
    world.register(&specialist, AgentType::Primary);
    world.register(&judge, AgentType::Attestation);
    let n = nonce(1);
    let escrow = sol_escrow(&c, n);
    let rating = rating_address(&escrow);
    let paid_job = |world: &mut World| {
        world.ok("lock", sol_lock(&c, &s, 1_000_000, n, true), &[&consumer]);
        world.ok("open", open_rating(&escrow, &c, Some(&j)), &[&consumer]);
        world.ok(
            "settle",
            with_rating(sol_payout(&c, &s, n, &s, Some(600_000)), &escrow),
            &[&specialist],
        );
    };

    // Job A is paid. The consumer prepares a commitment for it and the judge
    // signs scores for it; neither is processed.
    paid_job(&mut world);
    let job_a = world.rating(&rating).opened_slot;
    let committed_for_a =
        commit_rating_of(&rating, &c, commitment(&world, &rating, &c, 1, SALT), job_a);
    let attested_for_a = attest_quality(&world, &escrow, &j, [1; 5]);

    // Job A's rating runs out and is closed. Job B takes the same address.
    world.warp(world.slot() + RATING_COMMIT_SLOTS + 1);
    world.ok(
        "expire A",
        expire_rating(&rating, &anyone.pubkey(), &s, &c),
        &[&anyone],
    );
    world.ok("close A", close_rating(&rating, &c), &[&consumer]);
    paid_job(&mut world);
    let job_b = world.rating(&rating).opened_slot;
    assert_ne!(job_a, job_b);

    // The judge's scores for A are not scores for B.
    world.refused(
        "attestation signed for job A, on job B",
        attested_for_a,
        &[&judge],
        RATING_JOB_MISMATCH,
    );
    assert!(!world.exists(&attestation_address(&escrow)));
    world.ok(
        "attestation signed for job B",
        attest_quality(&world, &escrow, &j, [9; 5]),
        &[&judge],
    );

    // A commitment sent for A is refused on B before anything is stored, so
    // it cannot take the consumer's one place for B's commitment.
    world.refused(
        "commitment sent for job A, on job B",
        committed_for_a,
        &[&consumer],
        RATING_JOB_MISMATCH,
    );
    assert_eq!(world.rating(&rating).consumer_commitment, [0; 32]);
    for wrong in [0, job_b - 1, job_b + 1, u64::MAX] {
        world.refused(
            "commitment naming another slot",
            commit_rating_of(&rating, &c, commitment(&world, &rating, &c, 1, SALT), wrong),
            &[&consumer],
            RATING_JOB_MISMATCH,
        );
    }
    {
        // The slot is required: a commitment alone is refused.
        let mut bare = commit_rating_of(&rating, &c, [7; 32], job_b);
        bare.data.truncate(8 + 32);
        assert!(world.send(&[bare], &[&consumer]).is_err());
    }
    assert_eq!(world.rating(&rating).consumer_commitment, [0; 32]);

    // Both commit for B and reveal.
    world.ok(
        "commit, consumer",
        commit_rating_of(&rating, &c, commitment(&world, &rating, &c, 1, SALT), job_b),
        &[&consumer],
    );
    world.ok(
        "commit, specialist",
        commit_rating_of(&rating, &s, commitment(&world, &rating, &s, 8, SALT), job_b),
        &[&specialist],
    );
    world.ok(
        "reveal, consumer",
        reveal_rating(&rating, &c, &s, &c, 1, SALT),
        &[&consumer],
    );
    world.ok(
        "reveal, specialist",
        reveal_rating(&rating, &s, &s, &c, 8, SALT),
        &[&specialist],
    );
}

#[test]
fn a_decision_on_one_jobs_attestation_is_refused_for_the_next() {
    let mut world = World::new();
    let (consumer, specialist, judge, anyone) = (
        world.wallet(1),
        world.wallet(2),
        world.wallet(4),
        world.wallet(6),
    );
    let (c, s, j) = (consumer.pubkey(), specialist.pubkey(), judge.pubkey());
    world.register(&specialist, AgentType::Primary);
    world.register(&judge, AgentType::Attestation);
    let n = nonce(1);
    let escrow = sol_escrow(&c, n);
    let rating = rating_address(&escrow);
    let attestation = attestation_address(&escrow);
    let attested_job = |world: &mut World, scores: [u8; 5]| {
        world.ok("lock", sol_lock(&c, &s, 1_000_000, n, true), &[&consumer]);
        world.ok("open", open_rating(&escrow, &c, Some(&j)), &[&consumer]);
        world.ok(
            "settle",
            with_rating(sol_payout(&c, &s, n, &s, Some(600_000)), &escrow),
            &[&specialist],
        );
        world.ok(
            "attest",
            attest_quality(world, &escrow, &j, scores),
            &[&judge],
        );
    };

    // Job A is paid and attested. The consumer signs a dispute of it, which
    // is not processed.
    attested_job(&mut world, [2; 5]);
    let job_a = world.opened_slot(&rating);
    assert_eq!(world.attestation(&attestation).opened_slot, job_a);
    let disputed_for_a = resolve_attestation_of(&escrow, &j, &c, false, job_a);

    // A's attestation and rating run out and are closed; job B, with the same
    // judge and consumer, is paid and attested at the same addresses.
    world.warp(world.slot() + RATING_COMMIT_SLOTS + 1);
    world.ok(
        "close attestation A",
        close_attestation(&escrow, &j),
        &[&judge],
    );
    world.ok(
        "expire A",
        expire_rating(&rating, &anyone.pubkey(), &s, &c),
        &[&anyone],
    );
    world.ok("close A", close_rating(&rating, &c), &[&consumer]);
    attested_job(&mut world, [9; 5]);
    let job_b = world.opened_slot(&rating);
    assert_ne!(job_a, job_b);
    assert_eq!(world.attestation(&attestation).opened_slot, job_b);
    let judge_record = world.svm.get_account(&agent(&j));

    // The dispute signed for A changes neither B's attestation nor the judge.
    world.refused(
        "dispute signed for job A, on job B",
        disputed_for_a,
        &[&consumer],
        RATING_JOB_MISMATCH,
    );
    for confirm in [true, false] {
        world.refused(
            "decision naming another slot",
            resolve_attestation_of(&escrow, &j, &c, confirm, job_b + 1),
            &[&consumer],
            RATING_JOB_MISMATCH,
        );
        let mut bare = resolve_attestation_of(&escrow, &j, &c, confirm, job_b);
        bare.data.truncate(8);
        assert!(world.send(&[bare], &[&consumer]).is_err());
    }
    assert_eq!(world.attestation(&attestation).resolution, 0);
    assert_eq!(world.svm.get_account(&agent(&j)), judge_record);

    // A decision made for B applies.
    world.ok(
        "confirm, signed for job B",
        resolve_attestation_of(&escrow, &j, &c, true, job_b),
        &[&consumer],
    );
    assert_eq!(world.attestation(&attestation).resolution, 1);
}

/// A seller's exit (`seller_exit`, without the rating account or the job)
/// prepared for job A and held back must not end job B at the same address:
/// not pay it and not open its rating. One prepared for B must. `wait` is
/// how long after the lock the seller may make that exit.
#[allow(clippy::too_many_arguments)]
fn a_held_seller_exit_cannot_end_the_next_job(
    world: &mut World,
    label: &str,
    escrow: Pubkey,
    lock: Instruction,
    payer: &Keypair,
    seller: &Keypair,
    release_by_payer: Instruction,
    seller_exit: Instruction,
    wait: u64,
) {
    let rating = rating_address(&escrow);
    let job = |world: &mut World| {
        world.ok("lock", lock.clone(), &[payer]);
        world.ok(
            "open",
            open_rating(&escrow, &payer.pubkey(), None),
            &[payer],
        );
        let opened = world.opened_slot(&rating);
        world.warp(world.slot() + wait);
        opened
    };

    // Job A. The seller signs its exit, which is not processed. The payer
    // ends A first (paid, unrated: the seller never agreed).
    let job_a = job(world);
    let held = with_rating_of(seller_exit.clone(), &escrow, job_a);
    world.ok(
        "payer ends job A",
        with_rating(release_by_payer, &escrow),
        &[payer],
    );
    assert!(!world.exists(&escrow) && !world.exists(&rating));

    // Job B, same accounts, an amount the held exit fits.
    let job_b = job(world);
    assert_ne!(job_a, job_b, "{label}");
    world.refused(
        &format!("{label} signed for job A, on job B"),
        held,
        &[seller],
        RATING_JOB_MISMATCH,
    );
    world.refused(
        &format!("{label} on a rated escrow, naming no job"),
        with_account(seller_exit.clone(), rating, true),
        &[seller],
        RATING_JOB_MISMATCH,
    );
    for wrong in [0, job_b - 1, job_b + 1, u64::MAX] {
        world.refused(
            &format!("{label} naming another slot"),
            with_rating_of(seller_exit.clone(), &escrow, wrong),
            &[seller],
            RATING_JOB_MISMATCH,
        );
    }
    let waiting = world.rating(&rating);
    assert_eq!(
        (waiting.state, waiting.paid),
        (AWAITING_SETTLEMENT, 0),
        "{label}"
    );

    // Prepared for B, it ends B and opens its rating.
    world.ok(
        &format!("{label} signed for job B"),
        with_rating_of(seller_exit, &escrow, job_b),
        &[seller],
    );
    assert!(!world.exists(&escrow), "{label}");
    let rated = world.rating(&rating);
    assert_eq!(rated.state, OPEN, "{label}");
    assert_eq!(rated.opened_slot, job_b, "{label}");
    assert!(rated.paid > 0, "{label}");
}

#[test]
fn a_settle_or_claim_signed_for_one_job_is_refused_for_the_next() {
    let mut world = World::new();
    let (consumer, specialist) = (world.wallet(1), world.wallet(2));
    let (c, s) = (consumer.pubkey(), specialist.pubkey());
    world.register(&specialist, AgentType::Primary);

    for (i, label, metered, actual, wait) in [
        (1, "SOL settle", true, Some(600_000), 1),
        (2, "SOL claim", false, None, CLAIM_WINDOW + 1),
    ] {
        let n = nonce(i);
        a_held_seller_exit_cannot_end_the_next_job(
            &mut world,
            label,
            sol_escrow(&c, n),
            sol_lock(&c, &s, 1_000_000, n, metered),
            &consumer,
            &specialist,
            sol_payout(&c, &s, n, &c, None),
            sol_payout(&c, &s, n, &s, actual),
            wait,
        );
    }

    let t = Tokens::install(
        &mut world,
        anchor_spl::token::spl_token::ID,
        USDC_MAINNET_MINT,
        consumer,
        specialist,
    );
    let (a, b) = (t.payer.pubkey(), t.payee.pubkey());
    for (i, label, metered, actual, wait) in [
        (3, "token settle", true, Some(600_000), 1),
        (4, "token claim", false, None, CLAIM_WINDOW + 1),
    ] {
        let n = nonce(i);
        a_held_seller_exit_cannot_end_the_next_job(
            &mut world,
            label,
            t.escrow(n),
            t.lock(1_000_000, n, metered),
            &t.payer,
            &t.payee,
            t.payout(n, &a, None),
            t.payout(n, &b, actual),
            wait,
        );
    }
}

/// `[lock, open_rating, exit]` in one transaction must be refused, and the
/// same exit must work once the slot has passed.
fn refused_in_the_opening_slot(
    world: &mut World,
    label: &str,
    lock: Instruction,
    open: Instruction,
    exit: Instruction,
    payer: &Keypair,
    authority: &Keypair,
) {
    let all: Vec<&Keypair> = if payer.pubkey() == authority.pubkey() {
        vec![payer]
    } else {
        vec![payer, authority]
    };
    let refused = world
        .send(&[lock.clone(), open.clone(), exit.clone()], &all)
        .err()
        .unwrap_or_else(|| panic!("{label}: ended in the slot its rating was opened in"));
    assert!(
        refused.contains(&format!("Custom({RATING_JUST_OPENED})")),
        "{label}: {refused}"
    );
    world.send(&[lock, open], &[payer]).unwrap();
    world
        .send(&[exit], &[authority])
        .unwrap_or_else(|error| panic!("{label}: one slot later: {error}"));
}

#[test]
fn a_rated_escrow_cannot_end_in_the_slot_its_rating_was_opened_in() {
    let mut world = World::new();
    let (consumer, specialist) = (world.wallet(1), world.wallet(2));
    let (c, s) = (consumer.pubkey(), specialist.pubkey());

    // SOL: release by the payer, metered settle by the payee, decline by
    // the payee.
    for (i, label, metered, exit, authority) in [
        (
            1,
            "SOL release",
            false,
            sol_payout(&c, &s, nonce(1), &c, None),
            &consumer,
        ),
        (
            2,
            "SOL settle",
            true,
            sol_payout(&c, &s, nonce(2), &s, Some(400_000)),
            &specialist,
        ),
        (
            3,
            "SOL decline",
            false,
            sol_cancel(&c, nonce(3), &s),
            &specialist,
        ),
    ] {
        let escrow = sol_escrow(&c, nonce(i));
        refused_in_the_opening_slot(
            &mut world,
            label,
            sol_lock(&c, &s, 1_000_000, nonce(i), metered),
            open_rating(&escrow, &c, None),
            with_rating(exit, &escrow),
            &consumer,
            authority,
        );
        assert!(!world.exists(&escrow));
    }

    // Token: the same three.
    let t = Tokens::install(
        &mut world,
        anchor_spl::token::spl_token::ID,
        USDC_MAINNET_MINT,
        consumer,
        specialist,
    );
    let (a, b) = (t.payer.pubkey(), t.payee.pubkey());
    for (i, label, metered, exit, authority) in [
        (
            1,
            "token release",
            false,
            t.payout(nonce(1), &a, None),
            &t.payer,
        ),
        (
            2,
            "token settle",
            true,
            t.payout(nonce(2), &b, Some(400_000)),
            &t.payee,
        ),
        (3, "token decline", false, t.cancel(nonce(3), &b), &t.payee),
    ] {
        let escrow = t.escrow(nonce(i));
        refused_in_the_opening_slot(
            &mut world,
            label,
            t.lock(1_000_000, nonce(i), metered),
            open_rating(&escrow, &a, None),
            with_rating(exit, &escrow),
            &t.payer,
            authority,
        );
        assert!(!world.exists(&escrow));
    }
}
