//! Side-by-side replay: every transaction below is sent to two simulators that
//! differ only in the program loaded at the escrow address, the Anchor build
//! and the Pinocchio build. After each transaction the two must agree on
//!
//! - whether it succeeded, and the exact error if it did not;
//! - the error name, number and message logged for a refused call;
//! - the events emitted (`Program data:` log lines, byte for byte);
//! - the cross-program calls made (program, accounts and data, in order);
//! - lamports, owner and data of every account any transaction has touched.
//!
//! Keys are fixed, so both simulators see identical bytes. Compute units are
//! the one thing expected to differ; they are collected and printed
//! (`cargo test --test differential -- --nocapture`).
//!
//! Needs both binaries: `target/deploy/escrow.so` at the repository root
//! (default features) and `../target/deploy/pinocchio_escrow.so`.
use {
    anchor_lang::{
        prelude::{AccountMeta, Pubkey},
        solana_program::{instruction::Instruction, program_pack::Pack, system_program},
        InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token::{self, instruction as token_ix},
    escrow::{
        accounts, instruction, state::AgentType, token_accounts::TOKEN_2022_ID,
        AGENT_FEE_BURN_ADDRESS, AUDD_MAINNET_MINT,
        DEFAULT_CANCEL_WINDOW_SLOTS as CANCEL_WINDOW_SLOTS,
        DEFAULT_CLAIM_WINDOW_SLOTS as CLAIM_WINDOW_SLOTS, MAX_SOL_ESCROW_LAMPORTS,
        MAX_TOKEN_ESCROW_BASE_UNITS, PROTOCOL_TREASURY, PYUSD_MAINNET_MINT, USDC_DEVNET_MINT,
        USDC_MAINNET_MINT, USDG_MAINNET_MINT,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    std::collections::BTreeSet,
};

const ANCHOR: &[u8] = include_bytes!("../../../../target/deploy/escrow.so");
const PINOCCHIO: &[u8] = include_bytes!("../../target/deploy/pinocchio_escrow.so");
const PYUSD_MINT_FIXTURE: &[u8] = include_bytes!("fixtures/pyusd_mainnet_mint_2026-11-20.bin");
const USDG_MINT_FIXTURE: &[u8] = include_bytes!("fixtures/usdg_mainnet_mint_2026-11-21.bin");
const TOKEN_2022_ACCOUNT_LEN: usize = 183;

fn key(seed: u8) -> Keypair {
    Keypair::new_from_array([seed; 32])
}

/// What one simulator reported for one transaction.
#[derive(Debug, PartialEq)]
struct Observed {
    error: Option<String>,
    /// Text after "Error Code:" in the program's error log line, if any.
    error_log: Option<String>,
    events: Vec<String>,
    /// Free-text lines the PER instructions log.
    notes: Vec<String>,
    inner: String,
}

struct Pair {
    anchor: LiteSVM,
    pinocchio: LiteSVM,
    touched: BTreeSet<Pubkey>,
    /// (label, Anchor compute units, Pinocchio compute units), successes only.
    compute: Vec<(String, u64, u64)>,
    transactions: usize,
}

fn observe(svm: &mut LiteSVM, ixs: &[Instruction], signers: &[&Keypair]) -> (Observed, u64) {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&signers[0].pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    let (error, meta) = match svm.send_transaction(tx) {
        Ok(meta) => (None, meta),
        Err(failed) => (Some(format!("{:?}", failed.err)), failed.meta),
    };
    let events = meta
        .logs
        .iter()
        .filter(|line| line.starts_with("Program data: "))
        .cloned()
        .collect();
    let notes = meta
        .logs
        .iter()
        .filter(|line| line.starts_with("Program log: Escrow "))
        .cloned()
        .collect();
    let error_log = meta.logs.iter().find_map(|line| {
        line.split_once("Error Code: ")
            .map(|(_, rest)| rest.to_string())
    });
    (
        Observed {
            error,
            error_log,
            events,
            notes,
            inner: format!("{:?}", meta.inner_instructions),
        },
        meta.compute_units_consumed,
    )
}

impl Pair {
    fn new() -> Self {
        let mut pair = Self {
            anchor: LiteSVM::new(),
            pinocchio: LiteSVM::new(),
            touched: BTreeSet::new(),
            compute: Vec::new(),
            transactions: 0,
        };
        pair.anchor.add_program(escrow::id(), ANCHOR).unwrap();
        pair.pinocchio.add_program(escrow::id(), PINOCCHIO).unwrap();
        pair.set(
            PROTOCOL_TREASURY,
            Account {
                lamports: 1_000_000_000,
                ..Account::default()
            },
        );
        pair
    }

    fn each(&mut self, mut apply: impl FnMut(&mut LiteSVM)) {
        apply(&mut self.anchor);
        apply(&mut self.pinocchio);
    }

    fn set(&mut self, address: Pubkey, account: Account) {
        self.touched.insert(address);
        self.each(|svm| svm.set_account(address, account.clone()).unwrap());
    }

    fn fund(&mut self, who: &Keypair, lamports: u64) {
        self.set(
            who.pubkey(),
            Account {
                lamports,
                ..Account::default()
            },
        );
    }

    fn slot(&self) -> u64 {
        self.anchor.get_sysvar::<anchor_lang::prelude::Clock>().slot
    }

    fn warp(&mut self, slot: u64) {
        self.each(|svm| svm.warp_to_slot(slot));
    }

    /// Set the cluster's Unix time, which the simulator starts at zero.
    #[cfg(feature = "extended")]
    fn set_time(&mut self, unix_timestamp: i64) {
        self.each(|svm| {
            let mut clock = svm.get_sysvar::<anchor_lang::prelude::Clock>();
            clock.unix_timestamp = unix_timestamp;
            svm.set_sysvar(&clock);
        });
    }

    /// Send the same transaction to both and require identical results.
    /// Returns whether it succeeded.
    fn send(&mut self, label: &str, ixs: &[Instruction], signers: &[&Keypair]) -> bool {
        for ix in ixs {
            self.touched
                .extend(ix.accounts.iter().map(|meta| meta.pubkey));
        }
        let (anchor, anchor_units) = observe(&mut self.anchor, ixs, signers);
        let (pinocchio, pinocchio_units) = observe(&mut self.pinocchio, ixs, signers);
        assert_eq!(anchor, pinocchio, "{label}: the two builds disagree");
        for address in &self.touched {
            assert_eq!(
                self.anchor.get_account(address),
                self.pinocchio.get_account(address),
                "{label}: account {address} differs after the transaction"
            );
        }
        self.transactions += 1;
        let ok = anchor.error.is_none();
        if ok {
            self.compute
                .push((label.to_string(), anchor_units, pinocchio_units));
        }
        ok
    }

    fn ok(&mut self, label: &str, ix: Instruction, signers: &[&Keypair]) {
        assert!(
            self.send(label, &[ix], signers),
            "{label}: expected success"
        );
    }

    /// Both builds must refuse, with `code` as the custom error.
    fn refused(&mut self, label: &str, ix: Instruction, signers: &[&Keypair], code: u32) {
        let (probe, _) = observe(&mut self.anchor.clone(), std::slice::from_ref(&ix), signers);
        let error = probe
            .error
            .unwrap_or_else(|| panic!("{label}: expected a refusal"));
        assert!(
            error.contains(&format!("Custom({code})")),
            "{label}: expected Custom({code}), got {error}"
        );
        assert!(!self.send(label, &[ix], signers));
    }

    fn report(&self, title: &str) {
        println!("\n{title}: {} transactions agreed", self.transactions);
        println!(
            "{:<44} {:>10} {:>10}",
            "compute units", "Anchor", "Pinocchio"
        );
        for (label, anchor, pinocchio) in &self.compute {
            println!("{label:<44} {anchor:>10} {pinocchio:>10}");
        }
    }
}

// ── SOL escrow ──────────────────────────────────────────────────────────────

fn sol_escrow(payer: &Pubkey, nonce: [u8; 16]) -> Pubkey {
    Pubkey::find_program_address(&[b"escrow", payer.as_ref(), &nonce], &escrow::id()).0
}

fn sol_lock(
    payer: &Pubkey,
    payee: &Pubkey,
    amount: u64,
    nonce: [u8; 16],
    metered: bool,
) -> Instruction {
    let data = if metered {
        instruction::LockMeteredEscrow {
            amount,
            nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data()
    } else {
        instruction::LockEscrow {
            amount,
            nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data()
    };
    Instruction::new_with_bytes(
        escrow::id(),
        &data,
        accounts::LockEscrow {
            escrow: sol_escrow(payer, nonce),
            payer: *payer,
            payee: *payee,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
    )
}

/// Release (`actual` is `None`) or settle, signed by `signer`.
fn sol_payout(
    payer: &Pubkey,
    payee: &Pubkey,
    nonce: [u8; 16],
    signer: &Pubkey,
    actual: Option<u64>,
) -> Instruction {
    let mut metas = accounts::ReleaseEscrow {
        escrow: sol_escrow(payer, nonce),
        payer: *payer,
        payee: *payee,
        treasury: PROTOCOL_TREASURY,
        system_program: system_program::id(),
    }
    .to_account_metas(None);
    for meta in &mut metas {
        meta.is_signer = meta.pubkey == *signer;
    }
    let data = match actual {
        Some(actual) => instruction::SettleEscrow { actual }.data(),
        None => instruction::ReleaseEscrow {}.data(),
    };
    Instruction::new_with_bytes(escrow::id(), &data, metas)
}

/// A lock of 1,000,000 lamports with windows of the caller's choosing.
fn sol_lock_windows(
    payer: &Pubkey,
    payee: &Pubkey,
    nonce: [u8; 16],
    metered: bool,
    claim_window_slots: u64,
    cancel_window_slots: u64,
) -> Instruction {
    let amount = 1_000_000;
    let mut ix = sol_lock(payer, payee, amount, nonce, metered);
    ix.data = if metered {
        instruction::LockMeteredEscrow {
            amount,
            nonce,
            claim_window_slots,
            cancel_window_slots,
        }
        .data()
    } else {
        instruction::LockEscrow {
            amount,
            nonce,
            claim_window_slots,
            cancel_window_slots,
        }
        .data()
    };
    ix
}

fn sol_cancel(payer: &Pubkey, nonce: [u8; 16], authority: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::CancelEscrow {}.data(),
        accounts::CancelEscrow {
            escrow: sol_escrow(payer, nonce),
            authority: *authority,
            payer: *payer,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
    )
}

#[test]
fn sol_escrow_matches_the_anchor_build() {
    let mut pair = Pair::new();
    let (payer, payee, stranger) = (key(1), key(2), key(3));
    let (a, b) = (payer.pubkey(), payee.pubkey());
    pair.fund(&payer, 20_000_000_000);
    pair.fund(&payee, 1_000_000_000);
    pair.fund(&stranger, 1_000_000_000);
    let n = |i: u8| [i; 16];

    // Lock, then the payer releases.
    pair.ok(
        "sol lock",
        sol_lock(&a, &b, 300_000_000, n(1), false),
        &[&payer],
    );
    pair.refused(
        "sol lock: same nonce again",
        sol_lock(&a, &b, 1_000, n(1), false),
        &[&payer],
        0,
    );
    pair.refused(
        "sol release: wrong treasury",
        {
            let mut ix = sol_payout(&a, &b, n(1), &a, None);
            ix.accounts[3].pubkey = stranger.pubkey();
            ix
        },
        &[&payer],
        6030,
    );
    pair.refused(
        "sol release: another wallet as payer",
        sol_payout(&stranger.pubkey(), &b, n(1), &stranger.pubkey(), None)
            .with_escrow(sol_escrow(&a, n(1))),
        &[&stranger],
        2006,
    );
    pair.refused(
        "sol release: another wallet as payee",
        sol_payout(&a, &stranger.pubkey(), n(1), &a, None),
        &[&payer],
        2001,
    );
    pair.refused(
        "sol claim before the claim window",
        sol_payout(&a, &b, n(1), &b, None),
        &[&payee],
        6027,
    );
    pair.refused(
        "sol settle by the payee, not metered",
        sol_payout(&a, &b, n(1), &b, Some(1_000)),
        &[&payee],
        6029,
    );
    pair.refused(
        "sol refund before the cancel window",
        sol_cancel(&a, n(1), &a),
        &[&payer],
        6006,
    );
    pair.refused(
        "sol refund by a stranger",
        sol_cancel(&a, n(1), &stranger.pubkey()),
        &[&stranger],
        6000,
    );
    pair.refused(
        "sol release with no signature from either party",
        sol_payout(&a, &b, n(1), &stranger.pubkey(), None),
        &[&stranger],
        6000,
    );
    pair.ok(
        "sol release by payer",
        sol_payout(&a, &b, n(1), &a, None),
        &[&payer],
    );
    pair.refused(
        "sol release: already settled",
        sol_payout(&a, &b, n(1), &a, None),
        &[&payer],
        3012,
    );

    // Metered lock, then the payee settles the actual cost.
    pair.ok(
        "sol metered lock",
        sol_lock(&a, &b, 200_000_000, n(2), true),
        &[&payer],
    );
    for (label, actual) in [("zero", 0), ("above the maximum", 200_000_001)] {
        pair.refused(
            &format!("sol settle: {label}"),
            sol_payout(&a, &b, n(2), &b, Some(actual)),
            &[&payee],
            6028,
        );
    }
    pair.ok(
        "sol settle by payee at actual cost",
        sol_payout(&a, &b, n(2), &b, Some(123_456_789)),
        &[&payee],
    );

    // The payer never settles: not part of a fixed-price escrow, not all of
    // it, and not a metered one. The payer's early way out is a full release.
    pair.ok(
        "sol lock",
        sol_lock(&a, &b, 100_000_000, n(3), false),
        &[&payer],
    );
    for (label, actual) in [("part", 39), ("all", 100_000_000)] {
        pair.refused(
            &format!("sol settle by the payer, fixed price: {label}"),
            sol_payout(&a, &b, n(3), &a, Some(actual)),
            &[&payer],
            6000,
        );
    }
    // With both signatures the payee's is the one that counts, and a
    // fixed-price escrow still cannot be settled.
    let mut both = sol_payout(&a, &b, n(3), &b, Some(39));
    both.accounts[1].is_signer = true;
    pair.refused(
        "sol settle signed by both, fixed price",
        both,
        &[&payer, &payee],
        6029,
    );
    pair.ok(
        "sol release by payer after refused settles",
        sol_payout(&a, &b, n(3), &a, None),
        &[&payer],
    );
    pair.ok(
        "sol metered lock",
        sol_lock(&a, &b, 100_000_000, n(4), true),
        &[&payer],
    );
    pair.refused(
        "sol settle by the payer, metered",
        sol_payout(&a, &b, n(4), &a, Some(39)),
        &[&payer],
        6000,
    );
    let mut both = sol_payout(&a, &b, n(4), &b, Some(39));
    both.accounts[1].is_signer = true;
    pair.ok(
        "sol settle signed by both, too small for a fee",
        both,
        &[&payer, &payee],
    );

    // Decline, refund after the window, claim after the window.
    pair.ok(
        "sol lock at the cap",
        sol_lock(&a, &b, MAX_SOL_ESCROW_LAMPORTS, n(5), false),
        &[&payer],
    );
    pair.ok("sol decline by payee", sol_cancel(&a, n(5), &b), &[&payee]);
    pair.ok(
        "sol lock",
        sol_lock(&a, &b, 5_000_000, n(6), false),
        &[&payer],
    );
    pair.ok(
        "sol lock",
        sol_lock(&a, &b, 7_000_000, n(7), true),
        &[&payer],
    );
    let locked_at = pair.slot();
    // The claim window opens first: the payee can claim while the payer
    // still cannot refund.
    pair.warp(locked_at + CLAIM_WINDOW_SLOTS - 1);
    pair.refused(
        "sol claim one slot early",
        sol_payout(&a, &b, n(7), &b, None),
        &[&payee],
        6027,
    );
    pair.warp(locked_at + CLAIM_WINDOW_SLOTS);
    pair.refused(
        "sol refund once the claim window is open, before the refund window",
        sol_cancel(&a, n(6), &a),
        &[&payer],
        6006,
    );
    pair.ok(
        "sol claim by payee after the window",
        sol_payout(&a, &b, n(7), &b, None),
        &[&payee],
    );
    pair.warp(locked_at + CANCEL_WINDOW_SLOTS - 1);
    pair.refused(
        "sol refund one slot early",
        sol_cancel(&a, n(6), &a),
        &[&payer],
        6006,
    );
    pair.warp(locked_at + CANCEL_WINDOW_SLOTS);
    pair.ok(
        "sol refund by payer after the window",
        sol_cancel(&a, n(6), &a),
        &[&payer],
    );

    // Refused locks.
    pair.refused(
        "sol lock: zero",
        sol_lock(&a, &b, 0, n(8), false),
        &[&payer],
        6004,
    );
    pair.refused(
        "sol lock: above the cap",
        sol_lock(&a, &b, MAX_SOL_ESCROW_LAMPORTS + 1, n(8), false),
        &[&payer],
        6025,
    );
    pair.refused(
        "sol lock: payer as payee",
        sol_lock(&a, &a, 1_000, n(8), false),
        &[&payer],
        6007,
    );
    pair.refused(
        "sol lock: escrow as payee",
        sol_lock(&a, &sol_escrow(&a, n(8)), 1_000, n(8), false),
        &[&payer],
        6007,
    );
    pair.refused(
        "sol lock: escrow address of another nonce",
        sol_lock(&a, &b, 1_000, n(8), false).with_escrow(sol_escrow(&a, n(9))),
        &[&payer],
        2006,
    );

    // An address someone sent lamports to before the lock can still be used.
    pair.set(
        sol_escrow(&a, n(10)),
        Account {
            lamports: 1,
            ..Account::default()
        },
    );
    pair.ok(
        "sol lock at a prefunded address",
        sol_lock(&a, &b, 1_000_000, n(10), false),
        &[&payer],
    );
    // A donation to a live escrow goes back to the payer with the rent.
    let mut donated = pair.anchor.get_account(&sol_escrow(&a, n(10))).unwrap();
    donated.lamports += 5_000;
    pair.set(sol_escrow(&a, n(10)), donated);
    pair.ok(
        "sol release after a donation",
        sol_payout(&a, &b, n(10), &a, None),
        &[&payer],
    );

    // Windows are named at lock, per escrow.
    let max = escrow::MAX_ESCROW_WINDOW_SLOTS;
    for (text, claim, cancel) in [
        ("no claim window", 0, 10),
        ("claim after the refund", 11, 10),
        ("refund window above the maximum", 1, max + 1),
        ("both above the maximum", max + 1, max + 1),
    ] {
        pair.refused(
            &format!("sol lock: {text}"),
            sol_lock_windows(&a, &b, n(13), false, claim, cancel),
            &[&payer],
            6031,
        );
    }
    pair.ok(
        "sol lock with the widest windows",
        sol_lock_windows(&a, &b, n(13), true, 1, max),
        &[&payer],
    );
    pair.ok(
        "sol lock with ten-second windows",
        sol_lock_windows(&a, &b, n(14), false, 25, 25),
        &[&payer],
    );
    pair.ok(
        "sol lock, claim in ten seconds, refund in a hundred",
        sol_lock_windows(&a, &b, n(15), false, 25, 250),
        &[&payer],
    );
    let locked_at = pair.slot();
    pair.warp(locked_at + 24);
    pair.refused(
        "sol short window: claim one slot early",
        sol_payout(&a, &b, n(15), &b, None),
        &[&payee],
        6027,
    );
    pair.refused(
        "sol short window: refund one slot early",
        sol_cancel(&a, n(14), &a),
        &[&payer],
        6006,
    );
    pair.warp(locked_at + 25);
    pair.ok(
        "sol short window: refund at the boundary of equal windows",
        sol_cancel(&a, n(14), &a),
        &[&payer],
    );
    pair.refused(
        "sol short window: refund before its own later window",
        sol_cancel(&a, n(15), &a),
        &[&payer],
        6006,
    );
    pair.ok(
        "sol short window: claim",
        sol_payout(&a, &b, n(15), &b, None),
        &[&payee],
    );

    // A lock the payee could not be paid from is refused. The floor is the
    // rent-exempt minimum of the payee's account.
    let unfunded = key(40).pubkey();
    let floor = pair.anchor.minimum_balance_for_rent_exemption(0);
    let mut enough = floor;
    while enough - escrow::protocol_fee(enough, true) < floor {
        enough += 1;
    }
    pair.refused(
        "sol lock: the payout would leave the payee below the rent minimum",
        sol_lock(&a, &unfunded, enough - 1, n(40), false),
        &[&payer],
        6032,
    );
    pair.refused(
        "sol metered lock: the payee holds nothing",
        sol_lock(&a, &unfunded, 400_000_000, n(40), true),
        &[&payer],
        6032,
    );
    pair.ok(
        "sol lock: the payout just reaches the rent minimum",
        sol_lock(&a, &unfunded, enough, n(40), false),
        &[&payer],
    );
    pair.ok(
        "sol release to a payee that held nothing",
        sol_payout(&a, &unfunded, n(40), &a, None),
        &[&payer],
    );
    pair.ok(
        "sol lock: one lamport to a payee that now holds the minimum",
        sol_lock(&a, &unfunded, 1, n(41), false),
        &[&payer],
    );
    pair.ok(
        "sol metered lock to a payee that now holds the minimum",
        sol_lock(&a, &unfunded, 1, n(42), true),
        &[&payer],
    );

    pair.report("SOL escrow");
}

trait WithEscrow {
    fn with_escrow(self, escrow: Pubkey) -> Self;
}

impl WithEscrow for Instruction {
    /// Replace the first account (the escrow or agent record).
    fn with_escrow(mut self, escrow: Pubkey) -> Self {
        self.accounts[0].pubkey = escrow;
        self
    }
}

// ── Malformed calls ─────────────────────────────────────────────────────────

#[test]
fn malformed_calls_are_refused_the_same_way() {
    let mut pair = Pair::new();
    let payer = key(1);
    let a = payer.pubkey();
    pair.fund(&payer, 1_000_000_000);
    let other = key_funded(&mut pair, 3);
    let raw = |data: Vec<u8>, metas: Vec<AccountMeta>| {
        Instruction::new_with_bytes(escrow::id(), &data, metas)
    };

    pair.refused("no data", raw(vec![], vec![]), &[&payer], 101);
    pair.refused(
        "seven bytes of data",
        raw(vec![1; 7], vec![]),
        &[&payer],
        101,
    );
    pair.refused(
        "unknown instruction",
        raw(vec![9; 8], vec![]),
        &[&payer],
        101,
    );
    pair.fund(&key(2), 1_000_000_000);
    let lock = sol_lock(&a, &key(2).pubkey(), 1_000, [1; 16], false);
    pair.refused(
        "lock with truncated arguments",
        raw(lock.data[..20].to_vec(), lock.accounts.clone()),
        &[&payer],
        102,
    );
    pair.refused(
        "lock without its windows",
        raw(lock.data[..32].to_vec(), lock.accounts.clone()),
        &[&payer],
        102,
    );
    pair.refused(
        "lock with one window",
        raw(lock.data[..40].to_vec(), lock.accounts.clone()),
        &[&payer],
        102,
    );
    pair.refused(
        "lock with too few accounts",
        raw(lock.data.clone(), lock.accounts[..3].to_vec()),
        &[&payer],
        3005,
    );
    pair.refused(
        "lock with the wrong system program",
        {
            let mut ix = lock.clone();
            ix.accounts[3].pubkey = spl_token::ID;
            ix
        },
        &[&payer],
        3008,
    );
    pair.refused(
        "lock without the payer's signature",
        {
            let mut ix = lock.clone();
            ix.accounts[1].is_signer = false;
            ix.accounts.push(AccountMeta::new(key(3).pubkey(), true));
            ix
        },
        &[&other],
        3010,
    );
    pair.refused(
        "release of an account that is not an escrow",
        sol_payout(&a, &key(2).pubkey(), [1; 16], &a, None).with_escrow(PROTOCOL_TREASURY),
        &[&payer],
        3007,
    );
    pair.ok(
        "lock with trailing bytes after the arguments",
        raw(
            [lock.data.clone(), vec![7; 5]].concat(),
            lock.accounts.clone(),
        ),
        &[&payer],
    );
    pair.report("Malformed calls");
}

/// Rewrite a live escrow record in place as the given earlier, shorter
/// format, keeping its balance.
fn shorten(pair: &mut Pair, address: Pubkey, earlier: impl Fn(&[u8]) -> Vec<u8>) {
    let mut account = pair.anchor.get_account(&address).unwrap();
    account.data = earlier(&account.data);
    pair.set(address, account);
}

/// Records written before each escrow named its own windows are 16 bytes
/// shorter: 149 bytes for SOL, where the two windows sat between the creation
/// slot and the delegation flag, and 203 for tokens, where they were appended.
/// Every instruction that reads one must refuse it, the same way in both builds.
#[test]
fn earlier_format_records_are_refused_the_same_way() {
    let mut pair = Pair::new();
    let payer = key(1);
    let payee = key(2);
    let (a, b) = (payer.pubkey(), payee.pubkey());
    pair.fund(&payer, 1_000_000_000);
    pair.fund(&payee, 1_000_000_000);

    for (nonce, metered) in [([1; 16], false), ([2; 16], true)] {
        pair.ok(
            "lock",
            sol_lock(&a, &b, 1_000_000, nonce, metered),
            &[&payer],
        );
        shorten(&mut pair, sol_escrow(&a, nonce), |data| {
            assert_eq!(data.len(), 165);
            let earlier = [&data[..113], &data[129..]].concat();
            assert_eq!(earlier.len(), 149);
            earlier
        });
        pair.refused(
            "release of a 149-byte record",
            sol_payout(&a, &b, nonce, &a, None),
            &[&payer],
            3003,
        );
        pair.refused(
            "claim of a 149-byte record",
            sol_payout(&a, &b, nonce, &b, None),
            &[&payee],
            3003,
        );
        pair.refused(
            "settle of a 149-byte record",
            sol_payout(&a, &b, nonce, &b, Some(1_000)),
            &[&payee],
            3003,
        );
        pair.refused(
            "refund of a 149-byte record by the payee",
            sol_cancel(&a, nonce, &b),
            &[&payee],
            3003,
        );
        pair.refused(
            "refund of a 149-byte record by the payer",
            sol_cancel(&a, nonce, &a),
            &[&payer],
            3003,
        );
    }

    let t = Tokens::install(&mut pair, spl_token::ID, USDC_MAINNET_MINT, 6);
    let (payer, payee) = (t.payer.pubkey(), t.payee.pubkey());
    for (nonce, metered) in [([3; 16], false), ([4; 16], true)] {
        pair.ok("token lock", t.lock(1_000_000, nonce, metered), &[&t.payer]);
        shorten(&mut pair, t.escrow(nonce), |data| {
            assert_eq!(data.len(), 219);
            data[..203].to_vec()
        });
        pair.refused(
            "release of a 203-byte record",
            t.payout(nonce, &payer, None),
            &[&t.payer],
            3003,
        );
        pair.refused(
            "claim of a 203-byte record",
            t.payout(nonce, &payee, None),
            &[&t.payee],
            3003,
        );
        pair.refused(
            "settle of a 203-byte record",
            t.payout(nonce, &payee, Some(1_000)),
            &[&t.payee],
            3003,
        );
        pair.refused(
            "refund of a 203-byte record by the payee",
            t.cancel(nonce, &payee, t.source),
            &[&t.payee],
            3003,
        );
        pair.refused(
            "refund of a 203-byte record by the payer",
            t.cancel(nonce, &payer, t.source),
            &[&t.payer],
            3003,
        );
    }
    pair.report("Earlier-format records");
}

fn key_funded(pair: &mut Pair, seed: u8) -> Keypair {
    let keypair = key(seed);
    pair.fund(&keypair, 1_000_000_000);
    keypair
}

// ── Registry ────────────────────────────────────────────────────────────────

fn agent(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"agent", owner.as_ref()], &escrow::id()).0
}

fn register(owner: &Pubkey, agent_type: AgentType, model: &str, rate: u64, min: u8) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::RegisterAgent {
            agent_type,
            model: model.to_string(),
            rate_lamports: rate,
            min_reputation: min,
        }
        .data(),
        accounts::RegisterAgent {
            agent: agent(owner),
            owner: *owner,
            fee_collector: AGENT_FEE_BURN_ADDRESS,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
    )
}

fn update(owner: &Pubkey, rate: u64, min: u8, active: bool) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::UpdateAgent {
            rate_lamports: rate,
            min_reputation: min,
            active,
        }
        .data(),
        accounts::UpdateAgent {
            agent: agent(owner),
            owner: *owner,
        }
        .to_account_metas(None),
    )
}

