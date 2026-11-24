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
    t.world.warp(closed + DISPUTE_SLOTS);
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

    // No new reservation after the open period.
    t.world.warp(created + OPEN_SLOTS);
    let c = t.world.wallet(7);
    t.world.register(&c, AgentType::Primary);
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
    let (budget, created) = t.open(&t.terms(1));
    t.reserve(&budget, created, &a_kp, 40_000_000);
    t.reserve(&budget, created, &b_kp, 30_000_000);

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
    t.post(&budget, created, &a_kp, 30_000_000);
    // B3: a re-post may only lower the amount.
    t.world.refused(
        "re-post higher",
        post_ix(&budget, created, &a, 35_000_000),
        &[&a_kp],
        INVALID_FINAL_AMOUNT,
    );
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

    // A re-posts at the last slot of the dispute window: the payer still
    // gets MIN_REVIEW to look at it (B3).
    t.world.warp(closed + DISPUTE_SLOTS - 1);
    t.post(&budget, created, &a_kp, 10_000_000);
    let ra = read_reservation(&t.world, &reservation_address(&budget, &a));
    assert_eq!(
        (ra.final_amount, ra.last_post, ra.state),
        (10_000_000, closed + DISPUTE_SLOTS - 1, R_POSTED)
    );
    t.world.warp(closed + DISPUTE_SLOTS);
    t.world.refused(
        "payout before the review time after the last post",
        payout_ix(&budget, created, &a, &payer),
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

    // The payer disputes inside the review time; the judge window runs.
    t.world.warp(closed + DISPUTE_SLOTS - 1 + MIN_REVIEW - 1);
    t.hold("dispute", &budget, created, &a);
    let ra = read_reservation(&t.world, &reservation_address(&budget, &a));
    assert_eq!(ra.state, R_DISPUTED);
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
