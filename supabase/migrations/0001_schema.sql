-- =====================================================================
-- Smart Time & Leave Assistant — database schema (stage 1)
-- Run this whole file once in Supabase: SQL Editor -> New query -> Run
-- =====================================================================

-- ---------- enums ----------
create type public.app_role     as enum ('employee','manager','pm','hr','leadership','admin');
create type public.leave_type   as enum ('annual','sick','casual','unpaid','compassionate');
create type public.leave_status as enum ('draft','pending','approved','rejected','changes','cancelled');
create type public.entry_status as enum ('draft','submitted','approved','rejected','changes');

-- ---------- organisation settings (exactly one row) ----------
create table public.org_settings (
  id                   boolean primary key default true check (id),
  org_name             text    not null default 'My Company',
  hours_per_day        numeric(4,2) not null default 8 check (hours_per_day between 1 and 24),
  timezone             text    not null default 'UTC',
  allowed_email_domain text    -- e.g. 'mycompany.com'. NULL = any email may sign up
);
insert into public.org_settings default values;

-- ---------- people ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null,
  emp_no      text unique,
  department  text,
  team        text,
  position    text,
  manager_id  uuid references public.profiles(id) on delete set null,
  role        public.app_role not null default 'employee',
  tracks_time boolean not null default true,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check (manager_id is distinct from id)
);
create index profiles_manager_idx on public.profiles(manager_id);

-- ---------- projects ----------
create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z0-9_-]{2,10}$'),
  name          text not null,
  description   text not null default '',
  pm_id         uuid references public.profiles(id) on delete set null,
  start_date    date,
  deadline      date,
  planned_hours numeric(9,1) not null default 0 check (planned_hours >= 0),
  prior_hours   numeric(9,1) not null default 0 check (prior_hours >= 0),
  status        text not null default 'active' check (status in ('active','archived')),
  created_at    timestamptz not null default now()
);

-- ---------- timesheets ----------
create table public.time_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  work_date    date not null,
  week_start   date generated always as (work_date - (extract(isodow from work_date)::int - 1)) stored,
  project_id   uuid not null references public.projects(id),
  task         text not null default '',
  description  text not null default '',
  start_time   time not null,
  end_time     time not null,
  break_min    int  not null default 0 check (break_min >= 0),
  status       public.entry_status not null default 'draft',
  review_note  text,
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_time > start_time),
  check (break_min < extract(epoch from (end_time - start_time)) / 60)
);
create index time_entries_user_week_idx on public.time_entries(user_id, week_start);
create index time_entries_project_idx   on public.time_entries(project_id);

create table public.timesheet_reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index timesheet_reviews_idx on public.timesheet_reviews(user_id, week_start);

-- ---------- leave ----------
create table public.leave_policies (
  type          public.leave_type primary key,
  days_per_year numeric(5,1) check (days_per_year is null or days_per_year >= 0), -- NULL = unlimited
  note          text not null default ''
);

create table public.holidays (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name         text not null
);

create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  type          public.leave_type not null,
  start_date    date not null,
  end_date      date not null,
  half          text not null default 'none' check (half in ('none','AM','PM')),
  days          numeric(4,1) not null default 0,   -- calculated by trigger, client value is ignored
  reason        text not null default '',
  status        public.leave_status not null default 'pending',
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date)
);
create index leave_user_idx  on public.leave_requests(user_id, start_date);
create index leave_dates_idx on public.leave_requests(start_date, end_date);

create table public.leave_history (
  id         uuid primary key default gen_random_uuid(),
  leave_id   uuid not null references public.leave_requests(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index leave_history_idx on public.leave_history(leave_id, created_at);

-- ---------- notifications & audit ----------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  text       text not null,
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, read, created_at desc);

create table public.audit_logs (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_id   uuid,
  actor_name text,
  action     text not null,
  detail     text not null default ''
);
create index audit_logs_at_idx on public.audit_logs(at desc);

-- =====================================================================
-- helper functions
-- =====================================================================

-- Role of the logged-in user (NULL when not logged in or deactivated)
create function public.me_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

create function public.is_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.me_role() = any (roles), false)
$$;