fn deregister(owner: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::DeregisterAgent {}.data(),
        accounts::DeregisterAgent {
            agent: agent(owner),
            owner: *owner,
        }
        .to_account_metas(None),
    )
}

#[test]
fn registry_matches_the_anchor_build() {
    let mut pair = Pair::new();
    let owners: Vec<Keypair> = (1..=4).map(|seed| key_funded(&mut pair, seed)).collect();
    let o = |i: usize| owners[i].pubkey();
    pair.set(
        AGENT_FEE_BURN_ADDRESS,
        Account {
            lamports: 1_000_000,
            ..Account::default()
        },
    );

    let longest = "m".repeat(64);
    pair.ok(
        "register (primary)",
        register(&o(0), AgentType::Primary, "qwen3:8b", 1_000_000, 3),
        &[&owners[0]],
    );
    pair.ok(
        "register (attestation, empty model)",
        register(&o(1), AgentType::Attestation, "", 0, 0),
        &[&owners[1]],
    );
    pair.ok(
        "register (both, 64-byte model)",
        register(&o(2), AgentType::Both, &longest, u64::MAX, u8::MAX),
        &[&owners[2]],
    );
    pair.refused(
        "register twice",
        register(&o(0), AgentType::Primary, "again", 1, 1),
        &[&owners[0]],
        0,
    );
    pair.refused(
        "register: 65-byte model",
        register(&o(3), AgentType::Primary, &"m".repeat(65), 1, 1),
        &[&owners[3]],
        6008,
    );
    pair.refused(
        "register: fee to another account",
        {
            let mut ix = register(&o(3), AgentType::Primary, "x", 1, 1);
            ix.accounts[2].pubkey = PROTOCOL_TREASURY;
            ix
        },
        &[&owners[3]],
        2012,
    );
    pair.refused(
        "register: record address of another owner",
        register(&o(3), AgentType::Primary, "x", 1, 1).with_escrow(Pubkey::new_from_array([9; 32])),
        &[&owners[3]],
        2006,
    );
    pair.refused(
        "register: unknown agent type",
        {
            let mut ix = register(&o(3), AgentType::Primary, "x", 1, 1);
            ix.data[8] = 3;
            ix
        },
        &[&owners[3]],
        102,
    );
    pair.refused(
        "register: model is not UTF-8",
        {
            let mut ix = register(&o(3), AgentType::Primary, "xy", 1, 1);
            ix.data[13] = 0xff;
            ix
        },
        &[&owners[3]],
        102,
    );
    pair.refused(
        "register: model length runs past the data",
        {
            let mut ix = register(&o(3), AgentType::Primary, "xy", 1, 1);
            ix.data[9] = 200;
            ix
        },
        &[&owners[3]],
        102,
    );

    pair.ok("update", update(&o(0), 42, 7, false), &[&owners[0]]);
    pair.ok(
        "update (64-byte model)",
        update(&o(2), 1, 2, false),
        &[&owners[2]],
    );
    pair.ok(
        "update back to active",
        update(&o(0), u64::MAX, 0, true),
        &[&owners[0]],
    );
    pair.refused(
        "update: someone else's record",
        update(&o(1), 1, 1, true).with_escrow(agent(&o(0))),
        &[&owners[1]],
        2006,
    );
    pair.refused(
        "update: active flag is not a boolean",
        {
            let mut ix = update(&o(0), 1, 1, true);
            *ix.data.last_mut().unwrap() = 2;
            ix
        },
        &[&owners[0]],
        102,
    );
    pair.refused(
        "update: not registered",
        update(&o(3), 1, 1, true),
        &[&owners[3]],
        3012,
    );
    pair.refused(
        "deregister: someone else's record",
        deregister(&o(1)).with_escrow(agent(&o(0))),
        &[&owners[1]],
        2006,
    );
    pair.ok("deregister", deregister(&o(0)), &[&owners[0]]);
    pair.refused("deregister twice", deregister(&o(0)), &[&owners[0]], 3012);
    pair.ok(
        "register again after deregistering",
        register(&o(0), AgentType::Both, "second", 5, 5),
        &[&owners[0]],
    );
    pair.report("Registry");
}

