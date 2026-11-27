//! Pooled budget: one lock that a payer's spender key splits between
//! registered providers while it is open.
//!
//! The payer opens a budget (`open_budget`, `open_token_budget`) naming a
//! spender key, an optional judge, an optional provider allowlist, a
//! per-provider cap and three windows: the open period, the dispute window
//! and the judge's window. While the budget is open, a provider and the
//! spender together reserve a slice of it for that provider (`reserve`),
//! which can never exceed what is left. Calls are metered off chain against
//! the slice. The provider posts what it is owed (`post_final`), at most its
//! slice.
//!
//! The budget closes (`close_budget`, `close_token_budget`) when the payer
//! or the spender says so, or by anyone once the open period has ended; what
//! was never reserved goes back to the payer at once. The payer may dispute a
//! posted reservation until the dispute window ends, which is never earlier
//! than `MIN_REVIEW_SLOTS` after the first post. A reservation is paid out
//! (`payout_budget`, `payout_token_budget`, by anyone) when both sides
//! waived (the provider by posting, the payer by `waive`), or when the
//! dispute window ends undisputed. A disputed one is split by the judge
//! (`resolve_budget`, `resolve_token_budget`), or refunds in full when the
//! judge does not rule in time. Every payout takes the protocol fee from the
//! provider's share and returns the unused slice to the payer.
//!
//! Every instruction after the open names the budget by its `created_slot`
//! and is refused in the slot the budget was opened in, so nothing signed for
//! one budget can act on a later budget at the same address.
use {
    crate::{
        checks::{
            at_seeds, close, create_pda, credit, debit, derive, now, program, rent_exempt_minimum,
            sha256, signer, transfer, writable, Args,
        },
        consts::{
            allowed_token_program, budget_windows_valid, min_reservation, protocol_fee, AGENT_SEED,
            ALLOWED_MINT_DECIMALS, ASSOCIATED_TOKEN_PROGRAM_ID, BUDGET_ALLOWLIST_LEN,
            BUDGET_APPROVAL_CLUSTER, BUDGET_APPROVAL_DOMAIN, BUDGET_FLAG_P256_SPENDER,
            BUDGET_FLAG_SPENDER_WAIVES, BUDGET_OPEN_FLAGS, BUDGET_SEED, BUDGET_VAULT_SEED,
            MAX_BUDGET_RESERVATIONS, MAX_SOL_ESCROW_LAMPORTS, MAX_TOKEN_ESCROW_BASE_UNITS,
            MEMO_PROGRAM_ID, PROTOCOL_TREASURY, RESERVATION_SEED, SECP256R1_PROGRAM_ID,
            SYSTEM_PROGRAM_ID, TOKEN_2022_ID,
        },
        error::{
            fail, require, AboveProviderCap, AccountNotEnoughKeys, AmountAboveCap,
            BudgetAlreadyClosed, BudgetBalanceTooLow, BudgetDisputeWindowClosed, BudgetHasNoJudge,
            BudgetInstanceMismatch, BudgetJudgeWindowClosed, BudgetJustOpened,
            BudgetNeedsJudgeOrAllowlist, BudgetNotClosed, BudgetNotOpen,
            ConstraintDuplicateMutableAccount, ConstraintHasOne, ConstraintSeeds,
            InvalidBudgetTerms, InvalidFinalAmount, InvalidJudge, InvalidPayee, InvalidProgramId,
            InvalidReservation, InvalidResolution, InvalidTokenAccount, InvalidTokenAmount,
            InvalidTreasury, JudgeNotActive, MintNotAllowed, NotAttestationAgent, PayeeNotActive,
            PayeeNotAllowed, PayeeNotRentExempt, PayoutNotOpen, ProtocolPaused,
            ReservationDisputed, ReservationLocked, ReservationNotDisputed, ReservationNotPosted,
            ReservationTooSmall, ReservationWaived, SpenderApprovalExpired,
            SpenderApprovalMismatch, SpenderApprovalMissing, SpenderWaiveNeedsAllowlist,
            TooManyReservations, UnauthorisedSigner,
        },
        events::{BudgetClosed, BudgetOpened, BudgetOutcome, BudgetPaid, BudgetReserved},
        state::{
            AgentHead, Budget, Record, Reservation, RESERVATION_DISPUTED, RESERVATION_OPEN,
            RESERVATION_PAID, RESERVATION_POSTED,
        },
        token::{self, is_token_program, mint_decimals, vault_len, TokenAccount},
    },
    pinocchio::{
        cpi::{Seed, Signer},
        error::ProgramError,
        sysvars::instructions::{Instructions, INSTRUCTIONS_ID},
        AccountView, Address, ProgramResult,
    },
    pinocchio_token::instructions::InitializeAccount3,
};

const ZERO: Address = Address::new_from_array([0; 32]);

// ── Open ────────────────────────────────────────────────────────────────────

/// The terms an open names, in wire order after the selector.
struct Terms {
    nonce: [u8; 16],
    spender: Address,
    judge: Address,
    open_slots: u64,
    dispute_slots: u64,
    judge_slots: u64,
    total: u64,
    per_provider_cap: u64,
    flags: u8,
    allowlist: [Address; BUDGET_ALLOWLIST_LEN],
}

impl Terms {
    fn read(data: &[u8]) -> Result<Self, ProgramError> {
        let mut args = Args(data);
        let nonce = args.array()?;
        let spender = Address::new_from_array(args.array()?);
        let judge = Address::new_from_array(args.array()?);
        let open_slots = args.u64()?;
        let dispute_slots = args.u64()?;
        let judge_slots = args.u64()?;
        let total = args.u64()?;
        let per_provider_cap = args.u64()?;
        let flags = args.u8()?;
        let mut allowlist = [ZERO; BUDGET_ALLOWLIST_LEN];
        for entry in allowlist.iter_mut() {
            *entry = Address::new_from_array(args.array()?);
        }
        Ok(Self {
            nonce,
            spender,
            judge,
            open_slots,
            dispute_slots,
            judge_slots,
            total,
            per_provider_cap,
            flags,
            allowlist,
        })
    }

    fn has_allowlist(&self) -> bool {
        self.allowlist.iter().any(|entry| entry != &ZERO)
    }

    /// The cap a reservation may reach: the named cap, or the total for 0.
    fn cap(&self) -> u64 {
        if self.per_provider_cap == 0 {
            self.total
        } else {
            self.per_provider_cap
        }
    }

