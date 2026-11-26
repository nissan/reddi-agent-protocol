//! Emergency pause: `init_pause`, `pause`, `unpause`, `set_guardian`, and
//! what a pause does to every other instruction. Runs against the built
//! Pinocchio binary (mainnet build: the admin is the Squads vault, the
//! treasury key).
//!
//! The rule under test: while paused, nothing new comes in and no provider is
//! paid, and every refund still goes ahead. Lamport conservation is asserted
//! on every transaction by the harness.
mod support;

use {
    anchor_lang::prelude::{AccountMeta, Pubkey},
    anchor_lang::solana_program::{instruction::Instruction, system_program},
    escrow::{state::AgentType, PROTOCOL_TREASURY, USDC_MAINNET_MINT},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    support::{budget::*, instance::*, *},
};

const ADMIN: Pubkey = PROTOCOL_TREASURY;
/// About 7 days of slots: `PAUSE_SLOTS`.
const PAUSE_SLOTS: u64 = 1_512_000;

const PROTOCOL_PAUSED: u32 = 6101;
const PAUSE_ACCOUNT_REQUIRED: u32 = 6102;
const NOT_PAUSE_AUTHORITY: u32 = 6103;
const ALREADY_PAUSED: u32 = 6104;
const INVALID_GUARDIAN: u32 = 6105;

const OPEN_SLOTS: u64 = 9_000;
const DISPUTE_SLOTS: u64 = 9_000;
const JUDGE_SLOTS: u64 = 1_500;
const TOTAL: u64 = 100_000_000;

// ── Builders ────────────────────────────────────────────────────────────────

fn raw_ix(name: &str, args: &[u8], accounts: Vec<AccountMeta>) -> Instruction {
    let mut data = selector(name).to_vec();
    data.extend_from_slice(args);
    Instruction {
        program_id: escrow::id(),
        accounts,
        data,
    }
}

fn init_pause_ix(admin: &Pubkey, payer: &Pubkey, guardian: &Pubkey) -> Instruction {
    raw_ix(
        "init_pause",
        &guardian.to_bytes(),
        vec![
            AccountMeta::new(PAUSE_ADDRESS, false),
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
    )
}

fn by(name: &str, signer: &Pubkey, args: &[u8]) -> Instruction {
    raw_ix(
        name,
        args,
        vec![
            AccountMeta::new(PAUSE_ADDRESS, false),
            AccountMeta::new_readonly(*signer, true),
        ],
    )
}

struct PauseView {
    guardian: Pubkey,
    paused_until: u64,
    paused_at: u64,
    last_by: Pubkey,
}

fn read_pause(world: &World) -> PauseView {
    let data = world.data(&PAUSE_ADDRESS);
    assert_eq!(data.len(), 89, "the pause account holds 89 bytes");
    assert_eq!(data[..8], account_discriminator("PauseState"));
    PauseView {
        guardian: Pubkey::new_from_array(data[8..40].try_into().unwrap()),
        paused_until: u64_at(&data, 40),
        paused_at: u64_at(&data, 48),
        last_by: Pubkey::new_from_array(data[56..88].try_into().unwrap()),
    }
}

/// Send `ixs` with `fee_payer` signing and `as_keys` marked as signers
/// without a signature (the world does not verify signatures): how a test
/// acts as the Squads vault. Returns the error text on failure.
fn send_as(
    world: &mut World,
    ixs: &[Instruction],
    fee_payer: &Keypair,
    as_keys: &[Pubkey],
) -> Result<(), String> {
    assert!(
        !world.svm.get_sigverify(),
        "send_as needs World::without_sigverify"
    );
    world.svm.expire_blockhash();
    let msg = Message::new_with_blockhash(
        ixs,
        Some(&fee_payer.pubkey()),
        &world.svm.latest_blockhash(),
    );
    let signer_count = msg.header.num_required_signatures as usize;
    for key in as_keys {
        assert!(
            msg.account_keys[..signer_count].contains(key),
            "{key} must be a signer of the message"
        );
    }
    let tx = VersionedTransaction {
        signatures: vec![Default::default(); signer_count],
        message: VersionedMessage::Legacy(msg),
    };
    world
        .svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|failed| format!("{:?}", failed.err))
}

fn admin_ok(world: &mut World, label: &str, ix: Instruction, fee_payer: &Keypair) {
    send_as(world, &[ix], fee_payer, &[ADMIN]).unwrap_or_else(|e| panic!("{label}: {e}"));
}

