//! Shared harness for the tests written for this program (ratings,
//! attestations, rated escrows): one simulator holding the built Pinocchio
//! binary, instruction builders for the instructions the Anchor IDL does not
//! cover, and readers for the two account layouts they use.
//!
//! Every transaction sent through [`World::send`] is also checked for lamport
//! conservation: the lamports of all accounts the test has touched add up to
//! the same total before and after, less the transaction fee.
#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::{AccountMeta, Pubkey},
        solana_program::{instruction::Instruction, program_pack::Pack, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    escrow::{
        accounts, instruction,
        state::{AgentAccount, AgentType},
        token_accounts::TOKEN_2022_ID,
        AGENT_FEE_BURN_ADDRESS, PROTOCOL_TREASURY, USDG_MAINNET_MINT,
    },
    litesvm::LiteSVM,
    sha2::{Digest, Sha256},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    std::collections::BTreeSet,
};

pub const PINOCCHIO: &[u8] = include_bytes!("../../../target/deploy/pinocchio_escrow.so");
const PYUSD_MINT_FIXTURE: &[u8] = include_bytes!("../fixtures/pyusd_mainnet_mint_2026-11-20.bin");
const USDG_MINT_FIXTURE: &[u8] = include_bytes!("../fixtures/usdg_mainnet_mint_2026-11-21.bin");
const TOKEN_2022_ACCOUNT_LEN: usize = 183;
const LAMPORTS_PER_SIGNATURE: u64 = 5_000;

pub const CLAIM_WINDOW: u64 = escrow::DEFAULT_CLAIM_WINDOW_SLOTS;
pub const CANCEL_WINDOW: u64 = escrow::DEFAULT_CANCEL_WINDOW_SLOTS;
/// `RATING_COMMIT_SLOTS` and `RATING_REVEAL_SLOTS` of the program.
pub const RATING_COMMIT_SLOTS: u64 = 1_512_000;
pub const RATING_REVEAL_SLOTS: u64 = 1_512_000;
pub const RATING_EXPIRE_PENALTY: u16 = 500;

// Error numbers, as in `program/src/error.rs`.
pub const CONSTRAINT_MUT: u32 = 2000;
pub const CONSTRAINT_SEEDS: u32 = 2006;
pub const DUPLICATE_MUTABLE: u32 = 2040;
pub const DISCRIMINATOR_MISMATCH: u32 = 3002;
pub const NOT_ENOUGH_KEYS: u32 = 3005;
pub const WRONG_OWNER: u32 = 3007;
pub const INVALID_PROGRAM_ID: u32 = 3008;
pub const NOT_SIGNER: u32 = 3010;
pub const NOT_INITIALIZED: u32 = 3012;
pub const UNAUTHORISED_SIGNER: u32 = 6000;
pub const NOT_LOCKED: u32 = 6002;
pub const INVALID_PAYEE: u32 = 6007;
pub const ALREADY_COMMITTED: u32 = 6010;
pub const BOTH_MUST_COMMIT_FIRST: u32 = 6011;
pub const COMMITMENT_MISMATCH: u32 = 6012;
pub const INVALID_SCORE: u32 = 6013;
pub const NOT_EXPIRED: u32 = 6014;
pub const ALREADY_FINALISED: u32 = 6015;
pub const NOT_ATTESTATION_AGENT: u32 = 6016;
pub const ATTESTATION_ALREADY_RESOLVED: u32 = 6018;
pub const ATTESTATION_SCORE_OUT_OF_RANGE: u32 = 6019;
pub const INVALID_TREASURY: u32 = 6030;
pub const RATING_ACCOUNT_REQUIRED: u32 = 6033;
pub const INVALID_RATING_ACCOUNT: u32 = 6034;
pub const RATING_NOT_AWAITING_SETTLEMENT: u32 = 6035;
pub const RATING_OPT_IN_CLOSED: u32 = 6036;
pub const ALREADY_RATED: u32 = 6037;
pub const INVALID_JUDGE: u32 = 6038;
pub const JOB_NOT_PAID: u32 = 6039;
pub const COMMIT_DEADLINE_PASSED: u32 = 6040;
pub const REVEAL_DEADLINE_PASSED: u32 = 6041;
pub const ALREADY_REVEALED: u32 = 6042;
pub const EMPTY_COMMITMENT: u32 = 6043;
pub const RATING_NOT_FINAL: u32 = 6044;
pub const RATED_ESCROW_NOT_DELEGABLE: u32 = 6045;
pub const RATING_ALREADY_ACCEPTED: u32 = 6046;
pub const ATTESTATION_NOT_CLOSABLE: u32 = 6047;
pub const ALREADY_ATTESTED: u32 = 6048;
pub const JUDGE_NOT_ACTIVE: u32 = 6049;

