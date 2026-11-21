//! Token escrow for the allowlisted stablecoins: lock, release / claim, settle
//! at actual cost, refund.
//!
//! Each escrow has a record (`["token-escrow", payer, nonce]`) and a vault
//! token account (`["token-vault", escrow]`) whose authority is the record.
//! Settling empties and closes the vault and closes the record, returning
//! both rents to the payer.
use {
    crate::{
        checks::{
            close, create_pda, derive, now, payout_outcome, program, refund_outcome, signer,
            writable, Args,
        },
        consts::{
            allowed_token_program, protocol_fee, ALLOWED_MINT_DECIMALS,
            ASSOCIATED_TOKEN_PROGRAM_ID, MAX_TOKEN_ESCROW_BASE_UNITS, PROTOCOL_TREASURY,
            SYSTEM_PROGRAM_ID, TOKEN_2022_ID, TOKEN_ESCROW_SEED, TOKEN_VAULT_SEED,
        },
        error::{
            fail, require, AccountNotEnoughKeys, AmountAboveCap, ConstraintDuplicateMutableAccount,
            ConstraintHasOne, ConstraintSeeds, InvalidPayee, InvalidProgramId, InvalidSettleAmount,
            InvalidTokenAccount, InvalidTokenAmount, InvalidTreasury, MintNotAllowed, NotLocked,
            NotMetered, UnauthorisedSigner, ZeroAmount,
        },
        events::{Locked, Outcome, Settled},
        state::{Record, TokenEscrow, STATUS_LOCKED},
        token::{self, is_token_program, mint_decimals, vault_len, TokenAccount},
    },
    pinocchio::{
        cpi::{Seed, Signer},
        error::ProgramError,
        AccountView, Address, ProgramResult,
    },
    pinocchio_token::instructions::InitializeAccount3,
};

