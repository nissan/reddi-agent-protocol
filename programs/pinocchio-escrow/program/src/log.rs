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

/// One log line assembled on the stack: text, addresses in base58, numbers in
/// decimal. Text that does not fit is dropped rather than overflowing.
#[cfg(feature = "extended")]
pub struct Line {
    bytes: [u8; 192],
    len: usize,
}

#[cfg(feature = "extended")]
impl Line {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self {
            bytes: [0; 192],
            len: 0,
        }
    }

    pub fn text(mut self, text: &str) -> Self {
        for &byte in text.as_bytes() {
            self.push(byte);
        }
        self
    }

    pub fn number(mut self, mut value: u64) -> Self {
        // Decimal digits, least significant first. A u64 has at most 20.
        let mut digits = [0u8; 20];
        let mut count = 0usize;
        for digit in digits.iter_mut() {
            *digit = b'0' + (value % 10) as u8;
            count = count.saturating_add(1);
            value /= 10;
            if value == 0 {
                break;
            }
        }
        for digit in digits.iter().take(count).rev() {
            self.push(*digit);
        }
        self
    }

    /// Append 32 bytes in base58, the way addresses are printed.
    pub fn address(mut self, address: &[u8; 32]) -> Self {
        const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        /// 58^5: one division by it yields five base-58 digits.
        const GROUP: u64 = 58 * 58 * 58 * 58 * 58;

        // The value as eight 32-bit limbs, most significant first.
        let mut limbs = [0u32; 8];
        for (limb, bytes) in limbs.iter_mut().zip(address.as_chunks::<4>().0) {
            *limb = bytes
                .iter()
                .fold(0, |limb, &byte| (limb << 8) | byte as u32);
        }
        // Base-58 digits, least significant first: nine groups of five cover
        // the 44 digits a 256-bit value can need.
        let mut digits = [0u8; 45];
        for group in digits.as_chunks_mut::<5>().0 {
            let mut remainder = 0u64;
            for limb in limbs.iter_mut() {
                let value = (remainder << 32) | *limb as u64;
                *limb = (value / GROUP) as u32;
                remainder = value % GROUP;
            }
            for digit in group {
                *digit = (remainder % 58) as u8;
                remainder /= 58;
            }
        }
        // Each leading zero byte is printed as one '1'; the zero digits above
        // the number's first non-zero digit are not printed.
        for _ in address.iter().take_while(|&&byte| byte == 0) {
            self.push(b'1');
        }
        for digit in digits.iter().rev().skip_while(|&&digit| digit == 0) {
            self.push(ALPHABET.get(*digit as usize).copied().unwrap_or(b'?'));
        }
        self
    }

    pub fn emit(self) {
        let line = self.bytes.get(..self.len).unwrap_or(&[]);
        // SAFETY: every byte pushed is ASCII or came from a `&str`.
        message(unsafe { core::str::from_utf8_unchecked(line) });
    }

    fn push(&mut self, byte: u8) {
        if let Some(slot) = self.bytes.get_mut(self.len) {
            *slot = byte;
            self.len = self.len.saturating_add(1);
        }
    }
}

#[cfg(all(test, feature = "extended"))]
mod tests {
    use super::Line;

    fn printed(line: Line) -> std::string::String {
        std::string::String::from_utf8(line.bytes[..line.len].to_vec()).unwrap()
    }

    extern crate std;

    #[test]
    fn addresses_print_as_base58() {
        for text in [
            "11111111111111111111111111111111",
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            "1nc1nerator11111111111111111111111111111111",
            "5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe",
            "JEKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFG",
            "1111111111111111111111111111111P",
        ] {
            let address = solana_address::Address::from_str_const(text);
            assert_eq!(printed(Line::new().address(address.as_array())), text);
        }
        assert_eq!(
            printed(
                Line::new()
                    .text("a=")
                    .number(0)
                    .text(", b=")
                    .number(u64::MAX)
            ),
            "a=0, b=18446744073709551615"
        );
    }
}
