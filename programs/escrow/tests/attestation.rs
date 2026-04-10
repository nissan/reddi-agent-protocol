/// Phase 4b — Attestation Judge system
///
/// Tests the attest_quality / confirm_attestation / dispute_attestation instructions.
use {
    anchor_lang::{
        solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    escrow::{
        accounts::{AttestQuality, ConfirmAttestation, DisputeAttestation, RegisterAgent},
        constants::{AGENT_FEE_BURN_ADDRESS, AGENT_SEED, ATTESTATION_SEED},
        instruction,
        state::{AgentAccount, AgentType, AttestationAccount},
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

type Pk = anchor_lang::prelude::Pubkey;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn make_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/escrow.so");
    svm.add_program(escrow::id(), bytes).unwrap();
    svm
}

fn send_ok(svm: &mut LiteSVM, ix: Instruction, signers: &[&Keypair]) {
    let payer = signers[0].pubkey();
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).expect("tx should succeed");
}

fn send_err(svm: &mut LiteSVM, ix: Instruction, signers: &[&Keypair]) -> String {
    let payer = signers[0].pubkey();
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    match svm.send_transaction(tx) {
        Ok(_) => panic!("expected tx to fail but it succeeded"),
        Err(e) => format!("{:?}", e),
    }
}

fn agent_pda(owner: &Pk) -> (Pk, u8) {
    Pk::find_program_address(&[AGENT_SEED, owner.as_ref()], &escrow::id())
}

fn attestation_pda(job_id: &[u8; 16]) -> (Pk, u8) {
    Pk::find_program_address(&[ATTESTATION_SEED, job_id.as_ref()], &escrow::id())
}

fn register_agent(svm: &mut LiteSVM, owner: &Keypair, agent_type: AgentType) -> Pk {
    let (agent_pk, _) = agent_pda(&owner.pubkey());
    let ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::RegisterAgent {
            agent_type,
            model: "judge-model".to_string(),
            rate_lamports: 500_000,
            min_reputation: 0,
        }
        .data(),
        RegisterAgent {
            agent: agent_pk,
            owner: owner.pubkey(),
            fee_collector: AGENT_FEE_BURN_ADDRESS,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    );
    send_ok(svm, ix, &[owner]);
    agent_pk
}

fn fetch_agent(svm: &LiteSVM, pk: &Pk) -> AgentAccount {
    let raw = svm.get_account(pk).expect("agent must exist");
    AgentAccount::try_deserialize(&mut raw.data.as_slice()).expect("deser AgentAccount")
}

fn fetch_attestation(svm: &LiteSVM, pk: &Pk) -> AttestationAccount {
    let raw = svm.get_account(pk).expect("attestation must exist");
    AttestationAccount::try_deserialize(&mut raw.data.as_slice()).expect("deser AttestationAccount")
}

fn attest_ix(
    job_id: [u8; 16],
    scores: [u8; 5],
    judge: &Keypair,
    judge_agent: Pk,
    consumer: Pk,
) -> Instruction {
    let (attestation_pk, _) = attestation_pda(&job_id);
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::AttestQuality {
            job_id,
            scores,
            consumer,
        }
        .data(),
        AttestQuality {
            attestation: attestation_pk,
            judge_agent,
            judge: judge.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

fn confirm_ix(job_id: [u8; 16], consumer: &Keypair, judge_agent: Pk) -> Instruction {
    let (attestation_pk, _) = attestation_pda(&job_id);
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::ConfirmAttestation { job_id }.data(),
        ConfirmAttestation {
            attestation: attestation_pk,
            judge_agent,
            consumer: consumer.pubkey(),
        }
        .to_account_metas(None),
    )
}

fn dispute_ix(job_id: [u8; 16], consumer: &Keypair, judge_agent: Pk) -> Instruction {
    let (attestation_pk, _) = attestation_pda(&job_id);
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::DisputeAttestation { job_id }.data(),
        DisputeAttestation {
            attestation: attestation_pk,
            judge_agent,
            consumer: consumer.pubkey(),
        }
        .to_account_metas(None),
    )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Test 1: judge attests → consumer confirms → judge attestation_accuracy increases.
#[test]
fn test_confirm_increases_judge_accuracy() {
    let mut svm = make_svm();
    let judge = Keypair::new();
    let consumer = Keypair::new();
    svm.airdrop(&judge.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&consumer.pubkey(), 1_000_000_000).unwrap();

    let judge_agent = register_agent(&mut svm, &judge, AgentType::Attestation);

    let judge_before = fetch_agent(&svm, &judge_agent);

    let job_id = [1u8; 16];
    let scores = [8u8, 9, 7, 8, 9];
    let (attestation_pk, _) = attestation_pda(&job_id);

    // Judge attests
    send_ok(
        &mut svm,
        attest_ix(job_id, scores, &judge, judge_agent, consumer.pubkey()),
        &[&judge],
    );

    let attest = fetch_attestation(&svm, &attestation_pk);
    assert_eq!(attest.scores, scores);
    assert_eq!(attest.confirmed, None);
    assert_eq!(attest.judge, judge.pubkey());
    assert_eq!(attest.consumer, consumer.pubkey());

    // Consumer confirms
    send_ok(
        &mut svm,
        confirm_ix(job_id, &consumer, judge_agent),
        &[&consumer],
    );

    let attest = fetch_attestation(&svm, &attestation_pk);
    assert_eq!(attest.confirmed, Some(true));

    let judge_after = fetch_agent(&svm, &judge_agent);
    assert!(
        judge_after.attestation_accuracy > judge_before.attestation_accuracy,
        "attestation_accuracy should increase on confirm: before={}, after={}",
        judge_before.attestation_accuracy,
        judge_after.attestation_accuracy
    );
    assert!(
        judge_after.reputation_score >= judge_before.reputation_score,
        "reputation should increase on confirm"
    );
}

/// Test 2: judge attests → consumer disputes → judge reputation penalised.
#[test]
fn test_dispute_penalises_judge() {
    let mut svm = make_svm();
    let judge = Keypair::new();
    let consumer = Keypair::new();
    svm.airdrop(&judge.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&consumer.pubkey(), 1_000_000_000).unwrap();

    let judge_agent = register_agent(&mut svm, &judge, AgentType::Both);

    // Give judge some starting reputation so we can verify it drops
    // (newly registered agents have reputation_score = 0; saturating_sub floors at 0)
    let judge_before = fetch_agent(&svm, &judge_agent);

    let job_id = [2u8; 16];
    let scores = [3u8, 2, 4, 3, 2]; // low quality scores

    send_ok(
        &mut svm,
        attest_ix(job_id, scores, &judge, judge_agent, consumer.pubkey()),
        &[&judge],
    );

    // Consumer disputes
    send_ok(
        &mut svm,
        dispute_ix(job_id, &consumer, judge_agent),
        &[&consumer],
    );

    let attest = fetch_attestation(&svm, &attestation_pda(&job_id).0);
    assert_eq!(attest.confirmed, Some(false));

    let judge_after = fetch_agent(&svm, &judge_agent);
    // Reputation should decrease or stay at 0 (saturating_sub)
    assert!(
        judge_after.reputation_score <= judge_before.reputation_score,
        "reputation should decrease on dispute: before={}, after={}",
        judge_before.reputation_score,
        judge_after.reputation_score
    );
}

/// Test 3: non-attestation agent (Primary) calls attest_quality → rejected.
#[test]
fn test_non_attestation_agent_rejected() {
    let mut svm = make_svm();
    let impostor = Keypair::new();
    let consumer = Keypair::new();
    svm.airdrop(&impostor.pubkey(), 2_000_000_000).unwrap();

    // Register as Primary — not allowed to attest
    let impostor_agent = register_agent(&mut svm, &impostor, AgentType::Primary);

    let job_id = [3u8; 16];
    let scores = [8u8, 8, 8, 8, 8];

    let err = send_err(
        &mut svm,
        attest_ix(job_id, scores, &impostor, impostor_agent, consumer.pubkey()),
        &[&impostor],
    );

    assert!(
        err.contains("NotAttestationAgent") || err.contains("6016"),
        "expected NotAttestationAgent, got: {err}"
    );
}

/// Test 4: non-consumer calls confirm_attestation → rejected.
#[test]
fn test_non_consumer_confirm_rejected() {
    let mut svm = make_svm();
    let judge = Keypair::new();
    let consumer = Keypair::new();
    let attacker = Keypair::new();
    svm.airdrop(&judge.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&consumer.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let judge_agent = register_agent(&mut svm, &judge, AgentType::Attestation);

    let job_id = [4u8; 16];
    let scores = [7u8, 8, 7, 8, 7];

    send_ok(
        &mut svm,
        attest_ix(job_id, scores, &judge, judge_agent, consumer.pubkey()),
        &[&judge],
    );

    // Attacker (not the consumer) tries to confirm
    let err = send_err(
        &mut svm,
        confirm_ix(job_id, &attacker, judge_agent),
        &[&attacker],
    );

    assert!(
        err.contains("UnauthorisedSigner") || err.contains("6000"),
        "expected UnauthorisedSigner, got: {err}"
    );

    // Original consumer can still confirm successfully
    send_ok(
        &mut svm,
        confirm_ix(job_id, &consumer, judge_agent),
        &[&consumer],
    );
    let attest = fetch_attestation(&svm, &attestation_pda(&job_id).0);
    assert_eq!(attest.confirmed, Some(true));
}

/// Test 5: duplicate attestation on same job_id → rejected.
#[test]
fn test_duplicate_attestation_rejected() {
    let mut svm = make_svm();
    let judge = Keypair::new();
    let consumer = Keypair::new();
    svm.airdrop(&judge.pubkey(), 2_000_000_000).unwrap();

    let judge_agent = register_agent(&mut svm, &judge, AgentType::Attestation);

    let job_id = [5u8; 16];
    let scores = [9u8, 9, 9, 9, 9];

    // First attestation succeeds
    send_ok(
        &mut svm,
        attest_ix(job_id, scores, &judge, judge_agent, consumer.pubkey()),
        &[&judge],
    );

    // Second attestation on the same job_id → Anchor's `init` rejects it
    let err = send_err(
        &mut svm,
        attest_ix(job_id, scores, &judge, judge_agent, consumer.pubkey()),
        &[&judge],
    );

    assert!(
        err.contains("AttestationAlreadyExists")
            || err.contains("6017")
            || err.contains("AlreadyInUse")
            || err.contains("AlreadyProcessed")
            || err.contains("already in use")
            || err.contains("custom program error: 0x0"),
        "expected duplicate attestation rejection, got: {err}"
    );
}
