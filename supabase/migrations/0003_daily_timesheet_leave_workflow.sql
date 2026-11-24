-- =====================================================================
-- 0003 — Daily timesheets + manager-only leave workflow
--
-- Run this AFTER 0001_schema.sql and 0002_security.sql, once, in
-- Supabase: SQL Editor -> New query -> paste -> Run.
--
-- Safe for a database that already has real data:
--   * no tables are dropped, no rows are deleted
--   * existing time entries are grouped into one daily timesheet per
--     person per day (status, submission time carried over)
--   * functions are replaced in place (CREATE OR REPLACE), old weekly
--     RPCs are switched off but kept so history stays readable
--   * the whole file runs in one transaction: it either all applies or
--     nothing changes
-- =====================================================================

begin;

-- =====================================================================
-- 1. Shared helpers
-- =====================================================================

-- Today's date in the company's configured time zone (database clock).
create or replace function public.org_today() returns date
language plpgsql stable security definer set search_path = '' as $$
declare tz text;
begin
  select timezone into tz from public.org_settings;
  begin
    return (now() at time zone coalesce(nullif(tz, ''), 'UTC'))::date;
  exception when others then
    return (now() at time zone 'UTC')::date;   -- invalid zone name: fall back to UTC
  end;
end $$;

-- Set (transaction-local) only by the trusted workflow functions below, so the
-- employee-facing rules on time_entries do not block a manager's decision.
-- Clients cannot set it: PostgREST exposes no way to call set_config().
create or replace function public._ts_internal() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.ts_internal', true), '') = 'on'
$$;

-- The line manager of p_emp, only if that manager's account is active.
create or replace function public._leave_manager(p_emp uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id
  from public.profiles e
  join public.profiles m on m.id = e.manager_id and m.active
  where e.id = p_emp
$$;

-- Leave notifications go to the line manager ONLY (never an HR fallback).
create or replace function public._notify_leave_manager(p_emp uuid, p_type text, p_text text, p_link text)
returns void
language plpgsql security definer set search_path = '' as $$
declare m uuid := public._leave_manager(p_emp);
begin
  if m is not null then
    perform public._notify(m, p_type, p_text, p_link);
  end if;
end $$;

-- =====================================================================
-- 2. Daily timesheet submissions (one per employee per date)
-- =====================================================================

create table if not exists public.daily_timesheets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  work_date         date not null,
  status            public.entry_status not null default 'draft',
  submitted_at      timestamptz,   -- FIRST submission, set by the database, never changes
  last_submitted_at timestamptz,   -- latest (re)submission after a manager asked for changes
  edit_until        timestamptz,   -- last_submitted_at + 30 minutes
  resubmissions     int not null default 0 check (resubmissions >= 0),
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  review_note       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint daily_timesheets_one_per_day unique (user_id, work_date),
  constraint daily_timesheets_submitted_chk check (status = 'draft' or submitted_at is not null)
);
create index if not exists daily_timesheets_status_idx on public.daily_timesheets(status, work_date);

-- Carry over existing time entries: one daily timesheet per person per day.
insert into public.daily_timesheets
  (user_id, work_date, status, submitted_at, last_submitted_at, edit_until, created_at, updated_at)
select t.user_id,
       t.work_date,
       (case when bool_or(t.status = 'changes')   then 'changes'
             when bool_or(t.status = 'rejected')  then 'rejected'
             when bool_or(t.status = 'submitted') then 'submitted'
             when bool_or(t.status = 'draft')     then 'draft'
             else 'approved' end)::public.entry_status,
       case when bool_and(t.status = 'draft') then null
            else coalesce(min(t.submitted_at), min(t.created_at)) end,
       case when bool_and(t.status = 'draft') then null
            else coalesce(max(t.submitted_at), max(t.created_at)) end,
       case when bool_and(t.status = 'draft') then null
            else coalesce(max(t.submitted_at), max(t.created_at)) + interval '30 minutes' end,
       min(t.created_at),
       now()
from public.time_entries t
group by t.user_id, t.work_date
on conflict (user_id, work_date) do nothing;

