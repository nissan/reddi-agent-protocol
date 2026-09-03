/// Deterministic-profile pins for the LiteSVM lane the legacy escrow tests run on.
///
/// The `major-aligned` runtime status recorded in
/// `config/toolchain/solana-baseline-assets.json` rests on executable behaviour, so the
/// environment that behaviour is observed in has to be pinned rather than inherited
/// silently. `LiteSVM::new()` changed shape across the 0.10 → 0.16 bump: it seeds the
/// mainnet-activated feature set instead of `FeatureSet::all_enabled()`, installs on-chain
/// feature-gate accounts for it, starts the clock at `MAINNET_DEFAULT_SLOT` instead of 0,
/// and derives the rent sysvar representation from a feature gate.
///
/// These tests read the environment through LiteSVM's public API and the sysvar account
/// byte layouts (a stable on-chain serialization contract), so a future bump that shifts
/// the profile fails here instead of quietly changing what the escrow evidence covers.
///
/// Scope: this pins the local deterministic profile only. It is not a claim that the lane
/// reproduces mainnet-beta or devnet behaviour, and not a readiness claim of any kind.
use {
    escrow::state::EscrowAccount,
    litesvm::{features::MAINNET_ACTIVE_FEATURES, LiteSVM, MAINNET_DEFAULT_SLOT},
    solana_sdk_ids::{feature, sysvar},
};

/// Rent sysvar layout (`solana-rent`): `lamports_per_byte` u64, `exemption_threshold`
/// f64 bytes, `burn_percent` u8.
const RENT_SYSVAR_SIZE: usize = 17;

/// `deprecate_rent_exemption_threshold` is in LiteSVM's mainnet-activated set, so the rent
/// sysvar keeps the SIMD-0194 representation. Were the gate inactive, LiteSVM would rewrite
/// it to the legacy `(3_480, 2.0)` pair, which encodes the same minimum balance.
const SIMD0194_LAMPORTS_PER_BYTE: u64 = 6_960;
const SIMD0194_EXEMPTION_THRESHOLD: f64 = 1.0;

#[test]
fn litesvm_default_environment_starts_at_the_mainnet_default_slot() {
    let svm = LiteSVM::new();

    assert!(
        MAINNET_DEFAULT_SLOT > 0,
        "the escrow tests warp relative to slots recorded in program state precisely \
         because the environment no longer starts at slot 0; MAINNET_DEFAULT_SLOT is {}",
        MAINNET_DEFAULT_SLOT,
    );

    let clock = svm
        .get_account(&sysvar::clock::id())
        .expect("the clock sysvar must be installed in the default environment");
    let slot = u64::from_le_bytes(
        clock.data[..8]
            .try_into()
            .expect("the clock sysvar must encode its slot in the leading 8 bytes"),
    );
    assert_eq!(
        slot, MAINNET_DEFAULT_SLOT,
        "the deterministic lane must start at MAINNET_DEFAULT_SLOT; re-record the profile \
         in config/toolchain/solana-baseline-assets.json if a LiteSVM bump moves it",
    );
}

#[test]
fn litesvm_default_environment_installs_the_mainnet_activated_feature_accounts() {
    let svm = LiteSVM::new();

    assert!(
        !MAINNET_ACTIVE_FEATURES.is_empty(),
        "the mainnet-activated feature list must be non-empty for the profile to mean anything",
    );

    for (feature_id, _activation_slot) in MAINNET_ACTIVE_FEATURES {
        let account = svm.get_account(feature_id).unwrap_or_else(|| {
            panic!("mainnet-activated feature {feature_id} must have an on-chain feature account")
        });
        assert_eq!(
            account.owner,
            feature::id(),
            "feature account {feature_id} must be owned by the feature gate program",
        );
        assert!(
            account.lamports > 0,
            "feature account {feature_id} must be funded",
        );
    }
}

#[test]
fn litesvm_default_environment_uses_the_feature_gated_rent_representation() {
    let svm = LiteSVM::new();

    let rent = svm
        .get_account(&sysvar::rent::id())
        .expect("the rent sysvar must be installed in the default environment");
    assert_eq!(
        rent.data.len(),
        RENT_SYSVAR_SIZE,
        "unexpected rent sysvar layout; the byte offsets below no longer apply",
    );

    let lamports_per_byte = u64::from_le_bytes(rent.data[..8].try_into().unwrap());
    let exemption_threshold = f64::from_le_bytes(rent.data[8..16].try_into().unwrap());
    assert_eq!(
        (lamports_per_byte, exemption_threshold),
        (SIMD0194_LAMPORTS_PER_BYTE, SIMD0194_EXEMPTION_THRESHOLD),
        "the lane runs under the mainnet-activated feature set, where \
         deprecate_rent_exemption_threshold is active. Seeing the legacy pair means the \
         gate went inactive under a narrower feature set; re-record the deterministic \
         profile before relying on this lane",
    );

    // The decoded representation is what actually drives the rent the escrow tests observe.
    let escrow_reserve = svm.minimum_balance_for_rent_exemption(EscrowAccount::LEN);
    let expected_reserve =
        ((EscrowAccount::LEN as u64 + 128) * lamports_per_byte) as f64 * exemption_threshold;
    assert_eq!(
        escrow_reserve, expected_reserve as u64,
        "the rent sysvar representation must drive minimum_balance_for_rent_exemption",
    );
}
