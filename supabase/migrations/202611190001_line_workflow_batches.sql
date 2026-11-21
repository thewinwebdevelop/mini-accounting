-- Server-only, versioned state for invoice conversations and recoverable jobs.
create table if not exists public.line_workflow_state (
 id integer primary key check(id=1), version bigint not null default 0,
 data jsonb not null default '{}'::jsonb
);
insert into public.line_workflow_state(id) values(1) on conflict do nothing;
alter table public.line_workflow_state enable row level security;
revoke all on public.line_workflow_state from anon,authenticated;
grant all on public.line_workflow_state to service_role;
create or replace function public.line_workflow_state_cas(expected_version bigint,next_data jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update public.line_workflow_state set data=next_data,version=version+1 where id=1 and version=expected_version;
 return found;
end; $$;
revoke all on function public.line_workflow_state_cas(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.line_workflow_state_cas(bigint,jsonb) to service_role;
