-- ============================================================
-- AGRIANS — Attendance Integrity Fix
-- Corrects legacy monthly totals and enforces the canonical rule:
-- Calendar dates + daily_attendance are the only source for learner totals.
-- ============================================================

-- 1) Repair any legacy monthly attendance totals that were left behind by
-- earlier versions of the app. This prevents impossible values such as
-- 21 present / 19 school days from remaining in the database.
-- The legacy table is retained for backward compatibility, but the current
-- application and reports no longer use it as the attendance source of truth.
update public.attendance a
set days_present = coalesce((
  select count(*)::integer
  from public.agrians_school_days(a.month,a.year,a.term) d
  left join public.daily_attendance da
    on da.student_id=a.student_id
   and da.date=d.date
  where coalesce(da.status,'present')='present'
),0);

-- 2) Defensive uniqueness for the daily grid. The original migration already
-- declares this constraint; this also repairs any legacy duplicate rows before
-- creating the index. One row is retained for each student/date.
delete from public.daily_attendance a
using public.daily_attendance b
where a.id < b.id
  and a.student_id=b.student_id
  and a.date=b.date;

create unique index if not exists daily_attendance_student_date_unique_idx
  on public.daily_attendance(student_id,date);

-- 3) Keep the calendar key unique. This prevents two monthly calendar rows
-- from being selected inconsistently by `.find()` / `.maybeSingle()` calls.
-- If an old deployment contains duplicates, keep the newest row per key.
delete from public.school_calendar a
using public.school_calendar b
where a.id < b.id
  and a.month=b.month
  and a.year=b.year
  and a.term=b.term;

create unique index if not exists school_calendar_month_year_term_unique_idx
  on public.school_calendar(month,year,term);

-- 4) Make the canonical learner summary resilient to duplicate daily rows in
-- legacy databases by counting dates, not raw joined rows. Missing daily rows
-- retain the existing AGRIANS convention of Present after a grid is encoded.
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
  if not exists (
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
