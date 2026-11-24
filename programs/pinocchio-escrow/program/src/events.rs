//! Settlement records. Settled escrows are closed, so these events are the
//! durable on-chain trace of what happened to each one. They are encoded as
//! the Anchor program encodes them (8-byte event discriminator, then Borsh
//! fields) so existing indexers read them unchanged, and are assembled in a
//! fixed stack buffer.
use {
    crate::{consts::discriminator, log},
    pinocchio::Address,
};

/// How a locked escrow ended. The values are the wire encoding.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Outcome {
    /// Paid to the payee by the payer's release.
    Released = 0,
    /// Refunded to the payer because the payee declined.
    DeclinedByPayee = 1,
    /// Refunded to the payer, by the payer, after the cancel window.
    RefundedAfterWindow = 2,
    /// Paid to the payee by the payee's own claim after the claim window.
    ClaimedByPayee = 3,
    /// Metered escrow settled at its actual cost.
    SettledActual = 4,
    /// Split by the judge of a disputed delivery: `amount` to the payee after
    /// the fee, `refunded` back to the payer.
    ResolvedByJudge = 5,
}

const LOCKED: [u8; 8] = discriminator("event:EscrowLocked");
const SETTLED: [u8; 8] = discriminator("event:EscrowSettled");
const DELIVERY_RECORDED: [u8; 8] = discriminator("event:DeliveryRecorded");
const DELIVERY_CHANGED: [u8; 8] = discriminator("event:DeliveryChanged");
const DELIVERY_RESOLVED: [u8; 8] = discriminator("event:DeliveryResolved");

struct Record {
    bytes: [u8; 192],
    len: usize,
}

impl Record {
    #[inline(always)]
    fn new(kind: &[u8; 8]) -> Self {
        let mut record = Self {
            bytes: [0; 192],
            len: 0,
        };
        record.put(kind);
        record
    }

    /// Append `field`. The buffer is sized for the largest event, so a field
    /// that would not fit (there is none) is dropped rather than written.
    #[inline(always)]
    fn put(&mut self, field: &[u8]) {
        let end = self.len + field.len();
        if end <= self.bytes.len() {
            // SAFETY: `len..end` is inside the buffer.
            unsafe {
                core::ptr::copy_nonoverlapping(
                    field.as_ptr(),
                    self.bytes.as_mut_ptr().add(self.len),
                    field.len(),
                )
            };
            self.len = end;
        }
    }

    /// Party addresses, then the optional mint (`None` for native SOL).
    fn parties(
        &mut self,
        escrow: &Address,
        payer: &Address,
        payee: &Address,
        mint: Option<&Address>,
    ) {
        self.put(escrow.as_ref());
        self.put(payer.as_ref());
        self.put(payee.as_ref());
        match mint {
            Some(mint) => {
                self.put(&[1]);
                self.put(mint.as_ref());
            }
            None => self.put(&[0]),
        }
    }

    fn emit(&self) {
        // SAFETY: `len` never exceeds the buffer (see `put`).
        log::data(unsafe { core::slice::from_raw_parts(self.bytes.as_ptr(), self.len) });
    }
}

pub struct Locked<'a> {
    pub escrow: &'a Address,
    pub payer: &'a Address,
    pub payee: &'a Address,
    pub mint: Option<&'a Address>,
    pub amount: u64,
    pub nonce: &'a [u8; 16],
    pub created_slot: u64,
}

impl Locked<'_> {
    #[inline(never)]
    pub fn emit(&self) {
        let mut record = Record::new(&LOCKED);
        record.parties(self.escrow, self.payer, self.payee, self.mint);
        record.put(&self.amount.to_le_bytes());
        record.put(self.nonce);
        record.put(&self.created_slot.to_le_bytes());
        record.emit();
    }
}

pub struct Settled<'a> {
    pub escrow: &'a Address,
    pub payer: &'a Address,
    pub payee: &'a Address,
    pub mint: Option<&'a Address>,
    /// Amount moved to the beneficiary. For a payout, the payee's share after
    /// the fee.
    pub amount: u64,
    pub nonce: &'a [u8; 16],
    pub outcome: Outcome,
    pub slot: u64,
    /// Protocol fee sent to the treasury. Zero for a refund.
    pub fee: u64,
    /// Amount returned to the payer by a settlement below the locked amount.
    pub refunded: u64,
}

impl Settled<'_> {
    #[inline(never)]
    pub fn emit(&self) {
        let mut record = Record::new(&SETTLED);
        record.parties(self.escrow, self.payer, self.payee, self.mint);
        record.put(&self.amount.to_le_bytes());
        record.put(self.nonce);
        record.put(&[self.outcome as u8]);
        record.put(&self.slot.to_le_bytes());
        record.put(&self.fee.to_le_bytes());
        record.put(&self.refunded.to_le_bytes());
        record.emit();
    }
}

/// The payee recorded what it delivered.
pub struct DeliveryRecorded<'a> {
    pub escrow: &'a Address,
    pub units: u64,
    pub bytes: u64,
    pub sha256: &'a [u8; 32],
    pub slot: u64,
}

impl DeliveryRecorded<'_> {
    #[inline(never)]
    pub fn emit(&self) {
        let mut record = Record::new(&DELIVERY_RECORDED);
        record.put(self.escrow.as_ref());
        record.put(&self.units.to_le_bytes());
        record.put(&self.bytes.to_le_bytes());
        record.put(self.sha256);
        record.put(&self.slot.to_le_bytes());
        record.emit();
    }
}

/// The payer accepted (`state` 2) or disputed (`state` 3) a delivery.
pub struct DeliveryChanged<'a> {
    pub escrow: &'a Address,
    pub state: u8,
    pub slot: u64,
}

impl DeliveryChanged<'_> {
    #[inline(never)]
    pub fn emit(&self) {
        let mut record = Record::new(&DELIVERY_CHANGED);
        record.put(self.escrow.as_ref());
        record.put(&[self.state]);
        record.put(&self.slot.to_le_bytes());
        record.emit();
    }
}

/// The judge ruled on a disputed delivery. `payout` is what it awarded the
/// payee before the fee; the escrow's `EscrowSettled` event follows with what
/// actually moved.
pub struct DeliveryResolved<'a> {
    pub escrow: &'a Address,
    pub judge: &'a Address,
    pub payout: u64,
    pub slot: u64,
}

impl DeliveryResolved<'_> {
    #[inline(never)]
    pub fn emit(&self) {
        let mut record = Record::new(&DELIVERY_RESOLVED);
        record.put(self.escrow.as_ref());
        record.put(self.judge.as_ref());
        record.put(&self.payout.to_le_bytes());
        record.put(&self.slot.to_le_bytes());
        record.emit();
    }
}
