/// Phase 4 — Blind Commit-Reveal Reputation
///
/// Tests the commit_rating / reveal_rating / expire_rating instruction suite.
/// All tests use LiteSVM in-process.
use {
    anchor_lang::{
        solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    escrow::{
        accounts::{CommitRating, ExpireRating, RegisterAgent, RevealRating},
        constants::{AGENT_FEE_BURN_ADDRESS, AGENT_SEED, RATING_EXPIRE_SLOTS, RATING_SEED},
        instruction,
        state::{AgentAccount, AgentType, RatingAccount, RatingRole, RatingState},
    },
    litesvm::LiteSVM,
    sha2::{Digest, Sha256},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn make_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/escrow.so");
    svm.add_program(escrow::id(), bytes).unwrap();
    svm
}

fn send_ok(svm: &mut LiteSVM, ix: Instruction, signers: &[&Keypair]) {
    let payer_pk = signers[0].pubkey();
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer_pk), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).expect("tx should succeed");
}

fn send_err(svm: &mut LiteSVM, ix: Instruction, signers: &[&Keypair]) -> String {
    let payer_pk = signers[0].pubkey();
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer_pk), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    match svm.send_transaction(tx) {
        Ok(_) => panic!("expected tx to fail but it succeeded"),
        Err(e) => format!("{:?}", e),
    }
}

type Pk = anchor_lang::prelude::Pubkey;

fn agent_pda(owner: &Pk) -> (Pk, u8) {
    Pk::find_program_address(&[AGENT_SEED, owner.as_ref()], &escrow::id())
}

fn rating_pda(job_id: &[u8; 16]) -> (Pk, u8) {
    Pk::find_program_address(&[RATING_SEED, job_id.as_ref()], &escrow::id())
}

fn sha256_commitment(score: u8, salt: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update([score]);
    h.update(salt);
    h.finalize().into()
}

