#![no_std]
//! Read-only mirror of the `quasar-escrow` `EscrowAccount` — the shared
//! job-binding primitive.
//!
//! Both `quasar-reputation` and `quasar-attestation` need to prove that a job
//! really exists and to learn who its parties are. This crate holds the single
//! canonical mirror of the escrow layout so the two consumers cannot drift apart
//! from each other, or from `quasar-escrow`.
//!
//! # Why this type exists
//!
//! Before the job-binding change, the consuming programs accepted the job's
//! parties as instruction arguments and seeded their PDAs on a caller-chosen
//! `job_id`. Nothing on-chain tied either to a real job — the shared root cause
//! of CRITICAL-1 through CRITICAL-4 in
//! `docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md`.
//!
//! `quasar-escrow` already holds the facts we were trusting the caller for. Its
//! `EscrowAccount` is created by `lock`, which requires the payer to sign and to
//! move real lamports, and its PDA is derived from `payer` — so it can be
//! neither forged nor squatted. That makes it a sound canonical job record.
//!
//! # How the binding is enforced
//!
//! `EscrowRef` is declared as an `InterfaceAccount<EscrowRef>` field on the
//! consuming programs' instructions. `InterfaceAccount::from_account_view` checks
//! `view.owner()` against [`EscrowRef::owners`] and returns `IllegalOwner` on a
//! mismatch, then calls [`AccountCheck::check`], which enforces the escrow
//! discriminator and minimum data length. An attacker therefore cannot pass a
//! self-owned look-alike account: only an account actually written by the
//! `quasar-escrow` program at [`QUASAR_ESCROW_PROGRAM_ID`] is accepted.
//!
//! # Layout contract
//!
//! This mirror must track `quasar-escrow`'s `EscrowAccount` byte-for-byte. The
//! upstream `#[account(discriminator = 10)]` macro lays an account out as one
//! discriminator byte followed by the `#[repr(C)]`, alignment-1 zero-copy
//! struct, mapping `u64 -> PodU64` and `i64 -> PodI64`. [`EscrowRefData`]
//! reproduces that struct.
//!
//! **This guard is currently circular and does NOT catch upstream drift.** The
//! layout test below asserts `EscrowRefData` against hardcoded constants — that
//! is, against itself. This crate has no dependency on `quasar-escrow` (whose
//! `mod state` is private), so nothing compares the mirror to the real
//! `EscrowAccountZc`. Add a field upstream and every test here stays green while
//! both consuming programs read `payer`/`payee` from the wrong offsets. The
//! layout was verified byte-exact by hand on 2026-08-25, but that verification
//! is a point-in-time fact, not an enforced invariant.
//!
//! Fix: export `quasar-escrow`'s `state` module, add it as a dev-dependency
//! here, and assert `offset_of!` equality against `EscrowAccountZc` plus
//! `LEN == <EscrowAccount as Space>::SPACE - 1`.
//!
//! Deliberately **read-only**: neither consumer writes to an escrow, so no
//! `DerefMut`/`deref_from_mut` write path is exposed beyond what the framework
//! trait requires.

use quasar_lang::{
    pod::{PodI64, PodU64},
    prelude::*,
};

/// `quasar-escrow` program ID, pinned at compile time.
///
/// Must equal `declare_id!` in `experiments/quasar-escrow/src/lib.rs` and the
/// `escrow` entry in `config/quasar/deployments.json`. Pinning it here is what
/// makes the owner check meaningful — a redeploy to a new program ID requires a
/// deliberate edit in this file.
pub const QUASAR_ESCROW_PROGRAM_ID: Address =
    address!("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");

/// Discriminator byte written by `quasar-escrow` for `EscrowAccount`.
pub const ESCROW_DISCRIMINATOR: u8 = 10;

/// `EscrowStatus::Released` — the only status that represents completed,
/// settled work. Mirrors `quasar_escrow::state::EscrowStatus::Released`.
pub const ESCROW_STATUS_RELEASED: u8 = 1;

