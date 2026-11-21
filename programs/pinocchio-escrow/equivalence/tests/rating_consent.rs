//! A rating opens only with the specialist's agreement.
//!
//! The property held here: no sequence of actions by a payer alone, or by a
//! payer and any third parties, changes the reputation, job counts or
//! accuracy of an agent that signed nothing. The payer can release a rated
//! escrow at any time, so without this rule anyone could pay a registered
//! agent one lamport and then rate it, or let the rating expire against it.
//!
//! Agreement is `accept_rating` while the escrow is locked, or the
//! specialist's own signature on the paid exit (settle or claim). A payer
//! release without either pays as usual and closes the rating account.
mod support;

use {
    anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction},
    escrow::{
        state::AgentType, token_accounts::TOKEN_2022_ID, PROTOCOL_TREASURY, PYUSD_MAINNET_MINT,
        USDC_MAINNET_MINT,
    },
    solana_account::Account,
    solana_keypair::Keypair,
    solana_signer::Signer,
    support::*,
};

const SALT: [u8; 32] = [0xA7; 32];

struct Scene {
    world: World,
    /// Pays, opts in, and tries everything.
    attacker: Keypair,
    /// A registered agent that never signs anything.
    victim: Keypair,
    /// A registered attestation agent that works with the attacker.
    judge: Keypair,
    helper: Keypair,
}

impl Scene {
    fn new() -> Self {
        let mut world = World::new();
        let (attacker, victim, judge, helper) = (
            world.wallet(1),
            world.wallet(2),
            world.wallet(4),
            world.wallet(5),
        );
        world.register(&attacker, AgentType::Primary);
        world.register(&victim, AgentType::Both);
        world.register(&judge, AgentType::Attestation);
        world.set_reputation(&victim.pubkey(), 6_000);
        Self {
            world,
            attacker,
            victim,
            judge,
            helper,
        }
    }

    fn victim_record(&self) -> Option<Account> {
        self.world.svm.get_account(&agent(&self.victim.pubkey()))
    }
}

#[test]
fn a_payer_alone_cannot_move_the_record_of_an_agent_that_signed_nothing() {
    let mut t = Scene::new();
    let (a, v, j) = (t.attacker.pubkey(), t.victim.pubkey(), t.judge.pubkey());
    let untouched = t.victim_record();
    let victim_wallet = t.world.lamports(&v);

    // One lamport, locked, opted in (naming a friendly judge) and released in
    // a single transaction.
    let n = nonce(1);
    let escrow = sol_escrow(&a, n);
    let rating = rating_address(&escrow);
    let payer_before = t.world.lamports(&a);
    t.world
        .send(
            &[
                sol_lock(&a, &v, 1, n, false),
                open_rating(&escrow, &a, Some(&j)),
                with_rating(sol_payout(&a, &v, n, &a, None), &escrow),
            ],
            &[&t.attacker],
        )
        .unwrap();
    // The job was paid, and it is not rated: the rating account is gone and
    // its rent is back with the payer.
    assert_eq!(t.world.lamports(&v), victim_wallet + 1);
    assert!(!t.world.exists(&rating));
    assert!(!t.world.exists(&escrow));
    assert_eq!(payer_before - t.world.lamports(&a), 1 + 5_000);

    let commitment = commitment(&rating, &a, 1, SALT);
    t.world.refused(
        "commit",
        commit_rating(&rating, &a, commitment),
        &[&t.attacker],
        NOT_INITIALIZED,
    );
    t.world.refused(
        "reveal",
        reveal_rating(&rating, &a, &v, &a, 1, SALT),
        &[&t.attacker],
        NOT_INITIALIZED,
    );
    t.world.warp(t.world.slot() + 3 * RATING_COMMIT_SLOTS);
    for caller in [&t.attacker, &t.helper, &t.judge] {
        t.world.refused(
            "expire",
            expire_rating(&rating, &caller.pubkey(), &v, &a),
            &[caller],
            NOT_INITIALIZED,
        );
    }
    t.world.refused(
        "attest",
        attest_quality(&escrow, &j, [1; 5]),
        &[&t.judge],
        NOT_INITIALIZED,
    );
    t.world.refused(
        "close",
        close_rating(&rating, &a),
        &[&t.attacker],
        NOT_INITIALIZED,
    );
    assert_eq!(t.victim_record(), untouched);
}

