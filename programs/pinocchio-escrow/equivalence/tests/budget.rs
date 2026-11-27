//! Pooled budgets: `open_budget`, `open_token_budget`, `reserve`,
//! `set_payout_account`, `post_final`, `waive`, `dispute`, `close_budget`,
//! `close_token_budget`, `payout_budget`, `payout_token_budget`,
//! `resolve_budget` and `resolve_token_budget`. Runs against the built
//! Pinocchio binary.
//!
//! The threat model's items are named where a test covers them (B1 to B15).
//! Lamport conservation is asserted on every transaction by the harness.
mod support;

use {
    anchor_lang::prelude::Pubkey,
    escrow::{
        state::AgentType, token_accounts::TOKEN_2022_ID, PROTOCOL_TREASURY, PYUSD_MAINNET_MINT,
        USDC_MAINNET_MINT,
    },
    solana_account::Account,
    solana_keypair::Keypair,
    solana_signer::Signer,
    support::{budget::*, *},
};

const OPEN_SLOTS: u64 = 9_000;
const DISPUTE_SLOTS: u64 = 9_000;
const JUDGE_SLOTS: u64 = 1_500;
const MIN_REVIEW: u64 = 9_000;
const TOTAL: u64 = 100_000_000;
const TOKEN_TOTAL: u64 = 10_000_000;

const INVALID_TOKEN_ACCOUNT: u32 = 6023;
const AMOUNT_ABOVE_CAP: u32 = 6025;
const INVALID_RESOLUTION: u32 = 6071;
const INVALID_BUDGET_TERMS: u32 = 6073;
const NEEDS_JUDGE_OR_ALLOWLIST: u32 = 6074;
const SPENDER_WAIVE_NEEDS_ALLOWLIST: u32 = 6075;
const BUDGET_INSTANCE_MISMATCH: u32 = 6076;
const BUDGET_JUST_OPENED: u32 = 6077;
const BUDGET_NOT_OPEN: u32 = 6078;
const BUDGET_NOT_CLOSED: u32 = 6079;
const BUDGET_ALREADY_CLOSED: u32 = 6080;
const BUDGET_BALANCE_TOO_LOW: u32 = 6081;
const ABOVE_PROVIDER_CAP: u32 = 6082;
const RESERVATION_TOO_SMALL: u32 = 6083;
const TOO_MANY_RESERVATIONS: u32 = 6084;
const PAYEE_NOT_ALLOWED: u32 = 6085;
const INVALID_RESERVATION: u32 = 6087;
const RESERVATION_LOCKED: u32 = 6088;
const RESERVATION_NOT_POSTED: u32 = 6089;
const INVALID_FINAL_AMOUNT: u32 = 6090;
const RESERVATION_DISPUTED: u32 = 6091;
const RESERVATION_WAIVED: u32 = 6092;
const DISPUTE_WINDOW_CLOSED: u32 = 6093;
const RESERVATION_NOT_DISPUTED: u32 = 6094;
const BUDGET_HAS_NO_JUDGE: u32 = 6095;
const PAYOUT_NOT_OPEN: u32 = 6096;
const JUDGE_WINDOW_CLOSED: u32 = 6097;

const R_OPEN: u8 = 0;
const R_POSTED: u8 = 1;
const R_DISPUTED: u8 = 2;
const R_PAID: u8 = 3;
const FLAG_SPENDER_WAIVES: u8 = 0x01;
const FLAG_CLOSED: u8 = 0x02;

/// The launch-rate fee (2.5%, rounded down): the test clock is before
/// 1 April 2027.
fn fee(paid: u64) -> u64 {
    paid * 250 / 10_000
}

// ── Fixture ─────────────────────────────────────────────────────────────────

struct Fixture {
    world: World,
    payer: Keypair,
    spender: Keypair,
    judge: Keypair,
    a: Keypair,
    b: Keypair,
    stranger: Keypair,
}

impl Fixture {
    fn new() -> Self {
        let mut world = World::new();
        let payer = world.wallet(1);
        let a = world.wallet(2);
        let stranger = world.wallet(3);
        let judge = world.wallet(4);
        let spender = world.wallet(5);
        let b = world.wallet(6);
        world.register(&a, AgentType::Primary);
        world.register(&b, AgentType::Primary);
        world.register(&judge, AgentType::Attestation);
        Self {
            world,
            payer,
            spender,
            judge,
            a,
            b,
            stranger,
        }
    }

    /// Terms with the RAP-style defaults: a judge, no allowlist, no cap.
    fn terms(&self, i: u8) -> Terms {
        Terms {
            nonce: nonce(i),
            spender: self.spender.pubkey(),
            judge: self.judge.pubkey(),
            open: OPEN_SLOTS,
            dispute: DISPUTE_SLOTS,
            judge_slots: JUDGE_SLOTS,
            total: TOTAL,
            cap: 0,
            flags: 0,
            allowlist: [ZERO; 4],
        }
    }

    /// Open a SOL budget and move past its opening slot.
    fn open(&mut self, terms: &Terms) -> (Pubkey, u64) {
        let payer = self.payer.insecure_clone();
        self.world
            .ok("open_budget", terms.open_ix(&payer.pubkey()), &[&payer]);
        let budget = budget_address(&payer.pubkey(), terms.nonce);
        let created = read_budget(&self.world, &budget).created;
        assert_eq!(created, self.world.slot());
        self.world.next_slot();
        (budget, created)
    }

    fn reserve(&mut self, budget: &Pubkey, created: u64, payee: &Keypair, amount: u64) {
        let ix = reserve_ix(
            budget,
            created,
            &self.spender.pubkey(),
            &payee.pubkey(),
            &payee.pubkey(),
            amount,
        );
        let spender = self.spender.insecure_clone();
        self.world.ok("reserve", ix, &[payee, &spender]);
    }

    fn post(&mut self, budget: &Pubkey, created: u64, payee: &Keypair, amount: u64) {
        self.world.ok(
            "post_final",
            post_ix(budget, created, &payee.pubkey(), amount),
            &[payee],
        );
    }

    fn hold(&mut self, name: &str, budget: &Pubkey, created: u64, payee: &Pubkey) {
        let payer = self.payer.insecure_clone();
        self.world.ok(
            name,
            hold_ix(name, budget, created, payee, &payer.pubkey()),
            &[&payer],
        );
    }

    fn payout(&mut self, budget: &Pubkey, created: u64, payee: &Pubkey) {
        let stranger = self.stranger.insecure_clone();
        let ix = payout_ix(budget, created, payee, &self.payer.pubkey());
        self.world.ok("payout_budget", ix, &[&stranger]);
    }

    fn lamports(&self, who: &Pubkey) -> u64 {
        self.world.lamports(who)
    }
}

fn rent(world: &World, len: usize) -> u64 {
    world.svm.minimum_balance_for_rent_exemption(len)
}

// ── SOL ─────────────────────────────────────────────────────────────────────

#[test]
fn a_sol_budget_is_split_between_providers_and_the_rest_refunded() {
    let mut t = Fixture::new();
    let payer = t.payer.pubkey();
    let (a, b) = (t.a.pubkey(), t.b.pubkey());
    let payer_start = t.lamports(&payer);
    let treasury_start = t.lamports(&PROTOCOL_TREASURY);
    let terms = t.terms(1);

    // Nothing acts on a budget in the slot it was opened in (B7).
    let payer_kp = t.payer.insecure_clone();
    t.world
        .ok("open_budget", terms.open_ix(&payer), &[&payer_kp]);
    let budget = budget_address(&payer, terms.nonce);
    let created = read_budget(&t.world, &budget).created;
    let spender = t.spender.insecure_clone();
    let a_kp = t.a.insecure_clone();
    t.world.refused(
        "reserve in the opening slot",
        reserve_ix(&budget, created, &spender.pubkey(), &a, &a, 40_000_000),
        &[&a_kp, &spender],
        BUDGET_JUST_OPENED,
    );
    t.world.next_slot();
    assert_eq!(
        t.lamports(&budget),
        rent(&t.world, BUDGET_LEN) + TOTAL,
        "the budget holds its rent and the total"
    );

    let a_start = t.lamports(&a);
    t.reserve(&budget, created, &t.a.insecure_clone(), 40_000_000);
    t.reserve(&budget, created, &t.b.insecure_clone(), 30_000_000);
    let view = read_budget(&t.world, &budget);
    assert_eq!(
        (
            view.total,
            view.unreserved,
            view.reservations,
            view.unsettled
        ),
        (TOTAL, 30_000_000, 2, 2)
    );
    let ra = read_reservation(&t.world, &reservation_address(&budget, &a));
    assert_eq!(
        (ra.payee, ra.payout_account, ra.reserved, ra.state),
        (a, a, 40_000_000, R_OPEN)
    );

    // A raises its reservation with the spender's signature.
    t.reserve(&budget, created, &t.a.insecure_clone(), 45_000_000);
    assert_eq!(read_budget(&t.world, &budget).unreserved, 25_000_000);
    let reservation_rent = rent(&t.world, RESERVATION_LEN);
    // A paid the reservation's rent and two fees (it signed twice, the spender too).
    assert_eq!(t.lamports(&a), a_start - reservation_rent - 4 * 5_000);

    // A posts and the payer waives: paid at once while the budget is open.
    t.post(&budget, created, &t.a.insecure_clone(), 25_000_000);
    t.hold("waive", &budget, created, &a);
    let a_before = t.lamports(&a);
    let payer_before = t.lamports(&payer);
    t.payout(&budget, created, &a);
    assert_eq!(t.lamports(&a), a_before + 25_000_000 - fee(25_000_000));
    assert_eq!(
        t.lamports(&payer),
        payer_before + 20_000_000,
        "the unused slice comes back"
    );
    // B4: the reservation stays, marked paid, so A cannot reserve again.
    let ra = read_reservation(&t.world, &reservation_address(&budget, &a));
    assert_eq!(ra.state, R_PAID);
    assert_eq!(read_budget(&t.world, &budget).unsettled, 1);
    t.world.refused(
        "reserve again after an early payout",
        reserve_ix(&budget, created, &spender.pubkey(), &a, &a, 10_000_000),
        &[&a_kp, &spender],
        RESERVATION_LOCKED,
    );
    // A paid reservation closes only once the budget is closed (B4).
    let stranger = t.stranger.insecure_clone();
    t.world.refused(
        "close a paid reservation of an open budget",
        payout_ix(&budget, created, &a, &payer),
        &[&stranger],
        BUDGET_NOT_CLOSED,
    );

    // B posts; the spender closes the budget and the unreserved part returns.
    t.post(&budget, created, &t.b.insecure_clone(), 30_000_000);
    let payer_before = t.lamports(&payer);
    t.world.ok(
        "close_budget",
        close_ix(&budget, created, &spender.pubkey(), &payer),
        &[&spender],
    );
    assert_eq!(t.lamports(&payer), payer_before + 25_000_000);
    let view = read_budget(&t.world, &budget);
    assert_eq!(view.flags & FLAG_CLOSED, FLAG_CLOSED);
    assert_eq!(view.unreserved, 0);
    let closed = view.closed_slot;
    t.world.refused(
        "close twice",
        close_ix(&budget, created, &payer, &payer),
        &[&payer_kp],
        BUDGET_ALREADY_CLOSED,
    );

    // B's payout waits for the dispute window.
    t.world.refused(
        "payout inside the dispute window",
        payout_ix(&budget, created, &b, &payer),
        &[&stranger],
        PAYOUT_NOT_OPEN,
    );
    // The spender closed early, so the payer's review runs from the end of
    // the open period, not from the close (B1).
    let review_from = closed.max(created + OPEN_SLOTS);
    assert!(
        review_from > closed,
        "the close came before the open period ended"
    );
    t.world.warp(closed + DISPUTE_SLOTS);
    t.world.refused(
        "payout one dispute window after a spender's early close",
        payout_ix(&budget, created, &b, &payer),
        &[&stranger],
        PAYOUT_NOT_OPEN,
    );
    t.world.warp(review_from + DISPUTE_SLOTS - 1);
    t.world.refused(
        "payout one slot before the review ends",
        payout_ix(&budget, created, &b, &payer),
        &[&stranger],
        PAYOUT_NOT_OPEN,
    );
    t.world.warp(review_from + DISPUTE_SLOTS);
    let b_before = t.lamports(&b);
    t.payout(&budget, created, &b);
    assert_eq!(
        t.lamports(&b),
        b_before + 30_000_000 - fee(30_000_000) + reservation_rent,
        "B is paid and gets its reservation's rent back"
    );
    assert!(
        !t.world.exists(&budget),
        "the last payout closes the budget"
    );

    // The paid reservation of A now closes, its rent to A.
    let a_before = t.lamports(&a);
    t.payout(&budget, created, &a);
    assert!(!t.world.exists(&reservation_address(&budget, &a)));
    assert_eq!(t.lamports(&a), a_before + reservation_rent);

    // Money: the payer spent the paid amounts and the transaction fees it
    // signed; the treasury got the fees.
    let paid = 25_000_000 + 30_000_000;
    assert_eq!(
        t.lamports(&PROTOCOL_TREASURY),
        treasury_start + fee(25_000_000) + fee(30_000_000)
    );
    // It signed the open, the waiver and the refused second close.
    assert_eq!(t.lamports(&payer), payer_start - paid - 3 * 5_000);
}

