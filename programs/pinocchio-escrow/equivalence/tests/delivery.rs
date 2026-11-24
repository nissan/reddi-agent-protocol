//! Delivery-checked escrows: `open_delivery`, `record_delivery`,
//! `accept_delivery`, `dispute_delivery`, `resolve_delivery`,
//! `resolve_token_delivery`, and what every exit of a delivery-checked escrow
//! does with the delivery account. Runs against the built Pinocchio binary.
//!
//! The threat model's items are named where a test covers them (D1 to D9).
//! An escrow that is not opted in is covered unchanged by the side-by-side
//! suite. Lamport conservation is asserted on every transaction by the
//! harness.
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
const VERIFY: u64 = DELIVERY_VERIFY;
const RESOLVE: u64 = DELIVERY_RESOLVE;
const COLLECT: u64 = 216_000;
const SHA: [u8; 32] = DELIVERY_SHA;
const AWAITING: u8 = 0;
const DELIVERED: u8 = 1;
const ACCEPTED: u8 = 2;
const DISPUTED: u8 = 3;

const ESCROW_JUST_LOCKED: u32 = 6052;
const DELIVERY_ACCOUNT_REQUIRED: u32 = 6054;
const INVALID_DELIVERY_ACCOUNT: u32 = 6055;
const DELIVERY_OPT_IN_CLOSED: u32 = 6056;
const ALREADY_DELIVERY_CHECKED: u32 = 6057;
const INVALID_DELIVERY_TERMS: u32 = 6058;
const DELIVERY_JOB_MISMATCH: u32 = 6059;
const DELIVERY_ALREADY_RECORDED: u32 = 6060;
const DELIVERY_NOT_RECORDED: u32 = 6061;
const VERIFY_WINDOW_OPEN: u32 = 6062;
const DELIVERY_DISPUTED: u32 = 6063;
const VERIFY_WINDOW_CLOSED: u32 = 6064;
const DELIVERY_NOT_DISPUTED: u32 = 6065;
const RESOLVE_WINDOW_CLOSED: u32 = 6066;
const DELIVERY_DEADLINE_PASSED: u32 = 6067;
const INVALID_DELIVERY: u32 = 6068;
const DELIVERY_ALREADY_ACCEPTED: u32 = 6069;
const DELIVERY_REFUND_NOT_OPEN: u32 = 6070;
const INVALID_RESOLUTION: u32 = 6071;
const CANCEL_WINDOW_NOT_ELAPSED: u32 = 6006;
const INVALID_TOKEN_ACCOUNT: u32 = 6023;
const ESCROW_INSTANCE_MISMATCH: u32 = 6053;
const CLAIM_WINDOW_NOT_ELAPSED: u32 = 6027;

// ── Reading the delivery account ────────────────────────────────────────────

#[derive(Debug, PartialEq, Eq)]
struct Delivery {
    escrow: Pubkey,
    judge: Pubkey,
    opened_slot: u64,
    verify_window_slots: u64,
    resolve_window_slots: u64,
    delivered_slot: u64,
    units: u64,
    bytes: u64,
    sha256: [u8; 32],
    disputed_slot: u64,
    state: u8,
    bump: u8,
}

fn u64_of(data: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(data[at..at + 8].try_into().unwrap())
}

fn read_delivery(world: &World, escrow: &Pubkey) -> Delivery {
    let data = world.data(&delivery_address(escrow));
    assert_eq!(data.len(), DELIVERY_LEN);
    assert_eq!(data[..8], account_discriminator("DeliveryAccount"));
    Delivery {
        escrow: Pubkey::new_from_array(data[8..40].try_into().unwrap()),
        judge: Pubkey::new_from_array(data[40..72].try_into().unwrap()),
        opened_slot: u64_of(&data, 72),
        verify_window_slots: u64_of(&data, 80),
        resolve_window_slots: u64_of(&data, 88),
        delivered_slot: u64_of(&data, 96),
        units: u64_of(&data, 104),
        bytes: u64_of(&data, 112),
        sha256: data[120..152].try_into().unwrap(),
        disputed_slot: u64_of(&data, 152),
        state: data[160],
        bump: data[161],
    }
}

/// The lock slot of a SOL escrow.
fn sol_created(world: &World, escrow: &Pubkey) -> u64 {
    u64_of(&world.data(escrow), 8 + 32 + 32 + 8 + 16 + 1 + 8)
}

/// The lock slot of a token escrow.
fn token_created(world: &World, escrow: &Pubkey) -> u64 {
    u64_of(&world.data(escrow), 8 + 32 * 5 + 8 + 16 + 1)
}

// ── SOL fixture ─────────────────────────────────────────────────────────────

struct Sol {
    world: World,
    payer: Keypair,
    payee: Keypair,
    judge: Keypair,
    stranger: Keypair,
}

impl Sol {
    fn new() -> Self {
        let mut world = World::new();
        let (payer, payee, judge, stranger) = (
            world.wallet(1),
            world.wallet(2),
            world.wallet(4),
            world.wallet(3),
        );
        world.register(&judge, AgentType::Attestation);
        Self {
            world,
            payer,
            payee,
            judge,
            stranger,
        }
    }

    fn escrow(&self, i: u8) -> Pubkey {
        sol_escrow(&self.payer.pubkey(), nonce(i))
    }

    fn lock_ix(&self, i: u8, metered: bool) -> Instruction {
        sol_lock(
            &self.payer.pubkey(),
            &self.payee.pubkey(),
            AMOUNT,
            nonce(i),
            metered,
        )
    }

