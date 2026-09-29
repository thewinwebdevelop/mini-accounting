create table if not exists public.company_positions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  status text not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_positions_status_check check (status in ('active', 'inactive')),
  constraint company_positions_code_check check (length(trim(code)) > 0),
  constraint company_positions_label_check check (length(trim(label)) > 0)
);

insert into public.company_positions (code, label, status, sort_order)
values
  ('owner', 'เจ้าของบริษัท', 'active', 10),
  ('marketing', 'marketing', 'active', 20)
on conflict (code) do update
set label = excluded.label,
    updated_at = now();

create index if not exists idx_company_positions_active_order
  on public.company_positions (sort_order, label)
  where status = 'active';

create table if not exists public.app_user_profiles (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  company_position_id uuid references public.company_positions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_user_profiles_first_name_check check (char_length(trim(first_name)) <= 100),
  constraint app_user_profiles_last_name_check check (char_length(trim(last_name)) <= 120)
);

insert into public.app_user_profiles (user_id)
select id
from public.app_users
on conflict (user_id) do nothing;

create index if not exists idx_app_user_profiles_company_position
  on public.app_user_profiles (company_position_id);

alter table public.company_positions enable row level security;
alter table public.app_user_profiles enable row level security;

revoke all on table public.company_positions from anon, authenticated;
revoke all on table public.app_user_profiles from anon, authenticated;