-- Every time entry belongs to exactly one daily timesheet.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'time_entries_daily_sheet_fk') then
    alter table public.time_entries
      add constraint time_entries_daily_sheet_fk foreign key (user_id, work_date)
      references public.daily_timesheets(user_id, work_date) on delete cascade;
  end if;
end $$;

-- Review history is now per day (week_start is still filled in for old reports).
alter table public.timesheet_reviews add column if not exists work_date date;
create index if not exists timesheet_reviews_day_idx on public.timesheet_reviews(user_id, work_date);

-- ---------------------------------------------------------------------
-- Can the logged-in employee change entries of (p_user, p_date) right now?
--   no timesheet yet / draft -> only for today (company time zone)
--   changes requested        -> yes (controlled correction)
--   submitted                -> only within 30 minutes of the (re)submission
--                               and only while no manager has decided
--   approved / rejected      -> never
-- ---------------------------------------------------------------------
create or replace function public.timesheet_day_editable(p_user uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_user = auth.uid() and public.is_member() and
    case
      when s.id is null          then p_date = public.org_today()
      when s.status = 'draft'    then p_date = public.org_today()
      when s.status = 'changes'  then true
      when s.status = 'submitted' then s.reviewed_at is null and now() < s.edit_until
      else false
    end, false)
  from (select 1) one
  left join public.daily_timesheets s on s.user_id = p_user and s.work_date = p_date
$$;

-- ---------------------------------------------------------------------
-- Employee-side rules on every insert / update / delete of a time entry.
-- ---------------------------------------------------------------------
create or replace function public.time_entry_daily_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s     public.daily_timesheets;
  today date := public.org_today();
  others int;
begin
  -- trusted workflow functions (submit / decide) and the SQL editor
  if public._ts_internal() or auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    select * into s from public.daily_timesheets
     where user_id = old.user_id and work_date = old.work_date for update;
    if found then
      if s.status in ('approved', 'rejected')
         or (s.status = 'submitted' and (s.reviewed_at is not null or now() >= s.edit_until))
         or (s.status = 'draft' and old.work_date <> today) then
        raise exception 'This timesheet can no longer be changed.';
      end if;
      if s.status = 'submitted' then
        select count(*) into others from public.time_entries
         where user_id = old.user_id and work_date = old.work_date and id <> old.id;
        if others = 0 then
          raise exception 'A submitted timesheet must keep at least one entry. Edit the entry instead of deleting it.';
        end if;
      end if;
    end if;
    return old;
  end if;

  if new.work_date is null then new.work_date := today; end if;
  if new.user_id is distinct from auth.uid() then raise exception 'Not allowed.'; end if;
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.work_date <> old.work_date) then
    raise exception 'The date of a time entry cannot be changed.';
  end if;

  -- mandatory fields
  if new.project_id is null then
    raise exception 'Project is required.';
  end if;
  if new.start_time is null or new.end_time is null then
    raise exception 'Start time and end time are required.';
  end if;
  if coalesce(btrim(new.task), '') = '' then
    raise exception 'Task is required.';
  end if;
  if coalesce(btrim(new.description), '') = '' then
    raise exception 'Work description is required.';
  end if;
  if new.break_min is null or new.break_min < 0 then
    raise exception 'Break must be 0 minutes or more.';
  end if;

  select * into s from public.daily_timesheets
   where user_id = new.user_id and work_date = new.work_date for update;

  if not found then
    if new.work_date <> today then
      raise exception 'Time can only be logged for today (%). Past and future dates are not allowed.', today;
    end if;
    insert into public.daily_timesheets(user_id, work_date) values (new.user_id, new.work_date)
      on conflict (user_id, work_date) do nothing;
    select * into s from public.daily_timesheets
     where user_id = new.user_id and work_date = new.work_date for update;
  end if;

  if s.status = 'draft' then
    if new.work_date <> today then
      raise exception 'Time can only be logged for today (%). Past and future dates are not allowed.', today;
    end if;
  elsif s.status = 'changes' then
    null;  -- manager asked for corrections
  elsif s.status = 'submitted' then
    if s.reviewed_at is not null then
      raise exception 'Your manager has already reviewed this timesheet, so it can no longer be edited.';
    end if;
    if now() >= s.edit_until then
      raise exception 'The 30-minute editing period for this timesheet has ended.';
    end if;
  else
    raise exception 'This timesheet has already been reviewed and can no longer be changed.';
  end if;

  -- the client never decides these
  new.status := case s.status when 'draft' then 'draft' when 'changes' then 'changes' else 'submitted' end::public.entry_status;
  new.submitted_at := case when s.status = 'submitted' then s.submitted_at
                           when tg_op = 'UPDATE' then old.submitted_at else null end;
  if tg_op = 'UPDATE' then new.review_note := old.review_note; else new.review_note := null; end if;
  return new;
