//! Holds `interface/vectors.json` to what the program does.
//!
//! The fixture is for client authors: one example of every instruction the
//! Anchor IDL does not describe (the rating and attestation instructions, and
//! the exits of a rated escrow), with its data and ordered accounts, the
//! bytes of a rating account in each state and of an attestation account, and
//! one commitment hash. This test rebuilds all of it with the builders the
//! other tests use, runs the instructions against the built program, and
//! fails if the file differs.
//!
//! To regenerate after an intended interface change:
//! `UPDATE_VECTORS=1 cargo test --test interface_vectors`
mod support;

use {
    anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction},
    escrow::{state::AgentType, USDC_MAINNET_MINT},
    serde_json::{json, Value},
    solana_signer::Signer,
    support::*,
};

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../interface/vectors.json");
const SALT_CONSUMER: [u8; 32] = [0xC1; 32];
const SALT_SPECIALIST: [u8; 32] = [0x51; 32];
const STATES: [&str; 5] = [
    "awaiting_settlement",
    "open",
    "both_committed",
    "revealed",
    "expired",
];

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// One instruction example: its data and its accounts, in order, by name.
fn instruction(name: &str, note: &str, ix: &Instruction, accounts: &[&str]) -> Value {
    assert_eq!(
        ix.accounts.len(),
        accounts.len(),
        "{name}: name every account"
    );
    assert_eq!(ix.data[..8], selector(name), "{name}: selector");
    json!({
        "name": name,
        "note": note,
        "selector_hex": hex(&ix.data[..8]),
        "data_hex": hex(&ix.data),
        "accounts": ix
            .accounts
            .iter()
            .zip(accounts)
            .map(|(meta, name)| json!({
                "name": name,
                "address": meta.pubkey.to_string(),
                "signer": meta.is_signer,
                "writable": meta.is_writable,
            }))
            .collect::<Vec<_>>(),
    })
}

fn account(world: &World, name: &str, address: &Pubkey) -> Value {
    let stored = world.svm.get_account(address).expect("the account exists");
    assert_eq!(stored.owner, escrow::id());
    json!({
        "name": name,
        "address": address.to_string(),
        "length": stored.data.len(),
        "data_hex": hex(&stored.data),
    })
}

