-- Server-only integration configuration and refreshed tokens must survive
-- Cloud Run instance replacement. Never expose this table to browser roles.
create table if not exists public.integration_credentials (
  credential_key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.integration_credentials enable row level security;
revoke all on public.integration_credentials from anon, authenticated;
grant all on public.integration_credentials to service_role;
