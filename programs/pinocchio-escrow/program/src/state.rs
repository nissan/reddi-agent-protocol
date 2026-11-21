//! Account layouts, read and written in place.
//!
//! The byte layouts are the ones the Anchor program stores (8-byte
//! discriminator, then Borsh fields), so existing clients decode these
//! accounts unchanged. Each layout is a plain struct of byte fields with no
//! padding, so an account's data is read or written with one length check and
//! no field-by-field decoding.
use {
    crate::{
        consts::{discriminator, AGENT_MODEL_MAX_LEN, SYSTEM_PROGRAM_ID},
        error::{
            fail, AccountDidNotDeserialize, AccountDiscriminatorMismatch,
            AccountDiscriminatorNotFound, AccountNotInitialized, AccountOwnedByWrongProgram,
        },
    },
    core::mem::{align_of, size_of},
    pinocchio::{error::ProgramError, AccountView, Address, ProgramResult},
};

pub const STATUS_LOCKED: u8 = 0;

/// A record this program stores at the start of an account.
///
/// # Safety
///
/// The type must have alignment 1, no padding, and be valid for every bit
/// pattern, and its first eight bytes must be the discriminator.
pub unsafe trait Record: Copy {
    const DISCRIMINATOR: [u8; 8];
    /// Size the account is created with. At least `size_of::<Self>()`.
    const LEN: usize;

    /// Copy the record out of a live account of this program, after checking
    /// the owner, the discriminator and the size.
    #[inline(always)]
    fn load(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let data = checked_data(account, program_id, &Self::DISCRIMINATOR, Self::LEN)?;
        // SAFETY: `checked_data` returned at least `LEN >= size_of::<Self>()`
        // readable bytes, no mutable borrow of the account is live, and `Self`
        // has alignment 1 and no invalid bit patterns.
        Ok(unsafe { core::ptr::read(data as *const Self) })
    }

    /// Write the record to the start of an account created with `LEN` bytes.
    fn store(&self, account: &mut AccountView) -> ProgramResult {
        let mut data = account.try_borrow_mut()?;
        if data.len() < Self::LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }
        // SAFETY: as in `load`; the borrow is exclusive.
        unsafe { core::ptr::write(data.as_mut_ptr() as *mut Self, *self) };
        Ok(())
    }
}

/// Pointer to the data of a live account of this program that starts with
/// `discriminator` and holds at least `len` bytes.
#[inline(never)]
fn checked_data(
    account: &AccountView,
    program_id: &Address,
    discriminator: &[u8; 8],
    len: usize,
) -> Result<*const u8, ProgramError> {
    if account.lamports() == 0 && account.owned_by(&SYSTEM_PROGRAM_ID) {
        return Err(fail(&AccountNotInitialized));
    }
    if !account.owned_by(program_id) {
        return Err(fail(&AccountOwnedByWrongProgram));
    }
    let data = account.try_borrow()?;
    let Some(found) = data.first_chunk::<8>() else {
        return Err(fail(&AccountDiscriminatorNotFound));
    };
    if found != discriminator {
        return Err(fail(&AccountDiscriminatorMismatch));
    }
    if data.len() < len {
        return Err(fail(&AccountDidNotDeserialize));
    }
    Ok(data.as_ptr())
}

macro_rules! assert_layout {
    ($type:ty, $size:expr) => {
        const _: () = assert!(size_of::<$type>() == $size && align_of::<$type>() == 1);
        const _: () = assert!(<$type as Record>::LEN >= size_of::<$type>());
    };
}

// ── SOL escrow ──────────────────────────────────────────────────────────────

/// SOL escrow record. PDA seeds: `["escrow", payer, nonce]`. The account holds
/// the locked lamports on top of its rent.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct SolEscrow {
    discriminator: [u8; 8],
    pub payer: Address,
    pub payee: Address,
    amount: [u8; 8],
    pub nonce: [u8; 16],
    pub status: u8,
    created_at: [u8; 8],
    created_slot: [u8; 8],
    /// Always 0 in V1: no instruction delegates an escrow.
    delegated_to_per: u8,
    /// Borsh tag of an optional session key. Always 0 ("none") in V1, which
    /// is what keeps the two fields after it at fixed offsets.
    per_session_key: u8,
    pub bump: u8,
    metered: u8,
}

