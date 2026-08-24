/// QuasarSVM tests for the Quasar attestation judges.
///
/// Parity with Anchor `tests/attestation.rs`:
///   1. happy path — attest → confirm: judge accuracy + rep increase
///   2. happy path — attest → dispute: judge reputation penalised
///   3. non-attestation agent (Primary) calls attest → rejected
///   4. non-consumer calls confirm → rejected; original consumer succeeds
///   5. duplicate attestation on same job_id → rejected (init guard)
///
/// Additional QuasarSVM tests (state invariants + invalid transitions):
///   6. non-consumer calls dispute → rejected
///   7. double-confirm (confirm after confirm) → rejected
///   8. double-dispute (dispute after dispute) → rejected
///   9. dispute after confirm → rejected
///  10. confirm after dispute → rejected
///  11. score out of range (0) → rejected
///  12. score out of range (11) → rejected
///
/// Audit regressions: CRITICAL-2 (judge self-confirmation) and CRITICAL-3
/// (unbounded attestation creation), added with the escrow job binding.
///
/// # Escrow binding in tests
///
/// These tests load only `quasar-attestation`, so escrow accounts are installed
/// directly as byte images owned by the `quasar-escrow` program id. That is
/// exactly the surface this program trusts — account owner plus discriminator —
/// so it exercises the real check, and it lets the negative tests forge accounts
/// a live escrow program would never produce.
extern crate std;

use {
    quasar_escrow_ref::{ESCROW_DISCRIMINATOR, QUASAR_ESCROW_PROGRAM_ID},
    quasar_lang::traits::HasSeeds,
    quasar_svm::{Account, AccountMeta, Instruction, InstructionError, Pubkey, QuasarSvm},
    std::{println, vec, vec::Vec},
};

// ── Setup ─────────────────────────────────────────────────────────────────────

fn setup() -> QuasarSvm {
    let elf = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/target/deploy/quasar_attestation.so"
    ))
    .expect(
        "build .so first: \
         cargo build-sbf --manifest-path experiments/quasar-attestation/Cargo.toml",
    );
    QuasarSvm::new().with_program(&crate::ID, &elf)
}