    /// Lock and opt in, in one transaction, then move to the next slot.
    fn lock_checked(&mut self, i: u8, metered: bool) -> (Pubkey, u64) {
        let escrow = self.escrow(i);
        let open = open_delivery(&escrow, &self.payer.pubkey(), &self.judge.pubkey());
        self.world
            .send(&[self.lock_ix(i, metered), open], &[&self.payer])
            .expect("lock and open_delivery");
        let created = sol_created(&self.world, &escrow);
        self.world.next_slot();
        (escrow, created)
    }

    fn record(&mut self, escrow: &Pubkey, opened: u64) {
        let ix = record_delivery(escrow, &self.payee.pubkey(), opened, 30, 37_500_000);
        self.world.ok("record_delivery", ix, &[&self.payee]);
    }

    fn settle(&self, i: u8, actual: u64) -> Instruction {
        with_delivery(
            sol_payout(
                &self.payer.pubkey(),
                &self.payee.pubkey(),
                nonce(i),
                &self.payee.pubkey(),
                Some(actual),
            ),
            &self.escrow(i),
        )
    }

    fn release(&self, i: u8, signer: &Keypair) -> Instruction {
        with_delivery(
            sol_payout(
                &self.payer.pubkey(),
                &self.payee.pubkey(),
                nonce(i),
                &signer.pubkey(),
                None,
            ),
            &self.escrow(i),
        )
    }

    fn cancel(&self, i: u8, authority: &Keypair) -> Instruction {
        with_delivery(
            sol_cancel(&self.payer.pubkey(), nonce(i), &authority.pubkey()),
            &self.escrow(i),
        )
    }

    fn resolve(&self, i: u8, payout: u64, opened: u64) -> Instruction {
        sol_resolve(
            &self.payer.pubkey(),
            &self.payee.pubkey(),
            &self.escrow(i),
            &self.judge.pubkey(),
            payout,
            opened,
            false,
        )
    }
}

fn delivery_rent(world: &World) -> u64 {
    world.svm.minimum_balance_for_rent_exemption(DELIVERY_LEN)
}

// ── open_delivery ───────────────────────────────────────────────────────────

#[test]
fn open_delivery_creates_the_account_and_flags_the_escrow() {
    let mut t = Sol::new();
    for (i, metered) in [(1u8, false), (2, true)] {
        let escrow = t.escrow(i);
        let open = open_delivery(&escrow, &t.payer.pubkey(), &t.judge.pubkey());
        t.world
            .send(&[t.lock_ix(i, metered), open], &[&t.payer])
            .unwrap();
        let created = sol_created(&t.world, &escrow);
        assert_eq!(
            t.world.data(&escrow)[SOL_ESCROW_FLAGS_AT],
            metered as u8 | FLAG_DELIVERY
        );
        assert_eq!(
            read_delivery(&t.world, &escrow),
            Delivery {
                escrow,
                judge: t.judge.pubkey(),
                opened_slot: created,
                verify_window_slots: VERIFY,
                resolve_window_slots: RESOLVE,
                delivered_slot: 0,
                units: 0,
                bytes: 0,
                sha256: [0; 32],
                disputed_slot: 0,
                state: AWAITING,
                bump: Pubkey::find_program_address(&[b"delivery", escrow.as_ref()], &escrow::id())
                    .1,
            }
        );
        t.world.next_slot();
    }
}

#[test]
fn open_delivery_only_by_the_payer_in_the_lock_slot_and_once() {
    // D2.
    let mut t = Sol::new();
    let escrow = t.escrow(1);
    let payer = t.payer.pubkey();
    let judge = t.judge.pubkey();
    t.world.ok("lock", t.lock_ix(1, true), &[&t.payer]);

    // Not the payer.
    let stranger = t.stranger.insecure_clone();
    let mut by_stranger = open_delivery(&escrow, &stranger.pubkey(), &judge);
    by_stranger.accounts[2].pubkey = stranger.pubkey();
    t.world.refused(
        "open by stranger",
        by_stranger,
        &[&stranger],
        UNAUTHORISED_SIGNER,
    );
    // Out of range windows.
    for (verify, resolve) in [
        (149, RESOLVE),
        (1_512_001, RESOLVE),
        (VERIFY, 1_499),
        (VERIFY, 3_024_001),
    ] {
        t.world.refused(
            "windows out of range",
            open_delivery_with(&escrow, &payer, &judge, verify, resolve),
            &[&t.payer],
            INVALID_DELIVERY_TERMS,
        );
    }
    t.world
        .ok("open", open_delivery(&escrow, &payer, &judge), &[&t.payer]);
    // Twice: the flag is set.
    t.world.refused(
        "open twice",
        open_delivery(&escrow, &payer, &judge),
        &[&t.payer],
        ALREADY_DELIVERY_CHECKED,
    );

    // A later slot.
    t.world.ok("lock 2", t.lock_ix(2, true), &[&t.payer]);
    t.world.next_slot();
    t.world.refused(
        "open after the lock slot",
        open_delivery(&t.escrow(2), &payer, &judge),
        &[&t.payer],
        DELIVERY_OPT_IN_CLOSED,
    );
}

#[test]
fn the_judge_must_be_an_active_attestation_agent_and_not_a_party() {
    let mut t = Sol::new();
    let payer = t.payer.pubkey();
    let primary = t.world.wallet(9);
    t.world.register(&primary, AgentType::Primary);
    let unregistered = t.world.wallet(10);
    let inactive = t.world.wallet(11);
    t.world.register(&inactive, AgentType::Both);
    t.world.ok(
        "switch off",
        update_agent(&inactive.pubkey(), 1_000, 0, false),
        &[&inactive],
    );
    t.world
        .register(&t.payee.insecure_clone(), AgentType::Attestation);

    let cases: [(&Pubkey, u32); 4] = [
        (&t.payee.pubkey(), INVALID_JUDGE),
        (&primary.pubkey(), NOT_ATTESTATION_AGENT),
        (&inactive.pubkey(), JUDGE_NOT_ACTIVE),
        (&unregistered.pubkey(), NOT_INITIALIZED),
    ];
    for (i, (judge, code)) in cases.into_iter().enumerate() {
        let i = i as u8 + 1;
        t.world.ok("lock", t.lock_ix(i, false), &[&t.payer]);
        t.world.refused(
            "bad judge",
            open_delivery(&t.escrow(i), &payer, judge),
            &[&t.payer],
            code,
        );
        t.world.next_slot();
    }
    // The judge's agent record must be the judge's own.
    t.world.ok("lock", t.lock_ix(9, false), &[&t.payer]);
    let mut other_record = open_delivery(&t.escrow(9), &payer, &t.judge.pubkey());
    other_record.accounts[3].pubkey = agent(&primary.pubkey());
    t.world.refused(
        "someone else's record",
        other_record,
        &[&t.payer],
        CONSTRAINT_SEEDS,
    );
}