#[test]
fn nobody_but_the_specialist_can_accept_and_a_locked_job_moves_no_record() {
    let mut t = Scene::new();
    let (a, v, j) = (t.attacker.pubkey(), t.victim.pubkey(), t.judge.pubkey());
    let untouched = t.victim_record();
    let n = nonce(1);
    let escrow = sol_escrow(&a, n);
    let rating = rating_address(&escrow);
    t.world
        .ok("lock", sol_lock(&a, &v, 1, n, true), &[&t.attacker]);
    t.world
        .ok("open", open_rating(&escrow, &a, Some(&j)), &[&t.attacker]);
    let locked_at = t.world.slot();

    // Accepting for the victim.
    for who in [&t.attacker, &t.helper, &t.judge] {
        t.world.refused(
            "someone else accepts",
            accept_rating(&rating, &who.pubkey()),
            &[who],
            UNAUTHORISED_SIGNER,
        );
    }
    t.world.refused(
        "the specialist named, not signing",
        not_signed(accept_rating(&rating, &v), 1),
        &[&t.attacker],
        NOT_SIGNER,
    );
    // Paying exits only the payee may sign.
    t.world.refused(
        "the payer settles",
        with_rating(sol_payout(&a, &v, n, &a, Some(1)), &escrow),
        &[&t.attacker],
        UNAUTHORISED_SIGNER,
    );
    // While it is locked nothing can be committed, expired or attested.
    t.world.warp(locked_at + 2 * RATING_COMMIT_SLOTS);
    t.world.refused(
        "commit",
        commit_rating(&rating, &a, [7; 32]),
        &[&t.attacker],
        JOB_NOT_PAID,
    );
    t.world.refused(
        "expire",
        expire_rating(&rating, &t.helper.pubkey(), &v, &a),
        &[&t.helper],
        JOB_NOT_PAID,
    );
    t.world.refused(
        "attest",
        attest_quality(&escrow, &j, [1; 5]),
        &[&t.judge],
        JOB_NOT_PAID,
    );
    assert!(!t.world.rating(&rating).accepted);

    // Whatever the payer does next ends the job without a rating: a refund
    // (the cancel window has long elapsed) closes it.
    t.world.ok(
        "refund",
        with_rating(sol_cancel(&a, n, &a), &escrow),
        &[&t.attacker],
    );
    assert!(!t.world.exists(&rating));
    assert_eq!(t.victim_record(), untouched);
}

