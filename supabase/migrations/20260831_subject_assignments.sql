-- AGRIANS v2.4: normalized Subject + Teacher + Section assignments.
-- A subject is created once; this table records who handles it and where.
-- section_id NULL means the teacher handles the subject grade-wide.
create table if not exists public.subject_assignments (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  section_id uuid references public.sections(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists subject_assignments_subject_idx on public.subject_assignments(subject_id);
create index if not exists subject_assignments_teacher_idx on public.subject_assignments(teacher_id);
create index if not exists subject_assignments_section_idx on public.subject_assignments(section_id);
create unique index if not exists subject_assignments_scoped_unique
  on public.subject_assignments(subject_id, teacher_id, section_id)
  where section_id is not null;
create unique index if not exists subject_assignments_gradewide_unique
  on public.subject_assignments(subject_id, teacher_id)
  where section_id is null;

-- Backfill the existing one-teacher subject model so no current assignment is lost.
insert into public.subject_assignments (subject_id, teacher_id, section_id)
select id, teacher_id, section_id
from public.subjects
where teacher_id is not null
on conflict do nothing;

-- Browser access follows the existing application's role model:
-- authenticated users may read assignments; only admins may change them.
alter table public.subject_assignments enable row level security;

drop policy if exists "subject_assignments_select_authenticated" on public.subject_assignments;
create policy "subject_assignments_select_authenticated"
on public.subject_assignments for select to authenticated
using (true);

drop policy if exists "subject_assignments_admin_insert" on public.subject_assignments;
create policy "subject_assignments_admin_insert"
on public.subject_assignments for insert to authenticated
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

drop policy if exists "subject_assignments_admin_update" on public.subject_assignments;
create policy "subject_assignments_admin_update"
on public.subject_assignments for update to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

drop policy if exists "subject_assignments_admin_delete" on public.subject_assignments;
create policy "subject_assignments_admin_delete"
on public.subject_assignments for delete to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