#[test]
fn rating_and_delivery_open_in_either_order_in_the_lock_slot() {
    // D2: both flags end up set whichever opens first.
    let mut t = Sol::new();
    let (payer, judge) = (t.payer.pubkey(), t.judge.pubkey());
    for (i, rating_first) in [(1u8, true), (2, false)] {
        let escrow = t.escrow(i);
        let rating = open_rating(&escrow, &payer, None);
        let delivery = open_delivery(&escrow, &payer, &judge);
        let ixs = if rating_first {
            [t.lock_ix(i, true), rating, delivery]
        } else {
            [t.lock_ix(i, true), delivery, rating]
        };
        t.world.send(&ixs, &[&t.payer]).unwrap();
        assert_eq!(
            t.world.data(&escrow)[SOL_ESCROW_FLAGS_AT],
            FLAG_METERED | FLAG_RATED | FLAG_DELIVERY
        );
        let created = sol_created(&t.world, &escrow);
        assert_eq!(
            t.world.rating(&rating_address(&escrow)).opened_slot,
            created
        );
        assert_eq!(read_delivery(&t.world, &escrow).opened_slot, created);

        // Settled through both accounts, in that order.
        t.record(&escrow, created);
        t.world.ok(
            "accept",
            answer("accept_delivery", &escrow, &payer, created),
            &[&t.payer],
        );
        let settle = with_delivery(
            with_rating(
                sol_payout(
                    &payer,
                    &t.payee.pubkey(),
                    nonce(i),
                    &t.payee.pubkey(),
                    Some(400_000),
                ),
                &escrow,
            ),
            &escrow,
        );
        t.world.ok("settle rated and checked", settle, &[&t.payee]);
        assert!(!t.world.exists(&escrow));
        assert!(!t.world.exists(&delivery_address(&escrow)));
        assert_eq!(t.world.rating(&rating_address(&escrow)).state, OPEN);
    }
}

// ── D1: every exit needs the right delivery account ─────────────────────────

#[test]
fn every_exit_of_a_checked_escrow_requires_its_own_delivery_account() {
    let mut t = Sol::new();
    let (escrow, created) = t.lock_checked(1, true);
    let (other, other_created) = t.lock_checked(2, true);
    t.record(&escrow, created);
    t.record(&other, other_created);
    t.world.ok(
        "accept",
        answer("accept_delivery", &escrow, &t.payer.pubkey(), created),
        &[&t.payer],
    );
    let wrong_owner = Pubkey::new_unique();
    t.world.set(
        wrong_owner,
        Account {
            lamports: 10_000_000,
            data: t.world.data(&delivery_address(&escrow)),
            owner: system_program::id(),
            ..Account::default()
        },
    );

    let bare = |_: &Sol, exit: Instruction| {
        let mut ix = exit;
        ix.accounts.pop();
        ix
    };
    let exits: Vec<(&str, Instruction, Keypair)> = vec![
        ("settle", t.settle(1, 400_000), t.payee.insecure_clone()),
        ("release", t.release(1, &t.payer), t.payer.insecure_clone()),
        ("decline", t.cancel(1, &t.payee), t.payee.insecure_clone()),
    ];
    for (label, exit, signer) in exits {
        t.world.refused(
            label,
            bare(&t, exit.clone()),
            &[&signer],
            DELIVERY_ACCOUNT_REQUIRED,
        );
        let at = exit.accounts.len() - 1;
        t.world.refused(
            label,
            swap(exit.clone(), at, delivery_address(&other)),
            &[&signer],
            INVALID_DELIVERY_ACCOUNT,
        );
        t.world.refused(
            label,
            swap(exit.clone(), at, wrong_owner),
            &[&signer],
            WRONG_OWNER,
        );
        t.world
            .refused(label, read_only(exit, at), &[&signer], CONSTRAINT_MUT);
    }
    // With the right account the accepted delivery settles.
    t.world.ok("settle", t.settle(1, 400_000), &[&t.payee]);
}

// ── Payouts wait for the delivery and the verify window ─────────────────────

#[test]
fn the_payee_is_paid_only_after_delivery_and_the_verify_window() {
    let mut t = Sol::new();
    let (escrow, created) = t.lock_checked(1, true);
    t.world.refused(
        "settle before delivery",
        t.settle(1, 400_000),
        &[&t.payee],
        DELIVERY_NOT_RECORDED,
    );
    t.record(&escrow, created);
    let delivered = read_delivery(&t.world, &escrow).delivered_slot;
    assert_eq!(delivered, t.world.slot());

    // D7: one slot before the end of the verify window, refused; at it, paid.
    t.world.warp(delivered + VERIFY - 1);
    t.world.refused(
        "settle in the verify window",
        t.settle(1, 400_000),
        &[&t.payee],
        VERIFY_WINDOW_OPEN,
    );
    t.world.warp(delivered + VERIFY);
    let (payer_before, payee_before) = (
        t.world.lamports(&t.payer.pubkey()),
        t.world.lamports(&t.payee.pubkey()),
    );
    let rents = t.world.lamports(&escrow) - AMOUNT + t.world.lamports(&delivery_address(&escrow));
    t.world.ok(
        "settle after the verify window",
        t.settle(1, 400_000),
        &[&t.payee],
    );
    assert_eq!(
        t.world.lamports(&t.payee.pubkey()),
        payee_before + 400_000 - 10_000 - 5_000
    );
    assert_eq!(
        t.world.lamports(&t.payer.pubkey()),
        payer_before + 600_000 + rents
    );
    assert!(!t.world.exists(&delivery_address(&escrow)));
}