fn empty_account(address: Pubkey) -> Account {
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

/// Attestation PDA — seeded by the **escrow address**, not a judge-chosen job id.
fn attestation_pda(escrow: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            <crate::state::AttestationAccount as HasSeeds>::SEED_PREFIX,
            escrow.as_ref(),
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
    data[81] = 0; // EscrowStatus::Locked — the escrow exists only while locked
    data
}

/// Installs a well-formed escrow (correct owner and discriminator) into the SVM
/// and returns its address. `payer` becomes the attestation's consumer.
fn install_escrow(svm: &mut QuasarSvm, payer: &Pubkey, payee: &Pubkey, escrow_id: u64) -> Pubkey {
    let address = escrow_pda(payer, escrow_id);
    svm.set_account(Account {
        address,
        lamports: 2_000_000,
        data: escrow_image(payer, payee, escrow_id, ESCROW_DISCRIMINATOR),
        owner: QUASAR_ESCROW_PROGRAM_ID,
        executable: false,
    });
    address
}

/// Installs an escrow-shaped account with a caller-chosen owner and
/// discriminator — used by the CRITICAL-3 negative tests to forge a job record.
fn install_forged_escrow(
    svm: &mut QuasarSvm,
    owner: Pubkey,
    payer: &Pubkey,
    payee: &Pubkey,
    escrow_id: u64,
    discriminator: u8,
) -> Pubkey {
    let address = escrow_pda(payer, escrow_id);
    svm.set_account(Account {
        address,
        lamports: 2_000_000,
        data: escrow_image(payer, payee, escrow_id, discriminator),
        owner,
        executable: false,
    });
    address
}

/// Asserts an instruction failed with a specific `InstructionError`.
///
/// Negative tests are only meaningful if they fail for the *intended* reason —
/// a missing account or a malformed instruction would also produce `is_err()`.
fn assert_failed_with(
    result: &quasar_svm::ExecutionResult,
    expected: InstructionError,
    context: &str,
) {
    match &result.raw_result {
        Err(actual) if *actual == expected => {}
        Err(actual) => panic!("{}: expected {:?}, got {:?}", context, expected, actual),
        Ok(()) => panic!("{}: expected {:?}, but the instruction succeeded", context, expected),
    }
}

fn u64_le(v: u64) -> [u8; 8] {
    v.to_le_bytes()
}

// ── Instruction builders ───────────────────────────────────────────────────────

/// Discriminator 0: register (owner = payer/signer)
fn register_ix(payer: &Pubkey, agent_pda: &Pubkey, agent_type: u8, model: &str) -> Instruction {
    let model_bytes = model.as_bytes();
    let model_len = model_bytes.len() as u8;
    let mut model_data = [0u8; 64];
    model_data[..model_bytes.len()].copy_from_slice(model_bytes);

    // disc(1) + agent_type(1) + model_len(1) + model_data(64) + rate_lamports(8) + min_reputation(1)
    let mut data = vec![0u8]; // discriminator 0
    data.push(agent_type);
    data.push(model_len);
    data.extend_from_slice(&model_data);
    data.extend_from_slice(&u64_le(500_000));
    data.push(0u8); // min_reputation

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(*agent_pda, false),
            AccountMeta::new(*payer, true),
            AccountMeta::new(fee_collector(), false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

/// Discriminator 1: attest.
///
/// Takes only `scores` — the job identity and the consumer come from the escrow.
fn attest_ix(
    judge: &Pubkey,
    judge_agent: &Pubkey,
    escrow: &Pubkey,
    scores: [u8; 5],
) -> Instruction {
    let attestation_pk = attestation_pda(escrow);

    // disc(1) + scores(5)
    let mut data = vec![1u8]; // discriminator 1
    data.extend_from_slice(&scores);

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(*escrow, false),
            AccountMeta::new(attestation_pk, false),
            AccountMeta::new_readonly(*judge_agent, false),
            AccountMeta::new(*judge, true),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

/// Discriminator 2: confirm. Takes no instruction arguments; the escrow is
/// passed as the attestation PDA's seed.
fn confirm_ix(
    consumer: &Pubkey,
    escrow: &Pubkey,
    attestation_pk: &Pubkey,
    judge_agent: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(*escrow, false),
            AccountMeta::new(*attestation_pk, false),
            AccountMeta::new(*judge_agent, false),
            AccountMeta::new_readonly(*consumer, true),
        ],
        data: vec![2u8],
    }
}

/// Discriminator 3: dispute. Takes no instruction arguments; the escrow is
/// passed as the attestation PDA's seed.
fn dispute_ix(
    consumer: &Pubkey,
    escrow: &Pubkey,
    attestation_pk: &Pubkey,
    judge_agent: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(*escrow, false),
            AccountMeta::new(*attestation_pk, false),
            AccountMeta::new(*judge_agent, false),
            AccountMeta::new_readonly(*consumer, true),
        ],
        data: vec![3u8],
    }
}

// ── State readers ─────────────────────────────────────────────────────────────

/// Read reputation_score (u16 LE) from AgentAccount.
/// Layout (disc=1): owner(32)+agent_type(1)+model_len(1)+_pad(6)+rate_lamports(8)+
///   min_reputation(1)+_pad2(1) = offset 51 from start of data
fn read_reputation_score(svm: &QuasarSvm, pk: &Pubkey) -> u16 {
    let acc = svm.get_account(pk).expect("agent account must exist");
    let lo = acc.data[51] as u16;
    let hi = acc.data[52] as u16;
    lo | (hi << 8)
}

/// Read attestation_accuracy (u16 LE) from AgentAccount.
/// Offset: 51(rep_score)+2+4(_pad3)+8+8+8(jobs/time)+1+1(active/bump) = 83
fn read_attestation_accuracy(svm: &QuasarSvm, pk: &Pubkey) -> u16 {
    let acc = svm.get_account(pk).expect("agent account must exist");
    let lo = acc.data[83] as u16;
    let hi = acc.data[84] as u16;
    lo | (hi << 8)
}