/// `lock_token_escrow` / `lock_metered_token_escrow`.
///
/// Accounts: `[w] escrow`, `[w] vault`, `[w, s] payer`, `[] payee`, `[] mint`,
/// `[w] source` (payer's token account), `[] recipient` (payee's token
/// account), `[] token_program`, `[] system_program`.
/// Data: `amount: u64`, `nonce: [u8; 16]`.
pub fn lock(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
    metered: bool,
) -> ProgramResult {
    let mut args = Args(data);
    let amount = args.u64()?;
    let nonce: [u8; 16] = args.array()?;
    let [escrow, vault, payer, payee, mint, source, recipient, token_program, system_program, ..] =
        accounts
    else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    signer(payer)?;
    let decimals = mint_decimals(mint)?;
    let source_before = TokenAccount::read(source)?;
    let recipient_account = TokenAccount::read(recipient)?;
    require(is_token_program(token_program.address()), &InvalidProgramId)?;
    program(system_program, &SYSTEM_PROGRAM_ID)?;
    let token_program_id = token_program.address();

    // The record, at the address derived from (payer, nonce).
    let (address, bump) = derive(
        &[TOKEN_ESCROW_SEED, payer.address().as_ref(), &nonce],
        program_id,
    );
    require(escrow.address() == &address, &ConstraintSeeds)?;
    let bump = [bump];
    let seeds = [
        Seed::from(TOKEN_ESCROW_SEED),
        Seed::from(payer.address().as_ref()),
        Seed::from(&nonce),
        Seed::from(&bump),
    ];
    create_pda(
        payer,
        escrow,
        TokenEscrow::LEN,
        program_id,
        &Signer::from(&seeds),
    )?;

    // The vault, at the address derived from the record, sized for and owned
    // by the token program given. It is initialised as a token account below.
    let (vault_address, vault_bump) =
        derive(&[TOKEN_VAULT_SEED, escrow.address().as_ref()], program_id);
    require(vault.address() == &vault_address, &ConstraintSeeds)?;
    let vault_bump = [vault_bump];
    let vault_seeds = [
        Seed::from(TOKEN_VAULT_SEED),
        Seed::from(escrow.address().as_ref()),
        Seed::from(&vault_bump),
    ];
    create_pda(
        payer,
        vault,
        vault_len(token_program_id),
        token_program_id,
        &Signer::from(&vault_seeds),
    )?;

    writable(payer)?;
    writable(source)?;
    require(
        &source_before.mint == mint.address()
            && &source_before.owner == payer.address()
            && source.owned_by(token_program_id),
        &InvalidTokenAccount,
    )?;
    require(
        &recipient_account.mint == mint.address()
            && &recipient_account.owner == payee.address()
            && recipient.owned_by(token_program_id),
        &InvalidTokenAccount,
    )?;
    require(recipient.address() != vault.address(), &InvalidTokenAccount)?;

    require(amount > 0, &ZeroAmount)?;
    // The mint must be allowlisted, be owned by the token program the allowlist
    // names for it, and that must be the program this instruction was given.
    require(
        allowed_token_program(mint.address()) == Some(token_program_id)
            && mint.owned_by(token_program_id)
            && decimals == ALLOWED_MINT_DECIMALS,
        &MintNotAllowed,
    )?;
    require(amount <= MAX_TOKEN_ESCROW_BASE_UNITS, &AmountAboveCap)?;
    require(payee.address() != payer.address(), &InvalidPayee)?;
    // Tokens paid to an account owned by the escrow or its vault could never
    // be moved again: this program signs for neither as a recipient's owner.
    require(
        payee.address() != escrow.address() && payee.address() != vault.address(),
        &InvalidPayee,
    )?;

    InitializeAccount3::new(vault, mint, escrow.address())
        .invoke_with_unverified_program(token_program_id)?;
    token::Transfer {
        token_program,
        from: source,
        mint,
        to: vault,
        authority: payer,
        decimals,
    }
    .send(amount, &[])?;
    // The vault must hold exactly the named amount. A Token-2022 mint charging a
    // transfer fee at lock time leaves less than that, and the lock is refused.
    require(
        source_before.amount.checked_sub(amount) == Some(TokenAccount::read(source)?.amount)
            && TokenAccount::read(vault)?.amount == amount,
        &InvalidTokenAmount,
    )?;

    let created_slot = now()?.0;
    TokenEscrow::new(
        payer.address(),
        payee.address(),
        mint.address(),
        source.address(),
        recipient.address(),
        amount,
        nonce,
        created_slot,
        bump[0],
        metered,
    )
    .store(escrow)?;
    Locked {
        escrow: escrow.address(),
        payer: payer.address(),
        payee: payee.address(),
        mint: Some(mint.address()),
        amount,
        nonce: &nonce,
        created_slot,
    }
    .emit();
    Ok(())
}

/// The accounts every settlement of a token escrow starts from, checked.
struct Open<'a> {
    record: TokenEscrow,
    escrow: &'a mut AccountView,
    vault: &'a AccountView,
    payer: &'a mut AccountView,
    mint: &'a AccountView,
    token_program: &'a AccountView,
    decimals: u8,
    /// Balance of the vault before anything moves.
    available: u64,
}

impl<'a> Open<'a> {
    /// Validate the escrow, its vault and the `N` token accounts the vault
    /// will be paid into, and return those accounts' contents.
    ///
    /// Every target must be a writable token account of the escrow mint under
    /// the escrow's token program, and no two of record, vault and targets may
    /// be the same account. Who must own each target differs between a payout
    /// and a refund and is the caller's check, except that the target at
    /// `treasury` (if any) must belong to the protocol treasury.
    #[allow(clippy::too_many_arguments)]
    #[inline(always)]
    fn check<const N: usize>(
        program_id: &Address,
        escrow: &'a mut AccountView,
        vault: &'a AccountView,
        authority: &'a AccountView,
        payer: &'a mut AccountView,
        mint: &'a AccountView,
        token_program: &'a AccountView,
        targets: [&AccountView; N],
        treasury: Option<usize>,
    ) -> Result<(Self, [TokenAccount; N]), ProgramError> {
        let mut target_accounts = [TokenAccount::EMPTY; N];
        let open = Self::check_all(
            program_id,
            escrow,
            vault,
            authority,
            payer,
            mint,
            token_program,
            &targets,
            &mut target_accounts,
            treasury,
        )?;
        Ok((open, target_accounts))
    }

