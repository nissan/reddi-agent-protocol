/// QuasarSVM tests for the Quasar blind commit-reveal reputation.
///
/// Parity with Anchor `tests/reputation.rs`:
///   1. Full happy path — both commit, both reveal, scores applied (commit→reveal)
///   2. commit→expire happy path — consumer commits, specialist ghosts, expiry penalises
///   3. Reveal rejected before both parties commit (BothMustCommitFirst parity)
///   4. Tampered reveal rejected — wrong salt (CommitmentMismatch parity)
///   5. Unauthorized reveal — neither consumer nor specialist
///   6. Duplicate commit rejected (AlreadyCommitted parity)
///   7. Expiry boundary — expire rejected before RATING_EXPIRE_SLOTS
///   8. Expiry boundary — expire succeeds after RATING_EXPIRE_SLOTS
///
/// Additional Quasar-specific tests:
///   9. Commit to already-revealed rating rejected (AlreadyFinalised parity)
///  10. Invalid score rejected (score 0 and score 11)
///
/// Audit regressions (`docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md`):
///  MEDIUM-1 zero commitment, MEDIUM-2 cross-job reuse, MEDIUM-4 third-party expiry,
///  and the CRITICAL-1 / CRITICAL-4 job-binding regressions added 2026-08-24.
///
/// # Escrow binding in tests
///
/// These tests load only `quasar-reputation`, so escrow accounts are fabricated
/// directly as byte images owned by the `quasar-escrow` program id. That is
/// exactly the surface the reputation program trusts — account owner plus
/// discriminator — so it exercises the real check, and it lets the negative
/// tests forge accounts a live escrow program would never produce.
extern crate std;

use {
    crate::escrow_ref::{ESCROW_DISCRIMINATOR, QUASAR_ESCROW_PROGRAM_ID},
    quasar_lang::traits::HasSeeds,
    quasar_svm::{Account, AccountMeta, Instruction, InstructionError, Pubkey, QuasarSvm},
    std::{println, vec, vec::Vec},
};

// ── Setup ─────────────────────────────────────────────────────────────────────

fn setup() -> QuasarSvm {
    let elf = std::fs::read(
        concat!(env!("CARGO_MANIFEST_DIR"), "/target/deploy/quasar_reputation.so"),
    )
    .expect("build .so first: cargo build-sbf --manifest-path experiments/quasar-reputation/Cargo.toml");
    QuasarSvm::new().with_program(&crate::ID, &elf)
}

fn funded(address: Pubkey) -> Account {
    quasar_svm::token::create_keyed_system_account(&address, 5_000_000_000)
}

fn empty(address: Pubkey) -> Account {
    Account {
        address,
        lamports: 0,
        data: vec![],
        owner: quasar_svm::system_program::ID,
        executable: false,
    }
}

fn fee_collector() -> Pubkey {
    "1nc1nerator11111111111111111111111111111111"
        .parse()
        .unwrap()
}

fn agent_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            <crate::state::AgentAccount as HasSeeds>::SEED_PREFIX,
            owner.as_ref(),
        ],
        &crate::ID,
    )
    .0
}

// ── Escrow fixtures ───────────────────────────────────────────────────────────

/// Derives the escrow PDA the way `quasar-escrow::lock` does:
/// `[b"escrow", payer, escrow_id]`.
fn escrow_pda(payer: &Pubkey, escrow_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"escrow", payer.as_ref(), &escrow_id.to_le_bytes()],
        &QUASAR_ESCROW_PROGRAM_ID,
    )
    .0
}

/// Builds the on-chain byte image `quasar-escrow` writes for an `EscrowAccount`:
/// one discriminator byte followed by the zero-copy payload.
fn escrow_image(payer: &Pubkey, payee: &Pubkey, escrow_id: u64, discriminator: u8) -> Vec<u8> {
    let mut data = vec![0u8; 99]; // 1 disc + 98 payload
    data[0] = discriminator;
    data[1..33].copy_from_slice(payer.as_ref());
    data[33..65].copy_from_slice(payee.as_ref());
    data[65..73].copy_from_slice(&escrow_id.to_le_bytes());
    data[73..81].copy_from_slice(&1_000_000u64.to_le_bytes()); // amount
    data[81] = 0; // EscrowStatus::Locked — escrow exists only while locked
    data
}

/// A well-formed escrow: correct owner, correct discriminator.
/// Returns `(escrow_address, escrow_account)`.
fn escrow(payer: &Pubkey, payee: &Pubkey, escrow_id: u64) -> (Pubkey, Account) {
    let address = escrow_pda(payer, escrow_id);
    (
        address,
        Account {
            address,
            lamports: 2_000_000,
            data: escrow_image(payer, payee, escrow_id, ESCROW_DISCRIMINATOR),
            owner: QUASAR_ESCROW_PROGRAM_ID,
            executable: false,
        },
    )
}

/// An escrow-shaped account with a caller-chosen owner and discriminator — used
/// by the CRITICAL-1 negative tests to forge a job record.
fn forged_escrow(
    address: Pubkey,
    owner: Pubkey,
    payer: &Pubkey,
    payee: &Pubkey,
    escrow_id: u64,
    discriminator: u8,
) -> Account {
    Account {
        address,
        lamports: 2_000_000,
        data: escrow_image(payer, payee, escrow_id, discriminator),
        owner,
        executable: false,
    }
}

