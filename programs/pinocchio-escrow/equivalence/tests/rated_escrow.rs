//! Escrows opted into rating: `open_rating`, and what every exit of a rated
//! escrow does with the rating account, for SOL, classic SPL Token (USDC) and
//! Token-2022 (PYUSD) escrows. Runs against the built Pinocchio binary.
//!
//! An escrow that is not opted in is covered by the side-by-side suite
//! (`differential.rs`), which holds it to the Anchor reference unchanged.
//! Lamport conservation is asserted on every transaction by the harness.
mod support;

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
    },
    escrow::{
        state::AgentType, token_accounts::TOKEN_2022_ID, PROTOCOL_TREASURY, PYUSD_MAINNET_MINT,
        USDC_MAINNET_MINT,
    },
    solana_account::Account,
    solana_keypair::Keypair,
    solana_signer::Signer,
    support::*,
};

const AMOUNT: u64 = 1_000_000;
const FEE: u64 = 25_000;
const RATING_JOB_MISMATCH: u32 = 6051;

struct Sol {
    world: World,
    payer: Keypair,
    payee: Keypair,
    stranger: Keypair,
}

impl Sol {
    fn new() -> Self {
        let mut world = World::new();
        let (payer, payee, stranger) = (world.wallet(1), world.wallet(2), world.wallet(3));
        Self {
            world,
            payer,
            payee,
            stranger,
        }
    }

    fn escrow(&self, i: u8) -> Pubkey {
        sol_escrow(&self.payer.pubkey(), nonce(i))
    }

    fn lock(&mut self, i: u8, metered: bool) -> Pubkey {
        let ix = sol_lock(
            &self.payer.pubkey(),
            &self.payee.pubkey(),
            AMOUNT,
            nonce(i),
            metered,
        );
        self.world.ok("lock", ix, &[&self.payer]);
        self.escrow(i)
    }

    /// Lock and opt in, in the same slot.
    fn lock_rated(&mut self, i: u8, metered: bool) -> Pubkey {
        let escrow = self.lock(i, metered);
        let ix = open_rating(&escrow, &self.payer.pubkey(), None);
        self.world
            .ok("open_rating (SOL escrow)", ix, &[&self.payer]);
        escrow
    }

    fn payout(&self, i: u8, signer: &Keypair, actual: Option<u64>) -> Instruction {
        sol_payout(
            &self.payer.pubkey(),
            &self.payee.pubkey(),
            nonce(i),
            &signer.pubkey(),
            actual,
        )
    }

    fn cancel(&self, i: u8, authority: &Keypair) -> Instruction {
        sol_cancel(&self.payer.pubkey(), nonce(i), &authority.pubkey())
    }
}

fn rating_rent(world: &World) -> u64 {
    world.svm.minimum_balance_for_rent_exemption(RATING_LEN)
}

// ── open_rating ─────────────────────────────────────────────────────────────

#[test]
fn open_rating_creates_the_job_record_and_flags_the_escrow() {
    let mut t = Sol::new();
    let judge = key(4).pubkey();
    for (i, metered) in [(1, false), (2, true)] {
        let escrow = t.lock(i, metered);
        let before = t.world.data(&escrow);
        let payer_before = t.world.lamports(&t.payer.pubkey());
        assert_eq!(before[SOL_ESCROW_FLAGS_AT], metered as u8);

        let judge = (i == 1).then_some(&judge);
        t.world.ok(
            "open_rating",
            open_rating(&escrow, &t.payer.pubkey(), judge),
            &[&t.payer],
        );

        // Only the flag byte of the escrow changed, and only its rated bit.
        let after = t.world.data(&escrow);
        assert_eq!(after[SOL_ESCROW_FLAGS_AT], metered as u8 | FLAG_RATED);
        let mut expected = before.clone();
        expected[SOL_ESCROW_FLAGS_AT] |= FLAG_RATED;
        assert_eq!(after, expected);

        let address = rating_address(&escrow);
        let rating = t.world.rating(&address);
        assert_eq!(
            rating,
            Rating {
                escrow,
                consumer: t.payer.pubkey(),
                specialist: t.payee.pubkey(),
                judge: judge.copied().unwrap_or_default(),
                mint: Pubkey::default(),
                consumer_commitment: [0; 32],
                specialist_commitment: [0; 32],
                paid: 0,
                // The world moved on one slot after the opening.
                opened_slot: t.world.slot() - 1,
                settled_slot: 0,
                committed_slot: 0,
                state: AWAITING_SETTLEMENT,
                consumer_score: 0,
                specialist_score: 0,
                accepted: false,
                attested: false,
                bump: Pubkey::find_program_address(&[b"rating", escrow.as_ref()], &escrow::id()).1,
            }
        );
        // The payer funded exactly the rent of the rating account.
        let rent = rating_rent(&t.world);
        assert_eq!(t.world.lamports(&address), rent);
        assert_eq!(
            payer_before - t.world.lamports(&t.payer.pubkey()),
            rent + 5_000
        );
        assert_eq!(
            t.world.svm.get_account(&address).unwrap().owner,
            escrow::id()
        );
    }
    t.world.report("open_rating");
}

