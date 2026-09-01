-- ============================================================
-- AGRIANS — Attendance Audit Pass / Canonical Report Bridge
-- Calendar → Daily Attendance → Student Attendance → SF2/SF4/SF9
--
-- This migration makes the database RPCs the shared calculation layer used
-- by the learner dashboard and the DepEd report generators. It also adds
-- section-level summaries and an admin audit RPC for reconciliation.
-- ============================================================

-- Service-role calls from Supabase Edge Functions have no auth.uid(). They
-- are trusted server-side calls; normal authenticated browser calls remain
-- subject to the role/section checks below.

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
    ),'present')='present'),0),actual)::numeric/actual)*100,2) else 0 end,
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

-- Allow trusted Edge Functions to use the canonical RPCs while preserving
-- browser authorization. A NULL auth.uid() here is the service-role path.
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
  if auth.uid() is not null and not exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and (p.role='admin' or exists (select 1 from public.sections sec where sec.id=p_section_id and sec.adviser_id=auth.uid()))
  ) then
    raise exception 'Forbidden: attendance grid is available only to the admin or section adviser' using errcode='42501';
  end if;

  select school_days into configured from public.school_calendar
  where month=p_month and year=p_year and term=p_term limit 1;
  select count(*) into actual from public.agrians_school_days(p_month,p_year,p_term);
  if configured is not null and configured <> actual then
    raise exception 'School calendar mismatch: configured %, calculated %', configured, actual using errcode='22000';
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

-- Recreate learner summary with the same service-role bridge and explicit
-- bounds. This is the canonical monthly learner result used by the UI/SF9.
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

  select school_days into configured from public.school_calendar
  where month=p_month and year=p_year and term=p_term limit 1;
  select count(*) into actual from public.agrians_school_days(p_month,p_year,p_term);
  if configured is not null and configured <> actual then
    raise exception 'School calendar mismatch: configured %, calculated %', configured, actual using errcode='22000';
  end if;

  select exists(
    select 1 from public.daily_attendance a
    where a.student_id=p_student_id
      and a.date in (select date from public.agrians_school_days(p_month,p_year,p_term))
  ) into has_rows;

  if has_rows then
    select count(*) into present_count
    from public.agrians_school_days(p_month,p_year,p_term) d
    where coalesce((
      select a.status from public.daily_attendance a
      where a.student_id=p_student_id and a.date=d.date
      order by a.created_at desc limit 1
    ),'present')='present';
  else
    present_count := 0;
  end if;

  present_count := least(greatest(present_count,0),actual);
  return query select
    actual::integer,
    present_count::integer,
    case when has_rows then greatest(actual-present_count,0) else 0 end::integer,
    case when has_rows and actual>0 then round((present_count::numeric/actual)*100)::integer else 0 end::integer,
    has_rows;
end;
$$;

grant execute on function public.agrians_student_attendance_summary(uuid,integer,integer,integer) to authenticated;

-- Admin/adviser reconciliation endpoint. It checks the calendar denominator,
-- the raw daily grid, and the derived learner totals for impossible states.
create or replace function public.agrians_attendance_audit(
  p_section_id uuid,
  p_month integer,
  p_year integer,
  p_term integer
) returns table(
  configured_days integer,
  actual_days integer,
  calendar_agrees boolean,
  roster_count integer,
  encoded_student_count integer,
  unencoded_student_count integer,
  daily_rows_in_grid integer,
  daily_rows_outside_grid integer,
  duplicate_student_date_count integer,
  impossible_summary_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  configured integer;
  actual integer;
  roster integer;
  encoded integer;
  raw_in integer;
  raw_out integer;
  dupes integer;
  impossible integer;
  first_day date;
  last_day date;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and (p.role='admin' or exists (select 1 from public.sections sec where sec.id=p_section_id and sec.adviser_id=auth.uid()))
  ) then
    raise exception 'Forbidden: attendance audit is available only to the admin or section adviser' using errcode='42501';
  end if;

  select school_days into configured from public.school_calendar
  where month=p_month and year=p_year and term=p_term limit 1;
  select count(*) into actual from public.agrians_school_days(p_month,p_year,p_term);
  select min(date),max(date) into first_day,last_day from public.agrians_school_days(p_month,p_year,p_term);
  select count(*) into roster from public.profiles where role='student' and section_id=p_section_id;

  select count(distinct a.student_id) into encoded
  from public.daily_attendance a
  join public.profiles s on s.id=a.student_id and s.section_id=p_section_id
  where a.date in (select date from public.agrians_school_days(p_month,p_year,p_term));

  select count(*) into raw_in
  from public.daily_attendance a
  join public.profiles s on s.id=a.student_id and s.section_id=p_section_id
  where a.date in (select date from public.agrians_school_days(p_month,p_year,p_term));

  select count(*) into raw_out
  from public.daily_attendance a
  join public.profiles s on s.id=a.student_id and s.section_id=p_section_id
  where (first_day is not null and last_day is not null and a.date between first_day and last_day)
    and a.date not in (select date from public.agrians_school_days(p_month,p_year,p_term));

  select count(*) into dupes
  from (
    select a.student_id,a.date
    from public.daily_attendance a
    join public.profiles s on s.id=a.student_id and s.section_id=p_section_id
    where first_day is not null and last_day is not null and a.date between first_day and last_day
    group by a.student_id,a.date having count(*)>1
  ) x;

  select count(*) into impossible
  from public.agrians_section_attendance_summary(p_section_id,p_month,p_year,p_term) x
  where x.total_present<0 or x.total_present>x.total_days or x.absent<0 or x.absent>x.total_days
     or x.attendance_pct<0 or x.attendance_pct>100;

  return query select
    configured, actual, (configured is null or configured=actual), roster,
    encoded, greatest(roster-encoded,0), raw_in, raw_out, dupes, impossible;
end;
$$;

grant execute on function public.agrians_attendance_audit(uuid,integer,integer,integer) to authenticated;

comment on function public.agrians_section_attendance_summary(uuid,integer,integer,integer) is
'Canonical section learner attendance summary from agrians_school_days + daily_attendance.';
comment on function public.agrians_attendance_audit(uuid,integer,integer,integer) is
'AGRIANS reconciliation audit for Calendar/Daily Attendance/learner totals; PASS requires no calendar mismatch, no out-of-grid rows, no duplicates, and no impossible totals.';
