-- Security audit round 1 (S5-claude-01, condition C7): the server is the only writer
-- of public.providers (PUT /api/listings writes with the service role and enforces the
-- listing rules: public https endpoint, sizes, prices, network, and that a removal is
-- a server decision). Client roles keep read access only, so an owner cannot undo a
-- removal or store values the server would refuse by calling the REST interface.
drop policy if exists providers_insert_own on public.providers;
drop policy if exists providers_update_own on public.providers;
revoke insert, update, delete on public.providers from anon, authenticated;
