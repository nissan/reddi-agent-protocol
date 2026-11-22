// Forked from archive/anchor-escrow/tests/test_token_escrow.rs on 22 November 2026, when the
// V1 program stopped matching the archived Anchor program: exits name their escrow.
//! Classic SPL Token escrow behavior. Mints and signers are disposable local fixtures;
//! no AUDD identity, network RPC, operator wallet, or external signing is used.
use anchor_lang::{
    prelude::Pubkey,
    solana_program::{
        instruction::Instruction, program_pack::Pack, system_instruction, system_program,
    },
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use anchor_spl::token::spl_token::{self, instruction as token_ix, state::Account as TokenAccount};
use escrow::{
    accounts, instruction,
    state::{EscrowStatus, TokenEscrowAccount},
    AUDD_MAINNET_MINT, DEFAULT_CANCEL_WINDOW_SLOTS as CANCEL_WINDOW_SLOTS,
    DEFAULT_CLAIM_WINDOW_SLOTS as CLAIM_WINDOW_SLOTS, MAX_TOKEN_ESCROW_BASE_UNITS,
    PROTOCOL_TREASURY, USDC_DEVNET_MINT, USDC_MAINNET_MINT,
};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

fn send(svm: &mut LiteSVM, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
    // Ensure repeated instructions really execute rather than hitting the signature cache.
    svm.expire_blockhash();
    let ixs = &instance::bind(svm, ixs);
    let msg = Message::new_with_blockhash(ixs, Some(&signers[0].pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|err| format!("{err:?}"))
}

fn install_mint(svm: &mut LiteSVM, address: Pubkey, authority: Pubkey, decimals: u8) {
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint::pack(
        spl_token::state::Mint {
            mint_authority: Some(authority).into(),
            supply: 0,
            decimals,
            is_initialized: true,
            freeze_authority: None.into(),
        },
        &mut data,
    )
    .unwrap();
    svm.set_account(
        address,
        solana_account::Account {
            lamports: 10_000_000,
            data,
            owner: spl_token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

struct Fixture {
    svm: LiteSVM,
    payer: Keypair,
    payee: Keypair,
    attacker: Keypair,
    mint: Pubkey,
    source: Pubkey,
    recipient: Pubkey,
    attacker_token: Pubkey,
    treasury_token: Pubkey,
    escrow: Pubkey,
    vault: Pubkey,
    nonce: [u8; 16],
}

impl Fixture {
    fn new() -> Self {
        Self::with_mint(USDC_MAINNET_MINT, 6)
    }
    /// A complete, internally consistent fixture around a local mint installed
    /// at `mint` with `decimals`.
    fn with_mint(mint: Pubkey, decimals: u8) -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(
            escrow::id(),
            include_bytes!("../../target/deploy/pinocchio_escrow.so"),
        )
        .unwrap();
        let payer = Keypair::new();
        let payee = Keypair::new();
        let attacker = Keypair::new();
        svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();
        svm.airdrop(&payee.pubkey(), 1_000_000_000).unwrap();
        // The program accepts allowlisted mints only, so the fixture places a
        // disposable local mint at the allowlisted address. No real USDC, RPC,
        // or operator wallet is involved.
        install_mint(&mut svm, mint, payer.pubkey(), decimals);
        let mut tokens = Vec::new();
        for owner in [
            payer.pubkey(),
            payee.pubkey(),
            attacker.pubkey(),
            PROTOCOL_TREASURY,
        ] {
            let account = Keypair::new();
            send(
                &mut svm,
                &[
                    system_instruction::create_account(
                        &payer.pubkey(),
                        &account.pubkey(),
                        10_000_000,
                        165,
                        &spl_token::ID,
                    ),
                    token_ix::initialize_account3(&spl_token::ID, &account.pubkey(), &mint, &owner)
                        .unwrap(),
                ],
                &[&payer, &account],
            )
            .unwrap();
            tokens.push(account.pubkey());
        }
        send(
            &mut svm,
            &[token_ix::mint_to(
                &spl_token::ID,
                &mint,
                &tokens[0],
                &payer.pubkey(),
                &[],
                1_000_000,
            )
            .unwrap()],
            &[&payer],
        )
        .unwrap();
        let nonce = [71; 16];
        let escrow = Pubkey::find_program_address(
            &[b"token-escrow", payer.pubkey().as_ref(), &nonce],
            &escrow::id(),
        )
        .0;
        let vault =
            Pubkey::find_program_address(&[b"token-vault", escrow.as_ref()], &escrow::id()).0;
        // The treasury's token account must sit at its associated address.
        let treasury_token = escrow::treasury_token_address(&mint, &spl_token::ID);
        let account = svm.get_account(&tokens[3]).unwrap();
        svm.set_account(treasury_token, account).unwrap();
        Self {
            svm,
            payer,
            payee,
            attacker,
            mint,
            source: tokens[0],
            recipient: tokens[1],
            attacker_token: tokens[2],
            treasury_token,
            escrow,
            vault,
            nonce,
        }
    }
    fn lock_ix(&self, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::LockTokenEscrow {
                amount,
                nonce: self.nonce,
                claim_window_slots: CLAIM_WINDOW_SLOTS,
                cancel_window_slots: CANCEL_WINDOW_SLOTS,
            }
            .data(),
            accounts::LockTokenEscrow {
                escrow: self.escrow,
                vault: self.vault,
                payer: self.payer.pubkey(),
                payee: self.payee.pubkey(),
                mint: self.mint,
                source: self.source,
                recipient: self.recipient,
                token_program: spl_token::ID,
                system_program: system_program::id(),
            }
            .to_account_metas(None),
        )
    }
    fn metered_lock_ix(&self, amount: u64) -> Instruction {
        let mut ix = self.lock_ix(amount);
        ix.data = instruction::LockMeteredTokenEscrow {
            amount,
            nonce: self.nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data();
        ix
    }
    fn release_ix(&self) -> Instruction {
        self.payout_ix(self.payer.pubkey())
    }
    fn payout_accounts(&self, authority: Pubkey) -> Vec<anchor_lang::prelude::AccountMeta> {
        accounts::ReleaseTokenEscrow {
            escrow: self.escrow,
            vault: self.vault,
            authority,
            payer: self.payer.pubkey(),
            mint: self.mint,
            destination: self.recipient,
            treasury_token: self.treasury_token,
            refund: self.source,
            token_program: spl_token::ID,
        }
        .to_account_metas(None)
    }
    /// Payout signed by `authority`, paid to the recorded recipient account
    /// less the fee, which goes to the treasury's token account.
    fn payout_ix(&self, authority: Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::ReleaseTokenEscrow {}.data(),
            self.payout_accounts(authority),
        )
    }
    /// Settlement at `actual`, signed by `authority`.
    fn settle_ix(&self, authority: Pubkey, actual: u64) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::SettleTokenEscrow { actual }.data(),
            self.payout_accounts(authority),
        )
    }
    /// Refund signed by `authority`, paid to the payer's original source account.
    fn cancel_ix(&self, authority: Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::CancelTokenEscrow {}.data(),
            accounts::CancelTokenEscrow {
                escrow: self.escrow,
                vault: self.vault,
                authority,
                payer: self.payer.pubkey(),
                mint: self.mint,
                destination: self.source,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
        )
    }
    fn payer_cancel_ix(&self) -> Instruction {
        self.cancel_ix(self.payer.pubkey())
    }
    fn new_token_account(&mut self, owner: Pubkey) -> Pubkey {
        let account = Keypair::new();
        send(
            &mut self.svm,
            &[
                system_instruction::create_account(
                    &self.payer.pubkey(),
                    &account.pubkey(),
                    10_000_000,
                    165,
                    &spl_token::ID,
                ),
                token_ix::initialize_account3(
                    &spl_token::ID,
                    &account.pubkey(),
                    &self.mint,
                    &owner,
                )
                .unwrap(),
            ],
            &[&self.payer, &account],
        )
        .unwrap();
        account.pubkey()
    }
    fn balance(&self, key: Pubkey) -> u64 {
        self.svm
            .get_account(&key)
            .filter(|a| !a.data.is_empty())
            .map(|a| TokenAccount::unpack(&a.data).unwrap().amount)
            .unwrap_or(0)
    }
    fn lamports(&self, key: Pubkey) -> u64 {
        self.svm.get_account(&key).map(|a| a.lamports).unwrap_or(0)
    }
    fn closed(&self, key: Pubkey) -> bool {
        self.svm
            .get_account(&key)
            .is_none_or(|a| a.lamports == 0 && a.data.is_empty())
    }
    fn state(&self) -> TokenEscrowAccount {
        TokenEscrowAccount::try_deserialize(
            &mut self.svm.get_account(&self.escrow).unwrap().data.as_slice(),
        )
        .unwrap()
    }
    fn lock(&mut self) {
        let ix = self.lock_ix(400_000);
        send(&mut self.svm, &[ix], &[&self.payer]).unwrap();
    }
    fn reject(&mut self, ix: Instruction, attacker: bool) -> String {
        let signer = if attacker {
            self.attacker.insecure_clone()
        } else {
            self.payer.insecure_clone()
        };
        self.reject_as(ix, &signer)
    }
    fn reject_as(&mut self, ix: Instruction, signer: &Keypair) -> String {
        let before = [
            self.balance(self.source),
            self.balance(self.vault),
            self.balance(self.recipient),
            self.balance(self.attacker_token),
        ];
        let err =
            send(&mut self.svm, &[ix], &[signer]).expect_err("must reject invalid instruction");
        assert_eq!(
            before,
            [
                self.balance(self.source),
                self.balance(self.vault),
                self.balance(self.recipient),
                self.balance(self.attacker_token)
            ],
            "failure must conserve token balances"
        );
        err
    }
    /// Freeze or thaw a token account by writing its state byte, as the mint's
    /// freeze authority would. The local mint has no freeze authority.
    fn set_frozen(&mut self, key: Pubkey, frozen: bool) {
        let mut account = self.svm.get_account(&key).unwrap();
        account.data[108] = if frozen { 2 } else { 1 };
        self.svm.set_account(key, account).unwrap();
    }
    fn mint_to_source(&mut self, amount: u64) {
        let ix = token_ix::mint_to(
            &spl_token::ID,
            &self.mint,
            &self.source,
            &self.payer.pubkey(),
            &[],
            amount,
        )
        .unwrap();
        send(&mut self.svm, &[ix], &[&self.payer]).unwrap();
    }
    fn triple(&self) -> (u64, u64, u64) {
        (
            self.balance(self.source),
            self.balance(self.vault),
            self.balance(self.recipient),
        )
    }
}

#[test]
fn token_lock_release_conserves_assets_and_closes_records_to_payer() {
    let mut f = Fixture::new();
    f.lock();
    assert_eq!(f.triple(), (600_000, 400_000, 0));
    let state = f.state();
    assert_eq!(state.status, EscrowStatus::Locked);
    assert_eq!(state.mint, f.mint);
    assert_eq!(state.source, f.source);
    assert_eq!(state.recipient, f.recipient);
    let vault = TokenAccount::unpack(&f.svm.get_account(&f.vault).unwrap().data).unwrap();
    assert_eq!(vault.owner, f.escrow);
    assert_eq!(vault.mint, f.mint);
    let rent_held = f.lamports(f.escrow) + f.lamports(f.vault);
    let payer_before = f.lamports(f.payer.pubkey());
    let ix = f.release_ix();
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    // 2.5% of 400_000 goes to the treasury; the payee gets the rest.
    assert_eq!(f.triple(), (600_000, 0, 390_000));
    assert_eq!(f.balance(f.treasury_token), 10_000);
    assert!(f.closed(f.escrow), "escrow record must close on release");
    assert!(f.closed(f.vault), "vault must close on release");
    // Both rent reserves return to the payer net of at most the transaction fee,
    // which is far below the smallest rent-exempt reserve.
    let recovered = f.lamports(f.payer.pubkey()) - payer_before;
    assert!(
        recovered <= rent_held
            && rent_held - recovered < f.svm.minimum_balance_for_rent_exemption(0),
        "payer recovered {recovered} of {rent_held} rent lamports"
    );
    for ix in [f.release_ix(), f.payer_cancel_ix()] {
        f.reject(ix, false);
    }
    f.lock();
    assert_eq!(f.triple(), (200_000, 400_000, 390_000));
    assert_eq!(f.state().status, EscrowStatus::Locked);
}

#[test]
fn token_refund_window_boundary_is_exact_and_strangers_cannot_refund() {
    let mut f = Fixture::new();
    f.lock();
    let created = f.state().created_slot;
    f.svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS - 1);
    let err = f.reject(f.payer_cancel_ix(), false);
    assert!(err.contains("Custom(6006)"), "{err}");
    assert_eq!(f.state().status, EscrowStatus::Locked);

    f.svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS);
    // A stranger can never refund, wherever it points the money.
    let err = f.reject(f.cancel_ix(f.attacker.pubkey()), true);
    assert!(err.contains("Custom(6000)"), "{err}");
    let mut redirected = f.cancel_ix(f.attacker.pubkey());
    redirected.accounts[5].pubkey = f.attacker_token;
    f.reject(redirected, true);
    // The payer cannot send its refund to an account it does not own.
    let mut wrong_owner = f.payer_cancel_ix();
    wrong_owner.accounts[5].pubkey = f.attacker_token;
    let err = f.reject(wrong_owner, false);
    assert!(err.contains("Custom(6023)"), "{err}");

    let rent_held = f.lamports(f.escrow) + f.lamports(f.vault);
    let payer_before = f.lamports(f.payer.pubkey());
    let ix = f.payer_cancel_ix();
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    assert_eq!(f.triple(), (1_000_000, 0, 0));
    assert!(f.closed(f.escrow), "escrow record must close on refund");
    assert!(f.closed(f.vault), "vault must close on refund");
    let recovered = f.lamports(f.payer.pubkey()) - payer_before;
    assert!(
        recovered <= rent_held
            && rent_held - recovered < f.svm.minimum_balance_for_rent_exemption(0),
        "payer recovered {recovered} of {rent_held} rent lamports"
    );
    for ix in [f.release_ix(), f.payer_cancel_ix()] {
        f.reject(ix, false);
    }
}

