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
    DEFAULT_CANCEL_WINDOW_SLOTS as CANCEL_WINDOW_SLOTS,
    DEFAULT_CLAIM_WINDOW_SLOTS as CLAIM_WINDOW_SLOTS, PROTOCOL_TREASURY, PYUSD_MAINNET_MINT,
    USDC_MAINNET_MINT, USDG_MAINNET_MINT,
};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

const MINT_FIXTURE: &[u8] = include_bytes!("fixtures/pyusd_mainnet_mint_2026-11-20.bin");
/// The USDG mainnet mint account (finalized at slot 472008707, sha256
/// b4d19eb0...6655fe). Tests on the USDG mint address start from this layout.
const USDG_MINT_FIXTURE: &[u8] = include_bytes!("fixtures/usdg_mainnet_mint_2026-11-21.bin");

/// The real mint layout for `mint`: USDG's for the USDG address, PYUSD's
/// otherwise.
fn mint_fixture(mint: &Pubkey) -> &'static [u8] {
    if *mint == USDG_MAINNET_MINT {
        USDG_MINT_FIXTURE
    } else {
        MINT_FIXTURE
    }
}

/// The extension types in a Token-2022 account, in order.
fn extension_types(data: &[u8]) -> Vec<u16> {
    let mut at = 166;
    let mut found = Vec::new();
    while at + 4 <= data.len() {
        let kind = u16::from_le_bytes([data[at], data[at + 1]]);
        if kind == 0 {
            break;
        }
        found.push(kind);
        at += 4 + usize::from(u16::from_le_bytes([data[at + 2], data[at + 3]]));
    }
    found
}
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
    treasury_token: Pubkey,
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
        let mut data = mint_fixture(&mint).to_vec();
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
            treasury_token: Pubkey::default(),
            escrow,
            vault,
            nonce,
        };
        f.source = f.new_token_account(f.payer.pubkey());
        f.recipient = f.new_token_account(f.payee.pubkey());
        f.issuer_token = f.new_token_account(f.issuer.pubkey());
        // The treasury's token account must sit at its associated address.
        let made = f.new_token_account(PROTOCOL_TREASURY);
        f.treasury_token = escrow::treasury_token_address(&mint, &TOKEN_2022_ID);
        let account = f.svm.get_account(&made).unwrap();
        f.svm.set_account(f.treasury_token, account).unwrap();
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
                token_program: TOKEN_2022_ID,
                system_program: system_program::id(),
            }
            .to_account_metas(None),
        )
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
            token_program: TOKEN_2022_ID,
        }
        .to_account_metas(None)
    }
    fn payout_ix(&self, authority: Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::ReleaseTokenEscrow {}.data(),
            self.payout_accounts(authority),
        )
    }
    fn settle_ix(&self, authority: Pubkey, actual: u64) -> Instruction {
        Instruction::new_with_bytes(
            escrow::id(),
            &instruction::SettleTokenEscrow { actual }.data(),
            self.payout_accounts(authority),
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

/// The vault size is fixed for the extensions PYUSD carries. USDG is a
/// different mint by the same issuer; this holds it to the same extension set,
/// zero fee and unset hook, so the same vault size fits it.
#[test]
fn usdg_fixture_is_a_different_mint_with_the_same_extensions() {
    assert_ne!(USDG_MINT_FIXTURE, MINT_FIXTURE);
    assert_eq!(USDG_MINT_FIXTURE[44], 6, "decimals");
    assert_eq!(USDG_MINT_FIXTURE[165], 1, "account type: mint");
    assert_eq!(
        extension_types(USDG_MINT_FIXTURE),
        extension_types(MINT_FIXTURE)
    );
    assert!(extension_types(USDG_MINT_FIXTURE).contains(&EXT_TRANSFER_HOOK));
    let fee = extension(USDG_MINT_FIXTURE, EXT_TRANSFER_FEE_CONFIG);
    assert_eq!(fee.len(), 108);
    assert_eq!(&USDG_MINT_FIXTURE[fee.start + 88..fee.start + 90], &[0, 0]);
    assert_eq!(
        &USDG_MINT_FIXTURE[fee.start + 106..fee.start + 108],
        &[0, 0]
    );
    let hook = extension(USDG_MINT_FIXTURE, EXT_TRANSFER_HOOK);
    assert!(
        USDG_MINT_FIXTURE[hook.start + 32..hook.end]
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
        assert_eq!(f.triple(), (600_000, 0, 390_000));
        assert_eq!(f.balance(f.treasury_token), 10_000);
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
        assert_eq!(f.triple(), (600_000, 0, 390_000));
        assert_eq!(f.balance(f.treasury_token), 10_000);
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
    ix.accounts[8].pubkey = spl_token::ID;
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
    // The payee is sent 390,000 and the treasury 10,000; the token program
    // withholds 1% of each on the receiving account.
    assert_eq!(f.triple(), (600_000, 0, 386_100));
    assert_eq!(f.balance(f.treasury_token), 9_900);
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
    // 390,000 goes to the payee, 10,000 to the treasury and the 9,900 surplus
    // back to the payer; the token program withholds 1% of each on arrival.
    assert_eq!(f.balance(f.recipient), 386_100);
    assert_eq!(f.balance(f.treasury_token), 9_900);
    assert_eq!(f.balance(f.source), 609_801);
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
    // The payee is paid first from what is left; nothing remains for the fee.
    assert_eq!(f.triple(), (600_000, 0, 250_000));
    assert_eq!(f.balance(f.treasury_token), 0);
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
    assert_eq!(f.triple(), (600_000, 0, 390_000));
}

#[test]
fn a_donation_without_a_fee_is_returned_to_the_payer() {
    let mut f = Fixture::new(USDG_MAINNET_MINT);
    f.lock();
    let issuer = f.issuer.insecure_clone();
    f.transfer(f.issuer_token, f.vault, &issuer, 7).unwrap();
    f.release().unwrap();
    assert_eq!(f.triple(), (600_007, 0, 390_000));
    assert_eq!(f.balance(f.treasury_token), 10_000);
    assert!(f.closed(f.escrow) && f.closed(f.vault));
}

#[test]
fn pyusd_and_usdg_metered_escrow_settles_actual_cost_with_the_fee() {
    for mint in [PYUSD_MAINNET_MINT, USDG_MAINNET_MINT] {
        let mut f = Fixture::new(mint);
        let mut ix = f.lock_ix(400_000);
        ix.data = instruction::LockMeteredTokenEscrow {
            amount: 400_000,
            nonce: f.nonce,
            claim_window_slots: CLAIM_WINDOW_SLOTS,
            cancel_window_slots: CANCEL_WINDOW_SLOTS,
        }
        .data();
        let payer = f.payer.insecure_clone();
        send(&mut f.svm, &[ix], &[&payer]).unwrap();
        let payee = f.payee.insecure_clone();
        let ix = f.settle_ix(payee.pubkey(), 100_000);
        send(&mut f.svm, &[ix], &[&payee]).unwrap();
        assert_eq!(f.triple(), (900_000, 0, 97_500));
        assert_eq!(f.balance(f.treasury_token), 2_500);
        assert!(f.closed(f.escrow) && f.closed(f.vault));
    }
}
