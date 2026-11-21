use anchor_lang::prelude::*;

use crate::{
    constants::{
        allowed_token_program, protocol_fee, treasury_token_address, ALLOWED_MINT_DECIMALS,
        MAX_TOKEN_ESCROW_BASE_UNITS, PROTOCOL_TREASURY, TOKEN_ESCROW_SEED, TOKEN_VAULT_SEED,
    },
    error::EscrowError,
    events::{EscrowLocked, EscrowSettled, SettlementOutcome},
    instructions::cancel_escrow::{payout_outcome, refund_outcome},
    state::{EscrowStatus, TokenEscrowAccount},
    token_accounts::{
        self as token, vault_len, Mint, TokenAccount, TokenPrograms, Transfer, TOKEN_2022_ID,
    },
};

pub fn lock_token_escrow_handler(
    ctx: Context<LockTokenEscrow>,
    amount: u64,
    nonce: [u8; 16],
    metered: bool,
) -> Result<()> {
    require!(amount > 0, EscrowError::ZeroAmount);
    // The mint must be allowlisted, be owned by the token program the allowlist
    // names for it, and be the program this instruction was given.
    let token_program = ctx.accounts.token_program.key();
    require!(
        allowed_token_program(&ctx.accounts.mint.key()) == Some(token_program)
            && *ctx.accounts.mint.to_account_info().owner == token_program
            && ctx.accounts.mint.decimals == ALLOWED_MINT_DECIMALS,
        EscrowError::MintNotAllowed
    );
    require!(
        amount <= MAX_TOKEN_ESCROW_BASE_UNITS,
        EscrowError::AmountAboveCap
    );
    require_keys_neq!(
        ctx.accounts.payee.key(),
        ctx.accounts.payer.key(),
        EscrowError::InvalidPayee
    );
    // Tokens paid to an account owned by the escrow or its vault could never
    // be moved again.
    require!(
        ctx.accounts.payee.key() != ctx.accounts.escrow.key()
            && ctx.accounts.payee.key() != ctx.accounts.vault.key(),
        EscrowError::InvalidPayee
    );
    // Native SOL keeps its own instructions. The allowlist holds no native mint,
    // and no transfer-hook accounts are ever passed, so a mint with an active
    // hook cannot be locked.
    let token_program_info = ctx.accounts.token_program.to_account_info();
    let mint_info = ctx.accounts.mint.to_account_info();
    let vault_info = ctx.accounts.vault.to_account_info();
    token::initialize_account3(
        &token_program_info,
        &vault_info,
        &mint_info,
        &ctx.accounts.escrow.key(),
    )?;
    let source_before = ctx.accounts.source.amount;
    token::transfer_checked(
        Transfer {
            token_program: &token_program_info,
            from: &ctx.accounts.source.to_account_info(),
            mint: &mint_info,
            to: &vault_info,
            authority: &ctx.accounts.payer.to_account_info(),
        },
        amount,
        ctx.accounts.mint.decimals,
        &[],
    )?;
    ctx.accounts.source.reload()?;
    // The vault must hold exactly the named amount. A Token-2022 mint charging a
    // transfer fee at lock time leaves less than that, and the lock is refused.
    require!(
        source_before.checked_sub(amount) == Some(ctx.accounts.source.amount)
            && token::amount_of(&vault_info)? == amount,
        EscrowError::InvalidTokenAmount
    );
    let escrow = &mut ctx.accounts.escrow;
    escrow.payer = ctx.accounts.payer.key();
    escrow.payee = ctx.accounts.payee.key();
    escrow.mint = ctx.accounts.mint.key();
    escrow.source = ctx.accounts.source.key();
    escrow.recipient = ctx.accounts.recipient.key();
    escrow.amount = amount;
    escrow.nonce = nonce;
    escrow.status = EscrowStatus::Locked;
    escrow.created_slot = Clock::get()?.slot;
    escrow.bump = ctx.bumps.escrow;
    escrow.metered = metered;
    emit!(EscrowLocked {
        escrow: escrow.key(),
        payer: escrow.payer,
        payee: escrow.payee,
        mint: Some(escrow.mint),
        amount,
        nonce,
        created_slot: escrow.created_slot,
    });
    Ok(())
}

