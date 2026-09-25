create extension if not exists pgcrypto;

create table if not exists public.app_roles (
  code text primary key,
  label text not null,
  created_at timestamptz not null default now()
);

insert into public.app_roles (code, label)
values
  ('employee', 'พนักงาน'),
  ('owner', 'เจ้าของ'),
  ('accounting', 'บัญชี'),
  ('admin', 'ผู้ดูแลระบบ')
on conflict (code) do update set label = excluded.label;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text not null default '',
  picture_url text not null default '',
  status text not null default 'pending',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_status_check check (status in ('pending', 'active', 'inactive'))
);

create table if not exists public.app_user_roles (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  role_code text not null references public.app_roles(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.migration_runs (
  id uuid primary key default gen_random_uuid(),
  migration_name text not null,
  mode text not null,
  status text not null,
  counts jsonb not null default '{}'::jsonb,
  error_code text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint migration_runs_mode_check check (mode in ('dry-run', 'apply')),
  constraint migration_runs_status_check check (status in ('running', 'succeeded', 'failed'))
);

alter table public.app_roles enable row level security;
alter table public.app_users enable row level security;
alter table public.app_user_roles enable row level security;
alter table public.migration_runs enable row level security;

revoke all on table public.app_roles from anon, authenticated;
revoke all on table public.app_users from anon, authenticated;
revoke all on table public.app_user_roles from anon, authenticated;
revoke all on table public.migration_runs from anon, authenticated;
