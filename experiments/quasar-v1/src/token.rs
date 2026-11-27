//! Helpers for the two token programs the escrow accepts: classic SPL Token and
//! Token-2022. Mirrors `programs/escrow/src/token_accounts.rs`.
use {
    crate::{constants::*, error::EscrowError},
    quasar_lang::{
        cpi::{system, Seed, Signer},
        prelude::*,
        sysvars::Sysvar as _,
    },
    quasar_spl::{
        get_associated_token_address_with_program_const as ata, SPL_TOKEN_ID, TOKEN_2022_ID,
    },
};

const BASE_ACCOUNT_LEN: usize = 165;
const BASE_MINT_LEN: usize = 82;
/// Token-2022 writes an account-type byte here on any account with extensions.
const ACCOUNT_TYPE_OFFSET: usize = BASE_ACCOUNT_LEN;
const ACCOUNT_TYPE_MINT: u8 = 1;
const ACCOUNT_TYPE_ACCOUNT: u8 = 2;
const EXTENSIONS_OFFSET: usize = ACCOUNT_TYPE_OFFSET + 1;
const EXTENSION_TRANSFER_FEE_AMOUNT: u16 = 2;
const AMOUNT_OFFSET: usize = 64;

/// Vault size for an allowlisted Token-2022 mint (PYUSD, USDG): base account,
/// account-type byte, `TransferFeeAmount` (4 + 8) and `TransferHookAccount`
/// (4 + 1).
pub const TOKEN_2022_VAULT_LEN: usize = EXTENSIONS_OFFSET + (4 + 8) + (4 + 1);

/// The token program an allowlisted mint must be owned by, and the treasury's
/// associated token account for it. The treasury accounts are derived at
/// compile time, so no address derivation runs on chain.
pub struct AllowedMint {
    pub token_program: Address,
    pub treasury_token: Address,
}

macro_rules! allowed {
    ($mint:expr, $program:expr) => {
        AllowedMint {
            token_program: $program,
            treasury_token: ata(&PROTOCOL_TREASURY, &$mint, &$program).0,
        }
    };
}

const USDC: AllowedMint = allowed!(USDC_MAINNET_MINT, SPL_TOKEN_ID);
const AUDD: AllowedMint = allowed!(AUDD_MAINNET_MINT, SPL_TOKEN_ID);
#[cfg(feature = "devnet")]
const USDC_DEVNET: AllowedMint = allowed!(USDC_DEVNET_MINT, SPL_TOKEN_ID);
const PYUSD: AllowedMint = allowed!(PYUSD_MAINNET_MINT, TOKEN_2022_ID);
const USDG: AllowedMint = allowed!(USDG_MAINNET_MINT, TOKEN_2022_ID);

pub fn allowed_mint(mint: &Address) -> Option<&'static AllowedMint> {
    if *mint == USDC_MAINNET_MINT {
        return Some(&USDC);
    }
    if *mint == AUDD_MAINNET_MINT {
        return Some(&AUDD);
    }
    #[cfg(feature = "devnet")]
    if *mint == USDC_DEVNET_MINT {
        return Some(&USDC_DEVNET);
    }
    if *mint == PYUSD_MAINNET_MINT {
        return Some(&PYUSD);
    }
    if *mint == USDG_MAINNET_MINT {
        return Some(&USDG);
    }
    None
}

#[inline(always)]
fn data(view: &AccountView) -> &[u8] {
    // SAFETY: read-only access with no outstanding mutable borrow; every
    // caller reads and drops the slice before the next CPI.
    unsafe { view.borrow_unchecked() }
}

