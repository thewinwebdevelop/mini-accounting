create table if not exists public.commerce_records (
  record_type text not null check (record_type in (
    'platform_order_import',
    'platform_order',
    'shopee_connection',
    'shopee_oauth_state',
    'shopee_sync_run',
    'shipment_batch',
    'shipment_batch_order',
    'shipping_document_job',
    'custom_label_job'
  )),
  identity_key text not null,
  source_key text generated always as (record_type || ':' || identity_key) stored,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (record_type, identity_key),
  unique (source_key)
);

create index if not exists idx_commerce_records_type_updated
  on public.commerce_records (record_type, updated_at desc);

create table if not exists public.commerce_actions (
  idempotency_key text primary key,
  action_type text not null check (action_type in (
    'import_post',
    'shopee_sync',
    'shipment_prepare',
    'arrange_shipment',
    'tracking_refresh',
    'document_create',
    'document_download',
    'shipping_document_create',
    'shipping_document_poll'
  )),
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_idempotency_keys (
  idempotency_key text primary key,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.commerce_records enable row level security;
alter table public.commerce_actions enable row level security;
alter table public.commerce_idempotency_keys enable row level security;

revoke all on table public.commerce_records, public.commerce_actions, public.commerce_idempotency_keys from anon, authenticated;
grant all on table public.commerce_records, public.commerce_actions, public.commerce_idempotency_keys to service_role;

create or replace function public.upsert_commerce_record(
  p_record_type text,
  p_identity_key text,
  p_payload jsonb,
  p_expected_revision bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.commerce_records;
begin
  if p_record_type is null or btrim(p_record_type) = '' or p_identity_key is null or btrim(p_identity_key) = '' then
    raise exception 'Commerce record identity is required' using errcode = '22023';
  end if;
  insert into public.commerce_records(record_type, identity_key, payload)
  values (p_record_type, p_identity_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (record_type, identity_key) do update
    set payload = excluded.payload,
        revision = public.commerce_records.revision + 1,
        updated_at = now()
    where p_expected_revision is null or public.commerce_records.revision = p_expected_revision
  returning * into v_record;
  if not found then
    raise exception 'Commerce record revision conflict' using errcode = '40001';
  end if;
  return jsonb_build_object(
    'record_type', v_record.record_type,
    'identity_key', v_record.identity_key,
    'source_key', v_record.source_key,
    'payload', v_record.payload,
    'revision', v_record.revision,
    'created_at', v_record.created_at,
    'updated_at', v_record.updated_at
  );
end;
$$;

create or replace function public.consume_shopee_oauth_state(p_state text, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.commerce_records;
begin
  update public.commerce_records
  set payload = jsonb_set(payload, '{consumedAt}', to_jsonb(p_now::text), true),
      revision = revision + 1,
      updated_at = p_now
  where record_type = 'shopee_oauth_state'
    and identity_key = p_state
    and coalesce(payload->>'consumedAt', '') = ''
    and nullif(payload->>'expiresAt', '')::timestamptz > p_now
  returning * into v_record;
  if not found then return null; end if;
  return v_record.payload;
end;
$$;

create or replace function public.claim_commerce_action(
  p_idempotency_key text,
  p_action_type text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_action public.commerce_actions;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'Commerce action idempotency key is required' using errcode = '22023';
  end if;
  insert into public.commerce_actions(idempotency_key, action_type, payload, status)
  values (p_idempotency_key, p_action_type, coalesce(p_payload, '{}'::jsonb), 'running')
  on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  select * into v_action from public.commerce_actions where idempotency_key = p_idempotency_key for update;
  return jsonb_build_object('claimed', v_inserted = 1, 'action', to_jsonb(v_action));
end;
$$;

create or replace function public.complete_commerce_action(
  p_idempotency_key text,
  p_status text,
  p_result jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.commerce_actions;
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'Invalid commerce action completion status' using errcode = '22023';
  end if;
  update public.commerce_actions
  set status = p_status,
      result = coalesce(p_result, '{}'::jsonb),
      revision = revision + 1,
      updated_at = now()
  where idempotency_key = p_idempotency_key
  returning * into v_action;
  if not found then raise exception 'Commerce action not found' using errcode = 'P0002'; end if;
  return to_jsonb(v_action);
end;
$$;

create or replace function public.apply_commerce_mutations(
  p_idempotency_key text,
  p_mutations jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing jsonb;
  v_result jsonb := jsonb_build_object('applied', true, 'records', '[]'::jsonb);
  v_item jsonb;
  v_record jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_inserted integer;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' or jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'Commerce mutations require an idempotency key and an array' using errcode = '22023';
  end if;
  insert into public.commerce_idempotency_keys(idempotency_key)
  values (p_idempotency_key)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select result into v_existing from public.commerce_idempotency_keys where idempotency_key = p_idempotency_key for update;
    return v_existing;
  end if;

  for v_item in select value from jsonb_array_elements(p_mutations)
  loop
    if coalesce(v_item->>'operation', 'upsert') = 'delete' then
      delete from public.commerce_records
      where record_type = v_item->>'recordType' and identity_key = v_item->>'identityKey';
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('deleted', true, 'recordType', v_item->>'recordType', 'identityKey', v_item->>'identityKey'));
    else
      v_record := public.upsert_commerce_record(
        v_item->>'recordType',
        v_item->>'identityKey',
        coalesce(v_item->'payload', '{}'::jsonb),
        nullif(v_item->>'expectedRevision', '')::bigint
      );
      v_rows := v_rows || jsonb_build_array(v_record);
    end if;
  end loop;
  v_result := jsonb_build_object('applied', true, 'records', v_rows);
  update public.commerce_idempotency_keys set result = v_result where idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.post_platform_order_import(
  p_idempotency_key text,
  p_import_no text,
  p_posted_at timestamptz,
  p_movement_records jsonb default '[]'::jsonb,
  p_order_line_keys jsonb default '[]'::jsonb,
  p_import_patch jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_existing jsonb;
  v_import public.commerce_records;
  v_movement_result jsonb;
  v_movement_rows jsonb := '[]'::jsonb;
  v_line_key text;
  v_payload jsonb;
  v_result jsonb;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = ''
    or p_import_no is null or btrim(p_import_no) = ''
    or jsonb_typeof(coalesce(p_movement_records, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_order_line_keys, '[]'::jsonb)) <> 'array' then
    raise exception 'Platform import posting input is invalid' using errcode = '22023';
  end if;
  insert into public.commerce_idempotency_keys(idempotency_key)
  values (p_idempotency_key)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select result into v_existing from public.commerce_idempotency_keys where idempotency_key = p_idempotency_key for update;
    return v_existing;
  end if;

  select * into v_import
  from public.commerce_records
  where record_type = 'platform_order_import' and identity_key = p_import_no
  for update;
  if not found then raise exception 'Platform order import not found' using errcode = 'P0002'; end if;
  if v_import.payload->>'status' <> 'ready' then
    raise exception 'Platform order import is not ready to post' using errcode = '55000';
  end if;

  -- Release this import's own reservations before checking outgoing stock.
  -- Both operations remain in this transaction, so a failed movement restores
  -- the reservations along with the import status.
  for v_line_key in select jsonb_array_elements_text(coalesce(p_order_line_keys, '[]'::jsonb))
  loop
    perform public.set_inventory_reservation_status(v_line_key, 'fulfilled');
  end loop;

  if jsonb_array_length(coalesce(p_movement_records, '[]'::jsonb)) > 0 then
    v_movement_result := public.apply_inventory_stock_movements(p_movement_records);
    if coalesce(v_movement_result->>'error', '') <> '' then
      raise exception 'Inventory movement posting failed: %', v_movement_result->>'error' using errcode = '55000';
    end if;
    if jsonb_typeof(v_movement_result) = 'array' then
      v_movement_rows := v_movement_result;
    else
      v_movement_rows := coalesce(v_movement_result->'movements', '[]'::jsonb);
    end if;
  end if;

  v_payload := v_import.payload || coalesce(p_import_patch, '{}'::jsonb) || jsonb_build_object(
    'status', 'posted',
    'postedAt', coalesce(p_posted_at, now())::text,
    'postedMovements', v_movement_rows,
    'updatedAt', coalesce(p_posted_at, now())::text
  );
  update public.commerce_records
  set payload = v_payload, revision = revision + 1, updated_at = coalesce(p_posted_at, now())
  where record_type = 'platform_order_import' and identity_key = p_import_no
  returning * into v_import;

  v_result := jsonb_build_object('applied', true, 'import', v_import.payload, 'movements', v_movement_rows);
  update public.commerce_idempotency_keys set result = v_result where idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.save_platform_order_import(p_import_no text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_reservations jsonb;
  v_reservation_result jsonb;
  v_result jsonb;
begin
  if p_import_no is null or btrim(p_import_no) = '' or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Platform import payload is invalid' using errcode = '22023';
  end if;
  if coalesce(p_payload->>'importNo', '') <> p_import_no or coalesce(p_payload->>'status', '') not in ('imported', 'ready', 'has_issues') then
    raise exception 'Platform import identity or status is invalid' using errcode = '22023';
  end if;
  for v_line in select value from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    if v_line->>'matchStatus' = 'matched' and v_line->>'postable' = 'true' then
      if coalesce(v_line->>'orderLineKey', '') = '' then
        raise exception 'Platform order line identity is required' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(jsonb_build_object(
        'stockSkuId', (component.value->>'stockSkuId')::bigint,
        'quantity', (component.value->>'requiredQuantity')::integer
      )), '[]'::jsonb)
      into v_reservations
      from jsonb_array_elements(coalesce(v_line->'components', '[]'::jsonb)) as component(value);
      v_reservation_result := public.replace_inventory_reservations(
        v_line->>'orderLineKey',
        coalesce(v_line->>'referenceNo', ''),
        v_reservations
      );
      if coalesce(v_reservation_result->>'error', '') <> '' then
        raise exception 'Inventory reservation failed: %', v_reservation_result->>'error' using errcode = '55000';
      end if;
    end if;
  end loop;
  v_result := public.upsert_commerce_record('platform_order_import', p_import_no, p_payload, null);
  return v_result;
end;
$$;

revoke all on function public.upsert_commerce_record(text, text, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.consume_shopee_oauth_state(text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_commerce_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_commerce_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.apply_commerce_mutations(text, jsonb) from public, anon, authenticated;
revoke all on function public.post_platform_order_import(text, text, timestamptz, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.save_platform_order_import(text, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_commerce_record(text, text, jsonb, bigint) to service_role;
grant execute on function public.consume_shopee_oauth_state(text, timestamptz) to service_role;
grant execute on function public.claim_commerce_action(text, text, jsonb) to service_role;
grant execute on function public.complete_commerce_action(text, text, jsonb) to service_role;
grant execute on function public.apply_commerce_mutations(text, jsonb) to service_role;
grant execute on function public.post_platform_order_import(text, text, timestamptz, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.save_platform_order_import(text, jsonb) to service_role;