// SAFETY: byte fields only, discriminator first.
unsafe impl Record for SolEscrow {
    const DISCRIMINATOR: [u8; 8] = discriminator("account:EscrowAccount");
    /// The Anchor account's size, which reserves room for a session key.
    const LEN: usize = 8 + 32 + 32 + 8 + 16 + 1 + 8 + 8 + 1 + 33 + 1 + 1;
}
assert_layout!(SolEscrow, 117);

impl SolEscrow {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        payer: &Address,
        payee: &Address,
        amount: u64,
        nonce: [u8; 16],
        created_at: i64,
        created_slot: u64,
        bump: u8,
        metered: bool,
    ) -> Self {
        Self {
            discriminator: Self::DISCRIMINATOR,
            payer: *payer,
            payee: *payee,
            amount: amount.to_le_bytes(),
            nonce,
            status: STATUS_LOCKED,
            created_at: created_at.to_le_bytes(),
            created_slot: created_slot.to_le_bytes(),
            delegated_to_per: 0,
            per_session_key: 0,
            bump,
            metered: metered as u8,
        }
    }

    pub fn load_checked(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let record = Self::load(account, program_id)?;
        if record.status > 2
            || record.delegated_to_per != 0
            || record.per_session_key != 0
            || record.metered > 1
        {
            return Err(fail(&AccountDidNotDeserialize));
        }
        Ok(record)
    }

    pub fn amount(&self) -> u64 {
        u64::from_le_bytes(self.amount)
    }

    pub fn created_slot(&self) -> u64 {
        u64::from_le_bytes(self.created_slot)
    }

    pub fn metered(&self) -> bool {
        self.metered == 1
    }
}

// ── Token escrow ────────────────────────────────────────────────────────────

/// Token escrow record. PDA seeds: `["token-escrow", payer, nonce]`; its vault
/// is the token account at `["token-vault", escrow]`.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct TokenEscrow {
    discriminator: [u8; 8],
    pub payer: Address,
    pub payee: Address,
    pub mint: Address,
    /// The payer token account the funds came from, and where a payee's
    /// decline returns them.
    pub source: Address,
    /// The payee token account recorded at lock time; the only payout target.
    pub recipient: Address,
    amount: [u8; 8],
    pub nonce: [u8; 16],
    pub status: u8,
    created_slot: [u8; 8],
    pub bump: u8,
    metered: u8,
}

// SAFETY: byte fields only, discriminator first.
unsafe impl Record for TokenEscrow {
    const DISCRIMINATOR: [u8; 8] = discriminator("account:TokenEscrowAccount");
    const LEN: usize = 8 + 32 * 5 + 8 + 16 + 1 + 8 + 1 + 1;
}
assert_layout!(TokenEscrow, 203);

impl TokenEscrow {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        payer: &Address,
        payee: &Address,
        mint: &Address,
        source: &Address,
        recipient: &Address,
        amount: u64,
        nonce: [u8; 16],
        created_slot: u64,
        bump: u8,
        metered: bool,
    ) -> Self {
        Self {
            discriminator: Self::DISCRIMINATOR,
            payer: *payer,
            payee: *payee,
            mint: *mint,
            source: *source,
            recipient: *recipient,
            amount: amount.to_le_bytes(),
            nonce,
            status: STATUS_LOCKED,
            created_slot: created_slot.to_le_bytes(),
            bump,
            metered: metered as u8,
        }
    }

    pub fn load_checked(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let record = Self::load(account, program_id)?;
        if record.status > 2 || record.metered > 1 {
            return Err(fail(&AccountDidNotDeserialize));
        }
        Ok(record)
    }

    pub fn amount(&self) -> u64 {
        u64::from_le_bytes(self.amount)
    }

    pub fn created_slot(&self) -> u64 {
        u64::from_le_bytes(self.created_slot)
    }

    pub fn metered(&self) -> bool {
        self.metered == 1
    }
}

// ── Agent registry ──────────────────────────────────────────────────────────

