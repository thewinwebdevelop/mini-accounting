create table if not exists public.document_number_sequences (
  document_kind text not null,
  accounting_month text not null,
  last_sequence integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (document_kind, accounting_month),
  constraint document_number_sequences_month_check
    check (accounting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint document_number_sequences_sequence_check
    check (last_sequence >= 0)
);

create table if not exists public.document_number_requests (
  request_key text primary key,
  document_kind text not null,
  accounting_month text not null,
  sequence integer not null,
  document_no text not null unique,
  created_at timestamptz not null default now(),
  constraint document_number_requests_month_check
    check (accounting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint document_number_requests_sequence_check
    check (sequence > 0)
);

insert into public.document_number_sequences (document_kind, accounting_month, last_sequence)
select document_kind, accounting_month, max(sequence::integer)
from (
  select
    d.document_kind,
    substring(d.document_no from '^[A-Z]+-([0-9]{4}-[0-9]{2})-') as accounting_month,
    substring(d.document_no from '^[A-Z]+-[0-9]{4}-[0-9]{2}-([0-9]+)$') as sequence
  from public.documents d
  where d.document_kind in (
    'expense_request', 'substitute_receipt', 'purchase_order', 'payment_voucher',
    'cash_spend_declaration', 'payee_acknowledgement', 'goods_receipt'
  )
    and d.document_no ~ '^[A-Z]+-[0-9]{4}-(0[1-9]|1[0-2])-[0-9]+$'
    and substring(d.document_no from '^[A-Z]+-') = case d.document_kind
      when 'expense_request' then 'REQ-'
      when 'substitute_receipt' then 'SR-'
      when 'purchase_order' then 'PO-'
      when 'payment_voucher' then 'PV-'
      when 'cash_spend_declaration' then 'CSD-'
      when 'payee_acknowledgement' then 'PAR-'
      when 'goods_receipt' then 'GR-'
    end
) existing
where accounting_month is not null and sequence ~ '^[0-9]+$'
group by document_kind, accounting_month
on conflict (document_kind, accounting_month) do update
set last_sequence = greatest(public.document_number_sequences.last_sequence, excluded.last_sequence),
    updated_at = now();

alter table public.document_number_sequences enable row level security;
alter table public.document_number_requests enable row level security;
revoke all on table public.document_number_sequences from anon, authenticated;
revoke all on table public.document_number_requests from anon, authenticated;

create or replace function public.allocate_accounting_document_number(
  p_document_kind text,
  p_accounting_month text,
  p_request_key text default '',
  p_allocate boolean default true
)
returns table(sequence integer, document_no text, existing boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_sequence integer;
  v_document_no text;
  v_request_key text := coalesce(trim(p_request_key), '');
begin
  v_prefix := case p_document_kind
    when 'expense_request' then 'REQ'
    when 'substitute_receipt' then 'SR'
    when 'purchase_order' then 'PO'
    when 'payment_voucher' then 'PV'
    when 'cash_spend_declaration' then 'CSD'
    when 'payee_acknowledgement' then 'PAR'
    when 'goods_receipt' then 'GR'
    else null
  end;
  if v_prefix is null then raise exception 'unsupported document kind'; end if;
  if p_accounting_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid accounting month'; end if;

  if v_request_key <> '' then
    perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
    select r.sequence, r.document_no
      into v_sequence, v_document_no
    from public.document_number_requests r
    where r.request_key = v_request_key;
    if found then
      if exists (
        select 1 from public.document_number_requests r
        where r.request_key = v_request_key
          and (r.document_kind <> p_document_kind or r.accounting_month <> p_accounting_month)
      ) then raise exception 'request key already used for a different document'; end if;
      return query select v_sequence, v_document_no, true;
      return;
    end if;
  end if;

  if p_allocate then
    insert into public.document_number_sequences (document_kind, accounting_month, last_sequence)
    values (p_document_kind, p_accounting_month, 0)
    on conflict (document_kind, accounting_month) do nothing;

    update public.document_number_sequences s
       set last_sequence = s.last_sequence + 1,
           updated_at = now()
     where s.document_kind = p_document_kind
       and s.accounting_month = p_accounting_month
    returning s.last_sequence into v_sequence;
  else
    select coalesce(s.last_sequence, 0) + 1
      into v_sequence
    from (select 1) seed
    left join public.document_number_sequences s
      on s.document_kind = p_document_kind
     and s.accounting_month = p_accounting_month;
  end if;

  v_document_no := format('%s-%s-%s', v_prefix, p_accounting_month, lpad(v_sequence::text, 4, '0'));
  if p_allocate and v_request_key <> '' then
    insert into public.document_number_requests (request_key, document_kind, accounting_month, sequence, document_no)
    values (v_request_key, p_document_kind, p_accounting_month, v_sequence, v_document_no);
  end if;

  return query select v_sequence, v_document_no, false;
end;
$$;

create or replace function public.peek_workflow_transaction_number(p_accounting_month text)
returns table(sequence integer, transaction_no text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sequence integer;
begin
  if p_accounting_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid accounting month'; end if;
  select coalesce(s.last_sequence, 0) + 1 into v_sequence
    from (select 1) seed
    left join public.workflow_transaction_sequences s on s.accounting_month = p_accounting_month;
  return query select v_sequence,
    format('TXN-%s-%s', p_accounting_month, lpad(v_sequence::text, 4, '0'));
end;
$$;

revoke all on function public.allocate_accounting_document_number(text, text, text, boolean) from public;
revoke all on function public.peek_workflow_transaction_number(text) from public;
grant execute on function public.allocate_accounting_document_number(text, text, text, boolean) to service_role;
grant execute on function public.peek_workflow_transaction_number(text) to service_role;

create or replace function public.compare_and_swap_document(p_source_key text, p_expected_source_hash text, p_record jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_expected_source_hash is null then
    insert into public.documents (
      source_key, document_kind, document_no, owner_user_id, status,
      accounting_month, folder_path, payload, source_hash, created_at, updated_at
    ) values (
      p_source_key, p_record->>'document_kind', coalesce(p_record->>'document_no', ''),
      nullif(p_record->>'owner_user_id', '')::uuid, coalesce(p_record->>'status', 'draft'),
      coalesce(p_record->>'accounting_month', ''), coalesce(p_record->>'folder_path', ''),
      coalesce(p_record->'payload', '{}'::jsonb), coalesce(p_record->>'source_hash', ''),
      nullif(p_record->>'created_at', '')::timestamptz, nullif(p_record->>'updated_at', '')::timestamptz
    ) on conflict (source_key) do nothing;
  else
    update public.documents
    set document_kind = p_record->>'document_kind',
        document_no = coalesce(p_record->>'document_no', ''),
        owner_user_id = nullif(p_record->>'owner_user_id', '')::uuid,
        status = coalesce(p_record->>'status', 'draft'),
        accounting_month = coalesce(p_record->>'accounting_month', ''),
        folder_path = coalesce(p_record->>'folder_path', ''),
        payload = coalesce(p_record->'payload', '{}'::jsonb),
        source_hash = coalesce(p_record->>'source_hash', ''),
        created_at = nullif(p_record->>'created_at', '')::timestamptz,
        updated_at = nullif(p_record->>'updated_at', '')::timestamptz
    where source_key = p_source_key and source_hash = p_expected_source_hash;
  end if;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.compare_and_swap_document(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.compare_and_swap_document(text, text, jsonb) to service_role;

alter table public.document_files add column if not exists document_source_hash text not null default '';

create or replace function public.commit_document_file_manifest(
  p_document_source_key text,
  p_expected_source_hash text,
  p_files jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_hash text;
begin
  select source_hash into v_source_hash
  from public.documents
  where source_key = p_document_source_key
  for update;
  if not found or v_source_hash is distinct from p_expected_source_hash then
    return false;
  end if;

  delete from public.document_files where document_source_key = p_document_source_key;
  insert into public.document_files (
    source_key, document_source_key, document_source_hash, bucket_name, object_path,
    source_sha256, byte_size, content_type, original_name, migrated_at
  )
  select
    file->>'source_key', file->>'document_source_key', file->>'document_source_hash',
    file->>'bucket_name', file->>'object_path', file->>'source_sha256', (file->>'byte_size')::bigint,
    file->>'content_type', file->>'original_name', nullif(file->>'migrated_at', '')::timestamptz
  from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) as file
  on conflict (source_key) do update set
    document_source_key = excluded.document_source_key,
    document_source_hash = excluded.document_source_hash,
    bucket_name = excluded.bucket_name,
    object_path = excluded.object_path,
    source_sha256 = excluded.source_sha256,
    byte_size = excluded.byte_size,
    content_type = excluded.content_type,
    original_name = excluded.original_name,
    migrated_at = excluded.migrated_at;
  return true;
end;
$$;

revoke all on function public.commit_document_file_manifest(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.commit_document_file_manifest(text, text, jsonb) to service_role;
