//! Account layouts, read and written in place.
//!
//! The byte layouts are the ones the Anchor program stores (8-byte
//! discriminator, then Borsh fields), so existing clients decode these
//! accounts unchanged. Each layout is a plain struct of byte fields with no
//! padding, so an account's data is read or written with one length check and
//! no field-by-field decoding.
use {
    crate::{
        checks::at_seeds,
        consts::{
            discriminator, AGENT_MODEL_MAX_LEN, ATTESTATION_SEED, BUDGET_ALLOWLIST_LEN,
            BUDGET_SEED, DELIVERY_SEED, MIN_REVIEW_SLOTS, RATING_SEED, RESERVATION_SEED, SCORE_MAX,
            SYSTEM_PROGRAM_ID,
        },
        error::{
            fail, AccountDidNotDeserialize, AccountDiscriminatorMismatch,
            AccountDiscriminatorNotFound, AccountNotInitialized, AccountOwnedByWrongProgram,
        },
    },
    core::mem::{align_of, size_of},
    pinocchio::{error::ProgramError, AccountView, Address, ProgramResult},
};

pub const STATUS_LOCKED: u8 = 0;

/// Bits of an escrow's `metered` byte. Bit 0 has been the whole byte since
/// the layout was introduced, so an escrow that is not rated stores 0 or 1 as
/// it always did.
const FLAG_METERED: u8 = 0x01;
/// The payer opted the escrow into rating with `open_rating`. Every exit of
/// such an escrow takes its rating account.
const FLAG_RATED: u8 = 0x02;
/// The payer opted the escrow into the delivery check with `open_delivery`.
/// Every exit of such an escrow takes its delivery account.
const FLAG_DELIVERY: u8 = 0x04;
const FLAGS_KNOWN: u8 = FLAG_METERED | FLAG_RATED | FLAG_DELIVERY;

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
    /// Slots after `created_slot` from which the payee may claim.
    claim_window_slots: [u8; 8],
    /// Slots after `created_slot` from which the payer may refund itself.
    cancel_window_slots: [u8; 8],
    /// Set while the escrow is delegated to a PER session. Only the `per`
    /// instructions set it.
    delegated_to_per: u8,
    /// Borsh tag of an optional session key: 0 for none, 1 when a 32-byte key
    /// follows. With a key present the two fields below sit 32 bytes further
    /// on in the account; `load_checked` reads them from there.
    per_session_key: u8,
    pub bump: u8,
    /// `FLAG_METERED` and `FLAG_RATED`.
    metered: u8,
}

/// Where `metered` sits without a session key.
const SOL_FLAGS_AT: usize = 132;
const _: () = assert!(SOL_FLAGS_AT + 1 == size_of::<SolEscrow>());

/// Where the session key starts when its tag is 1, and where `bump` and
/// `metered` then sit.
const SESSION_KEY_AT: usize = 131;
const DELEGATED_BUMP_AT: usize = SESSION_KEY_AT + 32;
const _: () = assert!(DELEGATED_BUMP_AT + 2 == SolEscrow::LEN);

// SAFETY: byte fields only, discriminator first.
unsafe impl Record for SolEscrow {
    const DISCRIMINATOR: [u8; 8] = discriminator("account:EscrowAccount");
    /// The Anchor account's size, which reserves room for a session key.
    const LEN: usize = 8 + 32 + 32 + 8 + 16 + 1 + 8 + 8 + 8 + 8 + 1 + 33 + 1 + 1;
}
assert_layout!(SolEscrow, 133);

