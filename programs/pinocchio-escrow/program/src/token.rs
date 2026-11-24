//! Token accounts, mints and transfers for the two token programs the escrow
//! accepts: classic SPL Token and Token-2022.
//!
//! Both programs share the base account layouts and the three instructions
//! the escrow uses (`InitializeAccount3`, `TransferChecked`, `CloseAccount`),
//! so one code path serves both and is pointed at the program that owns the
//! mint. Token-2022 is accepted only for mints on the allowlist, and one
//! instruction of its own is used: `HarvestWithheldTokensToMint`.
use {
    crate::{
        consts::{SYSTEM_PROGRAM_ID, TOKEN_2022_ID, TOKEN_PROGRAM_ID},
        error::{
            fail, AccountDidNotDeserialize, AccountNotInitialized, AccountOwnedByWrongProgram,
        },
    },
    pinocchio::{
        cpi::{invoke, Signer},
        error::ProgramError,
        instruction::{InstructionAccount, InstructionView},
        AccountView, Address, ProgramResult,
    },
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
const EXTENSION_MEMO_TRANSFER: u16 = 8;

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
    /// Frozen by the mint's freeze authority: it can neither send nor receive.
    pub frozen: bool,
    /// Transfer fees withheld on this account (Token-2022 only). A token
    /// account holding withheld fees cannot be closed.
    pub withheld_fees: u64,
    /// Its owner switched on required incoming memos (Token-2022 only): it
    /// takes a transfer only right after a memo instruction.
    pub requires_memo: bool,
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

/// The transfer fees withheld on a token account and whether it requires
/// incoming memos, from its extension records.
fn account_extensions(mut extensions: &[u8]) -> Result<(u64, bool), ProgramError> {
    let (mut withheld, mut memo) = (0, false);
    while let Some((header, rest)) = extensions.split_first_chunk::<4>() {
        let kind = u16::from_le_bytes([header[0], header[1]]);
        let len = usize::from(u16::from_le_bytes([header[2], header[3]]));
        let (value, rest) = rest.split_at_checked(len).ok_or_else(invalid)?;
        if kind == 0 {
            break;
        }
        if kind == EXTENSION_TRANSFER_FEE_AMOUNT {
            let bytes: [u8; 8] = value.try_into().map_err(|_| invalid())?;
            withheld = u64::from_le_bytes(bytes);
        } else if kind == EXTENSION_MEMO_TRANSFER {
            memo = value.first().is_some_and(|flag| *flag != 0);
        }
        extensions = rest;
    }
    Ok((withheld, memo))
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
const STATE_FROZEN: u8 = 2;

impl TokenAccount {
    pub const EMPTY: Self = Self {
        mint: Address::new_from_array([0; 32]),
        owner: Address::new_from_array([0; 32]),
        amount: 0,
        frozen: false,
        withheld_fees: 0,
        requires_memo: false,
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
            1 | STATE_FROZEN => {}
            state => return Err(unusable(state)),
        }
        let (withheld_fees, requires_memo) = account_extensions(extensions)?;
        Ok(Self {
            mint: raw.mint,
            owner: raw.owner,
            amount: u64::from_le_bytes(raw.amount),
            frozen: raw.state == STATE_FROZEN,
            withheld_fees,
            requires_memo,
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

/// The memo the escrow writes before a transfer into a Token-2022 account
/// that requires incoming memos.
const ESCROW_MEMO: &[u8] = b"RAP escrow";

/// An SPL Memo instruction with no signers, sent right before a transfer to
/// an account that requires incoming memos: Token-2022 takes the memo as the
/// transfer's previous sibling instruction. Without it the owner of the
/// receiving account could block the transfer by switching memos on.
#[inline(never)]
pub fn memo(memo_program: &AccountView) -> ProgramResult {
    invoke(
        &InstructionView {
            program_id: memo_program.address(),
            data: ESCROW_MEMO,
            accounts: &[],
        },
        &[memo_program],
    )
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

/// Token-2022 `TransferFeeExtension::HarvestWithheldTokensToMint`: move the
/// transfer fees withheld on `account` to its mint, where the issuer collects
/// them. Anyone may do this, and it needs the mint writable. An account with
/// no withheld fees left can be closed.
#[inline(never)]
pub fn harvest_withheld_fees(
    token_program: &AccountView,
    mint: &AccountView,
    account: &AccountView,
) -> ProgramResult {
    const TRANSFER_FEE_EXTENSION: u8 = 26;
    const HARVEST_WITHHELD_TOKENS_TO_MINT: u8 = 4;
    invoke(
        &InstructionView {
            program_id: token_program.address(),
            data: &[TRANSFER_FEE_EXTENSION, HARVEST_WITHHELD_TOKENS_TO_MINT],
            accounts: &[
                InstructionAccount::writable(mint.address()),
                InstructionAccount::writable(account.address()),
            ],
        },
        &[mint, account],
    )
}
