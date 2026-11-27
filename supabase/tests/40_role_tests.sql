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

-- Role permission + regression tests for migration 0005.
-- Each block: reset role -> login as user -> set role authenticated -> assertions.
\set ADMIN '00000000-0000-0000-0000-00000000000a'
\set HR1   '00000000-0000-0000-0000-0000000000a1'
\set HR2   '00000000-0000-0000-0000-0000000000a2'
\set LEAD  '00000000-0000-0000-0000-0000000000b1'
\set MGR   '00000000-0000-0000-0000-0000000000c1'
\set MGR2  '00000000-0000-0000-0000-0000000000c2'
\set PM    '00000000-0000-0000-0000-0000000000d1'
\set PM2   '00000000-0000-0000-0000-0000000000d2'
\set E1    '00000000-0000-0000-0000-0000000000e1'
\set E2    '00000000-0000-0000-0000-0000000000e2'
\set E3    '00000000-0000-0000-0000-0000000000e3'
\set E4    '00000000-0000-0000-0000-0000000000e4'
\set WEB   '10000000-0000-0000-0000-000000000001'
\set APP   '10000000-0000-0000-0000-000000000002'
\set OLD   '10000000-0000-0000-0000-000000000003'

create or replace function test.nmon(k int) returns date language sql stable as $$
  select public.org_today() + (8 - extract(isodow from public.org_today())::int) + 7 * k
$$;
grant execute on function test.nmon(int) to authenticated;
\o /dev/null
truncate test.results;
delete from public.notifications;   -- start clean so notification routing can be asserted

-- ===================================================================== EMPLOYEE
reset role; select test.login(:'E1'); set role authenticated;
select test.noerr('E1 submits leave (goes to line manager)',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'annual',test.nmon(1),test.nmon(1)+1,'Holiday','pending')$$);
select test.err('E1 cannot set approval_route from the client',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status,approval_route)
    values (auth.uid(),'casual',test.nmon(5),test.nmon(5),'x','pending','hr')$$, 'permission denied');
select test.err('E1 cannot start leave in the past',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'casual',public.org_today()-3,public.org_today()-3,'x','pending')$$, 'past');
select test.err('E1 last day before first day refused',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'casual',test.nmon(3)+2,test.nmon(3),'x','pending')$$, 'last day|end_date');
select test.err('E1 reason is mandatory',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'casual',test.nmon(3),test.nmon(3),'  ','pending')$$, 'reason');
select test.err('E1 balance check still works',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'compassionate',test.nmon(6),test.nmon(6)+4,'x','pending')$$, 'not enough');
select test.noerr('E1 logs time today on assigned project WEB',
  $$insert into public.time_entries(user_id,work_date,project_id,task,description,start_time,end_time,break_min)
    values (auth.uid(),public.org_today(),'10000000-0000-0000-0000-000000000001','Build','Login page','09:00','12:00',15)$$);
select test.err('E1 cannot log time on unassigned project APP',
  $$insert into public.time_entries(user_id,work_date,project_id,task,description,start_time,end_time,break_min)
    values (auth.uid(),public.org_today(),'10000000-0000-0000-0000-000000000002','Build','x','13:00','14:00',0)$$, 'not assigned');
select test.err('E1 cannot log time for a past date',
  $$insert into public.time_entries(user_id,work_date,project_id,task,description,start_time,end_time,break_min)
    values (auth.uid(),public.org_today()-1,'10000000-0000-0000-0000-000000000001','Build','x','13:00','14:00',0)$$, 'only be logged for today|not allowed|row-level');
select test.ok('E1 only sees assigned projects in timesheet picker',
  (select array_agg(code order by code) from public.my_loggable_projects()) = array['WEB']);
select test.noerr('E1 submits today''s timesheet', $$select public.submit_timesheet_day(null)$$);
select test.err('E1 cannot submit the same day twice', $$select public.submit_timesheet_day(null)$$, 'already been submitted');
select test.ok('E1 timesheet routed to line manager',
  (select approval_route from public.daily_timesheets where user_id = auth.uid() and work_date = public.org_today()) = 'manager');
