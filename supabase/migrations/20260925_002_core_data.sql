create table if not exists public.company_settings (
  source_key text primary key,
  setting_key text not null unique,
  legal_name text not null,
  tax_id text not null default '',
  branch text not null default '',
  source_hash text not null default '',
  address text not null default '',
  source_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.vendors (
  source_key text primary key,
  source_id text not null unique,
  name text not null,
  tax_id text not null default '',
  address text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  bank_name text not null default '',
  account_no text not null default '',
  payment_channel text not null default '',
  payment_reference text not null default '',
  default_business_purpose text not null default '',
  note text not null default '',
  status text not null,
  created_at timestamptz,
  updated_at timestamptz,
  source_hash text not null default '',
  source_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.inventory_products (
  source_key text primary key,
  source_id bigint not null unique,
  product_code text not null,
  name text not null,
  category text not null default '',
  description text not null default '',
  image_path text not null default '',
  status text not null,
  created_at timestamptz,
  updated_at timestamptz,
  source_hash text not null default '',
  source_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.inventory_stock_skus (
  source_key text primary key,
  source_id bigint not null unique,
  product_source_id bigint not null,
  sku text not null,
  color text not null default '',
  size text not null default '',
  barcode text not null default '',
  default_unit_cost numeric(14,2) not null default 0,
  image_path text not null default '',
  status text not null,
  created_at timestamptz,
  updated_at timestamptz,
  source_hash text not null default '',
  source_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.inventory_stock_movements (
  source_key text primary key,
  source_id bigint not null unique,
  stock_sku_source_id bigint not null,
  movement_no text not null unique,
  movement_type text not null,
  movement_date date not null,
  quantity integer not null,
  unit_cost numeric(14,2) not null default 0,
  total_cost numeric(14,2) not null default 0,
  reference_type text not null default '',
  reference_no text not null default '',
  note text not null default '',
  created_at timestamptz,
  source_hash text not null default '',
  source_payload jsonb not null default '{}'::jsonb
);

alter table public.company_settings add column if not exists source_hash text not null default '';
alter table public.vendors add column if not exists source_hash text not null default '';
alter table public.inventory_products add column if not exists source_hash text not null default '';
alter table public.inventory_stock_skus add column if not exists source_hash text not null default '';
alter table public.inventory_stock_movements add column if not exists source_hash text not null default '';

create table if not exists public.migration_records (
  migration_name text not null,
  source_key text not null,
  target_table text not null,
  target_key text not null,
  source_hash text not null,
  migrated_at timestamptz not null default now(),
  primary key (migration_name, source_key)
);

alter table public.company_settings enable row level security;
alter table public.vendors enable row level security;
alter table public.inventory_products enable row level security;
alter table public.inventory_stock_skus enable row level security;
alter table public.inventory_stock_movements enable row level security;
alter table public.migration_records enable row level security;

revoke all on table public.company_settings from anon, authenticated;
revoke all on table public.vendors from anon, authenticated;
revoke all on table public.inventory_products from anon, authenticated;
revoke all on table public.inventory_stock_skus from anon, authenticated;
revoke all on table public.inventory_stock_movements from anon, authenticated;
revoke all on table public.migration_records from anon, authenticated;