/// Single-entry owner set for [`EscrowRef`].
static ESCROW_OWNERS: [Address; 1] = [QUASAR_ESCROW_PROGRAM_ID];

/// Zero-copy view of `quasar-escrow`'s `EscrowAccount` payload, excluding the
/// leading discriminator byte.
///
/// Field order, types and padding mirror the generated `EscrowAccountZc`
/// exactly. All fields are alignment-1 Pod types, so a pointer cast from
/// unaligned account data is sound.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct EscrowRefData {
    /// The hiring party — becomes the rating's `consumer`.
    pub payer: Address,
    /// The hired party — becomes the rating's `specialist`.
    pub payee: Address,
    pub escrow_id: PodU64,
    pub amount: PodU64,
    /// `EscrowStatus` as u8: 0 = Locked, 1 = Released, 2 = Cancelled.
    pub status: u8,
    pub created_at: PodI64,
    pub created_slot: PodU64,
    pub bump: u8,
}

const _: () = assert!(
    core::mem::align_of::<EscrowRefData>() == 1,
    "EscrowRefData must have alignment 1 — account data is not guaranteed aligned",
);

impl EscrowRefData {
    /// Size of the payload, excluding the discriminator byte.
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Total on-chain account size: discriminator byte + payload.
    pub const ACCOUNT_LEN: usize = 1 + Self::LEN;

    /// Whether this escrow has been released (work settled).
    #[inline(always)]
    pub fn is_released(&self) -> bool {
        self.status == ESCROW_STATUS_RELEASED
    }
}

/// Owner-checked, read-only handle to a `quasar-escrow` `EscrowAccount`.
///
/// Use as `&'info InterfaceAccount<EscrowRef>` in an `#[derive(Accounts)]`
/// struct; the derive emits the owner and discriminator checks at parse time.
#[repr(transparent)]
pub struct EscrowRef {
    __view: AccountView,
}

// SAFETY: `EscrowRef` is `#[repr(transparent)]` over `AccountView`, so a
// pointer cast from `&AccountView` is layout-compatible.
unsafe impl StaticView for EscrowRef {}

impl AsAccountView for EscrowRef {
    #[inline(always)]
    fn to_account_view(&self) -> &AccountView {
        &self.__view
    }
}

impl Owners for EscrowRef {
    #[inline(always)]
    fn owners() -> &'static [Address] {
        &ESCROW_OWNERS
    }
}

impl AccountCheck for EscrowRef {
    /// Enforces the escrow discriminator and a payload large enough for
    /// [`EscrowRefData`].
    ///
    /// Runs after `InterfaceAccount`'s owner check, so reaching this point
    /// already proves `quasar-escrow` owns the account; the discriminator then
    /// rules out a *different* account type from that same program (for example
    /// `UserEscrowCounter`, discriminator 9).
    #[inline(always)]
    fn check(view: &AccountView) -> Result<(), ProgramError> {
        // SAFETY: read-only borrow of account data for the duration of the
        // length and discriminator checks; no aliasing write exists here.
        let data = unsafe { view.borrow_unchecked() };
        if data.len() < EscrowRefData::ACCOUNT_LEN {
            return Err(ProgramError::AccountDataTooSmall);
        }
        if data[0] != ESCROW_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(())
    }
}

impl ZeroCopyDeref for EscrowRef {
    type Target = EscrowRefData;

    #[inline(always)]
    unsafe fn deref_from(view: &AccountView) -> &Self::Target {
        // SAFETY: `AccountCheck::check` validated length >= ACCOUNT_LEN before
        // construction. `EscrowRefData` is `#[repr(C)]` with alignment 1, so the
        // offset-by-discriminator pointer is valid for any data pointer.
        &*(view.data_ptr().add(1) as *const EscrowRefData)
    }

