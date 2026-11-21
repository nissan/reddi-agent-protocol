use {
    super::outcome::*,
    crate::{
        constants::*,
        error::EscrowError,
        events::*,
        state::*,
    },
    quasar_lang::{prelude::*, sysvars::Sysvar as _},
};

#[derive(Accounts)]
#[instruction(amount: u64, nonce: [u8; 16])]
pub struct LockEscrow {
    #[account(mut, init, payer = payer, address = EscrowAccount::seeds(payer.address(), nonce))]
    pub escrow: Account<EscrowAccount>,
    #[account(mut)]
    pub payer: Signer,
    /// CHECK: Recipient address only; validated off-chain via the x402 header.
    /// May repeat the payer or the escrow so the handler can refuse it by name.
    #[account(dup)]
    pub payee: UncheckedAccount,
    pub system_program: Program<SystemProgram>,
}

impl LockEscrow {
    #[inline(never)]
    pub fn lock(
        &mut self,
        amount: u64,
        nonce: [u8; 16],
        metered: bool,
        bumps: &LockEscrowBumps,
    ) -> Result<(), ProgramError> {
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(
            amount <= MAX_SOL_ESCROW_LAMPORTS,
            EscrowError::AmountAboveCap
        );
        // A payer paying themselves, or the escrow account itself, is never a real job.
        require!(
            self.payee.address() != self.payer.address(),
            EscrowError::InvalidPayee
        );
        require!(
            self.payee.address() != self.escrow.address(),
            EscrowError::InvalidPayee
        );

        let clock = Clock::get()?;
        let created_slot = clock.slot.get();
        self.escrow.set_inner(EscrowAccountInner {
            payer: *self.payer.address(),
            payee: *self.payee.address(),
            amount,
            nonce,
            status: STATUS_LOCKED,
            created_at: clock.unix_timestamp.get(),
            created_slot,
            delegated_to_per: false,
            per_session_key: Address::default(),
            bump: bumps.escrow,
            metered,
        });

        self.system_program
            .transfer(&self.payer, &self.escrow, amount)
            .invoke()?;

        emit!(EscrowLocked {
            escrow: *self.escrow.address(),
            payer: *self.payer.address(),
            payee: *self.payee.address(),
            mint: Address::default(),
            amount,
            nonce: u128::from_le_bytes(nonce),
            created_slot,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ReleaseEscrow {
    #[account(
        mut,
        has_one(payer) @ EscrowError::UnauthorisedSigner,
        has_one(payee),
        close(dest = payer),
        address = EscrowAccount::seeds(payer.address(), escrow.nonce)
    )]
    pub escrow: Account<EscrowAccount>,
    /// The recorded payer. Receives the rent. Signs to release.
    #[account(mut)]
    pub payer: UncheckedAccount,
    /// The recorded payee. Signs to claim after the claim window.
    #[account(mut)]
    pub payee: UncheckedAccount,
    /// CHECK: Fixed by address. The treasury may itself be the payer or payee.
    #[account(mut, dup, address = PROTOCOL_TREASURY @ EscrowError::InvalidTreasury)]
    pub treasury: UncheckedAccount,
    pub system_program: Program<SystemProgram>,
}

impl ReleaseEscrow {
    /// Whichever of payer and payee signed; the payer is preferred when both did.
    #[inline(always)]
    fn signing_party(&self) -> Result<&Address, ProgramError> {
        if self.payer.to_account_view().is_signer() {
            Ok(self.payer.address())
        } else if self.payee.to_account_view().is_signer() {
            Ok(self.payee.address())
        } else {
            Err(EscrowError::UnauthorisedSigner.into())
        }
    }

    #[inline(never)]
    pub fn release(&mut self) -> Result<(), ProgramError> {
        let authority = self.signing_party()?;
        let outcome = payout_outcome(
            authority,
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
        let authority = self.signing_party()?;
        let outcome = settle_outcome(
            authority,
            &self.escrow.payer,
            self.escrow.amount.get(),
            self.escrow.metered.get(),
            actual,
        )?;
        self.pay_out(actual, outcome)
    }

    /// Move `paid` lamports out of the escrow: the fee to the treasury and the
    /// rest to the payee. The account closes to the payer afterwards, which
    /// returns rent and any unused amount.
    #[inline(never)]
    fn pay_out(&mut self, paid: u64, outcome: u64) -> Result<(), ProgramError> {
        require!(
            self.escrow.status == STATUS_LOCKED,
            EscrowError::NotLocked
        );
        let fee = protocol_fee(paid, true);
        let to_payee = paid.checked_sub(fee).ok_or(EscrowError::Overflow)?;
        let refunded = self
            .escrow
            .amount
            .get()
            .checked_sub(paid)
            .ok_or(EscrowError::Overflow)?;

        let escrow = self.escrow.to_account_view();
        let payee = self.payee.to_account_view();
        let treasury = self.treasury.to_account_view();
        set_lamports(
            escrow,
            escrow
                .lamports()
                .checked_sub(paid)
                .ok_or(ProgramError::InsufficientFunds)?,
        );
        set_lamports(
            payee,
            payee
                .lamports()
                .checked_add(to_payee)
                .ok_or(ProgramError::ArithmeticOverflow)?,
        );
        set_lamports(
            treasury,
            treasury
                .lamports()
                .checked_add(fee)
                .ok_or(ProgramError::ArithmeticOverflow)?,
        );

        self.escrow.status = STATUS_RELEASED;

        emit!(EscrowSettled {
            escrow: *self.escrow.address(),
            payer: *self.payer.address(),
            payee: *self.payee.address(),
            mint: Address::default(),
            amount: to_payee,
            nonce: u128::from_le_bytes(self.escrow.nonce),
            outcome,
            slot: Clock::get()?.slot.get(),
            fee,
            refunded,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CancelEscrow {
    #[account(
        mut,
        has_one(payer) @ EscrowError::UnauthorisedSigner,
        close(dest = payer),
        address = EscrowAccount::seeds(payer.address(), escrow.nonce)
    )]
    pub escrow: Account<EscrowAccount>,
    /// The payee (to decline at any time) or the payer (after the cancel window).
    pub authority: Signer,
    /// CHECK: The recorded payer, bound by `has_one` and the escrow address.
    /// Receives the refund and the rent; need not sign. Repeats `authority`
    /// when the payer refunds itself.
    #[account(mut, dup)]
    pub payer: UncheckedAccount,
    pub system_program: Program<SystemProgram>,
}

impl CancelEscrow {
    #[inline(never)]
    pub fn cancel(&mut self) -> Result<(), ProgramError> {
        require!(
            self.escrow.status == STATUS_LOCKED,
            EscrowError::NotLocked
        );
        let slot = Clock::get()?.slot.get();
        let outcome = refund_outcome(
            self.authority.address(),
            &self.escrow.payer,
            &self.escrow.payee,
            self.escrow.created_slot.get(),
            slot,
        )?;
        let amount = self.escrow.amount.get();

        let escrow = self.escrow.to_account_view();
        let payer = self.payer.to_account_view();
        set_lamports(
            escrow,
            escrow
                .lamports()
                .checked_sub(amount)
                .ok_or(ProgramError::InsufficientFunds)?,
        );
        set_lamports(
            payer,
            payer
                .lamports()
                .checked_add(amount)
                .ok_or(ProgramError::ArithmeticOverflow)?,
        );

        self.escrow.status = STATUS_CANCELLED;

        emit!(EscrowSettled {
            escrow: *self.escrow.address(),
            payer: *self.payer.address(),
            payee: self.escrow.payee,
            mint: Address::default(),
            amount,
            nonce: u128::from_le_bytes(self.escrow.nonce),
            outcome,
            slot,
            fee: 0,
            refunded: 0,
        });
        Ok(())
    }
}