#[test]
fn open_rating_works_in_the_transaction_of_the_lock_and_on_a_prefunded_address() {
    let mut t = Sol::new();
    let escrow = t.escrow(1);
    // Anyone can send lamports to the rating address before it exists.
    t.world.set(
        rating_address(&escrow),
        Account {
            lamports: 1_234,
            ..Account::default()
        },
    );
    let lock = sol_lock(
        &t.payer.pubkey(),
        &t.payee.pubkey(),
        AMOUNT,
        nonce(1),
        false,
    );
    let open = open_rating(&escrow, &t.payer.pubkey(), None);
    t.world.send(&[lock, open], &[&t.payer]).unwrap();
    assert_eq!(
        t.world.rating(&rating_address(&escrow)).state,
        AWAITING_SETTLEMENT
    );
    assert_eq!(
        t.world.lamports(&rating_address(&escrow)),
        rating_rent(&t.world)
    );
}

#[test]
fn open_rating_is_refused_after_the_slot_of_the_lock() {
    let mut t = Sol::new();
    let escrow = t.lock(1, false);
    let locked_at = t.world.slot();
    t.world.warp(locked_at + 1);
    t.world.refused(
        "one slot later",
        open_rating(&escrow, &t.payer.pubkey(), None),
        &[&t.payer],
        RATING_OPT_IN_CLOSED,
    );
    t.world.warp(locked_at + CANCEL_WINDOW);
    t.world.refused(
        "much later",
        open_rating(&escrow, &t.payer.pubkey(), None),
        &[&t.payer],
        RATING_OPT_IN_CLOSED,
    );
    assert_eq!(t.world.data(&escrow)[SOL_ESCROW_FLAGS_AT], 0);
    assert!(!t.world.exists(&rating_address(&escrow)));
    // The escrow still ends as an escrow that is not rated does.
    t.world
        .ok("release", t.payout(1, &t.payer, None), &[&t.payer]);
}

#[test]
fn open_rating_refuses_every_wrong_account_and_argument() {
    let mut t = Sol::new();
    let (a, b, s) = (t.payer.pubkey(), t.payee.pubkey(), t.stranger.pubkey());
    let escrow = t.lock(1, false);
    let other = t.lock(2, false);
    let agent_account = t.world.register(&t.stranger, AgentType::Primary);
    let good = || open_rating(&escrow, &a, None);
    let (payer, stranger, payee) = (key(1), key(3), key(2));

    t.world.refused(
        "too few accounts",
        {
            let mut ix = good();
            ix.accounts.truncate(3);
            ix
        },
        &[&payer],
        NOT_ENOUGH_KEYS,
    );
    t.world
        .refused("short data", with_args(good(), &[0; 31]), &[&payer], 102);
    t.world.refused(
        "payer did not sign",
        not_signed(good(), 2),
        &[&stranger],
        NOT_SIGNER,
    );
    t.world.refused(
        "a stranger as payer",
        swap(good(), 2, s),
        &[&stranger],
        UNAUTHORISED_SIGNER,
    );
    t.world.refused(
        "the payee as payer",
        swap(good(), 2, b),
        &[&payee],
        UNAUTHORISED_SIGNER,
    );
    t.world.refused(
        "rating of another escrow",
        swap(good(), 0, rating_address(&other)),
        &[&payer],
        CONSTRAINT_SEEDS,
    );
    t.world.refused(
        "the escrow as its own rating",
        swap(good(), 0, escrow),
        &[&payer],
        CONSTRAINT_SEEDS,
    );
    t.world.refused(
        "rating read-only",
        read_only(good(), 0),
        &[&payer],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "escrow read-only",
        read_only(good(), 1),
        &[&payer],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "payer read-only",
        read_only(good(), 2),
        &[&stranger, &payer],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "not the system program",
        swap(good(), 3, escrow::id()),
        &[&payer],
        INVALID_PROGRAM_ID,
    );
    t.world.refused(
        "a wallet as escrow",
        swap(good(), 1, s),
        &[&payer],
        WRONG_OWNER,
    );
    t.world.refused(
        "nothing at the escrow address",
        swap(good(), 1, t.escrow(99)),
        &[&payer],
        NOT_INITIALIZED,
    );
    t.world.refused(
        "an agent record as escrow",
        swap(good(), 1, agent_account),
        &[&payer],
        DISCRIMINATOR_MISMATCH,
    );
    t.world.refused(
        "the payer as judge",
        open_rating(&escrow, &a, Some(&a)),
        &[&payer],
        INVALID_JUDGE,
    );
    t.world.refused(
        "the payee as judge",
        open_rating(&escrow, &a, Some(&b)),
        &[&payer],
        INVALID_JUDGE,
    );

    // Once opted in, not again, and a rating account is not an escrow.
    t.world.ok("open_rating", good(), &[&payer]);
    t.world
        .refused("already rated", good(), &[&payer], ALREADY_RATED);
    t.world.refused(
        "a rating account as escrow",
        swap(open_rating(&other, &a, None), 1, rating_address(&escrow)),
        &[&payer],
        DISCRIMINATOR_MISMATCH,
    );
    assert_eq!(t.world.data(&other)[SOL_ESCROW_FLAGS_AT], 0);
}