#[test]
fn a_fixed_price_claim_needs_the_claim_window_and_the_delivery() {
    let mut t = Sol::new();
    let (escrow, created) = t.lock_checked(1, false);
    t.world.warp(created + CLAIM_WINDOW);
    // Claim window open, nothing delivered: the payee cannot take the money.
    t.world.refused(
        "claim without delivery",
        t.release(1, &t.payee),
        &[&t.payee],
        DELIVERY_NOT_RECORDED,
    );
    t.record(&escrow, created);
    t.world.refused(
        "claim in the verify window",
        t.release(1, &t.payee),
        &[&t.payee],
        VERIFY_WINDOW_OPEN,
    );
    t.world.warp(t.world.slot() + VERIFY);
    t.world.ok("claim", t.release(1, &t.payee), &[&t.payee]);

    // Accepted before the claim window: still waits for the claim window.
    let (escrow, created) = t.lock_checked(2, false);
    t.record(&escrow, created);
    t.world.ok(
        "accept",
        answer("accept_delivery", &escrow, &t.payer.pubkey(), created),
        &[&t.payer],
    );
    t.world.refused(
        "claim early",
        t.release(2, &t.payee),
        &[&t.payee],
        CLAIM_WINDOW_NOT_ELAPSED,
    );
    t.world.warp(created + CLAIM_WINDOW);
    t.world
        .ok("claim accepted", t.release(2, &t.payee), &[&t.payee]);
}

#[test]
fn the_payer_may_always_release_and_the_payee_always_decline() {
    let mut t = Sol::new();
    let (_, _) = t.lock_checked(1, false);
    t.world.ok(
        "release before delivery",
        t.release(1, &t.payer),
        &[&t.payer],
    );

    let (escrow, created) = t.lock_checked(2, true);
    t.record(&escrow, created);
    t.world.ok(
        "dispute",
        answer("dispute_delivery", &escrow, &t.payer.pubkey(), created),
        &[&t.payer],
    );
    t.world
        .ok("decline while disputed", t.cancel(2, &t.payee), &[&t.payee]);
    assert!(!t.world.exists(&delivery_address(&escrow)));
}

// ── record_delivery ─────────────────────────────────────────────────────────

#[test]
fn record_delivery_once_by_the_payee_before_the_refund_window() {
    let mut t = Sol::new();
    let escrow = t.escrow(1);
    let open = open_delivery(&escrow, &t.payer.pubkey(), &t.judge.pubkey());
    let created_at = t.world.slot();
    let payee = t.payee.pubkey();
    // In the lock slot.
    let record = record_delivery(&escrow, &payee, created_at, 30, 1);
    t.world
        .send(&[t.lock_ix(1, true), open], &[&t.payer])
        .unwrap();
    t.world.refused(
        "record in the lock slot",
        record,
        &[&t.payee],
        ESCROW_JUST_LOCKED,
    );
    t.world.next_slot();
    let created = sol_created(&t.world, &escrow);

    let stranger = t.stranger.insecure_clone();
    t.world.refused(
        "record by stranger",
        record_delivery(&escrow, &stranger.pubkey(), created, 30, 1),
        &[&stranger],
        UNAUTHORISED_SIGNER,
    );
    t.world.refused(
        "record by payer",
        record_delivery(&escrow, &t.payer.pubkey(), created, 30, 1),
        &[&t.payer],
        UNAUTHORISED_SIGNER,
    );
    for (units, bytes) in [(0, 1), (1, 0)] {
        t.world.refused(
            "empty delivery",
            record_delivery(&escrow, &payee, created, units, bytes),
            &[&t.payee],
            INVALID_DELIVERY,
        );
    }
    t.world.refused(
        "another job",
        record_delivery(&escrow, &payee, created + 1, 30, 1),
        &[&t.payee],
        DELIVERY_JOB_MISMATCH,
    );
    t.record(&escrow, created);
    let recorded = read_delivery(&t.world, &escrow);
    assert_eq!(
        (
            recorded.state,
            recorded.units,
            recorded.bytes,
            recorded.sha256
        ),
        (DELIVERED, 30, 37_500_000, SHA)
    );
    t.world.refused(
        "record twice",
        record_delivery(&escrow, &payee, created, 31, 1),
        &[&t.payee],
        DELIVERY_ALREADY_RECORDED,
    );
}

#[test]
fn a_late_delivery_is_refused_and_the_refund_works_as_usual() {
    // D4.
    let mut t = Sol::new();
    let (escrow, created) = t.lock_checked(1, true);
    t.world.warp(created + CANCEL_WINDOW - 1);
    let late = record_delivery(&escrow, &t.payee.pubkey(), created, 30, 1);
    t.world.next_slot();
    t.world.refused(
        "record at the refund window",
        late,
        &[&t.payee],
        DELIVERY_DEADLINE_PASSED,
    );
    t.world.ok("refund", t.cancel(1, &t.payer), &[&t.payer]);
    assert!(!t.world.exists(&delivery_address(&escrow)));

    // One slot earlier, the recording is taken.
    let (escrow, created) = t.lock_checked(2, true);
    t.world.warp(created + CANCEL_WINDOW - 1);
    t.record(&escrow, created);
}