/// Accepts the exact base length, or a longer Token-2022 layout whose
/// account-type byte matches. Returns the extension bytes, if any.
fn split_extensions(data: &[u8], base_len: usize, account_type: u8) -> Result<&[u8], ProgramError> {
    if data.len() == base_len {
        return Ok(&[]);
    }
    if data.get(ACCOUNT_TYPE_OFFSET) != Some(&account_type) {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(data.get(EXTENSIONS_OFFSET..).unwrap_or(&[]))
}

/// Rejects anything that is not laid out as a mint.
pub fn check_mint_layout(view: &AccountView) -> Result<(), ProgramError> {
    split_extensions(data(view), BASE_MINT_LEN, ACCOUNT_TYPE_MINT).map(|_| ())
}

/// Rejects anything that is not laid out as a token account.
pub fn check_account_layout(view: &AccountView) -> Result<(), ProgramError> {
    split_extensions(data(view), BASE_ACCOUNT_LEN, ACCOUNT_TYPE_ACCOUNT).map(|_| ())
}

/// Current balance of a token account, read after a CPI.
pub fn amount_of(view: &AccountView) -> Result<u64, ProgramError> {
    let data = data(view);
    match data.get(AMOUNT_OFFSET..AMOUNT_OFFSET + 8) {
        Some(&[a, b, c, d, e, f, g, h]) => Ok(u64::from_le_bytes([a, b, c, d, e, f, g, h])),
        _ => Err(ProgramError::InvalidAccountData),
    }
}

/// Transfer fees withheld on a token account (Token-2022 only). A token account
/// holding withheld fees cannot be closed.
pub fn withheld_fees(view: &AccountView) -> Result<u64, ProgramError> {
    let mut extensions = split_extensions(data(view), BASE_ACCOUNT_LEN, ACCOUNT_TYPE_ACCOUNT)?;
    while let Some((&[k0, k1, l0, l1], rest)) = extensions.split_first_chunk::<4>() {
        let kind = u16::from_le_bytes([k0, k1]);
        let len = u16::from_le_bytes([l0, l1]) as usize;
        let (value, rest) = rest
            .split_at_checked(len)
            .ok_or(ProgramError::InvalidAccountData)?;
        if kind == 0 {
            break;
        }
        if kind == EXTENSION_TRANSFER_FEE_AMOUNT {
            return match value {
                &[a, b, c, d, e, f, g, h] => Ok(u64::from_le_bytes([a, b, c, d, e, f, g, h])),
                _ => Err(ProgramError::InvalidAccountData),
            };
        }
        extensions = rest;
    }
    Ok(0)
}

/// A token account of `mint` under `token_program`, laid out as a token account.
pub fn check_token(
    account: &AccountView,
    mint: &Address,
    token_mint: &Address,
    token_program: &Address,
) -> Result<(), ProgramError> {
    check_account_layout(account)?;
    require!(
        token_mint == mint && account.owner() == token_program,
        EscrowError::InvalidTokenAccount
    );
    Ok(())
}

/// Create the vault PDA owned by the token program, sized for that program.
/// Handles a vault address someone sent lamports to beforehand, as Anchor's
/// `init` does, so pre-funding the address cannot block a lock.
pub fn create_vault(
    payer: &AccountView,
    vault: &AccountView,
    token_program: &Address,
    escrow: &Address,
    bump: u8,
) -> Result<(), ProgramError> {
    require!(
        quasar_lang::is_system_program(vault.owner()) && vault.data_len() == 0,
        ProgramError::AccountAlreadyInitialized
    );
    let space = if *token_program == TOKEN_2022_ID {
        TOKEN_2022_VAULT_LEN
    } else {
        BASE_ACCOUNT_LEN
    };
    let lamports = Rent::get()?.try_minimum_balance(space)?;
    let bump = [bump];
    let seeds = [
        Seed::from(b"token-vault" as &[u8]),
        Seed::from(escrow.as_ref()),
        Seed::from(bump.as_ref()),
    ];
    let signers = [Signer::from(&seeds)];
    if vault.lamports() == 0 {
        system::create_account(payer, vault, lamports, space as u64, token_program)
            .invoke_with_signers(&signers)
    } else {
        let required = lamports.saturating_sub(vault.lamports());
        if required > 0 {
            system::transfer(payer, vault, required).invoke()?;
        }
        system::allocate(vault, space as u64).invoke_with_signers(&signers)?;
        system::assign(vault, token_program).invoke_with_signers(&signers)
    }
}