-- Is the logged-in user the line manager of p_emp?
create function public.manages(p_emp uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_member() and exists (
    select 1 from public.profiles where id = p_emp and manager_id = auth.uid())
$$;

-- Working days between two dates (Mon–Fri, excluding company holidays)
create function public.working_days(p_start date, p_end date) returns int
language plpgsql stable set search_path = '' as $$
begin
  if p_end < p_start then return 0; end if;
  if p_end - p_start > 400 then raise exception 'Leave period is too long.'; end if;
  return (select count(*)::int
          from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') g
          where extract(isodow from g) < 6
            and not exists (select 1 from public.holidays h where h.holiday_date = g::date));
end $$;

-- internal: write to audit log
create function public._audit(p_action text, p_detail text) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs(actor_id, actor_name, action, detail)
  values (auth.uid(),
          (select full_name from public.profiles where id = auth.uid()),
          p_action, p_detail)
$$;

-- internal: create a notification
create function public._notify(p_user uuid, p_type text, p_text text, p_link text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications(user_id, type, text, link) values (p_user, p_type, p_text, p_link)
$$;

-- internal: notify the line manager of p_emp, or all HR users when there is none
create function public._notify_approvers(p_emp uuid, p_type text, p_text text, p_link text) returns void
language plpgsql security definer set search_path = '' as $$
declare m uuid;
begin
  select manager_id into m from public.profiles where id = p_emp;
  if m is not null then
    perform public._notify(m, p_type, p_text, p_link);
  else
    insert into public.notifications(user_id, type, text, link)
    select id, p_type, p_text, p_link from public.profiles
    where role = 'hr' and active and id <> p_emp;
  end if;
end $$;

-- internal: leave balance without permission check
create function public._leave_balance(p_user uuid, p_year int)
returns table (type public.leave_type, allocated numeric, used numeric, pending numeric, remaining numeric)
language sql stable security definer set search_path = '' as $$
  select p.type,
         p.days_per_year,
         coalesce(sum(l.days) filter (where l.status = 'approved'), 0),
         coalesce(sum(l.days) filter (where l.status = 'pending'), 0),
         case when p.days_per_year is null then null
              else p.days_per_year
                   - coalesce(sum(l.days) filter (where l.status in ('approved','pending')), 0) end
  from public.leave_policies p
  left join public.leave_requests l
         on l.type = p.type and l.user_id = p_user
        and extract(year from l.start_date) = p_year
  group by p.type, p.days_per_year
  order by p.type
$$;

-- public: leave balance for myself / my reports / HR / leadership
create function public.leave_balance(p_user uuid, p_year int default extract(year from current_date)::int)
returns table (type public.leave_type, allocated numeric, used numeric, pending numeric, remaining numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_user = auth.uid() or public.manages(p_user) or public.is_role('hr','leadership')) then
    raise exception 'Not allowed.';
  end if;
  return query select * from public._leave_balance(p_user, p_year);
end $$;

-- public: which colleagues (same manager) are off during a period? Names only, no reasons.
create function public.team_leave_overlaps(p_start date, p_end date)
returns table (full_name text, status public.leave_status, start_date date, end_date date)
language sql stable security definer set search_path = '' as $$
  select p.full_name, l.status, l.start_date, l.end_date
  from public.profiles me
  join public.profiles p on p.manager_id is not distinct from me.manager_id and p.id <> me.id and p.active
  join public.leave_requests l on l.user_id = p.id
       and l.status in ('pending','approved')
       and l.start_date <= p_end and l.end_date >= p_start
  where me.id = auth.uid() and me.manager_id is not null
  order by l.start_date
$$;

-- public: approved + pending project hours (totals only)
create function public.project_hours()
returns table (project_id uuid, approved_hours numeric, pending_hours numeric)
language sql stable security definer set search_path = '' as $$
  select t.project_id,
         coalesce(sum(extract(epoch from (t.end_time - t.start_time)) / 3600 - t.break_min / 60.0)
                  filter (where t.status = 'approved'), 0),
         coalesce(sum(extract(epoch from (t.end_time - t.start_time)) / 3600 - t.break_min / 60.0)
                  filter (where t.status = 'submitted'), 0)
  from public.time_entries t
  where public.is_member()
  group by t.project_id
$$;

-- =====================================================================
-- triggers
-- =====================================================================

-- new auth user -> profile. The very first user becomes the administrator.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  dom text;
  first_user boolean;
begin
  select allowed_email_domain into dom from public.org_settings;
  if dom is not null and dom <> '' and lower(split_part(new.email, '@', 2)) <> lower(dom) then
    raise exception 'Sign-ups are limited to @% email addresses.', dom;
  end if;
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles(id, email, full_name, role)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
          case when first_user then 'admin'::public.app_role else 'employee'::public.app_role end);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- who may change which profile fields
create function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.app_role := public.me_role();
begin
  if auth.uid() is null then return new; end if;            -- SQL editor / service role
  if new.id <> old.id or new.email <> old.email then
    raise exception 'This field cannot be changed.';
  end if;
  if r = 'admin' then
    if old.role = 'admin' and (new.role <> 'admin' or not new.active)
       and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
      raise exception 'There must be at least one active administrator.';
    end if;
    return new;
  end if;
  if new.role <> old.role then raise exception 'Only an administrator can change roles.'; end if;
  if r = 'hr' then
    if old.role = 'admin' then raise exception 'Only an administrator can change an administrator.'; end if;
    return new;
  end if;
  if (new.emp_no, new.department, new.team, new.position, new.manager_id, new.tracks_time, new.active)
     is distinct from
     (old.emp_no, old.department, old.team, old.position, old.manager_id, old.tracks_time, old.active) then
    raise exception 'You can only change your name.';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- time entry validation
create function public.time_entry_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if exists (select 1 from public.time_entries t
             where t.user_id = new.user_id and t.work_date = new.work_date and t.id <> new.id
               and t.start_time < new.end_time and t.end_time > new.start_time) then
    raise exception 'This time overlaps another entry on the same day.';
  end if;
  if tg_op = 'INSERT' or new.project_id <> old.project_id then
    if not exists (select 1 from public.projects where id = new.project_id and status = 'active') then
      raise exception 'This project is archived. Choose an active project.';
    end if;
  end if;
  return new;
end $$;

create trigger time_entries_validate before insert or update on public.time_entries
  for each row execute function public.time_entry_before_write();

-- leave validation: working days, overlap, balance
create function public.leave_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  wd int;
  alloc numeric;
  used numeric;
  needs_check boolean;
begin
  new.updated_at := now();
  if tg_op = 'INSERT'
     or (old.start_date, old.end_date, old.half) is distinct from (new.start_date, new.end_date, new.half) then
    wd := public.working_days(new.start_date, new.end_date);
    if new.half <> 'none' then
      if new.start_date <> new.end_date then raise exception 'Half-day leave must be a single day.'; end if;
      new.days := case when wd > 0 then 0.5 else 0 end;
    else
      new.days := wd;
    end if;
    if new.days = 0 then
      raise exception 'These dates contain no working days (weekends and holidays only).';
    end if;
  else
    new.days := old.days;   -- the client can never set the number of days
  end if;

  needs_check := new.status = 'pending'
    and (tg_op = 'INSERT' or old.status is distinct from 'pending'
         or old.start_date <> new.start_date or old.end_date <> new.end_date or old.type <> new.type);
  if needs_check then
    if exists (select 1 from public.leave_requests l
               where l.user_id = new.user_id and l.id <> new.id
                 and l.status in ('pending','approved')
                 and l.start_date <= new.end_date and l.end_date >= new.start_date
                 and not (l.half <> 'none' and new.half <> 'none'
                          and l.start_date = new.start_date and l.end_date = new.end_date
                          and l.half <> new.half)) then
      raise exception 'This overlaps another pending or approved leave request.';
    end if;

    select p.days_per_year into alloc from public.leave_policies p where p.type = new.type;
    if alloc is not null then
      select coalesce(sum(l.days), 0) into used
      from public.leave_requests l
      where l.user_id = new.user_id and l.type = new.type and l.id <> new.id
        and l.status in ('pending','approved')
        and extract(year from l.start_date) = extract(year from new.start_date);
      if used + new.days > alloc then
        raise exception 'Not enough % leave: % day(s) left, % requested.',
          new.type, greatest(alloc - used, 0), new.days;
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger leave_validate before insert or update on public.leave_requests
  for each row execute function public.leave_before_write();

-- leave submitted -> history + notifications + audit
create function public.leave_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text;
  txt text;
  resub boolean;
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    resub := tg_op = 'UPDATE' and old.status = 'changes';
    select full_name into who from public.profiles where id = new.user_id;
    insert into public.leave_history(leave_id, actor_id, action)
    values (new.id, new.user_id, case when resub then 'Resubmitted' else 'Submitted' end);
    txt := format('%s requested %s day(s) of %s leave (%s to %s).', who, new.days, new.type, new.start_date, new.end_date);
    perform public._notify_approvers(new.user_id, 'approval', txt, '/approvals');
    if new.days >= 5 then
      insert into public.notifications(user_id, type, text, link)
      select id, 'info', 'FYI: ' || txt, '/approvals' from public.profiles
      where role = 'hr' and active and id <> new.user_id
        and id is distinct from (select manager_id from public.profiles where id = new.user_id);
    end if;
    perform public._audit('Leave submitted', format('%s — %s %s to %s', who, new.type, new.start_date, new.end_date));
  end if;
  return null;
end $$;

create trigger leave_after after insert or update on public.leave_requests
  for each row execute function public.leave_after_write();

-- generic audit trail for admin-type changes
create function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d text;
begin
  if tg_table_name = 'profiles' then
    if tg_op = 'UPDATE' and (new.role, new.manager_id, new.active, new.department, new.team, new.position, new.tracks_time)
       is not distinct from (old.role, old.manager_id, old.active, old.department, old.team, old.position, old.tracks_time) then
      return null;
    end if;
    d := format('%s (%s) role=%s active=%s', new.full_name, new.email, new.role, new.active);
    perform public._audit('Person ' || lower(tg_op), d);
  elsif tg_table_name = 'holidays' then
    d := case when tg_op = 'DELETE' then old.name || ' ' || old.holiday_date else new.name || ' ' || new.holiday_date end;
    perform public._audit('Holiday ' || lower(tg_op), d);
  elsif tg_table_name = 'leave_policies' then
    perform public._audit('Leave policy changed', format('%s = %s days', new.type, coalesce(new.days_per_year::text, 'unlimited')));
  elsif tg_table_name = 'org_settings' then
    perform public._audit('Organisation settings changed', format('%s, %s h/day, %s', new.org_name, new.hours_per_day, new.timezone));
  elsif tg_table_name = 'projects' then
    perform public._audit('Project ' || lower(tg_op), format('%s %s', new.code, new.name));
  end if;
  return null;
end $$;

create trigger profiles_audit  after insert or update on public.profiles       for each row execute function public.audit_row_change();
create trigger holidays_audit  after insert or delete on public.holidays       for each row execute function public.audit_row_change();
create trigger policies_audit  after update           on public.leave_policies for each row execute function public.audit_row_change();
create trigger settings_audit  after update           on public.org_settings   for each row execute function public.audit_row_change();
create trigger projects_audit  after insert or update on public.projects       for each row execute function public.audit_row_change();

-- =====================================================================
-- workflow functions (called from the app with supabase.rpc)
-- =====================================================================

-- Employee submits all editable entries of a week for approval
create function public.submit_week(p_week date) returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
  me uuid := auth.uid();
  who text;
begin
  if not public.is_member() then raise exception 'Not allowed.'; end if;
  if extract(isodow from p_week) <> 1 then raise exception 'Week must start on a Monday.'; end if;
  update public.time_entries
     set status = 'submitted', submitted_at = now(), review_note = null
   where user_id = me and week_start = p_week and status in ('draft','changes','rejected');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'There are no entries to submit for this week.'; end if;
  select full_name into who from public.profiles where id = me;
  perform public._notify_approvers(me, 'approval',
    format('%s submitted a timesheet for the week of %s.', who, p_week), '/approvals?tab=timesheets');
  perform public._audit('Timesheet submitted', format('%s — week of %s (%s entries)', who, p_week, n));
  return n;
end $$;

-- Manager (or HR) reviews a submitted week
create function public.decide_timesheet_week(p_user uuid, p_week date, p_decision text, p_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  actor text;
  emp text;
  new_status public.entry_status;
  label text;
  n int;
begin
  if p_decision not in ('approved','rejected','changes') then raise exception 'Invalid decision.'; end if;
  if p_user = me then raise exception 'You cannot review your own timesheet.'; end if;
  if not (public.manages(p_user) or public.is_role('hr')) then raise exception 'Not allowed.'; end if;
  if p_decision <> 'approved' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Please add a note so the employee knows what to fix.';
  end if;

  new_status := p_decision::public.entry_status;
  update public.time_entries
     set status = new_status, review_note = nullif(btrim(p_note), '')
   where user_id = p_user and week_start = p_week and status = 'submitted';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nothing is waiting for review for this week.'; end if;

  label := case p_decision when 'approved' then 'Approved' when 'rejected' then 'Rejected' else 'Changes requested' end;
  insert into public.timesheet_reviews(user_id, week_start, actor_id, action, note)
  values (p_user, p_week, me, label, coalesce(btrim(p_note), ''));

  select full_name into actor from public.profiles where id = me;
  select full_name into emp   from public.profiles where id = p_user;
  perform public._notify(p_user,
    case p_decision when 'approved' then 'ts_approved' else 'changes' end,
    format('%s %s your timesheet for the week of %s.%s', actor,
           case p_decision when 'approved' then 'approved' when 'rejected' then 'rejected' else 'requested changes on' end,
           p_week, case when coalesce(btrim(p_note), '') = '' then '' else ' "' || btrim(p_note) || '"' end),
    '/timesheet?week=' || p_week);
  perform public._audit('Timesheet ' || lower(label), format('%s — week of %s', emp, p_week));
end $$;

-- Manager (or HR) decides a leave request
create function public.decide_leave(p_id uuid, p_decision text, p_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.leave_requests;
  actor text;
  emp text;
  label text;
begin
  if p_decision not in ('approved','rejected','changes') then raise exception 'Invalid decision.'; end if;
  select * into r from public.leave_requests where id = p_id for update;
  if not found then raise exception 'Leave request not found.'; end if;
  if r.user_id = me then raise exception 'You cannot decide your own leave request.'; end if;
  if not (public.manages(r.user_id) or public.is_role('hr')) then raise exception 'Not allowed.'; end if;
  if r.status <> 'pending' then raise exception 'This request is no longer pending.'; end if;
  if p_decision <> 'approved' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Please add a note so the employee knows why.';
  end if;

  update public.leave_requests
     set status = p_decision::public.leave_status, decided_by = me, decided_at = now(),
         decision_note = nullif(btrim(p_note), '')
   where id = p_id;

  label := case p_decision when 'approved' then 'Approved' when 'rejected' then 'Rejected' else 'Changes requested' end;
  insert into public.leave_history(leave_id, actor_id, action, note) values (p_id, me, label, coalesce(btrim(p_note), ''));

  select full_name into actor from public.profiles where id = me;
  select full_name into emp   from public.profiles where id = r.user_id;
  perform public._notify(r.user_id,
    case p_decision when 'approved' then 'leave_approved' when 'rejected' then 'leave_rejected' else 'changes' end,
    format('%s %s your %s leave (%s to %s).%s', actor,
           case p_decision when 'approved' then 'approved' when 'rejected' then 'rejected' else 'requested changes on' end,
           r.type, r.start_date, r.end_date,
           case when coalesce(btrim(p_note), '') = '' then '' else ' "' || btrim(p_note) || '"' end),
    '/leave');
  perform public._audit('Leave ' || lower(label), format('%s — %s %s to %s', emp, r.type, r.start_date, r.end_date));
end $$;

-- Employee cancels their own request
create function public.cancel_leave(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.leave_requests;
  who text;
begin
  select * into r from public.leave_requests where id = p_id and user_id = me for update;
  if not found then raise exception 'Leave request not found.'; end if;
  if r.status not in ('draft','pending','changes','approved') then raise exception 'This request cannot be cancelled.'; end if;
  if r.status = 'approved' and r.start_date <= current_date then
    raise exception 'Leave that has already started cannot be cancelled. Please contact HR.';
  end if;
  update public.leave_requests set status = 'cancelled' where id = p_id;
  insert into public.leave_history(leave_id, actor_id, action) values (p_id, me, 'Cancelled');
  select full_name into who from public.profiles where id = me;
  if r.status in ('pending','approved') then
    perform public._notify_approvers(me, 'info',
      format('%s cancelled %s leave (%s to %s).', who, r.type, r.start_date, r.end_date), '/approvals');
  end if;
  perform public._audit('Leave cancelled', format('%s — %s %s to %s', who, r.type, r.start_date, r.end_date));
end $$;