#[test]
fn payee_claim_boundary_is_exact_and_pays_only_the_payee() {
    let mut f = Fixture::new();
    f.lock();
    let payee = f.payee.insecure_clone();
    let created = f.state().created_slot;
    f.svm.warp_to_slot(created + CLAIM_WINDOW_SLOTS - 1);
    let err = f.reject_as(f.payout_ix(payee.pubkey()), &payee);
    assert!(err.contains("Custom(6027)"), "{err}");

    f.svm.warp_to_slot(created + CLAIM_WINDOW_SLOTS);
    // A stranger cannot pay the escrow out, and even the payee cannot send it
    // to a token account somebody else owns.
    let err = f.reject(f.payout_ix(f.attacker.pubkey()), true);
    assert!(err.contains("Custom(6000)"), "{err}");
    let mut redirected = f.payout_ix(payee.pubkey());
    redirected.accounts[5].pubkey = f.attacker_token;
    let err = f.reject_as(redirected, &payee);
    assert!(err.contains("Custom(6023)"), "{err}");

    let rent_held = f.lamports(f.escrow) + f.lamports(f.vault);
    let payer_before = f.lamports(f.payer.pubkey());
    let ix = f.payout_ix(payee.pubkey());
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    assert_eq!(f.triple(), (600_000, 0, 390_000));
    assert_eq!(f.balance(f.treasury_token), 10_000);
    assert!(f.closed(f.escrow));
    assert!(f.closed(f.vault));
    assert_eq!(
        f.lamports(f.payer.pubkey()),
        payer_before + rent_held,
        "both rent reserves return to the payer on a claim"
    );
}

