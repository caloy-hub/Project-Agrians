# DASIG Companion v3 — Cloud Memory & Growth Passport

## What changed

The previous DASIG journey stored milestone history only in browser `localStorage`. This enhancement adds an account-backed Supabase table so the learner's DASIG history can follow the learner across devices.

### Student experience
- **Cloud-backed milestone history** with a local offline fallback.
- **Growth Passport** summary showing milestone count and best recorded average.
- Existing journey stages remain: Seedling → Growing → Rising Star → Almost Honor → Honor Agrian.
- DASIG explicitly distinguishes companion memory from official academic records.
- Realtime subscription is prepared for changes to the learner's DASIG memory.

### Data design
`public.dasig_journey_events`
- `student_id` — learner profile ID
- `event_key` — unique milestone key per learner
- `title`, `body`, `icon` — presentation content
- `metadata` — numeric/context data used by the companion
- `created_at` — milestone timestamp

RLS allows a signed-in learner to access only rows where `student_id = auth.uid()`.

## Deployment
1. Apply `supabase/migrations/20260902_dasig_cloud_memory.sql` to the Supabase project.
2. Deploy the frontend as usual.
3. If an existing learner has local DASIG milestones, the app continues to display them immediately and attempts to persist new milestones to the cloud.

## Important
This table is **not** an official grade/attendance record. It is a learner-engagement layer. Official academic calculations remain governed by the existing grades, calendar, daily attendance, SF2 and SF4 data model.

## Build verification
A production build could not be executed in this environment because `node_modules` is not installed locally (`vite: not found`). The source and migration were updated, but a successful production build should be run in the normal development/CI environment before deployment.
