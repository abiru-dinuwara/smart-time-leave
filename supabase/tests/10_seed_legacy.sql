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

-- Legacy data created BEFORE migration 0005, to prove 0005 preserves it.
-- Runs as the database owner (auth.uid() is null -> employee-side triggers are skipped).
insert into auth.users(id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@co.test','{"full_name":"Ada Admin"}'),
 ('00000000-0000-0000-0000-0000000000a1','hr1@co.test','{"full_name":"Hana HR"}'),
 ('00000000-0000-0000-0000-0000000000a2','hr2@co.test','{"full_name":"Hugo HR"}'),
 ('00000000-0000-0000-0000-0000000000b1','lead@co.test','{"full_name":"Lena Leader"}'),
 ('00000000-0000-0000-0000-0000000000c1','mgr@co.test','{"full_name":"Mona Manager"}'),
 ('00000000-0000-0000-0000-0000000000c2','mgr2@co.test','{"full_name":"Max Manager"}'),
 ('00000000-0000-0000-0000-0000000000d1','pm@co.test','{"full_name":"Pia PM"}'),
 ('00000000-0000-0000-0000-0000000000d2','pm2@co.test','{"full_name":"Pete PM"}'),
 ('00000000-0000-0000-0000-0000000000e1','emp1@co.test','{"full_name":"Eve Employee"}'),
 ('00000000-0000-0000-0000-0000000000e2','emp2@co.test','{"full_name":"Ed Employee"}'),
 ('00000000-0000-0000-0000-0000000000e3','emp3@co.test','{"full_name":"Orphan Employee"}'),
 ('00000000-0000-0000-0000-0000000000e4','emp4@co.test','{"full_name":"Ina Inactive"}');

update public.profiles set role='hr' where email like 'hr%';
update public.profiles set role='leadership' where email='lead@co.test';
update public.profiles set role='manager' where email like 'mgr%';
update public.profiles set role='pm' where email like 'pm%';
update public.profiles set department='Engineering' where email in ('emp1@co.test','emp2@co.test','mgr@co.test','pm@co.test');
update public.profiles set department='People' where email like 'hr%';
-- reporting lines
update public.profiles set manager_id='00000000-0000-0000-0000-0000000000c1' where email in ('emp1@co.test','emp2@co.test','emp4@co.test');
update public.profiles set manager_id='00000000-0000-0000-0000-0000000000b1' where email in ('mgr@co.test','mgr2@co.test','pm@co.test');
update public.profiles set manager_id='00000000-0000-0000-0000-0000000000c1' where email = 'pm2@co.test';  -- PM reporting to a manager
update public.profiles set active=false where email='emp4@co.test';
update public.org_settings set timezone='Asia/Colombo';

insert into public.projects(id, code, name, pm_id, planned_hours) values
 ('10000000-0000-0000-0000-000000000001','WEB','Website','00000000-0000-0000-0000-0000000000d1',100),
 ('10000000-0000-0000-0000-000000000002','APP','Mobile app','00000000-0000-0000-0000-0000000000d2',200),
 ('10000000-0000-0000-0000-000000000003','OLD','Old project','00000000-0000-0000-0000-0000000000d1',10);