    /// `check`, with the targets and their contents as slices of equal length.
    #[allow(clippy::too_many_arguments)]
    #[inline(never)]
    fn check_all(
        program_id: &Address,
        escrow: &'a mut AccountView,
        vault: &'a AccountView,
        authority: &'a AccountView,
        payer: &'a mut AccountView,
        mint: &'a AccountView,
        token_program: &'a AccountView,
        targets: &[&AccountView],
        target_accounts: &mut [TokenAccount],
        treasury: Option<usize>,
    ) -> Result<Self, ProgramError> {
        // What each account is.
        let record = TokenEscrow::load_checked(escrow, program_id)?;
        let vault_account = TokenAccount::read(vault)?;
        signer(authority)?;
        let decimals = mint_decimals(mint)?;
        for (account, target) in target_accounts.iter_mut().zip(targets) {
            *account = TokenAccount::read(target)?;
        }
        require(is_token_program(token_program.address()), &InvalidProgramId)?;

        // Each balance change below must measure one transfer, so the same
        // account may not appear twice.
        require(
            escrow.address() != vault.address(),
            &ConstraintDuplicateMutableAccount,
        )?;
        for (i, target) in targets.iter().enumerate() {
            let mut distinct =
                target.address() != escrow.address() && target.address() != vault.address();
            for earlier in targets.iter().take(i) {
                distinct &= target.address() != earlier.address();
            }
            require(distinct, &ConstraintDuplicateMutableAccount)?;
        }

        // The record address commits to its payer.
        require(payer.address() == &record.payer, &ConstraintSeeds)?;
        writable(escrow)?;
        require(mint.address() == &record.mint, &ConstraintHasOne)?;
        require(record.status == STATUS_LOCKED, &NotLocked)?;
        // Only the vault derived from this record may be settled, never
        // another token account that happens to name the record as its owner.
        let (vault_address, _) = derive(&[TOKEN_VAULT_SEED, escrow.address().as_ref()], program_id);
        require(vault.address() == &vault_address, &ConstraintSeeds)?;
        writable(vault)?;
        require(
            &vault_account.mint == mint.address()
                && &vault_account.owner == escrow.address()
                && vault.owned_by(token_program.address()),
            &InvalidTokenAccount,
        )?;
        writable(payer)?;
        require(mint.owned_by(token_program.address()), &InvalidTokenAccount)?;
        for (i, (target, account)) in targets.iter().zip(target_accounts.iter()).enumerate() {
            writable(target)?;
            require(
                &account.mint == mint.address() && target.owned_by(token_program.address()),
                &InvalidTokenAccount,
            )?;
            if treasury == Some(i) {
                require(account.owner == PROTOCOL_TREASURY, &InvalidTreasury)?;
            }
        }
        Ok(Self {
            record,
            escrow,
            vault,
            payer,
            mint,
            token_program,
            decimals,
            available: vault_account.amount,
        })
    }

    fn issuer_controlled(&self) -> bool {
        self.token_program.address() == &TOKEN_2022_ID
    }

