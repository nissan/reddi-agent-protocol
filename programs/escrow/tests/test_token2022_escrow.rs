//! Token-2022 escrow behavior for the two allowlisted Token-2022 mints (PYUSD,
//! USDG). The mint fixture is a byte copy of the PYUSD mint account read from
//! mainnet on 20 November 2026, installed locally with its authorities replaced
//! by disposable test keys. No real token, RPC, or operator wallet is involved.
use anchor_lang::{
    prelude::Pubkey,
    solana_program::{
        instruction::Instruction, program_pack::Pack, system_instruction, system_program,
    },
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use anchor_spl::token::spl_token::{self, instruction as token_ix};
use escrow::{
    accounts, instruction,
    state::TokenEscrowAccount,
    token_accounts::{TOKEN_2022_ID, TOKEN_2022_VAULT_LEN},
    CANCEL_WINDOW_SLOTS, CLAIM_WINDOW_SLOTS, PYUSD_MAINNET_MINT, USDC_MAINNET_MINT,
    USDG_MAINNET_MINT,
};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

const MINT_FIXTURE: &[u8] = include_bytes!("fixtures/pyusd_mainnet_mint_2026-11-20.bin");
const EXT_TRANSFER_FEE_CONFIG: u16 = 1;
const EXT_PERMANENT_DELEGATE: u16 = 12;
const EXT_TRANSFER_HOOK: u16 = 14;

fn send(svm: &mut LiteSVM, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&signers[0].pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|err| format!("{err:?}"))
}

/// Token-2022 shares the classic encoding for the instructions used here.
fn t22(mut ix: Instruction) -> Instruction {
    ix.program_id = TOKEN_2022_ID;
    ix
}

/// Byte range of one extension's value inside a Token-2022 account.
fn extension(data: &[u8], kind: u16) -> std::ops::Range<usize> {
    let mut at = 166;
    while at + 4 <= data.len() {
        let found = u16::from_le_bytes([data[at], data[at + 1]]);
        let len = usize::from(u16::from_le_bytes([data[at + 2], data[at + 3]]));
        if found == kind {
            return at + 4..at + 4 + len;
        }
        assert_ne!(found, 0, "extension {kind} not present");
        at += 4 + len;
    }
    panic!("extension {kind} not present");
}

struct Fixture {
    svm: LiteSVM,
    payer: Keypair,
    payee: Keypair,
    /// Stands in for the issuer: mint, freeze and permanent-delegate authority.
    issuer: Keypair,
    mint: Pubkey,
    source: Pubkey,
    recipient: Pubkey,
    issuer_token: Pubkey,
    escrow: Pubkey,
    vault: Pubkey,
    nonce: [u8; 16],
}

