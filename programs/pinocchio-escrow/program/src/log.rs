//! Thin wrappers over the two logging syscalls the program uses.

/// Write a text line to the program log.
#[inline(always)]
pub fn message(text: &str) {
    #[cfg(target_os = "solana")]
    // SAFETY: `text` is a valid slice for the duration of the call.
    unsafe {
        pinocchio::syscalls::sol_log_(text.as_ptr(), text.len() as u64)
    };
    #[cfg(not(target_os = "solana"))]
    core::hint::black_box(text);
}

/// Write one binary record to the program log (`Program data: …`), the
/// channel Anchor events use.
#[inline(always)]
pub fn data(record: &[u8]) {
    #[cfg(target_os = "solana")]
    {
        let fields = [record];
        // SAFETY: `fields` is a valid one-element array of slices.
        unsafe { pinocchio::syscalls::sol_log_data(fields.as_ptr() as *const u8, 1) };
    }
    #[cfg(not(target_os = "solana"))]
    core::hint::black_box(record);
}
