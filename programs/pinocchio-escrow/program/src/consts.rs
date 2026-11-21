//! Seeds, limits, allowlists and the fee rule. The values the 13 escrow and
//! registry instructions use mirror `archive/anchor-escrow/src/constants.rs`;
//! the equivalence tests fail if they drift.
use {pinocchio::Address, solana_address::address};

pub const ESCROW_SEED: &[u8] = b"escrow";
pub const TOKEN_ESCROW_SEED: &[u8] = b"token-escrow";
pub const TOKEN_VAULT_SEED: &[u8] = b"token-vault";
pub const AGENT_SEED: &[u8] = b"agent";

/// Nominal slot time used to express durations in slots.
pub const NOMINAL_SLOT_MS: u64 = 400;
/// The longest refund window an escrow may name: about 30 days.
pub const MAX_ESCROW_WINDOW_SLOTS: u64 = 30 * 24 * 60 * 60 * 1000 / NOMINAL_SLOT_MS;
/// The claim window clients use when the caller names none: about 10 minutes.
/// The program itself has no default; every lock names both windows.
pub const DEFAULT_CLAIM_WINDOW_SLOTS: u64 = 10 * 60 * 1000 / NOMINAL_SLOT_MS;
/// The refund window clients use when the caller names none: about 30 minutes.
pub const DEFAULT_CANCEL_WINDOW_SLOTS: u64 = 30 * 60 * 1000 / NOMINAL_SLOT_MS;
const _: () = assert!(escrow_windows_valid(
    DEFAULT_CLAIM_WINDOW_SLOTS,
    DEFAULT_CANCEL_WINDOW_SLOTS
));

/// The rule for the two windows an escrow is locked with, both counted in
/// slots from the lock: the payee may claim from `claim_window_slots` and the
/// payer may refund itself from `cancel_window_slots`. The claim window is at
/// least one slot and never opens after the refund window; the refund window
/// is at most [`MAX_ESCROW_WINDOW_SLOTS`].
pub const fn escrow_windows_valid(claim_window_slots: u64, cancel_window_slots: u64) -> bool {
    claim_window_slots > 0
        && claim_window_slots <= cancel_window_slots
        && cancel_window_slots <= MAX_ESCROW_WINDOW_SLOTS
}

/// Guarded-beta cap on one SOL escrow: 0.5 SOL.
pub const MAX_SOL_ESCROW_LAMPORTS: u64 = 500_000_000;
/// Guarded-beta cap on one token escrow: 100 units of a 6-decimal mint.
pub const MAX_TOKEN_ESCROW_BASE_UNITS: u64 = 100_000_000;
/// Decimals every allowlisted mint must have.
pub const ALLOWED_MINT_DECIMALS: u8 = 6;

pub const USDC_MAINNET_MINT: Address = address!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const USDC_DEVNET_MINT: Address = address!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
pub const AUDD_MAINNET_MINT: Address = address!("AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw");
pub const PYUSD_MAINNET_MINT: Address = address!("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo");
pub const USDG_MAINNET_MINT: Address = address!("2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH");

pub const SYSTEM_PROGRAM_ID: Address = address!("11111111111111111111111111111111");
pub const TOKEN_PROGRAM_ID: Address = address!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_ID: Address = address!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Address =
    address!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/// Classic SPL Token mints a token escrow may hold.
#[cfg(not(feature = "devnet"))]
pub const ALLOWED_MINTS: &[Address] = &[USDC_MAINNET_MINT, AUDD_MAINNET_MINT];
#[cfg(feature = "devnet")]
pub const ALLOWED_MINTS: &[Address] = &[USDC_MAINNET_MINT, AUDD_MAINNET_MINT, USDC_DEVNET_MINT];

/// Token-2022 mints a token escrow may hold (PYUSD and USDG, both Paxos).
pub const ALLOWED_TOKEN_2022_MINTS: &[Address] = &[PYUSD_MAINNET_MINT, USDG_MAINNET_MINT];

/// The token program an allowlisted mint must be owned by.
pub fn allowed_token_program(mint: &Address) -> Option<&'static Address> {
    if ALLOWED_MINTS.contains(mint) {
        Some(&TOKEN_PROGRAM_ID)
    } else if ALLOWED_TOKEN_2022_MINTS.contains(mint) {
        Some(&TOKEN_2022_ID)
    } else {
        None
    }
}

