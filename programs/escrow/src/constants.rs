pub const ESCROW_SEED: &[u8] = b"escrow";
pub const ESCROW_DISCRIMINATOR_SIZE: usize = 8;
/// Minimum slots before a payer can cancel (~7 days at 400ms/slot)
pub const CANCEL_WINDOW_SLOTS: u64 = 50_400;
