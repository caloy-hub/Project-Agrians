# AGRIANS Attendance Audit Pass

## Canonical flow

**School Calendar → canonical school-day RPC → Daily Attendance → canonical learner/section summaries → SF2 / SF4 / SF9 / Student Dashboard**

The database functions are now the shared calculation layer. The frontend keeps its local calculation helper only as a compatibility fallback for deployments that have not yet applied the latest migration.

## Checks added

The `agrians_attendance_audit(section_id, month, year, term)` RPC checks:

- configured school-day count vs the actual canonical date grid;
- number of learners in the section;
- number of learners with encoded attendance;
- raw attendance rows inside the canonical grid;
- attendance rows inside the calendar span but outside the canonical grid (weekends/holidays/non-school dates);
- duplicate student/date rows;
- impossible derived totals (present > school days, absent > school days, negative totals, or percentages outside 0–100).

The admin **Forms → Attendance Audit Pass** panel exposes these checks before report generation.

## Report reconciliation

### SF2
Uses `agrians_school_days()` for the date columns and `agrians_attendance_grid()` for every learner/day status. A raw-row lookup is used only to determine whether the section has actually been encoded; it does not calculate totals.

### SF4
Uses `agrians_school_days()` for the denominator and `agrians_section_attendance_summary()` for learner attendance totals. Section/grade/grand totals are derived from those canonical learner results.

### SF9
Uses `agrians_student_attendance_summary()` for monthly attendance. September combines the Term 1 and Term 2 canonical summaries because the official SF9 monthly row spans September 1–30.

### Student Dashboard
Uses `agrians_student_attendance_summary()` for monthly values and derives term totals by summing the canonical monthly summaries. The legacy `attendance` table is not used for the dashboard.

## Expected invariants

For every encoded learner-month:

`0 ≤ Present ≤ School Days`

`Absent = School Days − Present`

`0 ≤ Attendance % ≤ 100`

No report should generate when the configured calendar count conflicts with the canonical date grid.

## Deployment

1. Apply `supabase/migrations/20260902_attendance_audit_pass.sql` in Supabase.
2. Deploy the updated Edge Functions (`generate-sf2`, `generate-sf4`, `generate-sf9`).
3. Deploy the updated frontend.
4. In Admin → Forms, select a section/month and run **Attendance Audit Pass**.
5. Generate SF2/SF4 and compare the displayed totals with the Student Dashboard for a test learner.

## Notes

The adviser UI still uses the present-by-default convention for unmarked cells. Saving the grid writes the full student × school-day matrix, so subsequent reports use a deterministic daily grid.
