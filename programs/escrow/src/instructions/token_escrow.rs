use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TransferChecked};

use crate::{
    classic_token::{Mint, TokenAccount},
    constants::{CANCEL_WINDOW_SLOTS, TOKEN_ESCROW_SEED, TOKEN_VAULT_SEED},
    error::EscrowError,
    state::{EscrowStatus, TokenEscrowAccount},
};

pub fn lock_token_escrow_handler(
    ctx: Context<LockTokenEscrow>,
    amount: u64,
    nonce: [u8; 16],
) -> Result<()> {
    require!(amount > 0, EscrowError::ZeroAmount);
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
    Ok(())
}

pub fn settle_token_escrow_handler(ctx: Context<SettleTokenEscrow>, refund: bool) -> Result<()> {
    let escrow = &ctx.accounts.escrow;
    let (destination, owner) = if refund {
        require!(
            Clock::get()?.slot.saturating_sub(escrow.created_slot) >= CANCEL_WINDOW_SLOTS,
            EscrowError::CancelWindowNotElapsed
        );
        (escrow.source, escrow.payer)
    } else {
        (escrow.recipient, escrow.payee)
    };
    require_keys_eq!(
        ctx.accounts.destination.key(),
        destination,
        EscrowError::InvalidTokenAccount
    );
    require_keys_eq!(
        ctx.accounts.destination.owner,
        owner,
        EscrowError::InvalidTokenAccount
    );
    require!(
        ctx.accounts.vault.amount >= escrow.amount,
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
    let destination_before = ctx.accounts.destination.amount;
    // Anyone can donate tokens to a vault. Sweep any surplus to the same recorded
    // beneficiary so a donation cannot block closing or strand funds.
    let payout = ctx.accounts.vault.amount;
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer,
        ),
        payout,
        ctx.accounts.mint.decimals,
    )?;
    ctx.accounts.vault.reload()?;
    ctx.accounts.destination.reload()?;
    require!(
        ctx.accounts.vault.amount == 0
            && destination_before.checked_add(payout) == Some(ctx.accounts.destination.amount),
        EscrowError::InvalidTokenAmount
    );
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.payer.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        },
        signer,
    ))?;
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
pub struct SettleTokenEscrow<'info> {
    #[account(mut, seeds = [TOKEN_ESCROW_SEED, payer.key().as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump, has_one = payer @ EscrowError::UnauthorisedSigner, has_one = mint,
        constraint = escrow.status == EscrowStatus::Locked @ EscrowError::NotLocked, close = payer)]
    pub escrow: Account<'info, TokenEscrowAccount>,
    #[account(mut, seeds = [TOKEN_VAULT_SEED, escrow.key().as_ref()], bump,
        token::mint = mint, token::authority = escrow, token::token_program = token_program)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
