alter table if exists public.line_intake_items
  add column if not exists ocr_status text not null default 'pending',
  add column if not exists ocr_provider text not null default '',
  add column if not exists ocr_confidence numeric not null default 0,
  add column if not exists ocr_warnings jsonb not null default '[]'::jsonb,
  add column if not exists ocr_error text not null default '',
  add column if not exists created_document jsonb,
  add column if not exists created_document_no text;

update public.line_intake_items
set ocr_status = 'pending'
where ocr_status is null;

alter table if exists public.line_intake_items
  drop constraint if exists line_intake_items_ocr_status_check;

alter table if exists public.line_intake_items
  add constraint line_intake_items_ocr_status_check
  check (ocr_status in ('pending', 'needs_review', 'failed'));

alter table if exists public.line_intake_items
  drop constraint if exists line_intake_items_ocr_confidence_check;

alter table if exists public.line_intake_items
  add constraint line_intake_items_ocr_confidence_check
  check (ocr_confidence >= 0 and ocr_confidence <= 1);