#[test]
fn an_open_needs_valid_terms_and_a_judge_or_allowlist() {
    let mut t = Fixture::new();
    let payer_kp = t.payer.insecure_clone();
    let payer = payer_kp.pubkey();
    let base = t.terms(1);
    let cases: Vec<(&str, Terms, u32)> = vec![
        (
            "open period too short",
            Terms {
                open: 8_999,
                ..base.clone()
            },
            INVALID_BUDGET_TERMS,
        ),
        (
            "dispute window too long",
            Terms {
                dispute: 1_512_001,
                ..base.clone()
            },
            INVALID_BUDGET_TERMS,
        ),
        (
            "judge window too short",
            Terms {
                judge_slots: 1_499,
                ..base.clone()
            },
            INVALID_BUDGET_TERMS,
        ),
        (
            "zero total",
            Terms {
                total: 0,
                ..base.clone()
            },
            INVALID_BUDGET_TERMS,
        ),
        (
            "zero spender",
            Terms {
                spender: ZERO,
                ..base.clone()
            },
            INVALID_BUDGET_TERMS,
        ),
        (
            "cap above the total",
            Terms {
                cap: TOTAL + 1,
                ..base.clone()
            },
            INVALID_BUDGET_TERMS,
        ),
        (
            "unknown flag",
            Terms {
                flags: 0x02,
                ..base.clone()
            },
            INVALID_BUDGET_TERMS,
        ),
        (
            "above the SOL cap",
            Terms {
                total: 500_000_001,
                ..base.clone()
            },
            AMOUNT_ABOVE_CAP,
        ),
        // B1: a stolen spender key could pay a provider it registered itself.
        (
            "no judge and no allowlist",
            Terms {
                judge: ZERO,
                ..base.clone()
            },
            NEEDS_JUDGE_OR_ALLOWLIST,
        ),
        // B2: the spender waiving needs an allowlist.
        (
            "spender waives without an allowlist",
            Terms {
                flags: FLAG_SPENDER_WAIVES,
                ..base.clone()
            },
            SPENDER_WAIVE_NEEDS_ALLOWLIST,
        ),
        (
            "payer as judge",
            Terms {
                judge: payer,
                ..base.clone()
            },
            INVALID_JUDGE,
        ),
        (
            "spender as judge",
            Terms {
                judge: t.spender.pubkey(),
                ..base.clone()
            },
            INVALID_JUDGE,
        ),
        (
            "a provider as judge",
            Terms {
                judge: t.a.pubkey(),
                ..base.clone()
            },
            NOT_ATTESTATION_AGENT,
        ),
    ];
    for (label, terms, code) in cases {
        t.world
            .refused(label, terms.open_ix(&payer), &[&payer_kp], code);
    }
    let mut missing = base.open_ix(&payer);
    missing.accounts.pop();
    let error = t
        .world
        .send(&[missing], &[&payer_kp])
        .err()
        .expect("refused");
    assert!(
        error.contains(&format!("Custom({NOT_ENOUGH_KEYS})")),
        "{error}"
    );

    // An allowlist alone is enough, and lets the spender waive.
    let allowlisted = Terms {
        judge: ZERO,
        flags: FLAG_SPENDER_WAIVES,
        allowlist: [t.a.pubkey(), ZERO, ZERO, ZERO],
        ..base.clone()
    };
    t.open(&allowlisted);
    // The same address cannot be opened twice.
    t.world
        .refused_by_system("open twice", allowlisted.open_ix(&payer), &[&payer_kp]);
}

#[test]
fn a_reservation_is_checked_against_the_budget_and_the_payee() {
    let mut t = Fixture::new();
    let payer = t.payer.pubkey();
    let (a, b) = (t.a.pubkey(), t.b.pubkey());
    let spender = t.spender.insecure_clone();
    let stranger = t.stranger.insecure_clone();
    let a_kp = t.a.insecure_clone();
    let b_kp = t.b.insecure_clone();
    let terms = Terms {
        cap: TOTAL / 2,
        ..t.terms(1)
    };
    let (budget, created) = t.open(&terms);
    let res = |payee: &Pubkey, amount: u64| {
        reserve_ix(&budget, created, &spender.pubkey(), payee, payee, amount)
    };

    t.world.refused(
        "another instance",
        reserve_ix(&budget, created + 1, &spender.pubkey(), &a, &a, 10_000_000),
        &[&a_kp, &spender],
        BUDGET_INSTANCE_MISMATCH,
    );
    t.world.refused(
        "not the spender",
        reserve_ix(&budget, created, &stranger.pubkey(), &a, &a, 10_000_000),
        &[&a_kp, &stranger],
        UNAUTHORISED_SIGNER,
    );
    t.world.refused(
        "below 1% of the budget (B11)",
        res(&a, TOTAL / 100 - 1),
        &[&a_kp, &spender],
        RESERVATION_TOO_SMALL,
    );
    t.world.refused(
        "above the per-provider cap",
        res(&a, TOTAL / 2 + 1),
        &[&a_kp, &spender],
        ABOVE_PROVIDER_CAP,
    );
    let payer_kp = t.payer.insecure_clone();
    t.world.refused(
        "the payer as payee",
        res(&payer, 10_000_000),
        &[&payer_kp, &spender],
        INVALID_PAYEE,
    );
    let judge = t.judge.insecure_clone();
    t.world.refused(
        "the judge as payee",
        res(&judge.pubkey(), 10_000_000),
        &[&judge, &spender],
        INVALID_PAYEE,
    );
    let error = t
        .world
        .send(
            &[res(&stranger.pubkey(), 10_000_000)],
            &[&stranger, &spender],
        )
        .err()
        .expect("refused");
    assert!(
        error.contains(&format!("Custom({NOT_INITIALIZED})")),
        "an unregistered payee: {error}"
    );
    // A SOL reservation is paid to the payee itself.
    t.world.refused(
        "a SOL payout account that is not the payee",
        reserve_ix(&budget, created, &spender.pubkey(), &a, &b, 10_000_000),
        &[&a_kp, &spender],
        INVALID_TOKEN_ACCOUNT,
    );

    t.reserve(&budget, created, &a_kp, 50_000_000);
    t.reserve(&budget, created, &b_kp, 45_000_000);
    let d = t.world.wallet(8);
    t.world.register(&d, AgentType::Primary);
    t.world.refused(
        "past what is unreserved",
        res(&d.pubkey(), 5_000_001),
        &[&d, &spender],
        BUDGET_BALANCE_TOO_LOW,
    );
    t.world.refused(
        "a raise must be higher",
        res(&b, 45_000_000),
        &[&b_kp, &spender],
        RESERVATION_TOO_SMALL,
    );
    // A posted reservation is fixed.
    t.post(&budget, created, &b_kp, 1_000_000);
    t.world.refused(
        "raise a posted reservation",
        res(&b, 46_000_000),
        &[&b_kp, &spender],
        RESERVATION_LOCKED,
    );

    // The last slot of the open period still takes a reservation (B10).
    let c = t.world.wallet(7);
    t.world.register(&c, AgentType::Primary);
    t.world.warp(created + OPEN_SLOTS - 1);
    t.reserve(&budget, created, &d, 5_000_000);
    assert_eq!(read_budget(&t.world, &budget).unreserved, 0);
    // No new reservation after the open period.
    t.world.warp(created + OPEN_SLOTS);
    t.world.refused(
        "after the open period",
        res(&c.pubkey(), 5_000_000),
        &[&c, &spender],
        BUDGET_NOT_OPEN,
    );
    // Anyone may close it now; a stranger before could not.
    t.world.ok(
        "close_budget by anyone after the open period",
        close_ix(&budget, created, &stranger.pubkey(), &payer),
        &[&stranger],
    );
    t.world.refused(
        "after close",
        res(&c.pubkey(), 5_000_000),
        &[&c, &spender],
        BUDGET_NOT_OPEN,
    );
}

