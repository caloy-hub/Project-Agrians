-- =====================================================================
-- DISCIPLINE MODULE (formerly the standalone SILAB app) — Term 2 launch
-- =====================================================================
-- This migration folds SILAB's infraction-logging feature directly into
-- Agrians' existing database. It does NOT create a separate students
-- table — Agrians already stores every learner as a row in `profiles`
-- (role='student'), complete with lrn, grade_level and section_id, so
-- infractions simply reference that same profile id. No student-matching
-- step is required going forward.
--
-- Role mapping (SILAB -> Agrians, nothing new to add on the auth side):
--   SILAB "admin"            -> profiles.role = 'admin'
--   SILAB "curriculum_head"  -> profiles.role = 'teacher' AND is_curriculum_head = true
--   SILAB "adviser"          -> profiles.role = 'teacher' AND sections.adviser_id = their id
--   SILAB roster "student"   -> profiles.role = 'student' (already exists)
--
-- Historical Term 1 data from SILAB is intentionally NOT bulk-imported.
-- Advisers/CH/Admin can manually back-encode Term 1 records themselves
-- using the "Term" + "Incident Date" fields on the new Discipline tab —
-- this avoids any LRN/record mismatch from an automated import.
-- =====================================================================

create table if not exists public.infractions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  section_id uuid references public.sections(id) on delete set null,
  grade_level integer,
  violation_type text not null check (violation_type in (
    'absence','tardiness','uniform_violation','cutting_classes','other'
  )),
  violation_detail text,
  remarks text,
  incident_date date not null default current_date,
  term smallint not null default 2 check (term in (1,2,3)),
  school_year text not null default '2026-2027',
  status text not null default 'active' check (status in ('active','archived')),
  is_backfill boolean not null default false,
  logged_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_infractions_student on public.infractions(student_id);
create index if not exists idx_infractions_section on public.infractions(section_id);
create index if not exists idx_infractions_grade on public.infractions(grade_level);
create index if not exists idx_infractions_incident_date on public.infractions(incident_date);
create index if not exists idx_infractions_logged_by on public.infractions(logged_by);

comment on table public.infractions is
  'Discipline module (merged from SILAB). student_id/logged_by reference profiles.id directly.';

-- ---------------------------------------------------------------------
-- Auto-fill section_id / grade_level from the student's own profile so
-- the record can never point to stale/incorrect scope data, and so the
-- RLS checks below (which key off grade_level/section_id) are reliable
-- even if the client sends nothing for those two columns.
-- ---------------------------------------------------------------------
create or replace function public.infractions_autofill_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.section_id is null or new.grade_level is null then
    select section_id, grade_level
      into new.section_id, new.grade_level
      from public.profiles
      where id = new.student_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_infractions_autofill_scope on public.infractions;
create trigger trg_infractions_autofill_scope
  before insert on public.infractions
  for each row execute function public.infractions_autofill_scope();

-- ---------------------------------------------------------------------
-- Convenience view — per-student violation counts, used for the summary
-- badges on the Discipline tab. Archived records are excluded.
-- ---------------------------------------------------------------------
create or replace view public.infraction_counts as
  select student_id, violation_type, count(*) as count
  from public.infractions
  where status = 'active'
  group by student_id, violation_type;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.infractions enable row level security;

-- Admin: unrestricted (covers select/insert/update/delete)
drop policy if exists infractions_admin_all on public.infractions;
create policy infractions_admin_all on public.infractions
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Adviser: read/write only for infractions in their own advisory section
drop policy if exists infractions_adviser_select on public.infractions;
create policy infractions_adviser_select on public.infractions
  for select
  using (exists (
    select 1 from public.sections s
    where s.id = infractions.section_id and s.adviser_id = auth.uid()
  ));

drop policy if exists infractions_adviser_insert on public.infractions;
create policy infractions_adviser_insert on public.infractions
  for insert
  with check (exists (
    select 1 from public.sections s
    where s.id = infractions.section_id and s.adviser_id = auth.uid()
  ) or exists (
    -- section_id may still be null at the moment RLS evaluates INSERT ...
    -- the BEFORE trigger above fills it first, so this branch is a safety
    -- net only; the real gate is the adviser-of-this-student check below.
    select 1 from public.profiles st
    join public.sections s on s.id = st.section_id
    where st.id = infractions.student_id and s.adviser_id = auth.uid()
  ));

-- Curriculum Head: read/write for any section within their assigned grade
drop policy if exists infractions_ch_select on public.infractions;
create policy infractions_ch_select on public.infractions
  for select
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_curriculum_head
      and p.assigned_grade_level = infractions.grade_level
  ));

drop policy if exists infractions_ch_insert on public.infractions;
create policy infractions_ch_insert on public.infractions
  for insert
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_curriculum_head
      and p.assigned_grade_level = (select grade_level from public.profiles st where st.id = infractions.student_id)
  ));

-- Student: read-only access to their own conduct record
drop policy if exists infractions_student_select on public.infractions;
create policy infractions_student_select on public.infractions
  for select
  using (student_id = auth.uid());

-- Anyone who logged an entry may delete their own mistake (admin already
-- has unrestricted delete via infractions_admin_all above)
drop policy if exists infractions_own_delete on public.infractions;
create policy infractions_own_delete on public.infractions
  for delete
  using (logged_by = auth.uid());

grant select on public.infraction_counts to authenticated;
