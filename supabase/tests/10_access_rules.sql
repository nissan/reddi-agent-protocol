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

-- A: signs in and lists a provider under A's own wallet.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.providers (wallet, owner_user_id, display_name, endpoint_url, price_per_call_base_units, price_mint, network, status)
values ('3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr', '00000000-0000-0000-0000-00000000000a', 'A', 'https://a.example.test', 10000, 'mint', 'solana-devnet', 'listed');

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
select pg_temp.expect_denied('A writes a profile', $q$
  update public.profiles set wallet = '6uiQbwMor4UrWYiDtAJcgHKYW4vUaM3BUVChPgzdALse' $q$);
select pg_temp.expect_error('A reads owner_user_id', 'select owner_user_id from public.providers');
select pg_temp.expect_error('A sets updated_at', $q$ update public.providers set updated_at = now() $q$);
-- A edits own listing; the database moves updated_at.
do $$ declare before timestamptz; after timestamptz; begin
  select updated_at into before from public.providers where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
  perform pg_sleep(0.01);
  update public.providers set display_name = 'A2' where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
  if not found then raise exception 'owner cannot edit own listing'; end if;
  select updated_at into after from public.providers where wallet = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
  if after = before then raise exception 'updated_at did not change'; end if;
end $$;

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
-- An unrelated signed-in user sees no private rows either; the owner still sees the listing.
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if (select count(*) from public.providers) <> 1 then raise exception 'owner cannot see own paused listing'; end if;
end $$;
reset role;
select 'access rules: all checks passed' as result;