#[test]
fn a_stranger_cannot_close_an_open_budget() {
    let mut t = Fixture::new();
    let payer = t.payer.pubkey();
    let stranger = t.stranger.insecure_clone();
    let (budget, created) = t.open(&t.terms(1));
    t.world.refused(
        "stranger closes inside the open period",
        close_ix(&budget, created, &stranger.pubkey(), &payer),
        &[&stranger],
        UNAUTHORISED_SIGNER,
    );
    let payer_kp = t.payer.insecure_clone();
    let before = t.lamports(&payer);
    t.world.ok(
        "close_budget",
        close_ix(&budget, created, &payer, &payer),
        &[&payer_kp],
    );
    assert!(
        !t.world.exists(&budget),
        "nothing reserved: it closes outright"
    );
    assert_eq!(
        t.lamports(&payer),
        before + TOTAL + rent(&t.world, BUDGET_LEN) - 5_000
    );
}

#[test]
fn only_the_allowlisted_may_join_and_the_spender_may_waive_only_with_the_flag() {
    let mut t = Fixture::new();
    let (a, b) = (t.a.pubkey(), t.b.pubkey());
    let spender = t.spender.insecure_clone();
    let b_kp = t.b.insecure_clone();
    let a_kp = t.a.insecure_clone();
    let no_flag = Terms {
        judge: ZERO,
        allowlist: [a, ZERO, ZERO, ZERO],
        ..t.terms(1)
    };
    let (budget, created) = t.open(&no_flag);
    t.world.refused(
        "not on the allowlist",
        reserve_ix(&budget, created, &spender.pubkey(), &b, &b, 10_000_000),
        &[&b_kp, &spender],
        PAYEE_NOT_ALLOWED,
    );
    t.reserve(&budget, created, &a_kp, 10_000_000);
    t.world.refused(
        "waive before any post (B15)",
        hold_ix("waive", &budget, created, &a, &t.payer.pubkey()),
        &[&t.payer.insecure_clone()],
        RESERVATION_NOT_POSTED,
    );
    t.post(&budget, created, &a_kp, 5_000_000);
    t.world.refused(
        "spender waives without the flag",
        hold_ix("waive", &budget, created, &a, &spender.pubkey()),
        &[&spender],
        UNAUTHORISED_SIGNER,
    );
    t.world.refused(
        "dispute without a judge",
        hold_ix("dispute", &budget, created, &a, &t.payer.pubkey()),
        &[&t.payer.insecure_clone()],
        BUDGET_HAS_NO_JUDGE,
    );

    let flagged = Terms {
        flags: FLAG_SPENDER_WAIVES,
        ..no_flag.clone()
    };
    let flagged = Terms {
        nonce: nonce(2),
        ..flagged
    };
    let (budget, created) = t.open(&flagged);
    t.reserve(&budget, created, &a_kp, 10_000_000);
    t.post(&budget, created, &a_kp, 5_000_000);
    t.world.ok(
        "waive by the spender",
        hold_ix("waive", &budget, created, &a, &spender.pubkey()),
        &[&spender],
    );
    assert_eq!(
        read_reservation(&t.world, &reservation_address(&budget, &a)).waived,
        1
    );
    t.world.refused(
        "waive twice",
        hold_ix("waive", &budget, created, &a, &t.payer.pubkey()),
        &[&t.payer.insecure_clone()],
        RESERVATION_WAIVED,
    );
    t.world.refused(
        "post after a waiver",
        post_ix(&budget, created, &a, 1_000_000),
        &[&a_kp],
        RESERVATION_WAIVED,
    );
    let a_before = t.lamports(&a);
    t.payout(&budget, created, &a);
    assert_eq!(t.lamports(&a), a_before + 5_000_000 - fee(5_000_000));
}

#[test]
fn a_late_post_gets_its_review_time_and_a_repost_only_goes_down() {
    let mut t = Fixture::new();
    let payer = t.payer.pubkey();
    let (a, b) = (t.a.pubkey(), t.b.pubkey());
    let a_kp = t.a.insecure_clone();
    let b_kp = t.b.insecure_clone();
    let payer_kp = t.payer.insecure_clone();
    let stranger = t.stranger.insecure_clone();
    let c_kp = t.world.wallet(7);
    t.world.register(&c_kp, AgentType::Primary);
    let c = c_kp.pubkey();
    let (budget, created) = t.open(&t.terms(1));
    t.reserve(&budget, created, &a_kp, 40_000_000);
    t.reserve(&budget, created, &b_kp, 30_000_000);
    t.reserve(&budget, created, &c_kp, 20_000_000);

    t.world.refused(
        "post above the reservation",
        post_ix(&budget, created, &b, 30_000_001),
        &[&b_kp],
        INVALID_FINAL_AMOUNT,
    );
    t.world.refused(
        "post by someone else",
        swap(post_ix(&budget, created, &a, 1), 2, b),
        &[&b_kp],
        UNAUTHORISED_SIGNER,
    );
    let first_post = t.world.slot();
    t.post(&budget, created, &a_kp, 30_000_000);
    // B3: a re-post may only lower the amount.
    t.world.refused(
        "re-post higher",
        post_ix(&budget, created, &a, 35_000_000),
        &[&a_kp],
        INVALID_FINAL_AMOUNT,
    );
    t.world.next_slot();
    t.post(&budget, created, &a_kp, 20_000_000);
    t.world.refused(
        "dispute an unposted reservation (B15)",
        hold_ix("dispute", &budget, created, &b, &payer),
        &[&payer_kp],
        RESERVATION_NOT_POSTED,
    );

    t.world.ok(
        "close_budget",
        close_ix(&budget, created, &payer, &payer),
        &[&payer_kp],
    );
    let closed = read_budget(&t.world, &budget).closed_slot;

    // At the last slot of the dispute window A re-posts lower and C posts
    // for the first time.
    t.world.warp(closed + DISPUTE_SLOTS - 1);
    t.post(&budget, created, &a_kp, 10_000_000);
    t.post(&budget, created, &c_kp, 15_000_000);
    // A re-post keeps the first post's slot, so re-posting cannot keep
    // pushing the payout back (review L1).
    let ra = read_reservation(&t.world, &reservation_address(&budget, &a));
    assert_eq!(
        (ra.final_amount, ra.posted, ra.state),
        (10_000_000, first_post, R_POSTED)
    );
    // A first post still gives the payer MIN_REVIEW to look at it (B3).
    let rc = read_reservation(&t.world, &reservation_address(&budget, &c));
    assert_eq!(rc.posted, closed + DISPUTE_SLOTS - 1);

    t.world.warp(closed + DISPUTE_SLOTS);
    let a_before = t.lamports(&a);
    let payer_before = t.lamports(&payer);
    t.payout(&budget, created, &a);
    assert_eq!(
        t.lamports(&a),
        a_before + 10_000_000 - fee(10_000_000) + rent(&t.world, RESERVATION_LEN),
        "A's re-post did not move its dispute window"
    );
    assert_eq!(t.lamports(&payer), payer_before + 30_000_000);
    t.world.refused(
        "payout before the review time after a late first post",
        payout_ix(&budget, created, &c, &payer),
        &[&stranger],
        PAYOUT_NOT_OPEN,
    );
    // B never posted and its window has ended: it can no longer post.
    t.world.refused(
        "post after the dispute window",
        post_ix(&budget, created, &b, 1),
        &[&b_kp],
        DISPUTE_WINDOW_CLOSED,
    );
    let payer_before = t.lamports(&payer);
    let b_before = t.lamports(&b);
    t.payout(&budget, created, &b);
    assert_eq!(
        t.lamports(&payer),
        payer_before + 30_000_000,
        "an unposted slice refunds in full"
    );
    assert_eq!(t.lamports(&b), b_before + rent(&t.world, RESERVATION_LEN));

    // The payer disputes C inside its review time.
    t.world.warp(closed + DISPUTE_SLOTS - 1 + MIN_REVIEW - 1);
    t.hold("dispute", &budget, created, &c);
    let rc = read_reservation(&t.world, &reservation_address(&budget, &c));
    assert_eq!(rc.state, R_DISPUTED);
}

#[test]
fn a_dispute_after_the_review_time_is_refused() {
    let mut t = Fixture::new();
    let payer = t.payer.pubkey();
    let a = t.a.pubkey();
    let a_kp = t.a.insecure_clone();
    let payer_kp = t.payer.insecure_clone();
    let (budget, created) = t.open(&t.terms(1));
    t.reserve(&budget, created, &a_kp, 40_000_000);
    t.post(&budget, created, &a_kp, 40_000_000);
    t.world.ok(
        "close_budget",
        close_ix(&budget, created, &payer, &payer),
        &[&payer_kp],
    );
    let closed = read_budget(&t.world, &budget).closed_slot;
    t.world.warp(closed + DISPUTE_SLOTS);
    t.world.refused(
        "dispute after the window",
        hold_ix("dispute", &budget, created, &a, &payer),
        &[&payer_kp],
        DISPUTE_WINDOW_CLOSED,
    );
    let a_before = t.lamports(&a);
    t.payout(&budget, created, &a);
    assert_eq!(
        t.lamports(&a),
        a_before + 40_000_000 - fee(40_000_000) + rent(&t.world, RESERVATION_LEN)
    );
    assert!(!t.world.exists(&budget));
}

