use anchor_lang::prelude::{pubkey, Pubkey};

pub const ESCROW_SEED: &[u8] = b"escrow";
pub const TOKEN_ESCROW_SEED: &[u8] = b"token-escrow";
pub const TOKEN_VAULT_SEED: &[u8] = b"token-vault";
pub const AGENT_SEED: &[u8] = b"agent";
pub const ESCROW_DISCRIMINATOR_SIZE: usize = 8;
/// Nominal slot time used to express durations in slots. Real slot times drift,
/// so every duration below is approximate in wall-clock terms.
pub const NOMINAL_SLOT_MS: u64 = 400;
/// Slots after lock before the payer may refund itself: about 3 days at the
/// nominal slot time. Until then the funds can only go to the payee (release) or
/// come back because the payee declined.
pub const CANCEL_WINDOW_SLOTS: u64 = 3 * 24 * 60 * 60 * 1000 / NOMINAL_SLOT_MS;
/// Slots after lock before the payee may claim an escrow the payer has neither
/// released nor refunded: about 7 days at the nominal slot time. Between the
/// cancel window and this deadline only the payer can move the funds; from this
/// deadline on, whichever of payer refund and payee claim lands first wins.
pub const CLAIM_WINDOW_SLOTS: u64 = 7 * 24 * 60 * 60 * 1000 / NOMINAL_SLOT_MS;
// The payer must have a real chance to refund before the payee can claim.
const _: () = assert!(CLAIM_WINDOW_SLOTS > CANCEL_WINDOW_SLOTS);

/// Guarded-beta cap on one SOL escrow: 0.5 SOL. Bounds the amount named at lock,
/// not what a third party may later send to the escrow account.
pub const MAX_SOL_ESCROW_LAMPORTS: u64 = 500_000_000;
/// Guarded-beta cap on one token escrow, in base units of a 6-decimal mint:
/// 100 units of any allowlisted stablecoin. Bounds the amount named at lock; a later donation to the vault is
/// swept to whoever the escrow settles to.
pub const MAX_TOKEN_ESCROW_BASE_UNITS: u64 = 100_000_000;
/// Decimals every allowlisted mint must have, so the cap means what it says.
pub const ALLOWED_MINT_DECIMALS: u8 = 6;
/// USDC on Solana mainnet-beta (Circle).
pub const USDC_MAINNET_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
/// USDC on Solana devnet (Circle). Accepted only in builds with the `devnet` feature.
pub const USDC_DEVNET_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

/// AUDD on Solana mainnet-beta: classic SPL Token, six decimals. The issuer
/// holds a freeze authority over AUDD token accounts, including escrow vaults.
pub const AUDD_MAINNET_MINT: Pubkey = pubkey!("AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw");

/// Mints a token escrow may hold. The default build accepts mainnet USDC and
/// mainnet AUDD only. Both are classic SPL Token mints.
#[cfg(not(feature = "devnet"))]
pub const ALLOWED_MINTS: &[Pubkey] = &[USDC_MAINNET_MINT, AUDD_MAINNET_MINT];
#[cfg(feature = "devnet")]
pub const ALLOWED_MINTS: &[Pubkey] =
    &[USDC_MAINNET_MINT, AUDD_MAINNET_MINT, USDC_DEVNET_MINT];

pub const AGENT_REGISTRATION_FEE: u64 = 10_000_000; // 0.01 SOL in lamports
pub const AGENT_MODEL_MAX_LEN: usize = 64;
pub const AGENT_FEE_BURN_ADDRESS: Pubkey = pubkey!("1nc1nerator11111111111111111111111111111111");

pub const RATING_SEED: &[u8] = b"rating";
/// 7 days in slots at ~400ms/slot
pub const RATING_EXPIRE_SLOTS: u64 = 1_512_000;
/// Reputation penalty for non-commitment on expiry (5.00 points)
pub const RATING_EXPIRE_PENALTY: u16 = 500;

pub const ATTESTATION_SEED: &[u8] = b"attestation";
/// Weight applied to attestation_accuracy on confirmation (10.00 points)
pub const ATTESTATION_CONFIRM_WEIGHT: u16 = 1000;