#[test]
fn the_rating_account_itself_cannot_be_the_payee() {
    let mut t = Sol::new();
    let escrow = t.escrow(1);
    let rating = rating_address(&escrow);
    let lock = sol_lock(&t.payer.pubkey(), &rating, AMOUNT, nonce(1), false);
    t.world.ok("lock", lock, &[&t.payer]);
    t.world.refused(
        "payee is the rating address",
        open_rating(&escrow, &t.payer.pubkey(), None),
        &[&t.payer],
        INVALID_PAYEE,
    );
}

#[test]
fn a_rating_left_open_blocks_a_new_one_for_the_same_escrow_address_until_closed() {
    let mut t = Sol::new();
    let (a, b) = (t.payer.pubkey(), t.payee.pubkey());
    let escrow = t.lock_rated(1, false);
    let rating = rating_address(&escrow);
    t.world.ok(
        "accept_rating",
        accept_rating(&t.world, &rating, &b),
        &[&t.payee],
    );
    t.world.ok(
        "release",
        with_rating(t.payout(1, &t.payer, None), &escrow),
        &[&t.payer],
    );
    assert_eq!(t.world.rating(&rating).state, OPEN);

    // The same payer and nonce give the same escrow address again.
    t.world.warp(t.world.slot() + 10);
    assert_eq!(t.lock(1, false), escrow);
    t.world.refused_by_system(
        "rating of the earlier job still exists",
        open_rating(&escrow, &a, None),
        &[&t.payer],
    );
    assert_eq!(t.world.data(&escrow)[SOL_ESCROW_FLAGS_AT], 0);
    // The earlier rating is not something the new escrow can be settled into.
    t.world
        .ok("release unrated", t.payout(1, &t.payer, None), &[&t.payer]);
    assert_eq!(t.world.rating(&rating).paid, AMOUNT);

    // Finish and close the earlier rating; the address can then be used again
    // and starts from nothing.
    let settled = t.world.rating(&rating).settled_slot;
    t.world.warp(settled + RATING_COMMIT_SLOTS + 1);
    t.world.ok(
        "expire",
        expire_rating(&rating, &t.stranger.pubkey(), &b, &a),
        &[&t.stranger],
    );
    t.world
        .ok("close_rating", close_rating(&rating, &a), &[&t.payer]);
    assert!(!t.world.exists(&rating));
    assert_eq!(t.lock_rated(1, false), escrow);
    let fresh = t.world.rating(&rating);
    assert_eq!(
        (fresh.state, fresh.paid, fresh.settled_slot),
        (AWAITING_SETTLEMENT, 0, 0)
    );
    assert_eq!(fresh.opened_slot, t.world.slot() - 1);
}

// ── Paid exits of a rated SOL escrow ────────────────────────────────────────

