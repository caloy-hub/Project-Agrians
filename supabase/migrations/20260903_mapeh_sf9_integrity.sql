-- AGRIANS — MAPEH / SF9 integrity repair
--
-- Ensures every MAPEH parent has the two component subjects expected by the
-- current grading model. Existing legacy component rows are linked first so
-- their already-encoded grades remain visible in SF9.

do $$
declare
  p record;
  music_id uuid;
  pe_id uuid;
begin
  for p in
    select id, grade_level, section_id
    from public.subjects
    where upper(trim(name))='MAPEH' and parent_subject_id is null
  loop
    -- Prefer already-linked children.
    select id into music_id
    from public.subjects
    where parent_subject_id=p.id
      and upper(trim(name)) in ('MUSIC AND ARTS','MUSIC & ARTS','MUSIC / ARTS')
    order by created_at nulls last, id
    limit 1;

    -- If none is linked, adopt a legacy same-grade/section component instead
    -- of creating a duplicate, preserving its grades and assignments.
    if music_id is null then
      select id into music_id
      from public.subjects
      where parent_subject_id is null
        and id<>p.id
        and grade_level=p.grade_level
        and coalesce(section_id,p.section_id) is not distinct from p.section_id
        and upper(trim(name)) in ('MUSIC AND ARTS','MUSIC & ARTS','MUSIC / ARTS')
      order by created_at nulls last, id
      limit 1;
    end if;

    if music_id is null then
      insert into public.subjects(name,grade_level,section_id,parent_subject_id)
      values ('Music and Arts',p.grade_level,p.section_id,p.id)
      returning id into music_id;
    else
      update public.subjects set parent_subject_id=p.id where id=music_id;
    end if;

    select id into pe_id
    from public.subjects
    where parent_subject_id=p.id
      and upper(trim(name)) in ('PE AND HEALTH','PHYSICAL EDUCATION AND HEALTH','PE / HEALTH')
    order by created_at nulls last, id
    limit 1;

    if pe_id is null then
      select id into pe_id
      from public.subjects
      where parent_subject_id is null
        and id<>p.id
        and grade_level=p.grade_level
        and coalesce(section_id,p.section_id) is not distinct from p.section_id
        and upper(trim(name)) in ('PE AND HEALTH','PHYSICAL EDUCATION AND HEALTH','PE / HEALTH')
      order by created_at nulls last, id
      limit 1;
    end if;

    if pe_id is null then
      insert into public.subjects(name,grade_level,section_id,parent_subject_id)
      values ('PE and Health',p.grade_level,p.section_id,p.id)
      returning id into pe_id;
    else
      update public.subjects set parent_subject_id=p.id where id=pe_id;
    end if;
  end loop;
end $$;

create index if not exists idx_subjects_mapeh_parent_name
  on public.subjects(parent_subject_id, name);