    /// The rules every open shares. `judge_agent` is the judge's registry
    /// record, needed only when a judge is named.
    fn check(
        &self,
        program_id: &Address,
        payer: &Address,
        max_total: u64,
        judge_agent: Option<&AccountView>,
    ) -> ProgramResult {
        require(
            budget_windows_valid(self.open_slots, self.dispute_slots, self.judge_slots)
                && self.total > 0
                && self.spender != ZERO
                && self.per_provider_cap <= self.total
                && self.flags & !BUDGET_OPEN_FLAGS == 0,
            &InvalidBudgetTerms,
        )?;
        require(self.total <= max_total, &AmountAboveCap)?;
        // A stolen spender key with no judge and no allowlist could reserve
        // the whole budget for a provider it registered itself (B1).
        require(
            self.judge != ZERO || self.has_allowlist(),
            &BudgetNeedsJudgeOrAllowlist,
        )?;
        // Letting the spender waive removes the payer's last check, so it
        // needs an allowlist (B2).
        require(
            self.flags & BUDGET_FLAG_SPENDER_WAIVES == 0 || self.has_allowlist(),
            &SpenderWaiveNeedsAllowlist,
        )?;
        if self.judge == ZERO {
            return Ok(());
        }
        // A judge that is a party would rule on its own budget.
        require(
            &self.judge != payer && self.judge != self.spender,
            &InvalidJudge,
        )?;
        let Some(judge_agent) = judge_agent else {
            return Err(fail(&AccountNotEnoughKeys));
        };
        let (head, _, terms) = AgentHead::load_full(judge_agent, program_id)?;
        at_seeds(
            judge_agent,
            &[AGENT_SEED, self.judge.as_ref(), &[terms.bump()]],
            program_id,
        )?;
        require(head.owner == self.judge, &InvalidJudge)?;
        require(head.agent_type() != 0, &NotAttestationAgent)?;
        require(terms.active(), &JudgeNotActive)
    }
}

/// Create the budget record at the address derived from (payer, nonce).
fn create_budget(
    program_id: &Address,
    budget: &AccountView,
    payer: &AccountView,
    nonce: &[u8; 16],
) -> Result<u8, ProgramError> {
    let (address, bump) = derive(&[BUDGET_SEED, payer.address().as_ref(), nonce], program_id);
    require(budget.address() == &address, &ConstraintSeeds)?;
    let bump_bytes = [bump];
    let seeds = [
        Seed::from(BUDGET_SEED),
        Seed::from(payer.address().as_ref()),
        Seed::from(nonce),
        Seed::from(&bump_bytes),
    ];
    // Fails if an account already exists at this address.
    create_pda(
        payer,
        budget,
        Budget::LEN,
        program_id,
        &Signer::from(&seeds),
    )?;
    Ok(bump)
}

/// `open_budget`: lock SOL in a new budget.
///
/// Accounts: `[w] budget`, `[w, s] payer`, `[] system_program`, and when a
/// judge is named `[] judge_agent` (the judge's registry record).
/// Data: `nonce: [u8; 16]`, `spender: address`, `judge: address` (all zero
/// for none), `open_slots: u64`, `dispute_slots: u64`, `judge_slots: u64`,
/// `total: u64`, `per_provider_cap: u64` (0 for the total), `flags: u8`,
/// `allowlist: [address; 4]` (all-zero entries are empty).
pub fn open(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let terms = Terms::read(data)?;
    let [budget, payer, system_program, rest @ ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    signer(payer)?;
    writable(payer)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;
    terms.check(
        program_id,
        payer.address(),
        MAX_SOL_ESCROW_LAMPORTS,
        rest.first(),
    )?;
    let bump = create_budget(program_id, budget, payer, &terms.nonce)?;
    let slot = now()?.0;
    store_new(budget, payer.address(), &ZERO, &terms, slot, bump, 0)?;
    transfer(payer, budget, terms.total)?;
    emit_opened(budget.address(), payer.address(), &ZERO, &terms, slot);
    Ok(())
}

/// `open_token_budget`: lock an allowlisted token in a new budget.
///
/// Accounts: `[w] budget`, `[w] vault`, `[w, s] payer`, `[] mint`,
/// `[w] source` (the payer's token account), `[] token_program`,
/// `[] system_program`, and when a judge is named `[] judge_agent`.
/// Data: as `open_budget`.
pub fn open_token(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let terms = Terms::read(data)?;
    let [budget, vault, payer, mint, source, token_program, system_program, rest @ ..] = accounts
    else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    signer(payer)?;
    writable(payer)?;
    writable(source)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;
    require(is_token_program(token_program.address()), &InvalidProgramId)?;
    let token_program_id = token_program.address();
    let decimals = mint_decimals(mint)?;
    require(
        allowed_token_program(mint.address()) == Some(token_program_id)
            && mint.owned_by(token_program_id)
            && decimals == ALLOWED_MINT_DECIMALS,
        &MintNotAllowed,
    )?;
    let source_before = TokenAccount::read(source)?;
    require(
        &source_before.mint == mint.address()
            && &source_before.owner == payer.address()
            && source.owned_by(token_program_id)
            && !source_before.frozen,
        &InvalidTokenAccount,
    )?;
    terms.check(
        program_id,
        payer.address(),
        MAX_TOKEN_ESCROW_BASE_UNITS,
        rest.first(),
    )?;
    let bump = create_budget(program_id, budget, payer, &terms.nonce)?;

    let (vault_address, vault_bump) =
        derive(&[BUDGET_VAULT_SEED, budget.address().as_ref()], program_id);
    require(vault.address() == &vault_address, &ConstraintSeeds)?;
    let vault_bump_bytes = [vault_bump];
    let vault_seeds = [
        Seed::from(BUDGET_VAULT_SEED),
        Seed::from(budget.address().as_ref()),
        Seed::from(&vault_bump_bytes),
    ];
    create_pda(
        payer,
        vault,
        vault_len(token_program_id),
        token_program_id,
        &Signer::from(&vault_seeds),
    )?;
    InitializeAccount3::new(vault, mint, budget.address())
        .invoke_with_unverified_program(token_program_id)?;
    token::Transfer {
        token_program,
        from: source,
        mint,
        to: vault,
        authority: payer,
        decimals,
    }
    .send(terms.total, &[])?;
    // The vault must hold exactly the total: a Token-2022 transfer fee at
    // open would leave less, and the open is refused (B8).
    require(
        source_before.amount.checked_sub(terms.total) == Some(TokenAccount::read(source)?.amount)
            && TokenAccount::read(vault)?.amount == terms.total,
        &InvalidTokenAmount,
    )?;

    let slot = now()?.0;
    store_new(
        budget,
        payer.address(),
        mint.address(),
        &terms,
        slot,
        bump,
        vault_bump,
    )?;
    emit_opened(
        budget.address(),
        payer.address(),
        mint.address(),
        &terms,
        slot,
    );
    Ok(())
}

fn store_new(
    budget: &mut AccountView,
    payer: &Address,
    mint: &Address,
    terms: &Terms,
    slot: u64,
    bump: u8,
    vault_bump: u8,
) -> ProgramResult {
    Budget::new(
        payer,
        &terms.spender,
        &terms.judge,
        mint,
        terms.nonce,
        slot,
        terms.open_slots,
        terms.dispute_slots,
        terms.judge_slots,
        terms.total,
        terms.cap(),
        terms.allowlist,
        terms.flags,
        bump,
        vault_bump,
    )
    .store(budget)
}

fn emit_opened(budget: &Address, payer: &Address, mint: &Address, terms: &Terms, slot: u64) {
    BudgetOpened {
        budget,
        payer,
        spender: &terms.spender,
        judge: &terms.judge,
        mint,
        total: terms.total,
        created_slot: slot,
    }
    .emit();
}

// ── Shared checks ───────────────────────────────────────────────────────────

/// The budget at `account`, checked to be the instance the caller names and
/// past its opening slot.
fn load_budget(
    program_id: &Address,
    account: &AccountView,
    created_slot: u64,
    slot: u64,
) -> Result<Budget, ProgramError> {
    let record = Budget::load_checked(account, program_id)?;
    require(
        created_slot == record.created_slot(),
        &BudgetInstanceMismatch,
    )?;
    require(slot != record.created_slot(), &BudgetJustOpened)?;
    Ok(record)
}

/// The reservation at `account`, checked to belong to this budget instance.
fn load_reservation(
    program_id: &Address,
    account: &AccountView,
    budget_address: &Address,
    budget: &Budget,
) -> Result<Reservation, ProgramError> {
    let record = Reservation::load_checked(account, program_id)?;
    require(
        &record.budget == budget_address && record.budget_created_slot() == budget.created_slot(),
        &InvalidReservation,
    )?;
    Ok(record)
}

/// The account a payee is paid into: the payee itself for SOL; for tokens, a
/// usable token account of the budget's mint the payee owns, under the
/// mint's token program, that is not the vault.
fn check_payout_account(
    program_id: &Address,
    budget_address: &Address,
    budget: &Budget,
    payee: &Address,
    payout_account: &AccountView,
) -> ProgramResult {
    if budget.sol() {
        return require(payout_account.address() == payee, &InvalidTokenAccount);
    }
    let account = TokenAccount::read(payout_account)?;
    let token_program = allowed_token_program(&budget.mint).ok_or_else(|| fail(&MintNotAllowed))?;
    let (vault, _) = derive(&[BUDGET_VAULT_SEED, budget_address.as_ref()], program_id);
    require(
        account.mint == budget.mint
            && &account.owner == payee
            && payout_account.owned_by(token_program)
            && !account.frozen
            && payout_account.address() != &vault,
        &InvalidTokenAccount,
    )
}

// ── Spender approval ────────────────────────────────────────────────────────

/// What a P-256 spender approval allows.
const APPROVE_RESERVE: u8 = 1;
const APPROVE_WAIVE: u8 = 2;
const APPROVE_CLOSE: u8 = 3;
/// Length of the message a P-256 spender signs.
const APPROVAL_LEN: usize = 21 + 1 + 32 + 32 + 8 + 1 + 32 + 32 + 8 + 8;

/// One call a spender approves, as the program rebuilds it.
struct Approval<'a> {
    budget: &'a Address,
    created_slot: u64,
    action: u8,
    /// The payee for a reserve, the reservation for a waive, zero for a close.
    target: &'a Address,
    /// The payout account for a reserve, zero otherwise.
    payout_account: &'a Address,
    /// The reservation's new total for a reserve, zero otherwise.
    amount: u64,
    /// The last slot the approval may be used in, read after the call's own
    /// data; `None` when the call carries none.
    expires_slot: Option<u64>,
}