select test.err('E1 cannot decide own leave',
  $$select public.decide_leave((select id from public.leave_requests where user_id=auth.uid() and status='pending' limit 1),'approved','')$$, 'own');
select test.err('E1 cannot approve a colleague (not their manager)',
  $$select public.decide_timesheet_day('00000000-0000-0000-0000-0000000000c1','2026-11-23','approved','')$$, 'HR|line manager|not allowed');
select test.ok('E1 approval history (others) is empty', (select count(*) from public.approval_records()) = 0);
select test.err('E1 cannot call org_overview', $$select public.org_overview(current_date, current_date)$$, 'not allowed');
select test.err('E1 cannot insert project membership directly',
  $$insert into public.project_members(project_id, employee_id) values ('10000000-0000-0000-0000-000000000002', auth.uid())$$, 'permission denied');
select test.err('E1 cannot assign self via RPC',
  $$select public.assign_project_member('10000000-0000-0000-0000-000000000002', auth.uid())$$, 'projects you manage');
select test.err('E1 cannot write leave history',
  $$insert into public.leave_history(leave_id, action) values ((select id from public.leave_requests where user_id=auth.uid() limit 1), 'Approved')$$, 'permission denied');
select test.err('E1 cannot change timesheet review history',
  $$update public.timesheet_reviews set note='x' where user_id = auth.uid()$$, 'permission denied');

-- notifications for E1's requests went to the line manager only
reset role;
select test.ok('E1 leave notified line manager',
  exists (select 1 from public.notifications where user_id = :'MGR' and text like 'Eve Employee requested%'));
select test.ok('E1 leave NOT sent to HR',
  not exists (select 1 from public.notifications where user_id in (:'HR1', :'HR2') and text like 'Eve Employee%'));
select test.ok('E1 timesheet notified line manager only',
  exists (select 1 from public.notifications where user_id = :'MGR' and text like 'Eve Employee submitted a timesheet%')
  and not exists (select 1 from public.notifications where user_id in (:'HR1', :'HR2') and text like 'Eve Employee submitted%'));

-- ===================================================================== ORPHAN EMPLOYEE (no manager)
select test.login(:'E3'); set role authenticated;
select test.err('Employee without a line manager cannot submit leave',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'annual',test.nmon(2),test.nmon(2),'x','pending')$$, 'active line manager');
select test.noerr('Employee without a line manager can still save a draft',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'annual',test.nmon(2),test.nmon(2),'x','draft')$$);
select test.noerr('Orphan logs time on OLD (back-filled membership)',
  $$insert into public.time_entries(user_id,work_date,project_id,task,description,start_time,end_time,break_min)
    values (auth.uid(),public.org_today(),'10000000-0000-0000-0000-000000000003','Docs','x','09:00','10:00',0)$$);
select test.err('Employee without a line manager cannot submit a timesheet',
  $$select public.submit_timesheet_day(null)$$, 'active line manager');
reset role;
select test.ok('No HR fallback notification for orphan',
  not exists (select 1 from public.notifications where user_id in (:'HR1', :'HR2') and text like 'Orphan%'));

-- ===================================================================== MANAGER (own requests -> HR)
select test.login(:'MGR'); set role authenticated;
select test.noerr('Manager submits own leave',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'annual',test.nmon(2),test.nmon(2)+1,'Trip','pending')$$);
select test.ok('Manager leave routed to HR',
  (select approval_route from public.leave_requests where user_id=auth.uid() and start_date=test.nmon(2)) = 'hr');
select test.noerr('Manager logs time on APP (back-filled)',
  $$insert into public.time_entries(user_id,work_date,project_id,task,description,start_time,end_time,break_min)
    values (auth.uid(),public.org_today(),'10000000-0000-0000-0000-000000000002','Plan','Sprint','09:00','11:00',0)$$);
