-- Agent passes (#1048): a budget a person locked for their agent with one
-- Solana Pay signature. The row holds the hash of the agent's API key, the
-- locks, and each provider session's sequence and last receipt. It holds no
-- key and no funds. Only the server reads or writes it (service role); every
-- write is conditional on the version it read, so racing calls cannot both
-- advance a session.
create table public.agent_passes (
  id text primary key check (id ~ '^[0-9a-f]{32}$'),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  version integer not null check (version >= 1),
  expires_at timestamptz not null,
  pass jsonb not null,
  created_at timestamptz not null default now()
);

create index agent_passes_expires_at on public.agent_passes (expires_at);

alter table public.agent_passes enable row level security;
-- No policies: anon and signed-in roles can neither read nor write.
revoke all on public.agent_passes from public, anon, authenticated;
grant select, insert, update on public.agent_passes to service_role;
