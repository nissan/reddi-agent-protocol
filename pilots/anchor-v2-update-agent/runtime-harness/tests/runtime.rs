use {
    anchor_lang::{AccountDeserialize, AccountSerialize},
    escrow::{AgentAccount, AgentType},
    mollusk_svm::{result::Check, Mollusk},
    sha2::{Digest, Sha256},
    solana_account::Account,
    solana_instruction::{AccountMeta, Instruction},
    solana_sdk_ids::system_program,
};

const OWNER: [u8; 32] = [7; 32];
const NEW_RATE: u64 = 2_500_000;
const NEW_MIN_REPUTATION: u8 = 12;
const NEW_ACTIVE: bool = false;

fn program_id() -> anchor_lang::prelude::Pubkey {
    escrow::id()
}

fn owner() -> anchor_lang::prelude::Pubkey {
    anchor_lang::prelude::Pubkey::new_from_array(OWNER)
}

fn agent_pda() -> (anchor_lang::prelude::Pubkey, u8) {
    anchor_lang::prelude::Pubkey::find_program_address(&[b"agent", owner().as_ref()], &program_id())
}

fn instruction() -> Instruction {
    let digest = Sha256::digest(b"global:update_agent");
    let mut data = digest[..8].to_vec();
    data.extend_from_slice(&NEW_RATE.to_le_bytes());
    data.push(NEW_MIN_REPUTATION);
    data.push(u8::from(NEW_ACTIVE));

    Instruction::new_with_bytes(
        program_id(),
        &data,
        vec![
            AccountMeta::new(agent_pda().0, false),
            AccountMeta::new_readonly(owner(), true),
        ],
    )
}

fn agent_data() -> Vec<u8> {
    let agent = AgentAccount {
        owner: owner(),
        agent_type: AgentType::Primary,
        model: "qwen3:8b".to_owned(),
        rate_lamports: 1_000_000,
        min_reputation: 3,
        reputation_score: 8_000,
        jobs_completed: 9,
        jobs_failed: 1,
        created_at: 1_700_000_000,
        active: true,
        attestation_accuracy: 7_500,
        bump: agent_pda().1,
    };
    let mut data = Vec::new();
    agent
        .try_serialize(&mut data)
        .expect("serialize stable account");
    data
}

fn input_accounts() -> Vec<(anchor_lang::prelude::Pubkey, Account)> {
    vec![
        (
            agent_pda().0,
            Account {
                lamports: 1_000_000,
                data: agent_data(),
                owner: program_id(),
                executable: false,
                rent_epoch: 0,
            },
        ),
        (owner(), Account::new(1_000_000, 0, &system_program::id())),
    ]
}

fn assert_updated(data: &[u8]) {
    let mut bytes = data;
    let agent = AgentAccount::try_deserialize(&mut bytes).expect("deserialize updated account");
    assert_eq!(agent.owner, owner());
    assert_eq!(agent.model, "qwen3:8b");
    assert_eq!(agent.rate_lamports, NEW_RATE);
    assert_eq!(agent.min_reputation, NEW_MIN_REPUTATION);
    assert_eq!(agent.active, NEW_ACTIVE);
    assert_eq!(agent.reputation_score, 8_000);
    assert_eq!(agent.jobs_completed, 9);
    assert_eq!(agent.jobs_failed, 1);
    assert_eq!(agent.attestation_accuracy, 7_500);
}

#[test]
fn stable_and_alpha_execute_the_same_isolated_update_without_a_transaction() {
    let out_dir = std::env::var("ANCHOR_V2_PILOT_SBF_OUT_DIR")
        .expect("set ANCHOR_V2_PILOT_SBF_OUT_DIR to the directory containing both SBF binaries");
    std::env::set_var("SBF_OUT_DIR", out_dir);

    let stable = Mollusk::new(&program_id(), "stable_update_agent")
        .process_and_validate_instruction(&instruction(), &input_accounts(), &[Check::success()]);
    let alpha = Mollusk::new(&program_id(), "alpha_update_agent").process_and_validate_instruction(
        &instruction(),
        &input_accounts(),
        &[Check::success()],
    );

    assert!(stable.compute_units_consumed > 0);
    assert!(alpha.compute_units_consumed > 0);
    assert_updated(&stable.resulting_accounts[0].1.data);
    assert_updated(&alpha.resulting_accounts[0].1.data);

    println!(
        "PILOT_COMPUTE_UNITS stable={} alpha={}",
        stable.compute_units_consumed, alpha.compute_units_consumed
    );
}