impl Approval<'_> {
    /// The exact bytes a P-256 spender signs for this call: the domain and
    /// version, the cluster, the program, the budget and its instance, the
    /// action, its target, payout account and amount, and the expiry.
    fn message(&self, program_id: &Address, expires_slot: u64) -> [u8; APPROVAL_LEN] {
        let mut out = [0u8; APPROVAL_LEN];
        let mut at = 0;
        let mut put = |bytes: &[u8]| {
            out[at..at + bytes.len()].copy_from_slice(bytes);
            at += bytes.len();
        };
        put(BUDGET_APPROVAL_DOMAIN);
        put(&[BUDGET_APPROVAL_CLUSTER]);
        put(program_id.as_ref());
        put(self.budget.as_ref());
        put(&self.created_slot.to_le_bytes());
        put(&[self.action]);
        put(self.target.as_ref());
        put(self.payout_account.as_ref());
        put(&self.amount.to_le_bytes());
        put(&expires_slot.to_le_bytes());
        out
    }
}

/// Whether `authority` acts for the budget's spender in this call.
///
/// A budget without `BUDGET_FLAG_P256_SPENDER` keeps an ordinary spender
/// key: `authority` must be that key and sign. A P-256 budget's spender never
/// signs the transaction. `authority` is then the Instructions sysvar, and
/// the instruction just before this one must be a secp256r1 precompile
/// instruction with exactly one signature whose key, signature and message
/// all lie inside that instruction, whose key hashes to the budget's
/// `spender`, and whose message is `approval`'s, unexpired. The precompile
/// has already checked the signature (low S only) before this runs. Any
/// other account is not the spender (`Ok(false)`); a sysvar with an approval
/// that does not hold is refused outright.
fn spender_approves(
    program_id: &Address,
    record: &Budget,
    authority: &AccountView,
    approval: &Approval,
    slot: u64,
) -> Result<bool, ProgramError> {
    if record.flags & BUDGET_FLAG_P256_SPENDER == 0 {
        return Ok(authority.is_signer() && authority.address() == &record.spender);
    }
    if authority.address() != &INSTRUCTIONS_ID {
        return Ok(false);
    }
    let Some(expires_slot) = approval.expires_slot else {
        return Err(fail(&SpenderApprovalMissing));
    };
    require(slot <= expires_slot, &SpenderApprovalExpired)?;
    let instructions =
        Instructions::try_from(authority).map_err(|_| fail(&SpenderApprovalMissing))?;
    let previous = instructions
        .get_instruction_relative(-1)
        .map_err(|_| fail(&SpenderApprovalMissing))?;
    require(
        previous.get_program_id() == &SECP256R1_PROGRAM_ID,
        &SpenderApprovalMissing,
    )?;
    let data = previous.get_instruction_data();
    // `num_signatures`, padding, then one 14-byte offsets record.
    require(data.len() >= 16 && data[0] == 1, &SpenderApprovalMismatch)?;
    let field = |at: usize| usize::from(u16::from_le_bytes([data[at], data[at + 1]]));
    let (key_at, message_at, message_len) = (field(6), field(10), field(12));
    // Signature, key and message must all come from the precompile
    // instruction itself (index u16::MAX), not from another instruction.
    require(
        field(4) == 0xffff && field(8) == 0xffff && field(14) == 0xffff,
        &SpenderApprovalMismatch,
    )?;
    let key = data
        .get(key_at..key_at + 33)
        .ok_or_else(|| fail(&SpenderApprovalMismatch))?;
    let message = data
        .get(message_at..message_at + message_len)
        .ok_or_else(|| fail(&SpenderApprovalMismatch))?;
    require(
        sha256(&[key]) == *record.spender.as_array(),
        &SpenderApprovalMismatch,
    )?;
    require(
        message == approval.message(program_id, expires_slot).as_slice(),
        &SpenderApprovalMismatch,
    )?;
    Ok(true)
}

