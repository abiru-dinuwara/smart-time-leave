-- =====================================================================
-- Row Level Security: who can read / write which rows.
-- Run this AFTER 0001_schema.sql.
-- Rule of thumb: every table is locked by default, policies open it up.
-- =====================================================================

alter table public.org_settings      enable row level security;
alter table public.profiles          enable row level security;
alter table public.projects          enable row level security;
alter table public.time_entries      enable row level security;
alter table public.timesheet_reviews enable row level security;
alter table public.leave_policies    enable row level security;
alter table public.holidays          enable row level security;
alter table public.leave_requests    enable row level security;
alter table public.leave_history     enable row level security;
alter table public.notifications     enable row level security;
alter table public.audit_logs        enable row level security;

-- ---------- org_settings ----------
create policy settings_read  on public.org_settings for select to authenticated using (public.is_member());
create policy settings_admin on public.org_settings for update to authenticated
  using (public.is_role('admin')) with check (public.is_role('admin'));

-- ---------- profiles ----------
create policy profiles_read on public.profiles for select to authenticated
  using (public.is_member() or id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_role('admin','hr'))
  with check (id = auth.uid() or public.is_role('admin','hr'));
-- (no insert/delete policy: profiles are created by the sign-up trigger)

-- ---------- projects ----------
create policy projects_read on public.projects for select to authenticated using (public.is_member());
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_role('admin') or (public.is_role('pm') and pm_id = auth.uid()));
create policy projects_update on public.projects for update to authenticated
  using (public.is_role('admin') or (public.is_role('pm') and pm_id = auth.uid()))
  with check (public.is_role('admin') or (public.is_role('pm') and pm_id = auth.uid()));

-- ---------- time_entries ----------
create policy te_read on public.time_entries for select to authenticated
  using (public.is_member() and (
         user_id = auth.uid()
      or public.manages(user_id)
      or public.is_role('hr','leadership')
      or exists (select 1 from public.projects p where p.id = project_id and p.pm_id = auth.uid())));
create policy te_insert on public.time_entries for insert to authenticated
  with check (public.is_member() and user_id = auth.uid() and status = 'draft');
create policy te_update on public.time_entries for update to authenticated
  using (user_id = auth.uid() and status in ('draft','changes','rejected'))
  with check (user_id = auth.uid() and status in ('draft','changes','rejected'));
create policy te_delete on public.time_entries for delete to authenticated
  using (user_id = auth.uid() and status in ('draft','changes','rejected'));

create policy tr_read on public.timesheet_reviews for select to authenticated
  using (public.is_member() and (user_id = auth.uid() or public.manages(user_id) or public.is_role('hr','leadership')));

-- ---------- leave ----------
create policy lp_read  on public.leave_policies for select to authenticated using (public.is_member());
create policy lp_write on public.leave_policies for update to authenticated
  using (public.is_role('admin','hr')) with check (public.is_role('admin','hr'));

create policy hol_read   on public.holidays for select to authenticated using (public.is_member());
create policy hol_insert on public.holidays for insert to authenticated with check (public.is_role('admin','hr'));
create policy hol_delete on public.holidays for delete to authenticated using (public.is_role('admin','hr'));

create policy lr_read on public.leave_requests for select to authenticated
  using (public.is_member() and (user_id = auth.uid() or public.manages(user_id) or public.is_role('hr','leadership')));
create policy lr_insert on public.leave_requests for insert to authenticated
  with check (public.is_member() and user_id = auth.uid() and status in ('draft','pending'));
create policy lr_update on public.leave_requests for update to authenticated
  using (user_id = auth.uid() and status in ('draft','changes'))
  with check (user_id = auth.uid() and status in ('draft','pending'));
create policy lr_delete on public.leave_requests for delete to authenticated
  using (user_id = auth.uid() and status = 'draft');

create policy lh_read on public.leave_history for select to authenticated
  using (exists (select 1 from public.leave_requests l where l.id = leave_id));

-- ---------- notifications ----------
create policy nt_read   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy nt_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy nt_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- ---------- audit log: administrators only, read-only ----------
create policy audit_read on public.audit_logs for select to authenticated using (public.is_role('admin'));

-- =====================================================================
-- Privileges. Anonymous (not logged in) visitors get nothing.
-- =====================================================================
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon, authenticated, public;

-- Supabase hands every new function to the web API by default. Switch that off, so a function
-- you add in a future migration is private until you deliberately GRANT it.
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- notification / audit rows are written only by the database functions
revoke insert on public.notifications, public.audit_logs from authenticated;
revoke update, delete on public.audit_logs from authenticated;
revoke insert, delete on public.profiles from authenticated;

-- employees may only write the columns they own; review / decision columns are set by the database
revoke insert, update on public.time_entries   from authenticated;
revoke insert, update on public.leave_requests from authenticated;
grant insert (user_id, work_date, project_id, task, description, start_time, end_time, break_min, status)
  on public.time_entries to authenticated;
grant update (work_date, project_id, task, description, start_time, end_time, break_min, status)
  on public.time_entries to authenticated;
grant insert (user_id, type, start_date, end_date, half, reason, status)
  on public.leave_requests to authenticated;
grant update (type, start_date, end_date, half, reason, status)
  on public.leave_requests to authenticated;

-- functions the logged-in app may call
grant execute on function
  public.me_role(), public.is_member(), public.is_role(public.app_role[]), public.manages(uuid),
  public.working_days(date, date), public.leave_balance(uuid, int),
  public.team_leave_overlaps(date, date), public.project_hours(),
  public.submit_week(date), public.decide_timesheet_week(uuid, date, text, text),
  public.decide_leave(uuid, text, text), public.cancel_leave(uuid)
to authenticated;

-- internal helpers (_audit, _notify, ...) stay private to the database

-- =====================================================================
-- Starting data
-- =====================================================================
insert into public.leave_policies(type, days_per_year, note) values
  ('annual',        20,   'Accrues monthly. Adjust to your company policy.'),
  ('sick',          10,   'Medical note required after 2 consecutive days.'),
  ('casual',         7,   'Short-notice personal leave.'),
  ('unpaid',      null,   'Needs manager and HR approval.'),
  ('compassionate',  3,   'Bereavement or family emergency.');
