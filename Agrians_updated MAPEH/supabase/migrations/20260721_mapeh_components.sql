-- MAPEH is graded through two components — "PE and Health" and
-- "Music and Arts" — each encoded independently by its own teacher.
-- The MAPEH subject itself is never graded directly; its grade is always
-- the average of whichever component(s) have a grade for a given term.
--
-- This is modeled by letting a subject point at a "parent" subject.
-- A subject with children (parent_subject_id points to it) is treated
-- everywhere in the app as a computed/virtual subject: it never has its
-- own rows in `grades`, and the app always derives its grade from its
-- components instead.

alter table subjects
  add column if not exists parent_subject_id uuid references subjects(id) on delete cascade;

create index if not exists idx_subjects_parent_subject_id on subjects(parent_subject_id);
