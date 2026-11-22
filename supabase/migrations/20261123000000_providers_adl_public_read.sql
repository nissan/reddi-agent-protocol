-- Clients read providers by named columns (20261120000000_v1_core.sql grants
-- each one). 20261122100000_providers_adl.sql added adl and adl_source, which
-- are public like the rest of a listed provider's row, but granted neither, so
-- every public listing read that names them was refused (PostgREST 401) and
-- GET /api/listings answered 503.
grant select (adl, adl_source) on public.providers to anon, authenticated;