// ── Token escrow ────────────────────────────────────────────────────────────

struct Tokens {
    program: Pubkey,
    mint: Pubkey,
    payer: Keypair,
    payee: Keypair,
    stranger: Keypair,
    source: Pubkey,
    recipient: Pubkey,
    stranger_token: Pubkey,
    /// A second token account of the mint owned by the payer.
    spare: Pubkey,
    treasury_token: Pubkey,
}

fn token_account_data(program: &Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut data = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account::pack(
        spl_token::state::Account {
            mint: *mint,
            owner: *owner,
            amount,
            state: spl_token::state::AccountState::Initialized,
            ..Default::default()
        },
        &mut data,
    )
    .unwrap();
    if *program == TOKEN_2022_ID {
        // Account-type byte, then the two extension records an account of a
        // PYUSD-style mint carries: TransferFeeAmount and TransferHookAccount.
        data.push(2);
        data.extend_from_slice(&[2, 0, 8, 0]);
        data.extend_from_slice(&[0; 8]);
        data.extend_from_slice(&[15, 0, 1, 0]);
        data.push(0);
        assert_eq!(data.len(), TOKEN_2022_ACCOUNT_LEN);
    }
    data
}

impl Tokens {
    /// Installs a local mint at the allowlisted address `mint` and token
    /// accounts for each party. No real token, RPC or wallet is involved.
    fn install(pair: &mut Pair, program: Pubkey, mint: Pubkey, decimals: u8) -> Self {
        let (payer, payee, stranger) = (key(1), key(2), key(3));
        for who in [&payer, &payee, &stranger] {
            pair.fund(who, 10_000_000_000);
        }
        let mint_data = if program == TOKEN_2022_ID {
            let fixture = if mint == USDG_MAINNET_MINT {
                USDG_MINT_FIXTURE
            } else {
                PYUSD_MINT_FIXTURE
            };
            let mut data = fixture.to_vec();
            data[36..44].copy_from_slice(&3_000_000_000u64.to_le_bytes());
            data[44] = decimals;
            data
        } else {
            let mut data = vec![0u8; spl_token::state::Mint::LEN];
            spl_token::state::Mint::pack(
                spl_token::state::Mint {
                    mint_authority: Some(payer.pubkey()).into(),
                    supply: 3_000_000_000,
                    decimals,
                    is_initialized: true,
                    freeze_authority: None.into(),
                },
                &mut data,
            )
            .unwrap();
            data
        };
        pair.set(
            mint,
            Account {
                lamports: 100_000_000,
                data: mint_data,
                owner: program,
                ..Account::default()
            },
        );
        let treasury_token = escrow::treasury_token_address(&mint, &program);
        let tokens = Self {
            program,
            mint,
            source: Pubkey::new_from_array([101; 32]),
            recipient: Pubkey::new_from_array([102; 32]),
            stranger_token: Pubkey::new_from_array([103; 32]),
            spare: Pubkey::new_from_array([104; 32]),
            treasury_token,
            payer,
            payee,
            stranger,
        };
        for (address, owner, amount) in [
            (tokens.source, tokens.payer.pubkey(), 1_000_000_000),
            (tokens.recipient, tokens.payee.pubkey(), 0),
            (
                tokens.stranger_token,
                tokens.stranger.pubkey(),
                1_000_000_000,
            ),
            (tokens.spare, tokens.payer.pubkey(), 0),
            (tokens.treasury_token, PROTOCOL_TREASURY, 0),
        ] {
            tokens.put_account(pair, address, &owner, amount);
        }
        tokens
    }

