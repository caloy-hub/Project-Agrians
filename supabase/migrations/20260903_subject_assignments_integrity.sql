-- AGRIANS: subject assignment integrity repair.
-- The application no longer depends on PostgREST ON CONFLICT inference because
-- section-scoped and grade-wide assignments use separate partial unique indexes.
-- Keep both indexes explicit and clean up any accidental duplicates first.

-- Remove duplicate section-scoped rows, retaining the oldest row.
delete from public.subject_assignments a
using public.subject_assignments b
where a.section_id is not null
  and b.section_id is not null
  and a.subject_id = b.subject_id
  and a.teacher_id = b.teacher_id
  and a.section_id = b.section_id
  and a.id > b.id;

-- Remove duplicate grade-wide rows, retaining the oldest row.
delete from public.subject_assignments a
using public.subject_assignments b
where a.section_id is null
  and b.section_id is null
  and a.subject_id = b.subject_id
  and a.teacher_id = b.teacher_id
  and a.id > b.id;

create unique index if not exists subject_assignments_scoped_unique
  on public.subject_assignments(subject_id, teacher_id, section_id)
  where section_id is not null;

create unique index if not exists subject_assignments_gradewide_unique
  on public.subject_assignments(subject_id, teacher_id)
  where section_id is null;
