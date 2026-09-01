# DASIG Companion + Attendance Architecture

## Student experience

The student account now opens with **DASIG, Agrian!**, an animated school companion. The companion:

- changes its message based on the learner's latest available term average;
- celebrates the 90+ honor benchmark;
- identifies learners who are within the 88–89.99 "Almost Honor" range;
- recognizes 95%+ attendance as an Attendance Hero milestone;
- notices improvement from the previous recorded term;
- shows a daily deterministic motivational quote;
- shows a birthday greeting when the profile birthday matches the current date;
- provides a **Cheer Me Up** action and a dedicated **DASIG Corner**;
- includes a visual next-harvest progress indicator toward the 90 benchmark;
- respects `prefers-reduced-motion` for accessibility.

The DASIG Corner contains growth badges, the next-harvest goal, motivational quote tiles, and an explanation of the attendance data flow.

## Attendance source of truth

The existing frontend `attendanceEngine` remains the immediate UI calculation source for the Calendar → Daily Attendance → SF2 → SF4 → Student Attendance flow.

A new Supabase migration, `20260901_attendance_source_of_truth.sql`, adds database RPCs for the same canonical rules:

- `agrians_school_days(month, year, term)` — calculates school dates from term boundaries, weekdays, and registered non-school days.
- `agrians_attendance_grid(section_id, month, year, term)` — returns the section's canonical daily attendance grid; missing rows follow the existing present-by-default convention.
- `agrians_student_attendance_summary(student_id, month, year, term)` — returns the canonical learner monthly totals and percentage.

These RPCs are intended to be the backend source consumed by the student UI and the SF2/SF4 Edge Functions as the project is deployed. They also enforce the configured school-calendar count against the date-based school-day calculation so an inconsistent calendar cannot silently generate conflicting figures.

## Deployment note

Apply the new SQL migration in Supabase before relying on the new RPC layer. The local build could not be executed in this environment because the project's npm dependencies were not available locally and network installation timed out; no dependency files were changed.
