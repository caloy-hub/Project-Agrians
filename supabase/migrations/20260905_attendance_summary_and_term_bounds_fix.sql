-- ============================================================
-- AGRIANS — Fix: service-role regression + hardcoded term bounds
-- ============================================================
-- Audit finding #1 (CRITICAL): 20260902_attendance_integrity_fix.sql
-- re-created agrians_student_attendance_summary() WITHOUT the
-- `auth.uid() is not null` bypass that 20260902_attendance_audit_pass.sql
-- had added for trusted server-side (service-role) callers. Because
-- migrations apply in filename order and "...integrity_fix" sorts after
-- "...audit_pass", the guard-less version is what ended up live. Every
-- Edge Function call made with the service-role key (auth.uid() IS NULL)
-- has since been rejected with "Forbidden", which generate-sf9 silently
-- swallows and displays as a blank/unencoded month. This migration is the
-- single, final definition going forward — restoring the bypass.
--
-- Audit finding #5 (HIGH): agrians_school_days() hardcoded SY 2026-2027
-- term start/end days as literal `case when p_year=2026 ...` branches, with
-- no case for any other year — meaning the very next school year would
-- silently fall back to "every weekday is a school day" with no term
-- differentiation at all. This migration moves those boundaries into a
-- data table the admin can configure per year, instead of requiring a code
-- change every year. Today's SY 2026-2027 values are seeded unchanged so
-- behavior does not change until an admin adds a new year's row.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Configurable term-month day boundaries
-- ------------------------------------------------------------
create table if not exists public.school_term_day_bounds (
  year integer not null,
  month integer not null,
  term integer not null,
  start_day integer,
  end_day integer,
  primary key (year, month, term)
);

comment on table public.school_term_day_bounds is
  'Per-year override of the first/last school day within a (year, month, term). '
  'A missing start_day/end_day defaults to day 1 / the last day of the month. '
  'Add a row here for each new school year instead of editing agrians_school_days().';

alter table public.school_term_day_bounds enable row level security;

drop policy if exists "school_term_day_bounds_select_authenticated" on public.school_term_day_bounds;
create policy "school_term_day_bounds_select_authenticated"
on public.school_term_day_bounds for select to authenticated
using (true);

drop policy if exists "school_term_day_bounds_admin_write" on public.school_term_day_bounds;
create policy "school_term_day_bounds_admin_write"
on public.school_term_day_bounds for all to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

-- Seed the SY 2026-2027 boundaries that were previously hardcoded inside
-- agrians_school_days(), so this migration is a pure refactor with no
-- behavior change for the current school year.
insert into public.school_term_day_bounds (year, month, term, start_day, end_day) values
  (2026, 6,  1, 8,    null),
  (2026, 9,  1, null, 15),
  (2026, 9,  2, 16,   null),
  (2026, 12, 2, null, 18),
  (2027, 1,  3, 4,    null),
  (2027, 4,  3, null, 8)
on conflict (year, month, term) do nothing;

-- ------------------------------------------------------------
-- 2) agrians_school_days() reads boundaries from the table above instead
--    of a hardcoded per-year case statement. Unconfigured months keep the
--    same "whole month, weekdays only" fallback as before.
-- ------------------------------------------------------------
create or replace function public.agrians_school_days(
  p_month integer,
  p_year integer,
  p_term integer
) returns table(date date)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      make_date(p_year,p_month,1) as month_first,
      (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date as month_last,
      coalesce(b.start_day, 1) as start_day,
      coalesce(
        b.end_day,
        extract(day from (make_date(p_year,p_month,1) + interval '1 month - 1 day'))::int
      ) as end_day
    from (select 1) x
    left join public.school_term_day_bounds b
      on b.year=p_year and b.month=p_month and b.term=p_term
  ), days as (
    select generate_series(
      make_date(p_year,p_month,1) + (start_day-1),
      make_date(p_year,p_month,1) + (end_day-1),
      interval '1 day'
    )::date as date
    from bounds
  )
  select d.date
  from days d
  where extract(isodow from d.date) between 1 and 5
    and not exists (select 1 from public.school_holidays h where h.date=d.date)
  order by d.date;
$$;

grant execute on function public.agrians_school_days(integer,integer,integer) to authenticated;

comment on function public.agrians_school_days(integer,integer,integer) is
'Canonical AGRIANS school-day calculation: school_term_day_bounds (falls back to the whole '
'calendar month when unconfigured) + weekdays - school_holidays. Add a school_term_day_bounds '
'row for each new school year rather than editing this function.';