/// Read confirmed status byte from AttestationAccount.
/// Layout (disc=1): escrow(32)+job_id(16)+judge(32)+consumer(32)+scores(5)
fn read_confirmed_status(svm: &QuasarSvm, pk: &Pubkey) -> u8 {
    let acc = svm.get_account(pk).expect("attestation account must exist");
    acc.data[1 + 32 + 16 + 32 + 32 + 5] // 118
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/// Register a judge agent. Funds are airdropped; PDA created.
/// Returns (agent_pda, consumer_pubkey).
fn register_judge(svm: &mut QuasarSvm, judge: &Pubkey, agent_type: u8) -> Pubkey {
    let agent = agent_pda(judge);
    svm.airdrop(judge, 5_000_000_000);
    svm.airdrop(&fee_collector(), 0); // ensure exists

    let result = svm.process_instruction(
        &register_ix(judge, &agent, agent_type, "judge-model"),
        &[empty_account(agent)],
    );
    result.expect("register judge");
    agent
}

/// Attest a job. Judge must already be registered.
/// Returns attestation_pda.
fn do_attest(
    svm: &mut QuasarSvm,
    judge: &Pubkey,
    judge_agent: &Pubkey,
    escrow: &Pubkey,
    scores: [u8; 5],
) -> Pubkey {
    let att_pk = attestation_pda(escrow);
    let result = svm.process_instruction(
        &attest_ix(judge, judge_agent, escrow, scores),
        &[empty_account(att_pk)],
    );
    result.expect("attest_quality");
    att_pk
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Test 1: judge attests → consumer confirms → judge attestation_accuracy and rep increase.
/// Parity: Anchor `test_confirm_increases_judge_accuracy`
#[test]
fn test_confirm_increases_judge_accuracy() {
    println!("\n=== test_confirm_increases_judge_accuracy ===");
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    svm.airdrop(&consumer, 1_000_000_000);

    let judge_agent = register_judge(&mut svm, &judge, 1); // Attestation
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 1);
    let att_pk = do_attest(&mut svm, &judge, &judge_agent, &escrow, [8u8, 9, 7, 8, 9]);

    let rep_before = read_reputation_score(&svm, &judge_agent);
    let acc_before = read_attestation_accuracy(&svm, &judge_agent);

    // Consumer confirms
    let result = svm.process_instruction(
        &confirm_ix(&consumer, &escrow, &att_pk, &judge_agent),
        &[],
    );
    result.expect("confirm_attestation");

    let status = read_confirmed_status(&svm, &att_pk);
    assert_eq!(status, 1, "attestation should be Confirmed (1)");

    let rep_after = read_reputation_score(&svm, &judge_agent);
    let acc_after = read_attestation_accuracy(&svm, &judge_agent);

    assert!(
        acc_after > acc_before,
        "attestation_accuracy should increase on confirm: before={}, after={}",
        acc_before, acc_after
    );
    assert!(
        rep_after >= rep_before,
        "reputation should increase on confirm: before={}, after={}",
        rep_before, rep_after
    );
    println!("✅ accuracy: {} → {}, rep: {} → {}", acc_before, acc_after, rep_before, rep_after);
}

/// Test 2: judge attests → consumer disputes → judge reputation penalised.
/// Parity: Anchor `test_dispute_penalises_judge`
#[test]
fn test_dispute_penalises_judge() {
    println!("\n=== test_dispute_penalises_judge ===");
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    svm.airdrop(&consumer, 1_000_000_000);

    let judge_agent = register_judge(&mut svm, &judge, 2); // Both
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 2);
    let att_pk = do_attest(&mut svm, &judge, &judge_agent, &escrow, [3u8, 2, 4, 3, 2]);

    let rep_before = read_reputation_score(&svm, &judge_agent);

    // Consumer disputes
    let result = svm.process_instruction(
        &dispute_ix(&consumer, &escrow, &att_pk, &judge_agent),
        &[],
    );
    result.expect("dispute_attestation");

    let status = read_confirmed_status(&svm, &att_pk);
    assert_eq!(status, 2, "attestation should be Disputed (2)");

    let rep_after = read_reputation_score(&svm, &judge_agent);
    assert!(
        rep_after <= rep_before,
        "reputation should not increase on dispute: before={}, after={}",
        rep_before, rep_after
    );
    println!("✅ rep before={}, after={} (saturating_sub applied)", rep_before, rep_after);
}

