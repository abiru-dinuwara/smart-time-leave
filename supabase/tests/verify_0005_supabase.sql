-- =====================================================================
-- Verify migration 0005 on your Supabase project.
-- SAFE: read-only. It changes nothing.
-- Supabase -> SQL Editor -> New query -> paste this whole file -> Run.
-- Every row should show ok = true (rows marked "info" are just facts to check).
-- =====================================================================
with checks(area, check_name, ok, detail) as (
  -- ---------- columns added by 0005
  select 'schema', 'Column ' || c.t || '.' || c.col,
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = c.t and column_name = c.col), ''
  from (values ('leave_requests','approval_route'), ('leave_requests','submitted_at'), ('leave_requests','last_submitted_at'),
               ('daily_timesheets','approval_route'),
               ('leave_history','owner_id'), ('leave_history','from_status'), ('leave_history','to_status'), ('leave_history','actor_role'),
               ('timesheet_reviews','timesheet_id'), ('timesheet_reviews','from_status'), ('timesheet_reviews','to_status'), ('timesheet_reviews','actor_role')) c(t, col)

  -- ---------- project_members table + row level security
  union all
  select 'schema', 'Table project_members exists', to_regclass('public.project_members') is not null, ''
  union all
  select 'security', 'project_members has row level security on',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.project_members')), false), ''
  union all
  select 'security', 'project_members read policy (pm_read)',
         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_members' and policyname = 'pm_read'), ''
  union all
  select 'security', 'App cannot write project_members directly',
         to_regclass('public.project_members') is not null
         and not has_table_privilege('authenticated', 'public.project_members', 'INSERT')
         and not has_table_privilege('authenticated', 'public.project_members', 'UPDATE')
         and not has_table_privilege('authenticated', 'public.project_members', 'DELETE'), ''

  -- ---------- functions the app calls
  union all
  select 'functions', 'App can call ' || f.sig,
         to_regprocedure(f.sig) is not null and has_function_privilege('authenticated', f.sig, 'EXECUTE'), ''
  from (values ('public.approval_records(text,text,text,text,public.app_role,uuid,uuid,date,date,text,text,integer,integer,boolean)'),
               ('public.approval_counts()'), ('public.org_overview(date,date)'), ('public.my_loggable_projects()'),
               ('public.assign_project_member(uuid,uuid)'), ('public.unassign_project_member(uuid,uuid)'),
               ('public.can_decide_request(uuid,text)'), ('public.can_manage_project(uuid)'),
               ('public.decide_leave(uuid,text,text)'), ('public.decide_timesheet_day(uuid,date,text,text)'),
               ('public.submit_timesheet_day(date)'), ('public.cancel_leave(uuid)')) f(sig)

  -- ---------- internal helpers must NOT be callable from the app
  union all
  select 'security', 'App cannot call internal ' || f.sig,
         to_regprocedure(f.sig) is not null and not has_function_privilege('authenticated', f.sig, 'EXECUTE'), ''
  from (values ('public._approval_route(uuid)'), ('public._route_approvers(uuid,text)'), ('public._require_approver(uuid,text)'),
               ('public._can_log_to_project(uuid,uuid)'), ('public._log_leave(uuid,uuid,text,text,text,text)')) f(sig)

  -- ---------- approval history is permanent
  union all
  select 'history', 'Trigger ' || t.name,
         exists (select 1 from pg_trigger where tgname = t.name and not tgisinternal), 'blocks edits/deletes of history'
  from (values ('leave_history_immutable'), ('timesheet_reviews_immutable')) t(name)
  union all
  select 'history', 'App cannot insert/update/delete history rows',
         not has_table_privilege('authenticated', 'public.leave_history', 'INSERT')
         and not has_table_privilege('authenticated', 'public.leave_history', 'UPDATE')
         and not has_table_privilege('authenticated', 'public.leave_history', 'DELETE')
         and not has_table_privilege('authenticated', 'public.timesheet_reviews', 'INSERT')
         and not has_table_privilege('authenticated', 'public.timesheet_reviews', 'UPDATE')
         and not has_table_privilege('authenticated', 'public.timesheet_reviews', 'DELETE'), ''
  union all
  select 'security', 'App cannot set approval_route itself',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leave_requests' and column_name = 'approval_route')
              then not has_column_privilege('authenticated', 'public.leave_requests', 'approval_route', 'INSERT')
               and not has_column_privilege('authenticated', 'public.leave_requests', 'approval_route', 'UPDATE')
              else false end, ''

  -- ---------- data back-filled
  union all
  select 'data', 'Every pending leave request has a route',
         coalesce(case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leave_requests' and column_name = 'approval_route')
              then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.leave_requests where status = 'pending' and approval_route is null$q$, false, true, '')))[1]::text::bigint
              else null end = 0, false),
         (select count(*) from public.leave_requests where status = 'pending')::text || ' pending'
  union all
  select 'data', 'Every submitted timesheet has a route',
         coalesce(case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'daily_timesheets' and column_name = 'approval_route')
              then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.daily_timesheets where status = 'submitted' and approval_route is null$q$, false, true, '')))[1]::text::bigint
              else null end = 0, false),
         (select count(*) from public.daily_timesheets where status = 'submitted')::text || ' waiting'
  union all
  select 'data', 'No accidental test data (no @co.test users, no "test" schema)',
         not exists (select 1 from public.profiles where email like '%@co.test')
         and not exists (select 1 from pg_namespace where nspname = 'test'), ''

  -- ---------- things for you to act on (info)
  union all
  select 'info', 'Active HR users (need at least 1)',
         (select count(*) from public.profiles where role = 'hr' and active) > 0,
         (select count(*) from public.profiles where role = 'hr' and active)::text
  union all
  select 'info', 'People who cannot submit (no active line manager)',
         true,
         coalesce((select string_agg(p.full_name, ', ' order by p.full_name) from public.profiles p
                   where p.active and p.role in ('employee', 'hr', 'admin')
                     and not exists (select 1 from public.profiles m where m.id = p.manager_id and m.active)), 'none')
  union all
  select 'info', 'Project team assignments (back-filled + new)',
         true,
         coalesce((case when to_regclass('public.project_members') is not null
              then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.project_members where active$q$, false, true, '')))[1]::text::bigint
              else null end)::text || ' active', 'table missing — run 0005')
)
select area, check_name, ok, detail
from checks
order by ok, area, check_name;