/// Rating PDA — seeded by the **escrow address**, not a caller-chosen job id.
fn rating_pda(escrow: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            <crate::state::RatingAccount as HasSeeds>::SEED_PREFIX,
            escrow.as_ref(),
        ],
        &crate::ID,
    )
    .0
}

/// The commitment pre-image is domain-separated on the escrow address and the
/// program id: `sha256(score || salt || escrow || program_id)`.
fn sha256_commitment(escrow: &Pubkey, score: u8, salt: &[u8; 32]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update([score]);
    h.update(salt);
    h.update(escrow.as_ref());
    h.update(crate::ID.as_ref());
    h.finalize().into()
}

// ── Instruction builders ──────────────────────────────────────────────────────

/// Builds a `register` instruction (disc=0).
fn register_ix(owner: Pubkey, agent: Pubkey, model: &str) -> Instruction {
    let model_bytes = model.as_bytes();
    assert!(model_bytes.len() <= 64);
    let mut model_data = [0u8; 64];
    model_data[..model_bytes.len()].copy_from_slice(model_bytes);

    let mut data = vec![0u8]; // disc=0
    data.push(0u8);           // agent_type=Primary
    data.push(model_bytes.len() as u8);
    data.extend_from_slice(&model_data);
    data.extend_from_slice(&1_000_000u64.to_le_bytes());
    data.push(0u8); // min_reputation

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(agent, false),
            AccountMeta::new(owner, true),
            AccountMeta::new(fee_collector(), false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

/// Builds a `commit` instruction (disc=1).
///
/// Args are only `commitment` and `role` — the job identity and both parties
/// come from the escrow account, which is why CRITICAL-1 is closed.
/// role: 0=Consumer, 1=Specialist
fn commit_ix(
    commitment: [u8; 32],
    role: u8,
    signer: Pubkey,
    escrow: Pubkey,
    rating: Pubkey,
) -> Instruction {
    let mut data = vec![1u8]; // disc=1
    data.extend_from_slice(&commitment); // [u8; 32]
    data.push(role);                     // u8

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(escrow, false),
            AccountMeta::new(rating, false),
            AccountMeta::new(signer, true),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

/// Builds a `reveal` instruction (disc=2).
fn reveal_ix(
    score: u8,
    salt: [u8; 32],
    signer: Pubkey,
    escrow: Pubkey,
    rating: Pubkey,
    specialist_agent: Pubkey,
    consumer_agent: Pubkey,
) -> Instruction {
    let mut data = vec![2u8]; // disc=2
    data.push(score);              // u8
    data.extend_from_slice(&salt); // [u8; 32]

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(escrow, false),
            AccountMeta::new(rating, false),
            AccountMeta::new_readonly(signer, true),
            AccountMeta::new(specialist_agent, false),
            AccountMeta::new(consumer_agent, false),
        ],
        data,
    }
}

/// Builds an `expire` instruction (disc=3). Takes no instruction arguments.
fn expire_ix(
    caller: Pubkey,
    escrow: Pubkey,
    rating: Pubkey,
    specialist_agent: Pubkey,
    consumer_agent: Pubkey,
) -> Instruction {
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(escrow, false),
            AccountMeta::new(rating, false),
            AccountMeta::new_readonly(caller, true),
            AccountMeta::new(specialist_agent, false),
            AccountMeta::new(consumer_agent, false),
        ],
        data: vec![3u8],
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Register an agent and return (agent_pda, agent_account, owner_account_after).
/// NOTE: fee_collector is NOT passed explicitly — QuasarSVM auto-creates fee_collector
/// from program_cache or as a fallback. We pass it in accounts to ensure lamport tracking.
fn register_agent(svm: &mut QuasarSvm, owner: Pubkey) -> (Pubkey, Account, Account) {
    let agent = agent_pda(&owner);
    let fee_coll = fee_collector();

    let result = svm.process_instruction(
        &register_ix(owner, agent, "test-model"),
        &[
            empty(agent),
            funded(owner),
            Account {
                address: fee_coll,
                lamports: 0,
                data: vec![],
                owner: quasar_svm::system_program::ID,
                executable: false,
            },
            // NOTE: system_program NOT passed explicitly — SVM auto-creates builtins
        ],
    );
    result.assert_success();
    (
        agent,
        result.account(&agent).unwrap().clone(),
        result.account(&owner).unwrap().clone(),
    )
}

/// RatingAccountZc layout (offsets from the start of account data, after the
/// 1-byte discriminator): escrow[32] + job_id[16] + consumer[32] + specialist[32]
///   + consumer_commitment[32] + specialist_commitment[32]
///   + consumer_score[1] + specialist_score[1] + state[1]
const RATING_CONSUMER_SCORE_OFFSET: usize = 1 + 32 + 16 + 32 + 32 + 32 + 32; // 177
const RATING_SPECIALIST_SCORE_OFFSET: usize = RATING_CONSUMER_SCORE_OFFSET + 1; // 178
const RATING_STATE_OFFSET: usize = RATING_SPECIALIST_SCORE_OFFSET + 1; // 179
const RATING_ESCROW_OFFSET: usize = 1;

fn read_state_byte(svm: &QuasarSvm, rating: &Pubkey) -> u8 {
    let acct = svm.get_account(rating).expect("rating must exist");
    acct.data[RATING_STATE_OFFSET]
}

fn read_consumer_score(svm: &QuasarSvm, rating: &Pubkey) -> u8 {
    let acct = svm.get_account(rating).expect("rating must exist");
    acct.data[RATING_CONSUMER_SCORE_OFFSET]
}

fn read_specialist_score(svm: &QuasarSvm, rating: &Pubkey) -> u8 {
    let acct = svm.get_account(rating).expect("rating must exist");
    acct.data[RATING_SPECIALIST_SCORE_OFFSET]
}

/// Reads the escrow address the rating was bound to at commit time.
fn read_bound_escrow(svm: &QuasarSvm, rating: &Pubkey) -> [u8; 32] {
    let acct = svm.get_account(rating).expect("rating must exist");
    let mut out = [0u8; 32];
    out.copy_from_slice(&acct.data[RATING_ESCROW_OFFSET..RATING_ESCROW_OFFSET + 32]);
    out
}

/// Read reputation_score (u16 LE) from AgentAccount.
/// AgentAccountZc: owner[32] + agent_type[1] + model_len[1] + _pad[6] + rate_lamports[8]
///   + min_reputation[1] + _pad2[1] + reputation_score[2] = 1+52=51
fn read_reputation_score(svm: &QuasarSvm, agent: &Pubkey) -> u16 {
    let acct = svm.get_account(agent).expect("agent must exist");
    let lo = acct.data[51] as u16;
    let hi = acct.data[52] as u16;
    lo | (hi << 8)
}

/// Read jobs_completed (u64 LE): offset = 51+2+4 = 57
fn read_jobs_completed(svm: &QuasarSvm, agent: &Pubkey) -> u64 {
    let acct = svm.get_account(agent).expect("agent must exist");
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&acct.data[57..65]);
    u64::from_le_bytes(bytes)
}