    fn put_account(&self, pair: &mut Pair, address: Pubkey, owner: &Pubkey, amount: u64) {
        pair.set(
            address,
            Account {
                lamports: 10_000_000,
                data: token_account_data(&self.program, &self.mint, owner, amount),
                owner: self.program,
                ..Account::default()
            },
        );
    }

    /// Freeze or thaw a token account, as the mint's freeze authority would.
    fn set_frozen(&self, pair: &mut Pair, address: Pubkey, frozen: bool) {
        let mut account = pair.anchor.get_account(&address).unwrap();
        account.data[108] = if frozen { 2 } else { 1 };
        pair.set(address, account);
    }

    fn escrow(&self, nonce: [u8; 16]) -> Pubkey {
        Pubkey::find_program_address(
            &[b"token-escrow", self.payer.pubkey().as_ref(), &nonce],
            &escrow::id(),
        )
        .0
    }

    fn vault(&self, nonce: [u8; 16]) -> Pubkey {
        Pubkey::find_program_address(
            &[b"token-vault", self.escrow(nonce).as_ref()],
            &escrow::id(),
        )
        .0
    }

    /// A lock of 1,000,000 base units with windows of the caller's choosing.
    fn lock_windows(
        &self,
        nonce: [u8; 16],
        metered: bool,
        claim_window_slots: u64,
        cancel_window_slots: u64,
    ) -> Instruction {
        let amount = 1_000_000;
        let mut ix = self.lock(amount, nonce, metered);
        ix.data = if metered {
            instruction::LockMeteredTokenEscrow {
                amount,
                nonce,
                claim_window_slots,
                cancel_window_slots,
            }
            .data()
        } else {
            instruction::LockTokenEscrow {
                amount,
                nonce,
                claim_window_slots,
                cancel_window_slots,
            }
            .data()
        };
        ix
    }

    fn lock(&self, amount: u64, nonce: [u8; 16], metered: bool) -> Instruction {
        let data = if metered {
            instruction::LockMeteredTokenEscrow {
                amount,
                nonce,
                claim_window_slots: CLAIM_WINDOW_SLOTS,
                cancel_window_slots: CANCEL_WINDOW_SLOTS,
            }
            .data()
        } else {
            instruction::LockTokenEscrow {
                amount,
                nonce,
                claim_window_slots: CLAIM_WINDOW_SLOTS,
                cancel_window_slots: CANCEL_WINDOW_SLOTS,
            }
            .data()
        };
        Instruction::new_with_bytes(
            escrow::id(),
            &data,
            accounts::LockTokenEscrow {
                escrow: self.escrow(nonce),
                vault: self.vault(nonce),
                payer: self.payer.pubkey(),
                payee: self.payee.pubkey(),
                mint: self.mint,
                source: self.source,
                recipient: self.recipient,
                token_program: self.program,
                system_program: system_program::id(),
            }
            .to_account_metas(None),
        )
    }

    /// Release (`actual` is `None`) or settle, signed by `authority`.
    fn payout(&self, nonce: [u8; 16], authority: &Pubkey, actual: Option<u64>) -> Instruction {
        let data = match actual {
            Some(actual) => instruction::SettleTokenEscrow { actual }.data(),
            None => instruction::ReleaseTokenEscrow {}.data(),
        };
        Instruction::new_with_bytes(
            escrow::id(),
            &data,
            accounts::ReleaseTokenEscrow {
                escrow: self.escrow(nonce),
                vault: self.vault(nonce),
                authority: *authority,
                payer: self.payer.pubkey(),
                mint: self.mint,
                destination: self.recipient,
                treasury_token: self.treasury_token,
                refund: self.source,
                token_program: self.program,
            }
            .to_account_metas(None),
        )
    }

    fn cancel(&self, nonce: [u8; 16], authority: &Pubkey, destination: Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::CancelTokenEscrow {}.data(),
            accounts::CancelTokenEscrow {
                escrow: self.escrow(nonce),
                vault: self.vault(nonce),
                authority: *authority,
                payer: self.payer.pubkey(),
                mint: self.mint,
                destination,
                token_program: self.program,
            }
            .to_account_metas(None),
        )
    }

    /// A plain token transfer, outside the escrow program.
    fn transfer(&self, from: Pubkey, to: Pubkey, owner: &Pubkey, amount: u64) -> Instruction {
        let mut ix = token_ix::transfer_checked(
            &spl_token::ID,
            &from,
            &self.mint,
            &to,
            owner,
            &[],
            amount,
            6,
        )
        .unwrap();
        ix.program_id = self.program;
        ix
    }
}

/// Swap the account at `index`.
fn swap(mut ix: Instruction, index: usize, address: Pubkey) -> Instruction {
    ix.accounts[index].pubkey = address;
    ix
}

