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
    foreach t in array array['budget_spenders', 'budget_spender_uses', 'budget_alerts', 'budget_controls'] loop
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
-- The one way a use is logged (review S6): clients cannot call it; for the
-- server it checks the pause, the status and the ten-minute limit atomically,
-- and a close goes through even while paused or over the limit.
reset role;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set role %I', r);
    perform pg_temp.expect_error(r || ' logs a spender use', 'select public.budget_spender_use(''0123456789abcdef0123456789abcdef'', ''close'', null, repeat(''a'', 64), ''{}''::jsonb, 3, 1000)');
    reset role;
  end loop;
end $$;
set role service_role;
do $$ declare got text; id text := '0123456789abcdef0123456789abcdef'; begin
  got := public.budget_spender_use(id, 'reserve', null, repeat('b', 64), '{}'::jsonb, 5, 1000);
  if got <> 'not_open' then raise exception 'a pending key logged a reserve: %', got; end if;
  update public.budget_spenders set status = 'open' where budget_spenders.id = '0123456789abcdef0123456789abcdef';
  got := public.budget_spender_use(id, 'reserve', 'X', repeat('b', 64), '{}'::jsonb, 2, 1000);
  if got <> 'ok' then raise exception 'an open key under its limit was refused: %', got; end if;
  got := public.budget_spender_use(id, 'reserve', 'X', repeat('c', 64), '{}'::jsonb, 2, 1000);
  if got <> 'overuse' then raise exception 'the use limit did not hold: %', got; end if;
  update public.budget_controls set paused = true where budget_controls.id = 1;
  got := public.budget_spender_use(id, 'waive', null, repeat('d', 64), '{}'::jsonb, 100, 1000);
  if got <> 'paused' then raise exception 'a paused waive was logged: %', got; end if;
  got := public.budget_spender_use(id, 'close', null, repeat('e', 64), '{}'::jsonb, 1, 1000);
  if got <> 'ok' then raise exception 'a close was refused: %', got; end if;
  update public.budget_controls set paused = false, watched_at = now() where budget_controls.id = 1;
  -- Round 5 (R5-M2): all relay Budgets together stop at the global ceiling;
  -- a close is not counted and still goes through. The detail is kept.
  -- Two non-close uses are logged so far (the direct insert and the first reserve).
  got := public.budget_spender_use(id, 'reserve', 'X', repeat('1', 64), '{"amount":"5"}'::jsonb, 100, 2);
  if got <> 'global_overuse' then raise exception 'the global ceiling did not hold: %', got; end if;
  got := public.budget_spender_use(id, 'reserve', 'X', repeat('1', 64), '{"amount":"5"}'::jsonb, 100, 3);
  if got <> 'ok' then raise exception 'a reserve under the global ceiling was refused: %', got; end if;
  if (select detail->>'amount' from public.budget_spender_uses where message_sha256 = repeat('1', 64)) is distinct from '5' then
    raise exception 'the approval detail was not logged';
  end if;
  got := public.budget_spender_use(id, 'close', null, repeat('2', 64), null, 100, 0);
  if got <> 'ok' then raise exception 'a close over the global ceiling was refused: %', got; end if;
end $$;
do $$ declare got text; sid text := '0123456789abcdef0123456789abcdef'; begin
  update public.budget_spenders set status = 'closed' where budget_spenders.id = sid;
  got := public.budget_spender_use(sid, 'close', null, repeat('f', 64), '{}'::jsonb, 100, 1000);
  if got <> 'closed' then raise exception 'a closed budget logged another close: %', got; end if;
  got := public.budget_spender_use('ffffffffffffffffffffffffffffffff', 'close', null, repeat('f', 64), '{}'::jsonb, 100, 1000);
  if got <> 'unknown' then raise exception 'a missing record logged a use: %', got; end if;
end $$;
update public.budget_controls set paused = true, reason = 'test';
reset role;

select 'access rules: all checks passed' as result;
