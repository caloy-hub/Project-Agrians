-- Senior High School's SF9 subject list is built dynamically from the
-- `subjects` table (see generate-sf9), ordered by when each subject was
-- created — so subjects added for Term 1 appear first, and subjects added
-- later for Term 2 simply get appended the next time SF9 is generated.
-- This requires a stable creation timestamp on every subject row.

alter table subjects
  add column if not exists created_at timestamptz not null default now();