    /// Send each `(account, balance before, units)` out of the vault, close
    /// the vault and the record, and return what each account received.
    ///
    /// Classic SPL Token: every destination must receive exactly what is sent.
    /// Token-2022: the issuer can switch on a transfer fee, so a destination
    /// may receive less than was sent, and fees withheld on the vault leave it
    /// open instead of failing the settlement.
    fn drain<const N: usize>(
        self,
        sends: [(&AccountView, u64, u64); N],
    ) -> Result<[u64; N], ProgramError> {
        let issuer_controlled = self.issuer_controlled();
        let bump = [self.record.bump];
        let seeds = [
            Seed::from(TOKEN_ESCROW_SEED),
            Seed::from(self.record.payer.as_ref()),
            Seed::from(&self.record.nonce),
            Seed::from(&bump),
        ];
        let signers = [Signer::from(&seeds)];
        let transfer = |to| token::Transfer {
            token_program: self.token_program,
            from: self.vault,
            mint: self.mint,
            to,
            authority: self.escrow,
            decimals: self.decimals,
        };
        for (to, _, units) in sends {
            if units > 0 {
                transfer(to).send(units, &signers)?;
            }
        }
        let mut received = [0u64; N];
        for (i, (to, before, units)) in sends.into_iter().enumerate() {
            received[i] = TokenAccount::read(to)?
                .amount
                .checked_sub(before)
                .ok_or_else(|| fail(&InvalidTokenAmount))?;
            require(
                received[i] == units || (issuer_controlled && received[i] <= units),
                &InvalidTokenAmount,
            )?;
        }
        let vault_after = TokenAccount::read(self.vault)?;
        require(vault_after.amount == 0, &InvalidTokenAmount)?;
        if vault_after.withheld_fees == 0 {
            token::close_account(
                self.token_program,
                self.vault,
                self.payer,
                self.escrow,
                &signers,
            )?;
        }
        close(self.escrow, self.payer)?;
        Ok(received)
    }
}

