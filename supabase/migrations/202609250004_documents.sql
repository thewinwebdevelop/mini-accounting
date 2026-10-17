create table if not exists public.documents (
  source_key text primary key,
  document_kind text not null,
  document_no text not null default '',
  owner_user_id uuid references public.app_users(id) on delete set null,
  status text not null default 'draft',
  accounting_month text not null default '',
  folder_path text not null default '',
  payload jsonb not null default '{}'::jsonb,
  source_hash text not null default '',
  created_at timestamptz,
  updated_at timestamptz
);

create index if not exists idx_documents_kind_no
  on public.documents (document_kind, document_no);
create index if not exists idx_documents_owner_status
  on public.documents (owner_user_id, status, updated_at desc);

create table if not exists public.document_files (
  source_key text primary key,
  document_source_key text not null,
  bucket_name text not null,
  object_path text not null,
  source_sha256 text not null,
  byte_size bigint not null default 0,
  content_type text not null default 'application/octet-stream',
  original_name text not null default '',
  migrated_at timestamptz,
  unique (bucket_name, object_path)
);

create index if not exists idx_document_files_document
  on public.document_files (document_source_key);

alter table public.documents enable row level security;
alter table public.document_files enable row level security;
revoke all on table public.documents from anon, authenticated;
revoke all on table public.document_files from anon, authenticated;