#[test]
fn accept_rating_refuses_wrong_accounts_a_second_call_and_a_paid_job() {
    let mut world = World::new();
    let (consumer, specialist, stranger) = (world.wallet(1), world.wallet(2), world.wallet(3));
    let (c, s) = (consumer.pubkey(), specialist.pubkey());
    let agent_account = world.register(&stranger, AgentType::Primary);
    let n = nonce(1);
    let escrow = sol_escrow(&c, n);
    let rating = rating_address(&escrow);
    world.ok("lock", sol_lock(&c, &s, 1_000_000, n, true), &[&consumer]);
    world.refused(
        "no rating account yet",
        accept_rating(&rating, &s),
        &[&specialist],
        NOT_INITIALIZED,
    );
    world.ok("open", open_rating(&escrow, &c, None), &[&consumer]);
    let good = accept_rating(&rating, &s);

    world.refused(
        "too few accounts",
        {
            let mut ix = good.clone();
            ix.accounts.truncate(1);
            ix
        },
        &[&stranger],
        NOT_ENOUGH_KEYS,
    );
    world.refused(
        "rating read-only",
        read_only(good.clone(), 0),
        &[&specialist],
        CONSTRAINT_MUT,
    );
    world.refused(
        "a wallet as rating",
        swap(good.clone(), 0, stranger.pubkey()),
        &[&specialist],
        WRONG_OWNER,
    );
    world.refused(
        "an agent record as rating",
        swap(good.clone(), 0, agent_account),
        &[&specialist],
        DISCRIMINATOR_MISMATCH,
    );
    world.refused(
        "the escrow as rating",
        swap(good.clone(), 0, escrow),
        &[&specialist],
        DISCRIMINATOR_MISMATCH,
    );
    let copy = Pubkey::new_from_array([77; 32]);
    let genuine = world.svm.get_account(&rating).unwrap();
    world.set(copy, genuine);
    world.refused(
        "a copy of the rating at another address",
        swap(good.clone(), 0, copy),
        &[&specialist],
        CONSTRAINT_SEEDS,
    );
    world.refused(
        "the consumer accepts",
        accept_rating(&rating, &c),
        &[&consumer],
        UNAUTHORISED_SIGNER,
    );

    let before = world.data(&rating);
    world.ok("accept_rating", good.clone(), &[&specialist]);
    // One byte changed.
    let mut expected = before;
    expected[267] = 1;
    assert_eq!(world.data(&rating), expected);
    world.refused(
        "accept twice",
        good.clone(),
        &[&specialist],
        RATING_ALREADY_ACCEPTED,
    );

    // Once the job is paid there is nothing left to accept.
    world.ok(
        "release",
        with_rating(sol_payout(&c, &s, n, &c, None), &escrow),
        &[&consumer],
    );
    assert_eq!(world.rating(&rating).state, OPEN);
    world.refused(
        "accept a paid job",
        good,
        &[&specialist],
        RATING_NOT_AWAITING_SETTLEMENT,
    );
    world.report("Accept");
}

#[test]
fn a_payer_release_opens_the_rating_only_with_the_specialists_agreement() {
    // (accepted beforehand, payee co-signs the release) -> rated?
    for (accepted, cosigned, rated) in [
        (false, false, false),
        (true, false, true),
        (false, true, true),
        (true, true, true),
    ] {
        let mut world = World::new();
        let (consumer, specialist) = (world.wallet(1), world.wallet(2));
        let (c, s) = (consumer.pubkey(), specialist.pubkey());
        world.register(&specialist, AgentType::Primary);
        let n = nonce(1);
        let escrow = sol_escrow(&c, n);
        let rating = rating_address(&escrow);
        world.ok("lock", sol_lock(&c, &s, 1_000_000, n, false), &[&consumer]);
        world.ok("open", open_rating(&escrow, &c, None), &[&consumer]);
        if accepted {
            world.ok("accept", accept_rating(&rating, &s), &[&specialist]);
        }
        let (payee_before, treasury_before, payer_before) = (
            world.lamports(&s),
            world.lamports(&PROTOCOL_TREASURY),
            world.lamports(&c),
        );
        let escrow_lamports = world.lamports(&escrow);
        let rating_lamports = world.lamports(&rating);
        let mut release = with_rating(sol_payout(&c, &s, n, &c, None), &escrow);
        let signers: Vec<&Keypair> = if cosigned {
            release.accounts[2].is_signer = true;
            vec![&consumer, &specialist]
        } else {
            vec![&consumer]
        };
        let fee_paid = 5_000 * signers.len() as u64;
        // Without the rating account it is refused either way.
        world.refused(
            "release without the rating account",
            sol_payout(&c, &s, n, &c, None),
            &[&consumer],
            RATING_ACCOUNT_REQUIRED,
        );
        let label = if rated {
            "release_escrow, rated, accepted"
        } else {
            "release_escrow, rated, not accepted"
        };
        let sent = world.ok(label, release, &signers);

        // The money moves the same way in all four cases.
        assert_eq!(sent.events.len(), 1);
        assert_eq!(world.lamports(&s) - payee_before, 975_000);
        assert_eq!(world.lamports(&PROTOCOL_TREASURY) - treasury_before, 25_000);
        assert!(!world.exists(&escrow));
        let rent_back = if rated { 0 } else { rating_lamports };
        assert_eq!(
            world.lamports(&c) + 5_000 + fee_paid - payer_before,
            escrow_lamports - 1_000_000 + rent_back
        );
        if rated {
            let record = world.rating(&rating);
            assert_eq!((record.state, record.paid), (OPEN, 1_000_000));
            assert_eq!(record.accepted, accepted);
        } else {
            assert!(!world.exists(&rating));
            assert!(world.data(&rating).is_empty());
            assert_eq!(world.agent(&s).jobs_completed, 0);
        }
        world.report("Payer release of a rated escrow");
    }
}

