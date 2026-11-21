//! MagicBlock CPI layout helpers for the legacy Anchor escrow PER path.
//!
//! These helpers intentionally do not invoke MagicBlock programs yet. They pin
//! the byte layouts observed from `@magicblock-labs/ephemeral-rollups-sdk` so
//! the next implementation slice can build `Instruction` values with exact
//! account order and data before using `invoke_signed` for the escrow PDA.

/// MagicBlock Permission Program on devnet/mainnet.
pub const PERMISSION_PROGRAM_ID_STR: &str = "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1";

/// MagicBlock Delegation Program on devnet/mainnet.
pub const DELEGATION_PROGRAM_ID_STR: &str = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";

/// MagicBlock program used by commit+undelegate permission.
pub const MAGIC_PROGRAM_ID_STR: &str = "Magic11111111111111111111111111111111111111";

/// MagicBlock context account used by commit+undelegate permission.
pub const MAGIC_CONTEXT_ID_STR: &str = "MagicContext1111111111111111111111111111111";

/// Devnet TEE validator currently listed in MagicBlock private PER docs.
pub const DEVNET_TEE_VALIDATOR_STR: &str = "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo";

/// SDK discriminator for Permission Program `createPermission`.
pub const CREATE_PERMISSION_DISCRIMINATOR: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0];

/// SDK discriminator for Permission Program `delegatePermission`.
pub const DELEGATE_PERMISSION_DISCRIMINATOR: [u8; 8] = [3, 0, 0, 0, 0, 0, 0, 0];

/// SDK discriminator for Permission Program `commitAndUndelegatePermission`.
pub const COMMIT_AND_UNDELEGATE_PERMISSION_DISCRIMINATOR: [u8; 8] = [5, 0, 0, 0, 0, 0, 0, 0];

/// SDK discriminator for Delegation Program `delegate`.
pub const DELEGATE_ACCOUNT_DISCRIMINATOR: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0];

/// MagicBlock member flag: authority.
pub const MEMBER_AUTHORITY_FLAG: u8 = 1 << 0;
/// MagicBlock member flag: can see tx logs.
pub const MEMBER_TX_LOGS_FLAG: u8 = 1 << 1;
/// MagicBlock member flag: can see tx balances.
pub const MEMBER_TX_BALANCES_FLAG: u8 = 1 << 2;
/// MagicBlock member flag: can see tx messages.
pub const MEMBER_TX_MESSAGES_FLAG: u8 = 1 << 3;
/// MagicBlock member flag: can see account signatures.
pub const MEMBER_ACCOUNT_SIGNATURES_FLAG: u8 = 1 << 4;

/// Serialize SDK `MembersArgs { members: null }`.
///
/// Current boundary proof uses no explicit access-control members. The SDK
/// serializes this as a one-byte Option discriminant `0` appended to the
/// create-permission discriminator.
pub fn serialize_members_none() -> [u8; 1] {
    [0]
}

/// Data for Permission Program `createPermission` with `members: null`.
pub fn create_permission_data_members_none() -> [u8; 9] {
    let mut out = [0u8; 9];
    out[..8].copy_from_slice(&CREATE_PERMISSION_DISCRIMINATOR);
    out[8] = serialize_members_none()[0];
    out
}

/// Data for Permission Program `delegatePermission`.
pub fn delegate_permission_data() -> [u8; 8] {
    DELEGATE_PERMISSION_DISCRIMINATOR
}

/// Data for Permission Program `commitAndUndelegatePermission`.
pub fn commit_and_undelegate_permission_data() -> [u8; 8] {
    COMMIT_AND_UNDELEGATE_PERMISSION_DISCRIMINATOR
}

/// Data for Delegation Program `delegate`.
///
/// Mirrors the JS SDK layout:
/// - 8-byte discriminator
/// - `commitFrequencyMs` u32 little-endian (`u32::MAX` = SDK default)
/// - seed vector length u32 little-endian (0 here)
/// - validator Option: 1 + 32-byte validator pubkey
pub fn delegate_account_data(validator: [u8; 32]) -> [u8; 49] {
    let mut out = [0u8; 49];
    let mut offset = 0usize;
    out[offset..offset + 8].copy_from_slice(&DELEGATE_ACCOUNT_DISCRIMINATOR);
    offset += 8;
    out[offset..offset + 4].copy_from_slice(&u32::MAX.to_le_bytes());
    offset += 4;
    out[offset..offset + 4].copy_from_slice(&0u32.to_le_bytes());
    offset += 4;
    out[offset] = 1;
    offset += 1;
    out[offset..offset + 32].copy_from_slice(&validator);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;
    use std::str::FromStr;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    }

    #[test]
    fn permission_instruction_data_matches_magicblock_js_sdk() {
        assert_eq!(
            hex(&create_permission_data_members_none()),
            "000000000000000000"
        );
        assert_eq!(hex(&delegate_permission_data()), "0300000000000000");
        assert_eq!(
            hex(&commit_and_undelegate_permission_data()),
            "0500000000000000"
        );
    }

    #[test]
    fn delegate_account_data_matches_magicblock_js_sdk() {
        let validator = Pubkey::from_str(DEVNET_TEE_VALIDATOR_STR)
            .expect("valid MagicBlock devnet TEE validator");
        assert_eq!(
            hex(&delegate_account_data(validator.to_bytes())),
            "0000000000000000ffffffff0000000001053d471a859e732e680bc958f841072b8f3fbc19739be697c4c681126f8c1f74"
        );
    }
}
