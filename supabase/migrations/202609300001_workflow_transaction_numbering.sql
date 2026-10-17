create table if not exists public.workflow_transaction_sequences (
  accounting_month text primary key,
  last_sequence integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint workflow_transaction_sequences_month_check
    check (accounting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint workflow_transaction_sequences_sequence_check
    check (last_sequence >= 0)
);

create table if not exists public.workflow_transaction_requests (
  request_key text primary key,
  accounting_month text not null,
  sequence integer not null,
  transaction_no text not null unique,
  created_at timestamptz not null default now(),
  constraint workflow_transaction_requests_month_check
    check (accounting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint workflow_transaction_requests_sequence_check
    check (sequence > 0)
);

insert into public.workflow_transaction_sequences (accounting_month, last_sequence)
select
  substring(document_no from '^TXN-([0-9]{4}-[0-9]{2})-') as accounting_month,
  max((regexp_replace(document_no, '^.*-', ''))::integer) as last_sequence
from public.documents
where document_kind = 'workflow_transaction'
  and document_no ~ '^TXN-[0-9]{4}-(0[1-9]|1[0-2])-[0-9]+$'
group by substring(document_no from '^TXN-([0-9]{4}-[0-9]{2})-')
on conflict (accounting_month) do update
set last_sequence = greatest(
  public.workflow_transaction_sequences.last_sequence,
  excluded.last_sequence
), updated_at = now();

alter table public.workflow_transaction_sequences enable row level security;
alter table public.workflow_transaction_requests enable row level security;
revoke all on table public.workflow_transaction_sequences from anon, authenticated;
revoke all on table public.workflow_transaction_requests from anon, authenticated;

create or replace function public.allocate_workflow_transaction_number(
  p_accounting_month text,
  p_request_key text default ''
)
returns table(sequence integer, transaction_no text, existing boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sequence integer;
  v_transaction_no text;
  v_request_key text := coalesce(trim(p_request_key), '');
begin
  if p_accounting_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid accounting month';
  end if;

  if v_request_key <> '' then
    select r.sequence, r.transaction_no
      into v_sequence, v_transaction_no
    from public.workflow_transaction_requests r
    where r.request_key = v_request_key;
    if found then
      return query select v_sequence, v_transaction_no, true;
      return;
    end if;
  end if;

  insert into public.workflow_transaction_sequences (accounting_month, last_sequence)
  values (p_accounting_month, 0)
  on conflict (accounting_month) do nothing;

  update public.workflow_transaction_sequences s
     set last_sequence = s.last_sequence + 1,
         updated_at = now()
   where s.accounting_month = p_accounting_month
  returning s.last_sequence into v_sequence;

  v_transaction_no := format(
    'TXN-%s-%s',
    p_accounting_month,
    lpad(v_sequence::text, 4, '0')
  );

  if v_request_key <> '' then
    insert into public.workflow_transaction_requests (
      request_key, accounting_month, sequence, transaction_no
    ) values (
      v_request_key, p_accounting_month, v_sequence, v_transaction_no
    );
  end if;

  return query select v_sequence, v_transaction_no, false;
end;
$$;

revoke all on function public.allocate_workflow_transaction_number(text, text) from public;
grant execute on function public.allocate_workflow_transaction_number(text, text) to service_role;