impl Fixture {
    fn new(mint: Pubkey) -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(
            escrow::id(),
            include_bytes!("../../../target/deploy/escrow.so"),
        )
        .unwrap();
        let payer = Keypair::new();
        let payee = Keypair::new();
        let issuer = Keypair::new();
        for key in [&payer, &payee, &issuer] {
            svm.airdrop(&key.pubkey(), 10_000_000_000).unwrap();
        }
        let mut data = MINT_FIXTURE.to_vec();
        // Base mint: authority at 4..36, supply at 36..44, freeze authority at 50..82.
        data[4..36].copy_from_slice(issuer.pubkey().as_ref());
        data[36..44].copy_from_slice(&0u64.to_le_bytes());
        data[50..82].copy_from_slice(issuer.pubkey().as_ref());
        let delegate = extension(&data, EXT_PERMANENT_DELEGATE);
        data[delegate].copy_from_slice(issuer.pubkey().as_ref());
        svm.set_account(
            mint,
            solana_account::Account {
                lamports: 100_000_000,
                data,
                owner: TOKEN_2022_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        let nonce = [72; 16];
        let escrow = Pubkey::find_program_address(
            &[b"token-escrow", payer.pubkey().as_ref(), &nonce],
            &escrow::id(),
        )
        .0;
        let vault =
            Pubkey::find_program_address(&[b"token-vault", escrow.as_ref()], &escrow::id()).0;
        let mut f = Self {
            svm,
            payer,
            payee,
            issuer,
            mint,
            source: Pubkey::default(),
            recipient: Pubkey::default(),
            issuer_token: Pubkey::default(),
            escrow,
            vault,
            nonce,
        };
        f.source = f.new_token_account(f.payer.pubkey());
        f.recipient = f.new_token_account(f.payee.pubkey());
        f.issuer_token = f.new_token_account(f.issuer.pubkey());
        f.mint_to(f.source, 1_000_000);
        f.mint_to(f.issuer_token, 1_000_000);
        f
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
                    TOKEN_2022_VAULT_LEN as u64,
                    &TOKEN_2022_ID,
                ),
                t22(token_ix::initialize_account3(
                    &spl_token::ID,
                    &account.pubkey(),
                    &self.mint,
                    &owner,
                )
                .unwrap()),
            ],
            &[&self.payer, &account],
        )
        .unwrap();
        account.pubkey()
    }
    fn mint_to(&mut self, account: Pubkey, amount: u64) {
        let ix = t22(token_ix::mint_to(
            &spl_token::ID,
            &self.mint,
            &account,
            &self.issuer.pubkey(),
            &[],
            amount,
        )
        .unwrap());
        let issuer = self.issuer.insecure_clone();
        send(&mut self.svm, &[ix], &[&issuer]).unwrap();
    }
    /// Sets the mint's transfer fee, as the issuer could, effective at once.
    fn set_transfer_fee(&mut self, bps: u16) {
        let mut account = self.svm.get_account(&self.mint).unwrap();
        let config = extension(&account.data, EXT_TRANSFER_FEE_CONFIG);
        // After two authorities (64) and the withheld amount (8): two fee records
        // of epoch u64, maximum fee u64, basis points u16.
        for record in [config.start + 72, config.start + 90] {
            account.data[record..record + 8].copy_from_slice(&0u64.to_le_bytes());
            account.data[record + 8..record + 16].copy_from_slice(&u64::MAX.to_le_bytes());
            account.data[record + 16..record + 18].copy_from_slice(&bps.to_le_bytes());
        }
        self.svm.set_account(self.mint, account).unwrap();
    }
    fn transfer(
        &mut self,
        from: Pubkey,
        to: Pubkey,
        authority: &Keypair,
        amount: u64,
    ) -> Result<(), String> {
        let ix = t22(token_ix::transfer_checked(
            &spl_token::ID,
            &from,
            &self.mint,
            &to,
            &authority.pubkey(),
            &[],
            amount,
            6,
        )
        .unwrap());
        send(&mut self.svm, &[ix], &[authority])
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
                token_program: TOKEN_2022_ID,
                system_program: system_program::id(),
            }
            .to_account_metas(None),
        )
    }
    fn payout_ix(&self, authority: Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::ReleaseTokenEscrow {}.data(),
            accounts::ReleaseTokenEscrow {
                escrow: self.escrow,
                vault: self.vault,
                authority,
                payer: self.payer.pubkey(),
                mint: self.mint,
                destination: self.recipient,
                token_program: TOKEN_2022_ID,
            }
            .to_account_metas(None),
        )
    }
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
                token_program: TOKEN_2022_ID,
            }
            .to_account_metas(None),
        )
    }
    fn lock(&mut self) {
        let ix = self.lock_ix(400_000);
        let payer = self.payer.insecure_clone();
        send(&mut self.svm, &[ix], &[&payer]).unwrap();
    }
    fn release(&mut self) -> Result<(), String> {
        let ix = self.payout_ix(self.payer.pubkey());
        let payer = self.payer.insecure_clone();
        send(&mut self.svm, &[ix], &[&payer])
    }
    fn balance(&self, key: Pubkey) -> u64 {
        self.svm
            .get_account(&key)
            .filter(|a| !a.data.is_empty())
            .map(|a| {
                spl_token::state::Account::unpack(&a.data[..165])
                    .unwrap()
                    .amount
            })
            .unwrap_or(0)
    }
    fn closed(&self, key: Pubkey) -> bool {
        self.svm
            .get_account(&key)
            .map(|a| a.lamports == 0 && a.data.is_empty())
            .unwrap_or(true)
    }
    fn triple(&self) -> (u64, u64, u64) {
        (
            self.balance(self.source),
            self.balance(self.vault),
            self.balance(self.recipient),
        )
    }
    fn created_slot(&self) -> u64 {
        TokenEscrowAccount::try_deserialize(
            &mut self.svm.get_account(&self.escrow).unwrap().data.as_slice(),
        )
        .unwrap()
        .created_slot
    }
}