#[test]
fn the_judge_splits_a_disputed_reservation_or_it_refunds() {
    let mut t = Fixture::new();
    let payer = t.payer.pubkey();
    let (a, b) = (t.a.pubkey(), t.b.pubkey());
    let a_kp = t.a.insecure_clone();
    let b_kp = t.b.insecure_clone();
    let payer_kp = t.payer.insecure_clone();
    let judge = t.judge.insecure_clone();
    let stranger = t.stranger.insecure_clone();
    let (budget, created) = t.open(&t.terms(1));
    t.reserve(&budget, created, &a_kp, 40_000_000);
    t.reserve(&budget, created, &b_kp, 30_000_000);

    t.world.refused(
        "resolve an undisputed reservation",
        resolve_ix(&budget, created, &a, &payer, &judge.pubkey(), 1),
        &[&judge],
        RESERVATION_NOT_DISPUTED,
    );
    t.post(&budget, created, &a_kp, 40_000_000);
    t.world.refused(
        "dispute by someone else",
        hold_ix("dispute", &budget, created, &a, &stranger.pubkey()),
        &[&stranger],
        UNAUTHORISED_SIGNER,
    );
    t.hold("dispute", &budget, created, &a);
    let a_disputed = t.world.slot();
    for (label, ix, signers, code) in [
        (
            "dispute twice",
            hold_ix("dispute", &budget, created, &a, &payer),
            vec![&payer_kp],
            RESERVATION_DISPUTED,
        ),
        (
            "waive a disputed reservation",
            hold_ix("waive", &budget, created, &a, &payer),
            vec![&payer_kp],
            RESERVATION_DISPUTED,
        ),
        (
            "post on a disputed reservation",
            post_ix(&budget, created, &a, 1),
            vec![&a_kp],
            RESERVATION_DISPUTED,
        ),
        (
            "payout while the judge may rule",
            payout_ix(&budget, created, &a, &payer),
            vec![&stranger],
            PAYOUT_NOT_OPEN,
        ),
        (
            "resolve by someone else",
            resolve_ix(&budget, created, &a, &payer, &stranger.pubkey(), 1),
            vec![&stranger],
            UNAUTHORISED_SIGNER,
        ),
        (
            "resolve above the posted amount",
            resolve_ix(&budget, created, &a, &payer, &judge.pubkey(), 40_000_001),
            vec![&judge],
            INVALID_RESOLUTION,
        ),
    ] {
        t.world.refused(label, ix, &signers, code);
    }
    // The judge may still rule in the last slot of its window (B10).
    t.world.warp(a_disputed + JUDGE_SLOTS - 1);
    let a_before = t.lamports(&a);
    let payer_before = t.lamports(&payer);
    t.world.ok(
        "resolve_budget",
        resolve_ix(&budget, created, &a, &payer, &judge.pubkey(), 10_000_000),
        &[&judge],
    );
    assert_eq!(t.lamports(&a), a_before + 10_000_000 - fee(10_000_000));
    assert_eq!(t.lamports(&payer), payer_before + 30_000_000);
    assert_eq!(
        read_reservation(&t.world, &reservation_address(&budget, &a)).state,
        R_PAID
    );

    // B is disputed and the judge does not rule in time: a full refund.
    t.post(&budget, created, &b_kp, 30_000_000);
    t.hold("dispute", &budget, created, &b);
    let disputed = t.world.slot();
    t.world.warp(disputed + JUDGE_SLOTS);
    t.world.refused(
        "resolve after the judge window",
        resolve_ix(&budget, created, &b, &payer, &judge.pubkey(), 1),
        &[&judge],
        JUDGE_WINDOW_CLOSED,
    );
    let b_before = t.lamports(&b);
    let payer_before = t.lamports(&payer);
    t.payout(&budget, created, &b);
    assert_eq!(t.lamports(&b), b_before);
    assert_eq!(t.lamports(&payer), payer_before + 30_000_000);

    // The payer closes: both reservations are settled, so the budget closes
    // outright, and the paid reservations close afterwards.
    t.world.ok(
        "close_budget",
        close_ix(&budget, created, &payer, &payer),
        &[&payer_kp],
    );
    assert!(!t.world.exists(&budget));
    t.payout(&budget, created, &a);
    t.payout(&budget, created, &b);
    assert!(!t.world.exists(&reservation_address(&budget, &a)));
    assert!(!t.world.exists(&reservation_address(&budget, &b)));
}

#[test]
fn a_disputed_reservation_of_a_closed_budget_is_still_resolved() {
    let mut t = Fixture::new();
    let payer = t.payer.pubkey();
    let a = t.a.pubkey();
    let a_kp = t.a.insecure_clone();
    let payer_kp = t.payer.insecure_clone();
    let judge = t.judge.insecure_clone();
    let (budget, created) = t.open(&t.terms(1));
    t.reserve(&budget, created, &a_kp, 40_000_000);
    t.post(&budget, created, &a_kp, 40_000_000);
    t.world.ok(
        "close_budget",
        close_ix(&budget, created, &payer, &payer),
        &[&payer_kp],
    );
    t.hold("dispute", &budget, created, &a);
    let a_before = t.lamports(&a);
    t.world.ok(
        "resolve_budget after close",
        resolve_ix(&budget, created, &a, &payer, &judge.pubkey(), 40_000_000),
        &[&judge],
    );
    assert_eq!(
        t.lamports(&a),
        a_before + 40_000_000 - fee(40_000_000) + rent(&t.world, RESERVATION_LEN)
    );
    assert!(!t.world.exists(&budget));
}

#[test]
fn a_budget_takes_at_most_eight_reservations() {
    let mut t = Fixture::new();
    let spender = t.spender.insecure_clone();
    let (budget, created) = t.open(&t.terms(1));
    let mut providers = Vec::new();
    for seed in 10..19 {
        let provider = t.world.wallet(seed);
        t.world.register(&provider, AgentType::Primary);
        providers.push(provider);
    }
    for provider in &providers[..8] {
        t.reserve(&budget, created, provider, 1_000_000);
    }
    let ninth = &providers[8];
    t.world.refused(
        "a ninth reservation",
        reserve_ix(
            &budget,
            created,
            &spender.pubkey(),
            &ninth.pubkey(),
            &ninth.pubkey(),
            1_000_000,
        ),
        &[ninth, &spender],
        TOO_MANY_RESERVATIONS,
    );
    assert_eq!(read_budget(&t.world, &budget).reservations, 8);
}

#[test]
fn nothing_signed_for_one_budget_acts_on_a_later_one_at_the_same_address() {
    let mut t = Fixture::new();
    let payer = t.payer.pubkey();
    let a = t.a.pubkey();
    let a_kp = t.a.insecure_clone();
    let payer_kp = t.payer.insecure_clone();
    let spender = t.spender.insecure_clone();
    let terms = t.terms(1);
    let (budget, first) = t.open(&terms);
    t.reserve(&budget, first, &a_kp, 40_000_000);
    t.post(&budget, first, &a_kp, 10_000_000);
    t.hold("waive", &budget, first, &a);
    t.payout(&budget, first, &a);
    t.world.ok(
        "close_budget",
        close_ix(&budget, first, &payer, &payer),
        &[&payer_kp],
    );
    assert!(!t.world.exists(&budget));
    assert!(t.world.exists(&reservation_address(&budget, &a)));

    // Re-opened at the same address in a later slot (B7).
    let (again, second) = t.open(&terms);
    assert_eq!(again, budget);
    assert_ne!(first, second);
    t.world.refused(
        "a reserve signed for the first budget",
        reserve_ix(&budget, first, &spender.pubkey(), &a, &a, 40_000_000),
        &[&a_kp, &spender],
        BUDGET_INSTANCE_MISMATCH,
    );
    // The first budget's paid reservation is in the way until it is closed,
    // which anyone may do now: its budget instance is gone.
    t.world.refused(
        "reserve over the old reservation",
        reserve_ix(&budget, second, &spender.pubkey(), &a, &a, 40_000_000),
        &[&a_kp, &spender],
        INVALID_RESERVATION,
    );
    t.payout(&budget, second, &a);
    t.reserve(&budget, second, &a_kp, 40_000_000);
    assert_eq!(
        read_reservation(&t.world, &reservation_address(&budget, &a)).state,
        R_OPEN
    );
}

// ── Tokens ──────────────────────────────────────────────────────────────────

struct TokenFixture {
    t: Fixture,
    tokens: Tokens,
}

impl TokenFixture {
    fn new(program: Pubkey, mint: Pubkey) -> Self {
        let mut t = Fixture::new();
        let tokens = Tokens::install(
            &mut t.world,
            program,
            mint,
            t.payer.insecure_clone(),
            t.a.insecure_clone(),
        );
        Self { t, tokens }
    }

    fn open(&mut self, terms: &Terms) -> (Pubkey, u64) {
        let payer = self.t.payer.insecure_clone();
        self.t.world.ok(
            "open_token_budget",
            terms.open_token_ix(&self.tokens),
            &[&payer],
        );
        let budget = budget_address(&payer.pubkey(), terms.nonce);
        let created = read_budget(&self.t.world, &budget).created;
        self.t.world.next_slot();
        (budget, created)
    }

    fn reserve(&mut self, budget: &Pubkey, created: u64, amount: u64) {
        let spender = self.t.spender.insecure_clone();
        let a = self.t.a.insecure_clone();
        self.t.world.ok(
            "reserve (token)",
            reserve_ix(
                budget,
                created,
                &spender.pubkey(),
                &a.pubkey(),
                &self.tokens.recipient,
                amount,
            ),
            &[&a, &spender],
        );
    }

    fn balance(&self, address: &Pubkey) -> u64 {
        self.tokens.balance(&self.t.world, address)
    }
}