fn build() -> Value {
    let mut world = World::new();
    let (consumer, specialist, judge) = (world.wallet(1), world.wallet(2), world.wallet(4));
    let (c, s, j) = (consumer.pubkey(), specialist.pubkey(), judge.pubkey());
    world.register(&specialist, AgentType::Primary);
    world.register(&consumer, AgentType::Primary);
    world.register(&judge, AgentType::Attestation);
    world.warp(1_000);

    let mut instructions = Vec::new();
    let mut accounts = Vec::new();
    let mut send = |world: &mut World,
                    name: &str,
                    note: &str,
                    ix: Instruction,
                    names: &[&str],
                    signer: &solana_keypair::Keypair| {
        instructions.push(instruction(name, note, &ix, names));
        world.ok(name, ix, &[signer]);
    };
    const RATING_PARTIES: [&str; 4] = ["rating", "signer", "specialist_agent", "consumer_agent"];

    // Job 1: a metered SOL escrow, opted in with a judge, settled by the
    // payee, rated by both, attested and confirmed.
    let n = nonce(7);
    let escrow = sol_escrow(&c, n);
    let rating = rating_address(&escrow);
    let attestation = attestation_address(&escrow);
    world.ok("lock", sol_lock(&c, &s, 1_000_000, n, true), &[&consumer]);
    send(
        &mut world,
        "open_rating",
        "data: judge address (all zero for none)",
        open_rating(&escrow, &c, Some(&j)),
        &["rating", "escrow", "payer", "system_program"],
        &consumer,
    );
    let rated_sol_escrow = account(&world, "sol_escrow_rated_metered", &escrow);
    accounts.push(account(&world, "rating_awaiting_settlement", &rating));

    world.warp(1_010);
    send(
        &mut world,
        "settle_escrow",
        "rated SOL escrow: the rating account follows the five usual accounts; data: actual u64",
        with_rating(sol_payout(&c, &s, n, &s, Some(600_000)), &escrow),
        &[
            "escrow",
            "payer",
            "payee",
            "treasury",
            "system_program",
            "rating",
        ],
        &specialist,
    );
    accounts.push(account(&world, "rating_open", &rating));

    let first_opened_slot = world.opened_slot(&rating);
    let consumer_commitment = commitment(&world, &rating, &c, 9, SALT_CONSUMER);
    let specialist_commitment = commitment(&world, &rating, &s, 4, SALT_SPECIALIST);
    world.warp(1_020);
    send(
        &mut world,
        "commit_rating",
        "data: commitment = sha256(rating address, opened slot (u64 LE), signer address, score byte, 32-byte salt)",
        commit_rating(&rating, &c, consumer_commitment),
        &["rating", "signer"],
        &consumer,
    );
    world.warp(1_030);
    world.ok(
        "commit",
        commit_rating(&rating, &s, specialist_commitment),
        &[&specialist],
    );
    accounts.push(account(&world, "rating_both_committed", &rating));

    world.warp(1_040);
    let attest = attest_quality(&world, &escrow, &j, [9, 8, 10, 1, 7]);
    send(
        &mut world,
        "attest_quality",
        "data: five scores, 1 to 10, then the slot the rating was opened in (u64 LE)",
        attest,
        &[
            "attestation",
            "rating",
            "judge_agent",
            "judge",
            "system_program",
        ],
        &judge,
    );
    accounts.push(account(&world, "attestation_pending", &attestation));
    send(
        &mut world,
        "reveal_rating",
        "data: score byte, 32-byte salt",
        reveal_rating(&rating, &c, &s, &c, 9, SALT_CONSUMER),
        &RATING_PARTIES,
        &consumer,
    );
    world.ok(
        "reveal",
        reveal_rating(&rating, &s, &s, &c, 4, SALT_SPECIALIST),
        &[&specialist],
    );
    accounts.push(account(&world, "rating_revealed", &rating));
    send(
        &mut world,
        "confirm_attestation",
        "no data",
        resolve_attestation(&escrow, &j, &c, true),
        &["attestation", "judge_agent", "consumer"],
        &consumer,
    );
    accounts.push(account(&world, "attestation_confirmed", &attestation));
    send(
        &mut world,
        "close_rating",
        "no data",
        close_rating(&rating, &c),
        &["rating", "consumer"],
        &consumer,
    );

    // Job 2: a fixed-price SOL escrow, released by the payer, never rated,
    // expired after the commit deadline, its attestation disputed.
    let n = nonce(8);
    let escrow = sol_escrow(&c, n);
    let rating = rating_address(&escrow);
    world.ok("lock", sol_lock(&c, &s, 1_000_000, n, false), &[&consumer]);
    world.ok("open", open_rating(&escrow, &c, Some(&j)), &[&consumer]);
    let accept = accept_rating(&world, &rating, &s);
    send(
        &mut world,
        "accept_rating",
        "data: the slot the rating was opened in (u64 LE); lets a release by the payer open the rating",
        accept,
        &["rating", "specialist"],
        &specialist,
    );
    accounts.push(account(
        &world,
        "rating_awaiting_settlement_accepted",
        &rating,
    ));
    send(
        &mut world,
        "release_escrow",
        "rated SOL escrow: the rating account follows the five usual accounts; no data",
        with_rating(sol_payout(&c, &s, n, &c, None), &escrow),
        &[
            "escrow",
            "payer",
            "payee",
            "treasury",
            "system_program",
            "rating",
        ],
        &consumer,
    );
    world.ok(
        "attest",
        attest_quality(&world, &escrow, &j, [2; 5]),
        &[&judge],
    );
    send(
        &mut world,
        "dispute_attestation",
        "no data",
        resolve_attestation(&escrow, &j, &c, false),
        &["attestation", "judge_agent", "consumer"],
        &consumer,
    );
    send(
        &mut world,
        "close_attestation",
        "no data; resolved, or unresolved for longer than the resolution window",
        close_attestation(&escrow, &j),
        &["attestation", "judge"],
        &judge,
    );
    world.warp(world.slot() + RATING_COMMIT_SLOTS + 1);
    send(
        &mut world,
        "expire_rating",
        "no data; the signer is anyone",
        expire_rating(&rating, &j, &s, &c),
        &RATING_PARTIES,
        &judge,
    );
    accounts.push(account(&world, "rating_expired", &rating));

    // Job 3: a rated SOL escrow the payee declines.
    let n = nonce(9);
    let escrow = sol_escrow(&c, n);
    world.ok("lock", sol_lock(&c, &s, 1_000_000, n, false), &[&consumer]);
    world.ok("open", open_rating(&escrow, &c, None), &[&consumer]);
    send(
        &mut world,
        "cancel_escrow",
        "rated SOL escrow: the rating account follows the four usual accounts and is closed; no data",
        with_rating(sol_cancel(&c, n, &s), &escrow),
        &["escrow", "authority", "payer", "system_program", "rating"],
        &specialist,
    );

    // Jobs 4 to 6: rated USDC escrows through release, settle and decline.
    let t = Tokens::install(
        &mut world,
        anchor_spl::token::spl_token::ID,
        USDC_MAINNET_MINT,
        consumer,
        specialist,
    );
    const TOKEN_PAYOUT: [&str; 10] = [
        "escrow",
        "vault",
        "authority",
        "payer",
        "mint",
        "destination",
        "treasury_token",
        "refund",
        "token_program",
        "rating",
    ];
    let mut rated_token_escrow = None;
    for i in 4..=6u8 {
        let escrow = t.escrow(nonce(i));
        world.ok("lock", t.lock(1_000_000, nonce(i), i == 5), &[&t.payer]);
        world.ok("open", open_rating(&escrow, &c, None), &[&t.payer]);
        match i {
            4 => {
                rated_token_escrow = Some(account(&world, "token_escrow_rated", &escrow));
                send(
                    &mut world,
                    "release_token_escrow",
                    "rated token escrow: the rating account follows the nine usual accounts; no data",
                    with_rating(t.payout(nonce(i), &c, None), &escrow),
                    &TOKEN_PAYOUT,
                    &t.payer,
                )
            }
            5 => send(
                &mut world,
                "settle_token_escrow",
                "rated token escrow: the rating account follows the nine usual accounts; data: actual u64",
                with_rating(t.payout(nonce(i), &s, Some(250_000)), &escrow),
                &TOKEN_PAYOUT,
                &t.payee,
            ),
            _ => send(
                &mut world,
                "cancel_token_escrow",
                "rated token escrow: the rating account follows the seven usual accounts and is closed; no data",
                with_rating(t.cancel(nonce(i), &s), &escrow),
                &[
                    "escrow",
                    "vault",
                    "authority",
                    "payer",
                    "mint",
                    "destination",
                    "token_program",
                    "rating",
                ],
                &t.payee,
            ),
        }
    }
    accounts.push(rated_sol_escrow);
    accounts.push(rated_token_escrow.unwrap());

    // The states are the ones their names say, in order.
    for (state, name) in STATES.iter().enumerate() {
        let entry = accounts
            .iter()
            .find(|entry| entry["name"] == format!("rating_{name}"))
            .unwrap_or_else(|| panic!("no rating account in state {name}"));
        let data_hex = entry["data_hex"].as_str().unwrap();
        assert_eq!(data_hex.len(), 2 * RATING_LEN);
        assert_eq!(&data_hex[2 * 264..2 * 265], format!("{state:02x}"));
    }

    let first_rating = rating_address(&sol_escrow(&c, nonce(7)));
    json!({
        "about": "Examples of the instructions and accounts of programs/pinocchio-escrow that the Anchor IDL does not describe. Generated and checked by equivalence/tests/interface_vectors.rs; see the program README for the interface.",
        "program_id": escrow::id().to_string(),
        "seeds": {
            "rating": ["\"rating\"", "escrow address"],
            "attestation": ["\"attestation\"", "escrow address"],
        },
        "rating_states": STATES,
        "escrow_flag_byte": {
            "metered": FLAG_METERED,
            "rated": FLAG_RATED,
            "sol_escrow_offset": SOL_ESCROW_FLAGS_AT,
            "token_escrow_offset": TOKEN_ESCROW_FLAGS_AT,
        },
        "commitment": {
            "preimage": "rating address (32) || opened_slot (u64 LE, 8) || signer address (32) || score (1) || salt (32)",
            "rating": first_rating.to_string(),
            "opened_slot": first_opened_slot,
            "signer": c.to_string(),
            "score": 9,
            "salt_hex": hex(&SALT_CONSUMER),
            "preimage_hex": hex(
                &[
                    first_rating.as_ref(),
                    &first_opened_slot.to_le_bytes(),
                    c.as_ref(),
                    &[9],
                    &SALT_CONSUMER,
                ]
                .concat()
            ),
            "sha256_hex": hex(&consumer_commitment),
        },
        "instructions": instructions,
        "accounts": accounts,
    })
}

