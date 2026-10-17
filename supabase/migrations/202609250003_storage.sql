insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sweet-house-files',
  'sweet-house-files',
  false,
  52428800,
  array[
    'application/json',
    'application/octet-stream',
    'application/pdf',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/markdown',
    'text/plain'
  ]::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.storage_migration_records (
  migration_name text not null,
  source_key text not null,
  bucket_name text not null,
  object_path text not null,
  source_sha256 text not null,
  byte_size bigint not null check (byte_size >= 0),
  content_type text not null,
  migrated_at timestamptz not null default now(),
  primary key (migration_name, source_key),
  unique (bucket_name, object_path)
);

alter table public.storage_migration_records enable row level security;
revoke all on table public.storage_migration_records from anon, authenticated;
