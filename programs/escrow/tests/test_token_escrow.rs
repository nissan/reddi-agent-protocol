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
    CANCEL_WINDOW_SLOTS,
};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

fn send(svm: &mut LiteSVM, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
    // Ensure repeated instructions really execute rather than hitting the signature cache.
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&signers[0].pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|err| format!("{err:?}"))
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
    escrow: Pubkey,
    vault: Pubkey,
    nonce: [u8; 16],
}

impl Fixture {
    fn new() -> Self {
        Self::with_decimals(6)
    }
    fn with_decimals(decimals: u8) -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(
            escrow::id(),
            include_bytes!("../../../target/deploy/escrow.so"),
        )
        .unwrap();
        let payer = Keypair::new();
        let payee = Keypair::new();
        let attacker = Keypair::new();
        svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();
        let mint = Keypair::new();
        send(
            &mut svm,
            &[
                system_instruction::create_account(
                    &payer.pubkey(),
                    &mint.pubkey(),
                    10_000_000,
                    82,
                    &spl_token::ID,
                ),
                token_ix::initialize_mint2(
                    &spl_token::ID,
                    &mint.pubkey(),
                    &payer.pubkey(),
                    None,
                    decimals,
                )
                .unwrap(),
            ],
            &[&payer, &mint],
        )
        .unwrap();
        let mut tokens = Vec::new();
        for owner in [payer.pubkey(), payee.pubkey(), attacker.pubkey()] {
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
                    token_ix::initialize_account3(
                        &spl_token::ID,
                        &account.pubkey(),
                        &mint.pubkey(),
                        &owner,
                    )
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
                &mint.pubkey(),
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
        Self {
            svm,
            payer,
            payee,
            attacker,
            mint: mint.pubkey(),
            source: tokens[0],
            recipient: tokens[1],
            attacker_token: tokens[2],
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
    fn settle_ix(&self, refund: bool) -> Instruction {
        let metas = accounts::SettleTokenEscrow {
            escrow: self.escrow,
            vault: self.vault,
            payer: self.payer.pubkey(),
            mint: self.mint,
            destination: if refund { self.source } else { self.recipient },
            token_program: spl_token::ID,
        }
        .to_account_metas(None);
        Instruction::new_with_bytes(
            escrow::id(),
            &if refund {
                instruction::CancelTokenEscrow {}.data()
            } else {
                instruction::ReleaseTokenEscrow {}.data()
            },
            metas,
        )
    }
    fn balance(&self, key: Pubkey) -> u64 {
        self.svm
            .get_account(&key)
            .filter(|a| !a.data.is_empty())
            .map(|a| TokenAccount::unpack(&a.data).unwrap().amount)
            .unwrap_or(0)
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
        let before = [
            self.balance(self.source),
            self.balance(self.vault),
            self.balance(self.recipient),
            self.balance(self.attacker_token),
        ];
        let signer = if attacker {
            &self.attacker
        } else {
            &self.payer
        };
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
}

#[test]
fn token_lock_release_conserves_assets_and_records_terminal_state() {
    let mut f = Fixture::new();
    f.lock();
    assert_eq!(
        (
            f.balance(f.source),
            f.balance(f.vault),
            f.balance(f.recipient)
        ),
        (600_000, 400_000, 0)
    );
    let state = f.state();
    assert_eq!(state.status, EscrowStatus::Locked);
    assert_eq!(state.mint, f.mint);
    assert_eq!(state.source, f.source);
    assert_eq!(state.recipient, f.recipient);
    let vault = TokenAccount::unpack(&f.svm.get_account(&f.vault).unwrap().data).unwrap();
    assert_eq!(vault.owner, f.escrow);
    assert_eq!(vault.mint, f.mint);
    let ix = f.settle_ix(false);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    assert_eq!(
        (
            f.balance(f.source),
            f.balance(f.vault),
            f.balance(f.recipient)
        ),
        (600_000, 0, 400_000)
    );
    assert_eq!(f.state().status, EscrowStatus::Released);
    assert!(f.svm.get_account(&f.vault).is_none_or(|a| a.lamports == 0));
    for ix in [f.settle_ix(false), f.settle_ix(true), f.lock_ix(400_000)] {
        f.reject(ix, false);
    }
}

#[test]
fn token_refund_obeys_exact_existing_slot_boundary_and_original_source() {
    let mut f = Fixture::new();
    f.lock();
    let created = f.state().created_slot;
    f.svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS - 1);
    let err = f.reject(f.settle_ix(true), false);
    assert!(err.contains("Custom(6006)"), "{err}");
    assert_eq!(f.state().status, EscrowStatus::Locked);
    f.svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS);
    let mut redirected = f.settle_ix(true);
    redirected.accounts[4].pubkey = f.attacker_token;
    f.reject(redirected, false);
    let ix = f.settle_ix(true);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    assert_eq!(
        (
            f.balance(f.source),
            f.balance(f.vault),
            f.balance(f.recipient)
        ),
        (1_000_000, 0, 0)
    );
    assert_eq!(f.state().status, EscrowStatus::Cancelled);
    for ix in [f.settle_ix(false), f.settle_ix(true), f.lock_ix(400_000)] {
        f.reject(ix, false);
    }
}

#[test]
fn token_lock_rejects_zero_insufficient_funds_duplicate_and_wrong_accounts() {
    let mut f = Fixture::new();
    for amount in [0, 1_000_001] {
        let err = f.reject(f.lock_ix(amount), false);
        if amount == 0 {
            assert!(err.contains("Custom(6004)"), "{err}");
        }
        assert!(f.svm.get_account(&f.escrow).is_none_or(|a| a.lamports == 0));
        assert!(f.svm.get_account(&f.vault).is_none_or(|a| a.lamports == 0));
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
fn token_settlement_rejects_unauthorized_or_substituted_accounts() {
    let mut f = Fixture::new();
    f.lock();
    for refund in [false, true] {
        let mut unsigned = f.settle_ix(refund);
        unsigned.accounts[2].is_signer = false;
        let err = f.reject(unsigned, true);
        assert!(err.contains("AccountNotSigner"), "{err}");
        let mut ix = f.settle_ix(refund);
        ix.accounts[2].pubkey = f.attacker.pubkey();
        f.reject(ix, true);
        for (index, key) in [
            (1, f.attacker_token),
            (3, f.source),
            (4, f.attacker_token),
            (5, system_program::id()),
        ] {
            let mut ix = f.settle_ix(refund);
            ix.accounts[index].pubkey = key;
            f.reject(ix, false);
        }
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
    let ix = f.settle_ix(false);
    send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
    assert_eq!(
        (
            f.balance(f.source),
            f.balance(f.vault),
            f.balance(f.recipient)
        ),
        (599_993, 0, 400_007)
    );
}

#[test]
fn token_amounts_use_mint_decimals_without_currency_assumptions() {
    for decimals in [0, 9] {
        let mut f = Fixture::with_decimals(decimals);
        f.lock();
        let ix = f.settle_ix(false);
        send(&mut f.svm, &[ix], &[&f.payer]).unwrap();
        assert_eq!(
            (f.balance(f.source), f.balance(f.recipient)),
            (600_000, 400_000)
        );
    }
}

#[test]
fn token_lock_rejects_other_valid_mint_and_token2022_owned_mint() {
    let mut f = Fixture::new();
    // Arbitrary local fixture identities only. A structurally valid classic mint
    // still must match both source and destination; no currency allowlist assumed.
    let other_mint = Pubkey::new_unique();
    let mint_account = f.svm.get_account(&f.mint).unwrap();
    f.svm.set_account(other_mint, mint_account.clone()).unwrap();
    let mut ix = f.lock_ix(400_000);
    ix.accounts[4].pubkey = other_mint;
    let err = f.reject(ix, false);
    assert!(err.contains("ConstraintTokenMint"), "{err}");

    // Token-2022 base mint bytes can resemble classic bytes. Ownership, not
    // layout alone, must reject it before any token transfer or persistent init.
    let token2022: Pubkey = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        .parse()
        .unwrap();
    let mut token2022_mint = mint_account.clone();
    token2022_mint.owner = token2022;
    f.svm.set_account(f.mint, token2022_mint).unwrap();
    let err = f.reject(f.lock_ix(400_000), false);
    assert!(err.contains("AccountOwnedByWrongProgram"), "{err}");
    f.svm.set_account(f.mint, mint_account).unwrap();
    let mut ix = f.lock_ix(400_000);
    ix.accounts[7].pubkey = token2022;
    let err = f.reject(ix, false);
    assert!(err.contains("InvalidProgramId"), "{err}");
    assert!(f.svm.get_account(&f.escrow).is_none_or(|a| a.lamports == 0));
    assert!(f.svm.get_account(&f.vault).is_none_or(|a| a.lamports == 0));
}

#[test]
fn token_settlement_checks_recorded_address_even_for_same_owner_and_mint() {
    let mut f = Fixture::new();
    f.lock();
    let other = Keypair::new();
    send(
        &mut f.svm,
        &[
            system_instruction::create_account(
                &f.payer.pubkey(),
                &other.pubkey(),
                10_000_000,
                165,
                &spl_token::ID,
            ),
            token_ix::initialize_account3(
                &spl_token::ID,
                &other.pubkey(),
                &f.mint,
                &f.payee.pubkey(),
            )
            .unwrap(),
        ],
        &[&f.payer, &other],
    )
    .unwrap();
    let mut ix = f.settle_ix(false);
    ix.accounts[4].pubkey = other.pubkey();
    f.reject(ix, false);
    assert_eq!(f.balance(other.pubkey()), 0);
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
