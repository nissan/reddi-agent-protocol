//! Token account, mint and CPI helpers for the two token programs the escrow
//! accepts: classic SPL Token and Token-2022.
//!
//! anchor-spl is built with its `token` feature only, so nothing here depends
//! on its Token-2022 surface. Both programs share the base account layouts and
//! the three instructions the escrow uses (`InitializeAccount3`,
//! `TransferChecked`, `CloseAccount`), so the classic builders are reused and
//! pointed at the program that owns the mint. One Token-2022 instruction is
//! built by hand: `HarvestWithheldTokensToMint`.
//!
//! Token-2022 is accepted only for mints on the allowlist. Their extension set
//! is fixed at mint creation; see `TOKEN_2022_VAULT_LEN`.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    program_pack::Pack,
};
use anchor_spl::token::spl_token;

/// The Token-2022 program.
pub const TOKEN_2022_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

static TOKEN_PROGRAM_IDS: [Pubkey; 2] = [spl_token::ID, TOKEN_2022_ID];

/// Base length shared by classic and Token-2022 token accounts.
const BASE_ACCOUNT_LEN: usize = spl_token::state::Account::LEN;
const BASE_MINT_LEN: usize = spl_token::state::Mint::LEN;
/// Token-2022 writes an account-type byte here on any account with extensions.
const ACCOUNT_TYPE_OFFSET: usize = BASE_ACCOUNT_LEN;
const ACCOUNT_TYPE_MINT: u8 = 1;
const ACCOUNT_TYPE_ACCOUNT: u8 = 2;
/// Extension records start after the account-type byte: u16 type, u16 length, value.
const EXTENSIONS_OFFSET: usize = ACCOUNT_TYPE_OFFSET + 1;
const EXTENSION_TRANSFER_FEE_AMOUNT: u16 = 2;

/// Size of a vault for an allowlisted Token-2022 mint. PYUSD and USDG carry the
/// transfer-fee and transfer-hook mint extensions, so their token accounts need
/// the base account, the account-type byte, a `TransferFeeAmount` record
/// (4 + 8 bytes) and a `TransferHookAccount` record (4 + 1 bytes). A mint's
/// extension set cannot change after creation, and `InitializeAccount3` fails
/// if this is too small, so a wrong value refuses the lock instead of holding funds.
pub const TOKEN_2022_VAULT_LEN: usize = EXTENSIONS_OFFSET + (4 + 8) + (4 + 1);

/// Vault size for the token program that owns the mint.
pub fn vault_len(token_program: &Pubkey) -> usize {
    if *token_program == TOKEN_2022_ID {
        TOKEN_2022_VAULT_LEN
    } else {
        BASE_ACCOUNT_LEN
    }
}

/// The two accepted token programs.
#[derive(Clone)]
pub struct TokenPrograms;

impl anchor_lang::Ids for TokenPrograms {
    fn ids() -> &'static [Pubkey] {
        &TOKEN_PROGRAM_IDS
    }
}

/// A mint of either accepted program. Only the base fields are read.
#[derive(Clone)]
pub struct Mint {
    pub decimals: u8,
}

/// A token account of either accepted program.
#[derive(Clone)]
pub struct TokenAccount {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    /// Frozen by the mint's freeze authority: it can neither send nor receive.
    pub frozen: bool,
    /// Transfer fees withheld on this account (Token-2022 only). A token
    /// account holding withheld fees cannot be closed.
    pub withheld_fees: u64,
}

fn invalid() -> anchor_lang::error::Error {
    ErrorCode::AccountDidNotDeserialize.into()
}

/// Accepts the exact base length, or a longer Token-2022 layout whose
/// account-type byte matches. Returns the extension bytes, if any.
fn split_extensions(data: &[u8], base_len: usize, account_type: u8) -> Result<&[u8]> {
    if data.len() == base_len {
        return Ok(&[]);
    }
    if data.len() <= ACCOUNT_TYPE_OFFSET || data[ACCOUNT_TYPE_OFFSET] != account_type {
        return Err(invalid());
    }
    Ok(&data[EXTENSIONS_OFFSET..])
}

fn withheld_fees(mut extensions: &[u8]) -> Result<u64> {
    while extensions.len() >= 4 {
        let kind = u16::from_le_bytes([extensions[0], extensions[1]]);
        let len = usize::from(u16::from_le_bytes([extensions[2], extensions[3]]));
        let value = extensions.get(4..4 + len).ok_or_else(invalid)?;
        if kind == 0 {
            break;
        }
        if kind == EXTENSION_TRANSFER_FEE_AMOUNT {
            let bytes: [u8; 8] = value.try_into().map_err(|_| invalid())?;
            return Ok(u64::from_le_bytes(bytes));
        }
        extensions = &extensions[4 + len..];
    }
    Ok(0)
}