fn token_rail(pair: &mut Pair, t: &Tokens, name: &str) {
    let (a, b, s) = (t.payer.pubkey(), t.payee.pubkey(), t.stranger.pubkey());
    let n = |i: u8| [i; 16];
    let label = |text: &str| format!("{name} {text}");

    // Lock, refusals against the open escrow, then release.
    pair.ok(&label("lock"), t.lock(40_000_000, n(1), false), &[&t.payer]);
    pair.refused(
        &label("lock: same nonce again"),
        t.lock(1, n(1), false),
        &[&t.payer],
        0,
    );
    pair.refused(
        &label("claim before the claim window"),
        t.payout(n(1), &b, None),
        &[&t.payee],
        6027,
    );
    pair.refused(
        &label("settle by the payee, not metered"),
        t.payout(n(1), &b, Some(5)),
        &[&t.payee],
        6029,
    );
    pair.refused(
        &label("release by a stranger"),
        t.payout(n(1), &s, None),
        &[&t.stranger],
        6000,
    );
    pair.refused(
        &label("settle by a stranger"),
        t.payout(n(1), &s, Some(5)),
        &[&t.stranger],
        6000,
    );
    pair.refused(
        &label("release to a token account that was not recorded"),
        swap(t.payout(n(1), &a, None), 5, t.stranger_token),
        &[&t.payer],
        6023,
    );
    pair.refused(
        &label("release: fee to a token account the treasury does not own"),
        swap(t.payout(n(1), &a, None), 6, t.stranger_token),
        &[&t.payer],
        6030,
    );
    for (text, actual) in [("part", 5), ("all", 40_000_000)] {
        pair.refused(
            &label(&format!("settle by the payer, fixed price: {text}")),
            t.payout(n(1), &a, Some(actual)),
            &[&t.payer],
            6000,
        );
    }
    pair.refused(
        &label("release: refund account is the destination"),
        swap(t.payout(n(1), &a, None), 7, t.recipient),
        &[&t.payer],
        2040,
    );
    pair.refused(
        &label("release: a token account that is not the vault"),
        swap(t.payout(n(1), &a, None), 1, t.spare),
        &[&t.payer],
        2006,
    );
    pair.refused(
        &label("release: another mint"),
        swap(t.payout(n(1), &a, None), 4, t.source),
        &[&t.payer],
        3003,
    );
    pair.refused(
        &label("refund before the cancel window"),
        t.cancel(n(1), &a, t.source),
        &[&t.payer],
        6006,
    );
    pair.refused(
        &label("refund by a stranger"),
        t.cancel(n(1), &s, t.source),
        &[&t.stranger],
        6000,
    );
    pair.refused(
        &label("decline to an account other than the source"),
        t.cancel(n(1), &b, t.spare),
        &[&t.payee],
        6023,
    );
    // Accounts the token program owns but has never initialised. The two
    // builds must refuse these with the same error and leave the same state.
    let blank = Pubkey::new_from_array([105; 32]);
    let blank_len = pair.anchor.get_account(&t.spare).unwrap().data.len();
    pair.set(
        blank,
        Account {
            lamports: 10_000_000,
            data: vec![0u8; blank_len],
            owner: t.program,
            ..Account::default()
        },
    );
    for (what, index) in [
        ("destination", 5),
        ("mint", 4),
        ("vault", 1),
        ("fee", 6),
        ("refund", 7),
    ] {
        assert!(!pair.send(
            &label(&format!("release: blank token account as the {what}")),
            &[swap(t.payout(n(1), &a, None), index, blank)],
            &[&t.payer],
        ));
    }
    for (what, index) in [("recipient", 6), ("source", 5), ("mint", 4)] {
        assert!(!pair.send(
            &label(&format!("lock: blank token account as the {what}")),
            &[swap(t.lock(1_000, n(200), false), index, blank)],
            &[&t.payer],
        ));
    }
    pair.ok(
        &label("release by payer"),
        t.payout(n(1), &a, None),
        &[&t.payer],
    );
    pair.refused(
        &label("release: already settled"),
        t.payout(n(1), &a, None),
        &[&t.payer],
        3012,
    );

    // Metered lock and settle at actual cost.
    pair.ok(
        &label("metered lock"),
        t.lock(50_000_000, n(2), true),
        &[&t.payer],
    );
    for (text, actual) in [("zero", 0), ("above the maximum", 50_000_001)] {
        pair.refused(
            &label(&format!("settle: {text}")),
            t.payout(n(2), &b, Some(actual)),
            &[&t.payee],
            6028,
        );
    }
    pair.refused(
        &label("settle by the payer, metered"),
        t.payout(n(2), &a, Some(5)),
        &[&t.payer],
        6000,
    );
    pair.refused(
        &label("settle: refund to a stranger's token account"),
        swap(t.payout(n(2), &b, Some(5)), 7, t.stranger_token),
        &[&t.payee],
        6023,
    );
    pair.ok(
        &label("settle by payee at actual cost"),
        t.payout(n(2), &b, Some(12_345_678)),
        &[&t.payee],
    );
    pair.ok(
        &label("metered lock"),
        t.lock(50_000_000, n(3), true),
        &[&t.payer],
    );
    pair.ok(
        &label("settle by payee, refund to a spare account"),
        swap(t.payout(n(3), &b, Some(41)), 7, t.spare),
        &[&t.payee],
    );
    pair.ok(&label("lock"), t.lock(1_000_000, n(4), true), &[&t.payer]);
    pair.ok(
        &label("settle by payee at the full maximum"),
        t.payout(n(4), &b, Some(1_000_000)),
        &[&t.payee],
    );

    // Nothing goes back on a full payout, so the refund account need not be
    // the payer's. With a donation in the vault something does, and it must.
    pair.ok(&label("lock"), t.lock(1_000_000, n(11), false), &[&t.payer]);
    pair.ok(
        &label("release: nothing to refund, refund account is a stranger's"),
        swap(t.payout(n(11), &a, None), 7, t.stranger_token),
        &[&t.payer],
    );
    pair.ok(&label("lock"), t.lock(1_000_000, n(12), false), &[&t.payer]);
    pair.ok(
        &label("donate to the vault"),
        t.transfer(t.stranger_token, t.vault(n(12)), &s, 1),
        &[&t.stranger],
    );
    pair.refused(
        &label("release: a donation to refund, refund account is a stranger's"),
        swap(t.payout(n(12), &a, None), 7, t.stranger_token),
        &[&t.payer],
        6023,
    );
    pair.ok(
        &label("release after a donation"),
        t.payout(n(12), &a, None),
        &[&t.payer],
    );

    // A donation to the vault is swept on settlement.
    pair.ok(
        &label("lock at the cap"),
        t.lock(MAX_TOKEN_ESCROW_BASE_UNITS, n(5), false),
        &[&t.payer],
    );
    pair.ok(
        &label("donation to the vault"),
        t.transfer(t.stranger_token, t.vault(n(5)), &s, 777),
        &[&t.stranger],
    );
    pair.ok(
        &label("release after a donation"),
        t.payout(n(5), &a, None),
        &[&t.payer],
    );
    pair.ok(&label("lock"), t.lock(2_000_000, n(6), false), &[&t.payer]);
    pair.ok(
        &label("donation to the vault"),
        t.transfer(t.stranger_token, t.vault(n(6)), &s, 5),
        &[&t.stranger],
    );
    pair.ok(
        &label("decline by payee"),
        t.cancel(n(6), &b, t.source),
        &[&t.payee],
    );

    // Time-gated endings.
    pair.ok(&label("lock"), t.lock(3_000_000, n(7), false), &[&t.payer]);
    pair.ok(&label("lock"), t.lock(4_000_000, n(8), false), &[&t.payer]);
    let locked_at = pair.slot();
    pair.warp(locked_at + CLAIM_WINDOW_SLOTS - 1);
    pair.refused(
        &label("claim one slot early"),
        t.payout(n(8), &b, None),
        &[&t.payee],
        6027,
    );
    pair.warp(locked_at + CLAIM_WINDOW_SLOTS);
    pair.refused(
        &label("refund once the claim window is open, before the refund window"),
        t.cancel(n(7), &a, t.source),
        &[&t.payer],
        6006,
    );
    pair.ok(
        &label("claim by payee after the window"),
        t.payout(n(8), &b, None),
        &[&t.payee],
    );
    pair.warp(locked_at + CANCEL_WINDOW_SLOTS - 1);
    pair.refused(
        &label("refund one slot early"),
        t.cancel(n(7), &a, t.source),
        &[&t.payer],
        6006,
    );
    pair.warp(locked_at + CANCEL_WINDOW_SLOTS);
    pair.refused(
        &label("refund to a stranger's token account"),
        t.cancel(n(7), &a, t.stranger_token),
        &[&t.payer],
        6023,
    );
    pair.ok(
        &label("refund by payer to a spare account"),
        t.cancel(n(7), &a, t.spare),
        &[&t.payer],
    );

    // Windows are named at lock, per escrow.
    let max = escrow::MAX_ESCROW_WINDOW_SLOTS;
    for (text, claim, cancel) in [
        ("no claim window", 0, 10),
        ("claim after the refund", 11, 10),
        ("refund window above the maximum", 1, max + 1),
    ] {
        pair.refused(
            &label(&format!("lock: {text}")),
            t.lock_windows(n(13), false, claim, cancel),
            &[&t.payer],
            6031,
        );
    }
    pair.ok(
        &label("lock with the widest windows"),
        t.lock_windows(n(13), true, 1, max),
        &[&t.payer],
    );
    pair.ok(
        &label("lock, claim in ten seconds, refund in a hundred"),
        t.lock_windows(n(14), false, 25, 250),
        &[&t.payer],
    );
    let locked_at = pair.slot();
    pair.warp(locked_at + 24);
    pair.refused(
        &label("short window: claim one slot early"),
        t.payout(n(14), &b, None),
        &[&t.payee],
        6027,
    );
    pair.warp(locked_at + 25);
    pair.refused(
        &label("short window: refund before its own later window"),
        t.cancel(n(14), &a, t.source),
        &[&t.payer],
        6006,
    );
    pair.ok(
        &label("short window: claim"),
        t.payout(n(14), &b, None),
        &[&t.payee],
    );

    // Refused locks.
    pair.refused(
        &label("lock: zero"),
        t.lock(0, n(9), false),
        &[&t.payer],
        6004,
    );
    pair.refused(
        &label("lock: above the cap"),
        t.lock(MAX_TOKEN_ESCROW_BASE_UNITS + 1, n(9), false),
        &[&t.payer],
        6025,
    );
    pair.refused(
        &label("lock: source owned by someone else"),
        swap(t.lock(1, n(9), false), 5, t.stranger_token),
        &[&t.payer],
        6023,
    );
    pair.refused(
        &label("lock: recipient not owned by the payee"),
        swap(t.lock(1, n(9), false), 6, t.spare),
        &[&t.payer],
        6023,
    );
    pair.refused(
        &label("lock: payer as payee"),
        swap(swap(t.lock(1, n(9), false), 3, a), 6, t.spare),
        &[&t.payer],
        6007,
    );
    // Tokens paid to an account the escrow or its vault owns could never move.
    for (what, owner) in [("escrow", t.escrow(n(9))), ("vault", t.vault(n(9)))] {
        let recipient = Pubkey::new_unique();
        t.put_account(pair, recipient, &owner, 0);
        pair.refused(
            &label(&format!("lock: the {what} as payee")),
            swap(swap(t.lock(1, n(9), false), 3, owner), 6, recipient),
            &[&t.payer],
            6007,
        );
    }
    pair.refused(
        &label("lock: vault address of another escrow"),
        swap(t.lock(1, n(9), false), 1, t.vault(n(10))),
        &[&t.payer],
        2006,
    );
    pair.refused(
        &label("lock: not a token program"),
        swap(t.lock(1, n(9), false), 7, system_program::id()),
        &[&t.payer],
        3008,
    );

    // A frozen recipient or source refuses the lock.
    for (what, address) in [("recipient", t.recipient), ("source", t.source)] {
        t.set_frozen(pair, address, true);
        pair.refused(
            &label(&format!("lock: frozen {what}")),
            t.lock(1_000, n(60), what == "source"),
            &[&t.payer],
            6023,
        );
        t.set_frozen(pair, address, false);
    }

    // The payee's own claim or settle may go to any token account of the mint
    // that the payee owns; the payer's release only to the recorded recipient.
    let other = Pubkey::new_unique();
    t.put_account(pair, other, &b, 0);
    pair.ok(
        &label("lock for a redirected claim"),
        t.lock(1_000_000, n(60), false),
        &[&t.payer],
    );
    pair.ok(
        &label("metered lock for a redirected settle"),
        t.lock(1_000_000, n(61), true),
        &[&t.payer],
    );
    let locked_at = pair.slot();
    t.set_frozen(pair, t.recipient, true);
    pair.refused(
        &label("release: the payer names another account of the payee"),
        swap(t.payout(n(60), &a, None), 5, other),
        &[&t.payer],
        6023,
    );
    pair.refused(
        &label("settle: the payee names a stranger's account"),
        swap(t.payout(n(61), &b, Some(400_000)), 5, t.stranger_token),
        &[&t.payee],
        6023,
    );
    pair.refused(
        &label("settle: the payee names the treasury's account"),
        swap(t.payout(n(61), &b, Some(400_000)), 5, t.treasury_token),
        &[&t.payee],
        2040,
    );
    pair.ok(
        &label("settle to another account of the payee, recorded one frozen"),
        swap(t.payout(n(61), &b, Some(400_000)), 5, other),
        &[&t.payee],
    );
    pair.warp(locked_at + CLAIM_WINDOW_SLOTS);
    pair.ok(
        &label("claim to another account of the payee, recorded one frozen"),
        swap(t.payout(n(60), &b, None), 5, other),
        &[&t.payee],
    );
    t.set_frozen(pair, t.recipient, false);
}

