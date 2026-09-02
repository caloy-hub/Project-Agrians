# AGRIANS Teacher Monitoring Enhancements

## 1. Grade encoding roster order
Grade encoding and review rosters use a deterministic order:
1. Male learners
2. Female learners
3. Unspecified/other gender values

Within each group, learners are alphabetized by their encoded surname-first display name, matching the sequence teachers see in their records. Stored names are not changed.

## 2. Subject teacher grade review
Every subject teacher now has **Review** in the teacher navigation. The review workspace is read-only and follows the same `subject_assignments` scope used by encoding. Teachers can select:
- subject
- section
- Term 1, Term 2, or Term 3

The review shows encoded count, average, passing count, missing entries, and male/female learner groups.

## 3. Teaching analytics
Every teacher has **Analytics**. The scope adapts to the role:
- Subject teacher: assigned subjects and assigned sections/grade-wide assignments
- Adviser: advisory section across its grade subjects
- Curriculum Head: all learners and subjects in the assigned grade level

Analytics include:
- learners in scope
- grade encoding completion
- overall average
- learners below 75
- grade distribution (90+, 85–89, 80–84, 75–79, <75)
- missing grade entries
- subject/assignment average and passing rate
- learner-specific subject gaps
- recommended monitoring actions

The feature is intentionally read-only and does not change grades or official DepEd forms.