/// Test 3: non-attestation agent (Primary) calls attest → rejected.
/// Parity: Anchor `test_non_attestation_agent_rejected`
#[test]
fn test_non_attestation_agent_rejected() {
    println!("\n=== test_non_attestation_agent_rejected ===");
    let mut svm = setup();

    let impostor = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();

    // Register as Primary (agent_type = 0)
    let impostor_agent = register_judge(&mut svm, &impostor, 0);
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 3);
    let att_pk = attestation_pda(&escrow);

    let result = svm.process_instruction(
        &attest_ix(&impostor, &impostor_agent, &escrow, [8u8; 5]),
        &[empty_account(att_pk)],
    );
    assert!(result.is_err(), "Primary agent should not be allowed to attest");
    println!("✅ Primary agent attest correctly rejected");
}

/// Test 4: non-consumer calls confirm → rejected; original consumer succeeds.
/// Parity: Anchor `test_non_consumer_confirm_rejected`
#[test]
fn test_non_consumer_confirm_rejected() {
    println!("\n=== test_non_consumer_confirm_rejected ===");
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();
    svm.airdrop(&consumer, 1_000_000_000);
    svm.airdrop(&attacker, 1_000_000_000);

    let judge_agent = register_judge(&mut svm, &judge, 1);
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 4);
    let att_pk = do_attest(&mut svm, &judge, &judge_agent, &escrow, [7u8, 8, 7, 8, 7]);

    // Attacker tries to confirm
    let bad_result = svm.process_instruction(
        &confirm_ix(&attacker, &escrow, &att_pk, &judge_agent),
        &[],
    );
    assert!(bad_result.is_err(), "Non-consumer confirm should be rejected");
    assert_eq!(read_confirmed_status(&svm, &att_pk), 0, "still Pending after failed confirm");

    // Original consumer can still confirm
    let good_result = svm.process_instruction(
        &confirm_ix(&consumer, &escrow, &att_pk, &judge_agent),
        &[],
    );
    good_result.expect("Consumer confirm should succeed");
    assert_eq!(read_confirmed_status(&svm, &att_pk), 1, "Confirmed after consumer confirms");
    println!("✅ Non-consumer rejected, consumer confirmed successfully");
}

/// Test 5: duplicate attestation on same job_id → rejected (init guard).
/// Parity: Anchor `test_duplicate_attestation_rejected`
#[test]
fn test_duplicate_attestation_rejected() {
    println!("\n=== test_duplicate_attestation_rejected ===");
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();

    let judge_agent = register_judge(&mut svm, &judge, 1);
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 5);
    let att_pk = attestation_pda(&escrow);

    // First attestation succeeds
    let r1 = svm.process_instruction(
        &attest_ix(&judge, &judge_agent, &escrow, [9u8; 5]),
        &[empty_account(att_pk)],
    );
    r1.expect("first attest");

    // Second attestation on the same job_id → init constraint rejects
    let r2 = svm.process_instruction(
        &attest_ix(&judge, &judge_agent, &escrow, [9u8; 5]),
        &[], // att_pk is already in svm DB (exists)
    );
    assert!(r2.is_err(), "Duplicate attestation should be rejected by init constraint");
    println!("✅ Duplicate attestation correctly rejected");
}

/// Test 6: non-consumer calls dispute → rejected.
#[test]
fn test_non_consumer_dispute_rejected() {
    println!("\n=== test_non_consumer_dispute_rejected ===");
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();
    svm.airdrop(&attacker, 1_000_000_000);

    let judge_agent = register_judge(&mut svm, &judge, 1);
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 6);
    let att_pk = do_attest(&mut svm, &judge, &judge_agent, &escrow, [6u8; 5]);

    let result = svm.process_instruction(
        &dispute_ix(&attacker, &escrow, &att_pk, &judge_agent),
        &[],
    );
    assert!(result.is_err(), "Non-consumer dispute should be rejected");
    assert_eq!(read_confirmed_status(&svm, &att_pk), 0, "still Pending after failed dispute");
    println!("✅ Non-consumer dispute correctly rejected");
}