#[test]
fn fixture_is_the_real_mint_layout_with_a_zero_fee_and_no_hook() {
    assert_eq!(MINT_FIXTURE.len(), 866);
    assert_eq!(MINT_FIXTURE[44], 6, "decimals");
    assert_eq!(MINT_FIXTURE[165], 1, "account type: mint");
    let fee = extension(MINT_FIXTURE, EXT_TRANSFER_FEE_CONFIG);
    assert_eq!(fee.len(), 108);
    assert_eq!(
        &MINT_FIXTURE[fee.start + 88..fee.start + 90],
        &[0, 0],
        "older fee bps"
    );
    assert_eq!(
        &MINT_FIXTURE[fee.start + 106..fee.start + 108],
        &[0, 0],
        "newer fee bps"
    );
    let hook = extension(MINT_FIXTURE, EXT_TRANSFER_HOOK);
    assert!(
        MINT_FIXTURE[hook.start + 32..hook.end]
            .iter()
            .all(|b| *b == 0),
        "hook program unset"
    );
}

// RAP-TOK-S1
#[test]
fn pyusd_and_usdg_lock_then_release_refund_decline_and_claim() {
    for mint in [PYUSD_MAINNET_MINT, USDG_MAINNET_MINT] {
        // Release by the payer.
        let mut f = Fixture::new(mint);
        f.lock();
        assert_eq!(f.triple(), (600_000, 400_000, 0));
        assert_eq!(
            f.svm.get_account(&f.vault).unwrap().data.len(),
            TOKEN_2022_VAULT_LEN
        );
        assert_eq!(f.svm.get_account(&f.vault).unwrap().owner, TOKEN_2022_ID);
        f.release().unwrap();
        assert_eq!(f.triple(), (600_000, 0, 400_000));
        assert!(f.closed(f.escrow) && f.closed(f.vault));

        // Decline by the payee, at once.
        let mut f = Fixture::new(mint);
        f.lock();
        let payee = f.payee.insecure_clone();
        let ix = f.cancel_ix(payee.pubkey());
        send(&mut f.svm, &[ix], &[&payee]).unwrap();
        assert_eq!(f.triple(), (1_000_000, 0, 0));
        assert!(f.closed(f.escrow) && f.closed(f.vault));

        // Refund by the payer, only once the cancel window has elapsed.
        let mut f = Fixture::new(mint);
        f.lock();
        let payer = f.payer.insecure_clone();
        let created = f.created_slot();
        f.svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS - 1);
        let ix = f.cancel_ix(payer.pubkey());
        let err = send(&mut f.svm, &[ix], &[&payer]).unwrap_err();
        assert!(err.contains("Custom(6006)"), "{err}");
        f.svm.warp_to_slot(created + CANCEL_WINDOW_SLOTS);
        let ix = f.cancel_ix(payer.pubkey());
        send(&mut f.svm, &[ix], &[&payer]).unwrap();
        assert_eq!(f.triple(), (1_000_000, 0, 0));
        assert!(f.closed(f.escrow) && f.closed(f.vault));

        // Claim by the payee, only once the claim window has elapsed.
        let mut f = Fixture::new(mint);
        f.lock();
        let payee = f.payee.insecure_clone();
        let created = f.created_slot();
        f.svm.warp_to_slot(created + CLAIM_WINDOW_SLOTS - 1);
        let ix = f.payout_ix(payee.pubkey());
        let err = send(&mut f.svm, &[ix], &[&payee]).unwrap_err();
        assert!(err.contains("Custom(6027)"), "{err}");
        f.svm.warp_to_slot(created + CLAIM_WINDOW_SLOTS);
        let ix = f.payout_ix(payee.pubkey());
        send(&mut f.svm, &[ix], &[&payee]).unwrap();
        assert_eq!(f.triple(), (600_000, 0, 400_000));
        assert!(f.closed(f.escrow) && f.closed(f.vault));
    }
}

