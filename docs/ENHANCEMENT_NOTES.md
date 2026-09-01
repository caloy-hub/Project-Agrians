# DASIG Agrian + One Calculation Source

## What was enhanced
- Added an animated **DASIG, Agrian!** learner companion to the student dashboard.
- Mascot states react to the learner's computed average/trend:
  - Welcome / waiting for you
  - Keep Going
  - You're Growing
  - Almost There
  - Congratulations, Honor Agrian
- Attendance percentage is shown from the same attendance calculation used by the learner dashboard.
- Added a central `attendanceEngine` in `src/App.jsx` so Calendar → Daily Attendance → learner attendance summaries share one calculation path.
- Calendar messaging now explicitly identifies the calendar/date grid as the source of truth and warns when configured school-day counts disagree with actual school dates.
- Added the mascot design reference under `docs/dasig-agrian-mascot-design.png`.

## Important architecture note
The Supabase Edge Functions for SF2/SF4 still perform their own server-side validation/calculation for security and PDF generation. They should be treated as the server-side enforcement layer, while the frontend `attendanceEngine` is the learner-facing calculation source. For a future hardening pass, the same logic can be moved into a Postgres RPC/view so the database becomes the final source for both UI and reports.