fn admin_refused(world: &mut World, label: &str, ix: Instruction, fee_payer: &Keypair, code: u32) {
    let error = send_as(world, &[ix], fee_payer, &[ADMIN])
        .err()
        .unwrap_or_else(|| panic!("{label}: expected Custom({code}), but it succeeded"));
    assert!(
        error.contains(&format!("Custom({code})")),
        "{label}: expected Custom({code}), got {error}"
    );
}

/// Put the pause account directly in the paused state until `until`.
fn set_paused(world: &mut World, until: u64) {
    let data = pause_state(&TEST_GUARDIAN, until);
    let lamports = world.svm.minimum_balance_for_rent_exemption(data.len());
    world.set(
        PAUSE_ADDRESS,
        Account {
            lamports,
            data,
            owner: escrow::id(),
            ..Account::default()
        },
    );
}

// ── Fixture ─────────────────────────────────────────────────────────────────

struct Fixture {
    world: World,
    guardian: Keypair,
    payer: Keypair,
    payee: Keypair,
    judge: Keypair,
    spender: Keypair,
    stranger: Keypair,
}

impl Fixture {
    /// The pause account created by the admin, naming `guardian`, not paused.
    fn new() -> Self {
        let mut world = World::without_sigverify();
        let guardian = world.wallet(40);
        let payer = world.wallet(1);
        let payee = world.wallet(2);
        let stranger = world.wallet(3);
        let judge = world.wallet(4);
        let spender = world.wallet(5);
        world.register(&payee, AgentType::Primary);
        world.register(&judge, AgentType::Attestation);
        let fee_payer = stranger.insecure_clone();
        admin_ok(
            &mut world,
            "init_pause",
            init_pause_ix(&ADMIN, &ADMIN, &guardian.pubkey()),
            &fee_payer,
        );
        Self {
            world,
            guardian,
            payer,
            payee,
            judge,
            spender,
            stranger,
        }
    }

    fn pause(&mut self) {
        let guardian = self.guardian.insecure_clone();
        self.world
            .ok("pause", by("pause", &guardian.pubkey(), &[]), &[&guardian]);
    }

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

    /// Open a SOL budget, reserve `reserved` for the payee, and move on.
    fn budget(&mut self, i: u8, reserved: u64) -> (Pubkey, u64) {
        let payer = self.payer.insecure_clone();
        let terms = self.terms(i);
        self.world
            .ok("open_budget", terms.open_ix(&payer.pubkey()), &[&payer]);
        let budget = budget_address(&payer.pubkey(), terms.nonce);
        let created = read_budget(&self.world, &budget).created;
        self.world.next_slot();
        let (payee, spender) = (self.payee.insecure_clone(), self.spender.insecure_clone());
        self.world.ok(
            "reserve",
            reserve_ix(
                &budget,
                created,
                &spender.pubkey(),
                &payee.pubkey(),
                &payee.pubkey(),
                reserved,
            ),
            &[&payee, &spender],
        );
        (budget, created)
    }

    fn post(&mut self, budget: &Pubkey, created: u64, amount: u64) {
        let payee = self.payee.insecure_clone();
        self.world.ok(
            "post_final",
            post_ix(budget, created, &payee.pubkey(), amount),
            &[&payee],
        );
    }
}

// ── The pause account ───────────────────────────────────────────────────────

#[test]
fn the_pause_account_is_at_its_address() {
    assert_eq!(
        Pubkey::find_program_address(&[b"pause"], &escrow::id()),
        (PAUSE_ADDRESS, 255),
        "PAUSE_ADDRESS and PAUSE_BUMP in consts.rs"
    );
}

