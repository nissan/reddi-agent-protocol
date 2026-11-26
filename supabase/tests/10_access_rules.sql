-- Access-rule checks for the V1 core migration. Each check raises on failure.
\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into public.profiles (user_id, wallet) values
  ('00000000-0000-0000-0000-00000000000a', '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr'),
  ('00000000-0000-0000-0000-00000000000b', '6uiQbwMor4UrWYiDtAJcgHKYW4vUaM3BUVChPgzdALse');

create function pg_temp.expect_denied(label text, stmt text) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
  exception when insufficient_privilege or check_violation then
    return;
  end;
  if n = 0 then return; end if; -- row level security filtered every row
  raise exception 'expected denial but statement changed % row(s): %', n, label;
end $$;

-- For statements that must raise, such as TRUNCATE, which reports no row count.
create function pg_temp.expect_error(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'expected a permission error but statement ran: %', label;
end $$;

-- Server: lists a provider under A's own wallet (PUT /api/listings writes with the service role).
set role service_role;
insert into public.providers (wallet, owner_user_id, display_name, endpoint_url, price_per_call_base_units, price_mint, network, status)
values ('3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr', '00000000-0000-0000-0000-00000000000a', 'A', 'https://a.example.test', 10000, 'mint', 'solana-devnet', 'listed');

-- A per-token listing keeps the per-call price at its zero default, and refuses negative prices.
update public.providers set price_input_per_million_base_units = 150000, price_output_per_million_base_units = 600000
  where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
do $$ begin
  if (select price_output_per_million_base_units from public.providers where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr') <> 600000
    then raise exception 'server cannot set per-token prices'; end if;
end $$;
do $$ begin
  begin
    update public.providers set price_input_per_million_base_units = -1 where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
  exception when check_violation then return;
  end;
  raise exception 'negative per-token price was accepted';
end $$;
-- A listing's ADL document is an object and always says where it came from.
update public.providers set adl = '{"apiVersion": "reddiagent.dev/v0.3"}'::jsonb, adl_source = 'provider'
  where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
do $$ begin
  begin
    update public.providers set adl_source = null where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
  exception when check_violation then
    begin
      update public.providers set adl = '[1]'::jsonb where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
    exception when check_violation then return;
    end;
    raise exception 'an ADL that is not an object was accepted';
  end;
  raise exception 'an ADL without its source was accepted';
end $$;
-- The database moves updated_at on every edit.
do $$ declare before timestamptz; after timestamptz; begin
  select updated_at into before from public.providers where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
  perform pg_sleep(0.01);
  update public.providers set display_name = 'A2' where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
  select updated_at into after from public.providers where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
  if after = before then raise exception 'updated_at did not change'; end if;
end $$;

-- A: signs in. Owners read their listing but never write providers directly (S5-claude-01, C7).
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.expect_denied('A edits own listing directly', $q$
  update public.providers set display_name = 'direct' where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr' $q$);
select pg_temp.expect_denied('A points own listing at an internal address', $q$
  update public.providers set endpoint_url = 'https://169.254.169.254/latest/meta-data' where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr' $q$);
select pg_temp.expect_denied('A inserts a second listing under own wallet', $q$
  insert into public.providers (wallet, owner_user_id, display_name, endpoint_url, price_per_call_base_units, price_mint, network, status)
  values ('3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr', '00000000-0000-0000-0000-00000000000a', 'dup', 'https://dup.example.test', 1, 'mint', 'solana-mainnet', 'listed') $q$);
do $$ begin
  if (select display_name from public.providers where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr') <> 'A2' then raise exception 'owner changed own listing directly'; end if;
end $$;
select pg_temp.expect_denied('A lists a provider under B''s wallet', $q$
  insert into public.providers (wallet, owner_user_id, display_name, endpoint_url, price_per_call_base_units, price_mint, network)
  values ('6uiQbwMor4UrWYiDtAJcgHKYW4vUaM3BUVChPgzdALse', '00000000-0000-0000-0000-00000000000a', 'x', 'https://x.example.test', 1, 'mint', 'solana-devnet') $q$);
select pg_temp.expect_denied('A sets server-owned health', $q$
  update public.providers set health_status = 'pass' where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr' $q$);
select pg_temp.expect_denied('A writes a job', $q$
  insert into public.jobs (buyer_wallet, provider_wallet, network, declared_model, request_hash, amount_base_units, mint, tx_signature, status)
  values ('w', '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr', 'solana-devnet', 'm', repeat('a', 64), 1, 'mint', 'sig', 'paid') $q$);
select pg_temp.expect_denied('A reads the replay ledger', 'select 1 from public.payment_replay');
select pg_temp.expect_denied('A calls the replay function', $q$ select public.replay_check_and_store('k') $q$);
select pg_temp.expect_denied('A calls the batch replay function', $q$ select public.replay_check_and_store_all(array['k']) $q$);
select pg_temp.expect_denied('A writes a profile', $q$
  update public.profiles set wallet = '6uiQbwMor4UrWYiDtAJcgHKYW4vUaM3BUVChPgzdALse' $q$);
select pg_temp.expect_error('A reads owner_user_id', 'select owner_user_id from public.providers');
select pg_temp.expect_error('A sets updated_at', $q$ update public.providers set updated_at = now() $q$);
select pg_temp.expect_error('A calls set_updated_at', $q$ select public.set_updated_at() $q$);
-- B: cannot edit or delete A's listing.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.expect_denied('B edits A''s listing', $q$
  update public.providers set display_name = 'hijacked' where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr' $q$);
select pg_temp.expect_denied('B deletes A''s listing', $q$
  delete from public.providers where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr' $q$);
do $$ begin
  if (select count(*) from public.profiles) <> 1 then raise exception 'B can see another profile'; end if;
end $$;

-- Server: records a paid job for buyer B from provider A, and replay keys.
reset role; set role service_role;
insert into public.jobs (id, buyer_wallet, buyer_user_id, provider_wallet, network, declared_model, request_hash, amount_base_units, mint, tx_signature, status)
values ('00000000-0000-0000-0000-0000000000f1', '6uiQbwMor4UrWYiDtAJcgHKYW4vUaM3BUVChPgzdALse', '00000000-0000-0000-0000-00000000000b',
        '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr', 'solana-devnet', 'm', repeat('a', 64), 10000, 'mint', 'sig-1', 'paid');
insert into public.receipts (job_id, receipt, provider_signature, schema_version)
values ('00000000-0000-0000-0000-0000000000f1', '{}', 'sig', 'v1');
insert into public.attestations (job_id, provider_wallet, attestor_wallet, outcome)
values ('00000000-0000-0000-0000-0000000000f1', '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr', 'attestor', 'pass');
insert into public.provider_stats (provider_wallet, jobs_delivered)
values ('3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr', 1);
do $$ begin
  if not public.replay_check_and_store('x402:tx:solana-devnet:sig-1') then raise exception 'first replay key refused'; end if;
  if public.replay_check_and_store('x402:tx:solana-devnet:sig-1') then raise exception 'replayed key accepted'; end if;
  -- All or none: a batch with one used key records nothing.
  if public.replay_check_and_store_all(array['x402:tx:solana-devnet:sig-1', 'x402:nonce:solana-devnet:p:n-1']) then raise exception 'batch with a used key accepted'; end if;
  if not public.replay_check_and_store('x402:nonce:solana-devnet:p:n-1') then raise exception 'refused batch left a key recorded'; end if;
  if not public.replay_check_and_store_all(array['x402:tx:solana-devnet:sig-2', 'x402:nonce:solana-devnet:p:n-2']) then raise exception 'new batch refused'; end if;
  if public.replay_check_and_store('x402:nonce:solana-devnet:p:n-2') then raise exception 'batch did not record its keys'; end if;
  begin
    insert into public.jobs (buyer_wallet, provider_wallet, network, declared_model, request_hash, amount_base_units, mint, tx_signature, status)
    values ('w', '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr', 'solana-devnet', 'm', repeat('b', 64), 1, 'mint', 'sig-1', 'paid');
    raise exception 'one transaction recorded for two jobs';
  exception when unique_violation then null;
  end;
end $$;

-- Buyer B and provider owner A each see the job and receipt; anon sees neither.
reset role; set role authenticated;
do $$ begin
  if (select count(*) from public.jobs) <> 1 or (select count(*) from public.receipts) <> 1 then
    raise exception 'buyer cannot see own job or receipt'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if (select count(*) from public.jobs) <> 1 or (select count(*) from public.receipts) <> 1 then
    raise exception 'provider owner cannot see job or receipt'; end if;
end $$;
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_error('anon reads jobs', 'select 1 from public.jobs');
select pg_temp.expect_error('anon reads receipts', 'select 1 from public.receipts');
select pg_temp.expect_error('anon reads profiles', 'select 1 from public.profiles');
do $$ begin
  if (select count(*) from public.providers) <> 1 then raise exception 'anon cannot see the listed provider'; end if;
end $$;
select pg_temp.expect_denied('anon lists a provider', $q$
  insert into public.providers (wallet, owner_user_id, display_name, endpoint_url, price_per_call_base_units, price_mint, network)
  values ('6uiQbwMor4UrWYiDtAJcgHKYW4vUaM3BUVChPgzdALse', '00000000-0000-0000-0000-00000000000b', 'x', 'https://x.example.test', 1, 'mint', 'solana-devnet') $q$);
-- Public reputation data for a listed provider is readable without the job.
do $$ begin
  if (select count(*) from public.attestations) <> 1 then raise exception 'anon cannot see attestations of a listed provider'; end if;
  if (select count(*) from public.provider_stats) <> 1 then raise exception 'anon cannot see stats of a listed provider'; end if;
end $$;
select pg_temp.expect_error('anon reads owner_user_id', 'select owner_user_id from public.providers');
-- The columns the app's public listing reads (lib/listings/listing-store.ts), ADL included.
do $$ begin
  perform wallet, display_name, endpoint_url, declared_models, capabilities, price_per_call_base_units,
    price_input_per_million_base_units, price_output_per_million_base_units, price_mint, network, status,
    health_status, last_seen_at, updated_at, adl, adl_source
  from public.providers;
end $$;
select pg_temp.expect_denied('anon writes an attestation', $q$
  insert into public.attestations (job_id, provider_wallet, attestor_wallet, outcome)
  values ('00000000-0000-0000-0000-0000000000f1', '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr', 'x', 'pass') $q$);

-- TRUNCATE ignores row level security, so it must be refused by privilege,
-- for both client roles and every table.
do $$ declare r text; t text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set role %I', r);
    foreach t in array array['profiles', 'providers', 'jobs', 'receipts', 'payment_replay', 'attestations', 'provider_stats'] loop
      perform pg_temp.expect_error(r || ' truncates ' || t, format('truncate public.%I cascade', t));
    end loop;
    reset role;
  end loop;
end $$;
do $$ begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'DELETE')
  ) then raise exception 'a client role holds TRUNCATE, REFERENCES, TRIGGER or DELETE on a public table'; end if;
end $$;

-- Once the provider is no longer listed, its public reputation data is hidden.
set role service_role;
update public.providers set status = 'paused' where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
reset role; set role anon;
do $$ begin
  if (select count(*) from public.attestations) <> 0 or (select count(*) from public.provider_stats) <> 0
     or (select count(*) from public.providers) <> 0 then
    raise exception 'anon can see data of a paused provider'; end if;
end $$;
-- A removal is a server decision: the owner cannot put a removed listing back (S5-claude-01).
reset role; set role service_role;
update public.providers set status = 'removed' where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.expect_denied('A relists a removed listing', $q$
  update public.providers set status = 'listed' where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr' $q$);
reset role; set role service_role;
do $$ begin
  if (select status from public.providers where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr') <> 'removed' then raise exception 'owner undid a removal'; end if;
end $$;
update public.providers set status = 'paused' where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';

-- An unrelated signed-in user sees no private rows either; the owner still sees the listing.
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if (select count(*) from public.providers) <> 1 then raise exception 'owner cannot see own paused listing'; end if;
end $$;
-- C: a third signed-in user with a profile sees no job, receipt or listing of A and B,
-- and is_provider_owner answers only about C.
reset role; set role postgres;
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');
insert into public.profiles (user_id, wallet) values ('00000000-0000-0000-0000-00000000000c', '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  if (select count(*) from public.jobs where id = '00000000-0000-0000-0000-0000000000f1') <> 0 then raise exception 'C reads another pair''s job'; end if;
  if (select count(*) from public.receipts where job_id = '00000000-0000-0000-0000-0000000000f1') <> 0 then raise exception 'C reads another pair''s receipt'; end if;
  if (select count(*) from public.providers) <> 0 then raise exception 'C sees an unlisted provider'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'C sees another profile'; end if;
  if public.is_provider_owner('3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr') then raise exception 'C is told it owns A''s provider'; end if;
end $$;
select pg_temp.expect_denied('C lists a provider under its own wallet', $q$
  insert into public.providers (wallet, owner_user_id, display_name, endpoint_url, price_per_call_base_units, price_mint, network, status)
  values ('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', '00000000-0000-0000-0000-00000000000c', 'C', 'https://c.example.test', 1, 'mint', 'solana-devnet', 'listed') $q$);
-- D: signed in with no profile row sees nothing private.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin
  if (select count(*) from public.jobs) <> 0 or (select count(*) from public.receipts) <> 0
     or (select count(*) from public.profiles) <> 0 or (select count(*) from public.providers) <> 0 then
    raise exception 'a user without a profile sees private rows'; end if;
end $$;
-- No client role holds INSERT, UPDATE or DELETE on providers at all.
reset role;
do $$ begin
  if exists (
    select 1 from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'providers' and grantee in ('anon', 'authenticated', 'PUBLIC')
      and privilege_type in ('INSERT', 'UPDATE')
  ) or exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'providers' and grantee in ('anon', 'authenticated', 'PUBLIC')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then raise exception 'a client role can still write providers'; end if;
end $$;
-- The provider kit's state (payment replay, settle records, held answers,
-- budget slices) is
-- for the providers' own server connection only: no client role may touch it.
do $$ declare r text; t text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set role %I', r);
    foreach t in array array['replay', 'leases', 'held_answers', 'pending_settles', 'capacity', 'budget_slices'] loop
      perform pg_temp.expect_error(r || ' reads provider_kit.' || t, format('select 1 from provider_kit.%I', t));
      perform pg_temp.expect_error(r || ' truncates provider_kit.' || t, format('truncate provider_kit.%I', t));
    end loop;
    perform pg_temp.expect_error(r || ' writes provider_kit.replay', $q$ insert into provider_kit.replay (provider, key) values ('p', 'k') $q$);
    reset role;
  end loop;
end $$;
do $$ begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'provider_kit' and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) or has_schema_privilege('anon', 'provider_kit', 'usage') or has_schema_privilege('authenticated', 'provider_kit', 'usage')
  then raise exception 'a client role holds a privilege in provider_kit'; end if;
end $$;

-- The providers' own role uses its six tables and nothing else.
set role provider_kit_app;
insert into provider_kit.replay (provider, key) values ('p', 'k');
do $$ begin
  if (select count(*) from provider_kit.replay) <> 1 then raise exception 'provider_kit_app cannot read its own rows'; end if;
end $$;
delete from provider_kit.replay;
do $$ declare t text; begin
  foreach t in array array['profiles', 'providers', 'jobs', 'receipts', 'payment_replay', 'attestations', 'provider_stats'] loop
    perform pg_temp.expect_error('provider_kit_app reads public.' || t, format('select 1 from public.%I', t));
    perform pg_temp.expect_error('provider_kit_app writes public.' || t, format('delete from public.%I', t));
  end loop;
  perform pg_temp.expect_error('provider_kit_app truncates its replay table', 'truncate provider_kit.replay');
end $$;
reset role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'provider_kit_app' and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolcanlogin))
  then raise exception 'provider_kit_app has more than table access'; end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('provider_kit_app', p.oid, 'execute')
      -- Extension functions (pgcrypto's hashes and ciphers) touch no table.
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  ) then raise exception 'provider_kit_app can run one of the project''s public functions'; end if;
end $$;


-- Budget custody (spender records and their public keys, their use log, alerts, the pause switch):
-- the server's service role only. No client role may read or write them, and
-- the use log and alerts cannot be rewritten even by the server.
reset role;
do $$ declare r text; t text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set role %I', r);
    foreach t in array array['budget_spenders', 'budget_spender_uses', 'budget_alerts', 'budget_controls', 'sandbox_budget_slices'] loop
      perform pg_temp.expect_error(r || ' reads public.' || t, format('select 1 from public.%I', t));
      perform pg_temp.expect_error(r || ' truncates public.' || t, format('truncate public.%I', t));
    end loop;
    perform pg_temp.expect_error(r || ' pauses budgets', 'update public.budget_controls set paused = false');
    reset role;
  end loop;
end $$;
set role service_role;
insert into public.budget_spenders (id, spender, payer, network, status, spender_key, record, version)
  values ('0123456789abcdef0123456789abcdef', 'S', 'P', 'solana-devnet', 'pending', '02' || repeat('ab', 32), '{}', 1);
-- A record holds a 33-byte compressed P-256 public key in hex, nothing else.
do $$ begin
  begin
    insert into public.budget_spenders (id, spender, payer, network, status, spender_key, record, version)
      values ('fedcba9876543210fedcba9876543210', 'S', 'P', 'solana-devnet', 'pending', '04' || repeat('ab', 32), '{}', 1);
  exception when check_violation then return;
  end;
  raise exception 'a malformed spender key was stored';
end $$;
insert into public.budget_spender_uses (spender_id, purpose, message_sha256)
  values ('0123456789abcdef0123456789abcdef', 'reserve', repeat('a', 64));
select pg_temp.expect_error('server rewrites the spender use log', 'update public.budget_spender_uses set purpose = ''close''');
select pg_temp.expect_error('server deletes the spender use log', 'delete from public.budget_spender_uses');
-- The one way a use is logged (review S6, rounds 5 and 5b): clients cannot
-- call it; for the server it checks the pause, the status and the limits
-- atomically. Only a close the incident step asks for skips the pause and
-- the limits; the agent's close is paused and counted.
reset role;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set role %I', r);
    perform pg_temp.expect_error(r || ' logs a spender use', 'select public.budget_spender_use(''0123456789abcdef0123456789abcdef'', ''close'', null, repeat(''a'', 64), ''{}''::jsonb, true, 3, 100, 1000)');
    perform pg_temp.expect_error(r || ' queues an operator alert', 'select public.budget_operator_alert_queue(''{"kind":"x","subject":"y"}''::jsonb)');
    perform pg_temp.expect_error(r || ' takes the operator alerts', 'select public.budget_operator_alert_take()');
    reset role;
  end loop;
end $$;
set role service_role;
do $$ declare got text; ok boolean; id text := '0123456789abcdef0123456789abcdef'; begin
  got := public.budget_spender_use(id, 'reserve', null, repeat('b', 64), '{}'::jsonb, false, 5, 100, 1000);
  if got <> 'not_open' then raise exception 'a pending key logged a reserve: %', got; end if;
  update public.budget_spenders set status = 'open' where budget_spenders.id = '0123456789abcdef0123456789abcdef';
  got := public.budget_spender_use(id, 'reserve', 'X', repeat('b', 64), '{}'::jsonb, false, 2, 100, 1000);
  if got <> 'ok' then raise exception 'an open key under its limit was refused: %', got; end if;
  got := public.budget_spender_use(id, 'reserve', 'X', repeat('c', 64), '{}'::jsonb, false, 2, 100, 1000);
  if got <> 'overuse' then raise exception 'the use limit did not hold: %', got; end if;
  got := public.budget_spender_use(id, 'close', null, repeat('c', 64), '{}'::jsonb, false, 2, 100, 1000);
  if got <> 'overuse' then raise exception 'the agent''s close was not counted: %', got; end if;
  update public.budget_controls set paused = true where budget_controls.id = 1;
  got := public.budget_spender_use(id, 'waive', null, repeat('d', 64), '{}'::jsonb, false, 100, 100, 1000);
  if got <> 'paused' then raise exception 'a paused waive was logged: %', got; end if;
  got := public.budget_spender_use(id, 'close', null, repeat('d', 64), '{}'::jsonb, false, 100, 100, 1000);
  if got <> 'paused' then raise exception 'the agent''s close went through a pause: %', got; end if;
  got := public.budget_spender_use(id, 'close', null, repeat('e', 64), '{}'::jsonb, true, 1, 1, 1);
  if got <> 'ok' then raise exception 'the incident step''s close was refused: %', got; end if;
  begin
    perform public.budget_spender_use(id, 'reserve', 'X', repeat('e', 64), '{}'::jsonb, true, 100, 100, 1000);
    ok := true;
  exception when others then ok := false;
  end;
  if ok then raise exception 'the operator path logged a reserve'; end if;
  update public.budget_controls set paused = false, watched_at = now() where budget_controls.id = 1;
  -- Limits are required.
  foreach got in array array['null', '0'] loop
    begin
      execute format('select public.budget_spender_use(%L, ''reserve'', ''X'', repeat(''9'', 64), ''{}''::jsonb, false, 100, %s, 1000)', id, got);
      ok := true;
    exception when others then ok := false;
    end;
    if ok then raise exception 'a claim with limit % was accepted', got; end if;
  end loop;
  -- Two counted uses so far (the direct insert and the first reserve); the
  -- incident step's close is not counted. Past the ceiling: refused, and the
  -- first refusal in ten minutes says so once.
  got := public.budget_spender_use(id, 'reserve', 'X', repeat('1', 64), '{"amount":"5"}'::jsonb, false, 100, 100, 2);
  if got <> 'global_overuse_new' then raise exception 'the global ceiling did not hold: %', got; end if;
  got := public.budget_spender_use(id, 'reserve', 'X', repeat('1', 64), '{"amount":"5"}'::jsonb, false, 100, 100, 2);
  if got <> 'global_overuse' then raise exception 'the ceiling told the operator twice: %', got; end if;
  if (select paused from public.budget_controls where budget_controls.id = 1) then raise exception 'the ceiling paused everything'; end if;
  got := public.budget_spender_use(id, 'reserve', 'X', repeat('1', 64), '{"amount":"5"}'::jsonb, false, 100, 2, 100);
  if got <> 'payer_overuse' then raise exception 'the per-payer limit did not hold: %', got; end if;
  got := public.budget_spender_use(id, 'reserve', 'X', repeat('1', 64), '{"amount":"5"}'::jsonb, false, 100, 100, 3);
  if got <> 'ok' then raise exception 'a reserve under every limit was refused: %', got; end if;
  if (select detail->>'amount' from public.budget_spender_uses where message_sha256 = repeat('1', 64)) is distinct from '5' then
    raise exception 'the approval detail was not logged';
  end if;
  -- Another payer's Budget on mainnet counts apart from devnet's three.
  insert into public.budget_spenders (id, spender, payer, network, status, spender_key, record, version)
    values ('fedcba9876543210fedcba9876543210', 'S', 'Q', 'solana-mainnet-beta', 'open', '02' || repeat('cd', 32), '{}', 1);
  got := public.budget_spender_use('fedcba9876543210fedcba9876543210', 'reserve', 'X', repeat('3', 64), '{}'::jsonb, false, 100, 100, 1);
  if got <> 'ok' then raise exception 'mainnet was counted with devnet: %', got; end if;
  -- Operator alerts: kept once each, handed over and emptied in one step.
  perform public.budget_operator_alert_queue('{"kind":"budget_frozen","subject":"s","spenderId":"a"}'::jsonb);
  perform public.budget_operator_alert_queue('{"kind":"budget_frozen","subject":"s","spenderId":"a"}'::jsonb);
  perform public.budget_operator_alert_queue('{"kind":"watcher_stalled","subject":"t"}'::jsonb);
  if jsonb_array_length(public.budget_operator_alert_take()) <> 2 then raise exception 'operator alerts were not kept once each'; end if;
  if jsonb_array_length(public.budget_operator_alert_take()) <> 0 then raise exception 'taking the operator alerts did not empty the queue'; end if;
end $$;
-- Under REPEATABLE READ the counts would come from a stale snapshot: refused.
begin transaction isolation level repeatable read;
do $$ begin
  perform public.budget_spender_use('0123456789abcdef0123456789abcdef', 'reserve', 'X', repeat('4', 64), '{}'::jsonb, false, 100, 100, 1000);
  raise exception 'ran under repeatable read';
exception when others then
  if sqlerrm = 'ran under repeatable read' then raise; end if;
end $$;
commit;
do $$ declare got text; sid text := '0123456789abcdef0123456789abcdef'; begin
  update public.budget_spenders set status = 'closed' where budget_spenders.id = sid;
  got := public.budget_spender_use(sid, 'close', null, repeat('f', 64), '{}'::jsonb, false, 100, 100, 1000);
  if got <> 'closed' then raise exception 'a closed budget logged another close: %', got; end if;
  got := public.budget_spender_use('ffffffffffffffffffffffffffffffff', 'close', null, repeat('f', 64), '{}'::jsonb, false, 100, 100, 1000);
  if got <> 'unknown' then raise exception 'a missing record logged a use: %', got; end if;
end $$;
-- The signer's hold log (audit 2026-11-25, RT-M2): clients cannot touch it;
-- the server may add rows but not name their id or time, and nobody edits or
-- deletes one.
reset role;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set role %I', r);
    perform pg_temp.expect_error(r || ' reads the hold log', 'select 1 from public.budget_signer_holds');
    perform pg_temp.expect_error(r || ' adds a hold', 'insert into public.budget_signer_holds (scope, kind) values (''all'', ''hold'')');
    perform pg_temp.expect_error(r || ' numbers a call', 'select public.budget_spender_call(''fedcba9876543210fedcba9876543210'', ''X'', repeat(''a'', 64), ''{}''::jsonb, 100, 100, 1000)');
    reset role;
  end loop;
end $$;
set role service_role;
insert into public.budget_signer_holds (scope, kind, reason) values ('all', 'hold', 'drill');
insert into public.budget_signer_holds (scope, spender_id, kind, reason) values ('spender', 'fedcba9876543210fedcba9876543210', 'hold', 'watch');
select pg_temp.expect_error('server places a hold row by id', 'insert into public.budget_signer_holds (id, scope, kind) values (999, ''all'', ''release'')');
select pg_temp.expect_error('server backdates a hold row', 'insert into public.budget_signer_holds (scope, kind, at) values (''all'', ''hold'', now() - interval ''1 day'')');
select pg_temp.expect_error('server rewrites the hold log', 'update public.budget_signer_holds set kind = ''release''');
select pg_temp.expect_error('server deletes from the hold log', 'delete from public.budget_signer_holds');
select pg_temp.expect_error('server truncates the hold log', 'truncate public.budget_signer_holds');
select pg_temp.expect_error('server resets the hold log''s numbering', 'select setval(''public.budget_signer_holds_id_seq'', 1)');
do $$ declare ok boolean; stmt text; begin
  foreach stmt in array array[
    'insert into public.budget_signer_holds (scope, kind) values (''all'', ''release'')',
    'insert into public.budget_signer_holds (scope, kind, mac) values (''all'', ''release'', ''nothex'')',
    'insert into public.budget_signer_holds (scope, kind) values (''spender'', ''hold'')',
    'insert into public.budget_signer_holds (scope, spender_id, kind) values (''all'', ''fedcba9876543210fedcba9876543210'', ''hold'')'
  ] loop
    begin
      execute stmt;
      ok := true;
    exception when check_violation then ok := false;
    end;
    if ok then raise exception 'the hold log took a malformed row: %', stmt; end if;
  end loop;
end $$;
reset role;
do $$ begin
  begin
    update public.budget_signer_holds set reason = 'x';
  exception when others then
    if sqlerrm <> 'budget_signer_holds is append-only' then raise; end if;
    return;
  end;
  raise exception 'the table owner rewrote the hold log';
end $$;
set role service_role;
-- Call numbers come from the use log, one after another per record and provider.
do $$ declare got text; sid text := 'fedcba9876543210fedcba9876543210'; begin
  got := public.budget_spender_call(sid, 'PA', repeat('5', 64), '{}'::jsonb, 100, 100, 1000);
  if got <> 'ok:1' then raise exception 'the first call was numbered %', got; end if;
  got := public.budget_spender_call(sid, 'PA', repeat('5', 64), '{"sequence":"77"}'::jsonb, 100, 100, 1000);
  if got <> 'ok:2' then raise exception 'the second call was numbered % (the caller''s number must not count)', got; end if;
  got := public.budget_spender_call(sid, 'PB', repeat('5', 64), '{}'::jsonb, 100, 100, 1000);
  if got <> 'ok:1' then raise exception 'another provider shared the counter: %', got; end if;
  if (select count(*) from public.budget_spender_uses where spender_id = sid and purpose = 'call' and payee = 'PA' and detail ->> 'sequence' in ('1', '2')) <> 2 then
    raise exception 'the call numbers were not logged';
  end if;
  got := public.budget_spender_call('ffffffffffffffffffffffffffffffff', 'PA', repeat('5', 64), '{}'::jsonb, 100, 100, 1000);
  if got <> 'unknown' then raise exception 'a missing record numbered a call: %', got; end if;
  insert into public.budget_spender_uses (spender_id, purpose, payee, message_sha256, detail) values (sid, 'call', 'PC', repeat('6', 64), '{"sequence":"1000000"}');
  got := public.budget_spender_call(sid, 'PC', repeat('5', 64), '{}'::jsonb, 100, 100, 1000);
  if got <> 'exhausted' then raise exception 'numbers past the last one were handed out: %', got; end if;
end $$;
update public.budget_controls set paused = true, reason = 'test';
-- The sandbox providers' Budget ledger: the server writes it, conditionally on its version, and never deletes it.
insert into public.sandbox_budget_slices (provider, budget, status, record, version)
  values ('atlas-review', '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr', 'open', '{}', 1);
update public.sandbox_budget_slices set version = 2, status = 'posted' where provider = 'atlas-review' and version = 1;
select pg_temp.expect_error('server deletes a sandbox budget slice', 'delete from public.sandbox_budget_slices');
reset role;


-- The mainnet Budget signer's schema (#1205, 20261126150000_budget_mainnet_custody.sql).
-- RAP-MB3-S1: nothing the devnet app or devnet signer holds (the service role
-- key), and no browser role, can read or write it or run its functions.
create function pg_temp.expect_no_access(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'expected a permission error but statement ran: %', label;
end $$;
do $$
declare r text; t text;
begin
  foreach r in array array['service_role', 'anon', 'authenticated'] loop
    execute format('set role %I', r);
    foreach t in array array['budget_spenders', 'budget_spender_uses', 'budget_alerts', 'budget_controls', 'budget_signer_holds'] loop
      perform pg_temp.expect_no_access(r || ' reads mainnet ' || t, format('select count(*) from budget_mainnet.%I', t));
      perform pg_temp.expect_no_access(r || ' deletes mainnet ' || t, format('delete from budget_mainnet.%I', t));
    end loop;
    perform pg_temp.expect_no_access(r || ' adds a mainnet record', $q$insert into budget_mainnet.budget_spenders (id, spender, spender_key, payer, budget, network, status, record, version) values (repeat('a', 32), 'S', '02' || repeat('0', 64), 'P', 'B', 'solana-mainnet-beta', 'open', '{}', 1)$q$);
    perform pg_temp.expect_no_access(r || ' unpauses mainnet Budgets', 'update budget_mainnet.budget_controls set paused = false');
    perform pg_temp.expect_no_access(r || ' adds a mainnet hold', $q$insert into budget_mainnet.budget_signer_holds (scope, kind, reason) values ('all', 'hold', 'x')$q$);
    perform pg_temp.expect_no_access(r || ' logs a mainnet use', $q$select budget_mainnet.budget_spender_use(repeat('a', 32), 'close', null, repeat('a', 64), '{}'::jsonb, true, 3, 100, 1000)$q$);
    perform pg_temp.expect_no_access(r || ' numbers a mainnet call', $q$select budget_mainnet.budget_spender_call(repeat('a', 32), 'X', repeat('a', 64), '{}'::jsonb, 3, 100, 1000)$q$);
    perform pg_temp.expect_no_access(r || ' takes mainnet operator alerts', 'select budget_mainnet.budget_operator_alert_take()');
    reset role;
  end loop;
  -- The API's connection role can become each mainnet role (the token names it), and neither is a superuser or skips row level security.
  if not pg_has_role('authenticator', 'budget_mainnet_signer', 'member') or not pg_has_role('authenticator', 'budget_mainnet_app', 'member') then
    raise exception 'the API cannot switch to the mainnet roles';
  end if;
  if exists (select 1 from pg_roles where rolname in ('budget_mainnet_signer', 'budget_mainnet_app') and (rolsuper or rolbypassrls or rolcanlogin or rolcreaterole)) then
    raise exception 'a mainnet role has more than it needs';
  end if;
  if pg_has_role('service_role', 'budget_mainnet_signer', 'member') or pg_has_role('service_role', 'budget_mainnet_app', 'member') then
    raise exception 'the service role can become a mainnet role';
  end if;
end $$;

-- The mainnet app: makes and updates records, but cannot touch the use log or the functions that count from it.
set role budget_mainnet_app;
insert into budget_mainnet.budget_spenders (id, spender, spender_key, payer, budget, network, status, record, version) values
  (repeat('a', 32), 'S', '02' || repeat('0', 64), 'PAYER-A', 'BUDGET-A1', 'solana-mainnet-beta', 'open', '{}', 1),
  (repeat('b', 32), 'S', '02' || repeat('0', 64), 'PAYER-A', 'BUDGET-A2', 'solana-mainnet-beta', 'open', '{}', 1),
  (repeat('c', 32), 'S', '02' || repeat('0', 64), 'PAYER-B', 'BUDGET-B1', 'solana-mainnet-beta', 'open', '{}', 1);
update budget_mainnet.budget_spenders set version = 2 where id = repeat('c', 32);
insert into budget_mainnet.budget_signer_holds (scope, spender_id, kind, reason) values ('spender', repeat('b', 32), 'hold', 'test');
do $$ begin
  if (select count(*) from budget_mainnet.budget_signer_holds) <> 1 then raise exception 'the mainnet app cannot read the hold log'; end if;
  perform pg_temp.expect_no_access('mainnet app writes the use log', $q$insert into budget_mainnet.budget_spender_uses (spender_id, purpose, message_sha256) values (repeat('a', 32), 'call', repeat('a', 64))$q$);
  perform pg_temp.expect_no_access('mainnet app logs a use', $q$select budget_mainnet.budget_spender_use(repeat('a', 32), 'reserve', 'X', repeat('a', 64), '{}'::jsonb, false, 3, 100, 1000)$q$);
  perform pg_temp.expect_no_access('mainnet app numbers a call', $q$select budget_mainnet.budget_spender_call(repeat('a', 32), 'X', repeat('a', 64), '{}'::jsonb, 3, 100, 1000)$q$);
  perform pg_temp.expect_no_access('mainnet app deletes a record', 'delete from budget_mainnet.budget_spenders');
  perform pg_temp.expect_no_access('mainnet app sets a hold row''s time', $q$insert into budget_mainnet.budget_signer_holds (scope, kind, reason, at) values ('all', 'hold', 'x', now() - interval '1 day')$q$);
  perform pg_temp.expect_no_access('mainnet app reads the devnet records', 'select count(*) from public.budget_spenders');
  -- RAP-MB3-S2: no record without a Budget, none for another network, and a record keeps its id, payer, Budget and network.
  begin
    insert into budget_mainnet.budget_spenders (id, spender, spender_key, payer, budget, network, status, record, version) values (repeat('d', 32), 'S', '02' || repeat('0', 64), 'P', null, 'solana-mainnet-beta', 'open', '{}', 1);
    raise exception 'a mainnet record without a Budget was stored';
  exception when not_null_violation then null;
  end;
  begin
    update budget_mainnet.budget_spenders set budget = null where id = repeat('a', 32);
    raise exception 'a mainnet record''s Budget was emptied';
  exception when not_null_violation or raise_exception then
    if sqlerrm like '%was emptied%' then raise; end if;
  end;
  begin
    insert into budget_mainnet.budget_spenders (id, spender, spender_key, payer, budget, network, status, record, version) values (repeat('d', 32), 'S', '02' || repeat('0', 64), 'P', 'BUDGET-D', 'solana-devnet', 'open', '{}', 1);
    raise exception 'a devnet record was stored in the mainnet schema';
  exception when check_violation then null;
  end;
  begin
    update budget_mainnet.budget_spenders set payer = 'PAYER-B' where id = repeat('a', 32);
    raise exception 'a mainnet record changed payer';
  exception when raise_exception then
    if sqlerrm like '%changed payer%' then raise; end if;
  end;
  begin
    update budget_mainnet.budget_spenders set budget = 'BUDGET-OTHER' where id = repeat('a', 32);
    raise exception 'a mainnet record changed Budget';
  exception when raise_exception then
    if sqlerrm like '%changed Budget%' then raise; end if;
  end;
  begin
    update budget_mainnet.budget_spenders set id = repeat('e', 32) where id = repeat('a', 32);
    raise exception 'a mainnet record changed id';
  exception when raise_exception then
    if sqlerrm like '%changed id%' then raise; end if;
  end;
  begin
    insert into budget_mainnet.budget_spenders (id, spender, spender_key, payer, budget, network, status, record, version) values (repeat('e', 32), 'S', '02' || repeat('0', 64), 'PAYER-A', 'BUDGET-A1', 'solana-mainnet-beta', 'open', '{}', 1);
    raise exception 'a second record for one mainnet Budget was stored';
  exception when unique_violation then null;
  end;
end $$;
reset role;

-- The mainnet signer: logs uses and numbers calls, under its own ceilings.
set role budget_mainnet_signer;
do $$
declare got text; a1 text := repeat('a', 32); a2 text := repeat('b', 32); b1 text := repeat('c', 32); n integer;
begin
  -- RAP-MB3-S3: payer A (two Budgets) reaches its ceiling of 3 calls; ceiling for all payers is 5.
  got := budget_mainnet.budget_spender_call(a1, 'X', repeat('1', 64), '{}'::jsonb, 100, 3, 5);
  if got <> 'ok:1' then raise exception 'mainnet call 1: %', got; end if;
  got := budget_mainnet.budget_spender_call(a2, 'X', repeat('1', 64), '{}'::jsonb, 100, 3, 5);
  if got <> 'ok:1' then raise exception 'mainnet call on the second Budget: %', got; end if;
  got := budget_mainnet.budget_spender_call(a1, 'X', repeat('1', 64), '{}'::jsonb, 100, 3, 5);
  if got <> 'ok:2' then raise exception 'mainnet call 2: %', got; end if;
  for n in 1..10 loop
    got := budget_mainnet.budget_spender_call(case when n % 2 = 0 then a1 else a2 end, 'X', repeat('1', 64), '{}'::jsonb, 100, 3, 5);
    if got <> 'payer_overuse' then raise exception 'a payer went past its ceiling: %', got; end if;
  end loop;
  -- Ten refused calls later, payer B's call is still signed: a refused call is not logged.
  got := budget_mainnet.budget_spender_call(b1, 'X', repeat('2', 64), '{}'::jsonb, 100, 3, 5);
  if got <> 'ok:1' then raise exception 'another payer was refused while one payer was at its ceiling: %', got; end if;
  if (select count(*) from budget_mainnet.budget_spender_uses) <> 4 then raise exception 'refused mainnet calls were logged'; end if;
  -- Approvals are counted apart from calls, and the ceiling for all payers still holds.
  got := budget_mainnet.budget_spender_use(b1, 'reserve', 'X', repeat('3', 64), '{}'::jsonb, false, 100, 100, 1);
  if got <> 'ok' then raise exception 'a mainnet approval was counted with the calls: %', got; end if;
  got := budget_mainnet.budget_spender_use(a1, 'reserve', 'X', repeat('3', 64), '{}'::jsonb, false, 100, 100, 1);
  if got <> 'global_overuse_new' then raise exception 'the mainnet ceiling for all payers did not hold: %', got; end if;
  -- The pause stops the signer too; the incident close goes through it.
  update budget_mainnet.budget_controls set paused = true, reason = 'test' where id = 1;
  got := budget_mainnet.budget_spender_call(b1, 'X', repeat('4', 64), '{}'::jsonb, 100, 100, 100);
  if got <> 'paused' then raise exception 'a paused mainnet signer numbered a call: %', got; end if;
  got := budget_mainnet.budget_spender_use(b1, 'close', null, repeat('5', 64), '{}'::jsonb, true, 1, 1, 1);
  if got <> 'ok' then raise exception 'the mainnet incident close was refused: %', got; end if;
  -- The logs are append-only for the signer as well.
  begin
    update budget_mainnet.budget_spender_uses set purpose = 'close';
    raise exception 'the mainnet use log was rewritten';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm like '%was rewritten%' then raise; end if;
  end;
  begin
    delete from budget_mainnet.budget_signer_holds;
    raise exception 'the mainnet hold log was emptied';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm like '%was emptied%' then raise; end if;
  end;
  perform pg_temp.expect_no_access('mainnet signer reads the devnet records', 'select count(*) from public.budget_spenders');
  perform pg_temp.expect_no_access('mainnet signer logs a devnet use', $q$select public.budget_spender_use(repeat('a', 32), 'close', null, repeat('a', 64), '{}'::jsonb, true, 3, 100, 1000)$q$);
end $$;
reset role;
-- The mainnet routes' rate limits: only the mainnet app counts a hit, and nobody reads or clears the table directly.
do $$
declare r text;
begin
  foreach r in array array['service_role', 'anon', 'authenticated', 'budget_mainnet_signer'] loop
    execute format('set role %I', r);
    perform pg_temp.expect_no_access(r || ' counts a mainnet rate-limit hit', $q$select budget_mainnet.budget_rate_hit('route:1.2.3.4', 60, 2)$q$);
    perform pg_temp.expect_no_access(r || ' reads the mainnet rate limits', 'select count(*) from budget_mainnet.budget_rate_limits');
    perform pg_temp.expect_no_access(r || ' clears the mainnet rate limits', 'delete from budget_mainnet.budget_rate_limits');
    reset role;
  end loop;
  set role budget_mainnet_app;
  if budget_mainnet.budget_rate_hit('route:1.2.3.4', 60, 2) <> 0 or budget_mainnet.budget_rate_hit('route:1.2.3.4', 60, 2) <> 0 then
    raise exception 'the mainnet app was refused inside its limit';
  end if;
  if budget_mainnet.budget_rate_hit('route:1.2.3.4', 60, 2) < 1 then raise exception 'the mainnet rate limit did not hold'; end if;
  if budget_mainnet.budget_rate_hit('route:5.6.7.8', 60, 2) <> 0 then raise exception 'one mainnet client used up another''s allowance'; end if;
  perform pg_temp.expect_no_access('mainnet app reads the rate limits directly', 'select count(*) from budget_mainnet.budget_rate_limits');
  perform pg_temp.expect_no_access('mainnet app clears the rate limits', 'delete from budget_mainnet.budget_rate_limits');
  reset role;
end $$;

-- The mainnet judge's tables and role (#1210, 20261127100000_budget_mainnet_judge.sql).
do $$
declare r text; t text; n bigint;
  receipt_cols constant text := '(budget, created_slot, payee, source, receipt)';
  slice constant text := $q$'11111111111111111111111111111111', '42', '11111111111111111111111111111112'$q$;
begin
  -- Nothing but the mainnet app and the mainnet judge reaches the two tables: not the service role, a browser role or the signer.
  foreach r in array array['service_role', 'anon', 'authenticated', 'budget_mainnet_signer'] loop
    execute format('set role %I', r);
    foreach t in array array['budget_call_receipts', 'budget_judge_log'] loop
      perform pg_temp.expect_no_access(r || ' reads mainnet ' || t, format('select count(*) from budget_mainnet.%I', t));
      perform pg_temp.expect_no_access(r || ' empties mainnet ' || t, format('delete from budget_mainnet.%I', t));
    end loop;
    perform pg_temp.expect_no_access(r || ' adds a mainnet receipt', format($q$insert into budget_mainnet.budget_call_receipts %s values (%s, 'relay', 'r')$q$, receipt_cols, slice));
    perform pg_temp.expect_no_access(r || ' writes the mainnet judge log', format($q$insert into budget_mainnet.budget_judge_log (budget, created_slot, payee, kind) values (%s, 'seen')$q$, slice));
    reset role;
  end loop;
  if not pg_has_role('authenticator', 'budget_mainnet_judge', 'member') then raise exception 'the API cannot switch to the mainnet judge role'; end if;
  if exists (select 1 from pg_roles where rolname = 'budget_mainnet_judge' and (rolsuper or rolbypassrls or rolcanlogin or rolcreaterole or rolinherit)) then
    raise exception 'the mainnet judge role has more than it needs';
  end if;
  if pg_has_role('budget_mainnet_judge', 'budget_mainnet_signer', 'member') or pg_has_role('budget_mainnet_judge', 'budget_mainnet_app', 'member')
     or pg_has_role('budget_mainnet_app', 'budget_mainnet_judge', 'member') or pg_has_role('budget_mainnet_signer', 'budget_mainnet_judge', 'member')
     or pg_has_role('service_role', 'budget_mainnet_judge', 'member') then
    raise exception 'another role can act as the mainnet judge, or the judge as another';
  end if;

  -- The mainnet app: adds the receipts its relay saw, and nothing else.
  set role budget_mainnet_app;
  execute format($q$insert into budget_mainnet.budget_call_receipts %s values (%s, 'relay', 'relay-receipt')$q$, receipt_cols, slice);
  perform pg_temp.expect_no_access('mainnet app adds a receipt as a provider', format($q$insert into budget_mainnet.budget_call_receipts %s values (%s, 'provider', 'x')$q$, receipt_cols, slice));
  perform pg_temp.expect_no_access('mainnet app sets a receipt''s time', format($q$insert into budget_mainnet.budget_call_receipts (budget, created_slot, payee, source, receipt, at) values (%s, 'relay', 'x', now() - interval '1 day')$q$, slice));
  perform pg_temp.expect_no_access('mainnet app reads the receipts', 'select count(*) from budget_mainnet.budget_call_receipts');
  perform pg_temp.expect_no_access('mainnet app rewrites a receipt', $q$update budget_mainnet.budget_call_receipts set receipt = 'y'$q$);
  perform pg_temp.expect_no_access('mainnet app empties the receipts', 'delete from budget_mainnet.budget_call_receipts');
  perform pg_temp.expect_no_access('mainnet app reads the judge log', 'select count(*) from budget_mainnet.budget_judge_log');
  perform pg_temp.expect_no_access('mainnet app writes the judge log', format($q$insert into budget_mainnet.budget_judge_log (budget, created_slot, payee, kind, reason, mac) values (%s, 'release', 'x', repeat('a', 64))$q$, slice));
  reset role;

  -- The mainnet judge: reads the evidence and the signed calls, adds providers' receipts, writes its log.
  set role budget_mainnet_judge;
  select count(*) into n from budget_mainnet.budget_call_receipts where source = 'relay';
  if n <> 1 then raise exception 'the mainnet judge cannot read the relay''s receipt: %', n; end if;
  execute format($q$insert into budget_mainnet.budget_call_receipts %s values (%s, 'provider', 'provider-receipt')$q$, receipt_cols, slice);
  perform pg_temp.expect_no_access('mainnet judge adds a receipt as the relay', format($q$insert into budget_mainnet.budget_call_receipts %s values (%s, 'relay', 'x')$q$, receipt_cols, slice));
  execute format($q$insert into budget_mainnet.budget_judge_log (budget, created_slot, payee, kind, reason, detail, mac) values (%s, 'hold', 'test', '{}', repeat('a', 64))$q$, slice);
  select count(*) into n from budget_mainnet.budget_judge_log;
  if n <> 1 then raise exception 'the mainnet judge cannot read its log: %', n; end if;
  perform pg_temp.expect_no_access('mainnet judge sets a log row''s time', format($q$insert into budget_mainnet.budget_judge_log (budget, created_slot, payee, kind, at) values (%s, 'seen', now() - interval '1 day')$q$, slice));
  -- Which record a Budget has and the calls its spender signed: these columns, read only.
  select count(*) into n from (select id, budget from budget_mainnet.budget_spenders) s;
  if n < 1 then raise exception 'the mainnet judge cannot see which record a Budget has'; end if;
  select count(*) into n from (select id, spender_id, purpose, payee, detail from budget_mainnet.budget_spender_uses) u;
  if n < 1 then raise exception 'the mainnet judge cannot read the signed calls'; end if;
  perform pg_temp.expect_no_access('mainnet judge reads a record''s other columns', 'select payer, record from budget_mainnet.budget_spenders');
  perform pg_temp.expect_no_access('mainnet judge reads a use''s message hash', 'select message_sha256 from budget_mainnet.budget_spender_uses');
  perform pg_temp.expect_no_access('mainnet judge changes a record', $q$update budget_mainnet.budget_spenders set status = 'closed'$q$);
  perform pg_temp.expect_no_access('mainnet judge adds a record', $q$insert into budget_mainnet.budget_spenders (id, spender, spender_key, payer, budget, network, status, record, version) values (repeat('f', 32), 'S', '02' || repeat('0', 64), 'P', 'BUDGET-J', 'solana-mainnet-beta', 'open', '{}', 1)$q$);
  perform pg_temp.expect_no_access('mainnet judge writes the use log', $q$insert into budget_mainnet.budget_spender_uses (spender_id, purpose, message_sha256) values (repeat('a', 32), 'call', repeat('a', 64))$q$);
  perform pg_temp.expect_no_access('mainnet judge logs a use', $q$select budget_mainnet.budget_spender_use(repeat('a', 32), 'close', null, repeat('a', 64), '{}'::jsonb, true, 3, 100, 1000)$q$);
  perform pg_temp.expect_no_access('mainnet judge numbers a call', $q$select budget_mainnet.budget_spender_call(repeat('a', 32), 'X', repeat('a', 64), '{}'::jsonb, 3, 100, 1000)$q$);
  perform pg_temp.expect_no_access('mainnet judge unpauses mainnet Budgets', 'update budget_mainnet.budget_controls set paused = false');
  perform pg_temp.expect_no_access('mainnet judge reads the alerts', 'select count(*) from budget_mainnet.budget_alerts');
  perform pg_temp.expect_no_access('mainnet judge adds a signer hold', $q$insert into budget_mainnet.budget_signer_holds (scope, kind, reason) values ('all', 'hold', 'x')$q$);
  perform pg_temp.expect_no_access('mainnet judge counts a rate-limit hit', $q$select budget_mainnet.budget_rate_hit('route:1.2.3.4', 60, 2)$q$);
  -- Its own tables are append-only for it too.
  perform pg_temp.expect_no_access('mainnet judge rewrites a receipt', $q$update budget_mainnet.budget_call_receipts set receipt = 'y'$q$);
  perform pg_temp.expect_no_access('mainnet judge empties its log', 'delete from budget_mainnet.budget_judge_log');
  perform pg_temp.expect_no_access('mainnet judge reads the devnet receipts', 'select count(*) from public.budget_call_receipts');
  perform pg_temp.expect_no_access('mainnet judge reads the devnet records', 'select count(*) from public.budget_spenders');
  reset role;
  -- Even the owner cannot rewrite or empty them.
  begin
    update budget_mainnet.budget_judge_log set reason = 'rewritten';
    raise exception 'the mainnet judge log was rewritten';
  exception when raise_exception then
    if sqlerrm like '%was rewritten%' then raise; end if;
  end;
  begin
    delete from budget_mainnet.budget_call_receipts;
    raise exception 'the mainnet receipts were emptied';
  exception when raise_exception then
    if sqlerrm like '%were emptied%' then raise; end if;
  end;
end $$;

-- The devnet records and use log are untouched by all of the above.
do $$ begin
  if exists (select 1 from public.budget_spenders where budget like 'BUDGET-%') then raise exception 'a mainnet record reached the devnet table'; end if;
end $$;

select 'access rules: all checks passed' as result;