// ── accept and dispute ──────────────────────────────────────────────────────

#[test]
fn accept_and_dispute_only_on_a_fresh_delivery() {
    // D9.
    let mut t = Sol::new();
    let payer = t.payer.pubkey();
    let (escrow, created) = t.lock_checked(1, true);
    for name in ["accept_delivery", "dispute_delivery"] {
        t.world.refused(
            "before delivery",
            answer(name, &escrow, &payer, created),
            &[&t.payer],
            DELIVERY_NOT_RECORDED,
        );
    }
    t.record(&escrow, created);
    t.world.refused(
        "accept by payee",
        answer("accept_delivery", &escrow, &t.payee.pubkey(), created),
        &[&t.payee],
        UNAUTHORISED_SIGNER,
    );
    t.world.refused(
        "another job",
        answer("accept_delivery", &escrow, &payer, created + 1),
        &[&t.payer],
        DELIVERY_JOB_MISMATCH,
    );
    t.world.ok(
        "accept",
        answer("accept_delivery", &escrow, &payer, created),
        &[&t.payer],
    );
    assert_eq!(read_delivery(&t.world, &escrow).state, ACCEPTED);
    for name in ["accept_delivery", "dispute_delivery"] {
        t.world.refused(
            "after accept",
            answer(name, &escrow, &payer, created),
            &[&t.payer],
            DELIVERY_ALREADY_ACCEPTED,
        );
    }
    // Accepted: paid at once, inside the verify window.
    t.world
        .ok("settle accepted", t.settle(1, AMOUNT), &[&t.payee]);

    let (escrow, created) = t.lock_checked(2, true);
    t.record(&escrow, created);
    t.world.ok(
        "dispute",
        answer("dispute_delivery", &escrow, &payer, created),
        &[&t.payer],
    );
    for name in ["accept_delivery", "dispute_delivery"] {
        t.world.refused(
            "after dispute",
            answer(name, &escrow, &payer, created),
            &[&t.payer],
            DELIVERY_DISPUTED,
        );
    }
}

#[test]
fn a_dispute_must_land_inside_the_verify_window() {
    // D7 at the verify boundary.
    let mut t = Sol::new();
    let payer = t.payer.pubkey();
    let (escrow, created) = t.lock_checked(1, true);
    t.record(&escrow, created);
    let delivered = t.world.slot();
    t.world.warp(delivered + VERIFY);
    t.world.refused(
        "dispute at the end",
        answer("dispute_delivery", &escrow, &payer, created),
        &[&t.payer],
        VERIFY_WINDOW_CLOSED,
    );

    let (escrow, created) = t.lock_checked(2, true);
    t.record(&escrow, created);
    let delivered = t.world.slot();
    t.world.warp(delivered + VERIFY - 1);
    t.world.ok(
        "dispute in the last slot",
        answer("dispute_delivery", &escrow, &payer, created),
        &[&t.payer],
    );
    let disputed = read_delivery(&t.world, &escrow);
    assert_eq!(
        (disputed.state, disputed.disputed_slot),
        (DISPUTED, delivered + VERIFY - 1)
    );
}

// ── Disputes and the judge ──────────────────────────────────────────────────

fn disputed(t: &mut Sol, i: u8, metered: bool) -> (Pubkey, u64, u64) {
    let (escrow, created) = t.lock_checked(i, metered);
    t.record(&escrow, created);
    t.world.ok(
        "dispute",
        answer("dispute_delivery", &escrow, &t.payer.pubkey(), created),
        &[&t.payer],
    );
    let at = t.world.slot();
    (escrow, created, at)
}

#[test]
fn a_disputed_escrow_is_held_for_the_judge() {
    let mut t = Sol::new();
    let (_, _, at) = disputed(&mut t, 1, true);
    t.world.warp(at + VERIFY + COLLECT + CANCEL_WINDOW);
    t.world.refused(
        "settle disputed",
        t.settle(1, AMOUNT),
        &[&t.payee],
        DELIVERY_DISPUTED,
    );
    t.world.refused(
        "claim disputed",
        t.release(1, &t.payee),
        &[&t.payee],
        DELIVERY_DISPUTED,
    );

    // Refund only once the judge's window has passed (D7 boundary), even
    // after the cancel window. A judge given longer than the cancel window.
    let resolve = 6_000;
    let mut t = Sol::new();
    let escrow = t.escrow(1);
    let open = open_delivery_with(
        &escrow,
        &t.payer.pubkey(),
        &t.judge.pubkey(),
        VERIFY,
        resolve,
    );
    t.world
        .send(&[t.lock_ix(1, true), open], &[&t.payer])
        .unwrap();
    let created = sol_created(&t.world, &escrow);
    t.world.next_slot();
    t.record(&escrow, created);
    t.world.ok(
        "dispute",
        answer("dispute_delivery", &escrow, &t.payer.pubkey(), created),
        &[&t.payer],
    );
    let at = t.world.slot();
    t.world.warp(created + CANCEL_WINDOW);
    assert!(at + resolve > created + CANCEL_WINDOW);
    t.world.refused(
        "refund after the cancel window",
        t.cancel(1, &t.payer),
        &[&t.payer],
        DELIVERY_REFUND_NOT_OPEN,
    );
    t.world.warp(at + resolve - 1);
    t.world.refused(
        "refund during the judge's window",
        t.cancel(1, &t.payer),
        &[&t.payer],
        DELIVERY_REFUND_NOT_OPEN,
    );
    let late = t.resolve(1, AMOUNT, created);
    t.world.warp(at + resolve);
    let judge = t.judge.insecure_clone();
    t.world.refused(
        "resolve after the window",
        late,
        &[&judge],
        RESOLVE_WINDOW_CLOSED,
    );
    t.world.ok(
        "refund after the judge's window",
        t.cancel(1, &t.payer),
        &[&t.payer],
    );
}