/// The claim window opens no later than the refund window: in between the
/// payer cannot refund, the payee can claim, and nothing is left to refund.
#[test]
fn payee_claim_before_the_refund_window_beats_a_later_refund() {
    let mut f = Fixture::new();
    f.lock();
    let payee = f.payee.insecure_clone();
    let created = f.state().created_slot;
    f.svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS - 1);
    let err = f.reject(f.payer_cancel_ix(), false);
    assert!(err.contains("Custom(6006)"), "{err}");
    let ix = f.payout_ix(payee.pubkey());
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    f.svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS + 1);
    f.reject(f.payer_cancel_ix(), false);
    assert_eq!(f.triple(), (600_000, 0, 390_000));
}

/// Each escrow carries its own windows, in slots from the lock, and a lock
/// with windows outside the rule is refused.
#[test]
fn token_windows_are_set_per_escrow_and_bounded() {
    let max = escrow::MAX_ESCROW_WINDOW_SLOTS;
    let with_windows = |f: &Fixture, claim: u64, cancel: u64| {
        let mut ix = f.lock_ix(400_000);
        ix.data = instruction::LockTokenEscrow {
            amount: 400_000,
            nonce: f.nonce,
            claim_window_slots: claim,
            cancel_window_slots: cancel,
        }
        .data();
        ix
    };
    let mut f = Fixture::new();
    for (claim, cancel) in [(0, 0), (0, 10), (11, 10), (1, max + 1), (max + 1, max + 1)] {
        let err = f.reject(with_windows(&f, claim, cancel), false);
        assert!(err.contains("Custom(6031)"), "({claim}, {cancel}): {err}");
        assert!(f.closed(f.escrow) && f.closed(f.vault));
    }

    // Ten seconds to claim, a hundred to refund.
    let ix = with_windows(&f, 25, 250);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    let state = f.state();
    assert_eq!(
        (state.claim_window_slots, state.cancel_window_slots),
        (25, 250)
    );
    let payee = f.payee.insecure_clone();
    f.svm.warp_to_slot(state.created_slot + 24);
    let err = f.reject_as(f.payout_ix(payee.pubkey()), &payee);
    assert!(err.contains("Custom(6027)"), "{err}");
    f.svm.warp_to_slot(state.created_slot + 25);
    let err = f.reject(f.payer_cancel_ix(), false);
    assert!(err.contains("Custom(6006)"), "{err}");
    let ix = f.payout_ix(payee.pubkey());
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    assert_eq!(f.triple(), (600_000, 0, 390_000));

    // Equal windows: at the boundary the payer's refund is allowed too.
    let mut f = Fixture::new();
    let ix = with_windows(&f, 25, 25);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    let created = f.state().created_slot;
    f.svm.warp_to_slot(created + 24);
    let err = f.reject(f.payer_cancel_ix(), false);
    assert!(err.contains("Custom(6006)"), "{err}");
    f.svm.warp_to_slot(created + 25);
    let ix = f.payer_cancel_ix();
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    assert_eq!(f.triple(), (1_000_000, 0, 0));
}