#[test]
fn only_the_admin_creates_the_pause_account_once() {
    let mut world = World::without_sigverify();
    let guardian = world.wallet(40);
    let stranger = world.wallet(3);
    let fee_payer = stranger.insecure_clone();

    // A stranger signing as admin is refused.
    world.refused(
        "init by a stranger",
        init_pause_ix(&stranger.pubkey(), &stranger.pubkey(), &guardian.pubkey()),
        &[&stranger],
        NOT_PAUSE_AUTHORITY,
    );
    // The guardian must be a real key and not the admin itself.
    admin_refused(
        &mut world,
        "zero guardian",
        init_pause_ix(&ADMIN, &ADMIN, &Pubkey::default()),
        &fee_payer,
        INVALID_GUARDIAN,
    );
    admin_refused(
        &mut world,
        "admin as guardian",
        init_pause_ix(&ADMIN, &ADMIN, &ADMIN),
        &fee_payer,
        INVALID_GUARDIAN,
    );
    // Only at its address.
    let mut elsewhere = init_pause_ix(&ADMIN, &ADMIN, &guardian.pubkey());
    elsewhere.accounts[0].pubkey = Pubkey::new_unique();
    admin_refused(
        &mut world,
        "init elsewhere",
        elsewhere,
        &fee_payer,
        CONSTRAINT_SEEDS,
    );

    // The admin creates it, paying the rent from the vault, not paused.
    let admin_before = world.lamports(&ADMIN);
    admin_ok(
        &mut world,
        "init_pause",
        init_pause_ix(&ADMIN, &ADMIN, &guardian.pubkey()),
        &fee_payer,
    );
    let rent = world.svm.minimum_balance_for_rent_exemption(89);
    assert_eq!(world.lamports(&ADMIN), admin_before - rent);
    assert_eq!(world.lamports(&PAUSE_ADDRESS), rent);
    let view = read_pause(&world);
    assert_eq!(
        (
            view.guardian,
            view.paused_until,
            view.paused_at,
            view.last_by
        ),
        (guardian.pubkey(), 0, 0, ADMIN)
    );
    assert_eq!(world.data(&PAUSE_ADDRESS)[88], 255, "bump");

    // Once only.
    let error = send_as(
        &mut world,
        &[init_pause_ix(&ADMIN, &ADMIN, &guardian.pubkey())],
        &fee_payer,
        &[ADMIN],
    )
    .expect_err("a second init must fail");
    assert!(
        !error.contains("Custom(61"),
        "refused by the System program: {error}"
    );
}

#[test]
fn the_guardian_pauses_once_for_seven_days_and_only_the_admin_extends_or_unpauses() {
    let mut t = Fixture::new();
    let (guardian, stranger) = (t.guardian.insecure_clone(), t.stranger.insecure_clone());

    // Nobody else pauses.
    t.world.refused(
        "pause by a stranger",
        by("pause", &stranger.pubkey(), &[]),
        &[&stranger],
        NOT_PAUSE_AUTHORITY,
    );
    // Not without the guardian's signature.
    t.world.refused(
        "pause, guardian not signing",
        not_signed(by("pause", &guardian.pubkey(), &[]), 1),
        &[&stranger],
        NOT_SIGNER,
    );

    let slot = t.world.slot();
    t.pause();
    let view = read_pause(&t.world);
    assert_eq!(
        (view.paused_until, view.paused_at, view.last_by),
        (slot + PAUSE_SLOTS, slot, guardian.pubkey())
    );

    // The guardian cannot extend its own pause, so a lost or stolen guardian
    // key holds the protocol for at most PAUSE_SLOTS.
    t.world.next_slot();
    t.world.refused(
        "guardian pauses again",
        by("pause", &guardian.pubkey(), &[]),
        &[&guardian],
        ALREADY_PAUSED,
    );
    // The guardian cannot unpause.
    t.world.refused(
        "guardian unpauses",
        by("unpause", &guardian.pubkey(), &[]),
        &[&guardian],
        NOT_PAUSE_AUTHORITY,
    );

    // The admin extends it to PAUSE_SLOTS from now.
    t.world.warp(slot + 1_000);
    admin_ok(
        &mut t.world,
        "admin extends",
        by("pause", &ADMIN, &[]),
        &stranger,
    );
    let view = read_pause(&t.world);
    assert_eq!(
        (view.paused_until, view.paused_at, view.last_by),
        (slot + 1_000 + PAUSE_SLOTS, slot + 1_000, ADMIN)
    );

    // The admin unpauses; unpausing again is harmless.
    admin_ok(
        &mut t.world,
        "unpause",
        by("unpause", &ADMIN, &[]),
        &stranger,
    );
    assert_eq!(read_pause(&t.world).paused_until, 0);
    admin_ok(
        &mut t.world,
        "unpause again",
        by("unpause", &ADMIN, &[]),
        &stranger,
    );

    // Not paused any more: the guardian may pause again.
    t.pause();
}

