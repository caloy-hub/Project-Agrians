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