-- ------------------------------------------------------------
-- 3) Restore the service-role bypass on agrians_student_attendance_summary.
--    This is the final, authoritative definition of this function.
-- ------------------------------------------------------------
create or replace function public.agrians_student_attendance_summary(
  p_student_id uuid,
  p_month integer,
  p_year integer,
  p_term integer
) returns table(total_days integer, total_present integer, absent integer, attendance_pct integer, encoded boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  configured integer;
  actual integer;
  present_count integer;
  has_rows boolean;
begin
  -- Service-role calls from Edge Functions have no auth.uid() and are
  -- trusted server-side callers; only real (browser) sessions are checked.
  if auth.uid() is not null and not exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and (p.role='admin' or p.id=p_student_id or exists (
        select 1 from public.sections sec
        join public.profiles stu on stu.section_id=sec.id
        where stu.id=p_student_id and sec.adviser_id=auth.uid()
      ))
  ) then
    raise exception 'Forbidden: you may only view your own attendance or attendance for your assigned section' using errcode='42501';
  end if;

  select school_days into configured
  from public.school_calendar
  where month=p_month and year=p_year and term=p_term
  limit 1;

  select count(*) into actual from public.agrians_school_days(p_month,p_year,p_term);

  if configured is not null and configured <> actual then
    raise exception 'School calendar mismatch: configured %, calculated %', configured, actual using errcode='22000';
  end if;

  select exists(
    select 1
    from public.daily_attendance a
    where a.student_id=p_student_id
      and a.date in (select date from public.agrians_school_days(p_month,p_year,p_term))
  ) into has_rows;

  if has_rows then
    select count(*) into present_count
    from public.agrians_school_days(p_month,p_year,p_term) d
    where coalesce((
      select a.status
      from public.daily_attendance a
      where a.student_id=p_student_id and a.date=d.date
      order by a.created_at desc
      limit 1
    ),'present')='present';
  else
    present_count := 0;
  end if;

  return query
  select
    actual::integer,
    least(greatest(present_count,0),actual)::integer,
    case when has_rows then greatest(actual-least(greatest(present_count,0),actual),0) else 0 end::integer,
    case when has_rows and actual>0 then round((least(greatest(present_count,0),actual)::numeric/actual)*100)::integer else 0 end::integer,
    has_rows;
end;
$$;

grant execute on function public.agrians_student_attendance_summary(uuid,integer,integer,integer) to authenticated;

comment on function public.agrians_student_attendance_summary(uuid,integer,integer,integer) is
'Canonical AGRIANS learner attendance summary. auth.uid() IS NULL is treated as a trusted '
'server-side (service-role) caller — do not remove the "auth.uid() is not null" guard in any '
'future redefinition of this function, or Edge Functions (generate-sf9) will be silently '
'locked out again.';

-- ------------------------------------------------------------
-- 4) Audit finding #6 (HIGH): standardize rounding. The section-level
--    summary previously rounded attendance_pct to 2 decimal places while
--    the student-level summary rounds to a whole integer, so SF2/SF4
--    (section-based) and the Student Dashboard/SF9 (student-based) could
--    show slightly different percentages for the same underlying numbers.
--    Round both to whole numbers.
-- ------------------------------------------------------------
create or replace function public.agrians_section_attendance_summary(
  p_section_id uuid,
  p_month integer,
  p_year integer,
  p_term integer
) returns table(
  student_id uuid,
  gender text,
  total_days integer,
  total_present integer,
  absent integer,
  attendance_pct numeric,
  encoded boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  configured integer;
  actual integer;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and (p.role='admin' or exists (
        select 1 from public.sections sec where sec.id=p_section_id and sec.adviser_id=auth.uid()
      ))
  ) then
    raise exception 'Forbidden: attendance summary is available only to the admin or section adviser' using errcode='42501';
  end if;

  select school_days into configured
  from public.school_calendar
  where month=p_month and year=p_year and term=p_term
  limit 1;

  select count(*) into actual from public.agrians_school_days(p_month,p_year,p_term);
  if configured is not null and configured <> actual then
    raise exception 'School calendar mismatch: configured %, calculated %', configured, actual using errcode='22000';
  end if;

  return query
  select
    s.id,
    s.gender,
    actual::integer,
    case when exists(
      select 1 from public.daily_attendance a
      where a.student_id=s.id and a.date in (select date from public.agrians_school_days(p_month,p_year,p_term))
    ) then least(greatest((select count(*) from public.agrians_school_days(p_month,p_year,p_term) d where coalesce((
      select a.status from public.daily_attendance a
      where a.student_id=s.id and a.date=d.date
      order by a.created_at desc limit 1
    ),'present')='present'),0),actual)::integer else 0 end,
    case when exists(
      select 1 from public.daily_attendance a
      where a.student_id=s.id and a.date in (select date from public.agrians_school_days(p_month,p_year,p_term))
    ) then greatest(actual-least(greatest((select count(*) from public.agrians_school_days(p_month,p_year,p_term) d where coalesce((
      select a.status from public.daily_attendance a
      where a.student_id=s.id and a.date=d.date
      order by a.created_at desc limit 1
    ),'present')='present'),0),actual),0)::integer else 0 end,
    case when exists(
      select 1 from public.daily_attendance a
      where a.student_id=s.id and a.date in (select date from public.agrians_school_days(p_month,p_year,p_term))
    ) and actual>0 then round((least(greatest((select count(*) from public.agrians_school_days(p_month,p_year,p_term) d where coalesce((
      select a.status from public.daily_attendance a
      where a.student_id=s.id and a.date=d.date
      order by a.created_at desc limit 1
    ),'present')='present'),0),actual)::numeric/actual)*100) else 0 end,
    exists(
      select 1 from public.daily_attendance a
      where a.student_id=s.id and a.date in (select date from public.agrians_school_days(p_month,p_year,p_term))
    )
  from public.profiles s
  where s.role='student' and s.section_id=p_section_id
  order by s.gender, s.name;
end;
$$;

grant execute on function public.agrians_section_attendance_summary(uuid,integer,integer,integer) to authenticated;

comment on function public.agrians_section_attendance_summary(uuid,integer,integer,integer) is
'Canonical section learner attendance summary from agrians_school_days + daily_attendance. '
'attendance_pct is rounded to a whole number to match agrians_student_attendance_summary, so '
'SF2/SF4 and the Student Dashboard/SF9 never disagree on the same learner-month due to rounding.';
