-- ============================================================
-- AGRIANS — SHS subject track scoping (Academic / TechPro / TVL-AFA / TVL-HE)
-- ============================================================
-- Problem: a Grade 11/12 section can hold students on different tracks
-- (Academic vs TechPro in Grade 11; TVL-AFA vs TVL-HE in Grade 12) sharing
-- the same section/grade_level. Subjects had no way to say "this is
-- Academic-only" or "this is TechPro-only" — every subject created for a
-- grade level was visible to every student in it regardless of track, so
-- an Academic student's SF9 picked up TechPro-only subjects and vice
-- versa. Same problem for both the regular and ALS curriculum.
--
-- Fix: a nullable `shs_track` column, following the exact same "None =
-- applies to everyone" pattern already used for subjects.tve_qualification.
-- NULL means the subject is visible to every track in that grade (today's
-- behavior, unchanged for every subject that isn't track-specific).
-- ============================================================

alter table public.subjects
  add column if not exists shs_track text;

comment on column public.subjects.shs_track is
  'NULL (default) = subject applies to every SHS track in this grade level, '
  'unchanged from prior behavior. Set to a track tag ("Academic", "TechPro", '
  '"TVL-AFA", "TVL-HE") to scope a subject to only that track. A student is '
  'matched by their own profiles.shs_track starting with this tag '
  '(case-insensitive) — so a subject tagged "TechPro" still matches a '
  'student whose stored track is "TechPro - Bakery Operations".';

create index if not exists idx_subjects_shs_track on public.subjects(shs_track);