impl AccountDeserialize for Mint {
    fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self> {
        let data: &[u8] = buf;
        split_extensions(data, BASE_MINT_LEN, ACCOUNT_TYPE_MINT)?;
        let mint = spl_token::state::Mint::unpack(&data[..BASE_MINT_LEN])?;
        Ok(Self {
            decimals: mint.decimals,
        })
    }
}

impl AccountDeserialize for TokenAccount {
    fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self> {
        let data: &[u8] = buf;
        let extensions = split_extensions(data, BASE_ACCOUNT_LEN, ACCOUNT_TYPE_ACCOUNT)?;
        let account = spl_token::state::Account::unpack(&data[..BASE_ACCOUNT_LEN])?;
        Ok(Self {
            mint: account.mint,
            owner: account.owner,
            amount: account.amount,
            frozen: account.state == spl_token::state::AccountState::Frozen,
            withheld_fees: withheld_fees(extensions)?,
        })
    }
}

macro_rules! token_owned {
    ($name:ident) => {
        impl AccountSerialize for $name {}
        impl anchor_lang::Owners for $name {
            fn owners() -> &'static [Pubkey] {
                &TOKEN_PROGRAM_IDS
            }
        }
        #[cfg(feature = "idl-build")]
        impl anchor_lang::IdlBuild for $name {}
        #[cfg(feature = "idl-build")]
        impl anchor_lang::Discriminator for $name {
            const DISCRIMINATOR: &'static [u8] = &[];
        }
    };
}

token_owned!(Mint);
token_owned!(TokenAccount);

/// Reads the amount of a token account that is not held as a typed account.
pub fn amount_of(account: &AccountInfo) -> Result<u64> {
    let data = account.try_borrow_data()?;
    Ok(TokenAccount::try_deserialize_unchecked(&mut &data[..])?.amount)
}

pub fn initialize_account3<'info>(
    token_program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    owner: &Pubkey,
) -> Result<()> {
    let mut ix =
        spl_token::instruction::initialize_account3(&spl_token::ID, account.key, mint.key, owner)?;
    ix.program_id = *token_program.key;
    invoke_signed(&ix, &[account.clone(), mint.clone()], &[]).map_err(Into::into)
}

pub struct Transfer<'a, 'info> {
    pub token_program: &'a AccountInfo<'info>,
    pub from: &'a AccountInfo<'info>,
    pub mint: &'a AccountInfo<'info>,
    pub to: &'a AccountInfo<'info>,
    pub authority: &'a AccountInfo<'info>,
}

pub fn transfer_checked(
    t: Transfer,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut ix = spl_token::instruction::transfer_checked(
        &spl_token::ID,
        t.from.key,
        t.mint.key,
        t.to.key,
        t.authority.key,
        &[],
        amount,
        decimals,
    )?;
    ix.program_id = *t.token_program.key;
    invoke_signed(
        &ix,
        &[
            t.from.clone(),
            t.mint.clone(),
            t.to.clone(),
            t.authority.clone(),
        ],
        signer_seeds,
    )
    .map_err(Into::into)
}

pub fn close_account<'info>(
    token_program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut ix = spl_token::instruction::close_account(
        &spl_token::ID,
        account.key,
        destination.key,
        authority.key,
        &[],
    )?;
    ix.program_id = *token_program.key;
    invoke_signed(
        &ix,
        &[account.clone(), destination.clone(), authority.clone()],
        signer_seeds,
    )
    .map_err(Into::into)
}

/// Token-2022 `TransferFeeExtension::HarvestWithheldTokensToMint`: move the
/// transfer fees withheld on `account` to its mint, where the issuer collects
/// them. Anyone may do this, and it needs the mint writable. An account with
/// no withheld fees left can be closed.
pub fn harvest_withheld_fees<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
) -> Result<()> {
    const TRANSFER_FEE_EXTENSION: u8 = 26;
    const HARVEST_WITHHELD_TOKENS_TO_MINT: u8 = 4;
    let ix = Instruction {
        program_id: *token_program.key,
        accounts: vec![
            AccountMeta::new(*mint.key, false),
            AccountMeta::new(*account.key, false),
        ],
        data: vec![TRANSFER_FEE_EXTENSION, HARVEST_WITHHELD_TOKENS_TO_MINT],
    };
    invoke(&ix, &[mint.clone(), account.clone()]).map_err(Into::into)
}