fn token_budget_flow(program: Pubkey, mint: Pubkey) {
    let mut f = TokenFixture::new(program, mint);
    let payer = f.t.payer.pubkey();
    let a = f.t.a.pubkey();
    let a_kp = f.t.a.insecure_clone();
    let payer_kp = f.t.payer.insecure_clone();
    let stranger = f.t.stranger.insecure_clone();
    let terms = Terms {
        total: TOKEN_TOTAL,
        ..f.t.terms(1)
    };
    let source_start = f.balance(&f.tokens.source);
    let (budget, created) = f.open(&terms);
    let vault = vault_address(&budget);
    assert_eq!(f.balance(&vault), TOKEN_TOTAL);
    assert_eq!(f.balance(&f.tokens.source), source_start - TOKEN_TOTAL);

    // A token reservation pays into a token account the payee owns.
    let spender = f.t.spender.insecure_clone();
    f.t.world.refused(
        "a payout account the payee does not own",
        reserve_ix(
            &budget,
            created,
            &spender.pubkey(),
            &a,
            &f.tokens.source,
            6_000_000,
        ),
        &[&a_kp, &spender],
        INVALID_TOKEN_ACCOUNT,
    );
    f.t.world.refused(
        "the vault as payout account",
        reserve_ix(&budget, created, &spender.pubkey(), &a, &vault, 6_000_000),
        &[&a_kp, &spender],
        INVALID_TOKEN_ACCOUNT,
    );
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 4_000_000);
    f.t.hold("waive", &budget, created, &a);

    // B9: the money goes only to the recorded payout account.
    let other = Pubkey::new_from_array([103; 32]);
    f.t.world.set(
        other,
        Account {
            lamports: 10_000_000,
            data: token_account_data(&program, &mint, &a, 0),
            owner: program,
            ..Account::default()
        },
    );
    f.t.world.refused(
        "payout to another account of the payee",
        token_payout_ix(&f.tokens, &budget, created, &a, &other),
        &[&stranger],
        INVALID_TOKEN_ACCOUNT,
    );
    // B12: the payee re-points its payout account; then it is the one used.
    f.t.world.ok(
        "set_payout_account",
        set_payout_ix(&budget, created, &a, &other),
        &[&a_kp],
    );
    assert_eq!(
        read_reservation(&f.t.world, &reservation_address(&budget, &a)).payout_account,
        other
    );
    f.t.world.refused(
        "payout to the old account",
        token_payout_ix(&f.tokens, &budget, created, &a, &f.tokens.recipient),
        &[&stranger],
        INVALID_TOKEN_ACCOUNT,
    );
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "payout_token_budget (waived, open)",
        token_payout_ix(&f.tokens, &budget, created, &a, &other),
        &[&stranger],
    );
    assert_eq!(f.balance(&other), 4_000_000 - fee(4_000_000));
    assert_eq!(f.balance(&f.tokens.treasury_token), fee(4_000_000));
    assert_eq!(f.balance(&f.tokens.source), source_before + 2_000_000);
    assert_eq!(f.balance(&vault), TOKEN_TOTAL - 6_000_000);

    // The payer closes: the unreserved part returns, the vault and the
    // budget close.
    f.t.world.ok(
        "close_token_budget",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    assert!(!f.t.world.exists(&budget));
    assert!(!f.t.world.exists(&vault));
    assert_eq!(
        f.balance(&f.tokens.source),
        source_start - (4_000_000),
        "the payer spent only what was paid"
    );
    f.t.world.ok(
        "payout_token_budget (close paid)",
        token_payout_ix(&f.tokens, &budget, created, &a, &other),
        &[&stranger],
    );
    assert!(!f.t.world.exists(&reservation_address(&budget, &a)));

    // A second budget: posted, closed, paid after the dispute window. The
    // last payout closes the vault.
    let terms = Terms {
        nonce: nonce(2),
        ..terms
    };
    let (budget, created) = f.open(&terms);
    let vault = vault_address(&budget);
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 5_000_000);
    f.t.world.ok(
        "close_token_budget (one open reservation)",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    assert_eq!(f.balance(&vault), 6_000_000);
    let closed = read_budget(&f.t.world, &budget).closed_slot;
    f.t.world.refused(
        "token payout inside the dispute window",
        token_payout_ix(&f.tokens, &budget, created, &a, &f.tokens.recipient),
        &[&stranger],
        PAYOUT_NOT_OPEN,
    );
    f.t.world.warp(closed + DISPUTE_SLOTS);
    let recipient_before = f.balance(&f.tokens.recipient);
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "payout_token_budget (window ended, last)",
        token_payout_ix(&f.tokens, &budget, created, &a, &f.tokens.recipient),
        &[&stranger],
    );
    assert_eq!(
        f.balance(&f.tokens.recipient),
        recipient_before + 5_000_000 - fee(5_000_000)
    );
    assert_eq!(f.balance(&f.tokens.source), source_before + 1_000_000);
    assert!(!f.t.world.exists(&budget));
    assert!(!f.t.world.exists(&vault));
    assert!(!f.t.world.exists(&reservation_address(&budget, &a)));

    // A third: disputed and resolved by the judge after close.
    let judge = f.t.judge.insecure_clone();
    let terms = Terms {
        nonce: nonce(3),
        ..terms
    };
    let (budget, created) = f.open(&terms);
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 6_000_000);
    f.t.hold("dispute", &budget, created, &a);
    f.t.world.ok(
        "close_token_budget (disputed)",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    let recipient_before = f.balance(&f.tokens.recipient);
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "resolve_token_budget",
        token_resolve_ix(
            &f.tokens,
            &budget,
            created,
            &a,
            &f.tokens.recipient,
            &judge.pubkey(),
            3_000_000,
        ),
        &[&judge],
    );
    assert_eq!(
        f.balance(&f.tokens.recipient),
        recipient_before + 3_000_000 - fee(3_000_000)
    );
    assert_eq!(f.balance(&f.tokens.source), source_before + 3_000_000);
    assert!(!f.t.world.exists(&budget));
    assert!(!f.t.world.exists(&vault_address(&budget)));
    f.t.world
        .report(&format!("budget compute units ({program})"));
}

#[test]
fn a_usdc_budget_pays_from_one_vault() {
    token_budget_flow(spl_token_id(), USDC_MAINNET_MINT);
}

#[test]
fn a_pyusd_token_2022_budget_pays_from_one_vault() {
    token_budget_flow(TOKEN_2022_ID, PYUSD_MAINNET_MINT);
}

fn spl_token_id() -> Pubkey {
    anchor_spl::token::ID
}

#[test]
fn a_token_budget_refuses_a_mint_that_is_not_allowed_and_a_sol_exit() {
    let mut f = TokenFixture::new(spl_token_id(), USDC_MAINNET_MINT);
    let payer = f.t.payer.pubkey();
    let payer_kp = f.t.payer.insecure_clone();
    let stranger = f.t.stranger.insecure_clone();
    let terms = Terms {
        total: TOKEN_TOTAL,
        ..f.t.terms(1)
    };
    let mut above = terms.clone();
    above.total = 100_000_001;
    f.t.world.refused(
        "above the token cap",
        above.open_token_ix(&f.tokens),
        &[&payer_kp],
        AMOUNT_ABOVE_CAP,
    );
    let (budget, created) = f.open(&terms);
    let a_kp = f.t.a.insecure_clone();
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 4_000_000);
    f.t.hold("waive", &budget, created, &f.t.a.pubkey());
    f.t.world.refused(
        "a SOL payout of a token budget",
        payout_ix(&budget, created, &f.t.a.pubkey(), &payer),
        &[&stranger],
        6026,
    );
    f.t.world.refused(
        "a SOL close of a token budget",
        close_ix(&budget, created, &payer, &payer),
        &[&payer_kp],
        6026,
    );
}

#[test]
fn compute_units_of_the_largest_budget_calls() {
    let mut t = Fixture::new();
    let a_kp = t.a.insecure_clone();
    let (budget, created) = t.open(&Terms {
        allowlist: [t.a.pubkey(), t.b.pubkey(), ZERO, ZERO],
        ..t.terms(1)
    });
    t.reserve(&budget, created, &a_kp, 40_000_000);
    t.post(&budget, created, &a_kp, 30_000_000);
    t.hold("waive", &budget, created, &t.a.pubkey());
    t.payout(&budget, created, &t.a.pubkey());
    t.world.report("budget compute units (SOL)");
    for (label, units) in &t.world.compute {
        assert!(*units < 60_000, "{label} used {units} compute units");
    }
}

// ── Token-2022 issuer controls (B8) ─────────────────────────────────────────

/// Sets the PYUSD fixture mint's transfer fee, as the issuer could, effective
/// at once. The TransferFeeConfig record sits at byte 242 of the fixture:
/// two authorities (64) and the withheld amount (8), then two fee records of
/// epoch u64, maximum fee u64, basis points u16.
fn set_transfer_fee(world: &mut World, mint: &Pubkey, bps: u16) {
    let mut account = world.svm.get_account(mint).unwrap();
    assert_eq!(
        &account.data[238..240],
        &1u16.to_le_bytes(),
        "TransferFeeConfig"
    );
    for record in [242 + 72, 242 + 90] {
        account.data[record..record + 8].copy_from_slice(&0u64.to_le_bytes());
        account.data[record + 8..record + 16].copy_from_slice(&u64::MAX.to_le_bytes());
        account.data[record + 16..record + 18].copy_from_slice(&bps.to_le_bytes());
    }
    world.set(*mint, account);
}

/// Stands in for the issuer's permanent delegate taking tokens out of the
/// vault: the vault's balance drops to `amount`.
fn shrink_vault(world: &mut World, vault: &Pubkey, amount: u64) {
    let mut account = world.svm.get_account(vault).unwrap();
    account.data[64..72].copy_from_slice(&amount.to_le_bytes());
    world.set(*vault, account);
}

/// What a 1% Token-2022 transfer fee leaves the receiver (rounded up fee).
fn after_fee(sent: u64) -> u64 {
    sent - sent.div_ceil(100)
}

#[test]
fn a_transfer_fee_at_open_refuses_the_open() {
    let mut f = TokenFixture::new(TOKEN_2022_ID, PYUSD_MAINNET_MINT);
    let payer_kp = f.t.payer.insecure_clone();
    set_transfer_fee(&mut f.t.world, &PYUSD_MAINNET_MINT, 100);
    let terms = Terms {
        total: TOKEN_TOTAL,
        ..f.t.terms(1)
    };
    let error =
        f.t.world
            .send(&[terms.open_token_ix(&f.tokens)], &[&payer_kp])
            .err()
            .expect("refused");
    assert!(error.contains("Custom(6024)"), "{error}");
}