/// Read jobs_failed (u64 LE): offset = 65
fn read_jobs_failed(svm: &QuasarSvm, agent: &Pubkey) -> u64 {
    let acct = svm.get_account(agent).expect("agent must exist");
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&acct.data[65..73]);
    u64::from_le_bytes(bytes)
}

/// Asserts an instruction failed with a specific `InstructionError`.
///
/// Negative tests are only meaningful if they fail for the *intended* reason —
/// a missing account or a malformed instruction would also produce `is_err()`.
/// The binding regressions below therefore assert the exact error, and pair it
/// with a positive control on the same fixtures wherever the setup is shared.
fn assert_failed_with(
    result: &quasar_svm::ExecutionResult,
    expected: InstructionError,
    context: &str,
) {
    match &result.raw_result {
        Err(actual) if *actual == expected => {}
        Err(actual) => panic!(
            "{}: expected {:?}, got {:?}",
            context, expected, actual
        ),
        Ok(()) => panic!("{}: expected {:?}, but the instruction succeeded", context, expected),
    }
}

/// `QuasarError::InvalidPda` (3002) — the PDA derivation did not match the
/// account passed in. Raised when a rating is presented alongside an escrow it
/// was not derived from.
const ERR_INVALID_PDA: InstructionError = InstructionError::Custom(3002);

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Test 1: Full happy path — both commit, both reveal, scores applied.
/// Parity: `test_commit_and_reveal_both` in Anchor reputation.rs
#[test]
fn test_commit_and_reveal_both() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    let (consumer_agent, consumer_agent_acct, consumer_acct) = register_agent(&mut svm, consumer);
    let (specialist_agent, specialist_agent_acct, specialist_acct) =
        register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 1);
    let rating = rating_pda(&escrow_addr);
    let c_salt = [0xAAu8; 32];
    let s_salt = [0xBBu8; 32];
    let c_score: u8 = 8;
    let s_score: u8 = 7;

    // Consumer commits (first call — creates RatingAccount)
    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, c_score, &c_salt), 0, consumer,
                   escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();
    println!("  COMMIT (consumer, first) CU: {}", r1.compute_units_consumed);

    // The rating records the escrow it was bound to.
    assert_eq!(
        read_bound_escrow(&svm, &rating),
        *escrow_addr.as_array(),
        "rating must record its bound escrow",
    );

    // Specialist commits (second call — reuses RatingAccount)
    let r2 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, s_score, &s_salt), 1, specialist,
                   escrow_addr, rating),
        &[
            escrow_acct.clone(),
            r1.account(&rating).unwrap().clone(),
            funded(specialist),
        ],
    );
    r2.assert_success();
    println!("  COMMIT (specialist, second) CU: {}", r2.compute_units_consumed);

    // State should now be BothCommitted (1)
    assert_eq!(read_state_byte(&svm, &rating), 1, "state should be BothCommitted");

    // Consumer reveals
    let r3 = svm.process_instruction(
        &reveal_ix(c_score, c_salt, consumer, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r2.account(&rating).unwrap().clone(),
            consumer_acct.clone(),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );
    r3.assert_success();
    println!("  REVEAL (consumer) CU: {}", r3.compute_units_consumed);

    // Specialist reveals — triggers finalisation
    let r4 = svm.process_instruction(
        &reveal_ix(s_score, s_salt, specialist, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r3.account(&rating).unwrap().clone(),
            specialist_acct.clone(),
            r3.account(&specialist_agent).unwrap().clone(),
            r3.account(&consumer_agent).unwrap().clone(),
        ],
    );
    r4.assert_success();
    println!("  REVEAL (specialist) CU: {}", r4.compute_units_consumed);

    // State should be Revealed (2)
    assert_eq!(read_state_byte(&svm, &rating), 2, "state should be Revealed");
    assert_eq!(read_consumer_score(&svm, &rating), c_score);
    assert_eq!(read_specialist_score(&svm, &rating), s_score);

    // Reputation scores should be non-zero
    let spec_rep = read_reputation_score(&svm, &specialist_agent);
    let cons_rep = read_reputation_score(&svm, &consumer_agent);
    assert!(spec_rep > 0, "specialist reputation should update: got {}", spec_rep);
    assert!(cons_rep > 0, "consumer reputation should update: got {}", cons_rep);

    // jobs_completed should be 1 for both
    assert_eq!(read_jobs_completed(&svm, &specialist_agent), 1);
    assert_eq!(read_jobs_completed(&svm, &consumer_agent), 1);
}