/// Pay the recorded recipient token account the whole locked amount, less the
/// protocol fee. Signed by the payer at any time (release) or by the payee once
/// the claim window has elapsed (claim).
pub fn release_token_escrow_handler(ctx: Context<ReleaseTokenEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let outcome = payout_outcome(
        &ctx.accounts.authority.key(),
        &escrow.payer,
        &escrow.payee,
        escrow.created_slot,
        Clock::get()?.slot,
    )?;
    let amount = escrow.amount;
    pay_out(ctx.accounts, amount, outcome)
}

/// Settle a token escrow at its actual cost: the recorded recipient receives
/// `actual` less the protocol fee, the treasury's token account receives the
/// fee, and the rest of the vault returns to the payer.
///
/// Only the payee may settle, and only a metered escrow. The payer never
/// chooses a smaller amount: the payer's ways out are a full release, or a
/// refund once the refund window has elapsed.
pub fn settle_token_escrow_handler(ctx: Context<ReleaseTokenEscrow>, actual: u64) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let authority = ctx.accounts.authority.key();
    require!(
        actual > 0 && actual <= escrow.amount,
        EscrowError::InvalidSettleAmount
    );
    require_keys_eq!(authority, escrow.payee, EscrowError::UnauthorisedSigner);
    require!(escrow.metered, EscrowError::NotMetered);
    pay_out(ctx.accounts, actual, SettlementOutcome::SettledActual)
}

