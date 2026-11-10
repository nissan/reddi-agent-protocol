//! Classic-only Anchor SPL account wrappers.
//!
//! anchor-spl 1.1.2's `idl-build` feature unconditionally references its
//! Token-2022 interface. Keep classic token validation/deserialization unchanged
//! while providing the same empty IDL implementations locally, so generating an
//! IDL does not require enabling the unsupported Token-2022 dependency surface.
use anchor_lang::prelude::*;
use std::ops::Deref;

macro_rules! classic_account {
    ($name:ident, $wrapped:ty) => {
        #[derive(Clone)]
        pub struct $name($wrapped);

        impl AccountDeserialize for $name {
            fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self> {
                <$wrapped>::try_deserialize_unchecked(buf).map(Self)
            }
        }
        impl AccountSerialize for $name {}
        impl Owner for $name {
            fn owner() -> Pubkey {
                anchor_spl::token::ID
            }
        }
        impl Deref for $name {
            type Target = $wrapped;
            fn deref(&self) -> &Self::Target {
                &self.0
            }
        }
        #[cfg(feature = "idl-build")]
        impl anchor_lang::IdlBuild for $name {}
        #[cfg(feature = "idl-build")]
        impl anchor_lang::Discriminator for $name {
            const DISCRIMINATOR: &'static [u8] = &[];
        }
    };
}

classic_account!(Mint, anchor_spl::token::Mint);
classic_account!(TokenAccount, anchor_spl::token::TokenAccount);