#[test]
fn a_transfer_fee_switched_on_later_does_not_strand_a_budget() {
    let mut f = TokenFixture::new(TOKEN_2022_ID, PYUSD_MAINNET_MINT);
    let payer = f.t.payer.pubkey();
    let a = f.t.a.pubkey();
    let a_kp = f.t.a.insecure_clone();
    let payer_kp = f.t.payer.insecure_clone();
    let stranger = f.t.stranger.insecure_clone();
    let judge = f.t.judge.insecure_clone();
    let terms = Terms {
        total: TOKEN_TOTAL,
        ..f.t.terms(1)
    };
    let (budget, created) = f.open(&terms);
    let vault = vault_address(&budget);
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 4_000_000);
    f.t.hold("waive", &budget, created, &a);
    set_transfer_fee(&mut f.t.world, &PYUSD_MAINNET_MINT, 100);

    // Payout: every leg arrives less the issuer's fee, and nothing fails.
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "payout_token_budget (transfer fee on)",
        token_payout_ix(&f.tokens, &budget, created, &a, &f.tokens.recipient),
        &[&stranger],
    );
    let paid = 4_000_000 - fee(4_000_000);
    assert_eq!(f.balance(&f.tokens.recipient), after_fee(paid));
    assert_eq!(
        f.balance(&f.tokens.treasury_token),
        after_fee(fee(4_000_000))
    );
    assert_eq!(
        f.balance(&f.tokens.source),
        source_before + after_fee(2_000_000)
    );
    assert_eq!(
        f.balance(&vault),
        TOKEN_TOTAL - 6_000_000,
        "the vault sent exactly the slice"
    );

    // Close: the unreserved part comes back less the fee; vault and budget close.
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "close_token_budget (transfer fee on)",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    assert_eq!(
        f.balance(&f.tokens.source),
        source_before + after_fee(4_000_000)
    );
    assert!(!f.t.world.exists(&budget));
    assert!(!f.t.world.exists(&vault));

    // Resolve with the fee on: a second budget opened while the fee was 0.
    set_transfer_fee(&mut f.t.world, &PYUSD_MAINNET_MINT, 0);
    let terms = Terms {
        nonce: nonce(2),
        ..terms
    };
    let (budget, created) = f.open(&terms);
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 6_000_000);
    f.t.hold("dispute", &budget, created, &a);
    f.t.world.ok(
        "close_token_budget (disputed)",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    set_transfer_fee(&mut f.t.world, &PYUSD_MAINNET_MINT, 100);
    let recipient_before = f.balance(&f.tokens.recipient);
    f.t.world.ok(
        "resolve_token_budget (transfer fee on)",
        token_resolve_ix(
            &f.tokens,
            &budget,
            created,
            &a,
            &f.tokens.recipient,
            &judge.pubkey(),
            3_000_000,
        ),
        &[&judge],
    );
    assert_eq!(
        f.balance(&f.tokens.recipient),
        recipient_before + after_fee(3_000_000 - fee(3_000_000))
    );
    assert!(!f.t.world.exists(&budget));
    assert!(!f.t.world.exists(&vault_address(&budget)));
}

#[test]
fn an_issuer_taking_vault_tokens_does_not_strand_a_budget() {
    let mut f = TokenFixture::new(TOKEN_2022_ID, PYUSD_MAINNET_MINT);
    let payer = f.t.payer.pubkey();
    let a = f.t.a.pubkey();
    let a_kp = f.t.a.insecure_clone();
    let payer_kp = f.t.payer.insecure_clone();
    let stranger = f.t.stranger.insecure_clone();
    let terms = Terms {
        total: TOKEN_TOTAL,
        ..f.t.terms(1)
    };
    let (budget, created) = f.open(&terms);
    let vault = vault_address(&budget);
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 6_000_000);
    f.t.hold("waive", &budget, created, &a);
    shrink_vault(&mut f.t.world, &vault, 3_000_000);

    // The payee is paid first from what is left; nothing remains for the fee
    // or the refund.
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "payout_token_budget (vault shrunk)",
        token_payout_ix(&f.tokens, &budget, created, &a, &f.tokens.recipient),
        &[&stranger],
    );
    assert_eq!(f.balance(&f.tokens.recipient), 3_000_000);
    assert_eq!(f.balance(&f.tokens.treasury_token), 0);
    assert_eq!(f.balance(&f.tokens.source), source_before);
    assert_eq!(f.balance(&vault), 0);

    // The close refunds what is there (nothing) and both accounts close.
    f.t.world.ok(
        "close_token_budget (vault empty)",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    assert_eq!(f.balance(&f.tokens.source), source_before);
    assert!(!f.t.world.exists(&budget));
    assert!(!f.t.world.exists(&vault));
}

// ── A payout account the provider closed or that was frozen (round 4) ──────

const ACCOUNT_NOT_INITIALIZED: u32 = 3012;

/// Install (or re-install) an empty token account of the fixture's mint.
fn put_token_account(f: &mut TokenFixture, address: Pubkey, owner: &Pubkey) {
    let data = token_account_data(&f.tokens.program, &f.tokens.mint, owner, 0);
    f.t.world.set(
        address,
        Account {
            lamports: 10_000_000,
            data,
            owner: f.tokens.program,
            ..Account::default()
        },
    );
}

/// What `CloseAccount` leaves behind: no data, no lamports.
fn close_token_account(f: &mut TokenFixture, address: Pubkey) {
    f.t.world.set(address, Account::default());
}

/// What a freeze by the mint's freeze authority leaves: state Frozen.
fn freeze_token_account(f: &mut TokenFixture, address: Pubkey) {
    let mut account = f.t.world.svm.get_account(&address).unwrap();
    account.data[108] = 2;
    f.t.world.set(address, account);
}

fn associated_token_address(owner: &Pubkey, program: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), program.as_ref(), mint.as_ref()],
        &escrow::ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

fn a_closed_or_frozen_payout_account_cannot_freeze_a_slice(program: Pubkey, mint: Pubkey) {
    let mut f = TokenFixture::new(program, mint);
    let payer = f.t.payer.pubkey();
    let a = f.t.a.pubkey();
    let a_kp = f.t.a.insecure_clone();
    let payer_kp = f.t.payer.insecure_clone();
    let stranger = f.t.stranger.insecure_clone();
    let judge = f.t.judge.insecure_clone();
    let recipient = f.tokens.recipient;
    let associated = associated_token_address(&a, &program, &mint);
    let other = Pubkey::new_from_array([103; 32]);
    let base = Terms {
        total: TOKEN_TOTAL,
        ..f.t.terms(1)
    };

    // 1. Disputed, then the provider closes its payout account: the judge's
    //    resolve(0) refunds the slice, and the budget closes.
    let (budget, created) = f.open(&base);
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 4_000_000);
    f.t.hold("dispute", &budget, created, &a);
    close_token_account(&mut f, recipient);
    f.t.world.refused(
        "re-point while disputed",
        set_payout_ix(&budget, created, &a, &associated),
        &[&a_kp],
        RESERVATION_LOCKED,
    );
    f.t.world.ok(
        "close_token_budget",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "resolve(0) with the payout account closed",
        token_resolve_ix(
            &f.tokens,
            &budget,
            created,
            &a,
            &recipient,
            &judge.pubkey(),
            0,
        ),
        &[&judge],
    );
    assert_eq!(f.balance(&f.tokens.source), source_before + 6_000_000);
    assert!(!f.t.world.exists(&budget));
    assert!(!f.t.world.exists(&vault_address(&budget)));

    // 2. Disputed, payout account closed, the judge never rules: the
    //    timeout refund goes through.
    put_token_account(&mut f, recipient, &a);
    let terms = Terms {
        nonce: nonce(2),
        ..base
    };
    let (budget, created) = f.open(&terms);
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 4_000_000);
    f.t.hold("dispute", &budget, created, &a);
    close_token_account(&mut f, recipient);
    f.t.world.ok(
        "close_token_budget",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    let disputed = u64_at(&f.t.world.data(&reservation_address(&budget, &a)), 136);
    f.t.world.warp(disputed + JUDGE_SLOTS);
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "judge-timeout refund with the payout account closed",
        token_payout_ix(&f.tokens, &budget, created, &a, &recipient),
        &[&stranger],
    );
    assert_eq!(f.balance(&f.tokens.source), source_before + 6_000_000);
    assert!(!f.t.world.exists(&budget));

    // 3. Never posted, payout account closed: the refund goes through.
    put_token_account(&mut f, recipient, &a);
    let terms = Terms {
        nonce: nonce(3),
        ..base
    };
    let (budget, created) = f.open(&terms);
    f.reserve(&budget, created, 6_000_000);
    close_token_account(&mut f, recipient);
    f.t.world.ok(
        "close_token_budget",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    let closed = read_budget(&f.t.world, &budget).closed_slot;
    f.t.world.warp(closed + DISPUTE_SLOTS);
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "refund of an unposted slice with the payout account closed",
        token_payout_ix(&f.tokens, &budget, created, &a, &recipient),
        &[&stranger],
    );
    assert_eq!(f.balance(&f.tokens.source), source_before + 6_000_000);
    assert!(!f.t.world.exists(&budget));

    // 4. Posted, payout account closed, window ended: the closed account
    //    cannot be paid, the provider's associated account can (anyone may
    //    create it), and no other account is accepted.
    put_token_account(&mut f, recipient, &a);
    let terms = Terms {
        nonce: nonce(4),
        ..base
    };
    let (budget, created) = f.open(&terms);
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 4_000_000);
    close_token_account(&mut f, recipient);
    f.t.world.ok(
        "close_token_budget",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    let slice = read_reservation(&f.t.world, &reservation_address(&budget, &a));
    let closed = read_budget(&f.t.world, &budget).closed_slot;
    f.t.world
        .warp((closed + DISPUTE_SLOTS).max(slice.posted + MIN_REVIEW));
    f.t.world.refused(
        "pay into the closed payout account",
        token_payout_ix(&f.tokens, &budget, created, &a, &recipient),
        &[&stranger],
        ACCOUNT_NOT_INITIALIZED,
    );
    put_token_account(&mut f, other, &a);
    f.t.world.refused(
        "pay into an account the payee owns that is neither recorded nor associated",
        token_payout_ix(&f.tokens, &budget, created, &a, &other),
        &[&stranger],
        INVALID_TOKEN_ACCOUNT,
    );
    put_token_account(&mut f, associated, &payer);
    f.t.world.refused(
        "pay into the associated address holding someone else's account",
        token_payout_ix(&f.tokens, &budget, created, &a, &associated),
        &[&stranger],
        INVALID_TOKEN_ACCOUNT,
    );
    put_token_account(&mut f, associated, &a);
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "pay into the provider's associated account",
        token_payout_ix(&f.tokens, &budget, created, &a, &associated),
        &[&stranger],
    );
    assert_eq!(f.balance(&associated), 4_000_000 - fee(4_000_000));
    assert_eq!(f.balance(&f.tokens.source), source_before + 2_000_000);
    assert!(!f.t.world.exists(&budget));

    // 5. Disputed, then the payout account is frozen: resolve(0) refunds;
    //    a split pays the provider's associated account.
    put_token_account(&mut f, recipient, &a);
    put_token_account(&mut f, associated, &a);
    let terms = Terms {
        nonce: nonce(5),
        ..base
    };
    let (budget, created) = f.open(&terms);
    let spender = f.t.spender.insecure_clone();
    f.reserve(&budget, created, 3_000_000);
    let b_kp = f.t.b.insecure_clone();
    let b = b_kp.pubkey();
    let b_account = Pubkey::new_from_array([104; 32]);
    put_token_account(&mut f, b_account, &b);
    f.t.world.ok(
        "reserve (token, B)",
        reserve_ix(
            &budget,
            created,
            &spender.pubkey(),
            &b,
            &b_account,
            3_000_000,
        ),
        &[&b_kp, &spender],
    );
    f.t.post(&budget, created, &a_kp, 3_000_000);
    f.t.post(&budget, created, &b_kp, 3_000_000);
    f.t.hold("dispute", &budget, created, &a);
    f.t.hold("dispute", &budget, created, &b);
    freeze_token_account(&mut f, recipient);
    freeze_token_account(&mut f, b_account);
    f.t.world.ok(
        "close_token_budget",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "resolve(0) with the payout account frozen",
        token_resolve_ix(
            &f.tokens,
            &budget,
            created,
            &b,
            &b_account,
            &judge.pubkey(),
            0,
        ),
        &[&judge],
    );
    assert_eq!(f.balance(&f.tokens.source), source_before + 3_000_000);
    f.t.world.refused(
        "a split into the frozen account",
        token_resolve_ix(
            &f.tokens,
            &budget,
            created,
            &a,
            &recipient,
            &judge.pubkey(),
            2_000_000,
        ),
        &[&judge],
        INVALID_TOKEN_ACCOUNT,
    );
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "a split into the provider's associated account",
        token_resolve_ix(
            &f.tokens,
            &budget,
            created,
            &a,
            &associated,
            &judge.pubkey(),
            2_000_000,
        ),
        &[&judge],
    );
    assert_eq!(f.balance(&associated), 2_000_000 - fee(2_000_000));
    assert_eq!(f.balance(&f.tokens.source), source_before + 1_000_000);
    assert!(!f.t.world.exists(&budget));
}

