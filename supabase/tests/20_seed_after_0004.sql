-- =====================================================================
-- LOCAL TEST FILE — DO NOT RUN IN SUPABASE.
-- Run only through run_local_tests.sh against a throwaway local PostgreSQL.
-- It creates fake users, changes roles and deletes data.
-- To check your real Supabase database, use verify_0005_supabase.sql instead.
-- =====================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'supabase_auth_admin'))
     or exists (select 1 from pg_namespace where nspname in ('storage', 'realtime', 'supabase_functions')) then
    raise exception 'STOP: this is a local test file and must not run on a Supabase project. Use supabase/tests/verify_0005_supabase.sql instead.';
  end if;
end $guard$;

-- Data that exists on a live database after 0003/0004 (daily timesheets, leave, history).
-- Inserted as owner (bypasses employee-side rules) to simulate older days.
insert into public.daily_timesheets(user_id, work_date, status, submitted_at, last_submitted_at, edit_until, reviewed_by, reviewed_at, review_note)
values
 ('00000000-0000-0000-0000-0000000000e1', '2026-11-20', 'approved', '2026-11-20 12:00+00', '2026-11-20 12:00+00', '2026-11-20 12:30+00', '00000000-0000-0000-0000-0000000000c1', '2026-11-21 09:00+00', null),
 ('00000000-0000-0000-0000-0000000000e1', '2026-11-23', 'submitted', '2026-11-23 12:00+00', '2026-11-23 12:00+00', '2026-11-23 12:30+00', null, null, null),
 ('00000000-0000-0000-0000-0000000000c1', '2026-11-23', 'submitted', '2026-11-23 12:00+00', '2026-11-23 12:00+00', '2026-11-23 12:30+00', null, null, null),
 ('00000000-0000-0000-0000-0000000000e3', '2026-11-24', 'submitted', '2026-11-24 12:00+00', '2026-11-24 12:00+00', '2026-11-24 12:30+00', null, null, null);

insert into public.time_entries(user_id, work_date, project_id, task, description, start_time, end_time, break_min, status) values
 ('00000000-0000-0000-0000-0000000000e1','2026-11-20','10000000-0000-0000-0000-000000000001','Build','Header','09:00','17:00',60,'approved'),
 ('00000000-0000-0000-0000-0000000000e1','2026-11-23','10000000-0000-0000-0000-000000000001','Build','Footer','09:00','13:00',0,'submitted'),
 ('00000000-0000-0000-0000-0000000000c1','2026-11-23','10000000-0000-0000-0000-000000000002','Plan','Roadmap','09:00','12:00',0,'submitted'),
 ('00000000-0000-0000-0000-0000000000e3','2026-11-24','10000000-0000-0000-0000-000000000003','Docs','Write docs','09:00','11:00',0,'submitted');

insert into public.timesheet_reviews(user_id, week_start, work_date, actor_id, action, note) values
 ('00000000-0000-0000-0000-0000000000e1','2026-11-16','2026-11-20','00000000-0000-0000-0000-0000000000e1','Submitted',''),
 ('00000000-0000-0000-0000-0000000000e1','2026-11-16','2026-11-20','00000000-0000-0000-0000-0000000000c1','Approved','');

-- legacy leave: one pending from an employee, one pending from a manager (old routing: manager's line manager)
insert into public.leave_requests(id, user_id, type, start_date, end_date, reason, status) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','annual','2026-12-14','2026-12-15','Family','pending'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000c1','annual','2026-12-16','2026-12-16','Errand','pending'),
 ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000e3','casual','2026-12-17','2026-12-17','Personal','pending');
