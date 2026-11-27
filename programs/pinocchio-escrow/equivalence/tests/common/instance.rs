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
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::instruction::Instruction,
    },
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

/// The pause account, `["pause"]` under the program id.
pub const PAUSE_ADDRESS: Pubkey =
    anchor_lang::prelude::pubkey!("Fxx73r7JeSoCg28GhSGhksrwdpzRWWKXas5a2BQtkbEi");
/// A guardian key the harness names when it creates the pause account.
pub const TEST_GUARDIAN: Pubkey = Pubkey::new_from_array([7; 32]);

/// `account:PauseState` data: `guardian`, paused until `paused_until_slot`.
pub fn pause_state(guardian: &Pubkey, paused_until_slot: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(89);
    data.extend_from_slice(&Sha256::digest(b"account:PauseState")[..8]);
    data.extend_from_slice(guardian.as_ref());
    data.extend_from_slice(&paused_until_slot.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes());
    data.extend_from_slice(guardian.as_ref());
    data.push(255);
    data
}

/// Create the pause account, not paused, as `init_pause` leaves it, unless
/// the test already put one there.
pub fn ensure_pause_account(svm: &mut LiteSVM) {
    if svm.get_account(&PAUSE_ADDRESS).is_some() {
        return;
    }
    let data = pause_state(&TEST_GUARDIAN, 0);
    svm.set_account(
        PAUSE_ADDRESS,
        solana_account::Account {
            lamports: svm.minimum_balance_for_rent_exemption(data.len()),
            data,
            owner: escrow::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

/// Instructions that take the pause account, as clients send them. The
/// program ignores it on every other instruction, and so does the Anchor
/// build.
const GATED: [&str; 17] = [
    "lock_escrow",
    "lock_metered_escrow",
    "release_escrow",
    "settle_escrow",
    "lock_token_escrow",
    "lock_metered_token_escrow",
    "release_token_escrow",
    "settle_token_escrow",
    "open_budget",
    "open_token_budget",
    "reserve",
    "resolve_delivery",
    "resolve_token_delivery",
    "payout_budget",
    "payout_token_budget",
    "resolve_budget",
    "resolve_token_budget",
];

pub fn gated(ix: &Instruction) -> bool {
    ix.program_id == escrow::id()
        && ix.data.len() >= 8
        && GATED.iter().any(|name| ix.data[..8] == selector(name))
}

/// `ix` with the pause account last, if it takes one and has none yet.
pub fn with_pause(ix: Instruction) -> Instruction {
    let mut ix = ix;
    if gated(&ix) && !ix.accounts.iter().any(|meta| meta.pubkey == PAUSE_ADDRESS) {
        ix.accounts
            .push(anchor_lang::prelude::AccountMeta::new_readonly(
                PAUSE_ADDRESS,
                false,
            ));
    }
    ix
}

/// `ixs` as a client sends them: each bare exit naming its escrow (the clock
/// moves past the lock slot if needed), and the pause account appended to
/// each instruction that takes it. The pause account is created, not paused,
/// if the test has not put one there.
pub fn bind(svm: &mut LiteSVM, ixs: &[Instruction]) -> Vec<Instruction> {
    if ixs.iter().any(gated) {
        ensure_pause_account(svm);
    }
    bind_without_pause(svm, ixs)
        .into_iter()
        .map(with_pause)
        .collect()
}

/// As `bind`, without the pause account: for the archived Anchor build,
/// and for tests of a call that leaves it out.
pub fn bind_without_pause(svm: &mut LiteSVM, ixs: &[Instruction]) -> Vec<Instruction> {
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