impl SolEscrow {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        payer: &Address,
        payee: &Address,
        amount: u64,
        nonce: [u8; 16],
        created_at: i64,
        created_slot: u64,
        claim_window_slots: u64,
        cancel_window_slots: u64,
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
            claim_window_slots: claim_window_slots.to_le_bytes(),
            cancel_window_slots: cancel_window_slots.to_le_bytes(),
            delegated_to_per: 0,
            per_session_key: 0,
            bump,
            metered: metered as u8,
        }
    }

    pub fn load_checked(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let mut record = Self::load(account, program_id)?;
        if record.per_session_key == 1 {
            let data = account.try_borrow()?;
            // `load` checked the account holds `LEN` bytes.
            let Some(&[bump, metered]) = data
                .get(DELEGATED_BUMP_AT..)
                .and_then(|tail| tail.first_chunk::<2>())
            else {
                return Err(fail(&AccountDidNotDeserialize));
            };
            record.bump = bump;
            record.metered = metered;
        }
        if record.status > 2
            || record.delegated_to_per > 1
            || record.per_session_key > 1
            || record.metered > FLAGS_KNOWN
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
        self.metered & FLAG_METERED != 0
    }

    /// Whether the payer opted this escrow into rating.
    pub fn rated(&self) -> bool {
        self.metered & FLAG_RATED != 0
    }

    /// Whether the payer opted this escrow into the delivery check.
    pub fn delivery_checked(&self) -> bool {
        self.metered & FLAG_DELIVERY != 0
    }

    /// Set the rated flag on `account`. `self` is the record `load_checked`
    /// returned for the same account; the flag byte sits behind the session
    /// key when there is one.
    pub fn set_rated(&self, account: &mut AccountView) -> ProgramResult {
        self.add_flag(account, FLAG_RATED)
    }

    /// Set the delivery-check flag on `account`, as `set_rated` does.
    pub fn set_delivery_checked(&self, account: &mut AccountView) -> ProgramResult {
        self.add_flag(account, FLAG_DELIVERY)
    }

    fn add_flag(&self, account: &mut AccountView, flag: u8) -> ProgramResult {
        let at = if self.per_session_key == 1 {
            DELEGATED_BUMP_AT + 1
        } else {
            SOL_FLAGS_AT
        };
        let mut data = account.try_borrow_mut()?;
        let Some(flags) = data.get_mut(at) else {
            return Err(ProgramError::AccountDataTooSmall);
        };
        *flags = self.metered | flag;
        Ok(())
    }

    pub fn claim_window_slots(&self) -> u64 {
        u64::from_le_bytes(self.claim_window_slots)
    }

    pub fn cancel_window_slots(&self) -> u64 {
        u64::from_le_bytes(self.cancel_window_slots)
    }

    /// Whether the escrow is delegated to a PER session. Read in every
    /// build, though only a `per` build can set it.
    pub fn delegated(&self) -> bool {
        self.delegated_to_per == 1
    }
}

#[cfg(feature = "per")]
impl SolEscrow {
    /// The session key recorded on `account`, if any. `self` is the record
    /// `load_checked` returned for the same account.
    pub fn session_key(&self, account: &AccountView) -> Result<Option<[u8; 32]>, ProgramError> {
        if self.per_session_key == 0 {
            return Ok(None);
        }
        let data = account.try_borrow()?;
        match data
            .get(SESSION_KEY_AT..)
            .and_then(|tail| tail.first_chunk::<32>())
        {
            Some(key) => Ok(Some(*key)),
            None => Err(fail(&AccountDidNotDeserialize)),
        }
    }

    /// Record a delegation: set the flag, store the key, and move `bump` and
    /// `metered` behind it.
    pub fn delegate(&self, account: &mut AccountView, session_key: &[u8; 32]) -> ProgramResult {
        let mut data = account.try_borrow_mut()?;
        let Some(tail) = data
            .get_mut(SESSION_KEY_AT - 2..)
            .and_then(|tail| tail.first_chunk_mut::<36>())
        else {
            return Err(ProgramError::AccountDataTooSmall);
        };
        let mut delegated = [1u8; 36];
        if let Some(key) = delegated
            .get_mut(2..)
            .and_then(|key| key.first_chunk_mut::<32>())
        {
            *key = *session_key;
        }
        delegated[34] = self.bump;
        delegated[35] = self.metered;
        *tail = delegated;
        Ok(())
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
    /// `FLAG_METERED` and `FLAG_RATED`.
    metered: u8,
    /// Slots after `created_slot` from which the payee may claim.
    claim_window_slots: [u8; 8],
    /// Slots after `created_slot` from which the payer may refund itself.
    cancel_window_slots: [u8; 8],
}

/// Where `metered` sits in a token escrow.
const TOKEN_FLAGS_AT: usize = 8 + 32 * 5 + 8 + 16 + 1 + 8 + 1;
const _: () = assert!(TOKEN_FLAGS_AT + 1 + 8 + 8 == size_of::<TokenEscrow>());

// SAFETY: byte fields only, discriminator first.
unsafe impl Record for TokenEscrow {
    const DISCRIMINATOR: [u8; 8] = discriminator("account:TokenEscrowAccount");
    const LEN: usize = 8 + 32 * 5 + 8 + 16 + 1 + 8 + 1 + 1 + 8 + 8;
}
assert_layout!(TokenEscrow, 219);

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
        claim_window_slots: u64,
        cancel_window_slots: u64,
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
            claim_window_slots: claim_window_slots.to_le_bytes(),
            cancel_window_slots: cancel_window_slots.to_le_bytes(),
        }
    }

    pub fn claim_window_slots(&self) -> u64 {
        u64::from_le_bytes(self.claim_window_slots)
    }

    pub fn cancel_window_slots(&self) -> u64 {
        u64::from_le_bytes(self.cancel_window_slots)
    }

    pub fn load_checked(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let record = Self::load(account, program_id)?;
        if record.status > 2 || record.metered > FLAGS_KNOWN {
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
        self.metered & FLAG_METERED != 0
    }

    /// Whether the payer opted this escrow into rating.
    pub fn rated(&self) -> bool {
        self.metered & FLAG_RATED != 0
    }

    /// Whether the payer opted this escrow into the delivery check.
    pub fn delivery_checked(&self) -> bool {
        self.metered & FLAG_DELIVERY != 0
    }

    /// Set the rated flag on `account`, which holds this record.
    pub fn set_rated(&self, account: &mut AccountView) -> ProgramResult {
        self.add_flag(account, FLAG_RATED)
    }

    /// Set the delivery-check flag on `account`, which holds this record.
    pub fn set_delivery_checked(&self, account: &mut AccountView) -> ProgramResult {
        self.add_flag(account, FLAG_DELIVERY)
    }

    fn add_flag(&self, account: &mut AccountView, flag: u8) -> ProgramResult {
        let mut data = account.try_borrow_mut()?;
        let Some(flags) = data.get_mut(TOKEN_FLAGS_AT) else {
            return Err(ProgramError::AccountDataTooSmall);
        };
        *flags = self.metered | flag;
        Ok(())
    }
}