fn token_consent(program: Pubkey, mint: Pubkey) {
    let mut world = World::new();
    let (payer, payee) = (world.wallet(1), world.wallet(2));
    let t = Tokens::install(&mut world, program, mint, payer, payee);
    let (a, b) = (t.payer.pubkey(), t.payee.pubkey());
    world.register(&t.payee, AgentType::Primary);
    let record_before = world.svm.get_account(&agent(&b));
    let rated = |ix: Instruction, i: u8| with_rating(ix, &t.escrow(nonce(i)));
    let rating_of = |i: u8| rating_address(&t.escrow(nonce(i)));

    // 1: lock, opt in and release in one transaction, never accepted.
    let start = world.lamports(&a);
    world
        .send(
            &[
                t.lock(1_000_000, nonce(1), false),
                open_rating(&t.escrow(nonce(1)), &a, None),
                rated(t.payout(nonce(1), &a, None), 1),
            ],
            &[&t.payer],
        )
        .unwrap();
    assert_eq!(t.balance(&world, &t.recipient), 975_000);
    assert_eq!(t.balance(&world, &t.treasury_token), 25_000);
    assert!(!world.exists(&rating_of(1)));
    assert!(!world.exists(&t.escrow(nonce(1))));
    assert!(!world.exists(&t.vault(nonce(1))));
    // Every rent is back with the payer.
    assert_eq!(start - world.lamports(&a), 5_000);
    world.refused(
        "commit on the unaccepted job",
        commit_rating(&rating_of(1), &a, [3; 32]),
        &[&t.payer],
        NOT_INITIALIZED,
    );

    // 2: accepted, then released by the payer.
    world.ok("lock", t.lock(1_000_000, nonce(2), false), &[&t.payer]);
    world.ok(
        "open",
        open_rating(&t.escrow(nonce(2)), &a, None),
        &[&t.payer],
    );
    world.refused(
        "the payer accepts for the payee",
        accept_rating(&rating_of(2), &a),
        &[&t.payer],
        UNAUTHORISED_SIGNER,
    );
    world.ok("accept", accept_rating(&rating_of(2), &b), &[&t.payee]);
    world.ok(
        "release",
        rated(t.payout(nonce(2), &a, None), 2),
        &[&t.payer],
    );
    let record = world.rating(&rating_of(2));
    assert_eq!(
        (record.state, record.paid, record.mint, record.accepted),
        (OPEN, 1_000_000, mint, true)
    );
    // Nothing above touched the payee's agent record: opening is not rating.
    assert_eq!(world.svm.get_account(&agent(&b)), record_before);
}

#[test]
fn usdc_payer_release_needs_the_specialists_agreement_to_open_the_rating() {
    token_consent(anchor_spl::token::spl_token::ID, USDC_MAINNET_MINT);
}

#[test]
fn pyusd_payer_release_needs_the_specialists_agreement_to_open_the_rating() {
    token_consent(TOKEN_2022_ID, PYUSD_MAINNET_MINT);
}