select test.noerr('Manager submits own timesheet', $$select public.submit_timesheet_day(null)$$);
select test.err('Manager cannot decide own timesheet',
  $$select public.decide_timesheet_day(auth.uid(), public.org_today(), 'approved', '')$$, 'own');
select test.err('Manager cannot decide own leave',
  $$select public.decide_leave((select id from public.leave_requests where user_id=auth.uid() and start_date=test.nmon(2)),'approved','')$$, 'own');
select test.ok('Manager actionable queue = direct reports only (no own items)',
  not exists (select 1 from public.approval_records(p_actionable => true) where owner_id = auth.uid())
  and exists (select 1 from public.approval_records(p_actionable => true) where owner_id = '00000000-0000-0000-0000-0000000000e1'));
select test.noerr('Manager approves direct report E1 leave',
  $$select public.decide_leave((select id from public.leave_requests where user_id='00000000-0000-0000-0000-0000000000e1' and start_date=test.nmon(1)),'approved','')$$);
select test.err('Manager must give a note to reject',
  $$select public.decide_timesheet_day('00000000-0000-0000-0000-0000000000e1', public.org_today(), 'rejected', '')$$, 'note');
select test.noerr('Manager approves direct report E1 timesheet',
  $$select public.decide_timesheet_day('00000000-0000-0000-0000-0000000000e1', public.org_today(), 'approved', 'Good')$$);
select test.ok('Manager approval_counts reflects remaining work',
  (select leave_pending from public.approval_counts()) = 1   -- legacy E1 Dec request
  and (select timesheet_pending from public.approval_counts()) = 1);  -- legacy E1 23 Nov
reset role;
select test.ok('Manager leave notified HR (both HR users)',
  (select count(distinct user_id) from public.notifications where user_id in (:'HR1', :'HR2') and text like 'Mona Manager (Manager) requested%') = 2);
select test.ok('Manager leave NOT sent to her own line manager (Leadership)',
  not exists (select 1 from public.notifications where user_id = :'LEAD' and text like 'Mona Manager%'));
select test.ok('Decision history row recorded (from/to, approver, role, owner)',
  exists (select 1 from public.leave_history h join public.leave_requests l on l.id = h.leave_id
          where l.user_id = :'E1' and h.action = 'Approved' and h.from_status = 'pending' and h.to_status = 'approved'
            and h.actor_id = :'MGR' and h.actor_role = 'manager' and h.owner_id = :'E1'));
select test.ok('Timesheet decision history recorded',
  exists (select 1 from public.timesheet_reviews r where r.user_id = :'E1' and r.work_date = public.org_today()
          and r.action = 'Approved' and r.from_status = 'submitted' and r.to_status = 'approved' and r.timesheet_id is not null
          and r.actor_role = 'manager' and r.note = 'Good'));
select test.ok('Employee notified of approval',
  exists (select 1 from public.notifications where user_id = :'E1' and text like 'Mona Manager approved your annual leave%'));
select test.ok('Audit log written for decision', exists (select 1 from public.audit_logs where action = 'Leave approved'));

-- ===================================================================== LEADERSHIP (line manager of Mona)
select test.login(:'LEAD'); set role authenticated;
select test.err('Leadership (Mona''s line manager) cannot decide Mona''s leave',
  $$select public.decide_leave((select id from public.leave_requests where user_id='00000000-0000-0000-0000-0000000000c1' and start_date=test.nmon(2)),'approved','')$$, 'decided by HR');
select test.err('Leadership cannot decide Mona''s timesheet',
  $$select public.decide_timesheet_day('00000000-0000-0000-0000-0000000000c1', public.org_today(), 'approved', '')$$, 'reviewed by HR');
select test.ok('Leadership sees direct reports'' history read-only',
  exists (select 1 from public.approval_records() where owner_id = '00000000-0000-0000-0000-0000000000c1')
  and not exists (select 1 from public.approval_records() where can_decide));
select test.noerr('Leadership org overview allowed', $$select public.org_overview(current_date - 30, current_date)$$);
select test.err('Leadership cannot change project teams',
  $$select public.assign_project_member('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2')$$, 'projects you manage');
