-- Run this once in Supabase: Project -> SQL Editor -> New query -> paste -> Run.
-- Sets up the two tables the app needs. Safe to re-run (uses IF NOT EXISTS).

create table if not exists cases (
  case_no text primary key,
  attorney text,
  status text,
  intake_date date,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists cases_attorney_idx on cases (attorney);
create index if not exists cases_status_idx on cases (status);

-- Share links power the read-only views for Kevin and each law firm.
-- scope = 'ALL' sees every case; anything else is matched against the
-- case's attorney name (case-insensitive).
create table if not exists share_links (
  token text primary key,
  scope text not null,
  label text,
  created_at timestamptz not null default now()
);

-- This app never uses the public/anon Supabase key -- every read and
-- write goes through Netlify Functions using the service role key, which
-- bypasses Row Level Security entirely. RLS is enabled here anyway as a
-- safety net in case the anon key ever leaks or gets used by mistake.
alter table cases enable row level security;
alter table share_links enable row level security;

-- Note: two Storage buckets ("returns" and "affidavits") also get used by
-- the app to store the actual PDF files, attached to each case. You don't
-- need to create these manually -- the app creates them automatically
-- (as private buckets) the first time it needs to. Nothing to run here
-- for that part.

-- ============================================================
-- MIGRATION (run once): case numbers repeat -- fix the primary key
-- ============================================================
-- Case numbers are NOT unique in Jeremy's workflow (multiple defendants
-- on one case get logged as separate entries sharing the same case
-- number, and a case number can resurface later). This migration adds a
-- proper unique `id` column (built from case number + defendant name)
-- and moves the primary key off of case_no, so `case_no` can repeat
-- freely without one entry silently overwriting another.
--
-- Safe to run even if you already have data in the `cases` table --
-- it backfills `id` for existing rows before making it the primary key.

alter table cases add column if not exists id text;

-- Backfill id for any existing rows (case_no + defendant, lowercased),
-- matching the app's makePaperId() logic.
update cases
set id = lower(trim(case_no)) || '::' || lower(trim(coalesce(data->>'defendant', '')))
where id is null;

-- Drop the old primary key (was on case_no) and add the new one on id.
alter table cases drop constraint if exists cases_pkey;
alter table cases add primary key (id);

-- case_no is now just a normal indexed column (index already created
-- above), not unique -- duplicates are expected and fine.

-- ============================================================
-- Invoices: logged record of every generated weekly invoice
-- ============================================================
-- Run this once (safe to re-run, uses IF NOT EXISTS). The PDF itself
-- lives in a private "invoices" Storage bucket, created automatically
-- by the app the first time it's needed -- nothing to set up manually
-- for that part.

create table if not exists invoices (
  week_key text primary key,
  week_label text,
  billable_count integer not null default 0,
  total numeric not null default 0,
  pdf_path text,
  generated_at timestamptz not null default now()
);

alter table invoices enable row level security;
