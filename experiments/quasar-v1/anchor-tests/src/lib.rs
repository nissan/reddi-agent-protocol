//! Host-side stand-in for the Anchor `escrow` crate, speaking the Quasar
//! program's wire format. Used only by the copied Anchor tests.
use anchor_lang::{
    prelude::{borsh, AccountMeta, Pubkey},
    AnchorSerialize, Discriminator, InstructionData, ToAccountMetas,
};

/// The Anchor program's own constants, compiled from its source file.
#[path = "../../../../programs/escrow/src/constants.rs"]
pub mod constants;
pub use constants::*;

pub mod token_accounts {
    use anchor_lang::prelude::{pubkey, Pubkey};
    pub const TOKEN_2022_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    pub const TOKEN_2022_VAULT_LEN: usize = 166 + (4 + 8) + (4 + 1);
}

anchor_lang::declare_id!("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");

pub mod state {
    use anchor_lang::{
        error::{Error, ErrorCode},
        prelude::Pubkey,
        AccountDeserialize, AccountSerialize,
    };

    #[derive(Clone, PartialEq, Eq, Debug)]
    pub enum EscrowStatus {
        Locked,
        Released,
        Cancelled,
    }

    #[derive(Clone, PartialEq, Eq, Debug)]
    pub enum AgentType {
        Primary,
        Attestation,
        Both,
    }

