//! Pooled budgets whose spender is a P-256 key (`BUDGET_FLAG_P256_SPENDER`,
//! 0x08): the spender never signs a transaction. It signs an approval that
//! names the budget, its instance, the action, its target, payout account,
//! amount and an expiry slot, and the secp256r1 precompile instruction just
//! before the call carries it. The spender account of `reserve`, and the
//! authority of `waive` and the closes, is then the Instructions sysvar.
//! Runs against the built Pinocchio binary.
mod support;

use {
    anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction},
    escrow::state::AgentType,
    solana_keypair::Keypair,
    solana_signer::Signer,
    support::{budget::*, *},
};

const OPEN_SLOTS: u64 = 9_000;
const DISPUTE_SLOTS: u64 = 9_000;
const JUDGE_SLOTS: u64 = 1_500;
const TOTAL: u64 = 100_000_000;

const UNAUTHORISED_SIGNER: u32 = 6000;
const RESERVATION_TOO_SMALL: u32 = 6083;
const APPROVAL_MISSING: u32 = 6098;
const APPROVAL_EXPIRED: u32 = 6099;
const APPROVAL_MISMATCH: u32 = 6100;

const FLAG_SPENDER_WAIVES: u8 = 0x01;
const FLAG_CLOSED: u8 = 0x02;
const FLAG_REVIEW_FROM_OPEN_END: u8 = 0x04;
const FLAG_P256: u8 = 0x08;

/// How far ahead the relay sets an approval's expiry.
const VALID_FOR: u64 = 150;

// ── Fixture ─────────────────────────────────────────────────────────────────

struct Fixture {
    world: World,
    payer: Keypair,
    spender: P256,
    judge: Keypair,
    a: Keypair,
    b: Keypair,
    relay: Keypair,
}

impl Fixture {
    fn new() -> Self {
        let mut world = World::new();
        let payer = world.wallet(1);
        let a = world.wallet(2);
        let relay = world.wallet(3);
        let judge = world.wallet(4);
        let b = world.wallet(6);
        world.register(&a, AgentType::Primary);
        world.register(&b, AgentType::Primary);
        world.register(&judge, AgentType::Attestation);
        Self {
            world,
            payer,
            spender: P256::new(7),
            judge,
            a,
            b,
            relay,
        }
    }

    /// A judge, no allowlist, a P-256 spender.
    fn terms(&self, i: u8) -> Terms {
        Terms {
            nonce: nonce(i),
            spender: self.spender.spender(),
            judge: self.judge.pubkey(),
            open: OPEN_SLOTS,
            dispute: DISPUTE_SLOTS,
            judge_slots: JUDGE_SLOTS,
            total: TOTAL,
            cap: 0,
            flags: FLAG_P256,
            allowlist: [ZERO; 4],
        }
    }

    fn open(&mut self, terms: &Terms) -> (Pubkey, u64) {
        let payer = self.payer.insecure_clone();
        self.world
            .ok("open_budget", terms.open_ix(&payer.pubkey()), &[&payer]);
        let budget = budget_address(&payer.pubkey(), terms.nonce);
        let created = read_budget(&self.world, &budget).created;
        self.world.next_slot();
        (budget, created)
    }

    fn expires(&self) -> u64 {
        self.world.slot() + VALID_FOR
    }

    fn reserve_approval(
        &self,
        budget: &Pubkey,
        created: u64,
        payee: &Pubkey,
        amount: u64,
    ) -> Approval {
        Approval {
            budget: *budget,
            created,
            action: RESERVE,
            target: *payee,
            payout_account: *payee,
            amount,
            expires: self.expires(),
        }
    }

    fn reserve_ix(&self, approval: &Approval) -> Instruction {
        by_approval(
            reserve_ix(
                &approval.budget,
                approval.created,
                &ZERO,
                &approval.target,
                &approval.payout_account,
                approval.amount,
            ),
            2,
            approval.expires,
        )
    }

    fn signed(&self, approval: &Approval) -> Instruction {
        let message = approval.message();
        precompile_ix(
            &self.spender.public(),
            &self.spender.sign(&message),
            &message,
            u16::MAX,
        )
    }