select test.noerr('Leadership submits own leave',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'casual',test.nmon(3),test.nmon(3),'Conference','pending')$$);
select test.ok('Leadership leave routed to HR',
  (select approval_route from public.leave_requests where user_id = auth.uid() and start_date = test.nmon(3)) = 'hr');

-- ===================================================================== PROJECT MANAGERS
select test.login(:'PM'); set role authenticated;
select test.noerr('PM logs time on own project without membership',
  $$insert into public.time_entries(user_id,work_date,project_id,task,description,start_time,end_time,break_min)
    values (auth.uid(),public.org_today(),'10000000-0000-0000-0000-000000000001','Plan','Backlog','09:00','10:00',0)$$);
select test.noerr('PM submits own timesheet (-> HR)', $$select public.submit_timesheet_day(null)$$);
select test.ok('PM timesheet routed to HR',
  (select approval_route from public.daily_timesheets where user_id = auth.uid() and work_date = public.org_today()) = 'hr');
select test.noerr('PM assigns E2 to own project WEB', $$select public.assign_project_member('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2')$$);
select test.err('PM cannot assign the same person twice',
  $$select public.assign_project_member('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2')$$, 'already assigned');
select test.err('PM cannot assign an inactive employee',
  $$select public.assign_project_member('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e4')$$, 'inactive');
select test.err('PM cannot assign to another PM''s project',
  $$select public.assign_project_member('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000e2')$$, 'projects you manage');
select test.noerr('PM archives own project OLD', $$update public.projects set status='archived' where id='10000000-0000-0000-0000-000000000003'$$);
select test.err('Cannot assign to an archived project',
  $$select public.assign_project_member('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000e2')$$, 'archived');
select test.ok('PM reads team of own project', (select count(*) from public.project_members where project_id = '10000000-0000-0000-0000-000000000001' and active) = 2);
select test.ok('PM cannot read team of another PM''s project', (select count(*) from public.project_members where project_id = '10000000-0000-0000-0000-000000000002') = 0);

select test.login(:'E2');
select test.noerr('E2 logs time on WEB after assignment',
  $$insert into public.time_entries(user_id,work_date,project_id,task,description,start_time,end_time,break_min)
    values (auth.uid(),public.org_today(),'10000000-0000-0000-0000-000000000001','QA','Tests','09:00','10:00',0)$$);

select test.login(:'PM2');
select test.err('Other PM cannot unassign from WEB',
  $$select public.unassign_project_member('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2')$$, 'projects you manage');
select test.noerr('PM2 (reports to a manager) submits own leave',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'annual',test.nmon(4),test.nmon(4),'Rest','pending')$$);
reset role;
select test.ok('PM2 leave goes to HR, not to line manager Mona',
  not exists (select 1 from public.notifications where user_id = :'MGR' and text like 'Pete PM%')
  and exists (select 1 from public.notifications where user_id = :'HR1' and text like 'Pete PM (Project Manager) requested%'));

select test.login(:'MGR'); set role authenticated;
select test.ok('Manager sees PM2 (direct report) pending leave in history, cannot decide',
  exists (select 1 from public.approval_records(p_kind => 'leave') where owner_id = '00000000-0000-0000-0000-0000000000d2' and not can_decide));
select test.err('Manager cannot decide PM2 leave (HR route)',
  $$select public.decide_leave((select id from public.leave_requests where user_id='00000000-0000-0000-0000-0000000000d2' and status='pending' limit 1),'approved','')$$, 'decided by HR');

select test.login(:'PM'); set role authenticated;
select test.noerr('PM unassigns E2 from WEB', $$select public.unassign_project_member('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2')$$);
select test.err('Unassigning again fails cleanly',
  $$select public.unassign_project_member('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2')$$, 'not currently assigned');
select test.noerr('PM re-assigns E2 (new history row)', $$select public.assign_project_member('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2')$$);
select test.ok('Assignment history preserved (1 inactive + 1 active)',
  (select count(*) filter (where not active and unassigned_at is not null) = 1 and count(*) filter (where active) = 1
   from public.project_members where project_id = '10000000-0000-0000-0000-000000000001' and employee_id = '00000000-0000-0000-0000-0000000000e2'));