/// Test 7: double-confirm (confirm after confirm) → rejected.
/// Parity: Anchor `AttestationAlreadyResolved`
#[test]
fn test_double_confirm_rejected() {
    println!("\n=== test_double_confirm_rejected ===");
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    svm.airdrop(&consumer, 1_000_000_000);

    let judge_agent = register_judge(&mut svm, &judge, 1);
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 7);
    let att_pk = do_attest(&mut svm, &judge, &judge_agent, &escrow, [8u8; 5]);

    // First confirm — should succeed
    svm.process_instruction(&confirm_ix(&consumer, &escrow, &att_pk, &judge_agent), &[])
        .expect("first confirm");

    // Second confirm — should fail
    let r2 = svm.process_instruction(&confirm_ix(&consumer, &escrow, &att_pk, &judge_agent), &[]);
    assert!(r2.is_err(), "Double-confirm should be rejected");
    println!("✅ Double-confirm correctly rejected");
}

/// Test 8: double-dispute (dispute after dispute) → rejected.
#[test]
fn test_double_dispute_rejected() {
    println!("\n=== test_double_dispute_rejected ===");
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    svm.airdrop(&consumer, 1_000_000_000);

    let judge_agent = register_judge(&mut svm, &judge, 1);
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 8);
    let att_pk = do_attest(&mut svm, &judge, &judge_agent, &escrow, [5u8; 5]);

    // First dispute — should succeed
    svm.process_instruction(&dispute_ix(&consumer, &escrow, &att_pk, &judge_agent), &[])
        .expect("first dispute");

    // Second dispute — should fail
    let r2 = svm.process_instruction(&dispute_ix(&consumer, &escrow, &att_pk, &judge_agent), &[]);
    assert!(r2.is_err(), "Double-dispute should be rejected");
    println!("✅ Double-dispute correctly rejected");
}

/// Test 9: dispute after confirm → rejected.
#[test]
fn test_dispute_after_confirm_rejected() {
    println!("\n=== test_dispute_after_confirm_rejected ===");
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    svm.airdrop(&consumer, 1_000_000_000);

    let judge_agent = register_judge(&mut svm, &judge, 2);
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 9);
    let att_pk = do_attest(&mut svm, &judge, &judge_agent, &escrow, [8u8; 5]);

    // Confirm first
    svm.process_instruction(&confirm_ix(&consumer, &escrow, &att_pk, &judge_agent), &[])
        .expect("confirm");
    assert_eq!(read_confirmed_status(&svm, &att_pk), 1);

    // Attempt dispute after confirm
    let r = svm.process_instruction(&dispute_ix(&consumer, &escrow, &att_pk, &judge_agent), &[]);
    assert!(r.is_err(), "Dispute after confirm should be rejected");
    println!("✅ Dispute after confirm correctly rejected");
}

/// Test 10: confirm after dispute → rejected.
#[test]
fn test_confirm_after_dispute_rejected() {
    println!("\n=== test_confirm_after_dispute_rejected ===");
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    svm.airdrop(&consumer, 1_000_000_000);

    let judge_agent = register_judge(&mut svm, &judge, 2);
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 10);
    let att_pk = do_attest(&mut svm, &judge, &judge_agent, &escrow, [4u8; 5]);

    // Dispute first
    svm.process_instruction(&dispute_ix(&consumer, &escrow, &att_pk, &judge_agent), &[])
        .expect("dispute");
    assert_eq!(read_confirmed_status(&svm, &att_pk), 2);

    // Attempt confirm after dispute
    let r = svm.process_instruction(&confirm_ix(&consumer, &escrow, &att_pk, &judge_agent), &[]);
    assert!(r.is_err(), "Confirm after dispute should be rejected");
    println!("✅ Confirm after dispute correctly rejected");
}

