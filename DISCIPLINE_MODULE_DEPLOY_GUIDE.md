# Discipline Module — Deployment Guide (SILAB → Agrians merge)

## What changed
- **1 new database table** in Agrians' Supabase project: `infractions` (+ a
  helper view `infraction_counts`). No changes to any existing table.
- **1 updated file**: `src/App.jsx` — adds a shared `DisciplineTab`
  component and a new "Discipline" / "Conduct" tab to all four dashboards.
- SILAB itself is untouched — this only changes Agrians. Once you're happy
  with it, SILAB can be retired.

## Step 1 — Run the migration
In your Agrians Supabase project: **SQL Editor → New query**, paste the
contents of `20260916_discipline_module_infractions.sql`, and run it.
It's additive-only (new table + new policies), so it's safe to run on your
live project — it won't touch grades, attendance, or any existing data.

## Step 2 — Replace the app file
Copy the new `App.jsx` into `src/App.jsx` in your Agrians project
(overwriting the old one), then:
```
npm run build
```
This was already build-tested in an isolated copy of your project before
being handed to you — it compiles clean with `vite build`.

Deploy as you normally do (Netlify will pick it up automatically on push,
or rebuild the Android app with `npm run android:build` if you also ship
the app version).

## Step 3 — Who sees what
| Dashboard | Tab | Behavior |
|---|---|---|
| Student | 🚨 Conduct | Read-only — sees only their own infractions |
| Teacher (Adviser) | 🚨 Discipline | Log/view infractions for their advisory section only |
| Teacher (Curriculum Head) | 🚨 Discipline | Log/view infractions across every section in their assigned grade |
| Admin | 🚨 Discipline | Log/view everything, any section |

This is enforced at the database level (Row Level Security), not just
hidden in the UI — so an adviser genuinely cannot query another section's
records even by inspecting network requests.

## Step 4 — Back-encoding Term 1 records
On the Discipline tab's logging form, there are two fields that control
this:
- **Incident Date** — set it to when the infraction actually happened.
- **Term** — pick "Term 1" instead of the default "Term 2".

Whenever the selected Term isn't the currently-active one, the record is
automatically flagged `is_backfill = true` and shows a "🕘 Backfilled"
tag in the log — so you'll always be able to tell at a glance which
records were entered live vs. caught up later. This is manual by design
(per your request) to avoid any LRN-mismatch risk from an automated
import — each adviser re-enters their own Term 1 cases for their own
section.

## Step 5 — Test before Term 2 goes live
Log in as one account of each role and confirm:
1. An adviser can log an infraction for a student in their own section,
   and it appears immediately.
2. That adviser does **not** see students from other sections in the
   student dropdown.
3. A Curriculum Head sees infractions across their whole grade level.
4. Admin sees everything school-wide.
5. A student only sees their own conduct record.
6. Try logging one Term 1 (backfill) entry and confirm the "🕘 Backfilled"
   tag shows up correctly.

## What's NOT included (by your choice)
- SILAB's Admission Slips workflow — left out for now, can be added the
  same way later.
- Bulk-importing SILAB's existing Term 1 data — intentionally manual, per
  your instruction, to avoid record mismatches.

## Bumping the term next school period
`CURRENT_DISCIPLINE_TERM` near the top of the new Discipline code in
`App.jsx` is currently set to `2`. When Term 3 begins, change that single
constant to `3` — that's the only place it's hardcoded.