select test.noerr('PM unassigns E2 again', $$select public.unassign_project_member('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2')$$);

select test.login(:'E2');
select test.ok('E2 still sees historical WEB entry after unassignment',
  exists (select 1 from public.time_entries where user_id = auth.uid() and project_id = '10000000-0000-0000-0000-000000000001'));
select test.noerr('E2 may still edit the existing WEB entry text (no project change)',
  $$update public.time_entries set task = 'QA pass' where user_id = auth.uid() and project_id = '10000000-0000-0000-0000-000000000001' and work_date = public.org_today()$$);
select test.err('E2 cannot add a new WEB entry after unassignment',
  $$insert into public.time_entries(user_id,work_date,project_id,task,description,start_time,end_time,break_min)
    values (auth.uid(),public.org_today(),'10000000-0000-0000-0000-000000000001','QA','x','11:00','12:00',0)$$, 'not assigned');
select test.ok('WEB no longer in E2 picker', not exists (select 1 from public.my_loggable_projects() where code = 'WEB'));
select test.ok('E2 cannot read E1''s leave', (select count(*) from public.leave_requests where user_id = '00000000-0000-0000-0000-0000000000e1') = 0);
select test.ok('E2 cannot read E1''s timesheets', (select count(*) from public.daily_timesheets where user_id = '00000000-0000-0000-0000-0000000000e1') = 0);
select test.ok('E2 cannot read E1''s leave history', (select count(*) from public.leave_history where owner_id = '00000000-0000-0000-0000-0000000000e1') = 0);
select test.ok('E2 sees own membership history', (select count(*) from public.project_members where employee_id = auth.uid()) = 2);

-- ===================================================================== HR
select test.login(:'HR1'); set role authenticated;
select test.ok('HR actionable queue holds only HR-route items',
  not exists (select 1 from public.approval_records(p_actionable => true) where route <> 'hr'));
select test.ok('HR sees organisation-wide history (incl. employees)',
  exists (select 1 from public.approval_records() where owner_id = '00000000-0000-0000-0000-0000000000e1'));
select test.err('HR cannot decide a normal employee''s leave',
  $$select public.decide_leave('20000000-0000-0000-0000-000000000001','approved','')$$, 'line manager');
select test.err('HR cannot review a normal employee''s timesheet',
  $$select public.decide_timesheet_day('00000000-0000-0000-0000-0000000000e1','2026-11-23','approved','')$$, 'line manager');
select test.noerr('HR approves Manager leave',
  $$select public.decide_leave((select id from public.leave_requests where user_id='00000000-0000-0000-0000-0000000000c1' and start_date=test.nmon(2)),'approved','Enjoy')$$);
select test.noerr('HR requests changes on Manager timesheet',
  $$select public.decide_timesheet_day('00000000-0000-0000-0000-0000000000c1', public.org_today(), 'changes', 'Split the task')$$);
select test.noerr('HR rejects PM2 leave',
  $$select public.decide_leave((select id from public.leave_requests where user_id='00000000-0000-0000-0000-0000000000d2' and status='pending' limit 1),'rejected','Busy week')$$);
select test.noerr('HR approves PM timesheet',
  $$select public.decide_timesheet_day('00000000-0000-0000-0000-0000000000d1', public.org_today(), 'approved', '')$$);
select test.noerr('HR approves legacy Manager leave re-routed to HR',
  $$select public.decide_leave('20000000-0000-0000-0000-000000000002','approved','')$$);
