-- Minimal stand-in for the parts of a Supabase project the migration relies on,
-- so access rules can be checked on a plain local Postgres. Test use only.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
-- The role the REST API connects as; it switches to the role a request's token names.
create role authenticator noinherit nologin;
grant anon, authenticated, service_role to authenticator;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Supabase grants every new public table and function to these roles by default.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
