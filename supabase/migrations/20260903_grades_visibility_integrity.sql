-- AGRIANS — Grade visibility and subject-assignment integrity
--
-- Subject teachers must be able to encode grades for students in their
-- assigned subject/section. Advisers must be able to READ all grades for
-- learners in their section so My Class, Honors, and SF9 preparation see the
-- same records. Learners may read only their own grades. Admins may manage all.

alter table public.grades enable row level security;

-- READ: learner's own grades.
drop policy if exists "grades_select_own_student" on public.grades;
create policy "grades_select_own_student"
on public.grades for select to authenticated
using (student_id = auth.uid());

-- READ: admin.
drop policy if exists "grades_select_admin" on public.grades;
create policy "grades_select_admin"
on public.grades for select to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

-- READ: section adviser can see every grade belonging to learners in the
-- adviser's assigned section.
drop policy if exists "grades_select_adviser" on public.grades;
create policy "grades_select_adviser"
on public.grades for select to authenticated
using (exists (
  select 1
  from public.profiles stu
  join public.sections sec on sec.id=stu.section_id
  where stu.id=grades.student_id
    and sec.adviser_id=auth.uid()
));

-- READ: subject teacher can review grades for students covered by their
-- assignment. A NULL assignment section means grade-wide assignment.
drop policy if exists "grades_select_subject_teacher" on public.grades;
create policy "grades_select_subject_teacher"
on public.grades for select to authenticated
using (exists (
  select 1
  from public.subject_assignments sa
  join public.profiles stu on stu.id=grades.student_id
  where sa.teacher_id=auth.uid()
    and sa.subject_id=grades.subject_id
    and (sa.section_id is null or sa.section_id=stu.section_id)
));

-- INSERT: subject teachers may encode only subjects/sections actually assigned
-- to them. Admins retain unrestricted entry.
drop policy if exists "grades_insert_admin" on public.grades;
create policy "grades_insert_admin"
on public.grades for insert to authenticated
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

drop policy if exists "grades_insert_subject_teacher" on public.grades;
create policy "grades_insert_subject_teacher"
on public.grades for insert to authenticated
with check (
  encoded_by=auth.uid()
  and exists (
    select 1
    from public.subject_assignments sa
    join public.profiles stu on stu.id=grades.student_id
    where sa.teacher_id=auth.uid()
      and sa.subject_id=grades.subject_id
      and (sa.section_id is null or sa.section_id=stu.section_id)
  )
);

-- UPDATE: admin, the encoding teacher, or the teacher assigned to that
-- subject/section may correct an existing grade.
drop policy if exists "grades_update_admin" on public.grades;
create policy "grades_update_admin"
on public.grades for update to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

drop policy if exists "grades_update_teacher" on public.grades;
create policy "grades_update_teacher"
on public.grades for update to authenticated
using (exists (
  select 1 from public.subject_assignments sa
  join public.profiles stu on stu.id=grades.student_id
  where sa.teacher_id=auth.uid() and sa.subject_id=grades.subject_id
    and (sa.section_id is null or sa.section_id=stu.section_id)
))
with check (exists (
  select 1 from public.subject_assignments sa
  join public.profiles stu on stu.id=grades.student_id
  where sa.teacher_id=auth.uid() and sa.subject_id=grades.subject_id
    and (sa.section_id is null or sa.section_id=stu.section_id)
));

-- DELETE: admin or the assigned subject teacher.
drop policy if exists "grades_delete_admin" on public.grades;
create policy "grades_delete_admin"
on public.grades for delete to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

drop policy if exists "grades_delete_teacher" on public.grades;
create policy "grades_delete_teacher"
on public.grades for delete to authenticated
using (exists (
  select 1 from public.subject_assignments sa
  join public.profiles stu on stu.id=grades.student_id
  where sa.teacher_id=auth.uid() and sa.subject_id=grades.subject_id
    and (sa.section_id is null or sa.section_id=stu.section_id)
));

-- Ensure the grade identity used by upsert is enforced at the database level.
create unique index if not exists grades_student_subject_term_unique
  on public.grades(student_id,subject_id,term);