#[test]
fn the_judge_splits_the_escrow_with_the_fee_on_the_paid_part() {
    let mut t = Sol::new();
    let judge = t.judge.insecure_clone();
    let (escrow, created, at) = disputed(&mut t, 1, true);
    t.world.warp(at + RESOLVE - 1);

    let stranger = t.stranger.insecure_clone();
    let mut by_stranger = t.resolve(1, 600_000, created);
    by_stranger.accounts[5].pubkey = stranger.pubkey();
    t.world.refused(
        "resolve by stranger",
        by_stranger,
        &[&stranger],
        UNAUTHORISED_SIGNER,
    );
    t.world.refused(
        "resolve above the amount",
        t.resolve(1, AMOUNT + 1, created),
        &[&judge],
        INVALID_RESOLUTION,
    );
    t.world.refused(
        "resolve another job",
        t.resolve(1, 600_000, created + 1),
        &[&judge],
        ESCROW_INSTANCE_MISMATCH,
    );

    let payer_before = t.world.lamports(&t.payer.pubkey());
    let payee_before = t.world.lamports(&t.payee.pubkey());
    let treasury_before = t.world.lamports(&PROTOCOL_TREASURY);
    let rents = t.world.lamports(&escrow) - AMOUNT + delivery_rent(&t.world);
    let sent = t
        .world
        .ok("resolve 60%", t.resolve(1, 600_000, created), &[&judge]);
    let fee = 15_000;
    assert_eq!(
        t.world.lamports(&t.payee.pubkey()),
        payee_before + 600_000 - fee
    );
    assert_eq!(t.world.lamports(&PROTOCOL_TREASURY), treasury_before + fee);
    assert_eq!(
        t.world.lamports(&t.payer.pubkey()),
        payer_before + 400_000 + rents
    );
    assert!(!t.world.exists(&escrow));
    assert!(!t.world.exists(&delivery_address(&escrow)));
    assert_eq!(sent.events.len(), 2);

    // Payout 0: everything back, no fee.
    let (escrow, created, _) = disputed(&mut t, 2, false);
    let payer_before = t.world.lamports(&t.payer.pubkey());
    let treasury_before = t.world.lamports(&PROTOCOL_TREASURY);
    let held = t.world.lamports(&escrow) + delivery_rent(&t.world);
    t.world.ok("resolve 0", t.resolve(2, 0, created), &[&judge]);
    assert_eq!(t.world.lamports(&t.payer.pubkey()), payer_before + held);
    assert_eq!(t.world.lamports(&PROTOCOL_TREASURY), treasury_before);

    // Full payout: the same fee as a release.
    let (_, created, _) = disputed(&mut t, 3, false);
    let payee_before = t.world.lamports(&t.payee.pubkey());
    t.world
        .ok("resolve all", t.resolve(3, AMOUNT, created), &[&judge]);
    assert_eq!(
        t.world.lamports(&t.payee.pubkey()),
        payee_before + AMOUNT - FEE
    );
}

#[test]
fn only_a_disputed_delivery_can_be_resolved() {
    let mut t = Sol::new();
    let judge = t.judge.insecure_clone();
    let (escrow, created) = t.lock_checked(1, true);
    t.world.refused(
        "resolve awaiting",
        t.resolve(1, 0, created),
        &[&judge],
        DELIVERY_NOT_DISPUTED,
    );
    t.record(&escrow, created);
    t.world.refused(
        "resolve delivered",
        t.resolve(1, 0, created),
        &[&judge],
        DELIVERY_NOT_DISPUTED,
    );
    // An escrow that is not checked has no judge.
    t.world
        .ok("lock unchecked", t.lock_ix(2, true), &[&t.payer]);
    t.world.next_slot();
    let created = sol_created(&t.world, &t.escrow(2));
    t.world.refused(
        "resolve unchecked",
        t.resolve(2, 0, created),
        &[&judge],
        INVALID_DELIVERY_ACCOUNT,
    );
}

#[test]
fn the_judge_resolves_a_rated_escrow_like_a_payer_release() {
    let mut t = Sol::new();
    let judge = t.judge.insecure_clone();
    let (payer, payee) = (t.payer.pubkey(), t.payee.pubkey());
    for (i, accepted_rating) in [(1u8, false), (2, true)] {
        let escrow = t.escrow(i);
        t.world
            .send(
                &[
                    t.lock_ix(i, true),
                    open_rating(&escrow, &payer, None),
                    open_delivery(&escrow, &payer, &judge.pubkey()),
                ],
                &[&t.payer],
            )
            .unwrap();
        let created = sol_created(&t.world, &escrow);
        if accepted_rating {
            t.world.ok(
                "accept rating",
                accept_rating(&t.world, &rating_address(&escrow), &payee),
                &[&t.payee],
            );
        }
        t.record(&escrow, created);
        t.world.ok(
            "dispute",
            answer("dispute_delivery", &escrow, &payer, created),
            &[&t.payer],
        );
        t.world.ok(
            "resolve rated",
            sol_resolve(
                &payer,
                &payee,
                &escrow,
                &judge.pubkey(),
                500_000,
                created,
                true,
            ),
            &[&judge],
        );
        let rating = rating_address(&escrow);
        if accepted_rating {
            assert_eq!(t.world.rating(&rating).state, OPEN);
            assert_eq!(t.world.rating(&rating).paid, 500_000);
        } else {
            assert!(!t.world.exists(&rating));
        }
    }
}

// ── Refunds of a delivered escrow ───────────────────────────────────────────