/// Test 11: score out of range (0) → rejected.
/// Parity: Anchor `AttestationScoreOutOfRange`
#[test]
fn test_score_zero_rejected() {
    println!("\n=== test_score_zero_rejected ===");
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();

    let judge_agent = register_judge(&mut svm, &judge, 1);
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 11);
    let att_pk = attestation_pda(&escrow);

    // Score [0, 8, 8, 8, 8] — first score is 0 (invalid)
    let result = svm.process_instruction(
        &attest_ix(&judge, &judge_agent, &escrow, [0u8, 8, 8, 8, 8]),
        &[empty_account(att_pk)],
    );
    assert!(result.is_err(), "Score 0 should be rejected");
    println!("✅ Score 0 correctly rejected");
}

/// Test 12: score out of range (11) → rejected.
#[test]
fn test_score_eleven_rejected() {
    println!("\n=== test_score_eleven_rejected ===");
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();

    let judge_agent = register_judge(&mut svm, &judge, 1);
    let specialist = Pubkey::new_unique();
    let escrow = install_escrow(&mut svm, &consumer, &specialist, 12);
    let att_pk = attestation_pda(&escrow);

    // Score [8, 8, 8, 8, 11] — last score is 11 (invalid)
    let result = svm.process_instruction(
        &attest_ix(&judge, &judge_agent, &escrow, [8u8, 8, 8, 8, 11]),
        &[empty_account(att_pk)],
    );
    assert!(result.is_err(), "Score 11 should be rejected");
    println!("✅ Score 11 correctly rejected");
}

// ── CRITICAL-2 / CRITICAL-3 job-binding regressions (2026-08-24) ─────────────
//
// These reproduce the audit's attack steps against the bound program. Each one
// succeeded before the escrow binding and must now fail.

/// CRITICAL-2: the judge attests on a job where *they* are the escrow payer, so
/// `attestation.consumer` would be the judge, and they could then confirm their
/// own attestation for the accuracy reward.
///
/// Before binding, the judge simply wrote their own address into the `consumer`
/// argument. That argument no longer exists — `consumer` is `escrow.payer` — so
/// the attack now requires being the payer of a real escrow, and the retained
/// `judge != consumer` guard rejects exactly that.
#[test]
fn test_audit_critical2_judge_as_consumer_rejected() {
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();
    let judge_agent = register_judge(&mut svm, &judge, 1); // Attestation

    // The judge is the escrow's payer, so the escrow names them the consumer.
    let escrow = install_escrow(&mut svm, &judge, &specialist, 9_002);
    let att_pk = attestation_pda(&escrow);

    let result = svm.process_instruction(
        &attest_ix(&judge, &judge_agent, &escrow, [10u8; 5]),
        &[empty_account(att_pk)],
    );

    assert_failed_with(
        &result,
        InstructionError::InvalidArgument,
        "CRITICAL-2 regression: a judge must not attest a job they are the consumer of",
    );
}

/// CRITICAL-2, related: a judge must not grade their own work either. The escrow
/// now tells the program who performed the job, so this is checkable for the
/// first time.
#[test]
fn test_audit_critical2_judge_as_specialist_rejected() {
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    let judge_agent = register_judge(&mut svm, &judge, 1);

    // The judge is the escrow's payee — they did the work being graded.
    let escrow = install_escrow(&mut svm, &consumer, &judge, 9_003);
    let att_pk = attestation_pda(&escrow);

    let result = svm.process_instruction(
        &attest_ix(&judge, &judge_agent, &escrow, [10u8; 5]),
        &[empty_account(att_pk)],
    );

    assert_failed_with(
        &result,
        InstructionError::InvalidArgument,
        "CRITICAL-2 regression: a judge must not grade a job they performed",
    );
}