    struct Reader<'a>(&'a [u8]);
    impl<'a> Reader<'a> {
        fn open(data: &'a [u8], disc: u8, len: usize) -> Result<Self, Error> {
            if data.len() != len || data[0] != disc {
                return Err(ErrorCode::AccountDidNotDeserialize.into());
            }
            Ok(Self(&data[1..]))
        }
        fn take<const N: usize>(&mut self) -> [u8; N] {
            let (head, rest) = self.0.split_at(N);
            self.0 = rest;
            head.try_into().unwrap()
        }
        fn key(&mut self) -> Pubkey {
            Pubkey::new_from_array(self.take())
        }
        fn u64(&mut self) -> u64 {
            u64::from_le_bytes(self.take())
        }
        fn i64(&mut self) -> i64 {
            i64::from_le_bytes(self.take())
        }
        fn u16(&mut self) -> u16 {
            u16::from_le_bytes(self.take())
        }
        fn u8(&mut self) -> u8 {
            self.take::<1>()[0]
        }
        fn status(&mut self) -> Result<EscrowStatus, Error> {
            match self.u8() {
                0 => Ok(EscrowStatus::Locked),
                1 => Ok(EscrowStatus::Released),
                2 => Ok(EscrowStatus::Cancelled),
                _ => Err(ErrorCode::AccountDidNotDeserialize.into()),
            }
        }
    }

    #[derive(Clone, Debug)]
    pub struct EscrowAccount {
        pub payer: Pubkey,
        pub payee: Pubkey,
        pub amount: u64,
        pub nonce: [u8; 16],
        pub status: EscrowStatus,
        pub created_at: i64,
        pub created_slot: u64,
        pub delegated_to_per: bool,
        pub per_session_key: Option<Pubkey>,
        pub bump: u8,
        pub metered: bool,
    }

    impl EscrowAccount {
        pub const LEN: usize = 1 + 32 + 32 + 8 + 16 + 1 + 8 + 8 + 1 + 32 + 1 + 1;
    }

    impl AccountDeserialize for EscrowAccount {
        fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self, Error> {
            let mut r = Reader::open(buf, 1, Self::LEN)?;
            Ok(Self {
                payer: r.key(),
                payee: r.key(),
                amount: r.u64(),
                nonce: r.take(),
                status: r.status()?,
                created_at: r.i64(),
                created_slot: r.u64(),
                delegated_to_per: r.u8() != 0,
                per_session_key: Some(r.key()).filter(|key| *key != Pubkey::default()),
                bump: r.u8(),
                metered: r.u8() != 0,
            })
        }
    }

    #[derive(Clone, Debug)]
    pub struct TokenEscrowAccount {
        pub payer: Pubkey,
        pub payee: Pubkey,
        pub mint: Pubkey,
        pub source: Pubkey,
        pub recipient: Pubkey,
        pub amount: u64,
        pub nonce: [u8; 16],
        pub status: EscrowStatus,
        pub created_slot: u64,
        pub bump: u8,
        pub metered: bool,
    }

    impl TokenEscrowAccount {
        pub const LEN: usize = 1 + 32 * 5 + 8 + 16 + 1 + 8 + 1 + 1;
    }

    impl AccountDeserialize for TokenEscrowAccount {
        fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self, Error> {
            let mut r = Reader::open(buf, 2, Self::LEN)?;
            Ok(Self {
                payer: r.key(),
                payee: r.key(),
                mint: r.key(),
                source: r.key(),
                recipient: r.key(),
                amount: r.u64(),
                nonce: r.take(),
                status: r.status()?,
                created_slot: r.u64(),
                bump: r.u8(),
                metered: r.u8() != 0,
            })
        }
    }

    impl AccountSerialize for TokenEscrowAccount {
        fn try_serialize<W: std::io::Write>(&self, writer: &mut W) -> Result<(), Error> {
            let mut out = vec![2u8];
            for key in [&self.payer, &self.payee, &self.mint, &self.source, &self.recipient] {
                out.extend_from_slice(key.as_ref());
            }
            out.extend_from_slice(&self.amount.to_le_bytes());
            out.extend_from_slice(&self.nonce);
            out.push(self.status.clone() as u8);
            out.extend_from_slice(&self.created_slot.to_le_bytes());
            out.push(self.bump);
            out.push(self.metered as u8);
            writer
                .write_all(&out)
                .map_err(|_| ErrorCode::AccountDidNotSerialize.into())
        }
    }

    #[derive(Clone, Debug)]
    pub struct AgentAccount {
        pub owner: Pubkey,
        pub agent_type: AgentType,
        pub model: String,
        pub rate_lamports: u64,
        pub min_reputation: u8,
        pub reputation_score: u16,
        pub jobs_completed: u64,
        pub jobs_failed: u64,
        pub created_at: i64,
        pub active: bool,
        pub attestation_accuracy: u16,
        pub bump: u8,
    }

    impl AgentAccount {
        pub const LEN: usize = 1 + 32 + 1 + 8 + 1 + 2 + 8 + 8 + 8 + 1 + 2 + 1 + (1 + 64);
    }

    impl AccountDeserialize for AgentAccount {
        fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self, Error> {
            let mut r = Reader::open(buf, 3, Self::LEN)?;
            let owner = r.key();
            let agent_type = match r.u8() {
                0 => AgentType::Primary,
                1 => AgentType::Attestation,
                2 => AgentType::Both,
                _ => return Err(ErrorCode::AccountDidNotDeserialize.into()),
            };
            let rate_lamports = r.u64();
            let min_reputation = r.u8();
            let reputation_score = r.u16();
            let jobs_completed = r.u64();
            let jobs_failed = r.u64();
            let created_at = r.i64();
            let active = r.u8() != 0;
            let attestation_accuracy = r.u16();
            let bump = r.u8();
            let len = r.u8() as usize;
            let model = String::from_utf8(r.0[..len].to_vec())
                .map_err(|_| Error::from(ErrorCode::AccountDidNotDeserialize))?;
            Ok(Self {
                owner,
                agent_type,
                model,
                rate_lamports,
                min_reputation,
                reputation_score,
                jobs_completed,
                jobs_failed,
                created_at,
                active,
                attestation_accuracy,
                bump,
            })
        }
    }
}

/// Instruction data: one discriminator byte, then the arguments.
pub mod instruction {
    use super::*;
    use state::AgentType;

    macro_rules! ix {
        ($name:ident = $disc:literal { $($field:ident : $ty:ty),* }) => {
            pub struct $name { $(pub $field: $ty),* }
            impl Discriminator for $name {
                const DISCRIMINATOR: &'static [u8] = &[$disc];
            }
            impl AnchorSerialize for $name {
                fn serialize<W: borsh::io::Write>(&self, _w: &mut W) -> borsh::io::Result<()> {
                    $( AnchorSerialize::serialize(&self.$field, _w)?; )*
                    Ok(())
                }
            }
            impl InstructionData for $name {}
        };
    }