#[test]
fn payee_can_decline_immediately_and_cannot_take_the_tokens() {
    let mut f = Fixture::new();
    f.lock();
    let payee = f.payee.insecure_clone();
    // Declining pays the payer. The payee cannot name its own account.
    let mut to_self = f.cancel_ix(payee.pubkey());
    to_self.accounts[5].pubkey = f.recipient;
    let err = f.reject_as(to_self, &payee);
    assert!(err.contains("Custom(6023)"), "{err}");
    // Nor can it claim before the claim window.
    let err = f.reject_as(f.payout_ix(payee.pubkey()), &payee);
    assert!(err.contains("Custom(6027)"), "{err}");

    let rent_held = f.lamports(f.escrow) + f.lamports(f.vault);
    let payer_before = f.lamports(f.payer.pubkey());
    let ix = f.cancel_ix(payee.pubkey());
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    assert_eq!(f.triple(), (1_000_000, 0, 0));
    assert!(f.closed(f.escrow));
    assert!(f.closed(f.vault));
    assert_eq!(f.lamports(f.payer.pubkey()), payer_before + rent_held);
}

#[test]
fn refund_can_go_to_another_token_account_the_payer_owns() {
    let mut f = Fixture::new();
    f.lock();
    let other = f.new_token_account(f.payer.pubkey());
    let created = f.state().created_slot;
    f.svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS);
    // Only the payer may pick a different account. The payee declining into
    // that same payer-owned account is refused.
    let payee = f.payee.insecure_clone();
    let mut ix = f.cancel_ix(payee.pubkey());
    ix.accounts[5].pubkey = other;
    let err = f.reject_as(ix, &payee);
    assert!(err.contains("Custom(6023)"), "{err}");
    assert_eq!(f.balance(other), 0);
    let mut ix = f.payer_cancel_ix();
    ix.accounts[5].pubkey = other;
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    assert_eq!(f.triple(), (600_000, 0, 0));
    assert_eq!(f.balance(other), 400_000);
    assert!(f.closed(f.escrow));
}

#[test]
fn token_lock_rejects_zero_insufficient_funds_duplicate_and_wrong_accounts() {
    let mut f = Fixture::new();
    for amount in [0, 1_000_001] {
        let err = f.reject(f.lock_ix(amount), false);
        if amount == 0 {
            assert!(err.contains("Custom(6004)"), "{err}");
        }
        assert!(f.closed(f.escrow));
        assert!(f.closed(f.vault));
    }
    // Mismatched source authority, recipient authority, mint, program, and vault.
    for (index, key) in [
        (5, f.attacker_token),
        (6, f.attacker_token),
        (4, f.source),
        (7, system_program::id()),
        (1, f.attacker_token),
    ] {
        let mut ix = f.lock_ix(400_000);
        ix.accounts[index].pubkey = key;
        f.reject(ix, false);
    }
    f.lock();
    f.reject(f.lock_ix(400_000), false);
}

#[test]
fn token_lock_cap_is_enforced_at_the_exact_boundary() {
    let mut f = Fixture::new();
    f.mint_to_source(MAX_TOKEN_ESCROW_BASE_UNITS);
    let err = f.reject(f.lock_ix(MAX_TOKEN_ESCROW_BASE_UNITS + 1), false);
    assert!(err.contains("Custom(6025)"), "{err}");
    assert!(f.closed(f.escrow));
    assert!(f.closed(f.vault));
    let ix = f.lock_ix(MAX_TOKEN_ESCROW_BASE_UNITS);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    assert_eq!(f.balance(f.vault), MAX_TOKEN_ESCROW_BASE_UNITS);
}

#[test]
fn token_lock_rejects_payer_as_payee() {
    let mut f = Fixture::new();
    let mut ix = f.lock_ix(400_000);
    ix.accounts[3].pubkey = f.payer.pubkey();
    ix.accounts[6].pubkey = f.new_token_account(f.payer.pubkey());
    let err = f.reject(ix, false);
    assert!(err.contains("Custom(6007)"), "{err}");
    assert!(f.closed(f.escrow));
}

/// Tokens paid to an account owned by the escrow or its vault could never move
/// again, so neither can be named as the payee (the SOL lock has the same rule).
#[test]
fn token_lock_rejects_the_escrow_or_the_vault_as_payee() {
    for target in ["escrow", "vault"] {
        let mut f = Fixture::new();
        let payee = if target == "escrow" {
            f.escrow
        } else {
            f.vault
        };
        let mut ix = f.lock_ix(400_000);
        ix.accounts[3].pubkey = payee;
        ix.accounts[6].pubkey = f.new_token_account(payee);
        let err = f.reject(ix, false);
        assert!(err.contains("Custom(6007)"), "{target}: {err}");
        assert!(f.closed(f.escrow));
    }
}

