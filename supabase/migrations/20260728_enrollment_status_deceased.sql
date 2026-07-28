-- The official SF4 (Monthly Learner's Movement and Attendance) has a
-- Mortality (Death) figure separate from Transferred Out / NLPA. Add
-- "Deceased" as a valid enrollment_status so it can be tracked the same
-- way transfers and dropouts already are (status + status_date).

alter table profiles drop constraint if exists profiles_enrollment_status_check;

alter table profiles
  add constraint profiles_enrollment_status_check
  check (enrollment_status in ('Active','Transferred In','Transferred Out','Dropped Out','Deceased'));
