# AGRIANS v26

Version 26 includes synchronized School Calendar → SF2/SF4 school-day validation, improved SF2 pagination for large sections, and a DepEd-style SF4 Monthly Learner’s Movement and Attendance generator for JHS/SHS.

**School Year:** 2026–2027
**School:** Maria Cristina P. Belcar Agricultural High School
**School ID:** 304342

### DepEd reference basis
- SF2 Daily Attendance Report: DepEd standardized SF2 guidance, including school-day/attendance computations.
- SF4 Monthly Learner’s Movement and Attendance: DepEd standardized SF4 structure, with M/F/T groupings and movement categories.

The app is an internal school automation tool. Official LIS-generated school forms remain the authoritative submission source where required by DepEd.

## DASIG Agrian Companion + Attendance Source of Truth (September 2026)

The student account now includes the animated **DASIG, Agrian!** companion and a dedicated **DASIG Corner**. The companion responds to the learner's latest available term performance, attendance, improvement, honor readiness, and birthday.

For the attendance architecture, apply `supabase/migrations/20260901_attendance_source_of_truth.sql` in Supabase. It adds canonical school-day, attendance-grid, and learner-summary RPCs intended to keep Calendar, Daily Attendance, SF2, SF4, and the student attendance view mathematically aligned.

## Attendance integrity fix — September 2, 2026
- Student monthly attendance now counts only daily attendance dates belonging to that exact month/term.
- The calendar-generated school-day date grid is the denominator; configured school-day counts are validation values and cannot create impossible percentages.
- Legacy monthly attendance totals are repaired by `supabase/migrations/20260902_attendance_integrity_fix.sql` and are no longer written by the adviser attendance encoder.
- The PWA service worker cache was bumped to v27 and changed to network-first for HTML/JS/CSS so an old attendance calculation cannot remain silently cached after deployment.