/// Test 2: commit → expire happy path.
/// Consumer commits, specialist ghosts. Expiry penalises specialist.
/// Parity: `test_expire_penalises_non_committer` in Anchor reputation.rs
#[test]
fn test_commit_and_expire() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    let (consumer_agent, consumer_agent_acct, consumer_acct) = register_agent(&mut svm, consumer);
    let (specialist_agent, specialist_agent_acct, _) = register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 5);
    let rating = rating_pda(&escrow_addr);
    let c_salt = [0xCCu8; 32];

    // Consumer commits (specialist ghosts)
    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, 9, &c_salt), 0, consumer, escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();

    let spec_rep_before = read_reputation_score(&svm, &specialist_agent);
    let spec_failed_before = read_jobs_failed(&svm, &specialist_agent);

    // Warp past RATING_EXPIRE_SLOTS (1_512_000)
    svm.sysvars.warp_to_slot(1_512_100);

    // Consumer triggers expiry
    let r2 = svm.process_instruction(
        &expire_ix(consumer, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r1.account(&rating).unwrap().clone(),
            consumer_acct.clone(),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );
    r2.assert_success();
    println!("  EXPIRE CU: {}", r2.compute_units_consumed);

    // State should be Expired (3)
    assert_eq!(read_state_byte(&svm, &rating), 3, "state should be Expired");

    // Specialist should be penalised (jobs_failed++)
    let spec_rep_after = read_reputation_score(&svm, &specialist_agent);
    let spec_failed_after = read_jobs_failed(&svm, &specialist_agent);

    // score is 0 initially, saturating_sub stays 0
    assert!(
        spec_rep_after <= spec_rep_before,
        "specialist score should not increase: before={}, after={}",
        spec_rep_before, spec_rep_after
    );
    assert_eq!(
        spec_failed_after,
        spec_failed_before + 1,
        "specialist jobs_failed should increment"
    );

    // Consumer should NOT be penalised
    let cons_failed = read_jobs_failed(&svm, &consumer_agent);
    assert_eq!(cons_failed, 0, "consumer committed — should not be penalised");
}

/// Test 3: Reveal rejected before both parties commit.
/// Parity: `test_reveal_rejected_before_both_commit` in Anchor reputation.rs
#[test]
fn test_reveal_rejected_before_both_commit() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    let (consumer_agent, consumer_agent_acct, consumer_acct) = register_agent(&mut svm, consumer);
    let (specialist_agent, specialist_agent_acct, _) = register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 2);
    let rating = rating_pda(&escrow_addr);
    let c_salt = [0xAAu8; 32];
    let c_score: u8 = 9;

    // Only consumer commits
    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, c_score, &c_salt), 0, consumer, escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();

    // Consumer tries to reveal immediately — state is Pending, not BothCommitted
    let r2 = svm.process_instruction(
        &reveal_ix(c_score, c_salt, consumer, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r1.account(&rating).unwrap().clone(),
            consumer_acct.clone(),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );
    assert!(r2.is_err(), "reveal before BothCommitted should fail (BothMustCommitFirst)");
}

