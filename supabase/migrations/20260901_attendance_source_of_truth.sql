-- ============================================================
-- AGRIANS — Attendance Calculation Source of Truth
-- Calendar -> Daily Attendance -> SF2 / SF4 / Student Dashboard
-- ============================================================
-- This migration adds read-only calculation RPCs so the same date/status
-- rules can be consumed by the web app and Supabase Edge Functions.
-- Existing tables remain unchanged.

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
      case
        when p_year=2026 and p_month=6 and p_term=1 then 8
        when p_year=2026 and p_month=9 and p_term=1 then 1
        when p_year=2026 and p_month=9 and p_term=2 then 16
        when p_year=2026 and p_month=12 and p_term=2 then 1
        when p_year=2027 and p_month=1 and p_term=3 then 4
        when p_year=2027 and p_month=4 and p_term=3 then 1
        else 1
      end as start_day,
      case
        when p_year=2026 and p_month=9 and p_term=1 then 15
        when p_year=2026 and p_month=12 and p_term=2 then 18
        when p_year=2027 and p_month=4 and p_term=3 then 8
        else extract(day from (make_date(p_year,p_month,1) + interval '1 month - 1 day'))::int
      end as end_day
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


create or replace function public.agrians_attendance_grid(
  p_section_id uuid,
  p_month integer,
  p_year integer,
  p_term integer
) returns table(student_id uuid, date date, status text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  configured integer;
  actual integer;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and (p.role='admin' or exists (select 1 from public.sections sec where sec.id=p_section_id and sec.adviser_id=auth.uid()))
  ) then
    raise exception 'Forbidden: attendance grid is available only to the admin or section adviser' using errcode='42501';
  end if;

  select school_days into configured
  from public.school_calendar
  where month=p_month and year=p_year and term=p_term
  limit 1;

  select count(*) into actual from public.agrians_school_days(p_month,p_year,p_term);
  if configured is not null and configured <> actual then
    raise exception 'School calendar mismatch: configured %, calculated %', configured, actual
      using errcode='22000';
  end if;

  return query
  select s.id, d.date, coalesce(a.status,'present')
  from public.profiles s
  cross join public.agrians_school_days(p_month,p_year,p_term) d
  left join public.daily_attendance a on a.student_id=s.id and a.date=d.date
  where s.role='student' and s.section_id=p_section_id
  order by s.gender, s.name, d.date;
end;
$$;

grant execute on function public.agrians_attendance_grid(uuid,integer,integer,integer) to authenticated;

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
    raise exception 'School calendar mismatch: configured %, calculated %', configured, actual
      using errcode='22000';
  end if;

  return query
  select
    actual,
    coalesce(sum(case when a.status='absent' then 0 else 1 end),0)::integer,
    greatest(actual-coalesce(sum(case when a.status='absent' then 0 else 1 end),0),0)::integer,
    case when actual=0 then 0 else round((coalesce(sum(case when a.status='absent' then 0 else 1 end),0)::numeric/actual)*100)::integer end,
    exists(select 1 from public.daily_attendance a where a.student_id=p_student_id and a.date in (select date from public.agrians_school_days(p_month,p_year,p_term)))
  from public.agrians_school_days(p_month,p_year,p_term) d
  left join public.daily_attendance a on a.student_id=p_student_id and a.date=d.date;
end;
$$;

grant execute on function public.agrians_student_attendance_summary(uuid,integer,integer,integer) to authenticated;

comment on function public.agrians_school_days(integer,integer,integer) is
'Canonical AGRIANS school-day calculation: term boundaries + weekdays - school_holidays.';
comment on function public.agrians_attendance_grid(uuid,integer,integer,integer) is
'Canonical AGRIANS attendance grid. Missing daily rows default to present, matching the adviser SF2 convention.';
comment on function public.agrians_student_attendance_summary(uuid,integer,integer,integer) is
'Canonical AGRIANS learner attendance summary derived from the same grid used for SF2/SF4.';