/// A full payout sends nothing back, so the refund account's owner is not
/// checked: a payer that closed or restricted its own token accounts cannot
/// hold up the payee. The account that stands in receives nothing.
#[test]
fn full_payout_does_not_need_a_refund_account_the_payer_owns() {
    let mut f = Fixture::new();
    f.lock();
    let mut ix = f.release_ix();
    ix.accounts[7].pubkey = f.attacker_token;
    let payer = f.payer.insecure_clone();
    send(&mut f.svm, &[ix], &[&payer]).unwrap();
    assert_eq!(f.balance(f.attacker_token), 0);
    assert_eq!(f.balance(f.recipient), 390_000);
    assert_eq!(f.balance(f.treasury_token), 10_000);
    assert!(f.closed(f.escrow) && f.closed(f.vault));
}

/// When part of the vault goes back, it goes only to the payer: a partial
/// settlement, or a full release of a vault someone donated to, still refuses
/// a refund account the payer does not own.
#[test]
fn any_refund_still_needs_a_refund_account_the_payer_owns() {
    let mut f = Fixture::new();
    let ix = f.metered_lock_ix(400_000);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    let payee = f.payee.insecure_clone();
    let mut ix = f.settle_ix(payee.pubkey(), 100_000);
    ix.accounts[7].pubkey = f.attacker_token;
    let err = f.reject_as(ix, &payee);
    assert!(err.contains("Custom(6023)"), "{err}");

    // One donated token makes a full release refund something.
    f.mint_to_source(1);
    let donate = token_ix::transfer(
        &spl_token::ID,
        &f.source,
        &f.vault,
        &f.payer.pubkey(),
        &[],
        1,
    )
    .unwrap();
    let payer = f.payer.insecure_clone();
    send(&mut f.svm, &[donate], &[&payer]).unwrap();
    let mut ix = f.release_ix();
    ix.accounts[7].pubkey = f.attacker_token;
    let err = f.reject(ix, false);
    assert!(err.contains("Custom(6023)"), "{err}");
    assert_eq!(f.state().status, EscrowStatus::Locked);
}

#[test]
fn token_settlement_rejects_unauthorized_or_substituted_accounts() {
    let mut f = Fixture::new();
    f.lock();
    let created = f.state().created_slot;
    // Past the window, so every cancel rejection below is an account check and
    // not the window check.
    f.svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS);

    // Release: the authority must sign, and no account may be swapped.
    let mut unsigned = f.release_ix();
    unsigned.accounts[2].is_signer = false;
    let err = f.reject(unsigned, true);
    assert!(err.contains("AccountNotSigner"), "{err}");
    for (index, key) in [
        (1, f.attacker_token),
        (3, f.attacker.pubkey()),
        (4, f.source),
        (5, f.attacker_token),
        (5, f.source),
        (5, f.vault),
        (6, f.attacker_token),
        (6, f.recipient),
        (7, f.recipient),
        (8, system_program::id()),
    ] {
        let mut ix = f.release_ix();
        ix.accounts[index].pubkey = key;
        f.reject(ix, false);
    }

    // Cancel: some authority must sign, and no account may be swapped.
    let mut unsigned = f.payer_cancel_ix();
    unsigned.accounts[2].is_signer = false;
    let err = f.reject(unsigned, true);
    assert!(err.contains("AccountNotSigner"), "{err}");
    for (index, key) in [
        (1, f.attacker_token),
        (3, f.attacker.pubkey()),
        (4, f.source),
        (5, f.attacker_token),
        (5, f.recipient),
        (5, f.vault),
        (6, system_program::id()),
    ] {
        let mut ix = f.payer_cancel_ix();
        ix.accounts[index].pubkey = key;
        f.reject(ix, false);
    }
    assert_eq!(f.state().status, EscrowStatus::Locked);
    assert_eq!(f.balance(f.vault), 400_000);
}

#[test]
fn unsolicited_vault_tokens_do_not_block_settlement_or_leave_assets_stranded() {
    let mut f = Fixture::new();
    f.lock();
    let donate = token_ix::transfer_checked(
        &spl_token::ID,
        &f.source,
        &f.mint,
        &f.vault,
        &f.payer.pubkey(),
        &[],
        7,
        6,
    )
    .unwrap();
    send(&mut f.svm, &[donate], &[&f.payer]).unwrap();
    let ix = f.release_ix();
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    // The payee gets the locked amount less the fee; the donation goes back
    // to the payer's source account.
    assert_eq!(f.triple(), (600_000, 0, 390_000));
    assert_eq!(f.balance(f.treasury_token), 10_000);
}

#[test]
fn token_lock_rejects_an_allowlisted_address_with_the_wrong_decimals() {
    for decimals in [0, 9] {
        let mut f = Fixture::with_mint(USDC_MAINNET_MINT, decimals);
        let err = f.reject(f.lock_ix(400_000), false);
        assert!(err.contains("Custom(6026)"), "{err}");
        assert!(f.closed(f.escrow));
        assert!(f.closed(f.vault));
    }
}

#[test]
fn token_lock_rejects_a_consistent_mint_that_is_not_allowlisted() {
    // Everything about this mint and its accounts is valid; only its address is
    // not on the allowlist.
    let mut f = Fixture::with_mint(Pubkey::new_unique(), 6);
    let err = f.reject(f.lock_ix(400_000), false);
    assert!(err.contains("Custom(6026)"), "{err}");
    assert!(err.contains("MintNotAllowed"), "{err}");
    assert!(f.closed(f.escrow));
    assert!(f.closed(f.vault));
}

