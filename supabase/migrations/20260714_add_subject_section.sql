-- Allows a subject to optionally be scoped to a single section, instead of
-- always applying to the whole grade level. Leave section_id NULL for a
-- subject taught grade-wide by one teacher (existing behavior, unchanged);
-- set it when different teachers each own one section of the same subject.

alter table public.subjects
  add column if not exists section_id uuid references public.sections(id) on delete set null;

create index if not exists subjects_section_id_idx on public.subjects (section_id);