/// Split the vault: `paid` less the fee to the payee's recorded recipient, the
/// fee to the treasury, and everything else (the unused part of the locked
/// amount and any donation) back to the payer. Closes the vault.
///
/// Classic SPL Token: the vault can only grow, so it must still hold at least
/// the locked amount and every destination must receive exactly what is sent.
/// Token-2022: the issuer can shrink the vault or switch on a transfer fee, so
/// the payee is paid first from what is there, then the fee, then the refund,
/// and each destination may receive less than was sent. See `settle`.
fn pay_out(accounts: &mut ReleaseTokenEscrow, paid: u64, outcome: SettlementOutcome) -> Result<()> {
    let escrow = &accounts.escrow;
    let issuer_controlled = accounts.token_program.key() == TOKEN_2022_ID;
    require_keys_eq!(
        accounts.destination.key(),
        escrow.recipient,
        EscrowError::InvalidTokenAccount
    );
    require_keys_eq!(
        accounts.destination.owner,
        escrow.payee,
        EscrowError::InvalidTokenAccount
    );
    require_keys_eq!(
        accounts.treasury_token.key(),
        treasury_token_address(&escrow.mint, &accounts.token_program.key()),
        EscrowError::InvalidTreasury
    );
    // Every destination is a different account, so each balance change below
    // measures one transfer.
    let vault_key = accounts.vault.key();
    let keys = [
        accounts.destination.key(),
        accounts.treasury_token.key(),
        accounts.refund.key(),
    ];
    for (i, key) in keys.iter().enumerate() {
        require_keys_neq!(*key, vault_key, EscrowError::InvalidTokenAccount);
        for other in keys.iter().skip(i + 1) {
            require_keys_neq!(*key, *other, EscrowError::InvalidTokenAccount);
        }
    }

    let available = accounts.vault.amount;
    require!(
        issuer_controlled || available >= escrow.amount,
        EscrowError::InvalidTokenAmount
    );
    let fee = protocol_fee(paid, false);
    let to_payee = paid.checked_sub(fee).ok_or(EscrowError::Overflow)?;
    let payee_part = to_payee.min(available);
    let fee_part = fee.min(available - payee_part);
    let refund_part = available - payee_part - fee_part;
    // When something goes back to the payer it must go to a token account of
    // the mint the payer owns (any one: the payer may close or re-own the
    // recorded source after locking). When nothing goes back the refund account
    // receives nothing, so its owner is not checked.
    require!(
        refund_part == 0 || accounts.refund.owner == escrow.payer,
        EscrowError::InvalidTokenAccount
    );

    let bump = [escrow.bump];
    let seeds: &[&[u8]] = &[
        TOKEN_ESCROW_SEED,
        escrow.payer.as_ref(),
        &escrow.nonce,
        &bump,
    ];
    let signer = &[seeds];
    let token_program = accounts.token_program.to_account_info();
    let mint_info = accounts.mint.to_account_info();
    let vault_info = accounts.vault.to_account_info();
    let escrow_info = escrow.to_account_info();
    let decimals = accounts.mint.decimals;
    let before = [
        accounts.destination.amount,
        accounts.treasury_token.amount,
        accounts.refund.amount,
    ];
    let sends = [payee_part, fee_part, refund_part];
    let targets = [
        accounts.destination.to_account_info(),
        accounts.treasury_token.to_account_info(),
        accounts.refund.to_account_info(),
    ];
    for (to, units) in targets.iter().zip(sends) {
        if units > 0 {
            token::transfer_checked(
                Transfer {
                    token_program: &token_program,
                    from: &vault_info,
                    mint: &mint_info,
                    to,
                    authority: &escrow_info,
                },
                units,
                decimals,
                signer,
            )?;
        }
    }
    accounts.vault.reload()?;
    accounts.destination.reload()?;
    accounts.treasury_token.reload()?;
    accounts.refund.reload()?;
    let after = [
        accounts.destination.amount,
        accounts.treasury_token.amount,
        accounts.refund.amount,
    ];
    let mut received = [0u64; 3];
    for i in 0..3 {
        received[i] = after[i]
            .checked_sub(before[i])
            .ok_or(EscrowError::InvalidTokenAmount)?;
        require!(
            received[i] == sends[i] || (issuer_controlled && received[i] <= sends[i]),
            EscrowError::InvalidTokenAmount
        );
    }
    require!(accounts.vault.amount == 0, EscrowError::InvalidTokenAmount);
    if accounts.vault.withheld_fees == 0 {
        token::close_account(
            &token_program,
            &vault_info,
            &accounts.payer.to_account_info(),
            &escrow_info,
            signer,
        )?;
    }
    emit!(EscrowSettled {
        escrow: escrow.key(),
        payer: escrow.payer,
        payee: escrow.payee,
        mint: Some(escrow.mint),
        amount: received[0],
        nonce: escrow.nonce,
        outcome,
        slot: Clock::get()?.slot,
        fee: received[1],
        refunded: received[2],
    });
    Ok(())
}