/// A locked escrow of either kind, told apart by its discriminator.
pub enum AnyEscrow {
    Sol(SolEscrow),
    Token(TokenEscrow),
}

impl AnyEscrow {
    pub fn load(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let is_token = account.owned_by(program_id)
            && account
                .try_borrow()?
                .first_chunk::<8>()
                .is_some_and(|found| found == &TokenEscrow::DISCRIMINATOR);
        if is_token {
            Ok(Self::Token(TokenEscrow::load_checked(account, program_id)?))
        } else {
            // Reports the right error for an account that is neither.
            Ok(Self::Sol(SolEscrow::load_checked(account, program_id)?))
        }
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

impl AgentTerms {
    pub fn bump(&self) -> u8 {
        self.bump
    }

    pub fn active(&self) -> bool {
        self.active == 1
    }

    fn reputation(&self) -> u16 {
        u16::from_le_bytes(self.reputation_score)
    }

    /// Fold a 1 to 10 rating into the rolling reputation score: nine parts
    /// the old score, one part the rating scaled to 0..=10000.
    pub fn fold_rating(&mut self, rating: u8) {
        let updated = (self.reputation() as u32 * 9 + rating as u32 * 1000) / 10;
        self.reputation_score = (updated.min(SCORE_MAX as u32) as u16).to_le_bytes();
    }

    pub fn penalise(&mut self, points: u16) {
        self.reputation_score = self.reputation().saturating_sub(points).to_le_bytes();
    }

    pub fn count_completed(&mut self) {
        self.jobs_completed = u64::from_le_bytes(self.jobs_completed)
            .saturating_add(1)
            .to_le_bytes();
    }

    pub fn count_failed(&mut self) {
        self.jobs_failed = u64::from_le_bytes(self.jobs_failed)
            .saturating_add(1)
            .to_le_bytes();
    }

    pub fn raise_accuracy(&mut self, points: u16) {
        self.attestation_accuracy = u16::from_le_bytes(self.attestation_accuracy)
            .saturating_add(points)
            .min(SCORE_MAX)
            .to_le_bytes();
    }
}

impl AgentHead {
    pub fn agent_type(&self) -> u8 {
        self.agent_type
    }

    /// A stored record in full: head, length of the model name, and the
    /// fields after the name.
    pub fn load_full(
        account: &AccountView,
        program_id: &Address,
    ) -> Result<(Self, usize, AgentTerms), ProgramError> {
        let (head, model_len) = Self::load_checked(account, program_id)?;
        let data = account.try_borrow()?;
        // SAFETY: `load_checked` checked the account holds `LEN` bytes and
        // the name is at most `AGENT_MODEL_MAX_LEN`, so the terms are in
        // bounds (asserted above); `AgentTerms` has alignment 1 and no
        // invalid bit patterns.
        let terms = unsafe {
            core::ptr::read(data.as_ptr().add(size_of::<Self>() + model_len) as *const AgentTerms)
        };
        if terms.active > 1 {
            return Err(fail(&AccountDidNotDeserialize));
        }
        Ok((head, model_len, terms))
    }

    /// Write back the fields after the name. `model_len` comes from
    /// `load_full` on the same account.
    pub fn store_terms(
        account: &mut AccountView,
        model_len: usize,
        terms: &AgentTerms,
    ) -> ProgramResult {
        let mut data = account.try_borrow_mut()?;
        if data.len() < Self::LEN || model_len > AGENT_MODEL_MAX_LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        // SAFETY: bounds as in `load_full`; the borrow is exclusive.
        unsafe {
            core::ptr::write(
                data.as_mut_ptr().add(size_of::<Self>() + model_len) as *mut AgentTerms,
                *terms,
            )
        };
        Ok(())
    }
}

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

// ── Rating ──────────────────────────────────────────────────────────────────

/// The escrow is locked and rated; nothing can be committed yet.
pub const RATING_AWAITING_SETTLEMENT: u8 = 0;
/// The escrow was paid out; the two parties may commit.
pub const RATING_OPEN: u8 = 1;
/// Both parties committed; they may reveal.
pub const RATING_BOTH_COMMITTED: u8 = 2;
/// Both parties revealed. Final.
pub const RATING_REVEALED: u8 = 3;
/// Closed out by `expire_rating` after a deadline. Final.
pub const RATING_EXPIRED: u8 = 4;

const UNSET: [u8; 32] = [0; 32];

/// The record of one rated job: created by `open_rating` for a locked escrow,
/// filled in when the escrow is paid out, then the blind commit-reveal rating
/// of the job by its two parties. PDA seeds: `["rating", escrow]`.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct Rating {
    discriminator: [u8; 8],
    /// The escrow this rating was opened for.
    pub escrow: Address,
    /// The escrow's payer: the hiring party.
    pub consumer: Address,
    /// The escrow's payee: the hired party.
    pub specialist: Address,
    /// The judge the consumer named; all zero for none.
    pub judge: Address,
    /// The escrow mint; all zero for native SOL. Written at settlement.
    pub mint: Address,
    /// sha256(rating address, opened slot, signer, score, salt) from each party; all zero
    /// until committed.
    pub consumer_commitment: [u8; 32],
    pub specialist_commitment: [u8; 32],
    /// What the escrow paid out, before the protocol fee.
    paid: [u8; 8],
    /// Slot of `open_rating`. With the address it names this job: a rated
    /// escrow cannot end in this slot, so a later rating at the same address
    /// has a later one.
    opened_slot: [u8; 8],
    /// Slot of the paid settlement; the commit deadline counts from it.
    settled_slot: [u8; 8],
    /// Slot of the second commitment; the reveal deadline counts from it.
    committed_slot: [u8; 8],
    pub state: u8,
    /// Revealed scores, 1 to 10; 0 while not revealed.
    pub consumer_score: u8,
    pub specialist_score: u8,
    /// 1 once the specialist agreed to the job being rated (`accept_rating`).
    /// A paid exit the specialist authorises counts as agreeing too and does not
    /// need it.
    accepted: u8,
    /// 1 once the judge has attested this job (`attest_quality`), so that a
    /// closed attestation cannot be made again for the same job.
    attested: u8,
    pub bump: u8,
}

// SAFETY: byte fields only, discriminator first.
unsafe impl Record for Rating {
    const DISCRIMINATOR: [u8; 8] = discriminator("account:RatingAccount");
    const LEN: usize = 8 + 32 * 7 + 8 * 4 + 6;
}
assert_layout!(Rating, 270);

impl Rating {
    pub fn new(
        escrow: &Address,
        consumer: &Address,
        specialist: &Address,
        judge: &[u8; 32],
        opened_slot: u64,
        bump: u8,
    ) -> Self {
        Self {
            discriminator: Self::DISCRIMINATOR,
            escrow: *escrow,
            consumer: *consumer,
            specialist: *specialist,
            judge: Address::new_from_array(*judge),
            mint: Address::new_from_array(UNSET),
            consumer_commitment: UNSET,
            specialist_commitment: UNSET,
            paid: [0; 8],
            opened_slot: opened_slot.to_le_bytes(),
            settled_slot: [0; 8],
            committed_slot: [0; 8],
            state: RATING_AWAITING_SETTLEMENT,
            consumer_score: 0,
            specialist_score: 0,
            accepted: 0,
            attested: 0,
            bump,
        }
    }