#[test]
fn usdc_escrow_matches_the_anchor_build() {
    let mut pair = Pair::new();
    let tokens = Tokens::install(&mut pair, spl_token::ID, USDC_MAINNET_MINT, 6);
    token_rail(&mut pair, &tokens, "usdc");
    pair.report("Token escrow, classic SPL Token (USDC)");
}

#[test]
fn audd_escrow_matches_the_anchor_build() {
    let mut pair = Pair::new();
    let tokens = Tokens::install(&mut pair, spl_token::ID, AUDD_MAINNET_MINT, 6);
    token_rail(&mut pair, &tokens, "audd");
    pair.report("Token escrow, classic SPL Token (AUDD)");
}

#[test]
fn pyusd_escrow_matches_the_anchor_build() {
    let mut pair = Pair::new();
    let tokens = Tokens::install(&mut pair, TOKEN_2022_ID, PYUSD_MAINNET_MINT, 6);
    token_rail(&mut pair, &tokens, "pyusd");
    pair.report("Token escrow, Token-2022 (PYUSD)");
}

#[test]
fn usdg_escrow_matches_the_anchor_build() {
    let mut pair = Pair::new();
    let tokens = Tokens::install(&mut pair, TOKEN_2022_ID, USDG_MAINNET_MINT, 6);
    token_rail(&mut pair, &tokens, "usdg");
    pair.report("Token escrow, Token-2022 (USDG)");
}

#[test]
fn mints_off_the_allowlist_are_refused_the_same_way() {
    let n = [1; 16];
    // Not on the allowlist at all; devnet USDC in a default (mainnet) build;
    // an allowlisted address with the wrong decimals; an allowlisted
    // Token-2022 address holding a classic mint, and the reverse.
    for (program, mint, decimals) in [
        (spl_token::ID, Pubkey::new_from_array([200; 32]), 6),
        (spl_token::ID, USDC_DEVNET_MINT, 6),
        (spl_token::ID, USDC_MAINNET_MINT, 9),
        (spl_token::ID, PYUSD_MAINNET_MINT, 6),
        (TOKEN_2022_ID, USDC_MAINNET_MINT, 6),
    ] {
        let mut pair = Pair::new();
        let tokens = Tokens::install(&mut pair, program, mint, decimals);
        pair.refused(
            &format!("lock of mint {mint} under {program}"),
            tokens.lock(1_000, n, false),
            &[&tokens.payer],
            6026,
        );
    }
    // The mint is allowlisted for one token program and the call names the other.
    let mut pair = Pair::new();
    let tokens = Tokens::install(&mut pair, spl_token::ID, USDC_MAINNET_MINT, 6);
    pair.refused(
        "lock naming the other token program",
        swap(tokens.lock(1_000, n, false), 7, TOKEN_2022_ID),
        &[&tokens.payer],
        6023,
    );
}

/// Token-2022 only: the issuer can switch on a transfer fee or take tokens
/// from a vault. Both builds must settle what is left the same way.
#[test]
fn issuer_actions_on_token_2022_are_handled_the_same_way() {
    let mut pair = Pair::new();
    let t = Tokens::install(&mut pair, TOKEN_2022_ID, PYUSD_MAINNET_MINT, 6);
    let (a, b) = (t.payer.pubkey(), t.payee.pubkey());
    let n = |i: u8| [i; 16];
    for i in [1, 2, 3, 4, 6, 7, 8] {
        pair.ok(
            "pyusd lock",
            t.lock(10_000_000, n(i), i % 2 == 0),
            &[&t.payer],
        );
    }

    // The vault lost tokens (a permanent delegate can take them).
    for i in [1, 2] {
        let mut vault = pair.anchor.get_account(&t.vault(n(i))).unwrap();
        vault.data[64..72].copy_from_slice(&6_000_000u64.to_le_bytes());
        pair.set(t.vault(n(i)), vault);
    }
    pair.ok(
        "pyusd release from a reduced vault",
        t.payout(n(1), &a, None),
        &[&t.payer],
    );
    pair.ok(
        "pyusd settle from a reduced vault",
        t.payout(n(2), &b, Some(9_000_000)),
        &[&t.payee],
    );

    // The issuer switched on a 1% transfer fee after the lock.
    let mut mint = pair.anchor.get_account(&t.mint).unwrap();
    let config = {
        let mut at = 166;
        loop {
            let kind = u16::from_le_bytes([mint.data[at], mint.data[at + 1]]);
            let len = usize::from(u16::from_le_bytes([mint.data[at + 2], mint.data[at + 3]]));
            if kind == 1 {
                break at + 4;
            }
            at += 4 + len;
        }
    };
    for record in [config + 72, config + 90] {
        mint.data[record..record + 8].copy_from_slice(&0u64.to_le_bytes());
        mint.data[record + 8..record + 16].copy_from_slice(&u64::MAX.to_le_bytes());
        mint.data[record + 16..record + 18].copy_from_slice(&100u16.to_le_bytes());
    }
    pair.set(t.mint, mint);
    pair.refused(
        "pyusd lock while a transfer fee is charged",
        t.lock(1_000_000, n(5), false),
        &[&t.payer],
        6024,
    );
    pair.ok(
        "pyusd settle under a transfer fee",
        t.payout(n(4), &b, Some(2_500_000)),
        &[&t.payee],
    );
    pair.ok(
        "pyusd decline under a transfer fee",
        t.cancel(n(3), &b, t.source),
        &[&t.payee],
    );

    // Tokens sent to a vault under the fee leave withheld fees on it, which
    // block closing it. With the mint passed writable they are harvested to
    // the mint and the vault closes; without, the vault is left open.
    for i in [6, 7, 8] {
        pair.ok(
            "pyusd donation to a vault under a transfer fee",
            t.transfer(t.source, t.vault(n(i)), &a, 100_000),
            &[&t.payer],
        );
    }
    let writable_mint = |mut ix: Instruction, index: usize| {
        assert_eq!(ix.accounts[index].pubkey, t.mint);
        ix.accounts[index].is_writable = true;
        ix
    };
    pair.ok(
        "pyusd settle with withheld fees on the vault, mint writable",
        writable_mint(t.payout(n(6), &b, Some(2_500_000)), 4),
        &[&t.payee],
    );
    pair.ok(
        "pyusd decline with withheld fees on the vault, mint writable",
        writable_mint(t.cancel(n(7), &b, t.source), 4),
        &[&t.payee],
    );
    pair.ok(
        "pyusd settle with withheld fees on the vault, mint read-only",
        t.payout(n(8), &b, Some(2_500_000)),
        &[&t.payee],
    );
    for (i, closed) in [(6, true), (7, true), (8, false)] {
        for svm in [&pair.anchor, &pair.pinocchio] {
            let vault = svm.get_account(&t.vault(n(i)));
            assert_eq!(
                vault.is_none_or(|a| a.lamports == 0),
                closed,
                "vault {i} closed"
            );
        }
    }
    pair.report("Token-2022 issuer actions");
}

// ── Extended build: ratings, attestations, PER ──────────────────────────────

#[cfg(feature = "extended")]
mod extended {
    use {
        super::*,
        escrow::{state::RatingRole, RATING_EXPIRE_SLOTS},
        sha2::{Digest, Sha256},
    };

    fn rating(job: [u8; 16]) -> Pubkey {
        Pubkey::find_program_address(&[b"rating", &job], &escrow::id()).0
    }

    fn attestation(job: [u8; 16]) -> Pubkey {
        Pubkey::find_program_address(&[b"attestation", &job], &escrow::id()).0
    }

    fn commitment(score: u8, salt: [u8; 32]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update([score]);
        hasher.update(salt);
        hasher.finalize().into()
    }

