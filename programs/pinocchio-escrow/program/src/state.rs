//! Account layouts, read and written in place.
//!
//! The byte layouts are the ones the Anchor program stores (8-byte
//! discriminator, then Borsh fields), so existing clients decode these
//! accounts unchanged. Each layout is a plain struct of byte fields with no
//! padding, so an account's data is read or written with one length check and
//! no field-by-field decoding.
#[cfg(feature = "extended")]
use crate::consts::SCORE_MAX;
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
    /// Set while the escrow is delegated to a PER session. Only the
    /// `extended` instructions set it.
    delegated_to_per: u8,
    /// Borsh tag of an optional session key: 0 for none, 1 when a 32-byte key
    /// follows. With a key present the two fields below sit 32 bytes further
    /// on in the account; `load_checked` reads them from there.
    per_session_key: u8,
    pub bump: u8,
    metered: u8,
}

/// Where the session key starts when its tag is 1, and where `bump` and
/// `metered` then sit.
const SESSION_KEY_AT: usize = 115;
const DELEGATED_BUMP_AT: usize = SESSION_KEY_AT + 32;
const _: () = assert!(DELEGATED_BUMP_AT + 2 == SolEscrow::LEN);

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

#[cfg(feature = "extended")]
impl SolEscrow {
    pub fn delegated(&self) -> bool {
        self.delegated_to_per == 1
    }

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

#[cfg(feature = "extended")]
impl AgentTerms {
    pub fn bump(&self) -> u8 {
        self.bump
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

#[cfg(feature = "extended")]
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

// ── Rating and attestation (extended) ───────────────────────────────────────
//
// These two records hold Borsh options, so a field's offset depends on the
// options before it. They are decoded into plain values and encoded back in
// field order, which reproduces the stored bytes exactly.

#[cfg(feature = "extended")]
pub use variable::{Attestation, Rating};

#[cfg(feature = "extended")]
mod variable {
    use {
        super::checked_data,
        crate::{
            consts::discriminator,
            error::{fail, AccountDidNotDeserialize},
        },
        pinocchio::{error::ProgramError, AccountView, Address, ProgramResult},
    };

    struct Reader<'a>(&'a [u8]);

    impl Reader<'_> {
        fn take<const N: usize>(&mut self) -> Option<[u8; N]> {
            let (head, rest) = self.0.split_first_chunk::<N>()?;
            self.0 = rest;
            Some(*head)
        }

        fn byte(&mut self) -> Option<u8> {
            Some(self.take::<1>()?[0])
        }

        /// A Borsh option of one byte, the byte being at most `max`.
        fn optional_byte(&mut self, max: u8) -> Option<Option<u8>> {
            match self.byte()? {
                0 => Some(None),
                1 => Some(Some(self.byte().filter(|&value| value <= max)?)),
                _ => None,
            }
        }
    }

    struct Writer<'a> {
        data: &'a mut [u8],
        at: usize,
    }

    impl Writer<'_> {
        fn put(&mut self, bytes: &[u8]) -> ProgramResult {
            let end = self.at.saturating_add(bytes.len());
            let Some(slot) = self.data.get_mut(self.at..end) else {
                return Err(ProgramError::AccountDataTooSmall);
            };
            for (to, from) in slot.iter_mut().zip(bytes) {
                *to = *from;
            }
            self.at = end;
            Ok(())
        }

