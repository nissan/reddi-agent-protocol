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
        AGENT_FEE_BURN_ADDRESS, AUDD_MAINNET_MINT, CANCEL_WINDOW_SLOTS, CLAIM_WINDOW_SLOTS,
        MAX_SOL_ESCROW_LAMPORTS, MAX_TOKEN_ESCROW_BASE_UNITS, PROTOCOL_TREASURY,
        PYUSD_MAINNET_MINT, USDC_DEVNET_MINT, USDC_MAINNET_MINT, USDG_MAINNET_MINT,
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
    let error_log = meta.logs.iter().find_map(|line| {
        line.split_once("Error Code: ")
            .map(|(_, rest)| rest.to_string())
    });
    (
        Observed {
            error,
            error_log,
            events,
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
        let (probe, _) = observe(&mut self.anchor.clone(), &[ix.clone()], signers);
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
        instruction::LockMeteredEscrow { amount, nonce }.data()
    } else {
        instruction::LockEscrow { amount, nonce }.data()
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

    // Payer settles part of a fixed-price escrow, and all of another.
    pair.ok(
        "sol lock",
        sol_lock(&a, &b, 100_000_000, n(3), false),
        &[&payer],
    );
    pair.ok(
        "sol partial settle by payer",
        sol_payout(&a, &b, n(3), &a, Some(39)),
        &[&payer],
    );
    pair.ok(
        "sol lock",
        sol_lock(&a, &b, 100_000_000, n(4), false),
        &[&payer],
    );
    pair.ok(
        "sol full settle by payer",
        sol_payout(&a, &b, n(4), &a, Some(100_000_000)),
        &[&payer],
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
    pair.warp(locked_at + CLAIM_WINDOW_SLOTS - 1);
    pair.refused(
        "sol claim one slot early",
        sol_payout(&a, &b, n(7), &b, None),
        &[&payee],
        6027,
    );
    pair.warp(locked_at + CLAIM_WINDOW_SLOTS);
    pair.ok(
        "sol claim by payee after the window",
        sol_payout(&a, &b, n(7), &b, None),
        &[&payee],
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
    let lock = sol_lock(&a, &key(2).pubkey(), 1_000, [1; 16], false);
    pair.refused(
        "lock with truncated arguments",
        raw(lock.data[..20].to_vec(), lock.accounts.clone()),
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
            let mut data = PYUSD_MINT_FIXTURE.to_vec();
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

    fn lock(&self, amount: u64, nonce: [u8; 16], metered: bool) -> Instruction {
        let data = if metered {
            instruction::LockMeteredTokenEscrow { amount, nonce }.data()
        } else {
            instruction::LockTokenEscrow { amount, nonce }.data()
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
    pair.refused(
        &label("release: refund to a stranger's token account"),
        swap(t.payout(n(1), &a, None), 7, t.stranger_token),
        &[&t.payer],
        6023,
    );
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
    pair.ok(&label("lock"), t.lock(1_000_000, n(4), false), &[&t.payer]);
    pair.ok(
        &label("full settle by payer"),
        t.payout(n(4), &a, Some(1_000_000)),
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
    pair.warp(locked_at + CLAIM_WINDOW_SLOTS - 1);
    pair.refused(
        &label("claim one slot early"),
        t.payout(n(8), &b, None),
        &[&t.payee],
        6027,
    );
    pair.warp(locked_at + CLAIM_WINDOW_SLOTS);
    pair.ok(
        &label("claim by payee after the window"),
        t.payout(n(8), &b, None),
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
    for i in 1..=4 {
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
    pair.report("Token-2022 issuer actions");
}
