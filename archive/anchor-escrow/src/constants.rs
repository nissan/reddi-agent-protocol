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

/// PayPal USD on Solana mainnet-beta: Token-2022, six decimals.
pub const PYUSD_MAINNET_MINT: Pubkey = pubkey!("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo");
/// Global Dollar (USDG) on Solana mainnet-beta: Token-2022, six decimals.
pub const USDG_MAINNET_MINT: Pubkey = pubkey!("2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH");

/// Classic SPL Token mints a token escrow may hold. The default build accepts
/// mainnet USDC and mainnet AUDD only.
#[cfg(not(feature = "devnet"))]
pub const ALLOWED_MINTS: &[Pubkey] = &[USDC_MAINNET_MINT, AUDD_MAINNET_MINT];
#[cfg(feature = "devnet")]
pub const ALLOWED_MINTS: &[Pubkey] = &[USDC_MAINNET_MINT, AUDD_MAINNET_MINT, USDC_DEVNET_MINT];

/// Token-2022 mints a token escrow may hold. Both are issued by Paxos with the
/// same extension set: a permanent delegate and a freeze authority (the issuer
/// can move or freeze a vault's tokens), a transfer-fee configuration set to
/// zero, and an unset transfer hook. The escrow cannot prevent issuer action;
/// see `token_escrow::settle` for how settlement behaves under it.
pub const ALLOWED_TOKEN_2022_MINTS: &[Pubkey] = &[PYUSD_MAINNET_MINT, USDG_MAINNET_MINT];

/// The token program an allowlisted mint must be owned by, or `None` for a
/// mint that is not on either allowlist.
pub fn allowed_token_program(mint: &Pubkey) -> Option<Pubkey> {
    if ALLOWED_MINTS.contains(mint) {
        Some(anchor_spl::token::ID)
    } else if ALLOWED_TOKEN_2022_MINTS.contains(mint) {
        Some(crate::token_accounts::TOKEN_2022_ID)
    } else {
        None
    }
}

/// Protocol fee on every payout to a payee: 250 basis points (2.5%) of the
/// amount paid out, rounded down, taken out of the payee's share. The payer never
/// pays more than the amount it locked.
pub const PROTOCOL_FEE_BPS: u64 = 250;
pub const BPS_DENOMINATOR: u64 = 10_000;
/// Ceiling on the protocol fee for a SOL payout: 0.1 SOL. Token payouts have no
/// ceiling (owner decision, 20 November 2026).
pub const SOL_FEE_CAP_LAMPORTS: u64 = 100_000_000;
/// Protocol fee treasury: the "Reddi Agent Protocol" Squads vault (2 of 3).
/// Token fees go to this owner's token account for the escrow mint, which must
/// exist before the first fee in that mint.
pub const PROTOCOL_TREASURY: Pubkey = pubkey!("5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe");

/// The associated token account program.
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/// The treasury's associated token account for `mint` under `token_program`:
/// the only account a token fee may be paid to, so fees land where the Squads
/// vault shows them.
pub fn treasury_token_address(mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            PROTOCOL_TREASURY.as_ref(),
            token_program.as_ref(),
            mint.as_ref(),
        ],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

/// Protocol fee on a payout of `paid` base units. `sol` applies the SOL ceiling.
pub const fn protocol_fee(paid: u64, sol: bool) -> u64 {
    // u128 so a large payout cannot overflow before the division.
    let fee = (paid as u128 * PROTOCOL_FEE_BPS as u128 / BPS_DENOMINATOR as u128) as u64;
    if sol && fee > SOL_FEE_CAP_LAMPORTS {
        SOL_FEE_CAP_LAMPORTS
    } else {
        fee
    }
}

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