#[test]
fn payer_release_of_an_accepted_rated_escrow_records_the_job_and_pays_as_usual() {
    let mut t = Sol::new();
    let (a, b) = (t.payer.pubkey(), t.payee.pubkey());
    let escrow = t.lock_rated(1, false);
    let rating = rating_address(&escrow);
    t.world.warp(t.world.slot() + 7);
    // The payee agreed to the job being rated, so the payer's release opens
    // the rating.
    t.world.ok(
        "accept_rating",
        accept_rating(&t.world, &rating, &b),
        &[&t.payee],
    );
    assert!(t.world.rating(&rating).accepted);

    t.world.refused(
        "without the rating account",
        t.payout(1, &t.payer, None),
        &[&t.payer],
        RATING_ACCOUNT_REQUIRED,
    );
    let (payee_before, treasury_before, payer_before) = (
        t.world.lamports(&b),
        t.world.lamports(&PROTOCOL_TREASURY),
        t.world.lamports(&a),
    );
    let escrow_lamports = t.world.lamports(&escrow);
    let sent = t.world.ok(
        "release_escrow, rated",
        with_rating(t.payout(1, &t.payer, None), &escrow),
        &[&t.payer],
    );
    assert_eq!(sent.events.len(), 1, "one EscrowSettled event");
    assert_eq!(t.world.lamports(&b) - payee_before, AMOUNT - FEE);
    assert_eq!(t.world.lamports(&PROTOCOL_TREASURY) - treasury_before, FEE);
    // The payer gets the escrow's rent back; the rating keeps its own.
    assert_eq!(
        t.world.lamports(&a) - payer_before,
        escrow_lamports - AMOUNT - 5_000
    );
    assert!(!t.world.exists(&escrow));
    let record = t.world.rating(&rating);
    assert_eq!(record.state, OPEN);
    assert_eq!(record.paid, AMOUNT);
    assert_eq!(record.mint, Pubkey::default());
    assert_eq!(record.settled_slot, t.world.slot());
    assert_eq!(t.world.lamports(&rating), rating_rent(&t.world));

    // Settling twice: the escrow is gone.
    t.world.refused(
        "double release",
        with_rating(t.payout(1, &t.payer, None), &escrow),
        &[&t.payer],
        NOT_INITIALIZED,
    );
    t.world.refused(
        "decline after payment",
        with_rating(t.cancel(1, &t.payee), &escrow),
        &[&t.payee],
        NOT_INITIALIZED,
    );
    assert_eq!(t.world.rating(&rating), record);
    t.world.report("Rated SOL escrow");
}

#[test]
fn a_rated_event_is_the_event_of_the_same_escrow_unrated() {
    // Same keys, same slots, one world opts in: the settlement event and the
    // money are the same.
    let mut events = Vec::new();
    let mut payee_balances = Vec::new();
    for rated in [false, true] {
        let mut t = Sol::new();
        let escrow = t.lock(1, true);
        let mut settle = t.payout(1, &t.payee, Some(400_000));
        if rated {
            t.world.ok(
                "open",
                open_rating(&escrow, &t.payer.pubkey(), None),
                &[&t.payer],
            );
            settle = with_rating(settle, &escrow);
        } else {
            // The rated world moved on one slot after the opening.
            t.world.next_slot();
        }
        events.push(t.world.ok("settle", settle, &[&t.payee]).events);
        payee_balances.push(t.world.lamports(&t.payee.pubkey()));
    }
    assert_eq!(events[0], events[1]);
    assert_eq!(events[0].len(), 1);
    assert_eq!(payee_balances[0], payee_balances[1]);
}

#[test]
fn payee_claim_and_metered_settle_need_the_rating_account() {
    let mut t = Sol::new();
    let b = t.payee.pubkey();
    // Claim, after the claim window.
    let claimed = t.lock_rated(1, false);
    // Settle at actual cost.
    let settled = t.lock_rated(2, true);
    let locked_at = t.world.slot();

    t.world.refused(
        "settle without the rating account",
        t.payout(2, &t.payee, Some(300_000)),
        &[&t.payee],
        RATING_ACCOUNT_REQUIRED,
    );
    let before = t.world.lamports(&b);
    t.world.ok(
        "settle_escrow, rated",
        with_rating(t.payout(2, &t.payee, Some(300_000)), &settled),
        &[&t.payee],
    );
    assert_eq!(t.world.lamports(&b) - before, 300_000 - 7_500 - 5_000);
    let record = t.world.rating(&rating_address(&settled));
    assert_eq!((record.state, record.paid), (OPEN, 300_000));
    assert_eq!(record.settled_slot, locked_at);

    t.world.warp(locked_at + CLAIM_WINDOW);
    t.world.refused(
        "claim without the rating account",
        t.payout(1, &t.payee, None),
        &[&t.payee],
        RATING_ACCOUNT_REQUIRED,
    );
    t.world.ok(
        "release_escrow (claim), rated",
        with_rating(t.payout(1, &t.payee, None), &claimed),
        &[&t.payee],
    );
    let record = t.world.rating(&rating_address(&claimed));
    assert_eq!((record.state, record.paid), (OPEN, AMOUNT));
    assert_eq!(record.settled_slot, locked_at + CLAIM_WINDOW);
    t.world.refused(
        "double claim",
        with_rating(t.payout(1, &t.payee, None), &claimed),
        &[&t.payee],
        NOT_INITIALIZED,
    );
    t.world.report("Rated SOL escrow, payee exits");
}