    /// Whether the specialist agreed to the job being rated.
    pub fn accepted(&self) -> bool {
        self.accepted == 1
    }

    pub fn accept(&mut self) {
        self.accepted = 1;
    }

    /// Whether the judge has attested this job.
    pub fn attested(&self) -> bool {
        self.attested == 1
    }

    pub fn set_attested(&mut self) {
        self.attested = 1;
    }

    /// The record at `account`, which must be a rating of this program at the
    /// address derived from the escrow it names.
    pub fn load_checked(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let record = Self::load(account, program_id)?;
        if record.state > RATING_EXPIRED
            || record.consumer_score > 10
            || record.specialist_score > 10
            || record.accepted > 1
            || record.attested > 1
        {
            return Err(fail(&AccountDidNotDeserialize));
        }
        at_seeds(
            account,
            &[RATING_SEED, record.escrow.as_ref(), &[record.bump]],
            program_id,
        )?;
        Ok(record)
    }

    /// Record the paid settlement of the escrow and open the rating.
    pub fn settle(&mut self, paid: u64, mint: Option<&Address>, slot: u64) {
        self.paid = paid.to_le_bytes();
        if let Some(mint) = mint {
            self.mint = *mint;
        }
        self.settled_slot = slot.to_le_bytes();
        self.state = RATING_OPEN;
    }