/// Test 4: Tampered reveal rejected — wrong salt.
/// Parity: `test_tampered_reveal_rejected` in Anchor reputation.rs
#[test]
fn test_tampered_reveal_rejected() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    let (consumer_agent, consumer_agent_acct, consumer_acct) = register_agent(&mut svm, consumer);
    let (specialist_agent, specialist_agent_acct, _specialist_acct) =
        register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 3);
    let rating = rating_pda(&escrow_addr);
    let real_salt = [0x11u8; 32];
    let wrong_salt = [0xFFu8; 32];
    let c_score: u8 = 5;
    let s_score: u8 = 5;

    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, c_score, &real_salt), 0, consumer, escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();

    let r2 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, s_score, &real_salt), 1, specialist, escrow_addr, rating),
        &[escrow_acct.clone(), r1.account(&rating).unwrap().clone(), funded(specialist)],
    );
    r2.assert_success();

    // Consumer reveals with WRONG salt → CommitmentMismatch
    let r3 = svm.process_instruction(
        &reveal_ix(c_score, wrong_salt, consumer, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r2.account(&rating).unwrap().clone(),
            consumer_acct.clone(),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );
    assert!(r3.is_err(), "reveal with wrong salt should fail (CommitmentMismatch)");
}

/// Test 5: Unauthorized reveal — signer is neither consumer nor specialist.
#[test]
fn test_unauthorized_reveal_rejected() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();

    let (consumer_agent, consumer_agent_acct, _) = register_agent(&mut svm, consumer);
    let (specialist_agent, specialist_agent_acct, _) = register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 6);
    let rating = rating_pda(&escrow_addr);
    let c_salt = [0xAAu8; 32];
    let s_salt = [0xBBu8; 32];
    let c_score: u8 = 7;
    let s_score: u8 = 8;

    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, c_score, &c_salt), 0, consumer, escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();

    let r2 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, s_score, &s_salt), 1, specialist, escrow_addr, rating),
        &[escrow_acct.clone(), r1.account(&rating).unwrap().clone(), funded(specialist)],
    );
    r2.assert_success();

    // Attacker tries to reveal
    let attack = svm.process_instruction(
        &reveal_ix(c_score, c_salt, attacker, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r2.account(&rating).unwrap().clone(),
            funded(attacker),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );
    assert!(attack.is_err(), "unauthorized reveal should fail (UnauthorisedSigner)");
}

/// Test 6: Duplicate commit rejected.
/// Parity: `test_duplicate_commit_rejected` in Anchor reputation.rs
#[test]
fn test_duplicate_commit_rejected() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    register_agent(&mut svm, consumer);
    register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 4);
    let rating = rating_pda(&escrow_addr);
    let salt = [0x55u8; 32];

    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, 8, &salt), 0, consumer, escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();

    // Consumer tries to commit again — AlreadyCommitted
    let r2 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, 9, &salt), 0, consumer, escrow_addr, rating),
        &[
            escrow_acct.clone(),
            r1.account(&rating).unwrap().clone(),
            r1.account(&consumer).unwrap().clone(),
        ],
    );
    assert!(r2.is_err(), "duplicate commit should fail (AlreadyCommitted)");
}

/// Test 7: Expiry boundary — expire rejected before RATING_EXPIRE_SLOTS.
#[test]
fn test_expire_rejected_before_window() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    let (consumer_agent, consumer_agent_acct, consumer_acct) = register_agent(&mut svm, consumer);
    let (specialist_agent, specialist_agent_acct, _) = register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 7);
    let rating = rating_pda(&escrow_addr);
    let c_salt = [0xDDu8; 32];

    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, 8, &c_salt), 0, consumer, escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();

    // Do NOT warp — current slot < RATING_EXPIRE_SLOTS
    let r2 = svm.process_instruction(
        &expire_ix(consumer, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r1.account(&rating).unwrap().clone(),
            consumer_acct.clone(),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );
    assert!(r2.is_err(), "expire before window should fail (NotExpired)");
}

/// Test 8: Expiry boundary — expire succeeds exactly at RATING_EXPIRE_SLOTS + 1.
#[test]
fn test_expire_succeeds_after_window() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    let (consumer_agent, consumer_agent_acct, consumer_acct) = register_agent(&mut svm, consumer);
    let (specialist_agent, specialist_agent_acct, _) = register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 8);
    let rating = rating_pda(&escrow_addr);
    let c_salt = [0xEEu8; 32];

    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, 6, &c_salt), 0, consumer, escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();

    // Warp to exactly 1 slot past expiry window
    svm.sysvars.warp_to_slot(1_512_001);

    let r2 = svm.process_instruction(
        &expire_ix(consumer, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r1.account(&rating).unwrap().clone(),
            consumer_acct.clone(),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );
    r2.assert_success();
    assert_eq!(read_state_byte(&svm, &rating), 3, "state should be Expired");
}

