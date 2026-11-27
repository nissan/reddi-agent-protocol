//! Same values as `programs/escrow/src/constants.rs`.
use quasar_lang::prelude::*;

pub const NOMINAL_SLOT_MS: u64 = 400;
/// About 3 days: before this only the payee can send the funds back.
pub const CANCEL_WINDOW_SLOTS: u64 = 3 * 24 * 60 * 60 * 1000 / NOMINAL_SLOT_MS;
/// About 7 days: from here the payee may claim.
pub const CLAIM_WINDOW_SLOTS: u64 = 7 * 24 * 60 * 60 * 1000 / NOMINAL_SLOT_MS;
const _: () = assert!(CLAIM_WINDOW_SLOTS > CANCEL_WINDOW_SLOTS);

pub const MAX_SOL_ESCROW_LAMPORTS: u64 = 500_000_000;
pub const MAX_TOKEN_ESCROW_BASE_UNITS: u64 = 100_000_000;
pub const ALLOWED_MINT_DECIMALS: u8 = 6;

pub const USDC_MAINNET_MINT: Address = address!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const USDC_DEVNET_MINT: Address = address!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
pub const AUDD_MAINNET_MINT: Address = address!("AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw");
pub const PYUSD_MAINNET_MINT: Address = address!("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo");
pub const USDG_MAINNET_MINT: Address = address!("2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH");

#[cfg(not(feature = "devnet"))]
pub const ALLOWED_MINTS: &[Address] = &[USDC_MAINNET_MINT, AUDD_MAINNET_MINT];
#[cfg(feature = "devnet")]
pub const ALLOWED_MINTS: &[Address] = &[USDC_MAINNET_MINT, AUDD_MAINNET_MINT, USDC_DEVNET_MINT];
pub const ALLOWED_TOKEN_2022_MINTS: &[Address] = &[PYUSD_MAINNET_MINT, USDG_MAINNET_MINT];

pub const PROTOCOL_FEE_BPS: u64 = 250;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const SOL_FEE_CAP_LAMPORTS: u64 = 100_000_000;
pub const PROTOCOL_TREASURY: Address = address!("5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe");

pub const AGENT_REGISTRATION_FEE: u64 = 10_000_000;
pub const AGENT_MODEL_MAX_LEN: usize = 64;
pub const AGENT_FEE_BURN_ADDRESS: Address = address!("1nc1nerator11111111111111111111111111111111");

/// Protocol fee on a payout of `paid` base units. `sol` applies the SOL ceiling.
pub const fn protocol_fee(paid: u64, sol: bool) -> u64 {
    let fee = (paid as u128 * PROTOCOL_FEE_BPS as u128 / BPS_DENOMINATOR as u128) as u64;
    if sol && fee > SOL_FEE_CAP_LAMPORTS {
        SOL_FEE_CAP_LAMPORTS
    } else {
        fee
    }
}