/// Refund the payer. The payee may decline at any time; the payer may refund
/// itself after the cancel window. A payee's decline goes to the source token
/// account recorded at lock. The payer may name a different token account of
/// the escrow mint that it owns, so a closed or re-owned source
/// cannot strand its refund.
pub fn cancel_token_escrow_handler(ctx: Context<CancelTokenEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let outcome = refund_outcome(
        &ctx.accounts.authority.key(),
        &escrow.payer,
        &escrow.payee,
        escrow.created_slot,
        Clock::get()?.slot,
    )?;
    require_keys_eq!(
        ctx.accounts.destination.owner,
        escrow.payer,
        EscrowError::InvalidTokenAccount
    );
    if ctx.accounts.authority.key() != escrow.payer {
        require_keys_eq!(
            ctx.accounts.destination.key(),
            escrow.source,
            EscrowError::InvalidTokenAccount
        );
    }
    let parts = SettleParts {
        escrow: &ctx.accounts.escrow,
        vault: &mut ctx.accounts.vault,
        mint: &ctx.accounts.mint,
        destination: &mut ctx.accounts.destination,
        rent_to: ctx.accounts.payer.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    settle(parts, outcome)
}

struct SettleParts<'a, 'info> {
    escrow: &'a Account<'info, TokenEscrowAccount>,
    vault: &'a mut InterfaceAccount<'info, TokenAccount>,
    mint: &'a InterfaceAccount<'info, Mint>,
    destination: &'a mut InterfaceAccount<'info, TokenAccount>,
    rent_to: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
}

/// Move the whole vault to the already-validated destination, close the vault,
/// and record the outcome. The escrow record itself is closed by the caller's
/// `close = payer` constraint.
///
/// Classic SPL Token: the vault can only grow, so it must still hold at least
/// the locked amount and the destination must receive exactly what leaves.
///
/// Token-2022 (PYUSD, USDG): the issuer can change what a transfer delivers and
/// what a vault holds. A permanent delegate can remove tokens, a transfer fee
/// can be switched on, and fees withheld on the vault block closing it. None of
/// that may strand the escrow, so settlement pays whatever the vault holds,
/// accepts a destination credit of at most that, and leaves a vault with
/// withheld fees open instead of failing. A frozen vault, or a transfer hook
/// the issuer later activates, does stop settlement; the program cannot work
/// around either.
fn settle(parts: SettleParts, outcome: SettlementOutcome) -> Result<()> {
    let escrow = parts.escrow;
    let issuer_controlled = parts.token_program.key() == TOKEN_2022_ID;
    require_keys_neq!(
        parts.destination.key(),
        parts.vault.key(),
        EscrowError::InvalidTokenAccount
    );
    require!(
        issuer_controlled || parts.vault.amount >= escrow.amount,
        EscrowError::InvalidTokenAmount
    );

    let bump = [escrow.bump];
    let seeds: &[&[u8]] = &[
        TOKEN_ESCROW_SEED,
        escrow.payer.as_ref(),
        &escrow.nonce,
        &bump,
    ];
    let signer = &[seeds];
    let destination_before = parts.destination.amount;
    // Anyone can donate tokens to a vault. Sweep any surplus to the same
    // beneficiary so a donation cannot block closing or strand funds.
    let payout = parts.vault.amount;
    if payout > 0 {
        token::transfer_checked(
            Transfer {
                token_program: &parts.token_program,
                from: &parts.vault.to_account_info(),
                mint: &parts.mint.to_account_info(),
                to: &parts.destination.to_account_info(),
                authority: &escrow.to_account_info(),
            },
            payout,
            parts.mint.decimals,
            signer,
        )?;
    }
    parts.vault.reload()?;
    parts.destination.reload()?;
    let received = parts
        .destination
        .amount
        .checked_sub(destination_before)
        .ok_or(EscrowError::InvalidTokenAmount)?;
    require!(
        parts.vault.amount == 0
            && (received == payout || (issuer_controlled && received <= payout)),
        EscrowError::InvalidTokenAmount
    );
    if parts.vault.withheld_fees == 0 {
        token::close_account(
            &parts.token_program,
            &parts.vault.to_account_info(),
            &parts.rent_to,
            &escrow.to_account_info(),
            signer,
        )?;
    }
    emit!(EscrowSettled {
        escrow: escrow.key(),
        payer: escrow.payer,
        payee: escrow.payee,
        mint: Some(escrow.mint),
        amount: received,
        nonce: escrow.nonce,
        outcome,
        slot: Clock::get()?.slot,
        fee: 0,
        refunded: 0,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(amount: u64, nonce: [u8; 16])]
pub struct LockTokenEscrow<'info> {
    #[account(init, payer = payer, space = TokenEscrowAccount::LEN,
        seeds = [TOKEN_ESCROW_SEED, payer.key().as_ref(), nonce.as_ref()], bump)]
    pub escrow: Account<'info, TokenEscrowAccount>,
    // Anchor 1.1.2's token::init macro needs anchor-spl's Token-2022 feature.
    // Allocate the layout for the given token program here and initialize it
    // by CPI in the handler.
    /// CHECK: Fresh PDA, owned by the given token program, initialized atomically below.
    #[account(init, payer = payer, space = vault_len(&token_program.key()), owner = token_program.key(),
        seeds = [TOKEN_VAULT_SEED, escrow.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Recorded recipient identity; recipient token authority is checked below.
    pub payee: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut,
        constraint = source.mint == mint.key() && source.owner == payer.key()
            && *source.to_account_info().owner == token_program.key() @ EscrowError::InvalidTokenAccount)]
    pub source: InterfaceAccount<'info, TokenAccount>,
    #[account(
        constraint = recipient.mint == mint.key() && recipient.owner == payee.key()
            && *recipient.to_account_info().owner == token_program.key() @ EscrowError::InvalidTokenAccount,
        constraint = recipient.key() != vault.key() @ EscrowError::InvalidTokenAccount)]
    pub recipient: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenPrograms>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReleaseTokenEscrow<'info> {
    #[account(mut, seeds = [TOKEN_ESCROW_SEED, payer.key().as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump, has_one = payer @ EscrowError::UnauthorisedSigner, has_one = mint,
        constraint = escrow.status == EscrowStatus::Locked @ EscrowError::NotLocked, close = payer)]
    pub escrow: Account<'info, TokenEscrowAccount>,
    #[account(mut, seeds = [TOKEN_VAULT_SEED, escrow.key().as_ref()], bump,
        constraint = vault.mint == mint.key() && vault.owner == escrow.key()
            && *vault.to_account_info().owner == token_program.key() @ EscrowError::InvalidTokenAccount)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// The payer (to release at any time) or the payee (to claim after the
    /// claim window).
    pub authority: Signer<'info>,
    /// CHECK: The recorded payer, bound by the escrow seeds and `has_one`. Receives
    /// the rent of both closed accounts; does not need to sign.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
    #[account(constraint = *mint.to_account_info().owner == token_program.key() @ EscrowError::InvalidTokenAccount)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut,
        constraint = destination.mint == mint.key()
            && *destination.to_account_info().owner == token_program.key() @ EscrowError::InvalidTokenAccount)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    /// The protocol treasury's associated token account for the escrow mint.
    #[account(mut,
        constraint = treasury_token.mint == mint.key()
            && *treasury_token.to_account_info().owner == token_program.key() @ EscrowError::InvalidTokenAccount,
        constraint = treasury_token.owner == PROTOCOL_TREASURY @ EscrowError::InvalidTreasury)]
    pub treasury_token: InterfaceAccount<'info, TokenAccount>,
    /// Where anything above the paid amount returns: any token account of the
    /// mint that the payer owns.
    #[account(mut,
        constraint = refund.mint == mint.key()
            && *refund.to_account_info().owner == token_program.key() @ EscrowError::InvalidTokenAccount)]
    pub refund: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenPrograms>,
}