// ── Reserve ─────────────────────────────────────────────────────────────────

/// `reserve`: create a provider's reservation, or raise it.
///
/// Accounts: `[w] budget`, `[w] reservation`, `[s] spender`,
/// `[w, s] payee` (pays the fee and the reservation's rent),
/// `[] payee_agent` (the payee's registry record), `[] payout_account`,
/// `[] system_program`.
/// Data: `created_slot: u64`, `amount: u64` (the reservation's new total),
/// and for a P-256 budget `expires_slot: u64`.
///
/// The spender authorises the amount and the payee accepts the budget's
/// terms by signing. On a P-256 budget the spender account is the
/// Instructions sysvar and the spender's approval comes just before
/// (`spender_approves`). Refused once the budget is closed or its open period
/// has ended, past what is unreserved or the per-provider cap, below 1% of
/// the budget, for a payee not on the allowlist (when there is one) or
/// without an active registry record, and for a reservation that was posted,
/// disputed or paid. A raise keeps the recorded payout account.
pub fn reserve(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut args = Args(data);
    let created_slot = args.u64()?;
    let amount = args.u64()?;
    let expires_slot = args.u64().ok();
    let [budget, reservation, spender, payee, payee_agent, payout_account, system_program, ..] =
        accounts
    else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let slot = now()?.0;
    let mut record = load_budget(program_id, budget, created_slot, slot)?;
    writable(budget)?;
    writable(reservation)?;
    writable(payee)?;
    if spender.address() != &INSTRUCTIONS_ID {
        signer(spender)?;
    }
    signer(payee)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;
    let approval = Approval {
        budget: budget.address(),
        created_slot,
        action: APPROVE_RESERVE,
        target: payee.address(),
        payout_account: payout_account.address(),
        amount,
        expires_slot,
    };
    require(
        spender_approves(program_id, &record, spender, &approval, slot)?,
        &UnauthorisedSigner,
    )?;
    require(
        !record.closed() && slot < record.open_ends(),
        &BudgetNotOpen,
    )?;

    // Who may be paid from the budget.
    let payee_address = *payee.address();
    let (vault, _) = derive(&[BUDGET_VAULT_SEED, budget.address().as_ref()], program_id);
    require(
        payee_address != record.payer
            && payee_address != record.spender
            && payee_address != record.judge
            && payee_address != PROTOCOL_TREASURY
            && &payee_address != budget.address()
            && payee_address != vault
            && &payee_address != reservation.address()
            && &payee_address != program_id,
        &InvalidPayee,
    )?;
    let allowlisted = record.allowlist.iter().all(|entry| entry == &ZERO)
        || record.allowlist.iter().any(|entry| entry == &payee_address);
    require(allowlisted, &PayeeNotAllowed)?;
    let (head, _, terms) = AgentHead::load_full(payee_agent, program_id)?;
    at_seeds(
        payee_agent,
        &[AGENT_SEED, payee_address.as_ref(), &[terms.bump()]],
        program_id,
    )?;
    require(head.owner == payee_address, &PayeeNotAllowed)?;
    require(terms.active(), &PayeeNotActive)?;

    require(
        amount >= min_reservation(record.total()),
        &ReservationTooSmall,
    )?;
    require(amount <= record.per_provider_cap(), &AboveProviderCap)?;

    let (address, bump) = derive(
        &[
            RESERVATION_SEED,
            budget.address().as_ref(),
            payee_address.as_ref(),
        ],
        program_id,
    );
    require(reservation.address() == &address, &ConstraintSeeds)?;

    let (mut slice, delta) = if reservation.owned_by(program_id) {
        let slice = load_reservation(program_id, reservation, budget.address(), &record)?;
        require(slice.state == RESERVATION_OPEN, &ReservationLocked)?;
        require(
            payout_account.address() == &slice.payout_account,
            &InvalidTokenAccount,
        )?;
        require(amount > slice.reserved(), &ReservationTooSmall)?;
        let delta = amount - slice.reserved();
        (slice, delta)
    } else {
        require(
            record.reservations < MAX_BUDGET_RESERVATIONS,
            &TooManyReservations,
        )?;
        check_payout_account(
            program_id,
            budget.address(),
            &record,
            &payee_address,
            payout_account,
        )?;
        let bump_bytes = [bump];
        let seeds = [
            Seed::from(RESERVATION_SEED),
            Seed::from(budget.address().as_ref()),
            Seed::from(payee_address.as_ref()),
            Seed::from(&bump_bytes),
        ];
        create_pda(
            payee,
            reservation,
            Reservation::LEN,
            program_id,
            &Signer::from(&seeds),
        )?;
        record.reservations += 1;
        record.unsettled += 1;
        let slice = Reservation::new(
            budget.address(),
            record.created_slot(),
            &payee_address,
            payout_account.address(),
            0,
            bump,
        );
        (slice, amount)
    };
    require(delta <= record.unreserved(), &BudgetBalanceTooLow)?;
    record.set_unreserved(record.unreserved() - delta);
    slice.set_reserved(amount);

    // A SOL payout must not leave the payee below its rent-exempt minimum
    // (B13): it must hold it already, after paying the reservation's rent.
    if record.sol() {
        require(
            payee.lamports() >= rent_exempt_minimum(payee.data_len())?,
            &PayeeNotRentExempt,
        )?;
    }

    slice.store(reservation)?;
    record.store(budget)?;
    BudgetReserved {
        budget: budget.address(),
        payee: &payee_address,
        reserved: amount,
        unreserved: record.unreserved(),
        slot,
    }
    .emit();
    Ok(())
}