#[test]
fn strangers_cannot_settle_a_token_2022_escrow() {
    let mut f = Fixture::new(PYUSD_MAINNET_MINT);
    f.lock();
    let issuer = f.issuer.insecure_clone();
    for mut ix in [f.payout_ix(issuer.pubkey()), f.cancel_ix(issuer.pubkey())] {
        ix.accounts[5].pubkey = f.issuer_token;
        let err = send(&mut f.svm, &[ix], &[&issuer]).unwrap_err();
        assert!(
            err.contains("Custom(6000)") || err.contains("Custom(6023)"),
            "{err}"
        );
    }
    assert_eq!(f.triple(), (600_000, 400_000, 0));
}

// RAP-TOK-S2
#[test]
fn token_2022_is_refused_for_a_mint_that_is_not_on_its_allowlist() {
    // A Token-2022 mint at an address that is not allowlisted.
    let mut f = Fixture::new(Pubkey::new_unique());
    let payer = f.payer.insecure_clone();
    let ix = f.lock_ix(400_000);
    let err = send(&mut f.svm, &[ix], &[&payer]).unwrap_err();
    assert!(err.contains("Custom(6026)"), "{err}");
    // A Token-2022 mint sitting at a classic allowlisted address.
    let mut f = Fixture::new(USDC_MAINNET_MINT);
    let payer = f.payer.insecure_clone();
    let ix = f.lock_ix(400_000);
    let err = send(&mut f.svm, &[ix], &[&payer]).unwrap_err();
    assert!(err.contains("Custom(6026)"), "{err}");
    // An allowlisted Token-2022 mint presented with the classic program.
    let mut f = Fixture::new(PYUSD_MAINNET_MINT);
    let payer = f.payer.insecure_clone();
    let mut ix = f.lock_ix(400_000);
    ix.accounts[7].pubkey = spl_token::ID;
    let err = send(&mut f.svm, &[ix], &[&payer]).unwrap_err();
    assert!(
        err.contains("Custom(6023)") || err.contains("Custom(6026)"),
        "{err}"
    );
    assert!(f.closed(f.escrow) && f.closed(f.vault));
    assert_eq!(f.balance(f.source), 1_000_000);
}

#[test]
fn settlement_refuses_the_wrong_token_program() {
    let mut f = Fixture::new(PYUSD_MAINNET_MINT);
    f.lock();
    let payer = f.payer.insecure_clone();
    let mut ix = f.payout_ix(payer.pubkey());
    ix.accounts[6].pubkey = spl_token::ID;
    let err = send(&mut f.svm, &[ix], &[&payer]).unwrap_err();
    assert!(err.contains("Custom(6023)"), "{err}");
    assert_eq!(f.triple(), (600_000, 400_000, 0));
}

#[test]
fn a_transfer_fee_at_lock_time_refuses_the_lock() {
    let mut f = Fixture::new(PYUSD_MAINNET_MINT);
    f.set_transfer_fee(100);
    let payer = f.payer.insecure_clone();
    let ix = f.lock_ix(400_000);
    let err = send(&mut f.svm, &[ix], &[&payer]).unwrap_err();
    assert!(err.contains("InvalidTokenAmount"), "{err}");
    assert!(f.closed(f.escrow) && f.closed(f.vault));
    assert_eq!(f.balance(f.source), 1_000_000);
}

