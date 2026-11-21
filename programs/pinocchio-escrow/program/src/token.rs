//! Token accounts, mints and transfers for the two token programs the escrow
//! accepts: classic SPL Token and Token-2022.
//!
//! Both programs share the base account layouts and the three instructions
//! the escrow uses (`InitializeAccount3`, `TransferChecked`, `CloseAccount`),
//! so one code path serves both and is pointed at the program that owns the
//! mint. Token-2022 is accepted only for mints on the allowlist.
use {
    crate::{
        consts::{SYSTEM_PROGRAM_ID, TOKEN_2022_ID, TOKEN_PROGRAM_ID},
        error::{
            fail, AccountDidNotDeserialize, AccountNotInitialized, AccountOwnedByWrongProgram,
        },
    },
    pinocchio::{cpi::Signer, error::ProgramError, AccountView, Address, ProgramResult},
    pinocchio_token::instructions::{CloseAccount, TransferChecked},
};

/// Base length shared by classic and Token-2022 token accounts and mints.
const BASE_ACCOUNT_LEN: usize = 165;
const BASE_MINT_LEN: usize = 82;
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
pub fn vault_len(token_program: &Address) -> usize {
    if token_program == &TOKEN_2022_ID {
        TOKEN_2022_VAULT_LEN
    } else {
        BASE_ACCOUNT_LEN
    }
}

pub fn is_token_program(address: &Address) -> bool {
    address == &TOKEN_PROGRAM_ID || address == &TOKEN_2022_ID
}

/// The fields of a token account the escrow reads.
#[derive(Clone, Copy)]
pub struct TokenAccount {
    pub mint: Address,
    pub owner: Address,
    pub amount: u64,
    /// Transfer fees withheld on this account (Token-2022 only). A token
    /// account holding withheld fees cannot be closed.
    pub withheld_fees: u64,
}

fn invalid() -> ProgramError {
    fail(&AccountDidNotDeserialize)
}

/// The account must exist and belong to one of the two token programs.
fn token_owned(account: &AccountView) -> ProgramResult {
    if account.lamports() == 0 && account.owned_by(&SYSTEM_PROGRAM_ID) {
        return Err(fail(&AccountNotInitialized));
    }
    if !is_token_program(&account.owner()) {
        return Err(fail(&AccountOwnedByWrongProgram));
    }
    Ok(())
}

/// Accepts the exact base length, or a longer Token-2022 layout whose
/// account-type byte matches. Returns the base bytes and the extension bytes,
/// if any.
fn split_extensions<const BASE: usize>(
    data: &[u8],
    account_type: u8,
) -> Result<(&[u8; BASE], &[u8]), ProgramError> {
    let (base, rest) = data.split_first_chunk::<BASE>().ok_or_else(invalid)?;
    if rest.is_empty() {
        return Ok((base, rest));
    }
    // Mints are padded to the token-account length before the type byte.
    let (kind, extensions) = data
        .split_at_checked(ACCOUNT_TYPE_OFFSET)
        .and_then(|(_, tail)| tail.split_first())
        .ok_or_else(invalid)?;
    if *kind != account_type {
        return Err(invalid());
    }
    Ok((base, extensions))
}

fn withheld_fees(mut extensions: &[u8]) -> Result<u64, ProgramError> {
    while let Some((header, rest)) = extensions.split_first_chunk::<4>() {
        let kind = u16::from_le_bytes([header[0], header[1]]);
        let len = usize::from(u16::from_le_bytes([header[2], header[3]]));
        let (value, rest) = rest.split_at_checked(len).ok_or_else(invalid)?;
        if kind == 0 {
            break;
        }
        if kind == EXTENSION_TRANSFER_FEE_AMOUNT {
            let bytes: [u8; 8] = value.try_into().map_err(|_| invalid())?;
            return Ok(u64::from_le_bytes(bytes));
        }
        extensions = rest;
    }
    Ok(0)
}

