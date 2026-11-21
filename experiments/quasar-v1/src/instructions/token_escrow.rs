use {
    super::outcome::*,
    crate::{
        constants::*,
        error::EscrowError,
        events::*,
        state::*,
        token::{self, allowed_mint},
    },
    quasar_lang::{cpi::Seed, prelude::*, sysvars::Sysvar as _},
    quasar_spl::{prelude::*, TOKEN_2022_ID},
};

#[derive(Accounts)]
#[instruction(amount: u64, nonce: [u8; 16])]
pub struct LockTokenEscrow {
    #[account(mut, init, payer = payer, address = TokenEscrowAccount::seeds(payer.address(), nonce))]
    pub escrow: Account<TokenEscrowAccount>,
    /// Fresh PDA. Allocated for the given token program and initialized below.
    #[account(mut, address = TokenVaultPda::seeds(escrow.address()))]
    pub vault: UncheckedAccount,
    #[account(mut)]
    pub payer: Signer,
    /// CHECK: Recorded recipient identity; the recipient token account is
    /// checked against it. May repeat the payer so the handler can refuse it by name.
    #[account(dup)]
    pub payee: UncheckedAccount,
    pub mint: InterfaceAccount<Mint>,
    #[account(mut)]
    pub source: InterfaceAccount<Token>,
    pub recipient: InterfaceAccount<Token>,
    pub token_program: Interface<TokenInterface>,
    pub system_program: Program<SystemProgram>,
}

