use {
    anchor_lang::{
        solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    escrow::accounts::{DeregisterAgent, RegisterAgent, UpdateAgent},
    escrow::constants::{AGENT_FEE_BURN_ADDRESS, AGENT_REGISTRATION_FEE},
    escrow::instruction,
    escrow::state::{AgentAccount, AgentType},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn make_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/escrow.so");
    svm.add_program(escrow::id(), bytes).unwrap();
    svm
}

fn agent_pda(owner: &anchor_lang::prelude::Pubkey) -> (anchor_lang::prelude::Pubkey, u8) {
    anchor_lang::prelude::Pubkey::find_program_address(&[b"agent", owner.as_ref()], &escrow::id())
}

fn send_tx(
    svm: &mut LiteSVM,
    ix: Instruction,
    signers: &[&Keypair],
) -> Result<(), litesvm::types::FailedTransactionMetadata> {
    let payer_pk = signers[0].pubkey();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer_pk), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    match svm.send_transaction(tx) {
        Ok(_) => Ok(()),
        Err(e) => Err(e),
    }
}

fn register_ix(
    owner: &Keypair,
    agent: anchor_lang::prelude::Pubkey,
    agent_type: AgentType,
    model: &str,
) -> Instruction {
    Instruction::new_with_bytes(
        escrow::id(),
        &instruction::RegisterAgent {
            agent_type,
            model: model.to_string(),
            rate_lamports: 1_000_000,
            min_reputation: 3,
        }
        .data(),
        RegisterAgent {
            agent,
            owner: owner.pubkey(),
            fee_collector: AGENT_FEE_BURN_ADDRESS,
            system_program: anchor_lang::solana_program::system_program::id(),
        }
        .to_account_metas(None),
    )
}

fn fetch_agent(svm: &LiteSVM, agent_pk: &anchor_lang::prelude::Pubkey) -> AgentAccount {
    let account = svm.get_account(agent_pk).expect("agent PDA should exist");
    let mut data = account.data.as_slice();
    AgentAccount::try_deserialize(&mut data).expect("agent account should deserialize")
}

#[test]
fn register_primary_agent_success() {
    let mut svm = make_svm();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 1_000_000_000).unwrap();

    let fee_collector = AGENT_FEE_BURN_ADDRESS;
    let fee_before = svm
        .get_account(&fee_collector)
        .map(|a| a.lamports)
        .unwrap_or(0);

    let (agent, _) = agent_pda(&owner.pubkey());
    let ix = register_ix(&owner, agent, AgentType::Primary, "qwen3:8b");
    send_tx(&mut svm, ix, &[&owner]).expect("register should succeed");

    let fee_after = svm
        .get_account(&fee_collector)
        .map(|a| a.lamports)
        .unwrap_or(0);
    assert_eq!(
        fee_after.saturating_sub(fee_before),
        AGENT_REGISTRATION_FEE,
        "registration fee should be charged"
    );

    let account = fetch_agent(&svm, &agent);
    assert_eq!(account.owner, owner.pubkey());
    assert!(account.agent_type == AgentType::Primary);
    assert_eq!(account.model, "qwen3:8b");
    assert_eq!(account.reputation_score, 0);
    assert_eq!(account.jobs_completed, 0);
    assert_eq!(account.jobs_failed, 0);
    assert!(account.active);
}

#[test]
fn register_attestation_agent_success() {
    let mut svm = make_svm();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 1_000_000_000).unwrap();

    let (agent, _) = agent_pda(&owner.pubkey());
    let ix = register_ix(&owner, agent, AgentType::Attestation, "llama4");
    send_tx(&mut svm, ix, &[&owner]).expect("register should succeed");

    let account = fetch_agent(&svm, &agent);
    assert!(account.agent_type == AgentType::Attestation);
}

#[test]
fn register_both_success() {
    let mut svm = make_svm();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 1_000_000_000).unwrap();

    let (agent, _) = agent_pda(&owner.pubkey());
    let ix = register_ix(&owner, agent, AgentType::Both, "sonnet");
    send_tx(&mut svm, ix, &[&owner]).expect("register should succeed");

    let account = fetch_agent(&svm, &agent);
    assert!(account.agent_type == AgentType::Both);
}