select test.noerr('HR assigns E2 to APP (organisation-wide)', $$select public.assign_project_member('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000e2')$$);
select test.ok('HR filter: timesheets on APP', (select count(*) from public.approval_records(p_kind => 'timesheet', p_project => '10000000-0000-0000-0000-000000000002')) >= 2);
select test.ok('HR filter: search by name', (select bool_and(owner_name ilike '%mona%') from public.approval_records(p_q => 'mona')));
select test.ok('HR filter: approver', (select bool_and(approver_id = '00000000-0000-0000-0000-0000000000a1') from public.approval_records(p_approver => '00000000-0000-0000-0000-0000000000a1')));
select test.ok('HR filter: role=pm', (select bool_and(owner_role = 'pm') from public.approval_records(p_role => 'pm')));
select test.ok('HR filter: department', (select bool_and(owner_department = 'Engineering') from public.approval_records(p_department => 'Engineering')));
select test.ok('HR filter: status rejected', (select bool_and(status = 'rejected') from public.approval_records(p_status => 'rejected')));
select test.ok('HR pagination: total_count stable across pages',
  (select max(total_count) from public.approval_records(p_limit => 2, p_offset => 0)) = (select max(total_count) from public.approval_records(p_limit => 2, p_offset => 2))
  and (select count(*) from public.approval_records(p_limit => 2)) = 2);
select test.ok('HR sort by name asc', (select array_agg(owner_name) = array_agg(owner_name order by owner_name) from public.approval_records(p_sort => 'name', p_dir => 'asc', p_limit => 100)));
select test.ok('HR never sees own records in approval history', not exists (select 1 from public.approval_records() where owner_id = auth.uid()));
select test.err('HR own leave needs a line manager (HR is not self-routed)',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'annual',test.nmon(7),test.nmon(7),'x','pending')$$, 'active line manager');
select test.err('HR cannot delete approval history', $$delete from public.leave_history$$, 'permission denied');
reset role;
select test.ok('Manager notified of HR decision (with HR tag)',
  exists (select 1 from public.notifications where user_id = :'MGR' and text like 'Hana HR (HR) approved your annual leave%'));
select test.ok('Manager notified of HR change request',
  exists (select 1 from public.notifications where user_id = :'MGR' and text like 'Hana HR (HR) requested changes on your timesheet%'));

-- Even a SECURITY DEFINER path cannot rewrite history (trigger)
select test.login(:'HR1');
select test.err('History trigger blocks updates for logged-in users even as owner',
  $$update public.leave_history set note = 'tampered'$$, 'permanent');
reset role; select test.logout();

-- Manager resubmits corrected timesheet -> HR again
select test.login(:'MGR'); set role authenticated;
select test.noerr('Manager corrects the day HR sent back', $$update public.time_entries set task='Planning' where user_id=auth.uid() and work_date=public.org_today()$$);
select test.noerr('Manager resubmits', $$select public.submit_timesheet_day(public.org_today())$$);
select test.ok('Resubmission still routed to HR',
  (select approval_route = 'hr' and status = 'submitted' and resubmissions = 1 from public.daily_timesheets where user_id=auth.uid() and work_date=public.org_today()));

-- ===================================================================== NO ACTIVE HR
reset role; select test.logout(); update public.profiles set active = false where role = 'hr';
select test.login(:'MGR2'); set role authenticated;
select test.err('Manager request refused when no HR user is active',
  $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status)
    values (auth.uid(),'annual',test.nmon(2),test.nmon(2),'x','pending')$$, 'no active HR approver');
reset role; select test.logout(); update public.profiles set active = true where role = 'hr';

-- ===================================================================== ADMIN
select test.login(:'ADMIN'); set role authenticated;
select test.ok('Admin sees legacy orphan items (no line manager) as decidable',
  (select count(*) from public.approval_records(p_actionable => true) where owner_id = '00000000-0000-0000-0000-0000000000e3') = 2);
select test.noerr('Admin decides legacy orphan leave', $$select public.decide_leave('20000000-0000-0000-0000-000000000003','approved','')$$);
select test.err('Admin cannot decide HR-route items',
  $$select public.decide_timesheet_day('00000000-0000-0000-0000-0000000000c1', public.org_today(), 'approved', '')$$, 'reviewed by HR');
select test.noerr('Admin manages any project team', $$select public.assign_project_member('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2')$$);
select test.ok('Admin can read audit log', (select count(*) from public.audit_logs) > 0);