        fn optional_byte(&mut self, value: Option<u8>) -> ProgramResult {
            match value {
                None => self.put(&[0]),
                Some(value) => self.put(&[1, value]),
            }
        }
    }

    /// The fields of a live account of this program that starts with
    /// `discriminator`, decoded by `parse`.
    fn load<T>(
        account: &AccountView,
        program_id: &Address,
        discriminator: &[u8; 8],
        parse: fn(&mut Reader) -> Option<T>,
    ) -> Result<T, ProgramError> {
        checked_data(account, program_id, discriminator, 8)?;
        let data = account.try_borrow()?;
        data.get(8..)
            .and_then(|fields| parse(&mut Reader(fields)))
            .ok_or_else(|| fail(&AccountDidNotDeserialize))
    }

    pub const RATING_PENDING: u8 = 0;
    pub const RATING_BOTH_COMMITTED: u8 = 1;
    pub const RATING_REVEALED: u8 = 2;
    pub const RATING_EXPIRED: u8 = 3;

    /// Blind commit-reveal rating of one job by its two parties.
    /// PDA seeds: `["rating", job_id]`.
    pub struct Rating {
        pub job_id: [u8; 16],
        /// The hiring party.
        pub consumer: Address,
        /// The hired party.
        pub specialist: Address,
        /// sha256(score, salt) from each party; all zero until committed.
        pub consumer_commitment: [u8; 32],
        pub specialist_commitment: [u8; 32],
        /// Revealed scores, 1 to 10.
        pub consumer_score: Option<u8>,
        pub specialist_score: Option<u8>,
        pub state: u8,
        pub created_at: i64,
        pub created_slot: u64,
        pub bump: u8,
    }

    impl Rating {
        pub const DISCRIMINATOR: [u8; 8] = discriminator("account:RatingAccount");
        /// Room for both scores revealed.
        pub const LEN: usize = 175;
        pub const PENDING: u8 = RATING_PENDING;
        pub const BOTH_COMMITTED: u8 = RATING_BOTH_COMMITTED;
        pub const REVEALED: u8 = RATING_REVEALED;
        pub const EXPIRED: u8 = RATING_EXPIRED;

        /// What a freshly created, zeroed account decodes to.
        pub const EMPTY: Self = Self {
            job_id: [0; 16],
            consumer: Address::new_from_array([0; 32]),
            specialist: Address::new_from_array([0; 32]),
            consumer_commitment: [0; 32],
            specialist_commitment: [0; 32],
            consumer_score: None,
            specialist_score: None,
            state: RATING_PENDING,
            created_at: 0,
            created_slot: 0,
            bump: 0,
        };

        fn parse(fields: &mut Reader) -> Option<Self> {
            Some(Self {
                job_id: fields.take()?,
                consumer: Address::new_from_array(fields.take()?),
                specialist: Address::new_from_array(fields.take()?),
                consumer_commitment: fields.take()?,
                specialist_commitment: fields.take()?,
                consumer_score: fields.optional_byte(u8::MAX)?,
                specialist_score: fields.optional_byte(u8::MAX)?,
                state: fields.byte().filter(|&state| state <= RATING_EXPIRED)?,
                created_at: i64::from_le_bytes(fields.take()?),
                created_slot: u64::from_le_bytes(fields.take()?),
                bump: fields.byte()?,
            })
        }

        pub fn load(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
            load(account, program_id, &Self::DISCRIMINATOR, Self::parse)
        }

        pub fn store(&self, account: &mut AccountView) -> ProgramResult {
            let mut data = account.try_borrow_mut()?;
            let mut out = Writer {
                data: &mut data,
                at: 0,
            };
            out.put(&Self::DISCRIMINATOR)?;
            out.put(&self.job_id)?;
            out.put(self.consumer.as_ref())?;
            out.put(self.specialist.as_ref())?;
            out.put(&self.consumer_commitment)?;
            out.put(&self.specialist_commitment)?;
            out.optional_byte(self.consumer_score)?;
            out.optional_byte(self.specialist_score)?;
            out.put(&[self.state])?;
            out.put(&self.created_at.to_le_bytes())?;
            out.put(&self.created_slot.to_le_bytes())?;
            out.put(&[self.bump])
        }
    }

    /// A judge's quality scores for one job, which the consumer then confirms
    /// or disputes. PDA seeds: `["attestation", job_id]`.
    pub struct Attestation {
        pub job_id: [u8; 16],
        pub judge: Address,
        pub consumer: Address,
        /// Accuracy, completeness, relevance, format, latency: 1 to 10 each.
        pub scores: [u8; 5],
        /// `None` while pending, then whether the consumer confirmed.
        pub confirmed: Option<bool>,
        pub created_at: i64,
        pub bump: u8,
    }

    impl Attestation {
        pub const DISCRIMINATOR: [u8; 8] = discriminator("account:AttestationAccount");
        pub const LEN: usize = 105;

        fn parse(fields: &mut Reader) -> Option<Self> {
            Some(Self {
                job_id: fields.take()?,
                judge: Address::new_from_array(fields.take()?),
                consumer: Address::new_from_array(fields.take()?),
                scores: fields.take()?,
                confirmed: fields.optional_byte(1)?.map(|value| value == 1),
                created_at: i64::from_le_bytes(fields.take()?),
                bump: fields.byte()?,
            })
        }

        pub fn load(account: &AccountView, program_id: &Address) -> Result<Self, ProgramError> {
            load(account, program_id, &Self::DISCRIMINATOR, Self::parse)
        }

        pub fn store(&self, account: &mut AccountView) -> ProgramResult {
            let mut data = account.try_borrow_mut()?;
            let mut out = Writer {
                data: &mut data,
                at: 0,
            };
            out.put(&Self::DISCRIMINATOR)?;
            out.put(&self.job_id)?;
            out.put(self.judge.as_ref())?;
            out.put(self.consumer.as_ref())?;
            out.put(&self.scores)?;
            out.optional_byte(self.confirmed.map(|value| value as u8))?;
            out.put(&self.created_at.to_le_bytes())?;
            out.put(&[self.bump])
        }
    }
}