#[test]
fn a_paid_exit_refuses_every_wrong_rating_account() {
    let mut t = Sol::new();
    let (a, s) = (t.payer.pubkey(), t.stranger.pubkey());
    let escrow = t.lock_rated(1, false);
    let other = t.lock_rated(2, false);
    let unrated = t.lock(3, false);
    let agent_account = t.world.register(&t.stranger, AgentType::Primary);
    let b = t.payee.pubkey();
    let release = || sol_payout(&a, &b, nonce(1), &a, None);
    let payer = key(1);

    t.world.refused(
        "rating of another escrow",
        with_rating(release(), &other),
        &[&payer],
        INVALID_RATING_ACCOUNT,
    );
    t.world.refused(
        "rating address of an escrow that is not rated",
        with_rating(release(), &unrated),
        &[&payer],
        NOT_INITIALIZED,
    );
    t.world.refused(
        "rating read-only",
        with_account(release(), rating_address(&escrow), false),
        &[&payer],
        CONSTRAINT_MUT,
    );
    t.world.refused(
        "a wallet",
        with_account(release(), s, true),
        &[&payer],
        WRONG_OWNER,
    );
    t.world.refused(
        "an agent record",
        with_account(release(), agent_account, true),
        &[&payer],
        DISCRIMINATOR_MISMATCH,
    );
    t.world.refused(
        "the escrow itself",
        with_account(release(), escrow, true),
        &[&payer],
        DISCRIMINATOR_MISMATCH,
    );
    // The right bytes at an address that is not the rating address.
    let copy = Pubkey::new_from_array([77; 32]);
    let genuine = t.world.svm.get_account(&rating_address(&escrow)).unwrap();
    t.world.set(copy, genuine.clone());
    t.world.refused(
        "a copy of the rating at another address",
        with_account(release(), copy, true),
        &[&payer],
        CONSTRAINT_SEEDS,
    );
    // A rating that is past waiting for its escrow.
    for state in [OPEN, BOTH_COMMITTED, REVEALED, EXPIRED] {
        let mut tampered = genuine.clone();
        tampered.data[264] = state;
        t.world.set(rating_address(&escrow), tampered);
        t.world.refused(
            "rating not awaiting settlement",
            with_rating(release(), &escrow),
            &[&payer],
            RATING_NOT_AWAITING_SETTLEMENT,
        );
        t.world.refused(
            "refund into a rating not awaiting settlement",
            with_rating(sol_cancel(&a, nonce(1), &key(2).pubkey()), &escrow),
            &[&key(2)],
            RATING_NOT_AWAITING_SETTLEMENT,
        );
    }
    t.world.set(rating_address(&escrow), genuine);
    t.world.ok(
        "accept",
        accept_rating(&t.world, &rating_address(&escrow), &b),
        &[&key(2)],
    );

    // Extra accounts after the rating account are ignored.
    t.world.ok(
        "release with a further account",
        with_account(with_rating(release(), &escrow), s, false),
        &[&payer],
    );
    assert_eq!(t.world.rating(&rating_address(&escrow)).state, OPEN);
    assert_eq!(
        t.world.rating(&rating_address(&other)).state,
        AWAITING_SETTLEMENT
    );
}

#[test]
fn an_unrated_escrow_ignores_a_rating_account_passed_to_it() {
    let mut t = Sol::new();
    let rated = t.lock_rated(1, false);
    t.lock(2, false);
    t.lock(3, false);
    let before = t.world.svm.get_account(&rating_address(&rated));
    let job = t.world.opened_slot(&rating_address(&rated));
    // An exit that names a job is refused on an escrow that is not rated:
    // it was signed for a rated job.
    t.world.refused(
        "release naming a job, not rated",
        with_rating_of(t.payout(2, &t.payer, None), &rated, job),
        &[&t.payer],
        RATING_JOB_MISMATCH,
    );
    t.world.refused(
        "decline naming a job, not rated",
        with_rating_of(t.cancel(3, &t.payee), &rated, job),
        &[&t.payee],
        RATING_JOB_MISMATCH,
    );
    // The account alone is ignored.
    t.world.ok(
        "release",
        with_account(t.payout(2, &t.payer, None), rating_address(&rated), true),
        &[&t.payer],
    );
    t.world.ok(
        "decline",
        with_account(t.cancel(3, &t.payee), rating_address(&rated), true),
        &[&t.payee],
    );
    assert_eq!(t.world.svm.get_account(&rating_address(&rated)), before);
}

// ── Refund and decline of a rated SOL escrow ────────────────────────────────