#[test]
fn a_pause_ends_by_itself_after_seven_days() {
    let mut t = Fixture::new();
    let (payer, payee) = (t.payer.insecure_clone(), t.payee.insecure_clone());
    let slot = t.world.slot();
    t.pause();
    let lock = sol_lock(&payer.pubkey(), &payee.pubkey(), 1_000_000, nonce(1), false);
    t.world.warp(slot + PAUSE_SLOTS - 1);
    t.world.refused(
        "lock on the last paused slot",
        lock.clone(),
        &[&payer],
        PROTOCOL_PAUSED,
    );
    t.world.warp(slot + PAUSE_SLOTS);
    t.world
        .ok("lock once the pause has run out", lock, &[&payer]);
    // And the guardian may pause again (nothing extended it).
    t.pause();
}

#[test]
fn only_the_admin_names_a_new_guardian() {
    let mut t = Fixture::new();
    let (old, stranger) = (t.guardian.insecure_clone(), t.stranger.insecure_clone());
    let new = t.world.wallet(41);

    t.world.refused(
        "guardian names its successor",
        by("set_guardian", &old.pubkey(), &new.pubkey().to_bytes()),
        &[&old],
        NOT_PAUSE_AUTHORITY,
    );
    admin_refused(
        &mut t.world,
        "zero guardian",
        by("set_guardian", &ADMIN, &[0; 32]),
        &stranger,
        INVALID_GUARDIAN,
    );
    admin_ok(
        &mut t.world,
        "set_guardian",
        by("set_guardian", &ADMIN, &new.pubkey().to_bytes()),
        &stranger,
    );
    assert_eq!(read_pause(&t.world).guardian, new.pubkey());

    // The old key can no longer pause; the new one can.
    t.world.refused(
        "old guardian pauses",
        by("pause", &old.pubkey(), &[]),
        &[&old],
        NOT_PAUSE_AUTHORITY,
    );
    t.world.ok(
        "new guardian pauses",
        by("pause", &new.pubkey(), &[]),
        &[&new],
    );
}

// ── Escrows while paused ────────────────────────────────────────────────────

#[test]
fn a_pause_stops_locks_and_payouts_but_never_refunds_of_an_escrow() {
    let mut t = Fixture::new();
    let (payer, payee) = (t.payer.insecure_clone(), t.payee.insecure_clone());
    let (p, q) = (payer.pubkey(), payee.pubkey());

    // Three escrows locked before the pause.
    t.world.ok(
        "lock 1",
        sol_lock(&p, &q, 1_000_000, nonce(1), false),
        &[&payer],
    );
    t.world.ok(
        "lock 2",
        sol_lock(&p, &q, 1_000_000, nonce(2), true),
        &[&payer],
    );
    t.world.ok(
        "lock 3",
        sol_lock(&p, &q, 1_000_000, nonce(3), false),
        &[&payer],
    );
    t.world.next_slot();
    t.pause();

    // Nothing new comes in.
    t.world.refused(
        "lock while paused",
        sol_lock(&p, &q, 1_000_000, nonce(4), false),
        &[&payer],
        PROTOCOL_PAUSED,
    );
    t.world.refused(
        "metered lock while paused",
        sol_lock(&p, &q, 1_000_000, nonce(5), true),
        &[&payer],
        PROTOCOL_PAUSED,
    );
    // Nobody is paid: not the payer's release, not the payee's claim or settle.
    t.world.refused(
        "payer release",
        sol_payout(&p, &q, nonce(1), &p, None),
        &[&payer],
        PROTOCOL_PAUSED,
    );
    t.world.warp(t.world.slot() + CLAIM_WINDOW);
    t.world.refused(
        "payee claim",
        sol_payout(&p, &q, nonce(1), &q, None),
        &[&payee],
        PROTOCOL_PAUSED,
    );
    t.world.refused(
        "payee settle",
        sol_payout(&p, &q, nonce(2), &q, Some(500_000)),
        &[&payee],
        PROTOCOL_PAUSED,
    );

    // Refunds go ahead: the payee declines one, the payer refunds another
    // after its window. Neither needs the pause account.
    let before = t.world.lamports(&p);
    t.world
        .ok("payee declines", sol_cancel(&p, nonce(2), &q), &[&payee]);
    assert!(
        t.world.lamports(&p) > before + 1_000_000 - 1,
        "refunded in full"
    );
    t.world.warp(t.world.slot() + CANCEL_WINDOW);
    t.world.ok(
        "payer refunds after the window",
        sol_cancel(&p, nonce(3), &p),
        &[&payer],
    );
    // A refund with the pause account passed anyway goes ahead too.
    let mut refund = sol_cancel(&p, nonce(1), &p);
    refund
        .accounts
        .push(AccountMeta::new_readonly(PAUSE_ADDRESS, false));
    t.world
        .ok("refund with the pause account", refund, &[&payer]);
}