/// Test 9: Commit to already-revealed rating rejected (AlreadyFinalised parity).
#[test]
fn test_commit_to_revealed_rating_rejected() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    let (consumer_agent, consumer_agent_acct, consumer_acct) = register_agent(&mut svm, consumer);
    let (specialist_agent, specialist_agent_acct, specialist_acct) =
        register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 9);
    let rating = rating_pda(&escrow_addr);
    let c_salt = [0xF1u8; 32];
    let s_salt = [0xF2u8; 32];
    let c_score: u8 = 6;
    let s_score: u8 = 8;

    // Full commit-reveal cycle
    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, c_score, &c_salt), 0, consumer, escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();

    let r2 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, s_score, &s_salt), 1, specialist, escrow_addr, rating),
        &[escrow_acct.clone(), r1.account(&rating).unwrap().clone(), funded(specialist)],
    );
    r2.assert_success();

    let r3 = svm.process_instruction(
        &reveal_ix(c_score, c_salt, consumer, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r2.account(&rating).unwrap().clone(),
            consumer_acct.clone(),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );
    r3.assert_success();

    let r4 = svm.process_instruction(
        &reveal_ix(s_score, s_salt, specialist, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r3.account(&rating).unwrap().clone(),
            specialist_acct.clone(),
            r3.account(&specialist_agent).unwrap().clone(),
            r3.account(&consumer_agent).unwrap().clone(),
        ],
    );
    r4.assert_success();

    // Try to commit again on a Revealed rating — should fail (AlreadyFinalised)
    let r5 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, c_score, &c_salt), 0, consumer, escrow_addr, rating),
        &[
            escrow_acct.clone(),
            r4.account(&rating).unwrap().clone(),
            r4.account(&consumer).unwrap().clone(),
        ],
    );
    assert!(r5.is_err(), "commit to Revealed rating should fail (AlreadyFinalised)");
}

/// Test 10: Invalid score rejected (score 0 and score 11).
#[test]
fn test_invalid_score_rejected() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    let (consumer_agent, consumer_agent_acct, consumer_acct) = register_agent(&mut svm, consumer);
    let (specialist_agent, specialist_agent_acct, _specialist_acct) =
        register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 10);
    let rating = rating_pda(&escrow_addr);
    let c_salt = [0xA1u8; 32];
    let s_salt = [0xA2u8; 32];
    let c_score: u8 = 7;
    let s_score: u8 = 7;

    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, c_score, &c_salt), 0, consumer, escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();

    let r2 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, s_score, &s_salt), 1, specialist, escrow_addr, rating),
        &[escrow_acct.clone(), r1.account(&rating).unwrap().clone(), funded(specialist)],
    );
    r2.assert_success();

    // Try reveal with score=0 (invalid sentinel)
    let bad_0 = svm.process_instruction(
        &reveal_ix(0, c_salt, consumer, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r2.account(&rating).unwrap().clone(),
            consumer_acct.clone(),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );
    assert!(bad_0.is_err(), "score=0 should be rejected (InvalidScore)");

    // Try reveal with score=11 (out of range)
    let bad_11 = svm.process_instruction(
        &reveal_ix(11, c_salt, consumer, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r2.account(&rating).unwrap().clone(),
            consumer_acct.clone(),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );
    assert!(bad_11.is_err(), "score=11 should be rejected (InvalidScore)");
}

// ── Audit regressions ─────────────────────────────────────────────────────────

/// Audit regression: MEDIUM-1 — all-zero commitment is rejected because it is the
/// uncommitted sentinel used by RatingAccount.
#[test]
fn test_audit_zero_commitment_rejected() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    register_agent(&mut svm, consumer);
    register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 11);
    let rating = rating_pda(&escrow_addr);

    let result = svm.process_instruction(
        &commit_ix([0u8; 32], 0, consumer, escrow_addr, rating),
        &[escrow_acct, empty(rating), funded(consumer)],
    );

    assert!(
        result.is_err(),
        "audit MEDIUM-1 regression: zero commitment must fail"
    );
}

/// Audit regression: MEDIUM-2 — commitments are domain-separated by escrow and
/// program, so a commitment generated for another job cannot be revealed here.
#[test]
fn test_audit_cross_job_commitment_reuse_rejected() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    let (consumer_agent, consumer_agent_acct, consumer_acct) = register_agent(&mut svm, consumer);
    let (specialist_agent, specialist_agent_acct, _) = register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 12);
    let (other_escrow_addr, _) = escrow(&consumer, &specialist, 13);
    let rating = rating_pda(&escrow_addr);
    let c_salt = [0xCAu8; 32];
    let s_salt = [0xCBu8; 32];

    // Consumer commits a hash computed against a *different* escrow.
    let r1 = svm.process_instruction(
        &commit_ix(
            sha256_commitment(&other_escrow_addr, 8, &c_salt),
            0,
            consumer,
            escrow_addr,
            rating,
        ),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();

    let r2 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, 8, &s_salt), 1, specialist, escrow_addr, rating),
        &[escrow_acct.clone(), r1.account(&rating).unwrap().clone(), funded(specialist)],
    );
    r2.assert_success();

    let reveal = svm.process_instruction(
        &reveal_ix(8, c_salt, consumer, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r2.account(&rating).unwrap().clone(),
            consumer_acct.clone(),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );

    assert!(
        reveal.is_err(),
        "audit MEDIUM-2 regression: cross-job commitment reuse must fail"
    );
}

