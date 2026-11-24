//! Builders and readers for the pooled-budget instructions and accounts,
//! shared by `budget.rs` and `interface_vectors.rs`.
use {
    super::*,
    anchor_lang::{
        prelude::{AccountMeta, Pubkey},
        solana_program::{instruction::Instruction, system_program},
    },
    escrow::PROTOCOL_TREASURY,
};

pub const BUDGET_LEN: usize = 349;
pub const RESERVATION_LEN: usize = 147;
pub const ZERO: Pubkey = Pubkey::new_from_array([0; 32]);

// ── Addresses and readers ───────────────────────────────────────────────────

pub fn budget_address(payer: &Pubkey, nonce: [u8; 16]) -> Pubkey {
    Pubkey::find_program_address(&[b"budget", payer.as_ref(), &nonce], &escrow::id()).0
}

pub fn vault_address(budget: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"budget-vault", budget.as_ref()], &escrow::id()).0
}

pub fn reservation_address(budget: &Pubkey, payee: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"reservation", budget.as_ref(), payee.as_ref()],
        &escrow::id(),
    )
    .0
}

#[derive(Debug)]
pub struct BudgetView {
    pub created: u64,
    pub total: u64,
    pub unreserved: u64,
    pub closed_slot: u64,
    pub reservations: u8,
    pub unsettled: u8,
    pub flags: u8,
}

pub fn read_budget(world: &World, budget: &Pubkey) -> BudgetView {
    let data = world.data(budget);
    assert_eq!(data.len(), BUDGET_LEN);
    assert_eq!(data[..8], account_discriminator("Budget"));
    BudgetView {
        created: u64_at(&data, 152),
        total: u64_at(&data, 184),
        unreserved: u64_at(&data, 192),
        closed_slot: u64_at(&data, 336),
        reservations: data[344],
        unsettled: data[345],
        flags: data[346],
    }
}

#[derive(Debug)]
pub struct ReservationView {
    pub payee: Pubkey,
    pub payout_account: Pubkey,
    pub reserved: u64,
    pub final_amount: u64,
    pub posted: u64,
    pub state: u8,
    pub waived: u8,
}

pub fn read_reservation(world: &World, reservation: &Pubkey) -> ReservationView {
    let data = world.data(reservation);
    assert_eq!(data.len(), RESERVATION_LEN);
    assert_eq!(data[..8], account_discriminator("Reservation"));
    ReservationView {
        payee: Pubkey::new_from_array(data[48..80].try_into().unwrap()),
        payout_account: Pubkey::new_from_array(data[80..112].try_into().unwrap()),
        reserved: u64_at(&data, 112),
        final_amount: u64_at(&data, 120),
        posted: u64_at(&data, 128),
        state: data[144],
        waived: data[145],
    }
}

// ── Instruction builders ────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Terms {
    pub nonce: [u8; 16],
    pub spender: Pubkey,
    pub judge: Pubkey,
    pub open: u64,
    pub dispute: u64,
    pub judge_slots: u64,
    pub total: u64,
    pub cap: u64,
    pub flags: u8,
    pub allowlist: [Pubkey; 4],
}

impl Terms {
    pub fn data(&self, name: &str) -> Vec<u8> {
        let mut data = selector(name).to_vec();
        data.extend_from_slice(&self.nonce);
        data.extend_from_slice(self.spender.as_ref());
        data.extend_from_slice(self.judge.as_ref());
        for value in [
            self.open,
            self.dispute,
            self.judge_slots,
            self.total,
            self.cap,
        ] {
            data.extend_from_slice(&value.to_le_bytes());
        }
        data.push(self.flags);
        for entry in &self.allowlist {
            data.extend_from_slice(entry.as_ref());
        }
        data
    }

    pub fn judge_meta(&self) -> Option<AccountMeta> {
        (self.judge != ZERO).then(|| AccountMeta::new_readonly(agent(&self.judge), false))
    }

    pub fn open_ix(&self, payer: &Pubkey) -> Instruction {
        let mut accounts = vec![
            AccountMeta::new(budget_address(payer, self.nonce), false),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(system_program::id(), false),
        ];
        accounts.extend(self.judge_meta());
        Instruction {
            program_id: escrow::id(),
            accounts,
            data: self.data("open_budget"),
        }
    }