#[test]
fn a_pause_stops_token_locks_and_payouts_but_not_refunds() {
    let mut t = Fixture::new();
    let tokens = Tokens::install(
        &mut t.world,
        anchor_spl::token::spl_token::id(),
        USDC_MAINNET_MINT,
        t.payer.insecure_clone(),
        t.payee.insecure_clone(),
    );
    let (payer, payee) = (t.payer.insecure_clone(), t.payee.insecure_clone());
    t.world.ok(
        "token lock",
        tokens.lock(1_000_000, nonce(1), true),
        &[&payer],
    );
    t.world.next_slot();
    t.pause();

    t.world.refused(
        "token lock while paused",
        tokens.lock(1_000_000, nonce(2), false),
        &[&payer],
        PROTOCOL_PAUSED,
    );
    t.world.refused(
        "token settle while paused",
        tokens.payout(nonce(1), &payee.pubkey(), Some(400_000)),
        &[&payee],
        PROTOCOL_PAUSED,
    );
    let before = tokens.balance(&t.world, &tokens.source);
    t.world.ok(
        "token decline while paused",
        tokens.cancel(nonce(1), &payee.pubkey()),
        &[&payee],
    );
    assert_eq!(tokens.balance(&t.world, &tokens.source), before + 1_000_000);
}

