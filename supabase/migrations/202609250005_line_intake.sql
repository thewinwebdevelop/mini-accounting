create table if not exists public.line_intake_items (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  message_id text not null unique,
  line_user_id text not null,
  media_kind text not null check (media_kind in ('image', 'pdf')),
  original_name text not null,
  content_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null,
  storage_bucket text not null,
  object_path text not null,
  status text not null check (status in ('needs_confirmation', 'confirmed', 'cancelled', 'failed')),
  extracted_payload jsonb not null default '{}'::jsonb,
  duplicate_source_keys jsonb not null default '[]'::jsonb,
  ocr_status text not null default 'pending' check (ocr_status in ('pending', 'needs_review', 'failed')),
  ocr_provider text not null default '',
  ocr_confidence numeric not null default 0 check (ocr_confidence >= 0 and ocr_confidence <= 1),
  ocr_warnings jsonb not null default '[]'::jsonb,
  ocr_error text not null default '',
  created_document jsonb,
  created_document_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists line_intake_items_line_user_id_created_at_idx
  on public.line_intake_items (line_user_id, created_at desc);

alter table public.line_intake_items enable row level security;
revoke all on table public.line_intake_items from anon, authenticated;