pub const AWAITING_SETTLEMENT: u8 = 0;
pub const OPEN: u8 = 1;
pub const BOTH_COMMITTED: u8 = 2;
pub const REVEALED: u8 = 3;
pub const EXPIRED: u8 = 4;

pub fn key(seed: u8) -> Keypair {
    Keypair::new_from_array([seed; 32])
}

pub fn nonce(i: u8) -> [u8; 16] {
    [i; 16]
}

pub fn selector(name: &str) -> [u8; 8] {
    let digest = Sha256::digest(format!("global:{name}").as_bytes());
    digest[..8].try_into().unwrap()
}

pub fn account_discriminator(name: &str) -> [u8; 8] {
    let digest = Sha256::digest(format!("account:{name}").as_bytes());
    digest[..8].try_into().unwrap()
}

pub struct Sent {
    pub events: Vec<String>,
    pub logs: Vec<String>,
    pub compute_units: u64,
}

pub struct World {
    pub svm: LiteSVM,
    touched: BTreeSet<Pubkey>,
    /// (label, compute units) of successful calls sent with `ok`.
    pub compute: Vec<(String, u64)>,
}

impl World {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(escrow::id(), PINOCCHIO).unwrap();
        let mut world = Self {
            svm,
            touched: BTreeSet::new(),
            compute: Vec::new(),
        };
        // The treasury and the registration-fee burn address must already
        // hold their rent-exempt minimum to receive anything.
        for address in [PROTOCOL_TREASURY, AGENT_FEE_BURN_ADDRESS] {
            world.set(
                address,
                Account {
                    lamports: 1_000_000_000,
                    ..Account::default()
                },
            );
        }
        world
    }

    pub fn set(&mut self, address: Pubkey, account: Account) {
        self.touched.insert(address);
        self.svm.set_account(address, account).unwrap();
    }

    pub fn fund(&mut self, who: &Keypair, lamports: u64) {
        self.set(
            who.pubkey(),
            Account {
                lamports,
                ..Account::default()
            },
        );
    }

    /// A funded wallet with a fixed key.
    pub fn wallet(&mut self, seed: u8) -> Keypair {
        let keypair = key(seed);
        self.fund(&keypair, 10_000_000_000);
        keypair
    }

    pub fn slot(&self) -> u64 {
        self.svm.get_sysvar::<anchor_lang::prelude::Clock>().slot
    }

    pub fn warp(&mut self, slot: u64) {
        self.svm.warp_to_slot(slot);
    }

    pub fn lamports(&self, address: &Pubkey) -> u64 {
        self.svm
            .get_account(address)
            .map_or(0, |account| account.lamports)
    }

    pub fn data(&self, address: &Pubkey) -> Vec<u8> {
        self.svm
            .get_account(address)
            .map_or(Vec::new(), |account| account.data)
    }

    /// Whether anything is stored at `address`.
    pub fn exists(&self, address: &Pubkey) -> bool {
        self.svm
            .get_account(address)
            .is_some_and(|account| account.lamports > 0)
    }

    fn total(&self) -> u128 {
        self.touched
            .iter()
            .map(|address| u128::from(self.lamports(address)))
            .sum()
    }

    /// Send one transaction. `signers[0]` pays the fee.
    /// After a successful `open_rating` the world moves to the next slot.
    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<Sent, String> {
        let ixs: Vec<Instruction> = ixs.iter().map(|ix| self.resolve(ix)).collect();
        // Unrated exits built without their instance get it, as a client sends them.
        let ixs = &instance::bind(&mut self.svm, &ixs)[..];
        for ix in ixs {
            self.touched
                .extend(ix.accounts.iter().map(|meta| meta.pubkey));
        }
        self.touched
            .extend(signers.iter().map(|signer| signer.pubkey()));
        let before = self.total();
        self.svm.expire_blockhash();
        let msg = Message::new_with_blockhash(
            ixs,
            Some(&signers[0].pubkey()),
            &self.svm.latest_blockhash(),
        );
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
        let result = self.svm.send_transaction(tx);
        // Each signature a precompile instruction verifies is charged like a
        // transaction signature.
        let precompile_signatures: u128 = ixs
            .iter()
            .filter(|ix| ix.program_id == solana_sdk_ids::secp256r1_program::id())
            .map(|ix| u128::from(ix.data.first().copied().unwrap_or(0)))
            .sum();
        let fee =
            u128::from(LAMPORTS_PER_SIGNATURE) * (signers.len() as u128 + precompile_signatures);
        assert_eq!(
            before - self.total(),
            fee,
            "lamports must be conserved: every lamport that left one account arrived in another"
        );
        // A confirmed transaction that opened a rating is followed by a later
        // slot, as on a live cluster: a rated escrow cannot end in the slot
        // its rating was opened in, and tests that need that slot build both
        // steps into one transaction.
        if result.is_ok()
            && ixs
                .iter()
                .any(|ix| ix.data.starts_with(&selector("open_rating")))
        {
            self.next_slot();
        }
        match result {
            Ok(meta) => Ok(Sent {
                events: meta
                    .logs
                    .iter()
                    .filter(|line| line.starts_with("Program data: "))
                    .cloned()
                    .collect(),
                logs: meta.logs,
                compute_units: meta.compute_units_consumed,
            }),
            Err(failed) => Err(format!("{:?} {:?}", failed.err, failed.meta.logs)),
        }
    }

    /// `ix` with a trailing `THIS_JOB` replaced by the opening slot of the
    /// job it is given: the first rating or attestation account among its
    /// accounts, read now, or the current slot when there is none yet (the
    /// rating is opened in the same transaction).
    pub fn resolve(&self, ix: &Instruction) -> Instruction {
        let mut ix = ix.clone();
        if ix.program_id != escrow::id() || !ix.data.ends_with(&THIS_JOB) {
            return ix;
        }
        let job = ix
            .accounts
            .iter()
            .filter_map(|meta| self.svm.get_account(&meta.pubkey))
            .filter(|account| account.owner == escrow::id())
            .find_map(|account| match account.data.len() {
                270 => Some(u64_at(&account.data, 240)),
                ATTESTATION_LEN => Some(u64_at(&account.data, 119)),
                _ => None,
            })
            .unwrap_or_else(|| self.slot());
        let at = ix.data.len() - 8;
        ix.data[at..].copy_from_slice(&job.to_le_bytes());
        ix
    }

    pub fn ok(&mut self, label: &str, ix: Instruction, signers: &[&Keypair]) -> Sent {
        let sent = self
            .send(&[ix], signers)
            .unwrap_or_else(|error| panic!("{label}: expected success, got {error}"));
        self.compute.push((label.to_string(), sent.compute_units));
        sent
    }

    /// The call must be refused with `code`, and change nothing but the fee
    /// payer's balance.
    pub fn refused(&mut self, label: &str, ix: Instruction, signers: &[&Keypair], code: u32) {
        let watched: Vec<Pubkey> = ix.accounts.iter().map(|meta| meta.pubkey).collect();
        let before: Vec<Option<Account>> = watched
            .iter()
            .map(|address| self.svm.get_account(address))
            .collect();
        let error = match self.send(&[ix], signers) {
            Ok(_) => panic!("{label}: expected Custom({code}), but the call succeeded"),
            Err(error) => error,
        };
        assert!(
            error.contains(&format!("Custom({code})")),
            "{label}: expected Custom({code}), got {error}"
        );
        let fee_payer = signers[0].pubkey();
        for (address, before) in watched.iter().zip(before) {
            if *address != fee_payer {
                assert_eq!(
                    self.svm.get_account(address),
                    before,
                    "{label}: a refused call changed {address}"
                );
            }
        }
    }

    /// The call must be refused by the System program (for example because
    /// the account to create already exists).
    pub fn refused_by_system(&mut self, label: &str, ix: Instruction, signers: &[&Keypair]) {
        let error = match self.send(&[ix], signers) {
            Ok(_) => panic!("{label}: expected a refusal, but the call succeeded"),
            Err(error) => error,
        };
        assert!(
            error.contains("already in use"),
            "{label}: expected the System program to refuse, got {error}"
        );
    }

    pub fn report(&self, title: &str) {
        println!("\n{title}");
        println!("{:<52} {:>10}", "compute units", "Pinocchio");
        for (label, units) in &self.compute {
            println!("{label:<52} {units:>10}");
        }
    }

    // ── Registry ────────────────────────────────────────────────────────────

    pub fn register(&mut self, owner: &Keypair, agent_type: AgentType) -> Pubkey {
        let ix = Instruction::new_with_bytes(
            escrow::id(),
            &instruction::RegisterAgent {
                agent_type,
                model: "model".to_string(),
                rate_lamports: 1_000,
                min_reputation: 0,
            }
            .data(),
            accounts::RegisterAgent {
                agent: agent(&owner.pubkey()),
                owner: owner.pubkey(),
                fee_collector: AGENT_FEE_BURN_ADDRESS,
                system_program: system_program::id(),
            }
            .to_account_metas(None),
        );
        self.ok("register_agent", ix, &[owner]);
        agent(&owner.pubkey())
    }

    pub fn deregister(&mut self, owner: &Keypair) {
        let ix = Instruction::new_with_bytes(
            escrow::id(),
            &instruction::DeregisterAgent {}.data(),
            accounts::DeregisterAgent {
                agent: agent(&owner.pubkey()),
                owner: owner.pubkey(),
            }
            .to_account_metas(None),
        );
        self.ok("deregister_agent", ix, &[owner]);
    }

    pub fn agent(&self, owner: &Pubkey) -> AgentAccount {
        let data = self.data(&agent(owner));
        AgentAccount::try_deserialize(&mut data.as_slice()).expect("a registered agent")
    }

    /// Overwrite an agent's reputation score, to start a test from a known
    /// non-zero value.
    pub fn set_reputation(&mut self, owner: &Pubkey, score: u16) {
        let address = agent(owner);
        let mut account = self.svm.get_account(&address).unwrap();
        let model_len = u32::from_le_bytes(account.data[41..45].try_into().unwrap()) as usize;
        // head (45) + model + rate (8) + min_reputation (1)
        let at = 45 + model_len + 9;
        account.data[at..at + 2].copy_from_slice(&score.to_le_bytes());
        self.set(address, account);
        assert_eq!(self.agent(owner).reputation_score, score);
    }

    /// The slot the rating at `address` was opened in; 0 when the account is
    /// not a rating of the program.
    pub fn opened_slot(&self, address: &Pubkey) -> u64 {
        match self.svm.get_account(address) {
            Some(account) if account.data.len() == 270 => u64_at(&account.data, 240),
            _ => 0,
        }
    }

    /// Move to the next slot. A rated escrow cannot end in the slot its
    /// rating was opened in.
    pub fn next_slot(&mut self) {
        let slot = self.slot();
        self.warp(slot + 1);
    }

    pub fn rating(&self, address: &Pubkey) -> Rating {
        Rating::parse(&self.data(address))
    }

    pub fn attestation(&self, address: &Pubkey) -> Attestation {
        Attestation::parse(&self.data(address))
    }
}