#[test]
fn locks_and_payouts_need_the_pause_account_and_it_may_be_anywhere() {
    let mut t = Fixture::new();
    let (payer, payee) = (t.payer.insecure_clone(), t.payee.insecure_clone());
    let (p, q) = (payer.pubkey(), payee.pubkey());
    let lock = sol_lock(&p, &q, 1_000_000, nonce(1), false);

    // Without it a lock is refused, so a client that leaves it out cannot
    // slip past a pause.
    let sent = {
        let ixs = bind_without_pause(&mut t.world.svm, std::slice::from_ref(&lock));
        t.world.svm.expire_blockhash();
        let msg = Message::new_with_blockhash(&ixs, Some(&p), &t.world.svm.latest_blockhash());
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
        t.world.svm.send_transaction(tx)
    };
    let error = format!(
        "{:?}",
        sent.expect_err("a lock without the pause account").err
    );
    assert!(
        error.contains(&format!("Custom({PAUSE_ACCOUNT_REQUIRED})")),
        "{error}"
    );

    // A look-alike account is not the pause account.
    let mut fake = lock.clone();
    let impostor = Pubkey::new_unique();
    t.world.set(
        impostor,
        Account {
            lamports: 1_000_000,
            data: pause_state(&TEST_GUARDIAN, 0),
            owner: escrow::id(),
            ..Account::default()
        },
    );
    fake.accounts
        .push(AccountMeta::new_readonly(impostor, false));
    // `bind` then appends the real one too, so check the impostor alone.
    let ixs = bind_without_pause(&mut t.world.svm, &[fake]);
    t.world.svm.expire_blockhash();
    let msg = Message::new_with_blockhash(&ixs, Some(&p), &t.world.svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    let error = format!(
        "{:?}",
        t.world.svm.send_transaction(tx).expect_err("impostor").err
    );
    assert!(
        error.contains(&format!("Custom({PAUSE_ACCOUNT_REQUIRED})")),
        "{error}"
    );

    // The pause account first instead of last: the program takes it out and
    // the lock sees its own accounts in their order.
    let mut first = lock.clone();
    first
        .accounts
        .insert(0, AccountMeta::new_readonly(PAUSE_ADDRESS, false));
    t.world
        .ok("lock with the pause account first", first, &[&payer]);
    t.world.next_slot();
    // In the middle of a release's accounts, too.
    let mut middle = sol_payout(&p, &q, nonce(1), &p, None);
    middle
        .accounts
        .insert(2, AccountMeta::new_readonly(PAUSE_ADDRESS, false));
    t.world.ok(
        "release with the pause account in the middle",
        middle,
        &[&payer],
    );
}

#[test]
fn before_init_pause_no_lock_goes_through() {
    // A build deployed before the admin creates the pause account takes no
    // locks: the account is required and must exist.
    let mut world = World::without_sigverify();
    let payer = world.wallet(1);
    let payee = world.wallet(2);
    let lock = sol_lock(&payer.pubkey(), &payee.pubkey(), 1_000_000, nonce(1), false);
    let mut lock = lock;
    lock.accounts
        .push(AccountMeta::new_readonly(PAUSE_ADDRESS, false));
    let ixs = bind_without_pause(&mut world.svm, &[lock]);
    world.svm.expire_blockhash();
    let msg =
        Message::new_with_blockhash(&ixs, Some(&payer.pubkey()), &world.svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    let error = format!(
        "{:?}",
        world
            .svm
            .send_transaction(tx)
            .expect_err("no pause account yet")
            .err
    );
    assert!(
        error.contains(&format!("Custom({NOT_INITIALIZED})")),
        "{error}"
    );
}

// ── Budgets while paused ────────────────────────────────────────────────────

#[test]
fn a_pause_stops_budget_opens_reserves_and_provider_payouts_but_not_refunds() {
    let mut t = Fixture::new();
    let (payer, payee, spender, stranger) = (
        t.payer.insecure_clone(),
        t.payee.insecure_clone(),
        t.spender.insecure_clone(),
        t.stranger.insecure_clone(),
    );
    let (p, q) = (payer.pubkey(), payee.pubkey());

    // Budget 1: a posted slice. Budget 2: an unposted slice. Budget 3: a
    // disputed slice for the judge.
    let (b1, c1) = t.budget(1, 40_000_000);
    t.post(&b1, c1, 30_000_000);
    let (b2, c2) = t.budget(2, 40_000_000);
    let (b3, c3) = t.budget(3, 40_000_000);
    t.post(&b3, c3, 30_000_000);
    t.world
        .ok("dispute", hold_ix("dispute", &b3, c3, &q, &p), &[&payer]);
    let slot = t.world.slot();
    t.pause();

    // Nothing new.
    let terms = t.terms(9);
    t.world.refused(
        "open while paused",
        terms.open_ix(&p),
        &[&payer],
        PROTOCOL_PAUSED,
    );
    t.world.refused(
        "raise a slice while paused",
        reserve_ix(&b1, c1, &spender.pubkey(), &q, &q, 50_000_000),
        &[&payee, &spender],
        PROTOCOL_PAUSED,
    );

    // What moves no money goes ahead: a post, a dispute, the payer's waive.
    t.post(&b2, c2, 20_000_000);
    t.world.ok(
        "waive while paused",
        hold_ix("waive", &b2, c2, &q, &p),
        &[&payer],
    );

    // Closing refunds what was never reserved.
    for (budget, created) in [(b1, c1), (b2, c2), (b3, c3)] {
        let before = t.world.lamports(&p);
        t.world.ok(
            "close while paused",
            close_ix(&budget, created, &p, &p),
            &[&payer],
        );
        assert_eq!(
            t.world.lamports(&p),
            before + (TOTAL - 40_000_000) - 5_000,
            "the unreserved part is back with the payer"
        );
    }

    // A waived slice would pay the provider: held.
    t.world.refused(
        "payout of a waived slice",
        payout_ix(&b2, c2, &q, &p),
        &[&stranger],
        PROTOCOL_PAUSED,
    );
    // A slice whose dispute window ended would pay the provider: held.
    t.world.warp(slot + DISPUTE_SLOTS + 9_000);
    t.world.refused(
        "payout after the dispute window",
        payout_ix(&b1, c1, &q, &p),
        &[&stranger],
        PROTOCOL_PAUSED,
    );
    // The judge's ruling that pays the provider: held; a ruling of 0 (all
    // back to the payer) goes ahead.
    let judge = t.judge.insecure_clone();
    t.world.warp(slot + 10);
    t.world.refused(
        "judge pays the provider",
        resolve_ix(&b3, c3, &q, &p, &judge.pubkey(), 10_000_000),
        &[&judge],
        PROTOCOL_PAUSED,
    );
    let before = t.world.lamports(&p);
    t.world.ok(
        "judge refunds in full",
        resolve_ix(&b3, c3, &q, &p, &judge.pubkey(), 0),
        &[&judge],
    );
    assert!(
        t.world.lamports(&p) >= before + 40_000_000,
        "the whole slice is back with the payer"
    );
}

#[test]
fn a_judge_timeout_and_an_unposted_slice_refund_while_paused_even_without_the_pause_account() {
    let mut t = Fixture::new();
    let (payer, stranger) = (t.payer.insecure_clone(), t.stranger.insecure_clone());
    let (p, q) = (payer.pubkey(), t.payee.pubkey());
    let (b1, c1) = t.budget(1, 40_000_000); // never posted
    let (b2, c2) = t.budget(2, 40_000_000); // disputed, judge never rules
    t.post(&b2, c2, 30_000_000);
    t.world
        .ok("dispute", hold_ix("dispute", &b2, c2, &q, &p), &[&payer]);
    for (budget, created) in [(b1, c1), (b2, c2)] {
        t.world
            .ok("close", close_ix(&budget, created, &p, &p), &[&payer]);
    }
    t.pause();
    t.world
        .warp(t.world.slot() + DISPUTE_SLOTS + JUDGE_SLOTS + 9_000);

    for (label, budget, created) in [("unposted", b1, c1), ("judge timed out", b2, c2)] {
        // Without the pause account a payout counts as paused, and a refund
        // still goes ahead.
        let ix = payout_ix(&budget, created, &q, &p);
        let ixs = bind_without_pause(&mut t.world.svm, &[ix]);
        t.world.svm.expire_blockhash();
        let before = t.world.lamports(&p);
        let msg = Message::new_with_blockhash(
            &ixs,
            Some(&stranger.pubkey()),
            &t.world.svm.latest_blockhash(),
        );
        let tx =
            VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&stranger]).unwrap();
        t.world
            .svm
            .send_transaction(tx)
            .unwrap_or_else(|e| panic!("{label}: {:?}", e.err));
        assert!(
            t.world.lamports(&p) >= before + 40_000_000,
            "{label}: the whole slice is back with the payer"
        );
    }
}