/// RAP-TOK-S1 for AUDD: the allowlisted classic mint locks, releases and
/// refunds exactly like USDC.
#[test]
fn audd_mainnet_mint_locks_releases_and_refunds() {
    let mut f = Fixture::with_mint(AUDD_MAINNET_MINT, 6);
    let before = f.triple();
    f.lock();
    assert_eq!(f.state().mint, AUDD_MAINNET_MINT);
    assert_eq!(f.balance(f.vault), 400_000);
    let ix = f.release_ix();
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    assert_eq!(f.triple(), (before.0 - 400_000, 0, before.2 + 390_000));
    assert_eq!(f.balance(f.treasury_token), 10_000);
    assert!(f.closed(f.escrow));
    assert!(f.closed(f.vault));

    let mut f = Fixture::with_mint(AUDD_MAINNET_MINT, 6);
    let before = f.triple();
    f.lock();
    let payee = f.payee.insecure_clone();
    let ix = f.cancel_ix(payee.pubkey());
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    assert_eq!(f.triple(), before);
    assert!(f.closed(f.escrow));
    assert!(f.closed(f.vault));
}

/// The default (mainnet) build must not accept devnet USDC.
#[cfg(not(feature = "devnet"))]
#[test]
fn default_build_rejects_devnet_usdc() {
    let mut f = Fixture::with_mint(USDC_DEVNET_MINT, 6);
    let err = f.reject(f.lock_ix(400_000), false);
    assert!(err.contains("Custom(6026)"), "{err}");
}

#[test]
fn token_lock_rejects_other_valid_mint_and_a_mismatched_token_program() {
    let mut f = Fixture::new();
    // A structurally valid classic mint still must match both source and
    // destination.
    let other_mint = Pubkey::new_unique();
    let mint_account = f.svm.get_account(&f.mint).unwrap();
    f.svm.set_account(other_mint, mint_account.clone()).unwrap();
    let mut ix = f.lock_ix(400_000);
    ix.accounts[4].pubkey = other_mint;
    let err = f.reject(ix, false);
    assert!(err.contains("Custom(6023)"), "{err}");

    // An allowlisted classic address whose mint account is owned by Token-2022
    // is refused: the allowlist names the program each mint must belong to.
    let token2022: Pubkey = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        .parse()
        .unwrap();
    let mut token2022_mint = mint_account.clone();
    token2022_mint.owner = token2022;
    f.svm.set_account(f.mint, token2022_mint).unwrap();
    let err = f.reject(f.lock_ix(400_000), false);
    assert!(err.contains("Custom(6026)"), "{err}");
    f.svm.set_account(f.mint, mint_account).unwrap();
    // Naming Token-2022 for a classic mint and classic accounts is refused.
    let mut ix = f.lock_ix(400_000);
    ix.accounts[7].pubkey = token2022;
    let err = f.reject(ix, false);
    assert!(err.contains("Custom(6023)"), "{err}");
    // Any other program in the token program slot is refused outright.
    let mut ix = f.lock_ix(400_000);
    ix.accounts[7].pubkey = system_program::id();
    let err = f.reject(ix, false);
    assert!(err.contains("InvalidProgramId"), "{err}");
    assert!(f.closed(f.escrow));
    assert!(f.closed(f.vault));
}

#[test]
fn token_lock_rejects_native_mint_without_moving_wrapped_sol_or_creating_records() {
    let mut f = Fixture::new();
    let mut mint_account = f.svm.get_account(&f.mint).unwrap();
    spl_token::state::Mint::pack(
        spl_token::state::Mint {
            decimals: spl_token::native_mint::DECIMALS,
            is_initialized: true,
            ..Default::default()
        },
        &mut mint_account.data,
    )
    .unwrap();
    f.mint = spl_token::native_mint::ID;
    f.svm.set_account(f.mint, mint_account).unwrap();
    // Initialize real wrapped-SOL accounts through SPL Token so account
    // constraints pass and the handler's own mint checks are exercised.
    let mut tokens = Vec::new();
    for owner in [f.payer.pubkey(), f.payee.pubkey()] {
        let account = f.new_token_account(owner);
        let state = TokenAccount::unpack(&f.svm.get_account(&account).unwrap().data).unwrap();
        assert!(state.is_native.is_some());
        tokens.push(account);
    }
    f.source = tokens[0];
    f.recipient = tokens[1];
    let source_before = f.svm.get_account(&f.source).unwrap();
    let recipient_before = f.svm.get_account(&f.recipient).unwrap();
    // Wrapped SOL is not on the allowlist, so the allowlist rejects it before
    // the older native-mint guard is reached.
    let err = f.reject(f.lock_ix(400_000), false);
    assert!(err.contains("Custom(6026)"), "{err}");
    assert_eq!(f.svm.get_account(&f.source).unwrap(), source_before);
    assert_eq!(f.svm.get_account(&f.recipient).unwrap(), recipient_before);
    assert!(f.closed(f.escrow));
    assert!(f.closed(f.vault));
}

#[test]
fn token_release_checks_recorded_address_even_for_same_owner_and_mint() {
    let mut f = Fixture::new();
    f.lock();
    let other = f.new_token_account(f.payee.pubkey());
    let mut ix = f.release_ix();
    ix.accounts[5].pubkey = other;
    let err = f.reject(ix, false);
    assert!(err.contains("Custom(6023)"), "{err}");
    assert_eq!(f.balance(other), 0);
    assert_eq!(f.state().status, EscrowStatus::Locked);
}

#[test]
fn token_state_serializes_to_exact_allocated_size_for_all_statuses() {
    use anchor_lang::AccountSerialize;
    for status in [
        EscrowStatus::Locked,
        EscrowStatus::Released,
        EscrowStatus::Cancelled,
    ] {
        let state = TokenEscrowAccount {
            payer: Pubkey::new_unique(),
            payee: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            source: Pubkey::new_unique(),
            recipient: Pubkey::new_unique(),
            amount: u64::MAX,
            nonce: [255; 16],
            status: status.clone(),
            created_slot: u64::MAX,
            bump: 255,
            metered: true,
            claim_window_slots: u64::MAX,
            cancel_window_slots: u64::MAX,
        };
        let mut bytes = Vec::new();
        state.try_serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), TokenEscrowAccount::LEN);
        let decoded = TokenEscrowAccount::try_deserialize(&mut bytes.as_slice()).unwrap();
        assert_eq!(decoded.status, status);
        assert_eq!(decoded.amount, u64::MAX);
        assert_eq!(decoded.mint, state.mint);
    }
}