#[test]
fn duplicate_registration_rejected() {
    let mut svm = make_svm();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 1_000_000_000).unwrap();

    let (agent, _) = agent_pda(&owner.pubkey());
    send_tx(
        &mut svm,
        register_ix(&owner, agent, AgentType::Primary, "qwen3:8b"),
        &[&owner],
    )
    .expect("first register should succeed");

    let err = send_tx(
        &mut svm,
        register_ix(&owner, agent, AgentType::Primary, "qwen3:14b"),
        &[&owner],
    )
    .expect_err("second registration should fail");

    let err_str = format!("{:?}", err);
    assert!(
        err_str.contains("AlreadyInUse")
            || err_str.contains("already in use")
            || err_str.contains("AccountAlreadyInitialized")
            || err_str.contains("ConstraintSeeds")
            || err_str.contains("AlreadyProcessed")
            || err_str.contains("custom program error: 0x0"),
        "expected duplicate registration rejection, got: {err_str}"
    );
}

#[test]
fn update_rate_owner_only() {
    let mut svm = make_svm();
    let owner = Keypair::new();
    let attacker = Keypair::new();
    svm.airdrop(&owner.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let (agent, _) = agent_pda(&owner.pubkey());
    send_tx(
        &mut svm,
        register_ix(&owner, agent, AgentType::Primary, "qwen3:8b"),
        &[&owner],
    )
    .expect("register should succeed");

    let owner_update_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::UpdateAgent {
            rate_lamports: 2_500_000,
            min_reputation: 12,
            active: false,
        }
        .data(),
        UpdateAgent {
            agent,
            owner: owner.pubkey(),
        }
        .to_account_metas(None),
    );
    send_tx(&mut svm, owner_update_ix, &[&owner]).expect("owner update should succeed");

    let updated = fetch_agent(&svm, &agent);
    assert_eq!(updated.rate_lamports, 2_500_000);
    assert_eq!(updated.min_reputation, 12);
    assert!(!updated.active);

    let attacker_update_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::UpdateAgent {
            rate_lamports: 3_300_000,
            min_reputation: 1,
            active: true,
        }
        .data(),
        UpdateAgent {
            agent,
            owner: attacker.pubkey(),
        }
        .to_account_metas(None),
    );

    let err = send_tx(&mut svm, attacker_update_ix, &[&attacker])
        .expect_err("non-owner update should fail");
    let err_str = format!("{:?}", err);
    assert!(
        err_str.contains("ConstraintHasOne")
            || err_str.contains("ConstraintSeeds")
            || err_str.contains("2001")
            || err_str.contains("2006"),
        "expected owner constraint failure, got: {err_str}"
    );
}

#[test]
fn deregister_closes_pda() {
    let mut svm = make_svm();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 1_000_000_000).unwrap();

    let fee_collector = AGENT_FEE_BURN_ADDRESS;
    let fee_before = svm
        .get_account(&fee_collector)
        .map(|a| a.lamports)
        .unwrap_or(0);

    let (agent, _) = agent_pda(&owner.pubkey());
    send_tx(
        &mut svm,
        register_ix(&owner, agent, AgentType::Primary, "qwen3:8b"),
        &[&owner],
    )
    .expect("register should succeed");

    let owner_after_register = svm
        .get_account(&owner.pubkey())
        .expect("owner exists")
        .lamports;

    let deregister_ix = Instruction::new_with_bytes(
        escrow::id(),
        &instruction::DeregisterAgent {}.data(),
        DeregisterAgent {
            agent,
            owner: owner.pubkey(),
        }
        .to_account_metas(None),
    );
    send_tx(&mut svm, deregister_ix, &[&owner]).expect("deregister should succeed");

    assert!(
        svm.get_account(&agent).is_none(),
        "agent PDA should be closed"
    );

    let owner_after_deregister = svm
        .get_account(&owner.pubkey())
        .expect("owner exists")
        .lamports;
    assert!(
        owner_after_deregister > owner_after_register,
        "owner should receive rent back on close"
    );

    let fee_after = svm
        .get_account(&fee_collector)
        .map(|a| a.lamports)
        .unwrap_or(0);
    assert_eq!(
        fee_after.saturating_sub(fee_before),
        AGENT_REGISTRATION_FEE,
        "registration fee should not be returned on deregister"
    );
}