pub fn agent(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"agent", owner.as_ref()], &escrow::id()).0
}

pub fn rating_address(escrow: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"rating", escrow.as_ref()], &escrow::id()).0
}

pub fn attestation_address(escrow: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"attestation", escrow.as_ref()], &escrow::id()).0
}

// ── Account layouts (README "Account layouts") ──────────────────────────────

pub const RATING_LEN: usize = 270;
pub const ATTESTATION_LEN: usize = 127;

fn pubkey_at(data: &[u8], at: usize) -> Pubkey {
    Pubkey::new_from_array(data[at..at + 32].try_into().unwrap())
}

pub fn u64_at(data: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(data[at..at + 8].try_into().unwrap())
}

#[derive(Debug, Clone, PartialEq)]
pub struct Rating {
    pub escrow: Pubkey,
    pub consumer: Pubkey,
    pub specialist: Pubkey,
    pub judge: Pubkey,
    pub mint: Pubkey,
    pub consumer_commitment: [u8; 32],
    pub specialist_commitment: [u8; 32],
    pub paid: u64,
    pub opened_slot: u64,
    pub settled_slot: u64,
    pub committed_slot: u64,
    pub state: u8,
    pub consumer_score: u8,
    pub specialist_score: u8,
    /// The specialist agreed to the job being rated (`accept_rating`).
    pub accepted: bool,
    /// The judge has attested the job (`attest_quality`).
    pub attested: bool,
    pub bump: u8,
}