/// CRITICAL-3: attestation creation is bounded by real escrows. A judge who
/// forges an escrow-shaped account they own cannot create an attestation.
#[test]
fn test_audit_critical3_forged_escrow_rejected() {
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();
    let judge_agent = register_judge(&mut svm, &judge, 1);

    // Owned by an arbitrary program the judge controls.
    let forged = install_forged_escrow(
        &mut svm,
        Pubkey::new_unique(),
        &consumer,
        &specialist,
        9_004,
        ESCROW_DISCRIMINATOR,
    );
    let att_pk = attestation_pda(&forged);

    let result = svm.process_instruction(
        &attest_ix(&judge, &judge_agent, &forged, [10u8; 5]),
        &[empty_account(att_pk)],
    );
    assert_failed_with(
        &result,
        InstructionError::IllegalOwner,
        "CRITICAL-3 regression: an escrow owned by another program must be rejected",
    );

    // Owned by the attestation program itself — also not the escrow program.
    let self_owned = install_forged_escrow(
        &mut svm,
        crate::ID,
        &consumer,
        &specialist,
        9_005,
        ESCROW_DISCRIMINATOR,
    );
    let att_pk2 = attestation_pda(&self_owned);

    let result2 = svm.process_instruction(
        &attest_ix(&judge, &judge_agent, &self_owned, [10u8; 5]),
        &[empty_account(att_pk2)],
    );
    assert_failed_with(
        &result2,
        InstructionError::IllegalOwner,
        "CRITICAL-3 regression: a self-owned look-alike escrow must be rejected",
    );
}

/// CRITICAL-3: right owner, wrong account type. `UserEscrowCounter`
/// (discriminator 9) is owned by `quasar-escrow` and passes the owner check, so
/// `AccountCheck` must reject it on the discriminator.
#[test]
fn test_audit_critical3_wrong_escrow_discriminator_rejected() {
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();
    let judge_agent = register_judge(&mut svm, &judge, 1);

    let counter = install_forged_escrow(
        &mut svm,
        QUASAR_ESCROW_PROGRAM_ID,
        &consumer,
        &specialist,
        9_006,
        9, // UserEscrowCounter
    );
    let att_pk = attestation_pda(&counter);

    let result = svm.process_instruction(
        &attest_ix(&judge, &judge_agent, &counter, [10u8; 5]),
        &[empty_account(att_pk)],
    );

    assert_failed_with(
        &result,
        InstructionError::InvalidAccountData,
        "CRITICAL-3 regression: a non-escrow account from the escrow program must be rejected",
    );
}

/// CRITICAL-3: squatting is now per-escrow rather than per-guessable-job-id. Two
/// distinct escrows yield distinct attestation PDAs, and a judge attesting one
/// cannot block the other — so pre-creating attestations on guessed ids is no
/// longer possible.
#[test]
fn test_audit_critical3_attestation_is_bound_to_its_escrow() {
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let consumer = Pubkey::new_unique();
    let specialist = Pubkey::new_unique();
    let judge_agent = register_judge(&mut svm, &judge, 1);

    let escrow_a = install_escrow(&mut svm, &consumer, &specialist, 9_007);
    let escrow_b = install_escrow(&mut svm, &consumer, &specialist, 9_008);

    assert_ne!(
        attestation_pda(&escrow_a),
        attestation_pda(&escrow_b),
        "two escrows must map to distinct attestations"
    );

    // Attesting job A leaves job B attestable — no cross-job squatting.
    let att_a = do_attest(&mut svm, &judge, &judge_agent, &escrow_a, [8u8; 5]);
    let att_b = do_attest(&mut svm, &judge, &judge_agent, &escrow_b, [7u8; 5]);
    assert_ne!(att_a, att_b);

    // And a second attestation on escrow A is still rejected by `init`.
    let dup = svm.process_instruction(
        &attest_ix(&judge, &judge_agent, &escrow_a, [9u8; 5]),
        &[],
    );
    assert!(
        dup.is_err(),
        "CRITICAL-3 regression: one attestation per escrow"
    );
}

/// A self-dealt escrow (payer == payee) is not a job and cannot be attested.
#[test]
fn test_audit_self_dealt_escrow_rejected() {
    let mut svm = setup();

    let judge = Pubkey::new_unique();
    let farmer = Pubkey::new_unique();
    let judge_agent = register_judge(&mut svm, &judge, 1);

    let escrow = install_escrow(&mut svm, &farmer, &farmer, 9_009);
    let att_pk = attestation_pda(&escrow);

    let result = svm.process_instruction(
        &attest_ix(&judge, &judge_agent, &escrow, [10u8; 5]),
        &[empty_account(att_pk)],
    );

    assert_failed_with(
        &result,
        InstructionError::InvalidArgument,
        "a self-dealt escrow (payer == payee) must not be attestable",
    );
}
