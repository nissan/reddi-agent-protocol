use {
    anchor_lang_v1::{Discriminator, InstructionData, ToAccountMetas},
    sha2::{Digest, Sha256},
};

const OWNER: [u8; 32] = [7; 32];
const NEW_RATE: u64 = 2_500_000;
const NEW_MIN_REPUTATION: u8 = 12;
const NEW_ACTIVE: bool = false;

fn owner() -> anchor_lang_v1::prelude::Pubkey {
    anchor_lang_v1::prelude::Pubkey::new_from_array(OWNER)
}

fn agent_pda() -> anchor_lang_v1::prelude::Pubkey {
    anchor_lang_v1::prelude::Pubkey::find_program_address(
        &[b"agent", owner().as_ref()],
        &escrow::id(),
    )
    .0
}

fn canonical_instruction_data() -> Vec<u8> {
    let digest = Sha256::digest(b"global:update_agent");
    let mut data = digest[..8].to_vec();
    data.extend_from_slice(&NEW_RATE.to_le_bytes());
    data.push(NEW_MIN_REPUTATION);
    data.push(u8::from(NEW_ACTIVE));
    data
}

#[test]
fn generated_clients_match_the_canonical_stable_wire_contract() {
    let expected = canonical_instruction_data();
    let canonical = escrow::instruction::UpdateAgent {
        rate_lamports: NEW_RATE,
        min_reputation: NEW_MIN_REPUTATION,
        active: NEW_ACTIVE,
    }
    .data();
    let stable = stable_update_agent::instruction::UpdateAgent {
        rate_lamports: NEW_RATE,
        min_reputation: NEW_MIN_REPUTATION,
        active: NEW_ACTIVE,
    }
    .data();
    assert_eq!(canonical, expected);
    assert_eq!(stable, canonical);
    assert_eq!(stable_update_agent::id(), escrow::id());

    let canonical_metas = escrow::accounts::UpdateAgent {
        agent: agent_pda(),
        owner: owner(),
    }
    .to_account_metas(None);
    let stable_metas = stable_update_agent::accounts::UpdateAgent {
        agent: agent_pda(),
        owner: owner(),
    }
    .to_account_metas(None);
    assert_eq!(stable_metas, canonical_metas);

    let alpha = alpha_update_agent::instruction::UpdateAgent {
        rate_lamports: NEW_RATE,
        min_reputation: NEW_MIN_REPUTATION,
        active: NEW_ACTIVE,
    }
    .to_instruction(alpha_update_agent::accounts::UpdateAgentResolved {
        agent: agent_pda().to_bytes().into(),
        owner: OWNER.into(),
    });
    assert_eq!(alpha.data, expected);
    assert_eq!(alpha.accounts.len(), 2);
    assert_eq!(alpha.program_id.to_bytes(), escrow::id().to_bytes());
    for (alpha_meta, canonical_meta) in alpha.accounts.iter().zip(&canonical_metas) {
        assert_eq!(
            alpha_meta.pubkey.to_bytes(),
            canonical_meta.pubkey.to_bytes()
        );
        assert_eq!(alpha_meta.is_writable, canonical_meta.is_writable);
        assert_eq!(alpha_meta.is_signer, canonical_meta.is_signer);
    }

    let expected_account_discriminator = &Sha256::digest(b"account:AgentAccount")[..8];
    assert_eq!(
        escrow::AgentAccount::DISCRIMINATOR,
        expected_account_discriminator
    );
    assert_eq!(
        stable_update_agent::AgentAccount::DISCRIMINATOR,
        escrow::AgentAccount::DISCRIMINATOR
    );
}
