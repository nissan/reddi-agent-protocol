-- Every listing carries an Agent Definition Language (ADL v0.3) document. The
-- server writes it on PUT /api/listings after checking it passes ADL Level 3
-- and matches the listing (lib/listings/listing-adl.ts): the provider's own
-- document, or one the server made from the listing's fields. It is public,
-- like the rest of a listed provider's row.
alter table public.providers
  add column if not exists adl jsonb check (adl is null or jsonb_typeof(adl) = 'object'),
  add column if not exists adl_source text check (adl_source in ('provider', 'generated')),
  add constraint providers_adl_source_with_adl check ((adl is null) = (adl_source is null));