-- ===================================================================== REGRESSION
select test.login(:'E1'); set role authenticated;
select test.err('Approved leave cannot be cancelled',
  $$select public.cancel_leave((select id from public.leave_requests where user_id=auth.uid() and start_date=test.nmon(1)))$$, 'cannot be cancelled');
with u as (update public.time_entries set task='x' where user_id=auth.uid() and work_date=public.org_today() returning 1)
select test.ok('Approved timesheet cannot be edited (0 rows)', (select count(*) from u) = 0);
select test.ok('...and the update changed nothing', (select task from public.time_entries where user_id=auth.uid() and work_date=public.org_today() limit 1) = 'Build');
reset role;
-- simulate the 30-minute window expiring on E2's draft->submitted day
select test.login(:'E2'); set role authenticated;
select test.noerr('E2 submits timesheet', $$select public.submit_timesheet_day(null)$$);
select test.noerr('E2 edits within 30 minutes', $$update public.time_entries set description='Tests run' where user_id=auth.uid() and work_date=public.org_today()$$);
reset role; update public.daily_timesheets set edit_until = now() - interval '1 minute' where user_id = :'E2' and work_date = public.org_today();
select test.login(:'E2'); set role authenticated;
with u as (update public.time_entries set description='late' where user_id=auth.uid() and work_date=public.org_today() returning 1)
select test.ok('E2 edit after 30 minutes refused (0 rows)', (select count(*) from u) = 0);
select test.err('E2 cannot submit again after window', $$select public.submit_timesheet_day(null)$$, 'already been submitted');
select test.ok('...late edit changed nothing', (select description from public.time_entries where user_id=auth.uid() and work_date=public.org_today() limit 1) = 'Tests run');

-- deleting a request that has history is impossible
select test.login(:'MGR'); set role authenticated;
reset role;
select test.login(:'E1'); set role authenticated;
select test.noerr('E1 submits another leave', $$insert into public.leave_requests(user_id,type,start_date,end_date,reason,status) values (auth.uid(),'casual',test.nmon(8),test.nmon(8),'x','pending')$$);
reset role; select test.login(:'MGR'); set role authenticated;
select test.noerr('Manager requests changes', $$select public.decide_leave((select id from public.leave_requests where user_id='00000000-0000-0000-0000-0000000000e1' and start_date=test.nmon(8)),'changes','Pick another day')$$);
reset role; select test.login(:'E1'); set role authenticated;
select test.noerr('E1 saves it as draft', $$update public.leave_requests set status='draft' where user_id=auth.uid() and start_date=test.nmon(8)$$);
with d as (delete from public.leave_requests where user_id=auth.uid() and start_date=test.nmon(8) returning 1)
select test.ok('Draft with history cannot be deleted (kept for history)', (select count(*) from d) = 0);
select test.noerr('E1 resubmits', $$update public.leave_requests set status='pending', start_date=test.nmon(8)+1, end_date=test.nmon(8)+1 where user_id=auth.uid() and start_date=test.nmon(8)$$);
select test.ok('Resubmission clears the old decision and keeps first submission time',
  (select decided_by is null and decision_note is null and submitted_at < last_submitted_at from public.leave_requests where user_id=auth.uid() and start_date=test.nmon(8)+1));
select test.ok('Full leave history: Submitted, Changes requested, Resubmitted',
  (select array_agg(h.action order by h.created_at) from public.leave_history h join public.leave_requests l on l.id=h.leave_id
   where l.user_id=auth.uid() and l.start_date=test.nmon(8)+1) = array['Submitted','Changes requested','Resubmitted']);
select test.ok('Leave balance includes pending + approved', (select used >= 2 from public.leave_balance(auth.uid(), extract(year from test.nmon(1))::int) where type='annual'));
reset role;

\o
\echo ===== RESULTS =====
select n, case when pass then 'PASS' else 'FAIL' end as result, name, case when pass then '' else detail end as detail from test.results order by n;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from test.results;