/// `release_token_escrow` (`actual` is `None`) and `settle_token_escrow`.
///
/// Accounts: `[w] escrow`, `[w] vault`, `[s] authority`, `[w] payer`,
/// `[] mint`, `[w] destination` (the recipient recorded at lock),
/// `[w] treasury_token` (the treasury's associated token account for the
/// mint), `[w] refund` (any token account of the mint the payer owns),
/// `[] token_program`.
///
/// The rules for who may release, claim or settle are the SOL escrow's. The
/// vault is split: the paid amount less the fee to the recipient, the fee to
/// the treasury, and everything else (the unused part of the locked amount and
/// any donation) back to the payer.
///
/// Classic SPL Token: the vault can only grow, so it must still hold at least
/// the locked amount. Token-2022: the issuer can shrink the vault, so the
/// payee is paid first from what is there, then the fee, then the refund.
pub fn pay_out(
    program_id: &Address,
    accounts: &mut [AccountView],
    actual: Option<u64>,
) -> ProgramResult {
    let [escrow, vault, authority, payer, mint, destination, treasury_token, refund, token_program, ..] =
        accounts
    else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let (open, [destination_account, treasury_account, refund_account]) = Open::check(
        program_id,
        escrow,
        vault,
        authority,
        payer,
        mint,
        token_program,
        [destination, treasury_token, refund],
        Some(1),
    )?;
    let record = &open.record;

    let slot = now()?.0;
    let by_payer = authority.address() == &record.payer;
    let (paid, outcome) = match actual {
        None => (
            record.amount(),
            payout_outcome(
                authority.address(),
                &record.payer,
                &record.payee,
                record.created_slot(),
                slot,
            )?,
        ),
        Some(actual) => {
            require(
                actual > 0 && actual <= record.amount(),
                &InvalidSettleAmount,
            )?;
            if !by_payer {
                require(authority.address() == &record.payee, &UnauthorisedSigner)?;
                require(record.metered(), &NotMetered)?;
            }
            if by_payer && actual == record.amount() {
                (actual, Outcome::Released)
            } else {
                (actual, Outcome::SettledActual)
            }
        }
    };

    require(
        destination.address() == &record.recipient,
        &InvalidTokenAccount,
    )?;
    require(
        destination_account.owner == record.payee,
        &InvalidTokenAccount,
    )?;
    // The fee goes only to the treasury's associated token account, so it
    // lands where the Squads vault shows it.
    let (treasury_address, _) = derive(
        &[
            PROTOCOL_TREASURY.as_ref(),
            token_program.address().as_ref(),
            record.mint.as_ref(),
        ],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    require(
        treasury_token.address() == &treasury_address,
        &InvalidTreasury,
    )?;
    let available = open.available;
    require(
        open.issuer_controlled() || available >= record.amount(),
        &InvalidTokenAmount,
    )?;
    let fee = protocol_fee(paid, false);
    let payee_part = (paid - fee).min(available);
    let fee_part = fee.min(available - payee_part);
    let refund_part = available - payee_part - fee_part;
    // When something goes back to the payer it must go to a token account of
    // the mint the payer owns. Not only the recorded source: the payer may
    // close or re-own that after locking, and the payee must still be able to
    // settle. When nothing goes back the refund account receives nothing, so
    // its owner is not checked and a payer cannot hold up a full payout by
    // closing or restricting its own token accounts.
    require(
        refund_part == 0 || refund_account.owner == record.payer,
        &InvalidTokenAccount,
    )?;

    let (payer_key, payee_key, mint_key, nonce) =
        (record.payer, record.payee, record.mint, record.nonce);
    let escrow_key = *open.escrow.address();
    let received = open.drain([
        (destination, destination_account.amount, payee_part),
        (treasury_token, treasury_account.amount, fee_part),
        (refund, refund_account.amount, refund_part),
    ])?;
    Settled {
        escrow: &escrow_key,
        payer: &payer_key,
        payee: &payee_key,
        mint: Some(&mint_key),
        amount: received[0],
        nonce: &nonce,
        outcome,
        slot,
        fee: received[1],
        refunded: received[2],
    }
    .emit();
    Ok(())
}

/// `cancel_token_escrow`: refund the payer the whole vault and close it.
///
/// Accounts: `[w] escrow`, `[w] vault`, `[s] authority`, `[w] payer`,
/// `[] mint`, `[w] destination`, `[] token_program`.
///
/// The payee may decline at any time; the payer may refund itself after the
/// cancel window. A payee's decline goes to the source token account recorded
/// at lock. The payer may name any token account of the escrow mint that it
/// owns, so a closed or re-owned source cannot strand its refund.
///
/// Anyone can donate tokens to a vault; the whole balance is swept to the
/// payer so a donation cannot block closing or strand funds. Under Token-2022
/// the issuer can also shrink the vault, and the refund is whatever it holds.
pub fn cancel(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [escrow, vault, authority, payer, mint, destination, token_program, ..] = accounts else {
        return Err(fail(&AccountNotEnoughKeys));
    };
    let (open, [destination_account]) = Open::check(
        program_id,
        escrow,
        vault,
        authority,
        payer,
        mint,
        token_program,
        [destination],
        None,
    )?;
    let record = &open.record;

    let slot = now()?.0;
    let outcome = refund_outcome(
        authority.address(),
        &record.payer,
        &record.payee,
        record.created_slot(),
        slot,
    )?;
    require(
        destination_account.owner == record.payer,
        &InvalidTokenAccount,
    )?;
    if authority.address() != &record.payer {
        require(
            destination.address() == &record.source,
            &InvalidTokenAccount,
        )?;
    }
    require(
        destination.address() != vault.address(),
        &InvalidTokenAccount,
    )?;
    let available = open.available;
    require(
        open.issuer_controlled() || available >= record.amount(),
        &InvalidTokenAmount,
    )?;

    let (payer_key, payee_key, mint_key, nonce) =
        (record.payer, record.payee, record.mint, record.nonce);
    let escrow_key = *open.escrow.address();
    let [received] = open.drain([(destination, destination_account.amount, available)])?;
    Settled {
        escrow: &escrow_key,
        payer: &payer_key,
        payee: &payee_key,
        mint: Some(&mint_key),
        amount: received,
        nonce: &nonce,
        outcome,
        slot,
        fee: 0,
        refunded: 0,
    }
    .emit();
    Ok(())
}