#[test]
fn without_the_pause_account_a_payout_that_pays_the_provider_is_held() {
    let mut t = Fixture::new();
    let (payer, stranger) = (t.payer.insecure_clone(), t.stranger.insecure_clone());
    let (p, q) = (payer.pubkey(), t.payee.pubkey());
    let (b, c) = t.budget(1, 40_000_000);
    t.post(&b, c, 30_000_000);
    t.world
        .ok("waive", hold_ix("waive", &b, c, &q, &p), &[&payer]);
    // Not paused, but the caller left the pause account out: held.
    let ixs = bind_without_pause(&mut t.world.svm, &[payout_ix(&b, c, &q, &p)]);
    t.world.svm.expire_blockhash();
    let msg = Message::new_with_blockhash(
        &ixs,
        Some(&stranger.pubkey()),
        &t.world.svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&stranger]).unwrap();
    let error = format!(
        "{:?}",
        t.world.svm.send_transaction(tx).expect_err("held").err
    );
    assert!(
        error.contains(&format!("Custom({PROTOCOL_PAUSED})")),
        "{error}"
    );
    // With it, paid.
    t.world.ok("payout", payout_ix(&b, c, &q, &p), &[&stranger]);
}

#[test]
fn after_an_unpause_held_payouts_go_through() {
    let mut t = Fixture::new();
    let (payer, stranger) = (t.payer.insecure_clone(), t.stranger.insecure_clone());
    let (p, q) = (payer.pubkey(), t.payee.pubkey());
    let (b, c) = t.budget(1, 40_000_000);
    t.post(&b, c, 30_000_000);
    t.world
        .ok("waive", hold_ix("waive", &b, c, &q, &p), &[&payer]);
    t.pause();
    t.world.refused(
        "payout while paused",
        payout_ix(&b, c, &q, &p),
        &[&stranger],
        PROTOCOL_PAUSED,
    );
    admin_ok(
        &mut t.world,
        "unpause",
        by("unpause", &ADMIN, &[]),
        &stranger,
    );
    let before = t.world.lamports(&q);
    t.world.ok(
        "payout after unpause",
        payout_ix(&b, c, &q, &p),
        &[&stranger],
    );
    let fee = 30_000_000 * 250 / 10_000;
    assert_eq!(t.world.lamports(&q), before + 30_000_000 - fee);
}

#[test]
fn set_paused_helper_matches_a_real_pause() {
    // The direct-state helper the other suites use writes what `pause` does.
    let mut t = Fixture::new();
    t.pause();
    let real = read_pause(&t.world);
    set_paused(&mut t.world, real.paused_until);
    assert_eq!(read_pause(&t.world).paused_until, real.paused_until);
}