// RAP-TOK-S3
#[test]
fn a_transfer_fee_switched_on_after_lock_does_not_strand_the_escrow() {
    let mut f = Fixture::new(USDG_MAINNET_MINT);
    f.lock();
    f.set_transfer_fee(100);
    f.release().unwrap();
    // 1% of 400,000 is withheld by the token program on the recipient account.
    assert_eq!(f.triple(), (600_000, 0, 396_000));
    assert!(f.closed(f.escrow) && f.closed(f.vault));

    let mut f = Fixture::new(USDG_MAINNET_MINT);
    f.lock();
    f.set_transfer_fee(100);
    let payee = f.payee.insecure_clone();
    let ix = f.cancel_ix(payee.pubkey());
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    assert_eq!(f.triple(), (996_000, 0, 0));
    assert!(f.closed(f.escrow) && f.closed(f.vault));
}

#[test]
fn a_fee_bearing_donation_cannot_block_settlement() {
    let mut f = Fixture::new(PYUSD_MAINNET_MINT);
    f.lock();
    f.set_transfer_fee(100);
    // The donation leaves withheld fees on the vault, which blocks closing it.
    let issuer = f.issuer.insecure_clone();
    f.transfer(f.issuer_token, f.vault, &issuer, 10_000)
        .unwrap();
    assert_eq!(f.balance(f.vault), 409_900);
    f.release().unwrap();
    // 409,900 leaves the vault and 1% of it is withheld on the way out.
    assert_eq!(f.balance(f.recipient), 405_801);
    assert_eq!(f.balance(f.vault), 0);
    assert!(f.closed(f.escrow));
    // The vault stays open, empty, holding only the withheld fee.
    assert!(!f.closed(f.vault));
}

#[test]
fn a_permanent_delegate_taking_vault_tokens_does_not_strand_the_escrow() {
    // Partly drained: the remainder is paid.
    let mut f = Fixture::new(PYUSD_MAINNET_MINT);
    f.lock();
    let issuer = f.issuer.insecure_clone();
    f.transfer(f.vault, f.issuer_token, &issuer, 150_000)
        .unwrap();
    f.release().unwrap();
    assert_eq!(f.triple(), (600_000, 0, 250_000));
    assert!(f.closed(f.escrow) && f.closed(f.vault));

    // Fully drained: nothing is paid, and both records still close.
    let mut f = Fixture::new(PYUSD_MAINNET_MINT);
    f.lock();
    let issuer = f.issuer.insecure_clone();
    f.transfer(f.vault, f.issuer_token, &issuer, 400_000)
        .unwrap();
    let payee = f.payee.insecure_clone();
    let ix = f.cancel_ix(payee.pubkey());
    send(&mut f.svm, &[ix], &[&payee]).unwrap();
    assert_eq!(f.triple(), (600_000, 0, 0));
    assert!(f.closed(f.escrow) && f.closed(f.vault));
}

/// Documents a limit the program cannot remove: a frozen vault cannot settle
/// until the issuer thaws it. The escrow stays locked and intact meanwhile.
#[test]
fn a_frozen_vault_cannot_settle_until_thawed() {
    let mut f = Fixture::new(PYUSD_MAINNET_MINT);
    f.lock();
    let issuer = f.issuer.insecure_clone();
    let freeze =
        t22(
            token_ix::freeze_account(&spl_token::ID, &f.vault, &f.mint, &issuer.pubkey(), &[])
                .unwrap(),
        );
    send(&mut f.svm, &[freeze], &[&issuer]).unwrap();
    assert!(f.release().is_err());
    assert_eq!(f.triple(), (600_000, 400_000, 0));
    let thaw =
        t22(
            token_ix::thaw_account(&spl_token::ID, &f.vault, &f.mint, &issuer.pubkey(), &[])
                .unwrap(),
        );
    send(&mut f.svm, &[thaw], &[&issuer]).unwrap();
    f.release().unwrap();
    assert_eq!(f.triple(), (600_000, 0, 400_000));
}

#[test]
fn a_donation_without_a_fee_is_swept_to_the_beneficiary() {
    let mut f = Fixture::new(USDG_MAINNET_MINT);
    f.lock();
    let issuer = f.issuer.insecure_clone();
    f.transfer(f.issuer_token, f.vault, &issuer, 7).unwrap();
    f.release().unwrap();
    assert_eq!(f.triple(), (600_000, 0, 400_007));
    assert!(f.closed(f.escrow) && f.closed(f.vault));
}