// ── Metered (per-token) settlement and the 2.5% protocol fee ─────────────────

/// The payee settles a metered escrow at its actual cost straight away: it
/// gets the cost less 2.5%, the treasury 2.5%, and the payer the rest.
#[test]
fn payee_settles_a_metered_token_escrow_at_actual_cost() {
    let mut f = Fixture::new();
    let ix = f.metered_lock_ix(400_000);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    assert!(f.state().metered);
    let payee = f.payee.insecure_clone();
    let rent_held = f.lamports(f.escrow) + f.lamports(f.vault);
    let payer_before = f.lamports(f.payer.pubkey());
    let ix = f.settle_ix(payee.pubkey(), 123_457);
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    // fee = 123_457 * 250 / 10_000 = 3_086 (rounded down)
    assert_eq!(f.balance(f.treasury_token), 3_086);
    assert_eq!(f.triple(), (1_000_000 - 123_457, 0, 123_457 - 3_086));
    assert!(f.closed(f.escrow));
    assert!(f.closed(f.vault));
    assert_eq!(f.lamports(f.payer.pubkey()), payer_before + rent_held);
}

/// From the end of the launch rate a token payout pays the standard 5%, even
/// for an escrow locked before it.
#[test]
fn token_settlement_after_the_launch_rate_ends_pays_5_percent() {
    let mut f = Fixture::new();
    let ix = f.metered_lock_ix(400_000);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    let mut clock = f.svm.get_sysvar::<anchor_lang::prelude::Clock>();
    clock.unix_timestamp = escrow::LAUNCH_RATE_ENDS_UNIX;
    f.svm.set_sysvar(&clock);
    f.svm.expire_blockhash();
    let payee = f.payee.insecure_clone();
    let ix = f.settle_ix(payee.pubkey(), 123_457);
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    // fee = 123_457 * 500 / 10_000 = 6_172 (rounded down)
    assert_eq!(f.balance(f.treasury_token), 6_172);
    assert_eq!(f.triple(), (1_000_000 - 123_457, 0, 123_457 - 6_172));
}

#[test]
fn token_settlement_stays_within_the_authorised_maximum() {
    let mut f = Fixture::new();
    let ix = f.metered_lock_ix(400_000);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    let payee = f.payee.insecure_clone();
    for actual in [0, 400_001] {
        let err = f.reject_as(f.settle_ix(payee.pubkey(), actual), &payee);
        assert!(err.contains("Custom(6028)"), "{err}");
    }
    // The payee cannot send the refund to an account the payer does not own.
    let mut ix = f.settle_ix(payee.pubkey(), 1_000);
    ix.accounts[7].pubkey = f.attacker_token;
    let err = f.reject_as(ix, &payee);
    assert!(err.contains("Custom(6023)"), "{err}");
    // Nor can the fee go to anyone but the treasury's associated account, even
    // another account the treasury owns.
    let mut ix = f.settle_ix(payee.pubkey(), 1_000);
    ix.accounts[6].pubkey = f.attacker_token;
    let err = f.reject_as(ix, &payee);
    assert!(err.contains("Custom(6030)"), "{err}");
    let stray = f.new_token_account(PROTOCOL_TREASURY);
    let mut ix = f.settle_ix(payee.pubkey(), 1_000);
    ix.accounts[6].pubkey = stray;
    let err = f.reject_as(ix, &payee);
    assert!(err.contains("Custom(6030)"), "{err}");
    // A stranger cannot settle.
    let err = f.reject(f.settle_ix(f.attacker.pubkey(), 1_000), true);
    assert!(err.contains("Custom(6000)"), "{err}");
    // Exactly the maximum is allowed.
    let ix = f.settle_ix(payee.pubkey(), 400_000);
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    assert_eq!(f.triple(), (600_000, 0, 390_000));
    assert_eq!(f.balance(f.treasury_token), 10_000);
}

/// Nobody settles a fixed-price escrow: the payee waits for the claim window
/// and the payer releases in full. The payer never picks a smaller amount.
#[test]
fn nobody_settles_a_fixed_price_token_escrow() {
    let mut f = Fixture::new();
    f.lock();
    assert!(!f.state().metered);
    let payee = f.payee.insecure_clone();
    let err = f.reject_as(f.settle_ix(payee.pubkey(), 1_000), &payee);
    assert!(err.contains("Custom(6029)"), "{err}");
    for actual in [1, 200_000, 400_000] {
        let err = f.reject(f.settle_ix(f.payer.pubkey(), actual), false);
        assert!(err.contains("Custom(6000)"), "{actual}: {err}");
    }
    let ix = f.release_ix();
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    assert_eq!(f.triple(), (600_000, 0, 390_000));
    assert_eq!(f.balance(f.treasury_token), 10_000);
    assert!(f.closed(f.escrow));
}

/// A metered escrow is the payee's to settle, never the payer's.
#[test]
fn the_payer_cannot_settle_a_metered_token_escrow() {
    let mut f = Fixture::new();
    let ix = f.metered_lock_ix(400_000);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    for actual in [1, 400_000] {
        let err = f.reject(f.settle_ix(f.payer.pubkey(), actual), false);
        assert!(err.contains("Custom(6000)"), "{actual}: {err}");
    }
    let payee = f.payee.insecure_clone();
    let ix = f.settle_ix(payee.pubkey(), 200_000);
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    assert_eq!(f.triple(), (800_000, 0, 195_000));
    assert_eq!(f.balance(f.treasury_token), 5_000);
    assert!(f.closed(f.escrow));
}