    /// The precompile instruction for `approval`, then `ix`. The payee (for
    /// a reserve) or the relay pays the fee.
    fn send(
        &mut self,
        approval: &Approval,
        ix: Instruction,
        signers: &[&Keypair],
    ) -> Result<Sent, String> {
        let pre = self.signed(approval);
        self.world.send(&[pre, ix], signers)
    }

    fn reserve(&mut self, budget: &Pubkey, created: u64, payee: &Keypair, amount: u64) {
        let approval = self.reserve_approval(budget, created, &payee.pubkey(), amount);
        let ix = self.reserve_ix(&approval);
        self.send(&approval, ix, &[payee])
            .unwrap_or_else(|error| panic!("reserve by approval: {error}"));
    }
}

/// `result` must be refused with `Custom(code)`.
fn refused(label: &str, result: Result<Sent, String>, code: u32) {
    match result {
        Ok(_) => panic!("{label}: expected Custom({code}), but the call succeeded"),
        Err(error) => assert!(
            error.contains(&format!("Custom({code})")),
            "{label}: expected Custom({code}), got {error}"
        ),
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn a_p256_spender_reserves_waives_and_closes_by_approval() {
    let mut t = Fixture::new();
    let (a, b) = (t.a.pubkey(), t.b.pubkey());
    let a_kp = t.a.insecure_clone();
    let relay = t.relay.insecure_clone();
    let terms = Terms {
        judge: ZERO,
        allowlist: [a, b, ZERO, ZERO],
        flags: FLAG_P256 | FLAG_SPENDER_WAIVES,
        ..t.terms(1)
    };
    let (budget, created) = t.open(&terms);
    assert_eq!(
        read_budget(&t.world, &budget).flags,
        FLAG_P256 | FLAG_SPENDER_WAIVES
    );

    t.reserve(&budget, created, &a_kp, 10_000_000);
    let slice = read_reservation(&t.world, &reservation_address(&budget, &a));
    assert_eq!(slice.reserved, 10_000_000);
    // A raise is a new approval for the new total.
    t.reserve(&budget, created, &a_kp, 20_000_000);
    assert_eq!(
        read_reservation(&t.world, &reservation_address(&budget, &a)).reserved,
        20_000_000
    );

    t.world.ok(
        "post_final",
        post_ix(&budget, created, &a, 15_000_000),
        &[&a_kp],
    );
    let reservation = reservation_address(&budget, &a);
    let waive = Approval {
        budget,
        created,
        action: WAIVE,
        target: reservation,
        payout_account: ZERO,
        amount: 0,
        expires: t.expires(),
    };
    let ix = by_approval(
        hold_ix("waive", &budget, created, &a, &ZERO),
        2,
        waive.expires,
    );
    t.send(&waive, ix, &[&relay]).expect("waive by approval");
    assert_eq!(read_reservation(&t.world, &reservation).waived, 1);

    let close = Approval {
        budget,
        created,
        action: CLOSE,
        target: ZERO,
        payout_account: ZERO,
        amount: 0,
        expires: t.expires(),
    };
    let payer = t.payer.pubkey();
    let before = t.world.lamports(&payer);
    let ix = by_approval(close_ix(&budget, created, &ZERO, &payer), 1, close.expires);
    t.send(&close, ix, &[&relay]).expect("close by approval");
    let view = read_budget(&t.world, &budget);
    assert_eq!(view.flags & FLAG_CLOSED, FLAG_CLOSED);
    assert_eq!(
        view.flags & FLAG_REVIEW_FROM_OPEN_END,
        0,
        "with an allowlist the review starts at close"
    );
    assert_eq!(t.world.lamports(&payer), before + TOTAL - 20_000_000);
}

#[test]
fn a_close_by_approval_counts_as_not_the_payer() {
    let mut t = Fixture::new();
    let relay = t.relay.insecure_clone();
    let a_kp = t.a.insecure_clone();
    let (budget, created) = t.open(&t.terms(1));
    // Something reserved, so the budget stays after the close.
    t.reserve(&budget, created, &a_kp, 10_000_000);
    let close = Approval {
        budget,
        created,
        action: CLOSE,
        target: ZERO,
        payout_account: ZERO,
        amount: 0,
        expires: t.expires(),
    };
    let payer = t.payer.pubkey();
    let ix = by_approval(close_ix(&budget, created, &ZERO, &payer), 1, close.expires);
    t.send(&close, ix, &[&relay]).expect("close by approval");
    let view = read_budget(&t.world, &budget);
    assert_eq!(
        view.flags & FLAG_REVIEW_FROM_OPEN_END,
        FLAG_REVIEW_FROM_OPEN_END,
        "no allowlist: the spender's early close cannot start the review clock (B1)"
    );
}

#[test]
fn an_approval_must_match_the_call_exactly() {
    let mut t = Fixture::new();
    let (a, b) = (t.a.pubkey(), t.b.pubkey());
    let a_kp = t.a.insecure_clone();
    let b_kp = t.b.insecure_clone();
    let (budget, created) = t.open(&t.terms(1));
    let (other, other_created) = t.open(&t.terms(2));

    let good = t.reserve_approval(&budget, created, &a, 10_000_000);
    let cases: Vec<(&str, Approval, Instruction, Keypair)> = vec![
        (
            "another amount",
            Approval {
                amount: 10_000_001,
                ..t.reserve_approval(&budget, created, &a, 10_000_000)
            },
            t.reserve_ix(&good),
            a_kp.insecure_clone(),
        ),
        (
            "another payee",
            t.reserve_approval(&budget, created, &b, 10_000_000),
            t.reserve_ix(&good),
            a_kp.insecure_clone(),
        ),
        (
            "another payout account",
            Approval {
                payout_account: b,
                ..t.reserve_approval(&budget, created, &a, 10_000_000)
            },
            t.reserve_ix(&good),
            a_kp.insecure_clone(),
        ),
        (
            "another budget",
            t.reserve_approval(&other, other_created, &a, 10_000_000),
            t.reserve_ix(&good),
            a_kp.insecure_clone(),
        ),
        (
            "another instance",
            Approval {
                created: created + 1,
                ..t.reserve_approval(&budget, created, &a, 10_000_000)
            },
            t.reserve_ix(&good),
            a_kp.insecure_clone(),
        ),
        (
            "another action",
            Approval {
                action: CLOSE,
                ..t.reserve_approval(&budget, created, &a, 10_000_000)
            },
            t.reserve_ix(&good),
            a_kp.insecure_clone(),
        ),
        (
            "another expiry than the call names",
            Approval {
                expires: good.expires + 1,
                ..t.reserve_approval(&budget, created, &a, 10_000_000)
            },
            t.reserve_ix(&good),
            a_kp.insecure_clone(),
        ),
    ];
    for (label, approval, ix, payee) in cases {
        refused(label, t.send(&approval, ix, &[&payee]), APPROVAL_MISMATCH);
    }

    // B's own call with A's approval.
    let b_call = t.reserve_ix(&t.reserve_approval(&budget, created, &b, 10_000_000));
    refused(
        "an approval for A used by B",
        t.send(&good, b_call, &[&b_kp]),
        APPROVAL_MISMATCH,
    );

    // Signed by another P-256 key, valid in itself.
    let stranger = P256::new(9);
    let message = good.message();
    let forged = precompile_ix(
        &stranger.public(),
        &stranger.sign(&message),
        &message,
        u16::MAX,
    );
    refused(
        "another key",
        t.world.send(&[forged, t.reserve_ix(&good)], &[&a_kp]),
        APPROVAL_MISMATCH,
    );

    // A cluster byte for another build.
    let mut devnet = good.message();
    devnet[21] ^= 1;
    let pre = precompile_ix(
        &t.spender.public(),
        &t.spender.sign(&devnet),
        &devnet,
        u16::MAX,
    );
    refused(
        "another cluster",
        t.world.send(&[pre, t.reserve_ix(&good)], &[&a_kp]),
        APPROVAL_MISMATCH,
    );

    // Nothing above went through.
    assert!(!t.world.exists(&reservation_address(&budget, &a)));
    t.reserve(&budget, created, &a_kp, 10_000_000);
}

#[test]
fn an_approval_expires_and_cannot_be_used_twice() {
    let mut t = Fixture::new();
    let a = t.a.pubkey();
    let a_kp = t.a.insecure_clone();
    let (budget, created) = t.open(&t.terms(1));

    let approval = t.reserve_approval(&budget, created, &a, 10_000_000);
    let ix = t.reserve_ix(&approval);
    t.send(&approval, ix.clone(), &[&a_kp]).expect("first use");
    refused(
        "the same approval again",
        t.send(&approval, ix, &[&a_kp]),
        RESERVATION_TOO_SMALL,
    );

    let late = t.reserve_approval(&budget, created, &a, 20_000_000);
    let ix = t.reserve_ix(&late);
    let at = t.world.slot();
    t.world.warp(late.expires);
    t.send(&late, ix.clone(), &[&a_kp])
        .expect("usable in its last slot");
    assert!(late.expires > at);

    let stale = Approval {
        expires: t.world.slot() - 1,
        ..t.reserve_approval(&budget, created, &a, 30_000_000)
    };
    let ix = t.reserve_ix(&stale);
    refused("expired", t.send(&stale, ix, &[&a_kp]), APPROVAL_EXPIRED);
}

#[test]
fn the_approval_must_come_just_before_in_its_own_instruction() {
    let mut t = Fixture::new();
    let a = t.a.pubkey();
    let a_kp = t.a.insecure_clone();
    let (budget, created) = t.open(&t.terms(1));
    let approval = t.reserve_approval(&budget, created, &a, 10_000_000);
    let call = t.reserve_ix(&approval);

    refused(
        "no approval",
        t.world.send(std::slice::from_ref(&call), &[&a_kp]),
        APPROVAL_MISSING,
    );

    let spacer = anchor_lang::solana_program::system_instruction::transfer(&a, &a, 0);
    refused(
        "another instruction in between",
        t.world
            .send(&[t.signed(&approval), spacer, call.clone()], &[&a_kp]),
        APPROVAL_MISSING,
    );

    let mut no_expiry = call.clone();
    no_expiry.data.truncate(no_expiry.data.len() - 8);
    refused(
        "a call without an expiry",
        t.world.send(&[t.signed(&approval), no_expiry], &[&a_kp]),
        APPROVAL_MISSING,
    );

    // The precompile accepts data named by absolute instruction index; the
    // program does not.
    let message = approval.message();
    let by_index = precompile_ix(&t.spender.public(), &t.spender.sign(&message), &message, 0);
    refused(
        "data named by index",
        t.world.send(&[by_index, call.clone()], &[&a_kp]),
        APPROVAL_MISMATCH,
    );

    // Two signatures in one precompile instruction, both valid.
    let mut two = t.signed(&approval);
    let one_len = two.data.len();
    two.data[0] = 2;
    let second: Vec<u8> = two.data[2..16].to_vec();
    two.data.splice(16..16, second);
    // Every offset moves by the new 14-byte record.
    for record in [2usize, 16] {
        for field in [0usize, 4, 8] {
            let at = record + field;
            let value = u16::from_le_bytes([two.data[at], two.data[at + 1]]) + 14;
            two.data[at..at + 2].copy_from_slice(&value.to_le_bytes());
        }
    }
    assert_eq!(two.data.len(), one_len + 14);
    refused(
        "two signatures",
        t.world.send(&[two, call.clone()], &[&a_kp]),
        APPROVAL_MISMATCH,
    );

    // A high-S signature never gets past the precompile.
    let high = precompile_ix(
        &t.spender.public(),
        &t.spender.sign_high_s(&message),
        &message,
        u16::MAX,
    );
    assert!(t.world.send(&[high, call.clone()], &[&a_kp]).is_err());

    t.world
        .send(&[t.signed(&approval), call], &[&a_kp])
        .expect("the approval in place");
}

#[test]
fn the_flag_decides_who_the_spender_is() {
    let mut t = Fixture::new();
    let a = t.a.pubkey();
    let a_kp = t.a.insecure_clone();
    let ed = t.world.wallet(8);

    // Without the flag, an approval is never the spender, even one whose
    // key hashes to the spender field.
    let plain = Terms {
        flags: 0,
        ..t.terms(1)
    };
    let (budget, created) = t.open(&plain);
    let approval = t.reserve_approval(&budget, created, &a, 10_000_000);
    let ix = t.reserve_ix(&approval);
    refused(
        "an approval on a budget without the flag",
        t.send(&approval, ix, &[&a_kp]),
        UNAUTHORISED_SIGNER,
    );

    // With the flag, an ordinary signer is never the spender.
    let flagged = Terms {
        spender: ed.pubkey(),
        ..t.terms(2)
    };
    let (budget, created) = t.open(&flagged);
    let ix = reserve_ix(&budget, created, &ed.pubkey(), &a, &a, 10_000_000);
    t.world.refused(
        "a signer on a P-256 budget",
        ix,
        &[&a_kp, &ed],
        UNAUTHORISED_SIGNER,
    );

    // The payer still closes a P-256 budget by signing, and it counts as the
    // payer's close.
    let (budget, created) = t.open(&t.terms(3));
    t.reserve(&budget, created, &a_kp, 10_000_000);
    let payer = t.payer.insecure_clone();
    t.world.ok(
        "payer closes",
        close_ix(&budget, created, &payer.pubkey(), &payer.pubkey()),
        &[&payer],
    );
    assert_eq!(
        read_budget(&t.world, &budget).flags & FLAG_REVIEW_FROM_OPEN_END,
        0
    );

    // Unknown flag bits are still refused.
    let bad = Terms {
        flags: FLAG_P256 | 0x10,
        ..t.terms(4)
    };
    t.world.refused(
        "unknown flag",
        bad.open_ix(&t.payer.pubkey()),
        &[&t.payer.insecure_clone()],
        6073,
    );
}

#[test]
fn a_token_budget_closes_by_approval() {
    let mut f = TokenWorld::new();
    let terms = Terms {
        total: 10_000_000,
        ..f.t.terms(1)
    };
    let budget = f.open(&terms);
    let created = read_budget(&f.t.world, &budget).created;
    let close = Approval {
        budget,
        created,
        action: CLOSE,
        target: ZERO,
        payout_account: ZERO,
        amount: 0,
        expires: f.t.expires(),
    };
    let ix = by_approval(
        token_close_ix(&f.tokens, &budget, created, &ZERO),
        2,
        close.expires,
    );
    let relay = f.t.relay.insecure_clone();
    let before = f.balance();
    f.t.send(&close, ix, &[&relay])
        .expect("token close by approval");
    assert!(
        !f.t.world.exists(&budget),
        "nothing reserved: it closes outright"
    );
    assert_eq!(f.balance(), before + 10_000_000);
}

// ── Token fixture ───────────────────────────────────────────────────────────

struct TokenWorld {
    t: Fixture,
    tokens: Tokens,
}

impl TokenWorld {
    fn new() -> Self {
        let mut t = Fixture::new();
        let tokens = Tokens::install(
            &mut t.world,
            anchor_spl::token::spl_token::id(),
            escrow::USDC_MAINNET_MINT,
            t.payer.insecure_clone(),
            t.a.insecure_clone(),
        );
        Self { t, tokens }
    }

    fn open(&mut self, terms: &Terms) -> Pubkey {
        let payer = self.t.payer.insecure_clone();
        self.t.world.ok(
            "open_token_budget",
            terms.open_token_ix(&self.tokens),
            &[&payer],
        );
        self.t.world.next_slot();
        budget_address(&payer.pubkey(), terms.nonce)
    }

    fn balance(&self) -> u64 {
        self.tokens.balance(&self.t.world, &self.tokens.source)
    }
}