#[test]
fn a_closed_or_frozen_usdc_payout_account_cannot_freeze_a_slice() {
    a_closed_or_frozen_payout_account_cannot_freeze_a_slice(spl_token_id(), USDC_MAINNET_MINT);
}

#[test]
fn a_closed_or_frozen_pyusd_payout_account_cannot_freeze_a_slice() {
    a_closed_or_frozen_payout_account_cannot_freeze_a_slice(TOKEN_2022_ID, PYUSD_MAINNET_MINT);
}

/// Round 4: a payer that emptied its wallet cannot hold back a payout whose
/// refund to it is below the rent-exempt minimum; such refunds stay in the
/// budget and reach the payer with the budget's rent at its close.
#[test]
fn an_empty_payer_wallet_does_not_block_small_refunds() {
    let mut t = Fixture::new();
    let payer = t.payer.pubkey();
    let a_kp = t.a.insecure_clone();
    let b_kp = t.b.insecure_clone();
    let a = a_kp.pubkey();
    let b = b_kp.pubkey();
    let spender = t.spender.insecure_clone();
    let budget_rent = rent(&t.world, BUDGET_LEN);
    let empty = |t: &mut Fixture| {
        t.world.set(payer, Account::default());
        assert_eq!(t.lamports(&payer), 0);
    };

    // Two slices, each refunding 400,000 lamports; the payer then empties
    // its wallet. The first payout keeps its refund in the budget, the last
    // closes the budget and pays both refunds with the rent.
    let terms = Terms {
        total: 2_000_000,
        ..t.terms(1)
    };
    let (budget, created) = t.open(&terms);
    t.reserve(&budget, created, &a_kp, 1_000_000);
    t.reserve(&budget, created, &b_kp, 1_000_000);
    t.post(&budget, created, &a_kp, 600_000);
    t.post(&budget, created, &b_kp, 600_000);
    empty(&mut t);
    t.world.ok(
        "close_budget by the spender",
        close_ix(&budget, created, &spender.pubkey(), &payer),
        &[&spender],
    );
    let closed = read_budget(&t.world, &budget).closed_slot;
    t.world
        .warp(closed.max(created + OPEN_SLOTS) + DISPUTE_SLOTS);
    t.payout(&budget, created, &a);
    assert_eq!(
        t.lamports(&payer),
        0,
        "the first refund waits in the budget"
    );
    assert_eq!(
        t.lamports(&budget),
        budget_rent + 1_000_000 + 400_000,
        "B's slice and A's refund"
    );
    t.payout(&budget, created, &b);
    assert!(!t.world.exists(&budget));
    assert_eq!(t.lamports(&payer), 800_000 + budget_rent);

    // A close whose unreserved part is below the minimum: kept, then paid
    // with the rent when the last slice settles.
    let terms = Terms {
        nonce: nonce(2),
        total: 2_000_000,
        ..t.terms(1)
    };
    t.world.fund(&t.payer.insecure_clone(), 1_000_000_000);
    let (budget, created) = t.open(&terms);
    t.reserve(&budget, created, &a_kp, 1_500_000);
    t.post(&budget, created, &a_kp, 1_500_000);
    empty(&mut t);
    t.world.ok(
        "close_budget by the spender, payer empty",
        close_ix(&budget, created, &spender.pubkey(), &payer),
        &[&spender],
    );
    assert_eq!(t.lamports(&payer), 0);
    assert_eq!(read_budget(&t.world, &budget).unreserved, 0);
    let closed = read_budget(&t.world, &budget).closed_slot;
    t.world
        .warp(closed.max(created + OPEN_SLOTS) + DISPUTE_SLOTS);
    t.payout(&budget, created, &a);
    assert!(!t.world.exists(&budget));
    assert_eq!(t.lamports(&payer), 500_000 + budget_rent);

    // A refund at or above the minimum is paid at once, as before.
    let terms = Terms {
        nonce: nonce(3),
        total: 4_000_000,
        ..t.terms(1)
    };
    t.world.fund(&t.payer.insecure_clone(), 1_000_000_000);
    let (budget, created) = t.open(&terms);
    t.reserve(&budget, created, &a_kp, 2_000_000);
    t.reserve(&budget, created, &b_kp, 2_000_000);
    t.post(&budget, created, &a_kp, 1_000_000);
    t.post(&budget, created, &b_kp, 1_000_000);
    empty(&mut t);
    t.world.ok(
        "close_budget by the spender",
        close_ix(&budget, created, &spender.pubkey(), &payer),
        &[&spender],
    );
    let closed = read_budget(&t.world, &budget).closed_slot;
    t.world
        .warp(closed.max(created + OPEN_SLOTS) + DISPUTE_SLOTS);
    t.payout(&budget, created, &a);
    assert_eq!(t.lamports(&payer), 1_000_000, "paid at once");
    t.payout(&budget, created, &b);
    assert_eq!(t.lamports(&payer), 2_000_000 + budget_rent);
}

/// SPL Memo v3, which LiteSVM loads with its default programs.
fn memo_program() -> Pubkey {
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        .parse()
        .unwrap()
}

/// The owner of a Token-2022 `account` adds the MemoTransfer extension and
/// switches on required incoming memos.
fn require_incoming_memos(world: &mut World, account: Pubkey, owner: &Keypair) {
    let mut reallocate = vec![29u8];
    reallocate.extend_from_slice(&8u16.to_le_bytes());
    let reallocate = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        TOKEN_2022_ID,
        &reallocate,
        vec![
            anchor_lang::solana_program::instruction::AccountMeta::new(account, false),
            anchor_lang::solana_program::instruction::AccountMeta::new(owner.pubkey(), true),
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                Pubkey::default(),
                false,
            ),
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                owner.pubkey(),
                true,
            ),
        ],
    );
    let enable = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        TOKEN_2022_ID,
        &[30, 0],
        vec![
            anchor_lang::solana_program::instruction::AccountMeta::new(account, false),
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                owner.pubkey(),
                true,
            ),
        ],
    );
    world
        .send(&[reallocate, enable], &[owner])
        .expect("require incoming memos");
}

fn with_memo(
    mut ix: anchor_lang::solana_program::instruction::Instruction,
) -> anchor_lang::solana_program::instruction::Instruction {
    ix.accounts.push(
        anchor_lang::solana_program::instruction::AccountMeta::new_readonly(memo_program(), false),
    );
    ix
}