/// The payer re-owning its source account after locking cannot block the
/// payee's settlement: the refund goes to another account the payer owns.
#[test]
fn payee_settles_even_after_the_payer_gives_away_its_source_account() {
    let mut f = Fixture::new();
    let ix = f.metered_lock_ix(400_000);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    let give_away = token_ix::set_authority(
        &spl_token::ID,
        &f.source,
        Some(&f.attacker.pubkey()),
        token_ix::AuthorityType::AccountOwner,
        &f.payer.pubkey(),
        &[],
    )
    .unwrap();
    send(&mut f.svm, &[give_away], &[&f.payer]).unwrap();
    let payee = f.payee.insecure_clone();
    // The recorded source is no longer the payer's, so it is refused...
    let err = f.reject_as(f.settle_ix(payee.pubkey(), 100_000), &payee);
    assert!(err.contains("Custom(6023)"), "{err}");
    // ...and any account the payer does own works.
    let other = f.new_token_account(f.payer.pubkey());
    let mut ix = f.settle_ix(payee.pubkey(), 100_000);
    ix.accounts[7].pubkey = other;
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    assert_eq!(f.balance(other), 300_000);
    assert_eq!(f.balance(f.recipient), 97_500);
    assert_eq!(f.balance(f.treasury_token), 2_500);
    assert!(f.closed(f.escrow));
}

// ── Frozen and replaced payout accounts ──────────────────────────────────────

/// A lock is refused while the payer still holds the tokens when the account
/// that would be paid, or the account paying, is frozen.
#[test]
fn token_lock_rejects_a_frozen_recipient_or_source() {
    let mut f = Fixture::new();
    f.set_frozen(f.recipient, true);
    let err = f.reject(f.lock_ix(400_000), false);
    assert!(err.contains("Custom(6023)"), "{err}");
    assert!(f.closed(f.escrow) && f.closed(f.vault));
    f.set_frozen(f.recipient, false);

    f.set_frozen(f.source, true);
    let err = f.reject(f.metered_lock_ix(400_000), false);
    assert!(err.contains("Custom(6023)"), "{err}");
    assert!(f.closed(f.escrow) && f.closed(f.vault));
    f.set_frozen(f.source, false);

    f.svm.expire_blockhash();
    f.lock();
    assert_eq!(f.triple(), (600_000, 400_000, 0));
}

/// The payee's own claim may go to any token account of the mint that the
/// payee owns, so a recipient frozen after the lock does not stop it. The
/// payer's release still pays only the recorded recipient.
#[test]
fn payee_claims_to_another_account_it_owns_when_the_recorded_one_is_frozen() {
    let mut f = Fixture::new();
    f.lock();
    let payee = f.payee.insecure_clone();
    let other = f.new_token_account(payee.pubkey());
    f.set_frozen(f.recipient, true);
    let created = f.state().created_slot;
    f.svm.warp_to_slot(created + CLAIM_WINDOW_SLOTS);

    // The recorded recipient cannot be paid by anyone.
    let payer = f.payer.insecure_clone();
    let ix = f.release_ix();
    assert!(send(&mut f.svm, &[ix], &[&payer]).is_err());
    let ix = f.payout_ix(payee.pubkey());
    assert!(send(&mut f.svm, &[ix], &[&payee]).is_err());
    // The payer cannot choose another account for the payee.
    let mut ix = f.release_ix();
    ix.accounts[5].pubkey = other;
    let err = f.reject(ix, false);
    assert!(err.contains("Custom(6023)"), "{err}");
    // The payee cannot name the treasury's, the payer's or the vault's account.
    for wrong in [f.treasury_token, f.source, f.vault] {
        let mut ix = f.payout_ix(payee.pubkey());
        ix.accounts[5].pubkey = wrong;
        assert!(send(&mut f.svm, &[ix], &[&payee]).is_err());
    }
    assert_eq!(f.state().status, EscrowStatus::Locked);

    let rent_held = f.lamports(f.escrow) + f.lamports(f.vault);
    let payer_before = f.lamports(f.payer.pubkey());
    let mut ix = f.payout_ix(payee.pubkey());
    ix.accounts[5].pubkey = other;
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    assert_eq!(f.triple(), (600_000, 0, 0));
    assert_eq!(f.balance(other), 390_000);
    assert_eq!(f.balance(f.treasury_token), 10_000);
    assert!(f.closed(f.escrow) && f.closed(f.vault));
    assert_eq!(f.lamports(f.payer.pubkey()), payer_before + rent_held);
}

/// The same holds when the payee settles a metered escrow: it is paid at
/// another account it owns, the fee and the refund go where they always do.
#[test]
fn payee_settles_to_another_account_it_owns() {
    let mut f = Fixture::new();
    let ix = f.metered_lock_ix(400_000);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    let payee = f.payee.insecure_clone();
    let other = f.new_token_account(payee.pubkey());
    // The recorded recipient was closed after the lock.
    let close = token_ix::close_account(
        &spl_token::ID,
        &f.recipient,
        &payee.pubkey(),
        &payee.pubkey(),
        &[],
    )
    .unwrap();
    send(&mut f.svm, &[close], &[&payee]).unwrap();

    let mut ix = f.settle_ix(payee.pubkey(), 123_457);
    ix.accounts[5].pubkey = f.attacker_token;
    assert!(send(&mut f.svm, &[ix], &[&payee]).is_err());

    let mut ix = f.settle_ix(payee.pubkey(), 123_457);
    ix.accounts[5].pubkey = other;
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    assert_eq!(f.balance(other), 123_457 - 3_086);
    assert_eq!(f.balance(f.treasury_token), 3_086);
    assert_eq!(f.balance(f.source), 1_000_000 - 123_457);
    assert!(f.closed(f.escrow) && f.closed(f.vault));
}

#[path = "common/instance.rs"]
mod instance;
