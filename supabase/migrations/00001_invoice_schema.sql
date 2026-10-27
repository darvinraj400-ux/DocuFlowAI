-- ===========================================================================
-- DocuFlow AI — initial schema
-- Run with the Supabase migration tooling or `supabase db push`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.invoice_status as enum (
  'uploaded',
  'processing',
  'needs_review',
  'approved',
  'rejected',
  'failed'
);

create type public.invoice_event_type as enum (
  'uploaded',
  'processing_started',
  'processing_succeeded',
  'processing_failed',
  'needs_review',
  'approved',
  'rejected',
  'status_changed',
  'webhook_sent'
);

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_filename text not null,
  storage_path text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  file_sha256 text not null,
  status public.invoice_status not null default 'uploaded',
  extracted_data jsonb,
  reviewed_data jsonb,
  validation_findings jsonb,
  duplicate_flags jsonb,
  extraction_meta jsonb,
  error_info jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Non-unique indexes used for duplicate lookups (exact hash and normalized
-- supplier + invoice number). Deliberately non-unique: duplicates are flagged
-- for review, never rejected by the schema.
create index invoices_user_created_idx on public.invoices (user_id, created_at desc);
create index invoices_user_status_idx on public.invoices (user_id, status);
create index invoices_user_supplier_number_idx
  on public.invoices (user_id, lower(coalesce(extracted_data->>'supplier', '')), lower(coalesce(extracted_data->>'invoiceNumber', '')));
create index invoices_file_sha_idx on public.invoices (file_sha256);

-- ---------------------------------------------------------------------------
-- invoice_line_items
-- ---------------------------------------------------------------------------
create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(14, 4) check (quantity >= 0),
  unit_price numeric(14, 4) check (unit_price >= 0),
  tax_amount numeric(14, 2) check (tax_amount >= 0),
  line_total numeric(14, 2) check (line_total >= 0)
);

create index invoice_line_items_invoice_idx on public.invoice_line_items (invoice_id);

-- ---------------------------------------------------------------------------
-- invoice_events (audit log)
-- ---------------------------------------------------------------------------
create table public.invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  actor uuid references auth.users(id),          -- null = system
  event_type public.invoice_event_type not null,
  before_changes jsonb,
  after_changes jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index invoice_events_invoice_idx on public.invoice_events (invoice_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- Grants, Row Level Security
-- ===========================================================================
alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.invoice_events enable row level security;

-- Revoke direct write access from browser-facing roles. Business-critical
-- mutations are funnelled through authenticated server-side routes using the
-- service-role client (which bypasses RLS and must enforce ownership itself).
revoke all on table public.invoices from anon, authenticated;
revoke all on table public.invoice_line_items from anon, authenticated;
revoke all on table public.invoice_events from anon, authenticated;

-- Allow browser-facing authenticated role to read only their own rows.
grant select on table public.invoices to authenticated;
grant select on table public.invoice_line_items to authenticated;
grant select on table public.invoice_events to authenticated;

-- RLS policies: each user can only see their own invoices and related rows.
create policy invoices_select_own on public.invoices
  for select to authenticated
  using (user_id = auth.uid());

create policy invoice_line_items_select_own on public.invoice_line_items
  for select to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_id and i.user_id = auth.uid()
    )
  );

create policy invoice_events_select_own on public.invoice_events
  for select to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_id and i.user_id = auth.uid()
    )
  );