/// Round 4: Budget exits to Token-2022 accounts that require incoming memos
/// work when the Memo program is passed, and their compute is recorded.
#[test]
fn token_budget_exits_to_accounts_requiring_memos() {
    let mut f = TokenFixture::new(TOKEN_2022_ID, PYUSD_MAINNET_MINT);
    let payer = f.t.payer.pubkey();
    let a = f.t.a.pubkey();
    let a_kp = f.t.a.insecure_clone();
    let payer_kp = f.t.payer.insecure_clone();
    let stranger = f.t.stranger.insecure_clone();
    let judge = f.t.judge.insecure_clone();
    let terms = Terms {
        total: TOKEN_TOTAL,
        ..f.t.terms(1)
    };
    let (budget, created) = f.open(&terms);
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 4_000_000);
    f.t.hold("waive", &budget, created, &a);
    let (recipient, source) = (f.tokens.recipient, f.tokens.source);
    require_incoming_memos(&mut f.t.world, recipient, &a_kp);
    require_incoming_memos(&mut f.t.world, source, &payer_kp);

    // Without the Memo program the payee's leg fails; with it, all pay.
    f.t.world.refused(
        "payout to memo-requiring accounts without the Memo program",
        token_payout_ix(&f.tokens, &budget, created, &a, &recipient),
        &[&stranger],
        36,
    );
    f.t.world.ok(
        "payout_token_budget (memos required)",
        with_memo(token_payout_ix(&f.tokens, &budget, created, &a, &recipient)),
        &[&stranger],
    );
    assert_eq!(f.balance(&recipient), 4_000_000 - fee(4_000_000));
    f.t.world.ok(
        "close_token_budget (memos required)",
        with_memo(token_close_ix(&f.tokens, &budget, created, &payer)),
        &[&payer_kp],
    );
    assert!(!f.t.world.exists(&budget));

    // A judge's split into memo-requiring accounts.
    let terms = Terms {
        nonce: nonce(2),
        ..terms
    };
    let (budget, created) = f.open(&terms);
    f.reserve(&budget, created, 6_000_000);
    f.t.post(&budget, created, &a_kp, 6_000_000);
    f.t.hold("dispute", &budget, created, &a);
    f.t.world.ok(
        "close_token_budget (disputed, memos required)",
        with_memo(token_close_ix(&f.tokens, &budget, created, &payer)),
        &[&payer_kp],
    );
    f.t.world.ok(
        "resolve_token_budget (memos required)",
        with_memo(token_resolve_ix(
            &f.tokens,
            &budget,
            created,
            &a,
            &recipient,
            &judge.pubkey(),
            3_000_000,
        )),
        &[&judge],
    );
    assert!(!f.t.world.exists(&budget));

    f.t.world
        .report("budget compute units (Token-2022, memos required)");
    for (label, units) in &f.t.world.compute {
        assert!(*units < 120_000, "{label} used {units} compute units");
    }
}

/// Round 4 (B1): with an allowlist a spender's close starts the dispute
/// window at once, since the spender can only pay listed providers; the
/// budget records which rule applies (flag 0x04 only without an allowlist).
#[test]
fn a_spender_close_of_an_allowlisted_budget_starts_the_window_at_once() {
    let mut t = Fixture::new();
    let a_kp = t.a.insecure_clone();
    let a = a_kp.pubkey();
    let payer = t.payer.pubkey();
    let spender = t.spender.insecure_clone();
    let terms = Terms {
        allowlist: [a, ZERO, ZERO, ZERO],
        ..t.terms(1)
    };
    let (budget, created) = t.open(&terms);
    t.reserve(&budget, created, &a_kp, 10_000_000);
    t.post(&budget, created, &a_kp, 10_000_000);
    let posted = read_reservation(&t.world, &reservation_address(&budget, &a)).posted;
    t.world.ok(
        "close_budget by the spender",
        close_ix(&budget, created, &spender.pubkey(), &payer),
        &[&spender],
    );
    let view = read_budget(&t.world, &budget);
    assert_eq!(view.flags & 0x04, 0, "no open-end rule with an allowlist");
    let ends = (view.closed_slot + DISPUTE_SLOTS).max(posted + MIN_REVIEW);
    assert!(ends < created + OPEN_SLOTS + DISPUTE_SLOTS);
    t.world.warp(ends);
    let a_before = t.lamports(&a);
    t.payout(&budget, created, &a);
    assert!(t.lamports(&a) > a_before);

    // Without an allowlist the same close sets the flag.
    let terms = Terms {
        nonce: nonce(2),
        ..t.terms(1)
    };
    let (budget, created) = t.open(&terms);
    t.reserve(&budget, created, &a_kp, 10_000_000);
    t.world.ok(
        "close_budget by the spender",
        close_ix(&budget, created, &spender.pubkey(), &payer),
        &[&spender],
    );
    assert_eq!(read_budget(&t.world, &budget).flags & 0x04, 0x04);
}

/// Round 4b (N2): a payout that refunds nothing does not read the payer's
/// refund account, so a closed one cannot block it; one that refunds still
/// needs a usable payer-owned account (its associated account will do).
#[test]
fn a_payout_that_refunds_nothing_ignores_the_refund_account() {
    for (program, mint) in [
        (spl_token_id(), USDC_MAINNET_MINT),
        (TOKEN_2022_ID, PYUSD_MAINNET_MINT),
    ] {
        let mut f = TokenFixture::new(program, mint);
        let payer = f.t.payer.pubkey();
        let a = f.t.a.pubkey();
        let a_kp = f.t.a.insecure_clone();
        let payer_kp = f.t.payer.insecure_clone();
        let stranger = f.t.stranger.insecure_clone();
        let terms = Terms {
            total: TOKEN_TOTAL,
            ..f.t.terms(1)
        };
        let (budget, created) = f.open(&terms);
        f.reserve(&budget, created, 6_000_000);
        f.t.post(&budget, created, &a_kp, 6_000_000);
        f.t.hold("waive", &budget, created, &a);
        f.t.world.ok(
            "close_token_budget",
            token_close_ix(&f.tokens, &budget, created, &payer),
            &[&payer_kp],
        );
        let source = f.tokens.source;
        close_token_account(&mut f, source);
        f.t.world.ok(
            "payout refunding nothing, refund account closed",
            token_payout_ix(&f.tokens, &budget, created, &a, &f.tokens.recipient),
            &[&stranger],
        );
        assert!(!f.t.world.exists(&budget));

        // A payout that refunds needs a usable refund account.
        put_token_account(&mut f, source, &payer);
        shrink_vault(&mut f.t.world, &source, TOKEN_TOTAL);
        let terms = Terms {
            nonce: nonce(2),
            ..terms
        };
        let (budget, created) = f.open(&terms);
        f.reserve(&budget, created, 6_000_000);
        f.t.post(&budget, created, &a_kp, 4_000_000);
        f.t.hold("waive", &budget, created, &a);
        f.t.world.ok(
            "close_token_budget",
            token_close_ix(&f.tokens, &budget, created, &payer),
            &[&payer_kp],
        );
        close_token_account(&mut f, source);
        f.t.world.refused(
            "payout refunding into a closed account",
            token_payout_ix(&f.tokens, &budget, created, &a, &f.tokens.recipient),
            &[&stranger],
            ACCOUNT_NOT_INITIALIZED,
        );
        let associated = associated_token_address(&payer, &program, &mint);
        put_token_account(&mut f, associated, &payer);
        let mut ix = token_payout_ix(&f.tokens, &budget, created, &a, &f.tokens.recipient);
        ix.accounts[8].pubkey = associated;
        f.t.world.ok(
            "payout refunding into the payer's associated account",
            ix,
            &[&stranger],
        );
        assert_eq!(f.balance(&associated), 2_000_000);
        assert!(!f.t.world.exists(&budget));
    }
}

// ── Emergency pause ─────────────────────────────────────────────────────────

#[test]
fn a_paused_token_budget_refunds_but_pays_no_provider() {
    const PROTOCOL_PAUSED: u32 = 6101;
    let mut f = TokenFixture::new(spl_token_id(), USDC_MAINNET_MINT);
    let (payer, a) = (f.t.payer.pubkey(), f.t.a.pubkey());
    let (a_kp, payer_kp, stranger, judge) = (
        f.t.a.insecure_clone(),
        f.t.payer.insecure_clone(),
        f.t.stranger.insecure_clone(),
        f.t.judge.insecure_clone(),
    );
    let terms = Terms {
        total: TOKEN_TOTAL,
        ..f.t.terms(1)
    };
    let (budget, created) = f.open(&terms);
    f.reserve(&budget, created, 4_000_000);
    f.t.world.ok(
        "post_final",
        post_ix(&budget, created, &a, 3_000_000),
        &[&a_kp],
    );
    f.t.world.ok(
        "dispute",
        hold_ix("dispute", &budget, created, &a, &payer),
        &[&payer_kp],
    );

    // Paused, as the guardian's `pause` leaves it.
    let until = f.t.world.slot() + 1_512_000;
    let data = support::instance::pause_state(&support::instance::TEST_GUARDIAN, until);
    let lamports = rent(&f.t.world, data.len());
    f.t.world.set(
        support::instance::PAUSE_ADDRESS,
        Account {
            lamports,
            data,
            owner: escrow::id(),
            ..Account::default()
        },
    );

    // Nothing new: an open is refused.
    let more = Terms {
        total: TOKEN_TOTAL,
        ..f.t.terms(2)
    };
    f.t.world.refused(
        "open_token_budget while paused",
        more.open_token_ix(&f.tokens),
        &[&payer_kp],
        PROTOCOL_PAUSED,
    );
    // Closing refunds the unreserved part.
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "close_token_budget while paused",
        token_close_ix(&f.tokens, &budget, created, &payer),
        &[&payer_kp],
    );
    assert_eq!(
        f.balance(&f.tokens.source),
        source_before + TOKEN_TOTAL - 4_000_000
    );
    // The judge cannot pay the provider; a ruling of 0 refunds the slice.
    let recipient = f.tokens.recipient;
    f.t.world.refused(
        "token resolve paying the provider",
        token_resolve_ix(
            &f.tokens,
            &budget,
            created,
            &a,
            &recipient,
            &judge.pubkey(),
            1_000_000,
        ),
        &[&judge],
        PROTOCOL_PAUSED,
    );
    let source_before = f.balance(&f.tokens.source);
    f.t.world.ok(
        "token resolve of 0",
        token_resolve_ix(
            &f.tokens,
            &budget,
            created,
            &a,
            &recipient,
            &judge.pubkey(),
            0,
        ),
        &[&judge],
    );
    assert_eq!(f.balance(&f.tokens.source), source_before + 4_000_000);
    assert_eq!(f.balance(&recipient), 0, "the provider was paid nothing");
    let _ = stranger;
}