    ix!(LockEscrow = 0 { amount: u64, nonce: [u8; 16] });
    ix!(LockMeteredEscrow = 1 { amount: u64, nonce: [u8; 16] });
    ix!(ReleaseEscrow = 2 {});
    ix!(SettleEscrow = 3 { actual: u64 });
    ix!(CancelEscrow = 4 {});
    ix!(LockTokenEscrow = 5 { amount: u64, nonce: [u8; 16] });
    ix!(LockMeteredTokenEscrow = 6 { amount: u64, nonce: [u8; 16] });
    ix!(ReleaseTokenEscrow = 7 {});
    ix!(SettleTokenEscrow = 8 { actual: u64 });
    ix!(CancelTokenEscrow = 9 {});
    ix!(UpdateAgent = 11 { rate_lamports: u64, min_reputation: u8, active: bool });
    ix!(DeregisterAgent = 12 {});

    /// Fixed arguments first, then the model as a one-byte length and its bytes.
    pub struct RegisterAgent {
        pub agent_type: AgentType,
        pub model: String,
        pub rate_lamports: u64,
        pub min_reputation: u8,
    }
    impl Discriminator for RegisterAgent {
        const DISCRIMINATOR: &'static [u8] = &[10];
    }
    impl AnchorSerialize for RegisterAgent {
        fn serialize<W: borsh::io::Write>(&self, w: &mut W) -> borsh::io::Result<()> {
            w.write_all(&[self.agent_type.clone() as u8])?;
            w.write_all(&self.rate_lamports.to_le_bytes())?;
            w.write_all(&[self.min_reputation])?;
            let len = u8::try_from(self.model.len()).expect("model longer than 255 bytes");
            w.write_all(&[len])?;
            w.write_all(self.model.as_bytes())
        }
    }
    impl InstructionData for RegisterAgent {}
}

/// Account lists, in the same order as the Anchor program.
pub mod accounts {
    use super::*;

    macro_rules! accounts {
        ($name:ident { $($field:ident : $kind:ident),* $(,)? }) => {
            pub struct $name { $(pub $field: Pubkey),* }
            impl ToAccountMetas for $name {
                fn to_account_metas(&self, _is_signer: Option<bool>) -> Vec<AccountMeta> {
                    vec![$(accounts!(@meta $kind, self.$field)),*]
                }
            }
        };
        (@meta w, $key:expr) => { AccountMeta::new($key, false) };
        (@meta ws, $key:expr) => { AccountMeta::new($key, true) };
        (@meta r, $key:expr) => { AccountMeta::new_readonly($key, false) };
        (@meta rs, $key:expr) => { AccountMeta::new_readonly($key, true) };
    }

    accounts!(LockEscrow { escrow: w, payer: ws, payee: r, system_program: r });
    accounts!(ReleaseEscrow { escrow: w, payer: w, payee: w, treasury: w, system_program: r });
    accounts!(CancelEscrow { escrow: w, authority: rs, payer: w, system_program: r });
    accounts!(LockTokenEscrow {
        escrow: w, vault: w, payer: ws, payee: r, mint: r, source: w, recipient: r,
        token_program: r, system_program: r,
    });
    accounts!(ReleaseTokenEscrow {
        escrow: w, vault: w, authority: rs, payer: w, mint: r, destination: w,
        treasury_token: w, refund: w, token_program: r,
    });
    accounts!(CancelTokenEscrow {
        escrow: w, vault: w, authority: rs, payer: w, mint: r, destination: w, token_program: r,
    });
    accounts!(RegisterAgent { agent: w, owner: ws, fee_collector: w, system_program: r });
    accounts!(UpdateAgent { agent: w, owner: rs });
    accounts!(DeregisterAgent { agent: w, owner: ws });
}
