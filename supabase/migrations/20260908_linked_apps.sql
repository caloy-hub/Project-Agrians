-- ============================================================
-- AGRIANS — Linked Apps directory (student "Apps" tab)
-- ============================================================
-- Lets an admin maintain a growing list of external apps/links (e.g. an
-- LMS, a library portal, a school-built webapp) that students can open
-- directly from a new "Apps" tab in their own account, without needing a
-- code change or redeploy every time a link is added, changed, or removed.
--
-- Scope for this first version (per product decision): visible to every
-- student equally (no per-grade/per-section targeting), always opens in a
-- new browser tab (not embedded) — both are easy to extend later with an
-- additive column if that need comes up, without touching this table's
-- existing rows.
-- ============================================================

create table if not exists public.linked_apps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  icon text not null default '🔗',
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.linked_apps is
  'Admin-managed directory of external app links surfaced to students via '
  'the "Apps" tab. is_active=false hides an app without deleting it (and '
  'without losing its position/settings). sort_order controls display order '
  '(ascending, ties broken by name).';

create index if not exists idx_linked_apps_active_sort
  on public.linked_apps(is_active, sort_order);

-- Browser access follows the existing application's role model: any
-- authenticated user (student, teacher, admin) may read the directory;
-- only admins may create, edit, reorder, or delete entries.
alter table public.linked_apps enable row level security;

drop policy if exists "linked_apps_select_authenticated" on public.linked_apps;
create policy "linked_apps_select_authenticated"
on public.linked_apps for select to authenticated
using (true);

drop policy if exists "linked_apps_admin_insert" on public.linked_apps;
create policy "linked_apps_admin_insert"
on public.linked_apps for insert to authenticated
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

drop policy if exists "linked_apps_admin_update" on public.linked_apps;
create policy "linked_apps_admin_update"
on public.linked_apps for update to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

drop policy if exists "linked_apps_admin_delete" on public.linked_apps;
create policy "linked_apps_admin_delete"
on public.linked_apps for delete to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