impl Rating {
    pub fn parse(data: &[u8]) -> Self {
        assert_eq!(data.len(), RATING_LEN, "a rating account");
        assert_eq!(data[..8], account_discriminator("RatingAccount"));
        Self {
            escrow: pubkey_at(data, 8),
            consumer: pubkey_at(data, 40),
            specialist: pubkey_at(data, 72),
            judge: pubkey_at(data, 104),
            mint: pubkey_at(data, 136),
            consumer_commitment: data[168..200].try_into().unwrap(),
            specialist_commitment: data[200..232].try_into().unwrap(),
            paid: u64_at(data, 232),
            opened_slot: u64_at(data, 240),
            settled_slot: u64_at(data, 248),
            committed_slot: u64_at(data, 256),
            state: data[264],
            consumer_score: data[265],
            specialist_score: data[266],
            accepted: match data[267] {
                0 => false,
                1 => true,
                other => panic!("accepted byte {other}"),
            },
            attested: match data[268] {
                0 => false,
                1 => true,
                other => panic!("attested byte {other}"),
            },
            bump: data[269],
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Attestation {
    pub escrow: Pubkey,
    pub judge: Pubkey,
    pub consumer: Pubkey,
    pub scores: [u8; 5],
    pub resolution: u8,
    pub created_slot: u64,
    pub bump: u8,
    pub opened_slot: u64,
}

impl Attestation {
    pub fn parse(data: &[u8]) -> Self {
        assert_eq!(data.len(), ATTESTATION_LEN, "an attestation account");
        assert_eq!(data[..8], account_discriminator("AttestationAccount"));
        Self {
            escrow: pubkey_at(data, 8),
            judge: pubkey_at(data, 40),
            consumer: pubkey_at(data, 72),
            scores: data[104..109].try_into().unwrap(),
            resolution: data[109],
            created_slot: u64_at(data, 110),
            bump: data[118],
            opened_slot: u64_at(data, 119),
        }
    }
}

/// Offset of the flag byte (`0x01` metered, `0x02` rated) in a SOL escrow
/// that is not delegated, and in a token escrow.
pub const SOL_ESCROW_FLAGS_AT: usize = 132;
pub const TOKEN_ESCROW_FLAGS_AT: usize = 202;
pub const FLAG_METERED: u8 = 0x01;
pub const FLAG_RATED: u8 = 0x02;

// ── Instructions the Anchor IDL does not cover ──────────────────────────────

fn meta(pubkey: Pubkey, signer: bool, writable: bool) -> AccountMeta {
    AccountMeta {
        pubkey,
        is_signer: signer,
        is_writable: writable,
    }
}

fn ix(name: &str, args: &[u8], accounts: Vec<AccountMeta>) -> Instruction {
    let mut data = selector(name).to_vec();
    data.extend_from_slice(args);
    Instruction::new_with_bytes(escrow::id(), &data, accounts)
}

/// `update_agent`, which the Anchor IDL covers; here for tests that switch
/// an agent record off.
pub fn update_agent(
    owner: &Pubkey,
    rate_lamports: u64,
    min_reputation: u8,
    active: bool,
) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::UpdateAgent {
            rate_lamports,
            min_reputation,
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

/// `open_rating`. `judge` is `None` for no judge.
pub fn open_rating(escrow: &Pubkey, payer: &Pubkey, judge: Option<&Pubkey>) -> Instruction {
    let judge = judge.map_or([0; 32], |judge| judge.to_bytes());
    ix(
        "open_rating",
        &judge,
        vec![
            meta(rating_address(escrow), false, true),
            meta(*escrow, false, true),
            meta(*payer, true, true),
            meta(system_program::id(), false, false),
        ],
    )
}

/// `accept_rating` for the job now at `rating`: it names the slot that
/// rating was opened in (0 when there is no rating account).
pub fn accept_rating(world: &World, rating: &Pubkey, specialist: &Pubkey) -> Instruction {
    accept_rating_of(rating, specialist, world.opened_slot(rating))
}

/// `accept_rating` naming `opened_slot` as the job.
pub fn accept_rating_of(rating: &Pubkey, specialist: &Pubkey, opened_slot: u64) -> Instruction {
    ix(
        "accept_rating",
        &opened_slot.to_le_bytes(),
        vec![meta(*rating, false, true), meta(*specialist, true, false)],
    )
}

pub fn close_attestation(escrow: &Pubkey, judge: &Pubkey) -> Instruction {
    ix(
        "close_attestation",
        &[],
        vec![
            meta(attestation_address(escrow), false, true),
            meta(*judge, true, true),
        ],
    )
}

/// The same exit with the rating account of `escrow` after its own accounts,
/// as an exit of a rated escrow needs it.
/// Stand-in for "the job now at this address" in an instruction's data, for
/// tests that do not care which job it names. `World::send` replaces it with
/// that job's opening slot when the transaction is sent. Tests about a stale
/// or wrong job name the slot themselves (the `_of` builders).
pub const THIS_JOB: [u8; 8] = *b"thisjob!";

/// `exit` for a rated escrow: the rating account after its own accounts,
/// and the job (`THIS_JOB`) after its data.
pub fn with_rating(exit: Instruction, escrow: &Pubkey) -> Instruction {
    let mut ix = with_account(exit, rating_address(escrow), true);
    ix.data.extend_from_slice(&THIS_JOB);
    ix
}

/// `exit` for a rated escrow, naming `opened_slot` as the job.
pub fn with_rating_of(exit: Instruction, escrow: &Pubkey, opened_slot: u64) -> Instruction {
    let mut ix = with_account(exit, rating_address(escrow), true);
    ix.data.extend_from_slice(&opened_slot.to_le_bytes());
    ix
}

pub fn with_account(mut ix: Instruction, address: Pubkey, writable: bool) -> Instruction {
    ix.accounts.push(meta(address, false, writable));
    ix
}

/// The commitment for the job now at `rating`.
pub fn commitment(
    world: &World,
    rating: &Pubkey,
    signer: &Pubkey,
    score: u8,
    salt: [u8; 32],
) -> [u8; 32] {
    commitment_of(rating, world.opened_slot(rating), signer, score, salt)
}

/// sha256(rating ‖ opened slot (8 bytes LE) ‖ signer ‖ score ‖ salt).
pub fn commitment_of(
    rating: &Pubkey,
    opened_slot: u64,
    signer: &Pubkey,
    score: u8,
    salt: [u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(rating.as_ref());
    hasher.update(opened_slot.to_le_bytes());
    hasher.update(signer.as_ref());
    hasher.update([score]);
    hasher.update(salt);
    hasher.finalize().into()
}

pub fn commit_rating(rating: &Pubkey, signer: &Pubkey, commitment: [u8; 32]) -> Instruction {
    commit_rating_with(rating, signer, commitment, THIS_JOB)
}

/// `commit_rating` naming `opened_slot` as the job.
pub fn commit_rating_of(
    rating: &Pubkey,
    signer: &Pubkey,
    commitment: [u8; 32],
    opened_slot: u64,
) -> Instruction {
    commit_rating_with(rating, signer, commitment, opened_slot.to_le_bytes())
}

fn commit_rating_with(
    rating: &Pubkey,
    signer: &Pubkey,
    commitment: [u8; 32],
    job: [u8; 8],
) -> Instruction {
    ix(
        "commit_rating",
        &[&commitment[..], &job[..]].concat(),
        vec![meta(*rating, false, true), meta(*signer, true, false)],
    )
}

fn rating_parties(
    rating: &Pubkey,
    signer: &Pubkey,
    specialist: &Pubkey,
    consumer: &Pubkey,
) -> Vec<AccountMeta> {
    vec![
        meta(*rating, false, true),
        meta(*signer, true, false),
        meta(agent(specialist), false, true),
        meta(agent(consumer), false, true),
    ]
}

pub fn reveal_rating(
    rating: &Pubkey,
    signer: &Pubkey,
    specialist: &Pubkey,
    consumer: &Pubkey,
    score: u8,
    salt: [u8; 32],
) -> Instruction {
    let mut args = vec![score];
    args.extend_from_slice(&salt);
    ix(
        "reveal_rating",
        &args,
        rating_parties(rating, signer, specialist, consumer),
    )
}

pub fn expire_rating(
    rating: &Pubkey,
    caller: &Pubkey,
    specialist: &Pubkey,
    consumer: &Pubkey,
) -> Instruction {
    ix(
        "expire_rating",
        &[],
        rating_parties(rating, caller, specialist, consumer),
    )
}

pub fn close_rating(rating: &Pubkey, consumer: &Pubkey) -> Instruction {
    ix(
        "close_rating",
        &[],
        vec![meta(*rating, false, true), meta(*consumer, true, true)],
    )
}

/// `attest_quality` for the job now rated at `escrow`'s rating address.
pub fn attest_quality(
    world: &World,
    escrow: &Pubkey,
    judge: &Pubkey,
    scores: [u8; 5],
) -> Instruction {
    let opened_slot = world.opened_slot(&rating_address(escrow));
    attest_quality_of(escrow, judge, scores, opened_slot)
}

/// `attest_quality` naming `opened_slot` as the job.
pub fn attest_quality_of(
    escrow: &Pubkey,
    judge: &Pubkey,
    scores: [u8; 5],
    opened_slot: u64,
) -> Instruction {
    let mut args = scores.to_vec();
    args.extend_from_slice(&opened_slot.to_le_bytes());
    ix(
        "attest_quality",
        &args,
        vec![
            meta(attestation_address(escrow), false, true),
            meta(rating_address(escrow), false, true),
            meta(agent(judge), false, false),
            meta(*judge, true, true),
            meta(system_program::id(), false, false),
        ],
    )
}

pub fn resolve_attestation(
    escrow: &Pubkey,
    judge: &Pubkey,
    consumer: &Pubkey,
    confirm: bool,
) -> Instruction {
    resolve_attestation_with(escrow, judge, consumer, confirm, THIS_JOB)
}

/// `confirm_attestation` or `dispute_attestation` naming `opened_slot` as
/// the job.
pub fn resolve_attestation_of(
    escrow: &Pubkey,
    judge: &Pubkey,
    consumer: &Pubkey,
    confirm: bool,
    opened_slot: u64,
) -> Instruction {
    resolve_attestation_with(escrow, judge, consumer, confirm, opened_slot.to_le_bytes())
}

fn resolve_attestation_with(
    escrow: &Pubkey,
    judge: &Pubkey,
    consumer: &Pubkey,
    confirm: bool,
    job: [u8; 8],
) -> Instruction {
    ix(
        if confirm {
            "confirm_attestation"
        } else {
            "dispute_attestation"
        },
        &job,
        vec![
            meta(attestation_address(escrow), false, true),
            meta(agent(judge), false, true),
            meta(*consumer, true, false),
        ],
    )
}

pub fn read_only(mut ix: Instruction, index: usize) -> Instruction {
    ix.accounts[index].is_writable = false;
    ix
}

pub fn not_signed(mut ix: Instruction, index: usize) -> Instruction {
    ix.accounts[index].is_signer = false;
    ix
}

pub fn swap(mut ix: Instruction, index: usize, address: Pubkey) -> Instruction {
    ix.accounts[index].pubkey = address;
    ix
}

pub fn with_args(mut ix: Instruction, args: &[u8]) -> Instruction {
    ix.data.truncate(8);
    ix.data.extend_from_slice(args);
    ix
}

// ── SOL escrow (the Anchor crate's builders: unchanged instructions) ────────

pub fn sol_escrow(payer: &Pubkey, nonce: [u8; 16]) -> Pubkey {
    Pubkey::find_program_address(&[b"escrow", payer.as_ref(), &nonce], &escrow::id()).0
}

pub fn sol_lock(
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
            claim_window_slots: CLAIM_WINDOW,
            cancel_window_slots: CANCEL_WINDOW,
        }
        .data()
    } else {
        instruction::LockEscrow {
            amount,
            nonce,
            claim_window_slots: CLAIM_WINDOW,
            cancel_window_slots: CANCEL_WINDOW,
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
pub fn sol_payout(
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

pub fn sol_cancel(payer: &Pubkey, nonce: [u8; 16], authority: &Pubkey) -> Instruction {
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

// ── Token escrow ────────────────────────────────────────────────────────────

pub struct Tokens {
    pub program: Pubkey,
    pub mint: Pubkey,
    pub payer: Keypair,
    pub payee: Keypair,
    pub source: Pubkey,
    pub recipient: Pubkey,
    pub treasury_token: Pubkey,
}

pub fn token_account_data(program: &Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
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
    /// accounts for `payer`, `payee` and the treasury. No real token, RPC or
    /// wallet is involved.
    pub fn install(
        world: &mut World,
        program: Pubkey,
        mint: Pubkey,
        payer: Keypair,
        payee: Keypair,
    ) -> Self {
        let mint_data = if program == TOKEN_2022_ID {
            let fixture = if mint == USDG_MAINNET_MINT {
                USDG_MINT_FIXTURE
            } else {
                PYUSD_MINT_FIXTURE
            };
            let mut data = fixture.to_vec();
            data[36..44].copy_from_slice(&3_000_000_000u64.to_le_bytes());
            data
        } else {
            let mut data = vec![0u8; spl_token::state::Mint::LEN];
            spl_token::state::Mint::pack(
                spl_token::state::Mint {
                    mint_authority: Some(payer.pubkey()).into(),
                    supply: 3_000_000_000,
                    decimals: 6,
                    is_initialized: true,
                    freeze_authority: None.into(),
                },
                &mut data,
            )
            .unwrap();
            data
        };
        world.set(
            mint,
            Account {
                lamports: 100_000_000,
                data: mint_data,
                owner: program,
                ..Account::default()
            },
        );
        let tokens = Self {
            program,
            mint,
            source: Pubkey::new_from_array([101; 32]),
            recipient: Pubkey::new_from_array([102; 32]),
            treasury_token: escrow::treasury_token_address(&mint, &program),
            payer,
            payee,
        };
        for (address, owner, amount) in [
            (tokens.source, tokens.payer.pubkey(), 1_000_000_000),
            (tokens.recipient, tokens.payee.pubkey(), 0),
            (tokens.treasury_token, PROTOCOL_TREASURY, 0),
        ] {
            world.set(
                address,
                Account {
                    lamports: 10_000_000,
                    data: token_account_data(&program, &mint, &owner, amount),
                    owner: program,
                    ..Account::default()
                },
            );
        }
        tokens
    }

    pub fn balance(&self, world: &World, address: &Pubkey) -> u64 {
        u64_at(&world.data(address), 64)
    }

    pub fn escrow(&self, nonce: [u8; 16]) -> Pubkey {
        Pubkey::find_program_address(
            &[b"token-escrow", self.payer.pubkey().as_ref(), &nonce],
            &escrow::id(),
        )
        .0
    }

    pub fn vault(&self, nonce: [u8; 16]) -> Pubkey {
        Pubkey::find_program_address(
            &[b"token-vault", self.escrow(nonce).as_ref()],
            &escrow::id(),
        )
        .0
    }

    pub fn lock(&self, amount: u64, nonce: [u8; 16], metered: bool) -> Instruction {
        let data = if metered {
            instruction::LockMeteredTokenEscrow {
                amount,
                nonce,
                claim_window_slots: CLAIM_WINDOW,
                cancel_window_slots: CANCEL_WINDOW,
            }
            .data()
        } else {
            instruction::LockTokenEscrow {
                amount,
                nonce,
                claim_window_slots: CLAIM_WINDOW,
                cancel_window_slots: CANCEL_WINDOW,
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
    pub fn payout(&self, nonce: [u8; 16], authority: &Pubkey, actual: Option<u64>) -> Instruction {
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

    pub fn cancel(&self, nonce: [u8; 16], authority: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::CancelTokenEscrow {}.data(),
            accounts::CancelTokenEscrow {
                escrow: self.escrow(nonce),
                vault: self.vault(nonce),
                authority: *authority,
                payer: self.payer.pubkey(),
                mint: self.mint,
                destination: self.source,
                token_program: self.program,
            }
            .to_account_metas(None),
        )
    }
}

/// Windows `open_delivery` uses in tests: the shortest allowed.
pub const DELIVERY_VERIFY: u64 = 150;
pub const DELIVERY_RESOLVE: u64 = 1_500;
/// The file hash `record_delivery` states in tests.
pub const DELIVERY_SHA: [u8; 32] = [7; 32];
pub const DELIVERY_LEN: usize = 162;
pub const FLAG_DELIVERY: u8 = 0x04;

// ── Delivery check ──────────────────────────────────────────────────────────

pub fn delivery_address(escrow: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"delivery", escrow.as_ref()], &escrow::id()).0
}

fn build(name: &str, args: &[u8], accounts: Vec<(Pubkey, bool, bool)>) -> Instruction {
    ix(
        name,
        args,
        accounts
            .into_iter()
            .map(|(pubkey, signer, writable)| meta(pubkey, signer, writable))
            .collect(),
    )
}

pub fn open_delivery_with(
    escrow: &Pubkey,
    payer: &Pubkey,
    judge: &Pubkey,
    verify: u64,
    resolve: u64,
) -> Instruction {
    let mut args = judge.to_bytes().to_vec();
    args.extend_from_slice(&verify.to_le_bytes());
    args.extend_from_slice(&resolve.to_le_bytes());
    build(
        "open_delivery",
        &args,
        vec![
            (delivery_address(escrow), false, true),
            (*escrow, false, true),
            (*payer, true, true),
            (agent(judge), false, false),
            (system_program::id(), false, false),
        ],
    )
}

pub fn open_delivery(escrow: &Pubkey, payer: &Pubkey, judge: &Pubkey) -> Instruction {
    open_delivery_with(escrow, payer, judge, DELIVERY_VERIFY, DELIVERY_RESOLVE)
}

pub fn record_delivery(
    escrow: &Pubkey,
    payee: &Pubkey,
    opened: u64,
    units: u64,
    bytes: u64,
) -> Instruction {
    let mut args = opened.to_le_bytes().to_vec();
    args.extend_from_slice(&units.to_le_bytes());
    args.extend_from_slice(&bytes.to_le_bytes());
    args.extend_from_slice(&DELIVERY_SHA);
    build(
        "record_delivery",
        &args,
        vec![
            (delivery_address(escrow), false, true),
            (*escrow, false, false),
            (*payee, true, false),
        ],
    )
}

/// `accept_delivery` or `dispute_delivery`, by `name`.
pub fn answer(name: &str, escrow: &Pubkey, payer: &Pubkey, opened: u64) -> Instruction {
    build(
        name,
        &opened.to_le_bytes(),
        vec![
            (delivery_address(escrow), false, true),
            (*escrow, false, false),
            (*payer, true, false),
        ],
    )
}

pub fn with_delivery(exit: Instruction, escrow: &Pubkey) -> Instruction {
    with_account(exit, delivery_address(escrow), true)
}

pub fn sol_resolve(
    payer: &Pubkey,
    payee: &Pubkey,
    escrow: &Pubkey,
    judge: &Pubkey,
    payout: u64,
    opened: u64,
    rated: bool,
) -> Instruction {
    let mut args = payout.to_le_bytes().to_vec();
    args.extend_from_slice(&opened.to_le_bytes());
    let mut accounts = vec![
        (*escrow, false, true),
        (*payer, false, true),
        (*payee, false, true),
        (PROTOCOL_TREASURY, false, true),
        (system_program::id(), false, false),
        (*judge, true, false),
    ];
    if rated {
        accounts.push((rating_address(escrow), false, true));
    }
    accounts.push((delivery_address(escrow), false, true));
    build("resolve_delivery", &args, accounts)
}

pub fn token_resolve(
    t: &Tokens,
    nonce: [u8; 16],
    judge: &Pubkey,
    payout: u64,
    opened: u64,
) -> Instruction {
    let mut args = payout.to_le_bytes().to_vec();
    args.extend_from_slice(&opened.to_le_bytes());
    let escrow = t.escrow(nonce);
    build(
        "resolve_token_delivery",
        &args,
        vec![
            (escrow, false, true),
            (t.vault(nonce), false, true),
            (*judge, true, false),
            (t.payer.pubkey(), false, true),
            (t.mint, false, false),
            (t.recipient, false, true),
            (t.treasury_token, false, true),
            (t.source, false, true),
            (t.program, false, false),
            (delivery_address(&escrow), false, true),
        ],
    )
}

pub mod budget;

#[path = "../common/instance.rs"]
pub mod instance;