#[test]
fn decline_and_refund_close_the_rating_and_return_its_rent_to_the_payer() {
    let mut t = Sol::new();
    let a = t.payer.pubkey();
    let start = t.world.lamports(&a);
    let declined = t.lock_rated(1, false);
    let refunded = t.lock_rated(2, true);
    let locked_at = t.world.slot();

    t.world.refused(
        "decline without the rating account",
        t.cancel(1, &t.payee),
        &[&t.payee],
        RATING_ACCOUNT_REQUIRED,
    );
    t.world.refused(
        "decline with the rating of another escrow",
        with_rating(t.cancel(1, &t.payee), &refunded),
        &[&t.payee],
        INVALID_RATING_ACCOUNT,
    );
    t.world.refused(
        "decline with the rating read-only",
        with_account(t.cancel(1, &t.payee), rating_address(&declined), false),
        &[&t.payee],
        CONSTRAINT_MUT,
    );
    let sent = t.world.ok(
        "cancel_escrow (decline), rated",
        with_rating(t.cancel(1, &t.payee), &declined),
        &[&t.payee],
    );
    assert_eq!(sent.events.len(), 1);
    assert!(!t.world.exists(&declined));
    assert!(!t.world.exists(&rating_address(&declined)));

    t.world.warp(locked_at + CANCEL_WINDOW);
    t.world.refused(
        "refund without the rating account",
        t.cancel(2, &t.payer),
        &[&t.payer],
        RATING_ACCOUNT_REQUIRED,
    );
    t.world.ok(
        "cancel_escrow (refund), rated",
        with_rating(t.cancel(2, &t.payer), &refunded),
        &[&t.payer],
    );
    assert!(!t.world.exists(&refunded));
    assert!(!t.world.exists(&rating_address(&refunded)));

    // The payer has everything back but the fees of the transactions it sent:
    // two locks, two opt-ins, the refused refund and the refund.
    assert_eq!(start - t.world.lamports(&a), 6 * 5_000);

    // A job that was not paid cannot be rated (#836 S2).
    for (i, escrow) in [(1, declined), (2, refunded)] {
        let rating = rating_address(&escrow);
        for who in [&t.payer, &t.payee] {
            t.world.refused(
                "commit on a refunded job",
                commit_rating(&rating, &who.pubkey(), [9; 32]),
                &[who],
                NOT_INITIALIZED,
            );
        }
        t.world.refused(
            "double refund",
            with_rating(t.cancel(i, &t.payee), &escrow),
            &[&t.payee],
            NOT_INITIALIZED,
        );
    }
    t.world.report("Rated SOL escrow, refunds");
}

// ── Rated token escrows ─────────────────────────────────────────────────────