#[test]
fn a_refund_after_an_undisputed_delivery_waits_for_the_payee_to_collect() {
    // D8: the refund always opens, and the payee always gets its day first.
    let mut t = Sol::new();
    let (escrow, created) = t.lock_checked(1, true);
    t.record(&escrow, created);
    let delivered = t.world.slot();
    t.world.warp(created + CANCEL_WINDOW);
    t.world.warp(delivered + VERIFY + COLLECT - 1);
    t.world.refused(
        "refund before the payee's day",
        t.cancel(1, &t.payer),
        &[&t.payer],
        DELIVERY_REFUND_NOT_OPEN,
    );
    t.world.warp(delivered + VERIFY + COLLECT);
    t.world.ok("refund", t.cancel(1, &t.payer), &[&t.payer]);

    // Nothing delivered: the cancel window alone.
    let (_, created) = t.lock_checked(2, true);
    t.world.warp(created + CANCEL_WINDOW - 1);
    t.world.refused(
        "refund early",
        t.cancel(2, &t.payer),
        &[&t.payer],
        CANCEL_WINDOW_NOT_ELAPSED,
    );
    t.world.warp(created + CANCEL_WINDOW);
    t.world
        .ok("refund undelivered", t.cancel(2, &t.payer), &[&t.payer]);
}

// ── Token escrow ────────────────────────────────────────────────────────────

#[test]
fn a_token_escrow_is_checked_and_resolved_the_same_way() {
    let mut world = World::new();
    let (payer, payee, judge) = (world.wallet(1), world.wallet(2), world.wallet(4));
    world.register(&judge, AgentType::Attestation);
    let t = Tokens::install(
        &mut world,
        anchor_spl::token::spl_token::ID,
        USDC_MAINNET_MINT,
        payer,
        payee,
    );
    let (a, b) = (t.payer.pubkey(), t.payee.pubkey());

    // 1: settle gated by the delivery, then paid.
    let escrow = t.escrow(nonce(1));
    world
        .send(
            &[
                t.lock(AMOUNT, nonce(1), true),
                open_delivery(&escrow, &a, &judge.pubkey()),
            ],
            &[&t.payer],
        )
        .unwrap();
    let created = token_created(&world, &escrow);
    world.next_slot();
    let settle = with_delivery(t.payout(nonce(1), &b, Some(400_000)), &escrow);
    world.refused(
        "token settle undelivered",
        settle.clone(),
        &[&t.payee],
        DELIVERY_NOT_RECORDED,
    );
    world.ok(
        "record",
        record_delivery(&escrow, &b, created, 30, 1),
        &[&t.payee],
    );
    world.refused(
        "token settle in window",
        settle.clone(),
        &[&t.payee],
        VERIFY_WINDOW_OPEN,
    );
    world.warp(world.slot() + VERIFY);
    world.ok("token settle", settle, &[&t.payee]);
    assert_eq!(t.balance(&world, &t.recipient), 400_000 - 10_000);
    assert!(!world.exists(&delivery_address(&escrow)));

    // 2: disputed and split by the judge, who has longer than the cancel
    // window.
    let escrow = t.escrow(nonce(2));
    world
        .send(
            &[
                t.lock(AMOUNT, nonce(2), true),
                open_delivery_with(&escrow, &a, &judge.pubkey(), VERIFY, 6_000),
            ],
            &[&t.payer],
        )
        .unwrap();
    let created = token_created(&world, &escrow);
    world.next_slot();
    world.ok(
        "record",
        record_delivery(&escrow, &b, created, 30, 1),
        &[&t.payee],
    );
    world.ok(
        "dispute",
        answer("dispute_delivery", &escrow, &a, created),
        &[&t.payer],
    );
    let refund_token = with_delivery(t.cancel(nonce(2), &a), &escrow);
    world.warp(created + CANCEL_WINDOW);
    world.refused(
        "token refund disputed",
        refund_token,
        &[&t.payer],
        DELIVERY_REFUND_NOT_OPEN,
    );
    let (recipient, treasury, source) = (
        t.balance(&world, &t.recipient),
        t.balance(&world, &t.treasury_token),
        t.balance(&world, &t.source),
    );
    world.ok(
        "token resolve",
        token_resolve(&t, nonce(2), &judge.pubkey(), 200_000, created),
        &[&judge],
    );
    assert_eq!(t.balance(&world, &t.recipient), recipient + 200_000 - 5_000);
    assert_eq!(t.balance(&world, &t.treasury_token), treasury + 5_000);
    assert_eq!(t.balance(&world, &t.source), source + 800_000);
    assert!(!world.exists(&escrow));
    assert!(!world.exists(&delivery_address(&escrow)));

    // The judge cannot send the payee's share elsewhere.
    let escrow = t.escrow(nonce(3));
    world
        .send(
            &[
                t.lock(AMOUNT, nonce(3), true),
                open_delivery(&escrow, &a, &judge.pubkey()),
            ],
            &[&t.payer],
        )
        .unwrap();
    let created = token_created(&world, &escrow);
    world.next_slot();
    world.ok(
        "record",
        record_delivery(&escrow, &b, created, 30, 1),
        &[&t.payee],
    );
    world.ok(
        "dispute",
        answer("dispute_delivery", &escrow, &a, created),
        &[&t.payer],
    );
    // Another token account the payee owns.
    let elsewhere = Pubkey::new_unique();
    world.set(
        elsewhere,
        Account {
            lamports: 10_000_000,
            data: world.data(&t.recipient),
            owner: t.program,
            ..Account::default()
        },
    );
    let redirected = swap(
        token_resolve(&t, nonce(3), &judge.pubkey(), 200_000, created),
        5,
        elsewhere,
    );
    world.refused("redirect", redirected, &[&judge], INVALID_TOKEN_ACCOUNT);

    world.report("delivery-checked token escrow");
}