#[derive(Accounts)]
pub struct CancelTokenEscrow<'info> {
    #[account(mut, seeds = [TOKEN_ESCROW_SEED, payer.key().as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump, has_one = payer @ EscrowError::UnauthorisedSigner, has_one = mint,
        constraint = escrow.status == EscrowStatus::Locked @ EscrowError::NotLocked, close = payer)]
    pub escrow: Account<'info, TokenEscrowAccount>,
    #[account(mut, seeds = [TOKEN_VAULT_SEED, escrow.key().as_ref()], bump,
        constraint = vault.mint == mint.key() && vault.owner == escrow.key()
            && *vault.to_account_info().owner == token_program.key() @ EscrowError::InvalidTokenAccount)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// The payee (to decline at any time) or the payer (after the cancel
    /// window).
    pub authority: Signer<'info>,
    /// CHECK: The recorded payer, bound by the escrow seeds and `has_one`. Receives
    /// the rent of both closed accounts; does not need to sign.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
    #[account(constraint = *mint.to_account_info().owner == token_program.key() @ EscrowError::InvalidTokenAccount)]
    pub mint: InterfaceAccount<'info, Mint>,
    /// The recorded source account, or, when the payer itself signs, any token
    /// account of the escrow mint that the payer owns.
    #[account(mut,
        constraint = destination.mint == mint.key()
            && *destination.to_account_info().owner == token_program.key() @ EscrowError::InvalidTokenAccount)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenPrograms>,
}