fn rated_token_rail(program: Pubkey, mint: Pubkey, name: &str) {
    let mut world = World::new();
    let (payer, payee) = (world.wallet(1), world.wallet(2));
    let t = Tokens::install(&mut world, program, mint, payer, payee);
    let (a, b) = (t.payer.pubkey(), t.payee.pubkey());
    let start = world.lamports(&a);
    let mut payer_transactions = 0u64;

    // nonce: 1 release, 2 claim, 3 metered settle, 4 decline, 5 refund,
    // 6 stays unrated.
    for i in 1..=6u8 {
        world.ok("lock", t.lock(AMOUNT, nonce(i), i == 3), &[&t.payer]);
        payer_transactions += 1;
        let escrow = t.escrow(nonce(i));
        assert_eq!(world.data(&escrow)[TOKEN_ESCROW_FLAGS_AT], (i == 3) as u8);
        if i == 6 {
            continue;
        }
        let before = world.data(&escrow);
        world.ok(
            &format!("open_rating ({name} escrow)"),
            open_rating(&escrow, &a, None),
            &[&t.payer],
        );
        payer_transactions += 1;
        let mut expected = before;
        expected[TOKEN_ESCROW_FLAGS_AT] |= FLAG_RATED;
        assert_eq!(world.data(&escrow), expected);
        let rating = world.rating(&rating_address(&escrow));
        assert_eq!(
            (rating.escrow, rating.consumer, rating.specialist),
            (escrow, a, b)
        );
        assert_eq!(rating.state, AWAITING_SETTLEMENT);
        if i == 1 {
            // The payer's release opens the rating only when the payee agreed.
            world.ok(
                "accept_rating",
                accept_rating(&world, &rating_address(&escrow), &b),
                &[&t.payee],
            );
        }
    }
    let locked_at = world.slot();
    let rating_of = |i: u8| rating_address(&t.escrow(nonce(i)));
    let rated = |ix: Instruction, i: u8| with_rating(ix, &t.escrow(nonce(i)));

    // Refusals: no rating account, the rating of another escrow, read-only,
    // and an escrow that is not rated passed as the rating.
    world.refused(
        "release without the rating account",
        t.payout(nonce(1), &a, None),
        &[&t.payer],
        RATING_ACCOUNT_REQUIRED,
    );
    world.refused(
        "release with the rating of another escrow",
        rated(t.payout(nonce(1), &a, None), 2),
        &[&t.payer],
        INVALID_RATING_ACCOUNT,
    );
    world.refused(
        "release with the rating read-only",
        with_account(t.payout(nonce(1), &a, None), rating_of(1), false),
        &[&t.payer],
        CONSTRAINT_MUT,
    );
    world.refused(
        "release with an escrow as the rating",
        with_account(t.payout(nonce(1), &a, None), t.escrow(nonce(6)), true),
        &[&t.payer],
        DISCRIMINATOR_MISMATCH,
    );
    world.refused(
        "settle without the rating account",
        t.payout(nonce(3), &b, Some(400_000)),
        &[&t.payee],
        RATING_ACCOUNT_REQUIRED,
    );
    world.refused(
        "decline without the rating account",
        t.cancel(nonce(4), &b),
        &[&t.payee],
        RATING_ACCOUNT_REQUIRED,
    );
    world.refused(
        "decline with the rating of another escrow",
        rated(t.cancel(nonce(4), &b), 5),
        &[&t.payee],
        INVALID_RATING_ACCOUNT,
    );
    payer_transactions += 4;

    // Release by the payer.
    let (recipient, treasury) = (
        t.balance(&world, &t.recipient),
        t.balance(&world, &t.treasury_token),
    );
    let sent = world.ok(
        &format!("release_token_escrow, rated ({name})"),
        rated(t.payout(nonce(1), &a, None), 1),
        &[&t.payer],
    );
    payer_transactions += 1;
    assert_eq!(sent.events.len(), 1);
    assert_eq!(t.balance(&world, &t.recipient) - recipient, AMOUNT - FEE);
    assert_eq!(t.balance(&world, &t.treasury_token) - treasury, FEE);
    let record = world.rating(&rating_of(1));
    assert_eq!(
        (record.state, record.paid, record.mint, record.settled_slot),
        (OPEN, AMOUNT, mint, locked_at)
    );
    assert!(!world.exists(&t.escrow(nonce(1))));
    assert!(!world.exists(&t.vault(nonce(1))));
    world.refused(
        "double release",
        rated(t.payout(nonce(1), &a, None), 1),
        &[&t.payer],
        NOT_INITIALIZED,
    );
    payer_transactions += 1;

    // Settle at actual cost by the payee: the rest returns to the payer.
    let source = t.balance(&world, &t.source);
    world.ok(
        &format!("settle_token_escrow, rated ({name})"),
        rated(t.payout(nonce(3), &b, Some(400_000)), 3),
        &[&t.payee],
    );
    assert_eq!(t.balance(&world, &t.source) - source, 600_000);
    let record = world.rating(&rating_of(3));
    assert_eq!(
        (record.state, record.paid, record.mint),
        (OPEN, 400_000, mint)
    );

    // Decline by the payee: tokens and both rents back to the payer.
    let source = t.balance(&world, &t.source);
    world.ok(
        &format!("cancel_token_escrow (decline), rated ({name})"),
        rated(t.cancel(nonce(4), &b), 4),
        &[&t.payee],
    );
    assert_eq!(t.balance(&world, &t.source) - source, AMOUNT);
    assert!(!world.exists(&rating_of(4)));
    assert!(!world.exists(&t.escrow(nonce(4))));

    // Claim by the payee after the claim window.
    world.warp(locked_at + CLAIM_WINDOW);
    world.refused(
        "claim without the rating account",
        t.payout(nonce(2), &b, None),
        &[&t.payee],
        RATING_ACCOUNT_REQUIRED,
    );
    world.ok(
        &format!("release_token_escrow (claim), rated ({name})"),
        rated(t.payout(nonce(2), &b, None), 2),
        &[&t.payee],
    );
    let record = world.rating(&rating_of(2));
    assert_eq!(
        (record.state, record.paid, record.settled_slot),
        (OPEN, AMOUNT, locked_at + CLAIM_WINDOW)
    );

    // Refund by the payer after the cancel window.
    world.warp(locked_at + CANCEL_WINDOW);
    world.refused(
        "refund without the rating account",
        t.cancel(nonce(5), &a),
        &[&t.payer],
        RATING_ACCOUNT_REQUIRED,
    );
    world.ok(
        &format!("cancel_token_escrow (refund), rated ({name})"),
        rated(t.cancel(nonce(5), &a), 5),
        &[&t.payer],
    );
    payer_transactions += 2;
    assert!(!world.exists(&rating_of(5)));
    world.refused(
        "commit on a refunded job",
        commit_rating(&rating_of(5), &a, [9; 32]),
        &[&t.payer],
        NOT_INITIALIZED,
    );
    payer_transactions += 1;

    // The escrow that was not opted in ends as before, rating account or
    // not, as long as the exit names no job.
    world.refused(
        "release, not rated, naming a job",
        rated(t.payout(nonce(6), &a, None), 1),
        &[&t.payer],
        RATING_JOB_MISMATCH,
    );
    payer_transactions += 1;
    world.ok(
        "release, not rated",
        with_account(t.payout(nonce(6), &a, None), rating_of(1), true),
        &[&t.payer],
    );
    payer_transactions += 1;

    // A payer release the payee never agreed to: paid as usual, not rated.
    world.warp(locked_at + CANCEL_WINDOW + 5);
    world.ok("lock", t.lock(AMOUNT, nonce(7), false), &[&t.payer]);
    world.ok(
        "open_rating",
        open_rating(&t.escrow(nonce(7)), &a, None),
        &[&t.payer],
    );
    world.refused(
        "unaccepted release without the rating account",
        t.payout(nonce(7), &a, None),
        &[&t.payer],
        RATING_ACCOUNT_REQUIRED,
    );
    let recipient = t.balance(&world, &t.recipient);
    let sent = world.ok(
        &format!("release_token_escrow, rated, not accepted ({name})"),
        rated(t.payout(nonce(7), &a, None), 7),
        &[&t.payer],
    );
    payer_transactions += 4;
    assert_eq!(sent.events.len(), 1);
    assert_eq!(t.balance(&world, &t.recipient) - recipient, AMOUNT - FEE);
    assert!(!world.exists(&rating_of(7)));
    assert!(!world.exists(&t.escrow(nonce(7))));
    world.refused(
        "commit on a job the payee never agreed to rate",
        commit_rating(&rating_of(7), &a, [9; 32]),
        &[&t.payer],
        NOT_INITIALIZED,
    );
    payer_transactions += 1;

    // Every rent came back to the payer except the three ratings still open
    // (released, claimed, settled).
    assert_eq!(
        start - world.lamports(&a),
        payer_transactions * 5_000 + 3 * rating_rent(&world)
    );
    // All tokens are accounted for.
    assert_eq!(
        t.balance(&world, &t.source)
            + t.balance(&world, &t.recipient)
            + t.balance(&world, &t.treasury_token),
        1_000_000_000
    );
    world.report(&format!("Rated {name} escrow"));
}

