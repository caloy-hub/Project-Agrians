-- ============================================================
-- AGRIANS — DASIG Cloud Memory & Growth Passport
-- Student journey survives device changes and sign-ins.
-- ============================================================

create table if not exists public.dasig_journey_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null,
  title text not null,
  body text not null,
  icon text not null default '🌱',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(student_id, event_key)
);

create index if not exists dasig_journey_events_student_created_idx
  on public.dasig_journey_events(student_id, created_at desc);

alter table public.dasig_journey_events enable row level security;

create policy "dasig_memory_select_own"
  on public.dasig_journey_events for select
  to authenticated
  using (student_id = auth.uid());

create policy "dasig_memory_insert_own"
  on public.dasig_journey_events for insert
  to authenticated
  with check (student_id = auth.uid());

create policy "dasig_memory_update_own"
  on public.dasig_journey_events for update
  to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

create policy "dasig_memory_delete_own"
  on public.dasig_journey_events for delete
  to authenticated
  using (student_id = auth.uid());

grant select, insert, update, delete on public.dasig_journey_events to authenticated;

comment on table public.dasig_journey_events is
  'Cloud-backed DASIG learner milestones. This is a companion memory, not an official academic record.';