/// Base layout shared by both token programs' accounts.
#[repr(C)]
struct RawTokenAccount {
    mint: Address,
    owner: Address,
    amount: [u8; 8],
    delegate: [u8; 36],
    /// 0 uninitialised, 1 initialised, 2 frozen.
    state: u8,
    rest: [u8; 56],
}
const _: () = assert!(core::mem::size_of::<RawTokenAccount>() == BASE_ACCOUNT_LEN);

impl TokenAccount {
    pub const EMPTY: Self = Self {
        mint: Address::new_from_array([0; 32]),
        owner: Address::new_from_array([0; 32]),
        amount: 0,
        withheld_fees: 0,
    };

    /// Read a token account of either accepted program. Called again after a
    /// transfer, it returns the balances as that transfer left them.
    pub fn read(account: &AccountView) -> Result<Self, ProgramError> {
        token_owned(account)?;
        let data = account.try_borrow()?;
        let (base, extensions) = split_extensions::<BASE_ACCOUNT_LEN>(&data, ACCOUNT_TYPE_ACCOUNT)?;
        // SAFETY: `base` is exactly the struct's size, which has alignment 1
        // and no invalid bit patterns.
        let raw = unsafe { &*(base.as_ptr() as *const RawTokenAccount) };
        match raw.state {
            1 | 2 => {}
            state => return Err(unusable(state)),
        }
        Ok(Self {
            mint: raw.mint,
            owner: raw.owner,
            amount: u64::from_le_bytes(raw.amount),
            withheld_fees: withheld_fees(extensions)?,
        })
    }
}

/// The error for a token account or mint whose state byte is not a usable
/// one, with the log line Anchor writes when the token library rejects it.
#[cold]
#[inline(never)]
fn unusable(state: u8) -> ProgramError {
    if state == 0 {
        crate::log::message("ProgramError occurred. Error Code: UninitializedAccount. Error Number: 42949672960. Error Message: An attempt to operate on an account that hasn't been initialized.");
        ProgramError::UninitializedAccount
    } else {
        crate::log::message("ProgramError occurred. Error Code: InvalidAccountData. Error Number: 17179869184. Error Message: An account's data contents was invalid.");
        ProgramError::InvalidAccountData
    }
}

/// Decimals of an initialised mint of either accepted program.
pub fn mint_decimals(mint: &AccountView) -> Result<u8, ProgramError> {
    token_owned(mint)?;
    let data = mint.try_borrow()?;
    let (base, _) = split_extensions::<BASE_MINT_LEN>(&data, ACCOUNT_TYPE_MINT)?;
    // Byte 45 is the initialised flag, byte 44 the decimals.
    match base[45] {
        1 => Ok(base[44]),
        state => Err(unusable(state)),
    }
}

/// A `TransferChecked` out of `from`, signed by `authority` (a wallet that
/// signed the transaction, or a program-derived address via `signers`).
///
/// No transfer-hook accounts are ever passed, so a mint with an active hook
/// cannot be moved.
pub struct Transfer<'a> {
    pub token_program: &'a AccountView,
    pub from: &'a AccountView,
    pub mint: &'a AccountView,
    pub to: &'a AccountView,
    pub authority: &'a AccountView,
    pub decimals: u8,
}

impl Transfer<'_> {
    #[inline(never)]
    pub fn send(&self, amount: u64, signers: &[Signer]) -> ProgramResult {
        TransferChecked::new(
            self.from,
            self.mint,
            self.to,
            self.authority,
            amount,
            self.decimals,
        )
        .invoke_signed_with_unverified_program(signers, self.token_program.address())
    }
}

pub fn close_account(
    token_program: &AccountView,
    account: &AccountView,
    destination: &AccountView,
    authority: &AccountView,
    signers: &[Signer],
) -> ProgramResult {
    CloseAccount::new(account, destination, authority)
        .invoke_signed_with_unverified_program(signers, token_program.address())
}