    pub fn opened_slot(&self) -> u64 {
        u64::from_le_bytes(self.opened_slot)
    }

    pub fn settled_slot(&self) -> u64 {
        u64::from_le_bytes(self.settled_slot)
    }

    pub fn committed_slot(&self) -> u64 {
        u64::from_le_bytes(self.committed_slot)
    }

    pub fn set_committed_slot(&mut self, slot: u64) {
        self.committed_slot = slot.to_le_bytes();
    }

    pub fn has_judge(&self) -> bool {
        self.judge.as_array() != &UNSET
    }

    pub fn consumer_committed(&self) -> bool {
        self.consumer_commitment != UNSET
    }

    pub fn specialist_committed(&self) -> bool {
        self.specialist_commitment != UNSET
    }

    pub fn is_final(&self) -> bool {
        self.state == RATING_REVEALED || self.state == RATING_EXPIRED
    }
}

// ── Attestation ─────────────────────────────────────────────────────────────

pub const ATTESTATION_PENDING: u8 = 0;
pub const ATTESTATION_CONFIRMED: u8 = 1;
pub const ATTESTATION_DISPUTED: u8 = 2;

/// A judge's quality scores for one paid job, which the job's consumer then
/// confirms or disputes. PDA seeds: `["attestation", escrow]`.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct Attestation {
    discriminator: [u8; 8],
    pub escrow: Address,
    pub judge: Address,
    pub consumer: Address,
    /// Accuracy, completeness, relevance, format, latency: 1 to 10 each.
    pub scores: [u8; 5],
    /// `ATTESTATION_PENDING`, then confirmed or disputed.
    pub resolution: u8,
    created_slot: [u8; 8],
    pub bump: u8,
    /// The slot the job's rating was opened in, which names the job;
    /// `confirm_attestation` and `dispute_attestation` must name it too.
    opened_slot: [u8; 8],
}

// SAFETY: byte fields only, discriminator first.
unsafe impl Record for Attestation {
    const DISCRIMINATOR: [u8; 8] = discriminator("account:AttestationAccount");
    const LEN: usize = 8 + 32 * 3 + 5 + 1 + 8 + 1 + 8;
}
assert_layout!(Attestation, 127);

impl Attestation {
    pub fn new(
        escrow: &Address,
        judge: &Address,
        consumer: &Address,
        scores: [u8; 5],
        created_slot: u64,
        bump: u8,
        opened_slot: u64,
    ) -> Self {
        Self {
            discriminator: Self::DISCRIMINATOR,
            escrow: *escrow,
            judge: *judge,
            consumer: *consumer,
            scores,
            resolution: ATTESTATION_PENDING,
            created_slot: created_slot.to_le_bytes(),
            bump,
            opened_slot: opened_slot.to_le_bytes(),
        }
    }

    pub fn created_slot(&self) -> u64 {
        u64::from_le_bytes(self.created_slot)
    }

    /// The opening slot of the job this attestation is for.
    pub fn opened_slot(&self) -> u64 {
        u64::from_le_bytes(self.opened_slot)
    }

    /// The record at `account`, which must be an attestation of this program
    /// at the address derived from the escrow it names.
    pub fn load_checked(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let record = Self::load(account, program_id)?;
        if record.resolution > ATTESTATION_DISPUTED {
            return Err(fail(&AccountDidNotDeserialize));
        }
        at_seeds(
            account,
            &[ATTESTATION_SEED, record.escrow.as_ref(), &[record.bump]],
            program_id,
        )?;
        Ok(record)
    }
}

// ── Delivery check ──────────────────────────────────────────────────────────

