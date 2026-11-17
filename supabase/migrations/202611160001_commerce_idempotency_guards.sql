alter table public.commerce_actions add column if not exists request_hash text;
update public.commerce_actions
set request_hash = md5(action_type || ':' || payload::text)
where request_hash is null;
alter table public.commerce_actions alter column request_hash set not null;

alter table public.commerce_idempotency_keys add column if not exists request_hash text;

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
  v_request_hash text := md5(coalesce(p_action_type, '') || ':' || coalesce(p_payload, '{}'::jsonb)::text);
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'Commerce action idempotency key is required' using errcode = '22023';
  end if;
  insert into public.commerce_actions(idempotency_key, action_type, payload, request_hash, status)
  values (p_idempotency_key, p_action_type, coalesce(p_payload, '{}'::jsonb), v_request_hash, 'running')
  on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  select * into v_action from public.commerce_actions where idempotency_key = p_idempotency_key for update;
  if v_action.request_hash <> v_request_hash then
    raise exception 'Commerce action idempotency key was reused with different input' using errcode = '23505';
  end if;
  return jsonb_build_object('claimed', v_inserted = 1, 'action', to_jsonb(v_action));
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
  v_existing_hash text;
  v_request_hash text := md5(coalesce(p_mutations, '[]'::jsonb)::text);
  v_result jsonb := jsonb_build_object('applied', true, 'records', '[]'::jsonb);
  v_item jsonb;
  v_record jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_inserted integer;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' or jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'Commerce mutations require an idempotency key and an array' using errcode = '22023';
  end if;
  insert into public.commerce_idempotency_keys(idempotency_key, request_hash)
  values (p_idempotency_key, v_request_hash)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select result, request_hash into v_existing, v_existing_hash
    from public.commerce_idempotency_keys where idempotency_key = p_idempotency_key for update;
    if v_existing_hash is not null and v_existing_hash <> v_request_hash then
      raise exception 'Commerce mutation idempotency key was reused with different input' using errcode = '23505';
    end if;
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
        v_item->>'recordType', v_item->>'identityKey', coalesce(v_item->'payload', '{}'::jsonb),
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

create or replace function public.commerce_post_request_hash(
  p_import_no text,
  p_movement_records jsonb,
  p_order_line_keys jsonb,
  p_import_patch jsonb
) returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_movements jsonb;
  v_line_keys jsonb;
  v_patch jsonb := coalesce(p_import_patch, '{}'::jsonb) - 'postedAt' - 'updatedAt';
  v_lines jsonb;
  v_request jsonb;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'stock_sku_source_id', coalesce(nullif(value->>'stock_sku_source_id', '')::bigint, 0),
      'movement_type', coalesce(value->>'movement_type', ''),
      'movement_date', coalesce(value->>'movement_date', ''),
      'quantity', coalesce(nullif(value->>'quantity', '')::numeric, 0),
      'unit_cost', round(coalesce(nullif(value->>'unit_cost', '')::numeric, 0), 2),
      'total_cost', round(coalesce(nullif(value->>'total_cost', '')::numeric, 0), 2),
      'reference_type', coalesce(value->>'reference_type', ''),
      'reference_no', coalesce(value->>'reference_no', ''),
      'note', coalesce(value->>'note', '')
    )
    order by value->>'reference_no', value->>'stock_sku_source_id', value->>'movement_type'
  ), '[]'::jsonb)
  into v_movements
  from jsonb_array_elements(coalesce(p_movement_records, '[]'::jsonb));

  select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
  into v_line_keys
  from jsonb_array_elements_text(coalesce(p_order_line_keys, '[]'::jsonb)) as value;

  if jsonb_typeof(v_patch->'lines') = 'array' then
    select coalesce(jsonb_agg(value - 'postedAt' - 'updatedAt' order by ordinal), '[]'::jsonb)
    into v_lines
    from jsonb_array_elements(v_patch->'lines') with ordinality as line(value, ordinal);
    v_patch := jsonb_set(v_patch, '{lines}', v_lines, true);
  end if;

  v_request := jsonb_build_object(
    'importNo', p_import_no,
    'movementRecords', v_movements,
    'orderLineKeys', v_line_keys,
    'importPatch', v_patch
  );
  return md5(v_request::text);
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
  v_existing_hash text;
  v_request_hash text;
  v_import public.commerce_records;
  v_movement_result jsonb;
  v_movement_rows jsonb := '[]'::jsonb;
  v_line_key text;
  v_payload jsonb;
  v_result jsonb;
begin
  v_request_hash := public.commerce_post_request_hash(p_import_no, p_movement_records, p_order_line_keys, p_import_patch);
  if p_idempotency_key is null or btrim(p_idempotency_key) = ''
    or p_import_no is null or btrim(p_import_no) = ''
    or jsonb_typeof(coalesce(p_movement_records, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_order_line_keys, '[]'::jsonb)) <> 'array' then
    raise exception 'Platform import posting input is invalid' using errcode = '22023';
  end if;
  insert into public.commerce_idempotency_keys(idempotency_key, request_hash)
  values (p_idempotency_key, v_request_hash)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select result, request_hash into v_existing, v_existing_hash
    from public.commerce_idempotency_keys where idempotency_key = p_idempotency_key for update;
    if v_existing_hash is not null and v_existing_hash <> v_request_hash then
      raise exception 'Platform import idempotency key was reused with different input' using errcode = '23505';
    end if;
    return v_existing;
  end if;

  select * into v_import from public.commerce_records
  where record_type = 'platform_order_import' and identity_key = p_import_no for update;
  if not found then raise exception 'Platform order import not found' using errcode = 'P0002'; end if;
  if v_import.payload->>'status' <> 'ready' then
    raise exception 'Platform order import is not ready to post' using errcode = '55000';
  end if;

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
    'status', 'posted', 'postedAt', coalesce(p_posted_at, now())::text,
    'postedMovements', v_movement_rows, 'updatedAt', coalesce(p_posted_at, now())::text
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

revoke all on function public.claim_commerce_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.apply_commerce_mutations(text, jsonb) from public, anon, authenticated;
revoke all on function public.post_platform_order_import(text, text, timestamptz, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.commerce_post_request_hash(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.claim_commerce_action(text, text, jsonb) to service_role;
grant execute on function public.apply_commerce_mutations(text, jsonb) to service_role;
grant execute on function public.post_platform_order_import(text, text, timestamptz, jsonb, jsonb, jsonb) to service_role;
