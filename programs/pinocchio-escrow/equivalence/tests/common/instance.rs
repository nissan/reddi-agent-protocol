//! Exits name the escrow they end, as a client sends them.
//!
//! Every exit (release, settle and cancel, SOL and token) carries the slot
//! its escrow was locked in, 8 bytes little-endian after the exit's own data,
//! and cannot land in that slot. Tests written against the archived Anchor
//! program build exits without those bytes; `bind` adds them the way a client
//! does, reading the lock slot from the escrow record, and moves the clock
//! one slot on if the exit would otherwise land in the lock slot. An exit
//! that already carries trailing data is left as it is, and so is one whose
//! escrow account does not exist or is rated: a rated exit names its job,
//! which the tests that send one do themselves.
#![allow(dead_code)]

use {
    anchor_lang::{prelude::Clock, solana_program::instruction::Instruction},
    litesvm::LiteSVM,
    sha2::{Digest, Sha256},
};

/// Exit name, instruction data length without the instance, and where the
/// escrow record keeps `created_slot` and its flags.
const EXITS: [(&str, usize, Layout); 6] = [
    ("release_escrow", 8, SOL),
    ("settle_escrow", 16, SOL),
    ("cancel_escrow", 8, SOL),
    ("release_token_escrow", 8, TOKEN),
    ("settle_token_escrow", 16, TOKEN),
    ("cancel_token_escrow", 8, TOKEN),
];

#[derive(Clone, Copy)]
struct Layout {
    created_slot: usize,
    flags: usize,
}
const SOL: Layout = Layout {
    created_slot: 8 + 32 + 32 + 8 + 16 + 1 + 8,
    flags: 132,
};
const TOKEN: Layout = Layout {
    created_slot: 8 + 32 * 5 + 8 + 16 + 1,
    flags: 8 + 32 * 5 + 8 + 16 + 1 + 8 + 1,
};
const FLAG_RATED: u8 = 0x02;

fn selector(name: &str) -> [u8; 8] {
    let hash = Sha256::digest(format!("global:{name}").as_bytes());
    hash[..8].try_into().unwrap()
}

/// The escrow layout, if `ix` is a bare exit (no data after its own).
fn bare_exit(ix: &Instruction) -> Option<Layout> {
    if ix.program_id != escrow::id() || ix.data.len() < 8 {
        return None;
    }
    EXITS.iter().find_map(|(name, len, at)| {
        (ix.data[..8] == selector(name) && ix.data.len() == *len).then_some(*at)
    })
}

/// `ixs` with each bare exit naming its escrow. The clock moves past the
/// lock slot if needed.
pub fn bind(svm: &mut LiteSVM, ixs: &[Instruction]) -> Vec<Instruction> {
    ixs.iter()
        .map(|ix| {
            let mut ix = ix.clone();
            let Some(layout) = bare_exit(&ix) else {
                return ix;
            };
            let Some(escrow) = ix.accounts.first().and_then(|m| svm.get_account(&m.pubkey)) else {
                return ix;
            };
            let at = layout.created_slot;
            // A SOL escrow delegated to PER holds a 32-byte session key
            // before its flags.
            let flags_at = if layout.flags == SOL.flags && escrow.data.get(130) == Some(&1) {
                layout.flags + 32
            } else {
                layout.flags
            };
            let (Some(bytes), Some(flags)) =
                (escrow.data.get(at..at + 8), escrow.data.get(flags_at))
            else {
                return ix;
            };
            // A rated escrow's exit names its job through the rating; the
            // tests that send one build it themselves.
            if flags & FLAG_RATED != 0 {
                return ix;
            }
            let created = u64::from_le_bytes(bytes.try_into().unwrap());
            if svm.get_sysvar::<Clock>().slot <= created {
                svm.warp_to_slot(created + 1);
            }
            ix.data.extend_from_slice(&created.to_le_bytes());
            ix
        })
        .collect()
}

/// The lock slot of the escrow record `data`, SOL or token.
pub fn created_slot(data: &[u8]) -> u64 {
    let at = match data.len() {
        165 | 197 => SOL.created_slot,
        219 => TOKEN.created_slot,
        len => panic!("not an escrow record: {len} bytes"),
    };
    u64::from_le_bytes(data[at..at + 8].try_into().unwrap())
}

/// `exit` naming the escrow locked in `slot`.
pub fn naming(exit: &Instruction, slot: u64) -> Instruction {
    let mut exit = exit.clone();
    exit.data.extend_from_slice(&slot.to_le_bytes());
    exit
}
