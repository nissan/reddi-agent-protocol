//! Holds `interface/vectors.json` to what the program does.
//!
//! The fixture is for client authors: one example of every instruction the
//! Anchor IDL does not describe (the rating, attestation and delivery-check
//! instructions, the pooled-budget instructions, and the exits of a rated
//! escrow), with its data and ordered
//! accounts, the bytes of a rating account in each state, of a delivery
//! account in each state and of an attestation account, and one commitment
//! hash. This test rebuilds all of it with the builders the
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
const DELIVERY_STATES: [&str; 4] = ["awaiting", "delivered", "accepted", "disputed"];
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
    // As a client sends it: an instruction the pause can refuse takes the
    // pause account last.
    let ix = &support::instance::with_pause(ix.clone());
    let with_pause;
    let accounts = if ix.accounts.len() == accounts.len() + 1 && support::instance::gated(ix) {
        with_pause = [accounts, &["pause"]].concat();
        &with_pause[..]
    } else {
        accounts
    };
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
        let ix = world.resolve(&ix);
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
        "rated SOL escrow: the rating account follows the five usual accounts; data: actual u64, then the slot the job's rating was opened in (u64 LE)",
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
        "data: commitment = sha256(rating address, opened slot (u64 LE), signer address, score byte, 32-byte salt), then the slot the job's rating was opened in (u64 LE)",
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
        "data: the slot the job's rating was opened in (u64 LE), which the attestation stores",
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
        "rated SOL escrow: the rating account follows the five usual accounts; data: the slot the job's rating was opened in (u64 LE)",
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
        "data: the slot the job's rating was opened in (u64 LE), which the attestation stores",
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
        "rated SOL escrow: the rating account follows the four usual accounts and is closed; data: the slot the job's rating was opened in (u64 LE)",
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
                    "rated token escrow: the rating account follows the nine usual accounts; data: the slot the job's rating was opened in (u64 LE)",
                    with_rating(t.payout(nonce(i), &c, None), &escrow),
                    &TOKEN_PAYOUT,
                    &t.payer,
                )
            }
            5 => send(
                &mut world,
                "settle_token_escrow",
                "rated token escrow: the rating account follows the nine usual accounts; data: actual u64, then the slot the job's rating was opened in (u64 LE)",
                with_rating(t.payout(nonce(i), &s, Some(250_000)), &escrow),
                &TOKEN_PAYOUT,
                &t.payee,
            ),
            _ => send(
                &mut world,
                "cancel_token_escrow",
                "rated token escrow: the rating account follows the seven usual accounts and is closed; data: the slot the job's rating was opened in (u64 LE)",
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
    // Jobs 7 and 8: delivery-checked metered SOL escrows. Job 7 is
    // delivered and accepted, then settled; job 8 is disputed and split by
    // the judge.
    const ANSWER: [&str; 3] = ["delivery", "escrow", "payer"];
    for i in 7..=8u8 {
        let n = nonce(20 + i);
        let escrow = sol_escrow(&c, n);
        let delivery = delivery_address(&escrow);
        world.warp(world.slot() + 10);
        world.ok("lock", sol_lock(&c, &s, 1_000_000, n, true), &[&t.payer]);
        let created = world.slot();
        let open = open_delivery(&escrow, &c, &j);
        if i == 7 {
            send(
                &mut world,
                "open_delivery",
                "in the lock slot only; data: judge address, verify_window_slots u64 (150 to 1512000), resolve_window_slots u64 (1500 to 3024000); judge_agent is the judge's registry record",
                open,
                &["delivery", "escrow", "payer", "judge_agent", "system_program"],
                &t.payer,
            );
            accounts.push(account(&world, "delivery_awaiting", &delivery));
            accounts.push(account(
                &world,
                "sol_escrow_delivery_checked_metered",
                &escrow,
            ));
        } else {
            world.ok("open", open, &[&t.payer]);
        }
        world.warp(world.slot() + 1);
        let record = record_delivery(&escrow, &s, created, 30, 37_500_000);
        if i == 7 {
            send(
                &mut world,
                "record_delivery",
                "by the payee, after the lock slot and before the escrow's refund window opens; data: opened_slot u64 (the escrow's lock slot), units u64, bytes u64, sha256 [32]",
                record,
                &["delivery", "escrow", "payee"],
                &t.payee,
            );
            accounts.push(account(&world, "delivery_delivered", &delivery));
            send(
                &mut world,
                "accept_delivery",
                "by the payer, on a delivered job; data: opened_slot u64. The payee may then settle or claim at once",
                answer("accept_delivery", &escrow, &c, created),
                &ANSWER,
                &t.payer,
            );
            accounts.push(account(&world, "delivery_accepted", &delivery));
            world.ok(
                "settle checked",
                with_delivery(sol_payout(&c, &s, n, &s, Some(600_000)), &escrow),
                &[&t.payee],
            );
        } else {
            world.ok("record", record, &[&t.payee]);
            send(
                &mut world,
                "dispute_delivery",
                "by the payer, on a delivered job, before the verify window ends; data: opened_slot u64",
                answer("dispute_delivery", &escrow, &c, created),
                &ANSWER,
                &t.payer,
            );
            accounts.push(account(&world, "delivery_disputed", &delivery));
            send(
                &mut world,
                "resolve_delivery",
                "by the judge of a disputed SOL escrow, before its window ends; the rating account (if rated) then the delivery account follow the judge; data: payout u64 (to the payee before the fee, at most the locked amount), opened_slot u64",
                sol_resolve(&c, &s, &escrow, &j, 600_000, created, false),
                &["escrow", "payer", "payee", "treasury", "system_program", "judge", "delivery"],
                &judge,
            );
        }
    }

    // Job 9: a delivery-checked USDC escrow, disputed and split by the judge.
    let n = nonce(29);
    let escrow = t.escrow(n);
    world.warp(world.slot() + 10);
    world
        .send(
            &[t.lock(1_000_000, n, true), open_delivery(&escrow, &c, &j)],
            &[&t.payer],
        )
        .unwrap();
    let created = world.slot();
    world.warp(created + 1);
    world.ok(
        "record",
        record_delivery(&escrow, &s, created, 30, 1),
        &[&t.payee],
    );
    world.ok(
        "dispute",
        answer("dispute_delivery", &escrow, &c, created),
        &[&t.payer],
    );
    send(
        &mut world,
        "resolve_token_delivery",
        "by the judge of a disputed token escrow; destination is the recipient recorded at lock; the rating account (if rated) then the delivery account follow the nine usual accounts; data: payout u64, opened_slot u64",
        token_resolve(&t, n, &j, 400_000, created),
        &[
            "escrow",
            "vault",
            "judge",
            "payer",
            "mint",
            "destination",
            "treasury_token",
            "refund",
            "token_program",
            "delivery",
        ],
        &judge,
    );

    for (state, name) in DELIVERY_STATES.iter().enumerate() {
        let entry = accounts
            .iter()
            .find(|entry| entry["name"] == format!("delivery_{name}"))
            .unwrap_or_else(|| panic!("no delivery account in state {name}"));
        let data_hex = entry["data_hex"].as_str().unwrap();
        assert_eq!(data_hex.len(), 2 * DELIVERY_LEN);
        assert_eq!(&data_hex[2 * 160..2 * 161], format!("{state:02x}"));
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

    let (budget_instructions, budget_accounts) = budget_vectors();
    instructions.extend(budget_instructions);
    accounts.extend(budget_accounts);

    let first_rating = rating_address(&sol_escrow(&c, nonce(7)));
    json!({
        "about": "Examples of the instructions and accounts of programs/pinocchio-escrow that the Anchor IDL does not describe. Generated and checked by equivalence/tests/interface_vectors.rs; see the program README for the interface.",
        "program_id": escrow::id().to_string(),
        "seeds": {
            "rating": ["\"rating\"", "escrow address"],
            "attestation": ["\"attestation\"", "escrow address"],
            "delivery": ["\"delivery\"", "escrow address"],
            "budget": ["\"budget\"", "payer address", "nonce [u8;16]"],
            "budget_vault": ["\"budget-vault\"", "budget address"],
            "reservation": ["\"reservation\"", "budget address", "payee address"],
        },
        "budget_layout": {
            "budget": "349 bytes: discriminator sha256(\"account:Budget\")[..8] (0), payer (8), spender (40), judge (72), mint (104, zero for SOL), nonce (136), created_slot u64 (152), open_slots (160), dispute_slots (168), judge_slots (176), total (184), unreserved (192), per_provider_cap (200), allowlist [address;4] (208), closed_slot (336), reservations u8 (344), unsettled u8 (345), flags u8 (346: 0x01 spender may waive, 0x02 closed, 0x04 review from the open period's end, 0x08 P-256 spender), bump (347), vault_bump (348)",
            "reservation": "147 bytes: discriminator sha256(\"account:Reservation\")[..8] (0), budget (8), budget_created_slot u64 (40), payee (48), payout_account (80), reserved u64 (112), final_amount u64 (120), posted_slot u64 (128), disputed_slot u64 (136), state u8 (144: 0 open, 1 posted, 2 disputed, 3 paid), waived u8 (145), bump (146)",
        },
        "delivery_states": DELIVERY_STATES,
        "delivery_exits": "Every exit of a delivery-checked escrow (release, settle, cancel; SOL and token) takes the delivery account after its usual accounts and after the rating account if the escrow is rated. Its data is unchanged: an unrated escrow's exit names the lock slot, a rated one names the rating's opened slot, which is the same slot.",
        "rating_states": STATES,
        "escrow_flag_byte": {
            "metered": FLAG_METERED,
            "rated": FLAG_RATED,
            "delivery_checked": FLAG_DELIVERY,
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
        "budget_p256_spender": p256_vectors(),
        "pause": pause_vectors(),
        "instructions": instructions,
        "accounts": accounts,
    })
}

/// The emergency pause: its account, which instructions take it, and one
/// example of each of its four instructions (run by `tests/pause.rs`, which
/// can act as the Squads vault).
fn pause_vectors() -> Value {
    use anchor_lang::prelude::AccountMeta;
    let admin = escrow::PROTOCOL_TREASURY;
    let guardian = Pubkey::new_from_array([7; 32]);
    let pause = support::instance::PAUSE_ADDRESS;
    let build = |name: &str, args: &[u8], accounts: Vec<AccountMeta>| {
        let mut data = selector(name).to_vec();
        data.extend_from_slice(args);
        Instruction {
            program_id: escrow::id(),
            accounts,
            data,
        }
    };
    let init = build(
        "init_pause",
        guardian.as_ref(),
        vec![
            AccountMeta::new(pause, false),
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new(admin, true),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::id(), false),
        ],
    );
    let two = |name: &str, signer: Pubkey, args: &[u8]| {
        build(
            name,
            args,
            vec![
                AccountMeta::new(pause, false),
                AccountMeta::new_readonly(signer, true),
            ],
        )
    };
    json!({
        "seed": ["\"pause\""],
        "address": pause.to_string(),
        "bump": 255,
        "layout": "89 bytes: discriminator sha256(\"account:PauseState\")[..8] (0), guardian (8), paused_until_slot u64 (40: paused while the current slot is below it, 0 when not paused), paused_at_slot u64 (48), last_by (56), bump (88)",
        "admin": "mainnet build: the Squads vault 5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe (also the treasury and the upgrade authority); devnet build: the devnet deployer hbr2Fee3ewDbm33wTDrdEF3e7byNCzNgQ57CwJWaPtt",
        "pause_slots": 1_512_000u64,
        "takes_the_pause_account": "These instructions take the pause account read-only, after all their own accounts (the program finds it anywhere and takes it out of the list). Refused while paused, and refused with PauseAccountRequired (6102) without it: lock_escrow, lock_metered_escrow, release_escrow, settle_escrow, lock_token_escrow, lock_metered_token_escrow, release_token_escrow, settle_token_escrow, open_budget, open_token_budget, reserve. Refund only while paused, and counted as paused without it: resolve_delivery, resolve_token_delivery (payout 0 only), payout_budget, payout_token_budget, resolve_budget, resolve_token_budget (only when the provider is paid nothing). Every other instruction ignores it.",
        "errors": {
            "ProtocolPaused": 6101,
            "PauseAccountRequired": 6102,
            "NotPauseAuthority": 6103,
            "AlreadyPaused": 6104,
            "InvalidGuardian": 6105,
        },
        "event": "PauseChanged: discriminator sha256(\"event:PauseChanged\")[..8], guardian, by, paused_until_slot u64 (0 when not paused), slot u64",
        "instructions": [
            instruction(
                "init_pause",
                "data: guardian [u8;32]; by the admin, once; the payer pays the rent and may be the admin",
                &init,
                &["pause", "admin", "payer", "system_program"],
            ),
            instruction(
                "pause",
                "no data; by the guardian (only when not paused) or the admin (also extends a pause to PAUSE_SLOTS from now)",
                &two("pause", guardian, &[]),
                &["pause", "signer"],
            ),
            instruction(
                "unpause",
                "no data; by the admin",
                &two("unpause", admin, &[]),
                &["pause", "admin"],
            ),
            instruction(
                "set_guardian",
                "data: guardian [u8;32]; by the admin; not zero and not the admin",
                &two("set_guardian", admin, guardian.as_ref()),
                &["pause", "admin"],
            ),
        ],
    })
}

/// A budget with a P-256 spender (flag 0x08): one approval for each action,
/// with the message, the precompile instruction and the call, each sent
/// against the built program.
fn p256_vectors() -> Value {
    use support::budget::*;
    let mut world = World::new();
    let (payer, a, judge, relay) = (
        world.wallet(1),
        world.wallet(2),
        world.wallet(4),
        world.wallet(3),
    );
    world.register(&a, AgentType::Primary);
    world.register(&judge, AgentType::Attestation);
    world.warp(3_000);
    let key = P256::new(7);
    let p = payer.pubkey();
    let terms = Terms {
        nonce: nonce(11),
        spender: key.spender(),
        judge: ZERO,
        open: 9_000,
        dispute: 9_000,
        judge_slots: 1_500,
        total: 100_000_000,
        cap: 0,
        flags: 0x08 | 0x01,
        allowlist: [a.pubkey(), ZERO, ZERO, ZERO],
    };
    world.ok("open_budget", terms.open_ix(&p), &[&payer]);
    let budget = budget_address(&p, terms.nonce);
    let created = world.slot();
    world.next_slot();
    let expires = world.slot() + 150;
    let mut examples = Vec::new();
    let mut approve = |world: &mut World,
                       name: &str,
                       approval: Approval,
                       ix: Instruction,
                       accounts: &[&str],
                       signers: &[&solana_keypair::Keypair]| {
        let message = approval.message();
        let pre = precompile_ix(&key.public(), &key.sign(&message), &message, u16::MAX);
        examples.push(json!({
            "action": name,
            "message_hex": hex(&message),
            "precompile_data_hex": hex(&pre.data),
            "call": instruction(name, "", &ix, accounts),
        }));
        world
            .send(&[pre, ix], signers)
            .unwrap_or_else(|error| panic!("{name} by approval: {error}"));
    };
    let reserve = Approval {
        budget,
        created,
        action: RESERVE,
        target: a.pubkey(),
        payout_account: a.pubkey(),
        amount: 40_000_000,
        expires,
    };
    let ix = by_approval(
        reserve_ix(
            &budget,
            created,
            &ZERO,
            &a.pubkey(),
            &a.pubkey(),
            40_000_000,
        ),
        2,
        expires,
    );
    approve(
        &mut world,
        "reserve",
        reserve,
        ix,
        &[
            "budget",
            "reservation",
            "instructions_sysvar",
            "payee",
            "payee_agent",
            "payout_account",
            "system_program",
        ],
        &[&a],
    );
    world.ok(
        "post_final",
        post_ix(&budget, created, &a.pubkey(), 25_000_000),
        &[&a],
    );
    let reservation = reservation_address(&budget, &a.pubkey());
    let waive = Approval {
        budget,
        created,
        action: WAIVE,
        target: reservation,
        payout_account: ZERO,
        amount: 0,
        expires,
    };
    let ix = by_approval(
        hold_ix("waive", &budget, created, &a.pubkey(), &ZERO),
        2,
        expires,
    );
    approve(
        &mut world,
        "waive",
        waive,
        ix,
        &["budget", "reservation", "instructions_sysvar"],
        &[&relay],
    );
    let close = Approval {
        budget,
        created,
        action: CLOSE,
        target: ZERO,
        payout_account: ZERO,
        amount: 0,
        expires,
    };
    let ix = by_approval(close_ix(&budget, created, &ZERO, &p), 1, expires);
    approve(
        &mut world,
        "close_budget",
        close,
        ix,
        &["budget", "instructions_sysvar", "payer"],
        &[&relay],
    );
    json!({
        "about": "A budget whose spender is a P-256 key (flag 0x08). Its spender field is sha256 of the 33-byte compressed public key. The spender never signs a transaction: reserve, waive and the closes take the Instructions sysvar in the spender or signer position, append expires_slot u64 to their data, and come just after a secp256r1 precompile instruction (Secp256r1SigVerify1111111111111111111111111) with exactly one signature whose key, signature and message all lie in that instruction (instruction indexes u16::MAX). The signature is ES256 (ECDSA over SHA-256 of the message) with a low S. The call is refused once the current slot is past expires_slot.",
        "message_layout": "\"RAP-BUDGET-SPENDER-V1\" (21 bytes) || cluster u8 (0 mainnet build, 1 devnet build) || program id (32) || budget (32) || created_slot u64 LE || action u8 (1 reserve, 2 waive, 3 close) || target (32: payee for reserve, reservation for waive, zero for close) || payout_account (32: reserve only, else zero) || amount u64 LE (reserve only, else 0) || expires_slot u64 LE",
        "precompile_layout": "num_signatures u8 = 1 || padding u8 || signature_offset u16 = 49 || signature_ix u16 = 0xffff || public_key_offset u16 = 16 || public_key_ix u16 = 0xffff || message_offset u16 = 113 || message_size u16 || message_ix u16 = 0xffff || public key (33) || signature r||s (64) || message",
        "public_key_hex": hex(&key.public()),
        "spender": key.spender().to_string(),
        "budget": budget.to_string(),
        "created_slot": created,
        "expires_slot": expires,
        "examples": examples,
    })
}

/// One SOL and one USDC budget, taken through every pooled-budget
/// instruction: the instruction examples and the account bytes.
fn budget_vectors() -> (Vec<Value>, Vec<Value>) {
    use support::budget::*;
    let mut world = World::new();
    let (payer, a, judge, spender, b) = (
        world.wallet(1),
        world.wallet(2),
        world.wallet(4),
        world.wallet(5),
        world.wallet(6),
    );
    world.register(&a, AgentType::Primary);
    world.register(&b, AgentType::Primary);
    world.register(&judge, AgentType::Attestation);
    world.warp(2_000);
    let (p, j) = (payer.pubkey(), judge.pubkey());
    let mut instructions = Vec::new();
    let mut accounts = Vec::new();
    let mut send = |world: &mut World,
                    name: &str,
                    note: &str,
                    ix: Instruction,
                    names: &[&str],
                    signers: &[&solana_keypair::Keypair]| {
        instructions.push(instruction(name, note, &ix, names));
        world.ok(name, ix, signers);
    };
    const RESERVE: [&str; 7] = [
        "budget",
        "reservation",
        "spender",
        "payee",
        "payee_agent",
        "payout_account",
        "system_program",
    ];
    const HOLD: [&str; 3] = ["budget", "reservation", "signer"];
    const SOL_PAYOUT: [&str; 5] = ["budget", "reservation", "payee", "payer", "treasury"];
    let terms = Terms {
        nonce: nonce(9),
        spender: spender.pubkey(),
        judge: j,
        open: 9_000,
        dispute: 9_000,
        judge_slots: 1_500,
        total: 100_000_000,
        cap: 50_000_000,
        flags: 0,
        allowlist: [ZERO; 4],
    };

    // SOL: A is paid early after a waiver; B is disputed and resolved.
    let budget = budget_address(&p, terms.nonce);
    send(
        &mut world,
        "open_budget",
        "data: nonce [u8;16], spender, judge (all zero for none), open_slots u64, dispute_slots u64, judge_slots u64, total u64, per_provider_cap u64 (0 for the total), flags u8 (0x01 spender may waive, 0x08 P-256 spender: see budget_p256_spender), allowlist [address;4] (all-zero entries empty); the judge's agent record follows only when a judge is named",
        terms.open_ix(&p),
        &["budget", "payer", "system_program", "judge_agent"],
        &[&payer],
    );
    let created = world.slot();
    accounts.push(account(&world, "budget_open", &budget));
    world.next_slot();
    send(
        &mut world,
        "reserve",
        "signed by the payee (pays the reservation's rent) and the spender; a SOL payout account is the payee itself; data: created_slot u64, amount u64 (the reservation's new total)",
        reserve_ix(&budget, created, &spender.pubkey(), &a.pubkey(), &a.pubkey(), 40_000_000),
        &RESERVE,
        &[&a, &spender],
    );
    let ra = reservation_address(&budget, &a.pubkey());
    accounts.push(account(&world, "reservation_open", &ra));
    send(
        &mut world,
        "post_final",
        "by the payee; at most the reservation, and a re-post may only lower it; data: created_slot u64, amount u64",
        post_ix(&budget, created, &a.pubkey(), 25_000_000),
        &["budget", "reservation", "payee"],
        &[&a],
    );
    accounts.push(account(&world, "reservation_posted", &ra));
    send(
        &mut world,
        "waive",
        "by the payer, or the spender when the budget has flag 0x01; data: created_slot u64",
        hold_ix("waive", &budget, created, &a.pubkey(), &p),
        &HOLD,
        &[&payer],
    );
    send(
        &mut world,
        "payout_budget",
        "by anyone; also closes a paid reservation once its budget is closed or gone; data: created_slot u64",
        payout_ix(&budget, created, &a.pubkey(), &p),
        &SOL_PAYOUT,
        &[&spender],
    );
    accounts.push(account(&world, "reservation_paid", &ra));
    world.ok(
        "reserve",
        reserve_ix(
            &budget,
            created,
            &spender.pubkey(),
            &b.pubkey(),
            &b.pubkey(),
            30_000_000,
        ),
        &[&b, &spender],
    );
    world.ok(
        "post",
        post_ix(&budget, created, &b.pubkey(), 30_000_000),
        &[&b],
    );
    send(
        &mut world,
        "dispute",
        "by the payer, on a budget with a judge, before the reservation's dispute window ends; data: created_slot u64",
        hold_ix("dispute", &budget, created, &b.pubkey(), &p),
        &HOLD,
        &[&payer],
    );
    accounts.push(account(
        &world,
        "reservation_disputed",
        &reservation_address(&budget, &b.pubkey()),
    ));
    send(
        &mut world,
        "close_budget",
        "by the payer or the spender, or anyone after the open period; refunds what is unreserved; data: created_slot u64",
        close_ix(&budget, created, &spender.pubkey(), &p),
        &["budget", "signer", "payer"],
        &[&spender],
    );
    accounts.push(account(&world, "budget_closed", &budget));
    let mut resolve = payout_ix(&budget, created, &b.pubkey(), &p);
    resolve.data = selector("resolve_budget").to_vec();
    resolve.data.extend_from_slice(&created.to_le_bytes());
    resolve.data.extend_from_slice(&10_000_000u64.to_le_bytes());
    resolve
        .accounts
        .push(anchor_lang::prelude::AccountMeta::new_readonly(j, true));
    send(
        &mut world,
        "resolve_budget",
        "by the judge, inside its window; data: created_slot u64, payout u64 (at most the posted amount)",
        resolve,
        &["budget", "reservation", "payee", "payer", "treasury", "judge"],
        &[&judge],
    );

    // USDC: A re-points its payout account, posts, and is paid after the
    // dispute window; the last payout closes the vault and the budget.
    let tokens = Tokens::install(
        &mut world,
        anchor_spl::token::ID,
        USDC_MAINNET_MINT,
        payer.insecure_clone(),
        a.insecure_clone(),
    );
    let terms = Terms {
        nonce: nonce(10),
        total: 10_000_000,
        cap: 0,
        ..terms
    };
    let budget = budget_address(&p, terms.nonce);
    const TOKEN_EXIT: [&str; 10] = [
        "budget",
        "vault",
        "reservation",
        "payee",
        "payer",
        "mint",
        "payout_account",
        "treasury_token",
        "refund",
        "token_program",
    ];
    send(
        &mut world,
        "open_token_budget",
        "data: as open_budget; the vault is [\"budget-vault\", budget], a token account owned by the budget",
        terms.open_token_ix(&tokens),
        &[
            "budget",
            "vault",
            "payer",
            "mint",
            "source",
            "token_program",
            "system_program",
            "judge_agent",
        ],
        &[&payer],
    );
    let created = world.slot();
    world.next_slot();
    let other = Pubkey::new_from_array([104; 32]);
    world.set(
        other,
        solana_account::Account {
            lamports: 10_000_000,
            data: token_account_data(&tokens.program, &tokens.mint, &a.pubkey(), 0),
            owner: tokens.program,
            ..Default::default()
        },
    );
    world.ok(
        "reserve",
        reserve_ix(
            &budget,
            created,
            &spender.pubkey(),
            &a.pubkey(),
            &other,
            6_000_000,
        ),
        &[&a, &spender],
    );
    send(
        &mut world,
        "set_payout_account",
        "by the payee, before its reservation is disputed or paid; a token account of the budget's mint it owns (SOL: the payee itself); data: created_slot u64",
        set_payout_ix(&budget, created, &a.pubkey(), &tokens.recipient),
        &["budget", "reservation", "payee", "payout_account"],
        &[&a],
    );
    world.ok(
        "post",
        post_ix(&budget, created, &a.pubkey(), 5_000_000),
        &[&a],
    );
    send(
        &mut world,
        "close_token_budget",
        "as close_budget; refund is a token account the payer owns; the SPL Memo program may follow; data: created_slot u64",
        token_close_ix(&tokens, &budget, created, &p),
        &["budget", "vault", "signer", "payer", "mint", "refund", "token_program"],
        &[&payer],
    );
    world.warp(world.slot() + 9_000);
    send(
        &mut world,
        "payout_token_budget",
        "by anyone; pays the recorded payout account, the treasury's token account and the payer's refund account; the SPL Memo program may follow; data: created_slot u64",
        token_payout_ix(&tokens, &budget, created, &a.pubkey(), &tokens.recipient),
        &TOKEN_EXIT,
        &[&spender],
    );

    // USDC, disputed and resolved.
    let terms = Terms {
        nonce: nonce(11),
        ..terms
    };
    let budget = budget_address(&p, terms.nonce);
    world.ok("open", terms.open_token_ix(&tokens), &[&payer]);
    let created = world.slot();
    world.next_slot();
    world.ok(
        "reserve",
        reserve_ix(
            &budget,
            created,
            &spender.pubkey(),
            &a.pubkey(),
            &tokens.recipient,
            6_000_000,
        ),
        &[&a, &spender],
    );
    world.ok(
        "post",
        post_ix(&budget, created, &a.pubkey(), 6_000_000),
        &[&a],
    );
    world.ok(
        "dispute",
        hold_ix("dispute", &budget, created, &a.pubkey(), &p),
        &[&payer],
    );
    let mut resolve = token_payout_ix(&tokens, &budget, created, &a.pubkey(), &tokens.recipient);
    resolve.data = selector("resolve_token_budget").to_vec();
    resolve.data.extend_from_slice(&created.to_le_bytes());
    resolve.data.extend_from_slice(&3_000_000u64.to_le_bytes());
    resolve
        .accounts
        .push(anchor_lang::prelude::AccountMeta::new_readonly(j, true));
    let mut names = TOKEN_EXIT.to_vec();
    names.push("judge");
    send(
        &mut world,
        "resolve_token_budget",
        "by the judge; accounts as payout_token_budget then the judge, then optionally the SPL Memo program; data: created_slot u64, payout u64",
        resolve,
        &names,
        &[&judge],
    );
    (instructions, accounts)
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
        "open_delivery",
        "record_delivery",
        "accept_delivery",
        "dispute_delivery",
        "resolve_delivery",
        "resolve_token_delivery",
        "open_budget",
        "open_token_budget",
        "reserve",
        "set_payout_account",
        "post_final",
        "waive",
        "dispute",
        "close_budget",
        "close_token_budget",
        "payout_budget",
        "payout_token_budget",
        "resolve_budget",
        "resolve_token_budget",
    ] {
        assert_eq!(
            names.iter().filter(|found| **found == name).count(),
            1,
            "{name}"
        );
    }
    assert_eq!(names.len(), 35);
}