/// Waiting for the payee to record what it delivered.
pub const DELIVERY_AWAITING: u8 = 0;
/// Recorded; the payer's verify window runs from `delivered_slot`.
pub const DELIVERY_DELIVERED: u8 = 1;
/// The payer accepted the delivery: the payee may be paid at once.
pub const DELIVERY_ACCEPTED: u8 = 2;
/// The payer disputed the delivery: only the judge may end the escrow, until
/// its window ends.
pub const DELIVERY_DISPUTED: u8 = 3;

/// The delivery check of one escrow: the judge and windows the payer named in
/// the lock slot, then what the payee says it delivered, then whether the
/// payer accepted or disputed it. PDA seeds: `["delivery", escrow]`.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct Delivery {
    discriminator: [u8; 8],
    pub escrow: Address,
    pub judge: Address,
    /// Slot of `open_delivery`, which is the escrow's lock slot. It names the
    /// job: every delivery instruction carries it.
    opened_slot: [u8; 8],
    verify_window_slots: [u8; 8],
    resolve_window_slots: [u8; 8],
    delivered_slot: [u8; 8],
    units: [u8; 8],
    bytes: [u8; 8],
    /// sha256 of the delivered file, as the payee states it.
    pub sha256: [u8; 32],
    disputed_slot: [u8; 8],
    pub state: u8,
    pub bump: u8,
}

// SAFETY: byte fields only, discriminator first.
unsafe impl Record for Delivery {
    const DISCRIMINATOR: [u8; 8] = discriminator("account:DeliveryAccount");
    const LEN: usize = 8 + 32 * 3 + 8 * 7 + 2;
}
assert_layout!(Delivery, 162);

impl Delivery {
    pub fn new(
        escrow: &Address,
        judge: &Address,
        opened_slot: u64,
        verify_window_slots: u64,
        resolve_window_slots: u64,
        bump: u8,
    ) -> Self {
        Self {
            discriminator: Self::DISCRIMINATOR,
            escrow: *escrow,
            judge: *judge,
            opened_slot: opened_slot.to_le_bytes(),
            verify_window_slots: verify_window_slots.to_le_bytes(),
            resolve_window_slots: resolve_window_slots.to_le_bytes(),
            delivered_slot: [0; 8],
            units: [0; 8],
            bytes: [0; 8],
            sha256: [0; 32],
            disputed_slot: [0; 8],
            state: DELIVERY_AWAITING,
            bump,
        }
    }

    /// The record at `account`, which must be a delivery account of this
    /// program at the address derived from the escrow it names.
    pub fn load_checked(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let record = Self::load(account, program_id)?;
        if record.state > DELIVERY_DISPUTED {
            return Err(fail(&AccountDidNotDeserialize));
        }
        at_seeds(
            account,
            &[DELIVERY_SEED, record.escrow.as_ref(), &[record.bump]],
            program_id,
        )?;
        Ok(record)
    }

    pub fn opened_slot(&self) -> u64 {
        u64::from_le_bytes(self.opened_slot)
    }

    pub fn verify_window_slots(&self) -> u64 {
        u64::from_le_bytes(self.verify_window_slots)
    }

    pub fn resolve_window_slots(&self) -> u64 {
        u64::from_le_bytes(self.resolve_window_slots)
    }

    pub fn delivered_slot(&self) -> u64 {
        u64::from_le_bytes(self.delivered_slot)
    }

    pub fn disputed_slot(&self) -> u64 {
        u64::from_le_bytes(self.disputed_slot)
    }

    pub fn units(&self) -> u64 {
        u64::from_le_bytes(self.units)
    }

    pub fn bytes(&self) -> u64 {
        u64::from_le_bytes(self.bytes)
    }

    /// The first slot at which the verify window has ended.
    pub fn verify_ends(&self) -> u64 {
        self.delivered_slot()
            .saturating_add(self.verify_window_slots())
    }

    /// The first slot at which the judge's window has ended.
    pub fn resolve_ends(&self) -> u64 {
        self.disputed_slot()
            .saturating_add(self.resolve_window_slots())
    }

    pub fn record(&mut self, slot: u64, units: u64, bytes: u64, sha256: [u8; 32]) {
        self.delivered_slot = slot.to_le_bytes();
        self.units = units.to_le_bytes();
        self.bytes = bytes.to_le_bytes();
        self.sha256 = sha256;
        self.state = DELIVERY_DELIVERED;
    }

    pub fn accept(&mut self) {
        self.state = DELIVERY_ACCEPTED;
    }

    pub fn dispute(&mut self, slot: u64) {
        self.disputed_slot = slot.to_le_bytes();
        self.state = DELIVERY_DISPUTED;
    }
}

// ── Pooled budget ───────────────────────────────────────────────────────────

/// Budget flag: closed. No new reservations; the dispute window runs from
/// `closed_slot`.
const BUDGET_FLAG_CLOSED: u8 = 0x02;