/// `set_payout_account`: the payee re-points where its reservation is paid,
/// so a payout account that was closed or frozen cannot keep it from its
/// money (B12).
///
/// Accounts: `[] budget`, `[w] reservation`, `[s] payee`,
/// `[] payout_account`. Data: `created_slot: u64`.
pub fn set_payout_account(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let created_slot = Args(data).u64()?;
    let [budget, reservation, payee, payout_account, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let slot = now()?.0;
    let record = load_budget(program_id, budget, created_slot, slot)?;
    let mut slice = load_reservation(program_id, reservation, budget.address(), &record)?;
    writable(reservation)?;
    signer(payee)?;
    require(payee.address() == &slice.payee, &UnauthorisedSigner)?;
    require(
        slice.state == RESERVATION_OPEN || slice.state == RESERVATION_POSTED,
        &ReservationLocked,
    )?;
    check_payout_account(
        program_id,
        budget.address(),
        &record,
        &slice.payee,
        payout_account,
    )?;
    slice.payout_account = *payout_account.address();
    slice.store(reservation)
}

// ── Post, waive, dispute ────────────────────────────────────────────────────

/// `post_final`: the payee states what it is owed.
///
/// Accounts: `[] budget`, `[w] reservation`, `[s] payee`.
/// Data: `created_slot: u64`, `amount: u64`.
///
/// At most the reservation, and a re-post may only lower the amount (B3).
/// Refused once disputed or waived, and after the dispute window of a closed
/// budget. The first post gives the payer at least `MIN_REVIEW_SLOTS` to
/// dispute; a re-post (always lower) keeps the first post's slot.
pub fn post_final(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let mut args = Args(data);
    let created_slot = args.u64()?;
    let amount = args.u64()?;
    let [budget, reservation, payee, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let slot = now()?.0;
    let record = load_budget(program_id, budget, created_slot, slot)?;
    let mut slice = load_reservation(program_id, reservation, budget.address(), &record)?;
    writable(reservation)?;
    signer(payee)?;
    require(payee.address() == &slice.payee, &UnauthorisedSigner)?;
    require(slice.state != RESERVATION_DISPUTED, &ReservationDisputed)?;
    require(
        slice.state == RESERVATION_OPEN || slice.state == RESERVATION_POSTED,
        &ReservationLocked,
    )?;
    require(slice.waived == 0, &ReservationWaived)?;
    require(
        amount <= slice.reserved()
            && (slice.state == RESERVATION_OPEN || amount <= slice.final_amount()),
        &InvalidFinalAmount,
    )?;
    if record.closed() {
        require(
            slot < slice.dispute_ends(&record),
            &BudgetDisputeWindowClosed,
        )?;
    }
    if slice.state == RESERVATION_OPEN {
        slice.post(amount, slot);
    } else {
        // A re-post only lowers the amount, which needs no new review time:
        // keeping the first post's slot stops a payee from holding the
        // payer's refund by re-posting the same amount again and again.
        slice.repost(amount);
    }
    slice.store(reservation)
}

/// `waive`: the payer (or the spender, when the budget allows it) gives up
/// disputing a posted reservation, which can then be paid out at once.
///
/// Accounts: `[] budget`, `[w] reservation`, `[s] signer` (the Instructions
/// sysvar for a P-256 spender's approval).
/// Data: `created_slot: u64`, and for a P-256 spender `expires_slot: u64`.
pub fn waive(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut args = Args(data);
    let created_slot = args.u64()?;
    let expires_slot = args.u64().ok();
    let [budget, reservation, authority, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let slot = now()?.0;
    let record = load_budget(program_id, budget, created_slot, slot)?;
    let mut slice = load_reservation(program_id, reservation, budget.address(), &record)?;
    writable(reservation)?;
    if authority.address() != &INSTRUCTIONS_ID {
        signer(authority)?;
    }
    let approval = Approval {
        budget: budget.address(),
        created_slot,
        action: APPROVE_WAIVE,
        target: reservation.address(),
        payout_account: &ZERO,
        amount: 0,
        expires_slot,
    };
    require(
        (authority.is_signer() && authority.address() == &record.payer)
            || (record.flags & BUDGET_FLAG_SPENDER_WAIVES != 0
                && spender_approves(program_id, &record, authority, &approval, slot)?),
        &UnauthorisedSigner,
    )?;
    require(slice.state != RESERVATION_DISPUTED, &ReservationDisputed)?;
    require(slice.state == RESERVATION_POSTED, &ReservationNotPosted)?;
    require(slice.waived == 0, &ReservationWaived)?;
    slice.waived = 1;
    slice.store(reservation)
}

/// `dispute`: the payer holds a posted reservation for the judge.
///
/// Accounts: `[] budget`, `[w] reservation`, `[s] payer`.
/// Data: `created_slot: u64`.
///
/// Only on a budget with a judge, only a posted reservation that was not
/// waived, and on a closed budget only until the reservation's dispute window
/// ends. An unposted reservation pays nothing, so there is nothing to dispute.
pub fn dispute(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let created_slot = Args(data).u64()?;
    let [budget, reservation, payer, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let slot = now()?.0;
    let record = load_budget(program_id, budget, created_slot, slot)?;
    let mut slice = load_reservation(program_id, reservation, budget.address(), &record)?;
    writable(reservation)?;
    signer(payer)?;
    require(payer.address() == &record.payer, &UnauthorisedSigner)?;
    require(record.has_judge(), &BudgetHasNoJudge)?;
    require(slice.state != RESERVATION_DISPUTED, &ReservationDisputed)?;
    require(slice.state == RESERVATION_POSTED, &ReservationNotPosted)?;
    require(slice.waived == 0, &ReservationWaived)?;
    if record.closed() {
        require(
            slot < slice.dispute_ends(&record),
            &BudgetDisputeWindowClosed,
        )?;
    }
    slice.dispute(slot);
    slice.store(reservation)
}

// ── Money out ───────────────────────────────────────────────────────────────

/// What a payout of one reservation moves: `paid` (before the fee) to the
/// payee, the rest of the reservation back to the payer.
struct Split {
    paid: u64,
    reserved: u64,
    outcome: BudgetOutcome,
}

/// Whether, and how, a reservation that is not yet paid may be paid out now
/// without the judge.
fn payout_split(record: &Budget, slice: &Reservation, slot: u64) -> Result<Split, ProgramError> {
    let reserved = slice.reserved();
    match slice.state {
        RESERVATION_POSTED if slice.waived == 1 => Ok(Split {
            paid: slice.final_amount(),
            reserved,
            outcome: BudgetOutcome::Waived,
        }),
        RESERVATION_DISPUTED => {
            require(slot >= slice.judge_ends(record), &PayoutNotOpen)?;
            Ok(Split {
                paid: 0,
                reserved,
                outcome: BudgetOutcome::JudgeTimedOut,
            })
        }
        RESERVATION_OPEN | RESERVATION_POSTED => {
            require(record.closed(), &BudgetNotClosed)?;
            require(slot >= slice.dispute_ends(record), &PayoutNotOpen)?;
            let paid = if slice.state == RESERVATION_POSTED {
                slice.final_amount()
            } else {
                0
            };
            Ok(Split {
                paid,
                reserved,
                outcome: BudgetOutcome::WindowEnded,
            })
        }
        _ => Err(fail(&PayoutNotOpen)),
    }
}

/// The split a judge names for a disputed reservation.
fn resolve_split(
    record: &Budget,
    slice: &Reservation,
    judge: &AccountView,
    payout: u64,
    slot: u64,
) -> Result<Split, ProgramError> {
    signer(judge)?;
    require(record.has_judge(), &BudgetHasNoJudge)?;
    require(judge.address() == &record.judge, &UnauthorisedSigner)?;
    require(slice.state == RESERVATION_DISPUTED, &ReservationNotDisputed)?;
    require(slot < slice.judge_ends(record), &BudgetJudgeWindowClosed)?;
    require(payout <= slice.final_amount(), &InvalidResolution)?;
    Ok(Split {
        paid: payout,
        reserved: slice.reserved(),
        outcome: BudgetOutcome::Resolved,
    })
}

/// After a reservation's money moved: an early payout while the budget is
/// open keeps the reservation as paid, so the same payee cannot reserve again
/// (B4); otherwise it closes, its rent to the payee. Returns whether the
/// budget is now finished (closed with nothing left to settle).
fn settle_reservation(
    record: &mut Budget,
    slice: &mut Reservation,
    reservation: &mut AccountView,
    payee: &mut AccountView,
) -> Result<bool, ProgramError> {
    record.unsettled = record.unsettled.saturating_sub(1);
    if record.closed() {
        close(reservation, payee)?;
    } else {
        slice.state = RESERVATION_PAID;
        slice.store(reservation)?;
    }
    Ok(record.closed() && record.unsettled == 0)
}

/// Close a reservation that was paid out early, once its budget is closed
/// or gone. Nothing moves but the reservation's rent, to the payee.
fn close_paid(
    program_id: &Address,
    budget: &AccountView,
    reservation: &mut AccountView,
    payee: &mut AccountView,
) -> ProgramResult {
    let slice = Reservation::load_checked(reservation, program_id)?;
    writable(reservation)?;
    writable(payee)?;
    require(budget.address() == &slice.budget, &InvalidReservation)?;
    require(payee.address() == &slice.payee, &ConstraintHasOne)?;
    // The same budget instance, still open, keeps the reservation (B4).
    if budget.owned_by(program_id) {
        if let Ok(record) = Budget::load_checked(budget, program_id) {
            require(
                record.closed() || record.created_slot() != slice.budget_created_slot(),
                &BudgetNotClosed,
            )?;
        }
    }
    close(reservation, payee)
}

/// Whether the reservation at `reservation` was paid out early.
fn is_paid(program_id: &Address, reservation: &AccountView) -> bool {
    Reservation::load(reservation, program_id).is_ok_and(|slice| slice.state == RESERVATION_PAID)
}

/// Shared by `payout_budget` and `resolve_budget`.
///
/// Accounts: `[w] budget`, `[w] reservation`, `[w] payee`, `[w] payer`,
/// `[w] treasury`, then for a resolve `[s] judge`.
fn settle_sol(
    program_id: &Address,
    accounts: &mut [AccountView],
    created_slot: u64,
    resolve: Option<u64>,
    paused: bool,
) -> ProgramResult {
    let [budget, reservation, payee, payer, treasury, rest @ ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    if resolve.is_none() && is_paid(program_id, reservation) {
        return close_paid(program_id, budget, reservation, payee);
    }
    let (slot, unix_timestamp) = now()?;
    let mut record = load_budget(program_id, budget, created_slot, slot)?;
    let mut slice = load_reservation(program_id, reservation, budget.address(), &record)?;
    require(record.sol(), &MintNotAllowed)?;
    writable(budget)?;
    writable(reservation)?;
    writable(payee)?;
    writable(payer)?;
    writable(treasury)?;
    require(payee.address() == &slice.payee, &ConstraintHasOne)?;
    require(payer.address() == &record.payer, &ConstraintHasOne)?;
    require(treasury.address() == &PROTOCOL_TREASURY, &InvalidTreasury)?;
    let split = match resolve {
        Some(payout) => {
            let Some(judge) = rest.first() else {
                return Err(fail(&AccountNotEnoughKeys));
            };
            resolve_split(&record, &slice, judge, payout, slot)?
        }
        None => payout_split(&record, &slice, slot)?,
    };

    // While the protocol is paused only a payout that sends the provider
    // nothing (a refund: unposted, judge timed out, a ruling of 0) goes ahead.
    require(!(paused && split.paid > 0), &ProtocolPaused)?;
    let fee = protocol_fee(split.paid, true, unix_timestamp);
    let to_payee = split.paid - fee;
    let refunded = split.reserved - split.paid;
    debit(budget, split.paid)?;
    credit(payee, to_payee)?;
    credit(treasury, fee)?;
    refund_sol(budget, payer, refunded)?;
    let finished = settle_reservation(&mut record, &mut slice, reservation, payee)?;
    if finished {
        close(budget, payer)?;
    } else {
        record.store(budget)?;
    }
    BudgetPaid {
        budget: budget.address(),
        payee: &slice.payee,
        paid: to_payee,
        fee,
        refunded,
        outcome: split.outcome,
        slot,
    }
    .emit();
    Ok(())
}

/// `payout_budget`: pay out a reservation of a SOL budget. Anyone may call;
/// the money goes only to the recorded payee, the treasury and the payer.
///
/// Accounts: `[w] budget`, `[w] reservation`, `[w] payee`, `[w] payer`,
/// `[w] treasury`. Data: `created_slot: u64`.
///
/// `paused`: the protocol is paused (or the caller did not pass the pause
/// account), so only a payout that sends the provider nothing goes ahead.
pub fn payout(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
    paused: bool,
) -> ProgramResult {
    settle_sol(program_id, accounts, Args(data).u64()?, None, paused)
}

/// `resolve_budget`: the judge splits a disputed reservation of a SOL budget.
///
/// Accounts: as `payout_budget`, then `[s] judge`.
/// Data: `created_slot: u64`, `payout: u64` (at most the posted amount).
/// `paused` as for `payout`: while paused only a ruling of 0 goes ahead.
pub fn resolve(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
    paused: bool,
) -> ProgramResult {
    let mut args = Args(data);
    let created_slot = args.u64()?;
    let payout = args.u64()?;
    settle_sol(program_id, accounts, created_slot, Some(payout), paused)
}

/// The token accounts every token-budget exit moves money through, checked.
struct Vault<'a> {
    vault: &'a AccountView,
    mint: &'a AccountView,
    token_program: &'a AccountView,
    decimals: u8,
    memo: Option<AccountView>,
    payer_key: Address,
    nonce: [u8; 16],
    bump: u8,
}

impl<'a> Vault<'a> {
    #[allow(clippy::too_many_arguments)]
    /// Check the vault, mint and token program of `record`, and that every
    /// target is a distinct, writable token account of the mint under that
    /// program, none of them the budget or the vault.
    fn check(
        program_id: &Address,
        budget_address: &Address,
        record: &Budget,
        vault: &'a AccountView,
        mint: &'a AccountView,
        token_program: &'a AccountView,
        targets: &[&AccountView],
        trailing: &[AccountView],
    ) -> Result<Self, ProgramError> {
        require(!record.sol(), &MintNotAllowed)?;
        require(mint.address() == &record.mint, &ConstraintHasOne)?;
        require(
            allowed_token_program(&record.mint) == Some(token_program.address())
                && mint.owned_by(token_program.address()),
            &InvalidProgramId,
        )?;
        let decimals = mint_decimals(mint)?;
        require(
            Address::create_program_address(
                &[
                    BUDGET_VAULT_SEED,
                    budget_address.as_ref(),
                    &[record.vault_bump],
                ],
                program_id,
            )
            .is_ok_and(|address| &address == vault.address()),
            &ConstraintSeeds,
        )?;
        writable(vault)?;
        let vault_account = TokenAccount::read(vault)?;
        require(
            vault_account.mint == record.mint
                && &vault_account.owner == budget_address
                && vault.owned_by(token_program.address()),
            &InvalidTokenAccount,
        )?;
        for (i, target) in targets.iter().enumerate() {
            writable(target)?;
            let account = TokenAccount::read(target)?;
            require(
                account.mint == record.mint && target.owned_by(token_program.address()),
                &InvalidTokenAccount,
            )?;
            let mut distinct =
                target.address() != budget_address && target.address() != vault.address();
            for earlier in targets.iter().take(i) {
                distinct &= target.address() != earlier.address();
            }
            require(distinct, &ConstraintDuplicateMutableAccount)?;
        }
        Ok(Self {
            vault,
            mint,
            token_program,
            decimals,
            memo: trailing
                .iter()
                .find(|account| account.address() == &MEMO_PROGRAM_ID)
                .cloned(),
            payer_key: record.payer,
            nonce: record.nonce,
            bump: record.bump,
        })
    }

    fn issuer_controlled(&self) -> bool {
        self.token_program.address() == &TOKEN_2022_ID
    }

    /// Send each `(account, units)` out of the vault in order, each capped at
    /// what the vault still holds (a Token-2022 issuer can shrink it), and
    /// return what each account received, measured (B8).
    fn send<const N: usize>(
        &self,
        budget: &AccountView,
        sends: [(&AccountView, u64); N],
    ) -> Result<[u64; N], ProgramError> {
        let bump = [self.bump];
        let seeds = [
            Seed::from(BUDGET_SEED),
            Seed::from(self.payer_key.as_ref()),
            Seed::from(&self.nonce),
            Seed::from(&bump),
        ];
        let signers = [Signer::from(&seeds)];
        let mut available = TokenAccount::read(self.vault)?.amount;
        if !self.issuer_controlled() {
            let wanted = sends
                .iter()
                .try_fold(0u64, |sum, (_, units)| sum.checked_add(*units));
            require(
                wanted.is_some_and(|wanted| wanted <= available),
                &InvalidTokenAmount,
            )?;
        }
        let mut received = [0u64; N];
        for (i, (to, units)) in sends.into_iter().enumerate() {
            let units = units.min(available);
            if units == 0 {
                continue;
            }
            let before = TokenAccount::read(to)?;
            if before.requires_memo {
                if let Some(memo) = &self.memo {
                    token::memo(memo)?;
                }
            }
            token::Transfer {
                token_program: self.token_program,
                from: self.vault,
                mint: self.mint,
                to,
                authority: budget,
                decimals: self.decimals,
            }
            .send(units, &signers)?;
            available -= units;
            received[i] = TokenAccount::read(to)?
                .amount
                .checked_sub(before.amount)
                .ok_or_else(|| fail(&InvalidTokenAmount))?;
            require(
                received[i] == units || (self.issuer_controlled() && received[i] <= units),
                &InvalidTokenAmount,
            )?;
        }
        Ok(received)
    }

    /// Send whatever is left to the payer's refund account, close the vault
    /// (harvesting withheld fees when the mint is writable) and the budget,
    /// rent to the payer. A vault still holding withheld fees stays open.
    fn finish(
        &self,
        budget: &mut AccountView,
        refund: &AccountView,
        payer: &mut AccountView,
    ) -> ProgramResult {
        let left = TokenAccount::read(self.vault)?.amount;
        self.send(budget, [(refund, left)])?;
        let bump = [self.bump];
        let seeds = [
            Seed::from(BUDGET_SEED),
            Seed::from(self.payer_key.as_ref()),
            Seed::from(&self.nonce),
            Seed::from(&bump),
        ];
        let signers = [Signer::from(&seeds)];
        let mut vault_after = TokenAccount::read(self.vault)?;
        if vault_after.withheld_fees != 0 && self.mint.is_writable() {
            token::harvest_withheld_fees(self.token_program, self.mint, self.vault)?;
            vault_after = TokenAccount::read(self.vault)?;
        }
        if vault_after.withheld_fees == 0 {
            token::close_account(self.token_program, self.vault, payer, budget, &signers)?;
        }
        close(budget, payer)
    }
}

/// Shared by `payout_token_budget` and `resolve_token_budget`.
///
/// Accounts: `[w] budget`, `[w] vault`, `[w] reservation`, `[w] payee`,
/// `[w] payer`, `[] mint`, `[w] payout_account` (the recorded one),
/// `[w] treasury_token` (owned by the protocol treasury), `[w] refund` (a
/// token account the payer owns), `[] token_program`, then for a resolve
/// `[s] judge`, then optionally the SPL Memo program.
fn settle_token(
    program_id: &Address,
    accounts: &mut [AccountView],
    created_slot: u64,
    resolve: Option<u64>,
    paused: bool,
) -> ProgramResult {
    let [budget, vault, reservation, payee, payer, mint, payout_account, treasury_token, refund, token_program, rest @ ..] =
        accounts
    else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    if resolve.is_none() && is_paid(program_id, reservation) {
        return close_paid(program_id, budget, reservation, payee);
    }
    let (slot, unix_timestamp) = now()?;
    let mut record = load_budget(program_id, budget, created_slot, slot)?;
    let mut slice = load_reservation(program_id, reservation, budget.address(), &record)?;
    writable(budget)?;
    writable(reservation)?;
    writable(payee)?;
    writable(payer)?;
    require(payee.address() == &slice.payee, &ConstraintHasOne)?;
    require(payer.address() == &record.payer, &ConstraintHasOne)?;
    let split = match resolve {
        Some(payout) => {
            let Some(judge) = rest.first() else {
                return Err(fail(&AccountNotEnoughKeys));
            };
            resolve_split(&record, &slice, judge, payout, slot)?
        }
        None => payout_split(&record, &slice, slot)?,
    };
    // As for a SOL budget: while paused, refunds only.
    require(!(paused && split.paid > 0), &ProtocolPaused)?;
    let fee = protocol_fee(split.paid, false, unix_timestamp);
    let to_payee = split.paid - fee;
    let refunded = split.reserved - split.paid;

    // Fixed destinations: the provider's recorded payout account or its
    // associated token account, the treasury and the payer (B9). An account
    // that receives nothing is not read, so a payout account the provider
    // closed or that was frozen cannot hold back a refund, and the provider
    // can still be paid into its associated account (B12).
    if payout_account.address() != &slice.payout_account {
        let token_program_id =
            allowed_token_program(&record.mint).ok_or_else(|| fail(&MintNotAllowed))?;
        let (associated, _) = derive(
            &[
                slice.payee.as_ref(),
                token_program_id.as_ref(),
                record.mint.as_ref(),
            ],
            &ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        require(
            payout_account.address() == &associated,
            &InvalidTokenAccount,
        )?;
    }
    // The payer's refund account is read only when it receives something:
    // this refund, or what the vault still holds when this payout finishes
    // the budget.
    let finishes = record.closed() && record.unsettled <= 1;
    let leftover = TokenAccount::read(vault)?
        .amount
        .saturating_sub(to_payee.saturating_add(fee).saturating_add(refunded));
    let pays_refund = refunded != 0 || (finishes && leftover != 0);
    let mut targets: [&AccountView; 3] = [&*refund; 3];
    let mut count = 0;
    if pays_refund {
        count += 1;
    }
    if to_payee != 0 {
        targets[count] = &*payout_account;
        count += 1;
    }
    if fee != 0 {
        targets[count] = &*treasury_token;
        count += 1;
    }
    let funds = Vault::check(
        program_id,
        budget.address(),
        &record,
        vault,
        mint,
        token_program,
        &targets[..count],
        rest,
    )?;
    if to_payee != 0 {
        let account = TokenAccount::read(payout_account)?;
        require(
            account.owner == slice.payee && !account.frozen,
            &InvalidTokenAccount,
        )?;
    }
    if fee != 0 {
        require(
            TokenAccount::read(treasury_token)?.owner == PROTOCOL_TREASURY,
            &InvalidTreasury,
        )?;
    }
    if pays_refund {
        require(
            &TokenAccount::read(refund)?.owner == payer.address(),
            &InvalidTokenAccount,
        )?;
    }
    // Payee first, then the fee, then the refund (D6).
    let [paid, fee_received, refund_received] = funds.send(
        budget,
        [
            (payout_account, to_payee),
            (treasury_token, fee),
            (refund, refunded),
        ],
    )?;
    let finished = settle_reservation(&mut record, &mut slice, reservation, payee)?;
    if finished {
        funds.finish(budget, refund, payer)?;
    } else {
        record.store(budget)?;
    }
    BudgetPaid {
        budget: budget.address(),
        payee: &slice.payee,
        paid,
        fee: fee_received,
        refunded: refund_received,
        outcome: split.outcome,
        slot,
    }
    .emit();
    Ok(())
}

/// `payout_token_budget`: pay out a reservation of a token budget. Anyone
/// may call. Accounts: see `settle_token`. Data: `created_slot: u64`.
pub fn payout_token(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
    paused: bool,
) -> ProgramResult {
    settle_token(program_id, accounts, Args(data).u64()?, None, paused)
}

/// `resolve_token_budget`: the judge splits a disputed reservation of a
/// token budget. Accounts: see `settle_token`, with the judge.
/// Data: `created_slot: u64`, `payout: u64`.
pub fn resolve_token(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
    paused: bool,
) -> ProgramResult {
    let mut args = Args(data);
    let created_slot = args.u64()?;
    let payout = args.u64()?;
    settle_token(program_id, accounts, created_slot, Some(payout), paused)
}

// ── Close ───────────────────────────────────────────────────────────────────

/// Who may close, and the budget after closing: the payer or the spender at
/// any time, anyone once the open period has ended. A P-256 spender closes
/// by approval, with the Instructions sysvar as `authority`; everyone else
/// signs. `expires_slot` is read after the call's `created_slot`.
fn begin_close(
    program_id: &Address,
    budget: &AccountView,
    authority: &AccountView,
    payer: &AccountView,
    created_slot: u64,
    expires_slot: Option<u64>,
    slot: u64,
) -> Result<Budget, ProgramError> {
    let mut record = load_budget(program_id, budget, created_slot, slot)?;
    writable(budget)?;
    writable(payer)?;
    let by_approval = authority.address() == &INSTRUCTIONS_ID;
    if !by_approval {
        signer(authority)?;
    }
    require(payer.address() == &record.payer, &ConstraintHasOne)?;
    require(!record.closed(), &BudgetAlreadyClosed)?;
    let by_payer = !by_approval && authority.address() == &record.payer;
    let approval = Approval {
        budget: budget.address(),
        created_slot,
        action: APPROVE_CLOSE,
        target: &ZERO,
        payout_account: &ZERO,
        amount: 0,
        expires_slot,
    };
    require(
        by_payer
            || spender_approves(program_id, &record, authority, &approval, slot)?
            || (!by_approval && slot >= record.open_ends()),
        &UnauthorisedSigner,
    )?;
    record.close_at(slot, by_payer);
    Ok(record)
}

/// Send a refund out of a SOL budget to the payer, unless that would leave
/// the payer's wallet below the rent-exempt minimum (an emptied wallet and a
/// refund under about 0.00089 SOL): then it stays in the budget account and
/// reaches the payer with the budget's rent when the budget closes, so an
/// empty payer wallet cannot hold back another party's payout.
fn refund_sol(budget: &mut AccountView, payer: &mut AccountView, lamports: u64) -> ProgramResult {
    if lamports == 0
        || payer.lamports().saturating_add(lamports) < rent_exempt_minimum(payer.data_len())?
    {
        return Ok(());
    }
    debit(budget, lamports)?;
    credit(payer, lamports)
}

/// `close_budget`: stop new reservations on a SOL budget and refund what was
/// never reserved. A budget with nothing left to settle closes outright.
///
/// Accounts: `[w] budget`, `[s] signer` (the Instructions sysvar for a
/// P-256 spender's approval), `[w] payer`.
/// Data: `created_slot: u64`, and for a P-256 spender `expires_slot: u64`.
pub fn close_budget(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let mut args = Args(data);
    let created_slot = args.u64()?;
    let expires_slot = args.u64().ok();
    let [budget, authority, payer, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let slot = now()?.0;
    let mut record = begin_close(
        program_id,
        budget,
        authority,
        payer,
        created_slot,
        expires_slot,
        slot,
    )?;
    require(record.sol(), &MintNotAllowed)?;
    let refunded = record.unreserved();
    refund_sol(budget, payer, refunded)?;
    record.set_unreserved(0);
    if record.unsettled == 0 {
        close(budget, payer)?;
    } else {
        record.store(budget)?;
    }
    BudgetClosed {
        budget: budget.address(),
        refunded,
        slot,
    }
    .emit();
    Ok(())
}

/// `close_token_budget`: as `close_budget`, for a token budget.
///
/// Accounts: `[w] budget`, `[w] vault`, `[s] signer` (the Instructions
/// sysvar for a P-256 spender's approval), `[w] payer`, `[] mint`,
/// `[w] refund` (a token account the payer owns), `[] token_program`, then
/// optionally the SPL Memo program.
/// Data: as `close_budget`.
pub fn close_token_budget(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let mut args = Args(data);
    let created_slot = args.u64()?;
    let expires_slot = args.u64().ok();
    let [budget, vault, authority, payer, mint, refund, token_program, rest @ ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let slot = now()?.0;
    let mut record = begin_close(
        program_id,
        budget,
        authority,
        payer,
        created_slot,
        expires_slot,
        slot,
    )?;
    let funds = Vault::check(
        program_id,
        budget.address(),
        &record,
        vault,
        mint,
        token_program,
        &[refund],
        rest,
    )?;
    require(
        &TokenAccount::read(refund)?.owner == payer.address(),
        &InvalidTokenAccount,
    )?;
    let [refunded] = funds.send(budget, [(refund, record.unreserved())])?;
    record.set_unreserved(0);
    if record.unsettled == 0 {
        funds.finish(budget, refund, payer)?;
    } else {
        record.store(budget)?;
    }
    BudgetClosed {
        budget: budget.address(),
        refunded,
        slot,
    }
    .emit();
    Ok(())
}
