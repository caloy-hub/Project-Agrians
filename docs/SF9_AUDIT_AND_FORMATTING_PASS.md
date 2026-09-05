# SF9 Audit and Formatting Pass — 2026-09-03

## Confirmed from generated SF9

- MAPEH, Music and Arts, and PE and Health were blank in the supplied SF9.
- Unencoded attendance months appeared as 0 Present and full-month Absent.
- Learning-area labels were left aligned while numeric cells were centered.
- Grade and attendance table borders were lighter than the main report frame.

## Current SF9 safeguards

### MAPEH
- MAPEH is resolved from the database parent subject and its `parent_subject_id` children.
- Component names are taken from the database rather than permanently hard-coded.
- Legacy fallback retains Music and Arts / PE and Health when MAPEH child links are not yet available.
- The MAPEH parent grade is computed from valid component grades for each term.
- Component rows are resolved using their actual subject record/ID even when they themselves have a parent.

### Attendance
- `agrians_student_attendance_summary` remains the canonical source.
- Valid calendar days remain visible even if the learner's attendance is not encoded.
- Unencoded Present and Absent cells are blank, not zero/full absence.
- Encoded months enforce Present within Class Days and derive Absent as Class Days minus Present.
- Calendar mismatch months remain blank and are surfaced through `X-Encoding-Warning`.

### Formatting
- Learning-area labels are centered in their cells.
- Term 1/2/3, Final Grade, and Remarks values are centered.
- Attendance labels, month values, and totals are centered.
- Performance descriptor entries are centered.
- Outer grade and attendance table borders are strengthened.
- Long labels use centered shrink-to-fit rendering to prevent overflow.

## Hard-check findings — 2026-09-03 (second pass)

Two real defects were found in `generate-sf9/index.ts` on closer inspection and have been corrected:

1. **MAPEH was averaged to 2 decimal places, not a whole number.** The parent
   MAPEH grade for each term was computed as
   `Math.round(avg * 100) / 100` (e.g. Music and Arts 88 + PE and Health 85 →
   86.5 displayed as `86.5`). DepEd SF9 convention requires MAPEH to be a
   whole number. Fixed to `Math.round(avg)` (86.5 → `87`).

2. **Attendance month mapping was off by one for January–April**, which is
   the direct cause of the blank **Feb** column (and would also have
   affected Jan/Mar/Apr on any learner where those months' calendar
   configuration mismatches). The code converted the SF9 column label to a
   calendar month number using `i < 7 ? i + 6 : i - 5`. For the Jan–Apr
   columns (`i = 7..10`) this produced month numbers `2, 3, 4, 5`
   (Feb, Mar, Apr, May) instead of the correct `1, 2, 3, 4`
   (Jan, Feb, Mar, Apr). In effect, the "Jan" column was silently pulling
   February's attendance, the "Feb" column was pulling March's, and so on —
   so real February data was displayed under the January header, and the
   February header appeared blank whenever March's `school_calendar` entry
   didn't validate. Fixed to `i < 7 ? i + 6 : i - 6`.

   **Nov and Dec are not affected by this bug** — their month numbers (11,
   12) were already computed correctly. If Nov/Dec still render blank after
   this fix, it is a data issue, not a code issue: `agrians_student_attendance_summary()`
   deliberately throws (and SF9 shows the month blank with an
   `X-Encoding-Warning`) whenever the `school_calendar.school_days` value
   configured for that month/term doesn't match the count returned by
   `agrians_school_days()`. Check the School Calendar entries for November
   and December of the relevant term for a day-count mismatch, or run
   Admin → Forms → Attendance Audit Pass for that section/month to confirm.

## Deployment audit checklist

1. Apply migrations in Supabase.
2. Deploy `generate-sf9`.
3. Generate SF9 for a learner with MAPEH component grades.
4. Verify Music and Arts, PE and Health, and MAPEH appear.
5. Verify all table text is centered and borders are uniform.
6. Verify an unencoded month has blank Present/Absent cells.
7. Verify an encoded month shows actual Present/Absent values.
8. Compare SF9 attendance with SF2, SF4, and Student Dashboard.
9. Run Admin → Forms → Attendance Audit Pass before mass generation.