/// One pooled budget: a single lock a payer's spender key reserves slices of
/// for registered providers while the budget is open. PDA seeds:
/// `["budget", payer, nonce]`. A SOL budget holds its lamports on top of its
/// rent; a token budget owns a vault (`["budget-vault", budget]`).
#[derive(Clone, Copy)]
#[repr(C)]
pub struct Budget {
    discriminator: [u8; 8],
    pub payer: Address,
    pub spender: Address,
    /// All zero when the budget names no judge.
    pub judge: Address,
    /// All zero for a SOL budget.
    pub mint: Address,
    pub nonce: [u8; 16],
    created_slot: [u8; 8],
    open_slots: [u8; 8],
    dispute_slots: [u8; 8],
    judge_slots: [u8; 8],
    total: [u8; 8],
    unreserved: [u8; 8],
    per_provider_cap: [u8; 8],
    /// All-zero entries are empty; an all-zero list means any registered
    /// provider.
    pub allowlist: [Address; BUDGET_ALLOWLIST_LEN],
    closed_slot: [u8; 8],
    /// Reservations ever created on this budget.
    pub reservations: u8,
    /// Reservations not yet paid out or resolved.
    pub unsettled: u8,
    pub flags: u8,
    pub bump: u8,
    pub vault_bump: u8,
}

// SAFETY: byte fields only, discriminator first.
unsafe impl Record for Budget {
    const DISCRIMINATOR: [u8; 8] = discriminator("account:Budget");
    const LEN: usize = 8 + 32 * 4 + 16 + 8 * 7 + 32 * BUDGET_ALLOWLIST_LEN + 8 + 5;
}
assert_layout!(Budget, 349);

impl Budget {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        payer: &Address,
        spender: &Address,
        judge: &Address,
        mint: &Address,
        nonce: [u8; 16],
        created_slot: u64,
        open_slots: u64,
        dispute_slots: u64,
        judge_slots: u64,
        total: u64,
        per_provider_cap: u64,
        allowlist: [Address; BUDGET_ALLOWLIST_LEN],
        flags: u8,
        bump: u8,
        vault_bump: u8,
    ) -> Self {
        Self {
            discriminator: Self::DISCRIMINATOR,
            payer: *payer,
            spender: *spender,
            judge: *judge,
            mint: *mint,
            nonce,
            created_slot: created_slot.to_le_bytes(),
            open_slots: open_slots.to_le_bytes(),
            dispute_slots: dispute_slots.to_le_bytes(),
            judge_slots: judge_slots.to_le_bytes(),
            total: total.to_le_bytes(),
            unreserved: total.to_le_bytes(),
            per_provider_cap: per_provider_cap.to_le_bytes(),
            allowlist,
            closed_slot: [0; 8],
            reservations: 0,
            unsettled: 0,
            flags,
            bump,
            vault_bump,
        }
    }

    /// The record at `account`, which must be a budget of this program at the
    /// address derived from its payer and nonce.
    pub fn load_checked(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let record = Self::load(account, program_id)?;
        at_seeds(
            account,
            &[
                BUDGET_SEED,
                record.payer.as_ref(),
                &record.nonce,
                &[record.bump],
            ],
            program_id,
        )?;
        Ok(record)
    }

    pub fn created_slot(&self) -> u64 {
        u64::from_le_bytes(self.created_slot)
    }

    pub fn open_slots(&self) -> u64 {
        u64::from_le_bytes(self.open_slots)
    }

    pub fn dispute_slots(&self) -> u64 {
        u64::from_le_bytes(self.dispute_slots)
    }

    pub fn judge_slots(&self) -> u64 {
        u64::from_le_bytes(self.judge_slots)
    }

    pub fn total(&self) -> u64 {
        u64::from_le_bytes(self.total)
    }

    pub fn unreserved(&self) -> u64 {
        u64::from_le_bytes(self.unreserved)
    }

    pub fn set_unreserved(&mut self, amount: u64) {
        self.unreserved = amount.to_le_bytes();
    }

    pub fn per_provider_cap(&self) -> u64 {
        u64::from_le_bytes(self.per_provider_cap)
    }

    pub fn closed_slot(&self) -> u64 {
        u64::from_le_bytes(self.closed_slot)
    }

    pub fn closed(&self) -> bool {
        self.flags & BUDGET_FLAG_CLOSED != 0
    }

    pub fn close_at(&mut self, slot: u64) {
        self.flags |= BUDGET_FLAG_CLOSED;
        self.closed_slot = slot.to_le_bytes();
    }

    pub fn sol(&self) -> bool {
        self.mint == Address::new_from_array([0; 32])
    }

    pub fn has_judge(&self) -> bool {
        self.judge != Address::new_from_array([0; 32])
    }

    /// The first slot at which the open period has ended.
    pub fn open_ends(&self) -> u64 {
        self.created_slot().saturating_add(self.open_slots())
    }
}