fn register_agent_for(svm: &mut LiteSVM, owner: &Keypair) -> Pk {
    let (agent_pk, _) = agent_pda(&owner.pubkey());
    let ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::RegisterAgent {
            agent_type: AgentType::Primary,
            model: "test".to_string(),
            rate_lamports: 1_000_000,
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

fn fetch_rating(svm: &LiteSVM, pk: &Pk) -> RatingAccount {
    let raw = svm.get_account(pk).expect("rating must exist");
    RatingAccount::try_deserialize(&mut raw.data.as_slice()).expect("deser RatingAccount")
}

/// Build a commit_rating instruction.
///
/// Both `consumer_pk` and `specialist_pk` must be passed so the on-chain
/// program can store them on first commit and later load both AgentAccounts
/// in reveal/expire.
fn commit_ix(
    job_id: [u8; 16],
    commitment: [u8; 32],
    role: RatingRole,
    signer: &Keypair,
    consumer_pk: Pk,
    specialist_pk: Pk,
) -> Instruction {
    let (rating_pk, _) = rating_pda(&job_id);
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::CommitRating {
            job_id,
            commitment,
            role,
            consumer_pk,
            specialist_pk,
        }
        .data(),
        CommitRating {
            rating: rating_pk,
            signer: signer.pubkey(),
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

fn reveal_ix(
    job_id: [u8; 16],
    score: u8,
    salt: [u8; 32],
    signer: &Keypair,
    consumer_agent: Pk,
    specialist_agent: Pk,
) -> Instruction {
    let (rating_pk, _) = rating_pda(&job_id);
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::RevealRating {
            job_id,
            score,
            salt,
        }
        .data(),
        RevealRating {
            rating: rating_pk,
            signer: signer.pubkey(),
            specialist_agent,
            consumer_agent,
        }
        .to_account_metas(None),
    )
}

fn expire_ix(
    job_id: [u8; 16],
    caller: &Keypair,
    consumer_agent: Pk,
    specialist_agent: Pk,
) -> Instruction {
    let (rating_pk, _) = rating_pda(&job_id);
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::ExpireRating { job_id }.data(),
        ExpireRating {
            rating: rating_pk,
            caller: caller.pubkey(),
            specialist_agent,
            consumer_agent,
        }
        .to_account_metas(None),
    )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Test 1: full happy path — both commit, both reveal, scores applied.
#[test]
fn test_commit_and_reveal_both() {
    let mut svm = make_svm();
    let consumer = Keypair::new();
    let specialist = Keypair::new();
    svm.airdrop(&consumer.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&specialist.pubkey(), 2_000_000_000).unwrap();

    let consumer_agent = register_agent_for(&mut svm, &consumer);
    let specialist_agent = register_agent_for(&mut svm, &specialist);

    let job_id = [1u8; 16];
    let (rating_pk, _) = rating_pda(&job_id);
    let c_salt = [0xAAu8; 32];
    let s_salt = [0xBBu8; 32];
    let c_score: u8 = 8;
    let s_score: u8 = 7;

    // Both commit (consumer goes first, passing both pubkeys)
    send_ok(
        &mut svm,
        commit_ix(
            job_id,
            sha256_commitment(c_score, &c_salt),
            RatingRole::Consumer,
            &consumer,
            consumer.pubkey(),
            specialist.pubkey(),
        ),
        &[&consumer],
    );
    send_ok(
        &mut svm,
        commit_ix(
            job_id,
            sha256_commitment(s_score, &s_salt),
            RatingRole::Specialist,
            &specialist,
            consumer.pubkey(),
            specialist.pubkey(),
        ),
        &[&specialist],
    );

    assert_eq!(
        fetch_rating(&svm, &rating_pk).state,
        RatingState::BothCommitted
    );

    // Consumer reveals first
    send_ok(
        &mut svm,
        reveal_ix(
            job_id,
            c_score,
            c_salt,
            &consumer,
            consumer_agent,
            specialist_agent,
        ),
        &[&consumer],
    );

    // Specialist reveals — triggers finalisation
    send_ok(
        &mut svm,
        reveal_ix(
            job_id,
            s_score,
            s_salt,
            &specialist,
            consumer_agent,
            specialist_agent,
        ),
        &[&specialist],
    );

    let r = fetch_rating(&svm, &rating_pk);
    assert_eq!(r.state, RatingState::Revealed);
    assert_eq!(r.consumer_score, Some(c_score));
    assert_eq!(r.specialist_score, Some(s_score));

    let spec = fetch_agent(&svm, &specialist_agent);
    assert!(
        spec.reputation_score > 0,
        "specialist reputation should update"
    );
    assert_eq!(spec.jobs_completed, 1);

    let cons = fetch_agent(&svm, &consumer_agent);
    assert!(
        cons.reputation_score > 0,
        "consumer reputation should update"
    );
    assert_eq!(cons.jobs_completed, 1);
}

/// Test 2: reveal rejected before both parties commit → BothMustCommitFirst.
#[test]
fn test_reveal_rejected_before_both_commit() {
    let mut svm = make_svm();
    let consumer = Keypair::new();
    let specialist = Keypair::new();
    svm.airdrop(&consumer.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&specialist.pubkey(), 2_000_000_000).unwrap();

    let consumer_agent = register_agent_for(&mut svm, &consumer);
    let specialist_agent = register_agent_for(&mut svm, &specialist);

    let job_id = [2u8; 16];
    let c_salt = [0xAAu8; 32];
    let c_score: u8 = 9;

    // Only consumer commits
    send_ok(
        &mut svm,
        commit_ix(
            job_id,
            sha256_commitment(c_score, &c_salt),
            RatingRole::Consumer,
            &consumer,
            consumer.pubkey(),
            specialist.pubkey(),
        ),
        &[&consumer],
    );

    // Consumer tries to reveal immediately — state is Pending, not BothCommitted
    let err = send_err(
        &mut svm,
        reveal_ix(
            job_id,
            c_score,
            c_salt,
            &consumer,
            consumer_agent,
            specialist_agent,
        ),
        &[&consumer],
    );

    assert!(
        err.contains("BothMustCommitFirst") || err.contains("6011"),
        "expected BothMustCommitFirst, got: {err}"
    );
}

/// Test 3: tampered reveal rejected — wrong salt → CommitmentMismatch.
#[test]
fn test_tampered_reveal_rejected() {
    let mut svm = make_svm();
    let consumer = Keypair::new();
    let specialist = Keypair::new();
    svm.airdrop(&consumer.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&specialist.pubkey(), 2_000_000_000).unwrap();

    let consumer_agent = register_agent_for(&mut svm, &consumer);
    let specialist_agent = register_agent_for(&mut svm, &specialist);

    let job_id = [3u8; 16];
    let real_salt = [0x11u8; 32];
    let wrong_salt = [0xFFu8; 32];
    let c_score: u8 = 5;
    let s_score: u8 = 5;

    send_ok(
        &mut svm,
        commit_ix(
            job_id,
            sha256_commitment(c_score, &real_salt),
            RatingRole::Consumer,
            &consumer,
            consumer.pubkey(),
            specialist.pubkey(),
        ),
        &[&consumer],
    );
    send_ok(
        &mut svm,
        commit_ix(
            job_id,
            sha256_commitment(s_score, &real_salt),
            RatingRole::Specialist,
            &specialist,
            consumer.pubkey(),
            specialist.pubkey(),
        ),
        &[&specialist],
    );

    // Consumer reveals with wrong salt → CommitmentMismatch
    let err = send_err(
        &mut svm,
        reveal_ix(
            job_id,
            c_score,
            wrong_salt,
            &consumer,
            consumer_agent,
            specialist_agent,
        ),
        &[&consumer],
    );

    assert!(
        err.contains("CommitmentMismatch") || err.contains("6012"),
        "expected CommitmentMismatch, got: {err}"
    );
}

/// Test 4: duplicate commit rejected → AlreadyCommitted.
#[test]
fn test_duplicate_commit_rejected() {
    let mut svm = make_svm();
    let consumer = Keypair::new();
    let specialist = Keypair::new();
    svm.airdrop(&consumer.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&specialist.pubkey(), 500_000_000).unwrap();

    register_agent_for(&mut svm, &consumer);
    register_agent_for(&mut svm, &specialist);

    let job_id = [4u8; 16];
    let salt = [0x55u8; 32];

    send_ok(
        &mut svm,
        commit_ix(
            job_id,
            sha256_commitment(8, &salt),
            RatingRole::Consumer,
            &consumer,
            consumer.pubkey(),
            specialist.pubkey(),
        ),
        &[&consumer],
    );

    let err = send_err(
        &mut svm,
        commit_ix(
            job_id,
            sha256_commitment(9, &salt),
            RatingRole::Consumer,
            &consumer,
            consumer.pubkey(),
            specialist.pubkey(),
        ),
        &[&consumer],
    );

    assert!(
        err.contains("AlreadyCommitted") || err.contains("6010"),
        "expected AlreadyCommitted, got: {err}"
    );
}

/// Test 5: expire penalises the non-committing party.
///
/// Setup: consumer commits, specialist ghosts.  Both pubkeys are recorded on
/// consumer's commit so expire_rating can load both AgentAccount PDAs.
#[test]
fn test_expire_penalises_non_committer() {
    let mut svm = make_svm();
    let consumer = Keypair::new();
    let specialist = Keypair::new();
    svm.airdrop(&consumer.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&specialist.pubkey(), 2_000_000_000).unwrap();

    let consumer_agent = register_agent_for(&mut svm, &consumer);
    let specialist_agent = register_agent_for(&mut svm, &specialist);

    let job_id = [5u8; 16];
    let (rating_pk, _) = rating_pda(&job_id);
    let c_salt = [0xCCu8; 32];

    // Consumer commits and records both pubkeys — specialist ghosts
    send_ok(
        &mut svm,
        commit_ix(
            job_id,
            sha256_commitment(9, &c_salt),
            RatingRole::Consumer,
            &consumer,
            consumer.pubkey(),
            specialist.pubkey(),
        ),
        &[&consumer],
    );

    let spec_before = fetch_agent(&svm, &specialist_agent);

    // Warp past the 7-day expiry window
    svm.warp_to_slot(RATING_EXPIRE_SLOTS + 100);

    // Consumer triggers expiry — specialist ghosted, so specialist is penalised
    send_ok(
        &mut svm,
        expire_ix(job_id, &consumer, consumer_agent, specialist_agent),
        &[&consumer],
    );

    let r = fetch_rating(&svm, &rating_pk);
    assert_eq!(r.state, RatingState::Expired);

    let spec_after = fetch_agent(&svm, &specialist_agent);
    assert!(
        spec_after.reputation_score < spec_before.reputation_score
            || spec_before.reputation_score == 0,
        "specialist reputation should decrease (floor 0): before={}, after={}",
        spec_before.reputation_score,
        spec_after.reputation_score
    );
    assert_eq!(spec_after.jobs_failed, spec_before.jobs_failed + 1);

    // Consumer should NOT be penalised
    let cons = fetch_agent(&svm, &consumer_agent);
    assert_eq!(
        cons.jobs_failed, 0,
        "consumer committed — should not be penalised"
    );
}
