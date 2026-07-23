-- ============================================================
-- Daily attendance, non-school days, and learner movement status
-- — required to compute real School Form 2 (daily grid) and
-- School Form 4 (Movement of Learners) reports.
-- ============================================================

-- One row per student per calendar day. Only school days need a row;
-- a missing row is treated as "not yet encoded" (not counted either way).
create table if not exists public.daily_attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  status text not null default 'present' check (status in ('present','absent')),
  encoded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (student_id, date)
);
create index if not exists daily_attendance_student_date_idx on public.daily_attendance (student_id, date);
create index if not exists daily_attendance_date_idx on public.daily_attendance (date);

-- Admin-managed non-school days (holidays, suspensions) — excluded from the
-- SF2 daily grid so teachers never mark attendance on a day that didn't happen.
create table if not exists public.school_holidays (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  label text not null default 'Holiday'
);

-- Movement of Learners, needed for School Form 4. Every student defaults to
-- Active; set the other statuses + a status_date when a learner transfers or
-- drops out, so SF4 can pick up the correct month automatically.
alter table public.profiles
  add column if not exists enrollment_status text not null default 'Active'
    check (enrollment_status in ('Active','Transferred In','Transferred Out','Dropped Out')),
  add column if not exists status_date date;

-- ============================================================
-- IMPORTANT — Row Level Security
-- This migration does not add RLS policies, because the correct rules depend
-- on the policies you already have on the existing `attendance` table (which
-- today lets an adviser write attendance directly from the browser for their
-- own section). In the Supabase Dashboard, open Authentication → Policies,
-- and duplicate the same SELECT/INSERT/UPDATE policies you have on
-- `attendance` onto `daily_attendance`, and the same policies you have on
-- `school_calendar` onto `school_holidays` (admin-managed, read for all).
-- Without this step, the new daily-attendance grid will fail to save.
-- ============================================================