pub const RESERVATION_OPEN: u8 = 0;
pub const RESERVATION_POSTED: u8 = 1;
pub const RESERVATION_DISPUTED: u8 = 2;
/// Paid out early (both sides waived) while the budget was still open. Kept
/// until the budget closes so the same provider cannot reserve again.
pub const RESERVATION_PAID: u8 = 3;

/// One provider's slice of a budget. PDA seeds:
/// `["reservation", budget, payee]`. The payee funds its rent and gets it back
/// when the reservation closes.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct Reservation {
    discriminator: [u8; 8],
    pub budget: Address,
    /// The budget's `created_slot` when this reservation was made.
    budget_created_slot: [u8; 8],
    pub payee: Address,
    /// SOL budgets: the payee itself. Token budgets: a token account of the
    /// budget's mint owned by the payee.
    pub payout_account: Address,
    reserved: [u8; 8],
    final_amount: [u8; 8],
    last_post_slot: [u8; 8],
    disputed_slot: [u8; 8],
    pub state: u8,
    pub waived: u8,
    pub bump: u8,
}

// SAFETY: byte fields only, discriminator first.
unsafe impl Record for Reservation {
    const DISCRIMINATOR: [u8; 8] = discriminator("account:Reservation");
    const LEN: usize = 8 + 32 + 8 + 32 + 32 + 8 * 4 + 3;
}
assert_layout!(Reservation, 147);

impl Reservation {
    pub fn new(
        budget: &Address,
        budget_created_slot: u64,
        payee: &Address,
        payout_account: &Address,
        reserved: u64,
        bump: u8,
    ) -> Self {
        Self {
            discriminator: Self::DISCRIMINATOR,
            budget: *budget,
            budget_created_slot: budget_created_slot.to_le_bytes(),
            payee: *payee,
            payout_account: *payout_account,
            reserved: reserved.to_le_bytes(),
            final_amount: [0; 8],
            last_post_slot: [0; 8],
            disputed_slot: [0; 8],
            state: RESERVATION_OPEN,
            waived: 0,
            bump,
        }
    }

    /// The record at `account`, which must be a reservation of this program
    /// at the address derived from its budget and payee.
    pub fn load_checked(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
        let record = Self::load(account, program_id)?;
        if record.state > RESERVATION_PAID || record.waived > 1 {
            return Err(fail(&AccountDidNotDeserialize));
        }
        at_seeds(
            account,
            &[
                RESERVATION_SEED,
                record.budget.as_ref(),
                record.payee.as_ref(),
                &[record.bump],
            ],
            program_id,
        )?;
        Ok(record)
    }

    pub fn budget_created_slot(&self) -> u64 {
        u64::from_le_bytes(self.budget_created_slot)
    }

    pub fn reserved(&self) -> u64 {
        u64::from_le_bytes(self.reserved)
    }

    pub fn set_reserved(&mut self, amount: u64) {
        self.reserved = amount.to_le_bytes();
    }

    pub fn final_amount(&self) -> u64 {
        u64::from_le_bytes(self.final_amount)
    }

    pub fn last_post_slot(&self) -> u64 {
        u64::from_le_bytes(self.last_post_slot)
    }

    pub fn disputed_slot(&self) -> u64 {
        u64::from_le_bytes(self.disputed_slot)
    }

    pub fn post(&mut self, amount: u64, slot: u64) {
        self.final_amount = amount.to_le_bytes();
        self.last_post_slot = slot.to_le_bytes();
        self.state = RESERVATION_POSTED;
    }

    pub fn dispute(&mut self, slot: u64) {
        self.disputed_slot = slot.to_le_bytes();
        self.state = RESERVATION_DISPUTED;
    }

    /// The first slot at which the payer can no longer dispute this
    /// reservation of a closed `budget`: the budget's dispute window, and
    /// never less than `MIN_REVIEW_SLOTS` after the last post.
    pub fn dispute_ends(&self, budget: &Budget) -> u64 {
        let window = budget.closed_slot().saturating_add(budget.dispute_slots());
        let review = self.last_post_slot().saturating_add(MIN_REVIEW_SLOTS);
        if review > window {
            review
        } else {
            window
        }
    }

    /// The first slot at which the judge's window has ended.
    pub fn judge_ends(&self, budget: &Budget) -> u64 {
        self.disputed_slot().saturating_add(budget.judge_slots())
    }
}