/// Registry record. PDA seeds: `["agent", owner]`.
///
/// The model name is a length-prefixed string in the middle of the record, so
/// the record is a fixed head, the name, then a fixed tail:
/// `AgentHead | model bytes | AgentTerms`.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct AgentHead {
    discriminator: [u8; 8],
    pub owner: Address,
    /// 0 primary, 1 attestation, 2 both.
    agent_type: u8,
    model_len: [u8; 4],
}

// SAFETY: byte fields only, discriminator first.
unsafe impl Record for AgentHead {
    const DISCRIMINATOR: [u8; 8] = discriminator("account:AgentAccount");
    /// The Anchor account's size: room for a 64-byte model name and two spare bytes.
    const LEN: usize = 150;
}
assert_layout!(AgentHead, 45);

/// The fields after the model name.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct AgentTerms {
    rate_lamports: [u8; 8],
    min_reputation: u8,
    reputation_score: [u8; 2],
    jobs_completed: [u8; 8],
    jobs_failed: [u8; 8],
    created_at: [u8; 8],
    active: u8,
    attestation_accuracy: [u8; 2],
    bump: u8,
}
const _: () = assert!(size_of::<AgentTerms>() == 39 && align_of::<AgentTerms>() == 1);
// A record with the longest allowed name fits the account.
const _: () = assert!(
    size_of::<AgentHead>() + AGENT_MODEL_MAX_LEN + size_of::<AgentTerms>() <= AgentHead::LEN
);

impl AgentHead {
    /// The head of a stored record, with the length of its model name.
    pub fn load_checked(
        account: &AccountView,
        program_id: &Address,
    ) -> Result<(Self, usize), ProgramError> {
        let head = Self::load(account, program_id)?;
        let model_len = u32::from_le_bytes(head.model_len) as usize;
        if head.agent_type > 2 || model_len > AGENT_MODEL_MAX_LEN {
            return Err(fail(&AccountDidNotDeserialize));
        }
        Ok((head, model_len))
    }

    /// Fill a freshly created, zeroed account. `model` is at most
    /// `AGENT_MODEL_MAX_LEN` bytes.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        account: &mut AccountView,
        owner: &Address,
        agent_type: u8,
        model: &[u8],
        rate_lamports: u64,
        min_reputation: u8,
        created_at: i64,
        bump: u8,
    ) -> ProgramResult {
        if model.len() > AGENT_MODEL_MAX_LEN {
            return Err(ProgramError::InvalidArgument);
        }
        Self {
            discriminator: Self::DISCRIMINATOR,
            owner: *owner,
            agent_type,
            model_len: (model.len() as u32).to_le_bytes(),
        }
        .store(account)?;
        let terms = AgentTerms {
            rate_lamports: rate_lamports.to_le_bytes(),
            min_reputation,
            reputation_score: [0; 2],
            jobs_completed: [0; 8],
            jobs_failed: [0; 8],
            created_at: created_at.to_le_bytes(),
            active: 1,
            attestation_accuracy: [0; 2],
            bump,
        };
        let mut data = account.try_borrow_mut()?;
        // SAFETY: `store` checked the account holds `LEN` bytes, and
        // head + name + terms fit in `LEN` for any allowed name (asserted above).
        unsafe {
            let name = data.as_mut_ptr().add(size_of::<Self>());
            core::ptr::copy_nonoverlapping(model.as_ptr(), name, model.len());
            core::ptr::write(name.add(model.len()) as *mut AgentTerms, terms);
        }
        Ok(())
    }

    /// Change the three fields an owner may change after registering.
    /// `model_len` comes from `load_checked` on the same account.
    pub fn set_terms(
        account: &mut AccountView,
        model_len: usize,
        rate_lamports: u64,
        min_reputation: u8,
        active: bool,
    ) -> ProgramResult {
        let mut data = account.try_borrow_mut()?;
        if data.len() < Self::LEN || model_len > AGENT_MODEL_MAX_LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        // SAFETY: bounds as in `create`; the borrow is exclusive.
        let terms = unsafe {
            &mut *(data.as_mut_ptr().add(size_of::<Self>() + model_len) as *mut AgentTerms)
        };
        terms.rate_lamports = rate_lamports.to_le_bytes();
        terms.min_reputation = min_reputation;
        terms.active = active as u8;
        Ok(())
    }
}
