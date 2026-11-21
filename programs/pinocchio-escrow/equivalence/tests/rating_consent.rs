//! A rating opens only with the specialist's agreement.
//!
//! The property held here: no sequence of actions by a payer alone, or by a
//! payer and any third parties, changes the reputation, job counts or
//! accuracy of an agent that signed nothing. The payer can release a rated
//! escrow at any time, so without this rule anyone could pay a registered
//! agent one lamport and then rate it, or let the rating expire against it.
//!
//! Agreement is `accept_rating` while the escrow is locked, or the
//! specialist being the authority of the paid exit (settle or claim). A
//! release the payer authorises without `accept_rating` pays as usual and
//! closes the rating account, whoever else signed the transaction. The rule
//! is the same for SOL and token escrows.
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
    // The payer is the authority of all four, so only `accepted` counts: the
    // payee's signature next to the payer's is not agreement.
    for (accepted, cosigned, rated) in [
        (false, false, false),
        (true, false, true),
        (false, true, false),
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

/// Signer status is per transaction. A seller that only pays the fee of the
/// buyer's release, or signs it for another instruction, has not agreed to
/// this job being rated.
#[test]
fn the_specialists_signature_elsewhere_in_a_payer_release_is_not_agreement() {
    let mut world = World::new();
    let (consumer, specialist) = (world.wallet(1), world.wallet(2));
    let (c, s) = (consumer.pubkey(), specialist.pubkey());
    world.register(&specialist, AgentType::Primary);
    world.set_reputation(&s, 6_000);
    let record_before = world.svm.get_account(&agent(&s));
    let job = |world: &mut World, i: u8| {
        let escrow = sol_escrow(&c, nonce(i));
        world.ok(
            "lock",
            sol_lock(&c, &s, 1_000_000, nonce(i), false),
            &[&consumer],
        );
        world.ok("open", open_rating(&escrow, &c, None), &[&consumer]);
        (escrow, rating_address(&escrow))
    };
    let release = |i: u8| {
        with_rating(
            sol_payout(&c, &s, nonce(i), &c, None),
            &sol_escrow(&c, nonce(i)),
        )
    };

    // 1: the seller is only the fee payer of the buyer's release.
    let (escrow, rating) = job(&mut world, 1);
    let rent = world.lamports(&rating);
    let (payer_before, payee_before) = (world.lamports(&c), world.lamports(&s));
    world.ok(
        "release_escrow, rated, seller pays the fee",
        release(1),
        &[&specialist, &consumer],
    );
    assert!(!world.exists(&escrow));
    assert!(!world.exists(&rating));
    assert!(world.data(&rating).is_empty());
    // Paid as usual, less the two signature fees it paid itself.
    assert_eq!(world.lamports(&s) + 10_000 - payee_before, 975_000);
    // The rating's rent went back to the buyer with the escrow's.
    assert!(world.lamports(&c) - payer_before > rent);
    for who in [&consumer, &specialist] {
        world.refused(
            "commit on the job",
            commit_rating(&rating, &who.pubkey(), [3; 32]),
            &[who],
            NOT_INITIALIZED,
        );
    }
    world.warp(world.slot() + RATING_COMMIT_SLOTS + 1);
    world.refused(
        "expire the job",
        expire_rating(&rating, &c, &s, &c),
        &[&consumer],
        NOT_INITIALIZED,
    );
    assert_eq!(world.svm.get_account(&agent(&s)), record_before);

    // 2: the seller signs the same transaction to accept another job.
    let (_, first) = job(&mut world, 2);
    let (_, second) = job(&mut world, 3);
    world
        .send(
            &[accept_rating(&second, &s), release(2)],
            &[&consumer, &specialist],
        )
        .unwrap();
    assert!(!world.exists(&first));
    let other = world.rating(&second);
    assert_eq!((other.state, other.accepted), (AWAITING_SETTLEMENT, true));
    assert_eq!(world.svm.get_account(&agent(&s)), record_before);

    // The accepted one then opens on the buyer's release, as before.
    world.ok("release", release(3), &[&consumer]);
    assert_eq!(world.rating(&second).state, OPEN);
}

/// The token escrow has the same rule: with the payer as authority, the
/// payee signing the transaction changes nothing.
#[test]
fn a_token_release_by_the_payer_ignores_the_payees_signature_too() {
    for (program, mint) in [
        (anchor_spl::token::spl_token::ID, USDC_MAINNET_MINT),
        (TOKEN_2022_ID, PYUSD_MAINNET_MINT),
    ] {
        let mut world = World::new();
        let (payer, payee) = (world.wallet(1), world.wallet(2));
        let t = Tokens::install(&mut world, program, mint, payer, payee);
        let a = t.payer.pubkey();
        let escrow = t.escrow(nonce(1));
        let rating = rating_address(&escrow);
        world.ok("lock", t.lock(1_000_000, nonce(1), false), &[&t.payer]);
        world.ok("open", open_rating(&escrow, &a, None), &[&t.payer]);
        world.ok(
            "release_token_escrow, rated, seller pays the fee",
            with_rating(t.payout(nonce(1), &a, None), &escrow),
            &[&t.payee, &t.payer],
        );
        assert_eq!(t.balance(&world, &t.recipient), 975_000);
        assert!(!world.exists(&rating));
        assert!(!world.exists(&escrow));
    }
}

/// A Token-2022 issuer can take tokens out of a vault. A rated escrow whose
/// vault is empty at the exit paid nothing, so there is no paid job to rate:
/// the rating account is closed, even when the seller agreed.
#[test]
fn a_rated_exit_that_pays_nothing_does_not_open_the_rating() {
    let mut world = World::new();
    let (payer, payee) = (world.wallet(1), world.wallet(2));
    let t = Tokens::install(&mut world, TOKEN_2022_ID, PYUSD_MAINNET_MINT, payer, payee);
    let (a, b) = (t.payer.pubkey(), t.payee.pubkey());
    world.register(&t.payee, AgentType::Primary);
    let record_before = world.svm.get_account(&agent(&b));
    for i in [1, 2, 3] {
        let escrow = t.escrow(nonce(i));
        world.ok("lock", t.lock(1_000_000, nonce(i), i == 2), &[&t.payer]);
        world.ok("open", open_rating(&escrow, &a, None), &[&t.payer]);
        world.ok(
            "accept",
            accept_rating(&rating_address(&escrow), &b),
            &[&t.payee],
        );
        // 1 and 2: the vault was emptied. 3: one base unit is left.
        let mut vault = world.svm.get_account(&t.vault(nonce(i))).unwrap();
        let left: u64 = if i == 3 { 1 } else { 0 };
        vault.data[64..72].copy_from_slice(&left.to_le_bytes());
        world.set(t.vault(nonce(i)), vault);
    }
    let rated = |ix: Instruction, i: u8| with_rating(ix, &t.escrow(nonce(i)));
    let before = world.lamports(&a);
    let rent = world.lamports(&rating_address(&t.escrow(nonce(1))));

    world.ok(
        "release_token_escrow, rated, empty vault",
        rated(t.payout(nonce(1), &a, None), 1),
        &[&t.payer],
    );
    assert!(world.lamports(&a) - before > rent);
    world.ok(
        "settle_token_escrow, rated, empty vault",
        rated(t.payout(nonce(2), &b, Some(400_000)), 2),
        &[&t.payee],
    );
    for i in [1, 2] {
        let rating = rating_address(&t.escrow(nonce(i)));
        assert!(!world.exists(&t.escrow(nonce(i))));
        assert!(!world.exists(&rating));
        world.refused(
            "commit on a job that paid nothing",
            commit_rating(&rating, &a, [3; 32]),
            &[&t.payer],
            NOT_INITIALIZED,
        );
    }
    assert_eq!(t.balance(&world, &t.recipient), 0);

    // Anything paid at all is a paid job.
    world.ok(
        "release from a vault holding one unit",
        rated(t.payout(nonce(3), &a, None), 3),
        &[&t.payer],
    );
    let record = world.rating(&rating_address(&t.escrow(nonce(3))));
    assert_eq!((record.state, record.paid), (OPEN, 1));
    assert_eq!(world.svm.get_account(&agent(&b)), record_before);
}

/// Several rated jobs in one transaction on distinct escrows, covering both
/// values of the flag byte a rated escrow can have: 3 (metered and rated)
/// through settle, and 2 through release and claim.
#[test]
fn several_rated_jobs_in_one_transaction_each_keep_their_own_rating() {
    let mut world = World::new();
    let (consumer, specialist) = (world.wallet(1), world.wallet(2));
    let (c, s) = (consumer.pubkey(), specialist.pubkey());
    let escrow = |i: u8| sol_escrow(&c, nonce(i));
    let rating = |i: u8| rating_address(&escrow(i));
    let exit = |i: u8, signer: &Pubkey, actual: Option<u64>| {
        with_rating(sol_payout(&c, &s, nonce(i), signer, actual), &escrow(i))
    };

    // 1 is metered; 2 and 3 are fixed price.
    world
        .send(
            &[
                sol_lock(&c, &s, 1_000_000, nonce(1), true),
                open_rating(&escrow(1), &c, None),
                sol_lock(&c, &s, 2_000_000, nonce(2), false),
                open_rating(&escrow(2), &c, None),
                sol_lock(&c, &s, 3_000_000, nonce(3), false),
                open_rating(&escrow(3), &c, None),
            ],
            &[&consumer],
        )
        .unwrap();
    let flags = |world: &World, i: u8| world.data(&escrow(i))[SOL_ESCROW_FLAGS_AT];
    assert_eq!(flags(&world, 1), FLAG_METERED | FLAG_RATED);
    assert_eq!(flags(&world, 2), FLAG_RATED);
    assert_eq!(flags(&world, 3), FLAG_RATED);

    // A rating given to the wrong one of the three is refused.
    world.refused(
        "settle 1 with the rating of 2",
        with_account(
            sol_payout(&c, &s, nonce(1), &s, Some(600_000)),
            rating(2),
            true,
        ),
        &[&specialist],
        INVALID_RATING_ACCOUNT,
    );

    // The seller settles the metered job and accepts the second, in one
    // transaction; the buyer then releases the second.
    world
        .send(
            &[exit(1, &s, Some(600_000)), accept_rating(&rating(2), &s)],
            &[&specialist],
        )
        .unwrap();
    world.ok("release", exit(2, &c, None), &[&consumer]);
    // The seller claims the third after its claim window.
    world.refused(
        "claim inside the window",
        exit(3, &s, None),
        &[&specialist],
        6027,
    );
    world.warp(world.slot() + CLAIM_WINDOW + 1);
    world.ok("claim", exit(3, &s, None), &[&specialist]);

    for (i, paid, accepted) in [
        (1, 600_000, false),
        (2, 2_000_000, true),
        (3, 3_000_000, false),
    ] {
        assert!(!world.exists(&escrow(i)));
        let record = world.rating(&rating(i));
        assert_eq!(
            (record.escrow, record.state, record.paid, record.accepted),
            (escrow(i), OPEN, paid, accepted)
        );
    }
}