#[test]
fn the_fixture_matches_what_the_program_does() {
    let rendered = serde_json::to_string_pretty(&build()).unwrap() + "\n";
    if std::env::var_os("UPDATE_VECTORS").is_some() {
        std::fs::create_dir_all(std::path::Path::new(FIXTURE).parent().unwrap()).unwrap();
        std::fs::write(FIXTURE, &rendered).unwrap();
    }
    let stored = std::fs::read_to_string(FIXTURE).expect("interface/vectors.json");
    assert!(
        stored == rendered,
        "interface/vectors.json is stale: regenerate it with \
         UPDATE_VECTORS=1 cargo test --test interface_vectors, and review the change"
    );
}

#[test]
fn the_fixture_names_every_instruction_the_idl_does_not_describe() {
    let stored: Value =
        serde_json::from_str(&std::fs::read_to_string(FIXTURE).expect("interface/vectors.json"))
            .unwrap();
    let names: Vec<&str> = stored["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["name"].as_str().unwrap())
        .collect();
    for name in [
        "open_rating",
        "accept_rating",
        "close_attestation",
        "commit_rating",
        "reveal_rating",
        "expire_rating",
        "close_rating",
        "attest_quality",
        "confirm_attestation",
        "dispute_attestation",
        "release_escrow",
        "settle_escrow",
        "cancel_escrow",
        "release_token_escrow",
        "settle_token_escrow",
        "cancel_token_escrow",
    ] {
        assert_eq!(
            names.iter().filter(|found| **found == name).count(),
            1,
            "{name}"
        );
    }
    assert_eq!(names.len(), 16);
}