impl LockTokenEscrow {
    #[inline(never)]
    pub fn lock(
        &mut self,
        amount: u64,
        nonce: [u8; 16],
        metered: bool,
        bumps: &LockTokenEscrowBumps,
    ) -> Result<(), ProgramError> {
        let token_program = self.token_program.address();
        let mint = self.mint.address();
        token::check_mint_layout(self.mint.to_account_view())?;
        token::check_token(
            self.source.to_account_view(),
            mint,
            self.source.mint(),
            token_program,
        )?;
        require!(
            self.source.owner() == self.payer.address(),
            EscrowError::InvalidTokenAccount
        );
        token::check_token(
            self.recipient.to_account_view(),
            mint,
            self.recipient.mint(),
            token_program,
        )?;
        require!(
            self.recipient.owner() == self.payee.address()
                && self.recipient.address() != self.vault.address(),
            EscrowError::InvalidTokenAccount
        );

        require!(amount > 0, EscrowError::ZeroAmount);
        // The mint must be allowlisted, be owned by the token program the
        // allowlist names for it, and be the program this instruction was given.
        let decimals = self.mint.decimals();
        require!(
            matches!(allowed_mint(mint), Some(allowed) if allowed.token_program == *token_program)
                && self.mint.to_account_view().owner() == token_program
                && decimals == ALLOWED_MINT_DECIMALS,
            EscrowError::MintNotAllowed
        );
        require!(
            amount <= MAX_TOKEN_ESCROW_BASE_UNITS,
            EscrowError::AmountAboveCap
        );
        require!(
            self.payee.address() != self.payer.address(),
            EscrowError::InvalidPayee
        );

        let vault = self.vault.to_account_view();
        token::create_vault(
            self.payer.to_account_view(),
            vault,
            token_program,
            self.escrow.address(),
            bumps.vault,
        )?;
        self.token_program
            .initialize_account3(&self.vault, &self.mint, self.escrow.address())
            .invoke()?;

        let source_before = self.source.amount();
        self.token_program
            .transfer_checked(
                &self.source,
                &self.mint,
                &self.vault,
                &self.payer,
                amount,
                decimals,
            )
            .invoke()?;
        // The vault must hold exactly the named amount. A Token-2022 mint
        // charging a transfer fee at lock time leaves less, and the lock is refused.
        require!(
            source_before.checked_sub(amount)
                == Some(token::amount_of(self.source.to_account_view())?)
                && token::amount_of(vault)? == amount,
            EscrowError::InvalidTokenAmount
        );

        let created_slot = Clock::get()?.slot.get();
        self.escrow.set_inner(TokenEscrowAccountInner {
            payer: *self.payer.address(),
            payee: *self.payee.address(),
            mint: *mint,
            source: *self.source.address(),
            recipient: *self.recipient.address(),
            amount,
            nonce,
            status: STATUS_LOCKED,
            created_slot,
            bump: bumps.escrow,
            metered,
        });
        emit!(EscrowLocked {
            escrow: *self.escrow.address(),
            payer: *self.payer.address(),
            payee: *self.payee.address(),
            mint: *mint,
            amount,
            nonce: u128::from_le_bytes(nonce),
            created_slot,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ReleaseTokenEscrow {
    #[account(
        mut,
        has_one(payer) @ EscrowError::UnauthorisedSigner,
        has_one(mint),
        constraints(escrow.status == STATUS_LOCKED) @ EscrowError::NotLocked,
        close(dest = payer),
        address = TokenEscrowAccount::seeds(payer.address(), escrow.nonce)
    )]
    pub escrow: Account<TokenEscrowAccount>,
    #[account(mut, address = TokenVaultPda::seeds(escrow.address()))]
    pub vault: InterfaceAccount<Token>,
    /// The payer (to release at any time) or the payee (to claim after the claim window).
    pub authority: Signer,
    /// CHECK: The recorded payer, bound by `has_one` and the escrow address.
    /// Receives the rent of both closed accounts; need not sign. Repeats
    /// `authority` when the payer itself signs.
    #[account(mut, dup)]
    pub payer: UncheckedAccount,
    pub mint: InterfaceAccount<Mint>,
    #[account(mut)]
    pub destination: InterfaceAccount<Token>,
    /// The protocol treasury's associated token account for the escrow mint.
    #[account(mut)]
    pub treasury_token: InterfaceAccount<Token>,
    /// Where anything above the paid amount returns: any token account of the
    /// mint that the payer owns.
    #[account(mut)]
    pub refund: InterfaceAccount<Token>,
    pub token_program: Interface<TokenInterface>,
}

impl ReleaseTokenEscrow {
    #[inline(never)]
    pub fn release(&mut self) -> Result<(), ProgramError> {
        self.check_accounts()?;
        let outcome = payout_outcome(
            self.authority.address(),
            &self.escrow.payer,
            &self.escrow.payee,
            self.escrow.created_slot.get(),
            Clock::get()?.slot.get(),
        )?;
        let amount = self.escrow.amount.get();
        self.pay_out(amount, outcome)
    }

    #[inline(never)]
    pub fn settle(&mut self, actual: u64) -> Result<(), ProgramError> {
        self.check_accounts()?;
        let authority = self.authority.address();
        require!(
            actual > 0 && actual <= self.escrow.amount.get(),
            EscrowError::InvalidSettleAmount
        );
        if *authority != self.escrow.payer {
            require!(
                *authority == self.escrow.payee,
                EscrowError::UnauthorisedSigner
            );
        }
        let outcome = settle_outcome(
            authority,
            &self.escrow.payer,
            self.escrow.amount.get(),
            self.escrow.metered.get(),
            actual,
        )?;
        self.pay_out(actual, outcome)
    }

    /// The account-level checks Anchor runs as constraints.
    #[inline(never)]
    fn check_accounts(&self) -> Result<(), ProgramError> {
        let token_program = self.token_program.address();
        let mint = self.mint.address();
        check_vault(
            self.vault.to_account_view(),
            self.vault.mint(),
            self.vault.owner(),
            self.escrow.address(),
            mint,
            self.mint.to_account_view(),
            token_program,
        )?;
        token::check_token(
            self.destination.to_account_view(),
            mint,
            self.destination.mint(),
            token_program,
        )?;
        token::check_token(
            self.treasury_token.to_account_view(),
            mint,
            self.treasury_token.mint(),
            token_program,
        )?;
        require!(
            *self.treasury_token.owner() == PROTOCOL_TREASURY,
            EscrowError::InvalidTreasury
        );
        token::check_token(
            self.refund.to_account_view(),
            mint,
            self.refund.mint(),
            token_program,
        )
    }

    /// Split the vault: `paid` less the fee to the payee's recorded recipient,
    /// the fee to the treasury, and everything else back to the payer. Closes
    /// the vault. Same rules as the Anchor `pay_out`, including the Token-2022
    /// allowances for issuer action.
    #[inline(never)]
    fn pay_out(&mut self, paid: u64, outcome: u64) -> Result<(), ProgramError> {
        let escrow = &self.escrow;
        let token_program = self.token_program.address();
        let issuer_controlled = *token_program == TOKEN_2022_ID;
        require!(
            *self.destination.address() == escrow.recipient
                && *self.destination.owner() == escrow.payee
                && *self.refund.owner() == escrow.payer,
            EscrowError::InvalidTokenAccount
        );
        require!(
            matches!(allowed_mint(&escrow.mint), Some(allowed)
                if allowed.token_program == *token_program
                    && allowed.treasury_token == *self.treasury_token.address()),
            EscrowError::InvalidTreasury
        );
        // Every destination is a different account, so each balance change
        // below measures one transfer.
        let vault_key = self.vault.address();
        let targets = [
            self.destination.to_account_view(),
            self.treasury_token.to_account_view(),
            self.refund.to_account_view(),
        ];
        for (i, target) in targets.iter().enumerate() {
            require!(
                target.address() != vault_key,
                EscrowError::InvalidTokenAccount
            );
            for other in targets.iter().skip(i + 1) {
                require!(
                    target.address() != other.address(),
                    EscrowError::InvalidTokenAccount
                );
            }
        }

        let locked = escrow.amount.get();
        let available = self.vault.amount();
        require!(
            issuer_controlled || available >= locked,
            EscrowError::InvalidTokenAmount
        );
        let fee = protocol_fee(paid, false);
        let to_payee = paid.checked_sub(fee).ok_or(EscrowError::Overflow)?;
        let payee_part = to_payee.min(available);
        let fee_part = fee.min(available.saturating_sub(payee_part));
        let refund_part = available
            .saturating_sub(payee_part)
            .saturating_sub(fee_part);

        let bump = [escrow.bump];
        let seeds = [
            Seed::from(b"token-escrow" as &[u8]),
            Seed::from(escrow.payer.as_ref()),
            Seed::from(escrow.nonce.as_ref()),
            Seed::from(bump.as_ref()),
        ];
        let decimals = self.mint.decimals();
        let sends = [payee_part, fee_part, refund_part];
        let mut before = [0u64; 3];
        for (slot, target) in before.iter_mut().zip(targets) {
            *slot = token::amount_of(target)?;
        }
        for (target, units) in targets.iter().zip(sends) {
            if units > 0 {
                self.token_program
                    .transfer_checked(
                        &self.vault,
                        &self.mint,
                        *target,
                        &self.escrow,
                        units,
                        decimals,
                    )
                    .invoke_signed(&seeds)?;
            }
        }
        let mut received = [0u64; 3];
        for (((slot, target), was), sent) in received.iter_mut().zip(targets).zip(before).zip(sends)
        {
            let got = token::amount_of(target)?
                .checked_sub(was)
                .ok_or(EscrowError::InvalidTokenAmount)?;
            require!(
                got == sent || (issuer_controlled && got <= sent),
                EscrowError::InvalidTokenAmount
            );
            *slot = got;
        }
        let [received_payee, received_fee, received_refund] = received;
        let vault = self.vault.to_account_view();
        require!(
            token::amount_of(vault)? == 0,
            EscrowError::InvalidTokenAmount
        );
        if token::withheld_fees(vault)? == 0 {
            self.token_program
                .close_account(&self.vault, &self.payer, &self.escrow)
                .invoke_signed(&seeds)?;
        }
        emit!(EscrowSettled {
            escrow: *self.escrow.address(),
            payer: escrow.payer,
            payee: escrow.payee,
            mint: escrow.mint,
            amount: received_payee,
            nonce: u128::from_le_bytes(escrow.nonce),
            outcome,
            slot: Clock::get()?.slot.get(),
            fee: received_fee,
            refunded: received_refund,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CancelTokenEscrow {
    #[account(
        mut,
        has_one(payer) @ EscrowError::UnauthorisedSigner,
        has_one(mint),
        constraints(escrow.status == STATUS_LOCKED) @ EscrowError::NotLocked,
        close(dest = payer),
        address = TokenEscrowAccount::seeds(payer.address(), escrow.nonce)
    )]
    pub escrow: Account<TokenEscrowAccount>,
    #[account(mut, address = TokenVaultPda::seeds(escrow.address()))]
    pub vault: InterfaceAccount<Token>,
    /// The payee (to decline at any time) or the payer (after the cancel window).
    pub authority: Signer,
    /// CHECK: The recorded payer, bound by `has_one` and the escrow address.
    /// Receives the rent of both closed accounts; need not sign. Repeats
    /// `authority` when the payer itself signs.
    #[account(mut, dup)]
    pub payer: UncheckedAccount,
    pub mint: InterfaceAccount<Mint>,
    /// The recorded source account, or, when the payer itself signs, any token
    /// account of the escrow mint that the payer owns.
    #[account(mut)]
    pub destination: InterfaceAccount<Token>,
    pub token_program: Interface<TokenInterface>,
}

impl CancelTokenEscrow {
    /// Refund the payer: move the whole vault (including any donated surplus)
    /// to the destination, close the vault, and record the outcome.
    #[inline(never)]
    pub fn cancel(&mut self) -> Result<(), ProgramError> {
        let escrow = &self.escrow;
        let token_program = self.token_program.address();
        let mint = self.mint.address();
        let vault = self.vault.to_account_view();
        let destination = self.destination.to_account_view();
        check_vault(
            vault,
            self.vault.mint(),
            self.vault.owner(),
            self.escrow.address(),
            mint,
            self.mint.to_account_view(),
            token_program,
        )?;
        token::check_token(destination, mint, self.destination.mint(), token_program)?;

        let outcome = refund_outcome(
            self.authority.address(),
            &escrow.payer,
            &escrow.payee,
            escrow.created_slot.get(),
            Clock::get()?.slot.get(),
        )?;
        require!(
            *self.destination.owner() == escrow.payer,
            EscrowError::InvalidTokenAccount
        );
        if *self.authority.address() != escrow.payer {
            require!(
                *self.destination.address() == escrow.source,
                EscrowError::InvalidTokenAccount
            );
        }

        let issuer_controlled = *token_program == TOKEN_2022_ID;
        require!(
            destination.address() != vault.address(),
            EscrowError::InvalidTokenAccount
        );
        let payout = self.vault.amount();
        require!(
            issuer_controlled || payout >= escrow.amount.get(),
            EscrowError::InvalidTokenAmount
        );

        let bump = [escrow.bump];
        let seeds = [
            Seed::from(b"token-escrow" as &[u8]),
            Seed::from(escrow.payer.as_ref()),
            Seed::from(escrow.nonce.as_ref()),
            Seed::from(bump.as_ref()),
        ];
        let destination_before = self.destination.amount();
        if payout > 0 {
            self.token_program
                .transfer_checked(
                    &self.vault,
                    &self.mint,
                    &self.destination,
                    &self.escrow,
                    payout,
                    self.mint.decimals(),
                )
                .invoke_signed(&seeds)?;
        }
        let received = token::amount_of(destination)?
            .checked_sub(destination_before)
            .ok_or(EscrowError::InvalidTokenAmount)?;
        require!(
            token::amount_of(vault)? == 0
                && (received == payout || (issuer_controlled && received <= payout)),
            EscrowError::InvalidTokenAmount
        );
        if token::withheld_fees(vault)? == 0 {
            self.token_program
                .close_account(&self.vault, &self.payer, &self.escrow)
                .invoke_signed(&seeds)?;
        }
        emit!(EscrowSettled {
            escrow: *self.escrow.address(),
            payer: escrow.payer,
            payee: escrow.payee,
            mint: escrow.mint,
            amount: received,
            nonce: u128::from_le_bytes(escrow.nonce),
            outcome,
            slot: Clock::get()?.slot.get(),
            fee: 0,
            refunded: 0,
        });
        Ok(())
    }
}

/// The vault is the escrow's token account of the escrow mint, under the given
/// token program, and the mint is owned by that program.
fn check_vault(
    vault: &AccountView,
    vault_mint: &Address,
    vault_owner: &Address,
    escrow: &Address,
    mint: &Address,
    mint_view: &AccountView,
    token_program: &Address,
) -> Result<(), ProgramError> {
    token::check_mint_layout(mint_view)?;
    token::check_account_layout(vault)?;
    require!(
        vault_mint == mint
            && vault_owner == escrow
            && vault.owner() == token_program
            && mint_view.owner() == token_program,
        EscrowError::InvalidTokenAccount
    );
    Ok(())
}