#[test]
fn compute_units_of_the_largest_exits() {
    // D12: a rated, delivery-checked escrow's settle and the judge's resolve.
    let mut t = Sol::new();
    let (payer, payee, judge) = (t.payer.pubkey(), t.payee.pubkey(), t.judge.insecure_clone());
    let escrow = t.escrow(1);
    t.world
        .send(
            &[
                t.lock_ix(1, true),
                open_rating(&escrow, &payer, None),
                open_delivery(&escrow, &payer, &judge.pubkey()),
            ],
            &[&t.payer],
        )
        .unwrap();
    let created = sol_created(&t.world, &escrow);
    t.record(&escrow, created);
    t.world.ok(
        "dispute",
        answer("dispute_delivery", &escrow, &payer, created),
        &[&t.payer],
    );
    let sent = t.world.ok(
        "resolve rated SOL",
        sol_resolve(
            &payer,
            &payee,
            &escrow,
            &judge.pubkey(),
            500_000,
            created,
            true,
        ),
        &[&judge],
    );
    assert!(sent.compute_units < 200_000);
    t.world.report("delivery-checked SOL escrow");
}

#[test]
fn a_rated_checked_token_exit_takes_the_memo_program_as_its_twelfth_account() {
    // Nine accounts, the rating and delivery accounts, then the SPL Memo
    // program: the most a token exit carries. The payer switches on required
    // memos on its refund account after the lock.
    let mut world = World::new();
    let (payer, payee, judge) = (world.wallet(1), world.wallet(2), world.wallet(4));
    world.register(&judge, AgentType::Attestation);
    let t = Tokens::install(&mut world, TOKEN_2022_ID, PYUSD_MAINNET_MINT, payer, payee);
    let (a, b) = (t.payer.pubkey(), t.payee.pubkey());
    let escrow = t.escrow(nonce(1));
    world
        .send(
            &[
                t.lock(AMOUNT, nonce(1), true),
                open_rating(&escrow, &a, None),
                open_delivery(&escrow, &a, &judge.pubkey()),
            ],
            &[&t.payer],
        )
        .unwrap();
    let created = token_created(&world, &escrow);
    world.next_slot();
    world.ok(
        "record",
        record_delivery(&escrow, &b, created, 30, 1),
        &[&t.payee],
    );
    world.ok(
        "accept",
        answer("accept_delivery", &escrow, &a, created),
        &[&t.payer],
    );
    // MemoTransfer extension (type 8, length 1), require_incoming_memo on.
    let mut data = world.data(&t.source);
    data.extend_from_slice(&[8, 0, 1, 0, 1]);
    world.set(
        t.source,
        Account {
            lamports: world.lamports(&t.source),
            data,
            owner: TOKEN_2022_ID,
            ..Account::default()
        },
    );
    let settle = with_delivery(
        with_rating(t.payout(nonce(1), &b, Some(400_000)), &escrow),
        &escrow,
    );
    assert_eq!(settle.accounts.len(), 11);
    // Token-2022 NoMemo (0x24): without the memo program the refund leg fails.
    world.refused("settle without memo", settle.clone(), &[&t.payee], 36);
    let memo: Pubkey = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        .parse()
        .unwrap();
    let settle = with_account(settle, memo, false);
    assert_eq!(settle.accounts.len(), 12);
    world.ok("rated checked PYUSD settle with memo", settle, &[&t.payee]);
    assert_eq!(t.balance(&world, &t.recipient), 400_000 - 10_000);
    assert!(!world.exists(&escrow));
    assert!(!world.exists(&delivery_address(&escrow)));
    world.report("rated, delivery-checked PYUSD escrow");
}

#[test]
fn an_accepted_fixed_price_delivery_gives_the_payee_a_day_after_its_claim_opens() {
    // Claim window = cancel window, both longer than the verify window plus a day: the payer's
    // refund must not open in the slot the payee's claim first does (audit S1-claude2-01).
    const W: u64 = 300_000;
    let mut w = World::new();
    let (payer, payee, judge) = (w.wallet(1), w.wallet(2), w.wallet(4));
    w.register(&judge, AgentType::Attestation);
    let (a, b, j) = (payer.pubkey(), payee.pubkey(), judge.pubkey());
    for (i, payee_claims) in [(1u8, true), (2u8, false)] {
        let e = sol_escrow(&a, nonce(i));
        let mut lock = sol_lock(&a, &b, AMOUNT, nonce(i), false);
        lock.data[32..40].copy_from_slice(&W.to_le_bytes());
        lock.data[40..48].copy_from_slice(&W.to_le_bytes());
        w.send(&[lock, open_delivery(&e, &a, &j)], &[&payer])
            .unwrap();
        let c = sol_created(&w, &e);
        w.next_slot();
        w.ok("record", record_delivery(&e, &b, c, 1, 1), &[&payee]);
        w.ok("accept", answer("accept_delivery", &e, &a, c), &[&payer]);
        let claim = with_delivery(sol_payout(&a, &b, nonce(i), &b, None), &e);
        let refund = with_delivery(sol_cancel(&a, nonce(i), &a), &e);
        w.warp(c + W - 1);
        w.refused(
            "claim before its window",
            claim.clone(),
            &[&payee],
            CLAIM_WINDOW_NOT_ELAPSED,
        );
        w.warp(c + W);
        w.refused(
            "refund as the claim opens",
            refund.clone(),
            &[&payer],
            DELIVERY_REFUND_NOT_OPEN,
        );
        if payee_claims {
            w.ok("payee claims", claim, &[&payee]);
        } else {
            w.warp(c + W + COLLECT - 1);
            w.refused(
                "refund inside the collect day",
                refund.clone(),
                &[&payer],
                DELIVERY_REFUND_NOT_OPEN,
            );
            w.warp(c + W + COLLECT);
            w.ok("refund after the collect day", refund, &[&payer]);
        }
    }
}