/// Protocol fee: 250 basis points of the amount paid out, rounded down, taken
/// out of the payee's share.
pub const PROTOCOL_FEE_BPS: u64 = 250;
pub const BPS_DENOMINATOR: u64 = 10_000;
/// Ceiling on the fee for a SOL payout: 0.1 SOL. Token payouts have none.
pub const SOL_FEE_CAP_LAMPORTS: u64 = 100_000_000;
/// Protocol fee treasury: the "Reddi Agent Protocol" Squads vault.
pub const PROTOCOL_TREASURY: Address = address!("5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe");

/// Protocol fee on a payout of `paid` base units. `sol` applies the SOL ceiling.
pub const fn protocol_fee(paid: u64, sol: bool) -> u64 {
    let fee = (paid as u128 * PROTOCOL_FEE_BPS as u128 / BPS_DENOMINATOR as u128) as u64;
    if sol && fee > SOL_FEE_CAP_LAMPORTS {
        SOL_FEE_CAP_LAMPORTS
    } else {
        fee
    }
}

pub const AGENT_REGISTRATION_FEE: u64 = 10_000_000;
pub const AGENT_MODEL_MAX_LEN: usize = 64;
pub const AGENT_FEE_BURN_ADDRESS: Address = address!("1nc1nerator11111111111111111111111111111111");

/// First eight bytes of sha256(`preimage`), as Anchor derives instruction,
/// account and event discriminators. Evaluated at compile time.
pub const fn discriminator(preimage: &str) -> [u8; 8] {
    let hash = sha2_const_stable::Sha256::new()
        .update(preimage.as_bytes())
        .finalize();
    [
        hash[0], hash[1], hash[2], hash[3], hash[4], hash[5], hash[6], hash[7],
    ]
}

// ── Rating and attestation ──────────────────────────────────────────────────

pub const RATING_SEED: &[u8] = b"rating";
/// Slots after the paid settlement in which the two parties may commit:
/// about 7 days.
pub const RATING_COMMIT_SLOTS: u64 = 7 * 24 * 60 * 60 * 1000 / NOMINAL_SLOT_MS;
/// Slots after the second commitment in which the two parties may reveal:
/// about 7 days.
pub const RATING_REVEAL_SLOTS: u64 = 7 * 24 * 60 * 60 * 1000 / NOMINAL_SLOT_MS;
/// Reputation taken from a party that never committed or withheld its reveal,
/// and from a judge whose attestation is disputed (5.00 points).
pub const RATING_EXPIRE_PENALTY: u16 = 500;
pub const ATTESTATION_SEED: &[u8] = b"attestation";
/// Added to a judge's attestation accuracy on confirmation (10.00 points).
pub const ATTESTATION_CONFIRM_WEIGHT: u16 = 1000;
/// Reputation and accuracy scores run from 0 to this (100.00).
pub const SCORE_MAX: u16 = 10_000;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_is_2_5_percent_rounded_down_with_a_sol_ceiling() {
        assert_eq!(protocol_fee(1_000_000, true), 25_000);
        assert_eq!(protocol_fee(39, true), 0);
        assert_eq!(protocol_fee(41, false), 1);
        assert_eq!(protocol_fee(4_000_000_000, true), 100_000_000);
        assert_eq!(protocol_fee(10_000_000_000, true), 100_000_000);
        assert_eq!(protocol_fee(10_000_000_000, false), 250_000_000);
        assert_eq!(protocol_fee(u64::MAX, false), u64::MAX / 40);
    }

    #[test]
    fn windows_match_the_documented_slot_counts() {
        assert_eq!(MAX_ESCROW_WINDOW_SLOTS, 6_480_000);
        assert_eq!(DEFAULT_CLAIM_WINDOW_SLOTS, 1_500);
        assert_eq!(DEFAULT_CANCEL_WINDOW_SLOTS, 4_500);
        assert!(escrow_windows_valid(1, 1));
        assert!(escrow_windows_valid(1, MAX_ESCROW_WINDOW_SLOTS));
        assert!(!escrow_windows_valid(0, 1));
        assert!(!escrow_windows_valid(2, 1));
        assert!(!escrow_windows_valid(1, MAX_ESCROW_WINDOW_SLOTS + 1));
    }

    #[test]
    fn rating_deadlines_are_seven_days_of_slots() {
        assert_eq!(RATING_COMMIT_SLOTS, 1_512_000);
        assert_eq!(RATING_REVEAL_SLOTS, 1_512_000);
    }
}