/// Audit regression: MEDIUM-4 — expiry can only be triggered by the recorded
/// consumer or specialist, not an arbitrary third-party caller.
#[test]
fn test_audit_expire_third_party_rejected() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();

    let (consumer_agent, consumer_agent_acct, _) = register_agent(&mut svm, consumer);
    let (specialist_agent, specialist_agent_acct, _) = register_agent(&mut svm, specialist);

    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 14);
    let rating = rating_pda(&escrow_addr);
    let salt = [0xCCu8; 32];

    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, 8, &salt), 0, consumer, escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(consumer)],
    );
    r1.assert_success();

    svm.sysvars.warp_to_slot(1_512_001);

    let result = svm.process_instruction(
        &expire_ix(attacker, escrow_addr, rating, specialist_agent, consumer_agent),
        &[
            escrow_acct.clone(),
            r1.account(&rating).unwrap().clone(),
            funded(attacker),
            specialist_agent_acct.clone(),
            consumer_agent_acct.clone(),
        ],
    );

    assert!(
        result.is_err(),
        "audit MEDIUM-4 regression: third-party expiry must fail"
    );
}

// ── CRITICAL-1 / CRITICAL-4 job-binding regressions (2026-08-24) ──────────────
//
// These reproduce the audit's PoC steps against the bound program. Each one
// succeeded before the escrow binding and must now fail.

/// CRITICAL-1, step 3 of the audit PoC: the attacker names the real consumer and
/// elects *themselves* specialist, then waits to reveal and harvest the score.
///
/// The attacker can no longer supply either party — both are read from the
/// escrow — so signing as `role = 1` fails the specialist check.
#[test]
fn test_audit_critical1_attacker_cannot_elect_self_specialist() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();

    register_agent(&mut svm, consumer);
    register_agent(&mut svm, specialist);
    register_agent(&mut svm, attacker);

    // A real job between consumer and specialist. The attacker is not a party.
    let (escrow_addr, escrow_acct) = escrow(&consumer, &specialist, 20);
    let rating = rating_pda(&escrow_addr);
    let salt = [0x77u8; 32];

    let attack = svm.process_instruction(
        &commit_ix(
            sha256_commitment(&escrow_addr, 10, &salt),
            1, // specialist
            attacker,
            escrow_addr,
            rating,
        ),
        &[escrow_acct.clone(), empty(rating), funded(attacker)],
    );

    assert_failed_with(
        &attack,
        InstructionError::InvalidArgument,
        "CRITICAL-1 regression: attacker must not be able to elect itself specialist",
    );

    // The consumer role is closed to them too.
    let attack_consumer = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, 10, &salt), 0, attacker, escrow_addr, rating),
        &[escrow_acct.clone(), empty(rating), funded(attacker)],
    );

    assert_failed_with(
        &attack_consumer,
        InstructionError::InvalidArgument,
        "CRITICAL-1 regression: attacker must not be able to claim the consumer role",
    );

    // Positive control on the same fixtures: the escrow's real specialist can
    // commit. This proves the rejections above are about *who signed*, not a
    // broken fixture.
    let legit = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, 7, &salt), 1, specialist, escrow_addr, rating),
        &[escrow_acct, empty(rating), funded(specialist)],
    );
    legit.assert_success();
}

/// CRITICAL-1: a forged escrow. The attacker builds an account with the exact
/// escrow byte layout naming themselves specialist, but owned by a program they
/// control. `InterfaceAccount` must reject it with an owner error before any
/// field is read.
#[test]
fn test_audit_critical1_forged_escrow_rejected() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();

    register_agent(&mut svm, consumer);
    register_agent(&mut svm, attacker);

    let fake_addr = Pubkey::new_unique();
    let rating = rating_pda(&fake_addr);
    let salt = [0x88u8; 32];

    // Owned by an arbitrary program the attacker controls.
    let attacker_owned = forged_escrow(
        fake_addr,
        Pubkey::new_unique(),
        &consumer,
        &attacker,
        99,
        ESCROW_DISCRIMINATOR,
    );

    let attack = svm.process_instruction(
        &commit_ix(sha256_commitment(&fake_addr, 10, &salt), 1, attacker, fake_addr, rating),
        &[attacker_owned, empty(rating), funded(attacker)],
    );
    assert_failed_with(
        &attack,
        InstructionError::IllegalOwner,
        "CRITICAL-1 regression: an escrow owned by another program must be rejected",
    );

    // Owned by the reputation program itself — also not the escrow program.
    let self_owned = forged_escrow(
        fake_addr,
        crate::ID,
        &consumer,
        &attacker,
        99,
        ESCROW_DISCRIMINATOR,
    );

    let attack_self = svm.process_instruction(
        &commit_ix(sha256_commitment(&fake_addr, 10, &salt), 1, attacker, fake_addr, rating),
        &[self_owned, empty(rating), funded(attacker)],
    );
    assert_failed_with(
        &attack_self,
        InstructionError::IllegalOwner,
        "CRITICAL-1 regression: a self-owned look-alike escrow must be rejected",
    );
}

