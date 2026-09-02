# AGRIANS v27 — School Statistics + Teacher Field Buddy

## Admin academic observatory

The Admin dashboard now has a **Statistics** tab that consolidates grade data from all teacher subject assignments.

### Included
- School-wide GSA by selected term
- GSA by grade level
- Subject-level GSA/mean, median, standard deviation and pass rate
- Teacher-to-subject performance view
- Proficiency counts using:
  - Advanced: 90–100
  - Proficient: 85–89
  - Approaching Proficiency: 80–84
  - Developing: 75–79
  - Beginning: below 75
- 95% confidence interval for the observed school GSA
- Coefficient of variation
- Filter by term, grade, teacher and subject
- CSV export of the subject/proficiency table
- MAPEH parent subjects are resolved from their components and are not double-counted.

The statistics are computed from the existing `profiles`, `subjects`, `subject_assignments`, and `grades` data, so no additional grade-entry workflow is required.

## Teacher Field Buddy

A floating companion named **Muni** appears on teacher dashboards. Muni is a small field-guide bird character designed to complement, rather than replace, DASIG Agrian.

Muni checks:
- Adviser attendance still needing attention today
- Missing grade entries within the teacher's current subject scope for the active term
- Parent/teacher appointments scheduled for today
- A daily encouragement message

The action button opens the relevant teacher dashboard tab. Muni is purely a reminder layer and does not alter official records.
