# DASIG Agrian — Journey Memory

The student portal now treats DASIG as a continuing school companion instead of a static mascot.

## What is remembered

Milestones are stored per student on the device using browser `localStorage`:

- Journey started
- Almost Honor (88–89.99)
- Honor Agrian (90+)
- Attendance Hero (95%+)
- Term growth milestones
- Current “Growing Agrian” state

The UI shows a five-stage journey:

`Seedling → Growing → Rising Star → Almost Honor → Honor Agrian`

The latest milestones appear as a small timeline with dates.

## Why local storage for this phase

This avoids introducing another database table while preserving the existing Supabase schema. It also keeps the feature fast and available even when the student portal is temporarily offline.

For a future multi-device implementation, the same event model can be moved to Supabase (for example, a `student_achievement_events` table) and synchronized with the learner account.

## Academic trigger

DASIG uses the latest available term average for the live companion state. The existing attendance engine remains the source for attendance-related celebrations and does not create a second attendance calculation.