/// CRITICAL-1: right owner, wrong account type. `UserEscrowCounter`
/// (discriminator 9) is owned by `quasar-escrow` and would pass the owner check
/// alone, so `AccountCheck` must reject it on the discriminator.
#[test]
fn test_audit_critical1_wrong_escrow_discriminator_rejected() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();

    register_agent(&mut svm, consumer);
    register_agent(&mut svm, attacker);

    let fake_addr = Pubkey::new_unique();
    let rating = rating_pda(&fake_addr);
    let salt = [0x99u8; 32];

    // Correct owner, but the UserEscrowCounter discriminator.
    let counter = forged_escrow(
        fake_addr,
        QUASAR_ESCROW_PROGRAM_ID,
        &consumer,
        &attacker,
        99,
        9,
    );

    let attack = svm.process_instruction(
        &commit_ix(sha256_commitment(&fake_addr, 10, &salt), 1, attacker, fake_addr, rating),
        &[counter, empty(rating), funded(attacker)],
    );

    assert_failed_with(
        &attack,
        InstructionError::InvalidAccountData,
        "CRITICAL-1 regression: a non-escrow account from the escrow program must be rejected",
    );
}

/// CRITICAL-4, steps 1-3 of the audit PoC: the attacker squats a rating naming
/// the victim, lets it sit Pending, then calls `expire` after the window to
/// deduct the victim's reputation.
///
/// Step 1 now fails, so the grief never starts: the attacker cannot create a
/// rating against two parties they are not part of.
#[test]
fn test_audit_critical4_third_party_cannot_open_rating() {
    let mut svm = setup();
    let victim = Pubkey::new_unique();
    let other_party = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();

    let (victim_agent, victim_agent_acct, _) = register_agent(&mut svm, victim);
    register_agent(&mut svm, other_party);
    register_agent(&mut svm, attacker);

    // A genuine job between two other parties.
    let (escrow_addr, escrow_acct) = escrow(&victim, &other_party, 30);
    let rating = rating_pda(&escrow_addr);
    let salt = [0xABu8; 32];

    let squat = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, 1, &salt), 1, attacker, escrow_addr, rating),
        &[escrow_acct, empty(rating), funded(attacker)],
    );
    assert_failed_with(
        &squat,
        InstructionError::InvalidArgument,
        "CRITICAL-4 regression: a third party must not be able to open a rating",
    );

    // No rating account exists, so there is nothing to expire and the victim's
    // reputation is untouched.
    assert!(
        svm.get_account(&rating).is_none_or(|a| a.data.is_empty()),
        "CRITICAL-4 regression: no rating account should have been created"
    );
    assert_eq!(
        read_jobs_failed(&svm, &victim_agent),
        0,
        "CRITICAL-4 regression: victim must not accrue a failure"
    );
    let _ = victim_agent_acct;
}

/// HIGH-3 partial mitigation: an escrow whose payer and payee are the same
/// wallet is not a job, and cannot be used to farm a mutual rating.
///
/// This does not stop a payer using a second wallet they control — that needs an
/// economic answer and remains open.
#[test]
fn test_audit_self_dealt_escrow_rejected() {
    let mut svm = setup();
    let farmer = Pubkey::new_unique();

    register_agent(&mut svm, farmer);

    let (escrow_addr, escrow_acct) = escrow(&farmer, &farmer, 40);
    let rating = rating_pda(&escrow_addr);
    let salt = [0xBAu8; 32];

    let result = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_addr, 10, &salt), 0, farmer, escrow_addr, rating),
        &[escrow_acct, empty(rating), funded(farmer)],
    );

    assert_failed_with(
        &result,
        InstructionError::InvalidArgument,
        "HIGH-3 partial: a self-dealt escrow (payer == payee) must be rejected",
    );
}

/// The rating PDA is a function of the escrow address, so two jobs between the
/// same pair of parties get distinct ratings, and a rating cannot be reached by
/// presenting a different escrow.
#[test]
fn test_rating_pda_is_bound_to_its_escrow() {
    let mut svm = setup();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();

    register_agent(&mut svm, consumer);
    register_agent(&mut svm, specialist);

    let (escrow_a, escrow_a_acct) = escrow(&consumer, &specialist, 50);
    let (escrow_b, escrow_b_acct) = escrow(&consumer, &specialist, 51);
    let rating_a = rating_pda(&escrow_a);
    let rating_b = rating_pda(&escrow_b);

    assert_ne!(
        rating_a, rating_b,
        "two escrows between the same parties must map to distinct ratings"
    );

    let salt = [0xDEu8; 32];
    let r1 = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_a, 8, &salt), 0, consumer, escrow_a, rating_a),
        &[escrow_a_acct.clone(), empty(rating_a), funded(consumer)],
    );
    r1.assert_success();

    // Presenting escrow B's address alongside escrow A's rating account breaks
    // the seeds constraint.
    let mismatched = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_b, 8, &salt), 1, specialist, escrow_b, rating_a),
        &[
            escrow_b_acct,
            r1.account(&rating_a).unwrap().clone(),
            funded(specialist),
        ],
    );
    assert_failed_with(
        &mismatched,
        ERR_INVALID_PDA,
        "a rating must not be reachable by presenting a different escrow",
    );

    // Positive control: the same specialist commits successfully when the
    // matching escrow is presented.
    let matched = svm.process_instruction(
        &commit_ix(sha256_commitment(&escrow_a, 8, &salt), 1, specialist, escrow_a, rating_a),
        &[
            escrow_a_acct,
            r1.account(&rating_a).unwrap().clone(),
            funded(specialist),
        ],
    );
    matched.assert_success();
}