    #[inline(always)]
    unsafe fn deref_from_mut(view: &mut AccountView) -> &mut Self::Target {
        // SAFETY: same as `deref_from`. Reputation never takes this path —
        // the escrow is bound as a read-only account — but the trait requires it.
        &mut *(view.data_mut_ptr().add(1) as *mut EscrowRefData)
    }
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;

    /// The pinned program ID must match `config/quasar/deployments.json` and
    /// `experiments/quasar-escrow/src/lib.rs`. A silent drift here would make
    /// the owner check reject every real escrow.
    #[test]
    fn pinned_escrow_program_id_matches_deployment() {
        // Independent literal: changing the const above without changing this
        // line fails the build, so the pin cannot drift unnoticed.
        assert_eq!(
            QUASAR_ESCROW_PROGRAM_ID,
            address!("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW"),
        );
    }

    #[test]
    fn owners_is_exactly_the_escrow_program() {
        let owners = EscrowRef::owners();
        assert_eq!(owners.len(), 1, "widening the owner set widens the trust boundary");
        assert_eq!(owners[0], QUASAR_ESCROW_PROGRAM_ID);
    }

    /// Pins the mirror's own layout. NOTE: this compares `EscrowRefData` to
    /// hardcoded constants, i.e. to itself — it catches an accidental edit to
    /// this file, but it CANNOT catch upstream drift in `quasar-escrow`, because
    /// this crate does not depend on it. See the circularity note in the module
    /// docs for the fix.
    #[test]
    fn layout_matches_escrow_account() {
        assert_eq!(core::mem::offset_of!(EscrowRefData, payer), 0);
        assert_eq!(core::mem::offset_of!(EscrowRefData, payee), 32);
        assert_eq!(core::mem::offset_of!(EscrowRefData, escrow_id), 64);
        assert_eq!(core::mem::offset_of!(EscrowRefData, amount), 72);
        assert_eq!(core::mem::offset_of!(EscrowRefData, status), 80);
        assert_eq!(core::mem::offset_of!(EscrowRefData, created_at), 81);
        assert_eq!(core::mem::offset_of!(EscrowRefData, created_slot), 89);
        assert_eq!(core::mem::offset_of!(EscrowRefData, bump), 97);
        assert_eq!(EscrowRefData::LEN, 98);
        assert_eq!(EscrowRefData::ACCOUNT_LEN, 99);
        assert_eq!(core::mem::align_of::<EscrowRefData>(), 1);
    }

    /// Builds a byte image the way `quasar-escrow` writes one and reads it back
    /// through the mirror, proving the discriminator offset is right.
    #[test]
    fn reads_fields_from_a_well_formed_escrow_image() {
        let payer = [7u8; 32];
        let payee = [9u8; 32];

        let mut image = std::vec![0u8; EscrowRefData::ACCOUNT_LEN];
        image[0] = ESCROW_DISCRIMINATOR;
        image[1..33].copy_from_slice(&payer);
        image[33..65].copy_from_slice(&payee);
        image[65..73].copy_from_slice(&42u64.to_le_bytes());
        image[73..81].copy_from_slice(&5_000_000u64.to_le_bytes());
        image[81] = ESCROW_STATUS_RELEASED;

        // SAFETY: `image` is at least ACCOUNT_LEN bytes and EscrowRefData has
        // alignment 1, mirroring what `deref_from` does on real account data.
        let data = unsafe { &*(image.as_ptr().add(1) as *const EscrowRefData) };

        assert_eq!(data.payer.as_ref(), &payer[..]);
        assert_eq!(data.payee.as_ref(), &payee[..]);
        assert_eq!(data.escrow_id.get(), 42);
        assert_eq!(data.amount.get(), 5_000_000);
        assert!(data.is_released());
    }

    /// A `UserEscrowCounter` (discriminator 9) is owned by the same program, so
    /// only the discriminator byte separates it from an escrow.
    #[test]
    fn discriminator_distinguishes_escrow_from_counter() {
        assert_ne!(ESCROW_DISCRIMINATOR, 9);
    }
}