    fn commit(
        signer: &Pubkey,
        job: [u8; 16],
        commitment: [u8; 32],
        role: RatingRole,
        consumer: &Pubkey,
        specialist: &Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::CommitRating {
                job_id: job,
                commitment,
                role,
                consumer_pk: *consumer,
                specialist_pk: *specialist,
            }
            .data(),
            accounts::CommitRating {
                rating: rating(job),
                signer: *signer,
                system_program: system_program::id(),
            }
            .to_account_metas(None),
        )
    }

    fn reveal(
        signer: &Pubkey,
        job: [u8; 16],
        score: u8,
        salt: [u8; 32],
        consumer: &Pubkey,
        specialist: &Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::RevealRating {
                job_id: job,
                score,
                salt,
            }
            .data(),
            accounts::RevealRating {
                rating: rating(job),
                signer: *signer,
                specialist_agent: agent(specialist),
                consumer_agent: agent(consumer),
            }
            .to_account_metas(None),
        )
    }

    fn expire(
        caller: &Pubkey,
        job: [u8; 16],
        consumer: &Pubkey,
        specialist: &Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::ExpireRating { job_id: job }.data(),
            accounts::ExpireRating {
                rating: rating(job),
                caller: *caller,
                specialist_agent: agent(specialist),
                consumer_agent: agent(consumer),
            }
            .to_account_metas(None),
        )
    }

    fn read_only(mut ix: Instruction, index: usize) -> Instruction {
        ix.accounts[index].is_writable = false;
        ix
    }

    /// The same call with other instruction data after the selector.
    fn with_args(mut ix: Instruction, args: &[u8]) -> Instruction {
        ix.data.truncate(8);
        ix.data.extend_from_slice(args);
        ix
    }

    fn burn_account(pair: &mut Pair) {
        pair.set(
            AGENT_FEE_BURN_ADDRESS,
            Account {
                lamports: 1_000_000,
                ..Account::default()
            },
        );
    }

    #[test]
    fn ratings_match_the_anchor_build() {
        let mut pair = Pair::new();
        burn_account(&mut pair);
        let (consumer, specialist, stranger, loner) = (
            key_funded(&mut pair, 1),
            key_funded(&mut pair, 2),
            key_funded(&mut pair, 3),
            key_funded(&mut pair, 4),
        );
        let (c, s, x, l) = (
            consumer.pubkey(),
            specialist.pubkey(),
            stranger.pubkey(),
            loner.pubkey(),
        );
        pair.warp(1_000);
        for (who, model) in [(&consumer, "buyer"), (&specialist, "seller"), (&loner, "")] {
            pair.ok(
                "register",
                register(&who.pubkey(), AgentType::Primary, model, 1, 0),
                &[who],
            );
        }
        let j = |i: u8| [i; 16];
        let (c_salt, s_salt) = ([7u8; 32], [9u8; 32]);
        let (c_hash, s_hash) = (commitment(8, c_salt), commitment(3, s_salt));

        // The simulator's clock starts at Unix time zero. A rating created
        // then has no creation time, so the next commitment records the
        // parties again, from its own arguments. A real cluster never reports
        // time zero; the two builds must still agree on it.
        pair.ok(
            "time zero: commit by consumer",
            commit(&c, j(99), c_hash, RatingRole::Consumer, &c, &s),
            &[&consumer],
        );
        pair.ok(
            "time zero: a stranger commits, naming itself specialist",
            commit(&x, j(99), s_hash, RatingRole::Specialist, &c, &x),
            &[&stranger],
        );
        pair.set_time(1_795_000_000);

        // Job 1: both commit, both reveal.
        pair.refused(
            "commit: rating at another address",
            swap(
                commit(&c, j(1), c_hash, RatingRole::Consumer, &c, &s),
                0,
                rating(j(2)),
            ),
            &[&consumer],
            2006,
        );
        pair.refused(
            "commit by a stranger as the consumer",
            commit(&x, j(1), c_hash, RatingRole::Consumer, &c, &s),
            &[&stranger],
            6000,
        );
        pair.refused(
            "commit: unknown role",
            {
                let mut ix = commit(&c, j(1), c_hash, RatingRole::Consumer, &c, &s);
                ix.data[8 + 16 + 32] = 2;
                ix
            },
            &[&consumer],
            102,
        );
        pair.refused(
            "commit: arguments cut short",
            {
                let mut ix = commit(&c, j(1), c_hash, RatingRole::Consumer, &c, &s);
                ix.data.truncate(100);
                ix
            },
            &[&consumer],
            102,
        );
        pair.ok(
            "commit by consumer (creates the rating)",
            commit(&c, j(1), c_hash, RatingRole::Consumer, &c, &s),
            &[&consumer],
        );
        pair.refused(
            "commit by consumer again",
            commit(&c, j(1), s_hash, RatingRole::Consumer, &c, &s),
            &[&consumer],
            6010,
        );
        pair.refused(
            "commit by consumer in the specialist's role",
            commit(&c, j(1), s_hash, RatingRole::Specialist, &c, &s),
            &[&consumer],
            6000,
        );
        pair.refused(
            "commit by a stranger naming itself specialist",
            commit(&x, j(1), s_hash, RatingRole::Specialist, &c, &x),
            &[&stranger],
            6000,
        );
        pair.refused(
            "commit: rating not writable",
            read_only(commit(&s, j(1), s_hash, RatingRole::Specialist, &c, &s), 0),
            &[&specialist],
            2000,
        );
        pair.refused(
            "reveal before both committed",
            reveal(&c, j(1), 8, c_salt, &c, &s),
            &[&consumer],
            6011,
        );
        pair.refused(
            "expire before the period",
            expire(&x, j(1), &c, &s),
            &[&stranger],
            6014,
        );
        pair.ok(
            "commit by specialist",
            commit(&s, j(1), s_hash, RatingRole::Specialist, &c, &s),
            &[&specialist],
        );
        pair.refused(
            "expire once both committed",
            expire(&x, j(1), &c, &s),
            &[&stranger],
            6015,
        );
        for score in [0, 11] {
            pair.refused(
                "reveal: score out of range",
                reveal(&c, j(1), score, c_salt, &c, &s),
                &[&consumer],
                6013,
            );
        }
        pair.refused(
            "reveal: wrong salt",
            reveal(&c, j(1), 8, s_salt, &c, &s),
            &[&consumer],
            6012,
        );
        pair.refused(
            "reveal: wrong score",
            reveal(&c, j(1), 7, c_salt, &c, &s),
            &[&consumer],
            6012,
        );
        pair.refused(
            "reveal by a stranger",
            reveal(&x, j(1), 8, c_salt, &c, &s),
            &[&stranger],
            6000,
        );
        pair.refused(
            "reveal: another job's id",
            with_args(reveal(&c, j(1), 8, c_salt, &c, &s), &{
                let mut args = j(2).to_vec();
                args.push(8);
                args.extend_from_slice(&c_salt);
                args
            }),
            &[&consumer],
            2006,
        );
        pair.refused(
            "reveal: agents the wrong way round",
            reveal(&c, j(1), 8, c_salt, &s, &c),
            &[&consumer],
            2006,
        );
        pair.refused(
            "reveal: another party's agent",
            swap(reveal(&c, j(1), 8, c_salt, &c, &s), 2, agent(&l)),
            &[&consumer],
            2006,
        );
        pair.refused(
            "reveal: one agent for both parties",
            swap(reveal(&c, j(1), 8, c_salt, &c, &s), 2, agent(&c)),
            &[&consumer],
            2040,
        );
        pair.refused(
            "reveal: an agent that is not registered",
            swap(reveal(&c, j(1), 8, c_salt, &c, &s), 2, agent(&x)),
            &[&consumer],
            3012,
        );
        pair.refused(
            "reveal: the rating in an agent's place",
            swap(reveal(&c, j(1), 8, c_salt, &c, &s), 3, rating(j(1))),
            &[&consumer],
            3002,
        );
        for (index, what) in [
            (0, "rating"),
            (2, "specialist agent"),
            (3, "consumer agent"),
        ] {
            pair.refused(
                &format!("reveal: {what} not writable"),
                read_only(reveal(&c, j(1), 8, c_salt, &c, &s), index),
                &[&consumer],
                2000,
            );
        }
        pair.refused(
            "reveal: arguments cut short",
            with_args(reveal(&c, j(1), 8, c_salt, &c, &s), &[1; 40]),
            &[&consumer],
            102,
        );
        pair.ok(
            "reveal by consumer",
            reveal(&c, j(1), 8, c_salt, &c, &s),
            &[&consumer],
        );
        pair.ok(
            "reveal by consumer again",
            reveal(&c, j(1), 8, c_salt, &c, &s),
            &[&consumer],
        );
        pair.ok(
            "reveal by specialist (finalises)",
            reveal(&s, j(1), 3, s_salt, &c, &s),
            &[&specialist],
        );
        pair.refused(
            "reveal after both revealed",
            reveal(&c, j(1), 8, c_salt, &c, &s),
            &[&consumer],
            6011,
        );
        pair.refused(
            "commit after both revealed",
            commit(&c, j(1), c_hash, RatingRole::Consumer, &c, &s),
            &[&consumer],
            6015,
        );
        pair.refused(
            "expire after both revealed",
            expire(&c, j(1), &c, &s),
            &[&consumer],
            6015,
        );

        // More revealed jobs, so the rolling score moves through several values.
        for (job, from_consumer, from_specialist) in [(10, 10, 10), (11, 1, 10), (12, 10, 1)] {
            let (hc, hs) = (
                commitment(from_consumer, c_salt),
                commitment(from_specialist, s_salt),
            );
            // The specialist goes first here.
            pair.ok(
                "commit by specialist (creates the rating)",
                commit(&s, j(job), hs, RatingRole::Specialist, &c, &s),
                &[&specialist],
            );
            pair.ok(
                "commit by consumer",
                commit(&c, j(job), hc, RatingRole::Consumer, &c, &s),
                &[&consumer],
            );
            pair.ok(
                "reveal by specialist",
                reveal(&s, j(job), from_specialist, s_salt, &c, &s),
                &[&specialist],
            );
            pair.ok(
                "reveal by consumer (finalises)",
                reveal(&c, j(job), from_consumer, c_salt, &c, &s),
                &[&consumer],
            );
        }

        // Job 2: the specialist never commits. Job 3: the consumer never does.
        pair.ok(
            "commit by consumer only",
            commit(&c, j(2), c_hash, RatingRole::Consumer, &c, &s),
            &[&consumer],
        );
        pair.ok(
            "commit by specialist only",
            commit(&s, j(3), s_hash, RatingRole::Specialist, &c, &s),
            &[&specialist],
        );
        let created = pair.slot();
        pair.warp(created + RATING_EXPIRE_SLOTS - 1);
        pair.refused(
            "expire one slot early",
            expire(&x, j(2), &c, &s),
            &[&stranger],
            6014,
        );
        pair.warp(created + RATING_EXPIRE_SLOTS);
        pair.refused(
            "expire: caller did not sign",
            {
                let mut ix = expire(&x, j(2), &c, &s);
                ix.accounts[1].is_signer = false;
                ix
            },
            &[&consumer],
            3010,
        );
        pair.refused(
            "expire: one agent for both parties",
            swap(expire(&x, j(2), &c, &s), 3, agent(&s)),
            &[&stranger],
            2040,
        );
        pair.refused(
            "expire: another job's id",
            with_args(expire(&x, j(2), &c, &s), &j(3)),
            &[&stranger],
            2006,
        );
        pair.ok(
            "expire by a stranger (specialist was silent)",
            expire(&x, j(2), &c, &s),
            &[&stranger],
        );
        pair.refused("expire twice", expire(&x, j(2), &c, &s), &[&stranger], 6015);
        pair.refused(
            "commit after expiry",
            commit(&s, j(2), s_hash, RatingRole::Specialist, &c, &s),
            &[&specialist],
            6015,
        );
        pair.ok(
            "expire by consumer (consumer was silent)",
            expire(&c, j(3), &c, &s),
            &[&consumer],
        );
        // Penalties repeat until the score is exhausted.
        for job in 20..28 {
            pair.ok(
                "commit by consumer only",
                commit(&c, j(job), c_hash, RatingRole::Consumer, &c, &s),
                &[&consumer],
            );
        }
        let created = pair.slot();
        pair.warp(created + RATING_EXPIRE_SLOTS + 5);
        for job in 20..28 {
            pair.ok("expire", expire(&s, j(job), &c, &s), &[&specialist]);
        }

        // A rating address that already holds lamports can still be created.
        pair.set(
            rating(j(4)),
            Account {
                lamports: 5_000,
                ..Account::default()
            },
        );
        pair.ok(
            "commit at a prefunded address",
            commit(&c, j(4), c_hash, RatingRole::Consumer, &c, &s),
            &[&consumer],
        );
        // One wallet on both sides can commit twice but never reveal.
        pair.ok(
            "self-rating: commit as consumer",
            commit(&l, j(5), c_hash, RatingRole::Consumer, &l, &l),
            &[&loner],
        );
        pair.ok(
            "self-rating: commit as specialist",
            commit(&l, j(5), s_hash, RatingRole::Specialist, &l, &l),
            &[&loner],
        );
        pair.refused(
            "self-rating: reveal",
            reveal(&l, j(5), 8, c_salt, &l, &l),
            &[&loner],
            2040,
        );
        pair.report("Ratings");
    }

    fn attest(judge: &Pubkey, job: [u8; 16], scores: [u8; 5], consumer: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::AttestQuality {
                job_id: job,
                scores,
                consumer: *consumer,
            }
            .data(),
            accounts::AttestQuality {
                attestation: attestation(job),
                judge_agent: agent(judge),
                judge: *judge,
                system_program: system_program::id(),
            }
            .to_account_metas(None),
        )
    }

    fn resolve(consumer: &Pubkey, job: [u8; 16], judge: &Pubkey, confirm: bool) -> Instruction {
        if confirm {
            Instruction::new_with_bytes(
                escrow::id(),
                &instruction::ConfirmAttestation { job_id: job }.data(),
                accounts::ConfirmAttestation {
                    attestation: attestation(job),
                    judge_agent: agent(judge),
                    consumer: *consumer,
                }
                .to_account_metas(None),
            )
        } else {
            Instruction::new_with_bytes(
                escrow::id(),
                &instruction::DisputeAttestation { job_id: job }.data(),
                accounts::DisputeAttestation {
                    attestation: attestation(job),
                    judge_agent: agent(judge),
                    consumer: *consumer,
                }
                .to_account_metas(None),
            )
        }
    }

    #[test]
    fn attestations_match_the_anchor_build() {
        let mut pair = Pair::new();
        burn_account(&mut pair);
        let (judge, both, primary, consumer, stranger) = (
            key_funded(&mut pair, 1),
            key_funded(&mut pair, 2),
            key_funded(&mut pair, 3),
            key_funded(&mut pair, 4),
            key_funded(&mut pair, 5),
        );
        pair.fund(&judge, 100_000_000_000);
        let (g, b, p, c, x) = (
            judge.pubkey(),
            both.pubkey(),
            primary.pubkey(),
            consumer.pubkey(),
            stranger.pubkey(),
        );
        pair.warp(1_000);
        for (who, kind, model) in [
            (&judge, AgentType::Attestation, "judge"),
            (&both, AgentType::Both, &*"m".repeat(64)),
            (&primary, AgentType::Primary, ""),
        ] {
            pair.ok(
                "register",
                register(&who.pubkey(), kind, model, 1, 0),
                &[who],
            );
        }
        let j = |i: u8| [i; 16];
        let good = [10, 1, 5, 7, 9];

        pair.refused(
            "attest by a primary-only agent",
            attest(&p, j(1), good, &c),
            &[&primary],
            6016,
        );
        for bad in [[0, 5, 5, 5, 5], [5, 5, 5, 5, 11], [5, 5, 255, 5, 5]] {
            pair.refused(
                "attest: score out of range",
                attest(&g, j(1), bad, &c),
                &[&judge],
                6019,
            );
        }
        pair.refused(
            "attest: another agent's record",
            swap(attest(&g, j(1), good, &c), 1, agent(&b)),
            &[&judge],
            2006,
        );
        pair.refused(
            "attest by an unregistered wallet",
            attest(&x, j(1), good, &c),
            &[&stranger],
            3012,
        );
        pair.refused(
            "attest: attestation at another address",
            swap(attest(&g, j(1), good, &c), 0, attestation(j(2))),
            &[&judge],
            2006,
        );
        pair.refused(
            "attest: arguments cut short",
            with_args(attest(&g, j(1), good, &c), &[1; 30]),
            &[&judge],
            102,
        );
        pair.ok("attest", attest(&g, j(1), good, &c), &[&judge]);
        assert!(!pair.send(
            "attest the same job twice",
            &[attest(&b, j(1), good, &c)],
            &[&both],
        ));
        pair.refused(
            "confirm by a stranger",
            resolve(&x, j(1), &g, true),
            &[&stranger],
            6000,
        );
        pair.refused(
            "dispute by the judge",
            {
                let mut ix = resolve(&g, j(1), &g, false);
                ix.accounts[2].pubkey = g;
                ix
            },
            &[&judge],
            6000,
        );
        pair.refused(
            "confirm: another judge's record",
            resolve(&c, j(1), &b, true),
            &[&consumer],
            2006,
        );
        pair.refused(
            "confirm: another job's id",
            with_args(resolve(&c, j(1), &g, true), &j(2)),
            &[&consumer],
            2006,
        );
        pair.refused(
            "confirm: consumer did not sign",
            {
                let mut ix = resolve(&c, j(1), &g, true);
                ix.accounts[2].is_signer = false;
                ix
            },
            &[&stranger],
            3010,
        );
        for index in [0, 1] {
            pair.refused(
                "confirm: account not writable",
                read_only(resolve(&c, j(1), &g, true), index),
                &[&consumer],
                2000,
            );
        }
        pair.refused(
            "confirm: an attestation that does not exist",
            resolve(&c, j(9), &g, true),
            &[&consumer],
            3012,
        );
        pair.ok("confirm", resolve(&c, j(1), &g, true), &[&consumer]);
        pair.refused(
            "confirm twice",
            resolve(&c, j(1), &g, true),
            &[&consumer],
            6018,
        );
        pair.refused(
            "dispute after confirming",
            resolve(&c, j(1), &g, false),
            &[&consumer],
            6018,
        );
        pair.ok(
            "attest by a both-type agent",
            attest(&b, j(2), good, &c),
            &[&both],
        );
        pair.ok("dispute", resolve(&c, j(2), &b, false), &[&consumer]);
        pair.refused(
            "confirm after disputing",
            resolve(&c, j(2), &b, true),
            &[&consumer],
            6018,
        );
        // Enough confirmations to reach the top of both scores, then disputes
        // back down.
        for job in 20..34 {
            pair.ok("attest", attest(&g, j(job), [10; 5], &c), &[&judge]);
            pair.ok("confirm", resolve(&c, j(job), &g, true), &[&consumer]);
        }
        for job in 40..44 {
            pair.ok("attest", attest(&g, j(job), [1; 5], &c), &[&judge]);
            pair.ok("dispute", resolve(&c, j(job), &g, false), &[&consumer]);
        }
        pair.report("Attestations");
    }

    fn delegate(payer: &Pubkey, nonce: [u8; 16], session: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::DelegateEscrow {
                session_key: *session,
            }
            .data(),
            accounts::DelegateEscrow {
                escrow: sol_escrow(payer, nonce),
                payer: *payer,
            }
            .to_account_metas(None),
        )
    }

    fn release_per(
        payer: &Pubkey,
        payee: &Pubkey,
        nonce: [u8; 16],
        session: &Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::ReleaseEscrowPer {
                session_key: *session,
            }
            .data(),
            accounts::ReleaseEscrowPer {
                escrow: sol_escrow(payer, nonce),
                payer: *payer,
                payee: *payee,
                system_program: system_program::id(),
            }
            .to_account_metas(None),
        )
    }

    #[test]
    fn per_tracking_matches_the_anchor_build() {
        let mut pair = Pair::new();
        let (payer, payee, stranger) = (
            key_funded(&mut pair, 1),
            key_funded(&mut pair, 2),
            key_funded(&mut pair, 3),
        );
        pair.fund(&payer, 20_000_000_000);
        pair.set(
            PROTOCOL_TREASURY,
            Account {
                lamports: 1_000_000,
                ..Account::default()
            },
        );
        let (a, b, x) = (payer.pubkey(), payee.pubkey(), stranger.pubkey());
        let n = |i: u8| [i; 16];
        // Keys with and without leading zero bytes, to exercise how they print.
        let session = Pubkey::new_from_array([0xAB; 32]);
        let zeros = Pubkey::new_from_array([0; 32]);
        let mut leading = [0xFF; 32];
        leading[..3].fill(0);
        let leading = Pubkey::new_from_array(leading);

        for (nonce, metered) in [
            (1, false),
            (2, false),
            (3, true),
            (4, false),
            (5, false),
            (6, false),
            (7, true),
        ] {
            pair.ok(
                "sol lock",
                sol_lock(&a, &b, 300_000_000, n(nonce), metered),
                &[&payer],
            );
        }
        pair.refused(
            "release via PER before delegating",
            release_per(&a, &b, n(1), &session),
            &[&payer],
            6020,
        );
        pair.refused(
            "delegate by a stranger",
            delegate(&x, n(1), &session),
            &[&stranger],
            3012,
        );
        pair.refused(
            "delegate: a stranger as payer of the payer's escrow",
            swap(delegate(&x, n(1), &session), 0, sol_escrow(&a, n(1))),
            &[&stranger],
            2006,
        );
        pair.refused(
            "delegate: payer did not sign",
            {
                let mut ix = delegate(&a, n(1), &session);
                ix.accounts[1].is_signer = false;
                ix
            },
            &[&stranger],
            3010,
        );
        pair.refused(
            "delegate: escrow not writable",
            read_only(delegate(&a, n(1), &session), 0),
            &[&payer],
            2000,
        );
        pair.refused(
            "delegate: arguments cut short",
            with_args(delegate(&a, n(1), &session), &[1; 31]),
            &[&payer],
            102,
        );
        pair.ok("delegate", delegate(&a, n(1), &session), &[&payer]);
        pair.refused(
            "delegate twice",
            delegate(&a, n(1), &leading),
            &[&payer],
            6022,
        );
        pair.refused(
            "release via PER: wrong session key",
            release_per(&a, &b, n(1), &leading),
            &[&payer],
            6021,
        );
        pair.refused(
            "release via PER: another payee",
            release_per(&a, &x, n(1), &session),
            &[&payer],
            2001,
        );
        pair.refused(
            "release via PER by the payee",
            {
                let mut ix = release_per(&a, &b, n(1), &session);
                ix.accounts[1].is_signer = false;
                ix.accounts[2].is_signer = true;
                ix
            },
            &[&payee],
            3010,
        );
        pair.refused(
            "release via PER: a stranger as payer",
            swap(release_per(&a, &b, n(1), &session), 1, x),
            &[&stranger],
            2006,
        );
        pair.refused(
            "release via PER: not the system program",
            swap(release_per(&a, &b, n(1), &session), 3, x),
            &[&payer],
            3008,
        );
        for index in [0, 2] {
            pair.refused(
                "release via PER: account not writable",
                read_only(release_per(&a, &b, n(1), &session), index),
                &[&payer],
                2000,
            );
        }
        pair.ok(
            "release via PER",
            release_per(&a, &b, n(1), &session),
            &[&payer],
        );
        pair.refused(
            "release via PER twice",
            release_per(&a, &b, n(1), &session),
            &[&payer],
            3012,
        );

        // A delegated escrow still answers to the ordinary instructions.
        pair.ok(
            "delegate (all-zero key)",
            delegate(&a, n(2), &zeros),
            &[&payer],
        );
        pair.ok(
            "ordinary release of a delegated escrow",
            sol_payout(&a, &b, n(2), &a, None),
            &[&payer],
        );
        pair.ok(
            "delegate a metered escrow",
            delegate(&a, n(3), &leading),
            &[&payer],
        );
        pair.ok(
            "payee settles a delegated metered escrow",
            sol_payout(&a, &b, n(3), &b, Some(120_000_000)),
            &[&payee],
        );
        pair.ok("delegate", delegate(&a, n(4), &leading), &[&payer]);
        pair.refused(
            "payee settles a delegated escrow that is not metered",
            sol_payout(&a, &b, n(4), &b, Some(1_000)),
            &[&payee],
            6029,
        );
        pair.ok(
            "payee declines a delegated escrow",
            sol_cancel(&a, n(4), &b),
            &[&payee],
        );
        pair.ok("delegate", delegate(&a, n(5), &session), &[&payer]);
        pair.ok(
            "release via PER (all-zero key recorded elsewhere)",
            release_per(&a, &b, n(5), &session),
            &[&payer],
        );
        pair.ok(
            "delegate (all-zero key)",
            delegate(&a, n(6), &zeros),
            &[&payer],
        );
        pair.ok(
            "release via PER with the all-zero key",
            release_per(&a, &b, n(6), &zeros),
            &[&payer],
        );
        pair.ok(
            "delegate a metered escrow",
            delegate(&a, n(7), &session),
            &[&payer],
        );
        pair.ok(
            "release via PER of a metered escrow",
            release_per(&a, &b, n(7), &session),
            &[&payer],
        );
        pair.report("PER tracking");
    }
}