    pub fn open_token_ix(&self, tokens: &Tokens) -> Instruction {
        let payer = tokens.payer.pubkey();
        let budget = budget_address(&payer, self.nonce);
        let mut accounts = vec![
            AccountMeta::new(budget, false),
            AccountMeta::new(vault_address(&budget), false),
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(tokens.mint, false),
            AccountMeta::new(tokens.source, false),
            AccountMeta::new_readonly(tokens.program, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ];
        accounts.extend(self.judge_meta());
        Instruction {
            program_id: escrow::id(),
            accounts,
            data: self.data("open_token_budget"),
        }
    }
}

pub fn ix(name: &str, args: &[u64], accounts: Vec<AccountMeta>) -> Instruction {
    let mut data = selector(name).to_vec();
    for arg in args {
        data.extend_from_slice(&arg.to_le_bytes());
    }
    Instruction {
        program_id: escrow::id(),
        accounts,
        data,
    }
}

pub fn reserve_ix(
    budget: &Pubkey,
    created: u64,
    spender: &Pubkey,
    payee: &Pubkey,
    payout_account: &Pubkey,
    amount: u64,
) -> Instruction {
    ix(
        "reserve",
        &[created, amount],
        vec![
            AccountMeta::new(*budget, false),
            AccountMeta::new(reservation_address(budget, payee), false),
            AccountMeta::new_readonly(*spender, true),
            AccountMeta::new(*payee, true),
            AccountMeta::new_readonly(agent(payee), false),
            AccountMeta::new_readonly(*payout_account, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
    )
}

pub fn set_payout_ix(
    budget: &Pubkey,
    created: u64,
    payee: &Pubkey,
    account: &Pubkey,
) -> Instruction {
    ix(
        "set_payout_account",
        &[created],
        vec![
            AccountMeta::new_readonly(*budget, false),
            AccountMeta::new(reservation_address(budget, payee), false),
            AccountMeta::new_readonly(*payee, true),
            AccountMeta::new_readonly(*account, false),
        ],
    )
}

pub fn post_ix(budget: &Pubkey, created: u64, payee: &Pubkey, amount: u64) -> Instruction {
    ix(
        "post_final",
        &[created, amount],
        vec![
            AccountMeta::new_readonly(*budget, false),
            AccountMeta::new(reservation_address(budget, payee), false),
            AccountMeta::new_readonly(*payee, true),
        ],
    )
}

/// `waive` or `dispute` of `payee`'s reservation, signed by `signer`.
pub fn hold_ix(
    name: &str,
    budget: &Pubkey,
    created: u64,
    payee: &Pubkey,
    signer: &Pubkey,
) -> Instruction {
    ix(
        name,
        &[created],
        vec![
            AccountMeta::new_readonly(*budget, false),
            AccountMeta::new(reservation_address(budget, payee), false),
            AccountMeta::new_readonly(*signer, true),
        ],
    )
}

pub fn payout_ix(budget: &Pubkey, created: u64, payee: &Pubkey, payer: &Pubkey) -> Instruction {
    ix(
        "payout_budget",
        &[created],
        vec![
            AccountMeta::new(*budget, false),
            AccountMeta::new(reservation_address(budget, payee), false),
            AccountMeta::new(*payee, false),
            AccountMeta::new(*payer, false),
            AccountMeta::new(PROTOCOL_TREASURY, false),
        ],
    )
}

pub fn resolve_ix(
    budget: &Pubkey,
    created: u64,
    payee: &Pubkey,
    payer: &Pubkey,
    judge: &Pubkey,
    payout: u64,
) -> Instruction {
    let mut ix = payout_ix(budget, created, payee, payer);
    ix.data = selector("resolve_budget").to_vec();
    ix.data.extend_from_slice(&created.to_le_bytes());
    ix.data.extend_from_slice(&payout.to_le_bytes());
    ix.accounts.push(AccountMeta::new_readonly(*judge, true));
    ix
}

pub fn close_ix(budget: &Pubkey, created: u64, signer: &Pubkey, payer: &Pubkey) -> Instruction {
    ix(
        "close_budget",
        &[created],
        vec![
            AccountMeta::new(*budget, false),
            AccountMeta::new_readonly(*signer, true),
            AccountMeta::new(*payer, false),
        ],
    )
}

pub fn token_payout_ix(
    tokens: &Tokens,
    budget: &Pubkey,
    created: u64,
    payee: &Pubkey,
    payout_account: &Pubkey,
) -> Instruction {
    ix(
        "payout_token_budget",
        &[created],
        vec![
            AccountMeta::new(*budget, false),
            AccountMeta::new(vault_address(budget), false),
            AccountMeta::new(reservation_address(budget, payee), false),
            AccountMeta::new(*payee, false),
            AccountMeta::new(tokens.payer.pubkey(), false),
            AccountMeta::new_readonly(tokens.mint, false),
            AccountMeta::new(*payout_account, false),
            AccountMeta::new(tokens.treasury_token, false),
            AccountMeta::new(tokens.source, false),
            AccountMeta::new_readonly(tokens.program, false),
        ],
    )
}

pub fn token_resolve_ix(
    tokens: &Tokens,
    budget: &Pubkey,
    created: u64,
    payee: &Pubkey,
    payout_account: &Pubkey,
    judge: &Pubkey,
    payout: u64,
) -> Instruction {
    let mut ix = token_payout_ix(tokens, budget, created, payee, payout_account);
    ix.data = selector("resolve_token_budget").to_vec();
    ix.data.extend_from_slice(&created.to_le_bytes());
    ix.data.extend_from_slice(&payout.to_le_bytes());
    ix.accounts.push(AccountMeta::new_readonly(*judge, true));
    ix
}

pub fn token_close_ix(
    tokens: &Tokens,
    budget: &Pubkey,
    created: u64,
    signer: &Pubkey,
) -> Instruction {
    ix(
        "close_token_budget",
        &[created],
        vec![
            AccountMeta::new(*budget, false),
            AccountMeta::new(vault_address(budget), false),
            AccountMeta::new_readonly(*signer, true),
            AccountMeta::new(tokens.payer.pubkey(), false),
            AccountMeta::new_readonly(tokens.mint, false),
            AccountMeta::new(tokens.source, false),
            AccountMeta::new_readonly(tokens.program, false),
        ],
    )
}
