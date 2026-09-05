# AGRIANS v31 — Critical & High Issue Fixes

Fixes issues #1–#6 from `AGRIANS_v31_System_Audit.md`. Each change is scoped to exactly the bug described; no unrelated refactors. Verified with `esbuild` (frontend bundle — no syntax/reference errors) and `tsc` (edge functions — no new type errors; remaining warnings are pre-existing implicit-`any` noise unrelated to these edits). A real `npm run build` could not be run in this sandbox (missing native `@rolldown` binding for this environment, unrelated to the code changes) — please run it once in your normal dev/CI environment before deploying.

## Files changed
- `src/App.jsx`
- `supabase/functions/generate-sf2/index.ts`
- `supabase/functions/generate-sf4/index.ts`
- `supabase/migrations/20260905_attendance_summary_and_term_bounds_fix.sql` (**new**)

## What was fixed

### 🔴 #1 — SF9 attendance was always blank (service-role auth regression)
**New migration `20260905_...sql`** redefines `agrians_student_attendance_summary()` as the single, final, authoritative version — with the `auth.uid() is not null` bypass restored so Edge Functions calling it via the service-role key (`generate-sf9`) are no longer rejected. A code comment now warns against removing this guard again in any future redefinition.

### 🔴 #2 — MAPEH grade shown as a decimal in-app, whole number on SF9
`src/App.jsx`, `gradeForTerm()`: MAPEH's per-term average now rounds to a whole number (`Math.round(sum/count)`), matching `generate-sf9/index.ts`'s existing behavior. The Student Dashboard, Teacher Review, Admin Statistics, and the SF9 PDF will now always agree.

### 🔴 #3 — SF2/SF4 mishandled learners without Male/Female gender
- `generate-sf2/index.ts`: learners with any gender value other than exactly `"Male"`/`"Female"` are now included in the roster/grid under an "OTHER" group instead of being silently dropped. The monthly enrolment summary line adds an Other figure when needed so Male+Female+Other = Total.
- `generate-sf4/index.ts`: the official SF4 template has no third gender column, so these learners still can't be broken out per-column — instead the PDF now includes them in Total as before **and** the response carries a new `X-Gender-Data-Warning` header explaining that Total may exceed Male+Female and that the underlying profile data should be corrected. `src/App.jsx`'s `downloadPdf` helper (and the teacher-facing SF2 download, which previously didn't surface *any* warning) now display this alongside the existing `X-Encoding-Warning`.

### 🟠 #4 — DASIG companion header and achievement badges could contradict each other
`src/App.jsx`, `buildDasigAchievements()`: now takes one resolved `statusAverage` (the same `termAverage ?? average` value that drives the companion's headline) instead of separately checking cumulative `average` for "Honor" and `termAverage` for "Almost Honor." Both call sites (`AgrianCompanion`, DASIG Corner) were updated to pass the same resolved value. The headline and the badge list can no longer disagree.

### 🟠 #5 — Hardcoded SY 2026–2027 school-day boundaries
- **Backend (canonical/authoritative path — used by SF2, SF4, SF9, and the dashboard's primary data path):** new `school_term_day_bounds` table replaces the hardcoded `case when p_year=2026 ...` literals inside `agrians_school_days()`. Today's SY 2026–2027 values are seeded as data so behavior is unchanged now; an admin adds a row for each future school year instead of requiring a code change. RLS: any authenticated user can read it, only admins can write.
- **Frontend local fallback (`TERM_MONTHS` in `App.jsx`, used only when the canonical RPC is unreachable):** left as-is but given a prominent comment flagging it as SY-2026-2027-specific and requiring a manual update for SY 2027–2028. Fully wiring this offline fallback to the same database table would require threading a new parameter through every screen that calls `attendanceEngine`/`schoolDaysInMonth` (dozens of call sites across the 5,000-line file) — a larger, separate change best done with a real build/test cycle rather than inside this fix pass, since this sandbox cannot run the app to verify it. The bug's actual data-integrity risk (wrong numbers on official reports) is fully closed by the backend fix, since that's what SF2/SF4/SF9 and the dashboard actually rely on.

### 🟠 #6 — Section vs. student attendance percentage rounding mismatch
Same new migration: `agrians_section_attendance_summary()` now rounds `attendance_pct` to a whole number (was 2 decimal places), matching `agrians_student_attendance_summary()`. SF2/SF4 and the Student Dashboard/SF9 will no longer show slightly different percentages for the same learner-month purely due to rounding.

## Deployment steps
1. Apply the new migration in Supabase: `supabase/migrations/20260905_attendance_summary_and_term_bounds_fix.sql`.
2. Redeploy the two updated Edge Functions: `generate-sf2`, `generate-sf4`. (`generate-sf9` needs no code change — it already calls the RPC correctly; it was the RPC itself that was broken.)
3. Deploy the updated frontend (`npm run build` in your normal environment, then publish `dist/`).
4. Regression-check: generate an SF9 for a learner with fully encoded attendance and confirm months now show real Present/Absent instead of blank. Generate an SF2/SF4 for a section with a learner whose gender is not set to Male/Female and confirm they appear (SF2) / the new warning appears (SF4). Check a learner with MAPEH grades on both the Student Dashboard and their SF9 and confirm the same whole-number value appears in both.

## Not yet addressed (from the original audit — lower severity, tracked for follow-up)
- #7 `profiles` RLS not in version control
- #8 dead duplicate-row check in `agrians_attendance_audit`
- #9 LRN uniqueness race condition in `create-user`
- #10 shared generic student password (design trade-off, not a bug)
- #12 subject_assignments duplicate-cleanup migration worth confirming is a one-time fix