#[test]
fn rated_usdc_escrow_through_every_exit() {
    rated_token_rail(anchor_spl::token::spl_token::ID, USDC_MAINNET_MINT, "USDC");
}

#[test]
fn rated_pyusd_escrow_through_every_exit() {
    rated_token_rail(TOKEN_2022_ID, PYUSD_MAINNET_MINT, "PYUSD");
}

#[test]
fn a_token_escrow_cannot_be_opted_in_by_anyone_else_or_later() {
    let mut world = World::new();
    let (payer, payee, stranger) = (world.wallet(1), world.wallet(2), world.wallet(3));
    let t = Tokens::install(
        &mut world,
        anchor_spl::token::spl_token::ID,
        USDC_MAINNET_MINT,
        payer,
        payee,
    );
    world.ok("lock", t.lock(AMOUNT, nonce(1), false), &[&t.payer]);
    let escrow = t.escrow(nonce(1));
    world.refused(
        "the payee opts in",
        swap(
            open_rating(&escrow, &t.payer.pubkey(), None),
            2,
            t.payee.pubkey(),
        ),
        &[&t.payee],
        UNAUTHORISED_SIGNER,
    );
    world.refused(
        "a stranger opts in",
        swap(
            open_rating(&escrow, &t.payer.pubkey(), None),
            2,
            stranger.pubkey(),
        ),
        &[&stranger],
        UNAUTHORISED_SIGNER,
    );
    world.refused(
        "the vault as escrow",
        swap(
            open_rating(&escrow, &t.payer.pubkey(), None),
            1,
            t.vault(nonce(1)),
        ),
        &[&t.payer],
        WRONG_OWNER,
    );
    world.warp(world.slot() + 1);
    world.refused(
        "one slot later",
        open_rating(&escrow, &t.payer.pubkey(), None),
        &[&t.payer],
        RATING_OPT_IN_CLOSED,
    );
    assert_eq!(world.data(&escrow)[TOKEN_ESCROW_FLAGS_AT], 0);
    let _ = system_program::id();
}