end $$;

drop trigger if exists time_entries_daily_rules on public.time_entries;
create trigger time_entries_daily_rules before insert or update on public.time_entries
  for each row execute function public.time_entry_daily_rules();
drop trigger if exists time_entries_daily_rules_del on public.time_entries;
create trigger time_entries_daily_rules_del before delete on public.time_entries
  for each row execute function public.time_entry_daily_rules();

-- ---------------------------------------------------------------------
-- Employee submits (or, after "changes requested", resubmits) ONE day.
-- p_date NULL = today. A draft can only be submitted on its own day.
-- ---------------------------------------------------------------------
create or replace function public.submit_timesheet_day(p_date date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  me    uuid := auth.uid();
  today date := public.org_today();
  d     date := coalesce(p_date, public.org_today());
  s     public.daily_timesheets;
  n     int;
  who   text;
  resub boolean;
begin
  if me is null or not public.is_member() then raise exception 'Not allowed.'; end if;
  if not exists (select 1 from public.profiles where id = me and tracks_time) then
    raise exception 'Time tracking is not switched on for your account.';
  end if;

  select * into s from public.daily_timesheets where user_id = me and work_date = d for update;
  if not found then raise exception 'There are no entries to submit for %.', d; end if;

  if s.status = 'draft' then
    if d <> today then
      raise exception 'Only today''s timesheet (%) can be submitted. Backdated submissions are not allowed.', today;
    end if;
    resub := false;
  elsif s.status = 'changes' then
    resub := true;
  elsif s.status = 'submitted' then
    raise exception 'The timesheet for % has already been submitted. Each day can only be submitted once.', d;
  else
    raise exception 'The timesheet for % has already been reviewed.', d;
  end if;

  select count(*) into n from public.time_entries where user_id = me and work_date = d;
  if n = 0 then raise exception 'Add at least one entry before submitting.'; end if;
  if exists (select 1 from public.time_entries
             where user_id = me and work_date = d
               and (coalesce(btrim(task), '') = '' or coalesce(btrim(description), '') = '')) then
    raise exception 'Every entry needs a task and a work description before the timesheet can be submitted.';
  end if;

  perform set_config('app.ts_internal', 'on', true);
  update public.daily_timesheets
     set status            = 'submitted',
         submitted_at      = coalesce(submitted_at, now()),   -- original time is kept on resubmission
         last_submitted_at = now(),
         edit_until        = now() + interval '30 minutes',
         resubmissions     = resubmissions + case when resub then 1 else 0 end,
         reviewed_by = null, reviewed_at = null, review_note = null,
         updated_at        = now()
   where id = s.id;
  update public.time_entries
     set status = 'submitted', submitted_at = coalesce(submitted_at, now()), review_note = null
   where user_id = me and work_date = d and status in ('draft', 'changes', 'rejected');
  perform set_config('app.ts_internal', 'off', true);

  insert into public.timesheet_reviews(user_id, week_start, work_date, actor_id, action)
  values (me, d - (extract(isodow from d)::int - 1), d, me, case when resub then 'Resubmitted' else 'Submitted' end);

  select full_name into who from public.profiles where id = me;
  -- timesheets keep the existing routing: line manager, or HR when there is none
  perform public._notify_approvers(me, 'approval',
    format('%s %s a timesheet for %s.', who, case when resub then 'resubmitted' else 'submitted' end, d),
    '/approvals?tab=timesheets');
  perform public._audit(case when resub then 'Timesheet resubmitted' else 'Timesheet submitted' end,
                        format('%s — %s (%s entries)', who, d, n));
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Manager (or HR — unchanged for timesheets) decides one submitted day.
-- Deciding immediately ends the employee's editing window.
-- ---------------------------------------------------------------------
create or replace function public.decide_timesheet_day(p_user uuid, p_date date, p_decision text, p_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me    uuid := auth.uid();
  s     public.daily_timesheets;
  actor text;
  emp   text;
  label text;
  note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_decision not in ('approved', 'rejected', 'changes') then raise exception 'Invalid decision.'; end if;
  if p_user = me then raise exception 'You cannot review your own timesheet.'; end if;
  if not (public.manages(p_user) or public.is_role('hr')) then raise exception 'Not allowed.'; end if;
  if p_decision <> 'approved' and note is null then
    raise exception 'Please add a note so the employee knows what to fix.';
  end if;

  select * into s from public.daily_timesheets where user_id = p_user and work_date = p_date for update;
  if not found or s.status <> 'submitted' then
    raise exception 'Nothing is waiting for review for this day.';
  end if;

  perform set_config('app.ts_internal', 'on', true);
  update public.daily_timesheets
     set status = p_decision::public.entry_status, reviewed_by = me, reviewed_at = now(),
         review_note = note, updated_at = now()
   where id = s.id;
  update public.time_entries
     set status = p_decision::public.entry_status, review_note = note
   where user_id = p_user and work_date = p_date and status = 'submitted';
  perform set_config('app.ts_internal', 'off', true);

  label := case p_decision when 'approved' then 'Approved' when 'rejected' then 'Rejected' else 'Changes requested' end;
  insert into public.timesheet_reviews(user_id, week_start, work_date, actor_id, action, note)
  values (p_user, p_date - (extract(isodow from p_date)::int - 1), p_date, me, label, coalesce(note, ''));

  select full_name into actor from public.profiles where id = me;
  select full_name into emp   from public.profiles where id = p_user;
  perform public._notify(p_user,
    case p_decision when 'approved' then 'ts_approved' else 'changes' end,
    format('%s %s your timesheet for %s.%s', actor,
           case p_decision when 'approved' then 'approved' when 'rejected' then 'rejected' else 'requested changes on' end,
           p_date, case when note is null then '' else ' "' || note || '"' end),
    case when p_decision = 'changes' then '/timesheet?correct=' || p_date else '/timesheet' end);
  perform public._audit('Timesheet ' || lower(label), format('%s — %s', emp, p_date));
end $$;

-- The old weekly workflow is replaced. Keep the functions (history) but switch them off.
create or replace function public.submit_week(p_week date) returns int
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Weekly submission has been replaced by daily timesheets. Submit today''s timesheet instead.';
end $$;

create or replace function public.decide_timesheet_week(p_user uuid, p_week date, p_decision text, p_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Weekly review has been replaced by daily timesheets. Review each day instead.';
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security for daily timesheets + updated time_entries policies
-- ---------------------------------------------------------------------
alter table public.daily_timesheets enable row level security;

drop policy if exists dts_read on public.daily_timesheets;
create policy dts_read on public.daily_timesheets for select to authenticated
  using (public.is_member() and (
         user_id = auth.uid()
      or public.manages(user_id)
      or public.is_role('hr', 'leadership')));
-- no insert / update / delete policies: only the database functions write this table

drop policy if exists te_insert on public.time_entries;
create policy te_insert on public.time_entries for insert to authenticated
  with check (public.is_member() and user_id = auth.uid()
              and public.timesheet_day_editable(user_id, work_date));

drop policy if exists te_update on public.time_entries;
create policy te_update on public.time_entries for update to authenticated
  using      (user_id = auth.uid() and public.timesheet_day_editable(user_id, work_date))
  with check (user_id = auth.uid() and public.timesheet_day_editable(user_id, work_date));

drop policy if exists te_delete on public.time_entries;
create policy te_delete on public.time_entries for delete to authenticated
  using (user_id = auth.uid() and public.timesheet_day_editable(user_id, work_date));

-- Privileges: the app reads daily timesheets but never writes them directly.
revoke all on public.daily_timesheets from anon, authenticated;
grant select on public.daily_timesheets to authenticated;

-- Employees can no longer write status, submission time, or move an entry to another date.
revoke insert, update on public.time_entries from authenticated;
grant insert (user_id, work_date, project_id, task, description, start_time, end_time, break_min)
  on public.time_entries to authenticated;
grant update (project_id, task, description, start_time, end_time, break_min)
  on public.time_entries to authenticated;

-- =====================================================================
-- 3. Leave: manager-only approval, no past dates, mandatory fields,
--    no cancelling approved leave
-- =====================================================================

-- Validation trigger (replaces the 0001 version; working-day, overlap and
-- balance logic are unchanged).
create or replace function public.leave_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  wd int;
  alloc numeric;
  used numeric;
  needs_check boolean;
  submitting boolean;
  today date := public.org_today();
begin
  new.updated_at := now();

  -- business rules for requests written by employees through the app / API
  if auth.uid() is not null then
    if new.end_date < new.start_date then
      raise exception 'The Last Day cannot be earlier than the First Day.';
    end if;
    submitting := new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending');
    if (tg_op = 'INSERT' or submitting
        or (old.start_date, old.end_date) is distinct from (new.start_date, new.end_date))
       and new.status in ('draft', 'pending')
       and new.start_date < today then
      raise exception 'Leave cannot start in the past. The earliest First Day is today (%).', today;
    end if;
    if submitting then
      if coalesce(btrim(new.reason), '') = '' then
        raise exception 'Please enter a reason for your leave.';
      end if;
      if public._leave_manager(new.user_id) is null then
        raise exception 'You do not have an active line manager. Ask HR or an administrator to assign your line manager on the People page before requesting leave.';
      end if;
    end if;
  end if;

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

-- Submitted -> history + notify the LINE MANAGER ONLY + audit.
-- (The HR fallback and the HR "FYI" for long leave are removed.)
create or replace function public.leave_after_write() returns trigger
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
    perform public._notify_leave_manager(new.user_id, 'approval', txt, '/approvals');
    perform public._audit('Leave submitted', format('%s — %s %s to %s', who, new.type, new.start_date, new.end_date));
  end if;
  return null;
end $$;

-- Only the employee's line manager may decide. HR is no longer a leave approver.
create or replace function public.decide_leave(p_id uuid, p_decision text, p_note text default '')
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
  if not public.manages(r.user_id) then
    raise exception 'Only the employee''s line manager can approve, reject or request changes on leave.';
  end if;
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

-- Employees may cancel drafts, pending and changes-requested requests — never approved leave.
create or replace function public.cancel_leave(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.leave_requests;
  who text;
begin
  select * into r from public.leave_requests where id = p_id and user_id = me for update;
  if not found then raise exception 'Leave request not found.'; end if;
  if r.status = 'approved' then
    raise exception 'Approved leave cannot be cancelled. Please speak to your line manager.';
  end if;
  if r.status not in ('draft','pending','changes') then raise exception 'This request cannot be cancelled.'; end if;
  update public.leave_requests set status = 'cancelled' where id = p_id;
  insert into public.leave_history(leave_id, actor_id, action) values (p_id, me, 'Cancelled');
  select full_name into who from public.profiles where id = me;
  if r.status = 'pending' then
    perform public._notify_leave_manager(me, 'info',
      format('%s cancelled %s leave (%s to %s).', who, r.type, r.start_date, r.end_date), '/approvals');
  end if;
  perform public._audit('Leave cancelled', format('%s — %s %s to %s', who, r.type, r.start_date, r.end_date));
end $$;

-- =====================================================================
-- 4. Function privileges
-- =====================================================================
revoke execute on function public.submit_week(date) from authenticated;
revoke execute on function public.decide_timesheet_week(uuid, date, text, text) from authenticated;

revoke execute on function
  public._ts_internal(), public._leave_manager(uuid),
  public._notify_leave_manager(uuid, text, text, text), public.time_entry_daily_rules()
from anon, authenticated, public;

grant execute on function
  public.org_today(),
  public.timesheet_day_editable(uuid, date),
  public.submit_timesheet_day(date),
  public.decide_timesheet_day(uuid, date, text, text)
to authenticated;

commit;

-- Ask the Supabase API to pick up the new table and functions straight away.
notify pgrst, 'reload schema';
