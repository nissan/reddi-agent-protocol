use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TransferChecked};

use crate::{
    classic_token::{Mint, TokenAccount},
    constants::{
        ALLOWED_MINTS, ALLOWED_MINT_DECIMALS, MAX_TOKEN_ESCROW_BASE_UNITS, TOKEN_ESCROW_SEED,
        TOKEN_VAULT_SEED,
    },
    error::EscrowError,
    events::{EscrowLocked, EscrowSettled, SettlementOutcome},
    instructions::cancel_escrow::{payout_outcome, refund_outcome},
    state::{EscrowStatus, TokenEscrowAccount},
};

pub fn lock_token_escrow_handler(
    ctx: Context<LockTokenEscrow>,
    amount: u64,
    nonce: [u8; 16],
) -> Result<()> {
    require!(amount > 0, EscrowError::ZeroAmount);
    require!(
        ALLOWED_MINTS.contains(&ctx.accounts.mint.key())
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
    // Native SOL keeps its existing instruction/account contract. This rail is
    // classic non-native SPL Token only, never Token-2022 or transfer hooks.
    require_keys_neq!(
        ctx.accounts.mint.key(),
        token::spl_token::native_mint::ID,
        EscrowError::InvalidTokenAccount
    );
    token::initialize_account3(CpiContext::new(
        ctx.accounts.token_program.key(),
        token::InitializeAccount3 {
            account: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        },
    ))?;
    let source_before = ctx.accounts.source.amount;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.source.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    ctx.accounts.source.reload()?;
    require!(
        source_before.checked_sub(amount) == Some(ctx.accounts.source.amount)
            && token::accessor::amount(&ctx.accounts.vault)? == amount,
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

/// Pay the recorded recipient token account. Signed by the payer at any time
/// (release) or by the payee once the claim window has elapsed (claim).
pub fn release_token_escrow_handler(ctx: Context<ReleaseTokenEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let outcome = payout_outcome(
        &ctx.accounts.authority.key(),
        &escrow.payer,
        &escrow.payee,
        escrow.created_slot,
        Clock::get()?.slot,
    )?;
    require_keys_eq!(
        ctx.accounts.destination.key(),
        escrow.recipient,
        EscrowError::InvalidTokenAccount
    );
    require_keys_eq!(
        ctx.accounts.destination.owner,
        escrow.payee,
        EscrowError::InvalidTokenAccount
    );
    let parts = SettleParts {
        escrow: &ctx.accounts.escrow,
        vault: &mut ctx.accounts.vault,
        mint: &ctx.accounts.mint,
        destination: &mut ctx.accounts.destination,
        rent_to: ctx.accounts.payer.to_account_info(),
        token_program: &ctx.accounts.token_program,
    };
    settle(parts, outcome)
}

/// Refund the payer. The payee may decline at any time; the payer may refund
/// itself after the cancel window. A payee's decline goes to the source token
/// account recorded at lock. The payer may name a different classic token
/// account of the escrow mint that it owns, so a closed or re-owned source
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
        token_program: &ctx.accounts.token_program,
    };
    settle(parts, outcome)
}

struct SettleParts<'a, 'info> {
    escrow: &'a Account<'info, TokenEscrowAccount>,
    vault: &'a mut Account<'info, TokenAccount>,
    mint: &'a Account<'info, Mint>,
    destination: &'a mut Account<'info, TokenAccount>,
    rent_to: AccountInfo<'info>,
    token_program: &'a Program<'info, Token>,
}

/// Move the whole vault to the already-validated destination, close the vault,
/// and record the outcome. The escrow record itself is closed by the caller's
/// `close = payer` constraint.
fn settle(parts: SettleParts, outcome: SettlementOutcome) -> Result<()> {
    let escrow = parts.escrow;
    require_keys_neq!(
        parts.destination.key(),
        parts.vault.key(),
        EscrowError::InvalidTokenAccount
    );
    require!(
        parts.vault.amount >= escrow.amount,
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
    token::transfer_checked(
        CpiContext::new_with_signer(
            parts.token_program.key(),
            TransferChecked {
                from: parts.vault.to_account_info(),
                mint: parts.mint.to_account_info(),
                to: parts.destination.to_account_info(),
                authority: escrow.to_account_info(),
            },
            signer,
        ),
        payout,
        parts.mint.decimals,
    )?;
    parts.vault.reload()?;
    parts.destination.reload()?;
    require!(
        parts.vault.amount == 0
            && destination_before.checked_add(payout) == Some(parts.destination.amount),
        EscrowError::InvalidTokenAmount
    );
    token::close_account(CpiContext::new_with_signer(
        parts.token_program.key(),
        CloseAccount {
            account: parts.vault.to_account_info(),
            destination: parts.rent_to,
            authority: escrow.to_account_info(),
        },
        signer,
    ))?;
    emit!(EscrowSettled {
        escrow: escrow.key(),
        payer: escrow.payer,
        payee: escrow.payee,
        mint: Some(escrow.mint),
        amount: payout,
        nonce: escrow.nonce,
        outcome,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(amount: u64, nonce: [u8; 16])]
pub struct LockTokenEscrow<'info> {
    #[account(init, payer = payer, space = TokenEscrowAccount::LEN,
        seeds = [TOKEN_ESCROW_SEED, payer.key().as_ref(), nonce.as_ref()], bump)]
    pub escrow: Account<'info, TokenEscrowAccount>,
    // Anchor 1.1.2's token::init macro references Token-2022 even for Token.
    // Allocate the classic fixed layout here and initialize via the classic CPI
    // in the handler, keeping the dependency and accepted program classic-only.
    /// CHECK: Fresh PDA, owned by the typed classic Token program, initialized atomically below.
    #[account(init, payer = payer, space = token::TokenAccount::LEN, owner = token_program.key(),
        seeds = [TOKEN_VAULT_SEED, escrow.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Recorded recipient identity; recipient token authority is checked below.
    pub payee: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = payer, token::token_program = token_program)]
    pub source: Account<'info, TokenAccount>,
    #[account(token::mint = mint, token::authority = payee, token::token_program = token_program,
        constraint = recipient.key() != vault.key() @ EscrowError::InvalidTokenAccount)]
    pub recipient: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReleaseTokenEscrow<'info> {
    #[account(mut, seeds = [TOKEN_ESCROW_SEED, payer.key().as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump, has_one = payer @ EscrowError::UnauthorisedSigner, has_one = mint,
        constraint = escrow.status == EscrowStatus::Locked @ EscrowError::NotLocked, close = payer)]
    pub escrow: Account<'info, TokenEscrowAccount>,
    #[account(mut, seeds = [TOKEN_VAULT_SEED, escrow.key().as_ref()], bump,
        token::mint = mint, token::authority = escrow, token::token_program = token_program)]
    pub vault: Account<'info, TokenAccount>,
    /// The payer (to release at any time) or the payee (to claim after the
    /// claim window).
    pub authority: Signer<'info>,
    /// CHECK: The recorded payer, bound by the escrow seeds and `has_one`. Receives
    /// the rent of both closed accounts; does not need to sign.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelTokenEscrow<'info> {
    #[account(mut, seeds = [TOKEN_ESCROW_SEED, payer.key().as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump, has_one = payer @ EscrowError::UnauthorisedSigner, has_one = mint,
        constraint = escrow.status == EscrowStatus::Locked @ EscrowError::NotLocked, close = payer)]
    pub escrow: Account<'info, TokenEscrowAccount>,
    #[account(mut, seeds = [TOKEN_VAULT_SEED, escrow.key().as_ref()], bump,
        token::mint = mint, token::authority = escrow, token::token_program = token_program)]
    pub vault: Account<'info, TokenAccount>,
    /// The payee (to decline at any time) or the payer (after the cancel
    /// window).
    pub authority: Signer<'info>,
    /// CHECK: The recorded payer, bound by the escrow seeds and `has_one`. Receives
    /// the rent of both closed accounts; does not need to sign.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    /// The recorded source account, or, when the payer itself signs, any classic
    /// token account of the escrow mint that the payer owns.
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
