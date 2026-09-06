-- ============================================================
-- AGRIANS — SHS per-term subjects + ALS curriculum support
-- ============================================================
-- Problem #1: JHS has one fixed subject list that applies to all 3 terms,
-- and the `subjects` table has always assumed that ("a subject, once
-- created, is valid for every term"). SHS breaks that assumption — its
-- subject roster genuinely changes per term. With no way to say "this
-- subject only runs in Term 2", teachers accumulate every subject they've
-- ever been assigned in one perpetual list with no way to tell which is
-- current, and nothing stops a grade being encoded under a subject for a
-- term it was never meant to run in.
--
-- Fix: add a nullable `term` column. NULL keeps today's behavior exactly
-- (applies to all 3 terms) — every existing JHS/TVE/SHS subject is
-- unaffected. Only newly-tagged SHS subjects become term-specific.
--
-- Problem #2: ALS (Grades 11-12) uses the same SF9 template as regular SHS
-- but draws from an entirely different ("old curriculum") subject list.
-- It is not safely distinguishable from regular SHS by grade_level, TVE
-- qualification, or section alone, so overloading those to also mean
-- "ALS" would risk exactly the kind of silent cross-matching bug already
-- fixed twice in generate-sf9. A dedicated `curriculum` tag keeps ALS and
-- regular SHS subject pools structurally separate while sharing every
-- other part of the pipeline (report layout, term logic, grading, RLS).
-- ============================================================

alter table public.subjects
  add column if not exists term integer check (term is null or term in (1,2,3));

comment on column public.subjects.term is
  'NULL = subject applies to all 3 terms (JHS/TVE default, unchanged behavior). '
  'Set to 1, 2, or 3 for an SHS subject that only runs in that specific term.';

alter table public.subjects
  add column if not exists curriculum text not null default 'regular'
    check (curriculum in ('regular','als'));

alter table public.profiles
  add column if not exists curriculum text not null default 'regular'
    check (curriculum in ('regular','als'));

comment on column public.subjects.curriculum is
  'Which curriculum this subject belongs to. ''regular'' (default) for the '
  'standard DepEd K-12 subject list; ''als'' for Alternative Learning System '
  '(old curriculum) subjects. A student only ever sees/generates against '
  'subjects matching their own profiles.curriculum.';

comment on column public.profiles.curriculum is
  'Which curriculum track this learner is enrolled under: ''regular'' '
  '(default, standard DepEd K-12) or ''als'' (Alternative Learning System, '
  'old curriculum). Drives which subjects.curriculum pool their subjects, '
  'grade entry, and SF9 are resolved against.';

create index if not exists idx_subjects_term on public.subjects(term);
create index if not exists idx_subjects_curriculum on public.subjects(curriculum);
create index if not exists idx_profiles_curriculum on public.profiles(curriculum);
