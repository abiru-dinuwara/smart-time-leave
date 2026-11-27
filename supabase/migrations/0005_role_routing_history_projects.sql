-- =====================================================================
-- 0005 — Role-based approval routing, immutable approval history,
--        organisation-wide history, project team assignments
--
-- Run AFTER 0001 … 0004, once, in Supabase: SQL Editor -> New query ->
-- paste -> Run. The whole file runs in one transaction: it either all
-- applies or nothing changes.
--
-- Safe for a live database:
--   * no tables are dropped and no business rows are deleted
--   * new columns are added and back-filled from existing data
--   * functions are replaced in place (CREATE OR REPLACE)
--
-- WHO APPROVES WHAT (decided by the database from the requester's profile,
-- never from anything the browser sends):
--   requester role employee / hr / admin   -> their ACTIVE line manager
--   requester role manager / pm / leadership -> HR
--   * nobody can decide their own request
--   * no line manager (manager route) or no active HR user (HR route)
--     -> the submission is refused with a clear message
--   * HR is never an automatic fallback for normal employees
--   * an administrator may still decide a manager-route request whose
--     requester has NO active line manager (only legacy requests from
--     before this migration, or a manager deactivated after submission)
-- =====================================================================

begin;

-- =====================================================================
-- 1. Routing helpers
-- =====================================================================

-- 'hr' for managers, project managers and leadership; 'manager' for everyone else.
create or replace function public._approval_route(p_emp uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p.role in ('manager', 'pm', 'leadership') then 'hr' else 'manager' end
  from public.profiles p where p.id = p_emp
$$;

-- The people who receive (and may decide) a request on the given route.
create or replace function public._route_approvers(p_emp uuid, p_route text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m from (select public._leave_manager(p_emp) as m) x
   where p_route = 'manager' and m is not null and m <> p_emp
  union
  select p.id from public.profiles p
   where p_route = 'hr' and p.role = 'hr' and p.active and p.id <> p_emp
$$;

-- Refuse a submission that nobody could approve.
create or replace function public._require_approver(p_emp uuid, p_route text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public._route_approvers(p_emp, p_route)) then
    if p_route = 'hr' then
      raise exception 'There is no active HR approver to send this request to. Ask an administrator to give someone the HR role.';
    else
      raise exception 'You do not have an active line manager, so this request cannot be sent. Ask HR or an administrator to assign your line manager on the People page.';
    end if;
  end if;
end $$;

-- May the logged-in user decide a request from p_emp on route p_route?
create or replace function public.can_decide_request(p_emp uuid, p_route text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.is_member() and p_emp <> auth.uid() and (
         (p_route = 'hr' and public.is_role('hr'))
      or (p_route = 'manager' and (
              public.manages(p_emp)
           or (public.is_role('admin') and public._leave_manager(p_emp) is null)))),
    false)
$$;

-- Kept for compatibility with 0004 (same meaning, now route-aware).
create or replace function public.can_decide_leave(p_emp uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_decide_request(p_emp, public._approval_route(p_emp))
$$;

-- Old helper (0001): HR fallback removed. Anything still calling it follows the new routing.
create or replace function public._notify_approvers(p_emp uuid, p_type text, p_text text, p_link text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, type, text, link)
  select a, p_type, p_text, p_link from public._route_approvers(p_emp, public._approval_route(p_emp)) a;
end $$;

create or replace function public._notify_route(p_emp uuid, p_route text, p_type text, p_text text, p_link text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, type, text, link)
  select a, p_type, p_text, p_link from public._route_approvers(p_emp, p_route) a;
end $$;

-- =====================================================================
-- 2. New columns (+ back-fill)
-- =====================================================================

alter table public.leave_requests   add column if not exists approval_route text;
alter table public.leave_requests   add column if not exists submitted_at timestamptz;
alter table public.leave_requests   add column if not exists last_submitted_at timestamptz;
alter table public.daily_timesheets add column if not exists approval_route text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_route_chk') then
    alter table public.leave_requests add constraint leave_requests_route_chk check (approval_route in ('manager', 'hr'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'daily_timesheets_route_chk') then
    alter table public.daily_timesheets add constraint daily_timesheets_route_chk check (approval_route in ('manager', 'hr'));
  end if;
end $$;

-- History rows: who owned the request, the status change, and the approver's role at the time.
alter table public.leave_history     add column if not exists owner_id    uuid references public.profiles(id) on delete cascade;
alter table public.leave_history     add column if not exists from_status text;
alter table public.leave_history     add column if not exists to_status   text;
alter table public.leave_history     add column if not exists actor_role  public.app_role;
alter table public.timesheet_reviews add column if not exists timesheet_id uuid references public.daily_timesheets(id) on delete cascade;
alter table public.timesheet_reviews add column if not exists from_status text;
alter table public.timesheet_reviews add column if not exists to_status   text;
alter table public.timesheet_reviews add column if not exists actor_role  public.app_role;

-- Back-fill (best effort for rows written before this migration).
update public.leave_requests l
   set submitted_at = coalesce(
         (select min(h.created_at) from public.leave_history h where h.leave_id = l.id and h.action in ('Submitted', 'Resubmitted')),
         l.created_at),
       last_submitted_at = coalesce(
         (select max(h.created_at) from public.leave_history h where h.leave_id = l.id and h.action in ('Submitted', 'Resubmitted')),
         l.created_at)
 where l.submitted_at is null
   and (l.status <> 'draft' and (l.status <> 'cancelled'
        or exists (select 1 from public.leave_history h where h.leave_id = l.id and h.action in ('Submitted', 'Resubmitted'))));

update public.leave_requests   set approval_route = public._approval_route(user_id) where approval_route is null and status <> 'draft';
update public.daily_timesheets set approval_route = public._approval_route(user_id) where approval_route is null and status <> 'draft';

update public.leave_history h
   set owner_id = l.user_id
  from public.leave_requests l
 where l.id = h.leave_id and h.owner_id is null;

update public.leave_history
   set from_status = case action when 'Submitted' then 'draft' when 'Resubmitted' then 'changes'
                                 when 'Approved' then 'pending' when 'Rejected' then 'pending'
                                 when 'Changes requested' then 'pending' else null end,
       to_status   = case action when 'Submitted' then 'pending' when 'Resubmitted' then 'pending'
                                 when 'Approved' then 'approved' when 'Rejected' then 'rejected'
                                 when 'Changes requested' then 'changes' when 'Cancelled' then 'cancelled' else null end
 where to_status is null;

update public.timesheet_reviews r
   set timesheet_id = s.id
  from public.daily_timesheets s
 where r.timesheet_id is null and r.work_date is not null
   and s.user_id = r.user_id and s.work_date = r.work_date;

update public.timesheet_reviews
   set from_status = case action when 'Submitted' then 'draft' when 'Resubmitted' then 'changes'
                                 when 'Approved' then 'submitted' when 'Rejected' then 'submitted'
                                 when 'Changes requested' then 'submitted' else null end,
       to_status   = case action when 'Submitted' then 'submitted' when 'Resubmitted' then 'submitted'
                                 when 'Approved' then 'approved' when 'Rejected' then 'rejected'
                                 when 'Changes requested' then 'changes' else null end
 where to_status is null;

-- =====================================================================
-- 3. Approval history is append-only
-- =====================================================================
-- Rows are written only by the workflow functions. Nobody using the app can
-- change or delete them (not even through SECURITY DEFINER functions). Only
-- the SQL editor / service role (auth.uid() is null) can — e.g. when an auth
-- user is permanently deleted and their rows cascade away.
create or replace function public._history_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  raise exception 'Approval history is permanent and cannot be changed or deleted.';
end $$;

drop trigger if exists leave_history_immutable on public.leave_history;
create trigger leave_history_immutable before update or delete on public.leave_history
  for each row execute function public._history_immutable();
drop trigger if exists timesheet_reviews_immutable on public.timesheet_reviews;
create trigger timesheet_reviews_immutable before update or delete on public.timesheet_reviews
  for each row execute function public._history_immutable();

revoke insert, update, delete on public.leave_history, public.timesheet_reviews from anon, authenticated;

-- Internal writers for history rows.
create or replace function public._log_leave(p_leave uuid, p_owner uuid, p_action text, p_from text, p_to text, p_note text default '')
returns void language sql security definer set search_path = '' as $$
  insert into public.leave_history(leave_id, owner_id, actor_id, actor_role, action, from_status, to_status, note)
  values (p_leave, p_owner, coalesce(auth.uid(), p_owner),
          (select role from public.profiles where id = coalesce(auth.uid(), p_owner)),
          p_action, p_from, p_to, coalesce(p_note, ''))
$$;

create or replace function public._log_timesheet(p_sheet uuid, p_owner uuid, p_date date, p_action text, p_from text, p_to text, p_note text default '')
returns void language sql security definer set search_path = '' as $$
  insert into public.timesheet_reviews(timesheet_id, user_id, week_start, work_date, actor_id, actor_role, action, from_status, to_status, note)
  values (p_sheet, p_owner, p_date - (extract(isodow from p_date)::int - 1), p_date, coalesce(auth.uid(), p_owner),
          (select role from public.profiles where id = coalesce(auth.uid(), p_owner)),
          p_action, p_from, p_to, coalesce(p_note, ''))
$$;

-- A draft that was submitted before has history: keep it (cancel instead of delete).
drop policy if exists lr_delete on public.leave_requests;
create policy lr_delete on public.leave_requests for delete to authenticated
  using (user_id = auth.uid() and status = 'draft' and submitted_at is null);

-- =====================================================================
-- 4. Leave workflow with role-based routing
-- =====================================================================

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
  submitting := new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending');

  if auth.uid() is not null then
    if new.end_date < new.start_date then
      raise exception 'The Last Day cannot be earlier than the First Day.';
    end if;
    if (tg_op = 'INSERT' or submitting
        or (old.start_date, old.end_date) is distinct from (new.start_date, new.end_date))
       and new.status in ('draft', 'pending')
       and new.start_date < today then
      raise exception 'Leave cannot start in the past. The earliest First Day is today (%).', today;
    end if;
    if submitting and coalesce(btrim(new.reason), '') = '' then
      raise exception 'Please enter a reason for your leave.';
    end if;
  end if;

  if submitting then
    -- the route comes from the requester's profile in the database, never from the client
    new.approval_route := public._approval_route(new.user_id);
    if auth.uid() is not null then
      perform public._require_approver(new.user_id, new.approval_route);
    end if;
    new.submitted_at      := case when tg_op = 'UPDATE' then coalesce(old.submitted_at, now()) else now() end;
    new.last_submitted_at := now();
    new.decided_by := null; new.decided_at := null; new.decision_note := null;
  elsif tg_op = 'UPDATE' then
    -- these are owned by the workflow, never by the client
    new.approval_route    := old.approval_route;
    new.submitted_at      := old.submitted_at;
    new.last_submitted_at := old.last_submitted_at;
  else
    new.approval_route := null; new.submitted_at := null; new.last_submitted_at := null;
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
    new.days := old.days;
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

create or replace function public.leave_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who   text;
  role_ public.app_role;
  txt   text;
  resub boolean;
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    -- submitted before (e.g. changes requested, then saved as draft, then sent again)
    resub := tg_op = 'UPDATE' and old.submitted_at is not null;
    select full_name, role into who, role_ from public.profiles where id = new.user_id;
    perform public._log_leave(new.id, new.user_id, case when resub then 'Resubmitted' else 'Submitted' end,
                              case when tg_op = 'INSERT' then null else old.status::text end, 'pending');
    txt := format('%s%s requested %s day(s) of %s leave (%s to %s).',
                  who, case when new.approval_route = 'hr' then format(' (%s)', initcap(case role_ when 'pm' then 'project manager' else role_::text end)) else '' end,
                  new.days, new.type, new.start_date, new.end_date);
    perform public._notify_route(new.user_id, new.approval_route, 'approval', txt, '/approvals');
    perform public._audit(case when resub then 'Leave resubmitted' else 'Leave submitted' end,
                          format('%s — %s %s to %s (to %s)', who, new.type, new.start_date, new.end_date,
                                 case new.approval_route when 'hr' then 'HR' else 'line manager' end));
  end if;
  return null;
end $$;

create or replace function public.decide_leave(p_id uuid, p_decision text, p_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me    uuid := auth.uid();
  r     public.leave_requests;
  route text;
  actor text;
  emp   text;
  label text;
  note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if me is null or not public.is_member() then raise exception 'Not allowed.'; end if;
  if p_decision not in ('approved','rejected','changes') then raise exception 'Invalid decision.'; end if;
  select * into r from public.leave_requests where id = p_id for update;
  if not found then raise exception 'Leave request not found.'; end if;
  if r.user_id = me then raise exception 'You cannot decide your own leave request.'; end if;
  route := coalesce(r.approval_route, public._approval_route(r.user_id));
  if not public.can_decide_request(r.user_id, route) then
    if route = 'hr' then
      raise exception 'Leave requests from managers, project managers and leadership are decided by HR.';
    end if;
    raise exception 'Only the employee''s line manager can decide this leave request.';
  end if;
  if r.status <> 'pending' then raise exception 'This request is no longer pending.'; end if;
  if p_decision <> 'approved' and note is null then
    raise exception 'Please add a note so the employee knows why.';
  end if;

  update public.leave_requests
     set status = p_decision::public.leave_status, decided_by = me, decided_at = now(), decision_note = note
   where id = p_id;

  label := case p_decision when 'approved' then 'Approved' when 'rejected' then 'Rejected' else 'Changes requested' end;
  perform public._log_leave(p_id, r.user_id, label, 'pending', p_decision, coalesce(note, ''));

  select full_name into actor from public.profiles where id = me;
  select full_name into emp   from public.profiles where id = r.user_id;
  perform public._notify(r.user_id,
    case p_decision when 'approved' then 'leave_approved' when 'rejected' then 'leave_rejected' else 'changes' end,
    format('%s%s %s your %s leave (%s to %s).%s', actor, case when route = 'hr' then ' (HR)' else '' end,
           case p_decision when 'approved' then 'approved' when 'rejected' then 'rejected' else 'requested changes on' end,
           r.type, r.start_date, r.end_date,
           case when note is null then '' else ' "' || note || '"' end),
    case when p_decision = 'changes' then '/leave?edit=' || p_id else '/leave?tab=history' end);
  perform public._audit('Leave ' || lower(label), format('%s — %s %s to %s', emp, r.type, r.start_date, r.end_date));
end $$;

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
    raise exception 'Approved leave cannot be cancelled. Please speak to your approver.';
  end if;
  if r.status not in ('draft','pending','changes') then raise exception 'This request cannot be cancelled.'; end if;
  update public.leave_requests set status = 'cancelled' where id = p_id;
  perform public._log_leave(p_id, me, 'Cancelled', r.status::text, 'cancelled');
  select full_name into who from public.profiles where id = me;
  if r.status = 'pending' then
    perform public._notify_route(me, coalesce(r.approval_route, public._approval_route(me)), 'info',
      format('%s cancelled %s leave (%s to %s).', who, r.type, r.start_date, r.end_date), '/approvals');
  end if;
  perform public._audit('Leave cancelled', format('%s — %s %s to %s', who, r.type, r.start_date, r.end_date));
end $$;

-- =====================================================================
-- 5. Daily timesheet workflow with role-based routing
-- =====================================================================

create or replace function public.submit_timesheet_day(p_date date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  me    uuid := auth.uid();
  today date := public.org_today();
  d     date := coalesce(p_date, public.org_today());
  s     public.daily_timesheets;
  n     int;
  who   text;
  role_ public.app_role;
  route text;
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

  route := public._approval_route(me);
  perform public._require_approver(me, route);

  perform set_config('app.ts_internal', 'on', true);
  update public.daily_timesheets
     set status            = 'submitted',
         approval_route    = route,
         submitted_at      = coalesce(submitted_at, now()),
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

  perform public._log_timesheet(s.id, me, d, case when resub then 'Resubmitted' else 'Submitted' end, s.status::text, 'submitted');

  select full_name, role into who, role_ from public.profiles where id = me;
  perform public._notify_route(me, route, 'approval',
    format('%s%s %s a timesheet for %s.', who,
           case when route = 'hr' then format(' (%s)', initcap(case role_ when 'pm' then 'project manager' else role_::text end)) else '' end,
           case when resub then 'resubmitted' else 'submitted' end, d),
    '/approvals?tab=timesheets');
  perform public._audit(case when resub then 'Timesheet resubmitted' else 'Timesheet submitted' end,
                        format('%s — %s (%s entries, to %s)', who, d, n, case route when 'hr' then 'HR' else 'line manager' end));
  return n;
end $$;

create or replace function public.decide_timesheet_day(p_user uuid, p_date date, p_decision text, p_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me    uuid := auth.uid();
  s     public.daily_timesheets;
  route text;
  actor text;
  emp   text;
  label text;
  note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if me is null or not public.is_member() then raise exception 'Not allowed.'; end if;
  if p_decision not in ('approved', 'rejected', 'changes') then raise exception 'Invalid decision.'; end if;
  if p_user = me then raise exception 'You cannot review your own timesheet.'; end if;

  select * into s from public.daily_timesheets where user_id = p_user and work_date = p_date for update;
  if not found or s.status <> 'submitted' then
    raise exception 'Nothing is waiting for review for this day.';
  end if;
  route := coalesce(s.approval_route, public._approval_route(p_user));
  if not public.can_decide_request(p_user, route) then
    if route = 'hr' then
      raise exception 'Timesheets from managers, project managers and leadership are reviewed by HR.';
    end if;
    raise exception 'Only the employee''s line manager can review this timesheet.';
  end if;
  if p_decision <> 'approved' and note is null then
    raise exception 'Please add a note so the employee knows what to fix.';
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
  perform public._log_timesheet(s.id, p_user, p_date, label, 'submitted', p_decision, coalesce(note, ''));

  select full_name into actor from public.profiles where id = me;
  select full_name into emp   from public.profiles where id = p_user;
  perform public._notify(p_user,
    case p_decision when 'approved' then 'ts_approved' else 'changes' end,
    format('%s%s %s your timesheet for %s.%s', actor, case when route = 'hr' then ' (HR)' else '' end,
           case p_decision when 'approved' then 'approved' when 'rejected' then 'rejected' else 'requested changes on' end,
           p_date, case when note is null then '' else ' "' || note || '"' end),
    case when p_decision = 'changes' then '/timesheet?correct=' || p_date else '/timesheet?tab=history' end);
  perform public._audit('Timesheet ' || lower(label), format('%s — %s', emp, p_date));
end $$;

-- =====================================================================
-- 6. Project team assignments
-- =====================================================================

create table if not exists public.project_members (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  employee_id   uuid not null references public.profiles(id) on delete cascade,
  assigned_by   uuid references public.profiles(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  unassigned_by uuid references public.profiles(id) on delete set null,
  unassigned_at timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint project_members_active_chk check (active = (unassigned_at is null))
);
-- one ACTIVE assignment per person per project; past assignments are kept as history
create unique index if not exists project_members_one_active on public.project_members(project_id, employee_id) where active;
create index if not exists project_members_employee_idx on public.project_members(employee_id) where active;
create index if not exists project_members_project_idx on public.project_members(project_id, assigned_at desc);

-- Back-fill: everyone who has already logged time on an ACTIVE project is assigned to it,
-- so nobody loses access to a project they are working on today.
insert into public.project_members(project_id, employee_id, assigned_at)
select t.project_id, t.user_id, min(t.created_at)
from public.time_entries t
join public.projects p on p.id = t.project_id and p.status = 'active'
join public.profiles u on u.id = t.user_id and u.active
where not exists (select 1 from public.project_members m
                  where m.project_id = t.project_id and m.employee_id = t.user_id and m.active)
group by t.project_id, t.user_id;

-- May the logged-in user change this project's team?
-- HR and administrators: any project. Project managers: only projects they manage.
-- Leadership: read-only.
create or replace function public.can_manage_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.is_member() and (
           public.is_role('admin', 'hr')
        or (public.is_role('pm') and exists (select 1 from public.projects p where p.id = p_project and p.pm_id = auth.uid()))),
         false)
$$;

-- Can p_user log time on p_project? Active project and (its PM, or an active team member).
create or replace function public._can_log_to_project(p_user uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project and p.status = 'active'
      and (p.pm_id = p_user
           or exists (select 1 from public.project_members m
                      where m.project_id = p.id and m.employee_id = p_user and m.active)))
$$;

-- Projects the logged-in user may log time on (for the timesheet form).
create or replace function public.my_loggable_projects()
returns table (id uuid, code text, name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.code, p.name
  from public.projects p
  where public.is_member() and p.status = 'active'
    and (p.pm_id = auth.uid()
         or exists (select 1 from public.project_members m
                    where m.project_id = p.id and m.employee_id = auth.uid() and m.active))
  order by p.code
$$;

create or replace function public.assign_project_member(p_project uuid, p_employee uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me    uuid := auth.uid();
  pr    public.projects;
  emp   public.profiles;
  new_id uuid;
begin
  if me is null or not public.is_member() then raise exception 'Not allowed.'; end if;
  if not public.can_manage_project(p_project) then
    raise exception 'You can only change the team of projects you manage.';
  end if;
  select * into pr from public.projects where id = p_project for update;
  if not found then raise exception 'Project not found.'; end if;
  if pr.status <> 'active' then
    raise exception 'Project % is archived. Reactivate it before assigning people.', pr.code;
  end if;
  select * into emp from public.profiles where id = p_employee;
  if not found then raise exception 'Employee not found.'; end if;
  if not emp.active then raise exception '% is inactive and cannot be assigned to a project.', emp.full_name; end if;
  if exists (select 1 from public.project_members
             where project_id = p_project and employee_id = p_employee and active) then
    raise exception '% is already assigned to %.', emp.full_name, pr.code;
  end if;

  begin
    insert into public.project_members(project_id, employee_id, assigned_by)
    values (p_project, p_employee, me) returning id into new_id;
  exception when unique_violation then
    raise exception '% is already assigned to %.', emp.full_name, pr.code;
  end;

  if p_employee <> me then
    perform public._notify(p_employee, 'info',
      format('%s added you to project %s — %s. You can now log time on it.',
             (select full_name from public.profiles where id = me), pr.code, pr.name), '/timesheet');
  end if;
  perform public._audit('Project member assigned', format('%s → %s %s', emp.full_name, pr.code, pr.name));
  return new_id;
end $$;

create or replace function public.unassign_project_member(p_project uuid, p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  uuid := auth.uid();
  pr  public.projects;
  m   public.project_members;
  who text;
begin
  if me is null or not public.is_member() then raise exception 'Not allowed.'; end if;
  if not public.can_manage_project(p_project) then
    raise exception 'You can only change the team of projects you manage.';
  end if;
  select * into pr from public.projects where id = p_project;
  if not found then raise exception 'Project not found.'; end if;
  select * into m from public.project_members
   where project_id = p_project and employee_id = p_employee and active for update;
  if not found then raise exception 'This person is not currently assigned to %.', pr.code; end if;

  update public.project_members
     set active = false, unassigned_at = now(), unassigned_by = me, updated_at = now()
   where id = m.id;

  select full_name into who from public.profiles where id = p_employee;
  if p_employee <> me then
    perform public._notify(p_employee, 'info',
      format('%s removed you from project %s — %s. Your past time entries are unchanged.',
             (select full_name from public.profiles where id = me), pr.code, pr.name), '/timesheet');
  end if;
  perform public._audit('Project member unassigned', format('%s ← %s %s', who, pr.code, pr.name));
end $$;

alter table public.project_members enable row level security;
drop policy if exists pm_read on public.project_members;
create policy pm_read on public.project_members for select to authenticated
  using (public.is_member() and (
         employee_id = auth.uid()
      or public.is_role('hr', 'admin', 'leadership')
      or exists (select 1 from public.projects p where p.id = project_id and p.pm_id = auth.uid())));
-- no insert / update / delete policies: only assign_project_member / unassign_project_member write
revoke all on public.project_members from anon, authenticated;
grant select on public.project_members to authenticated;

-- Timesheet rule: time can only be logged on projects you are assigned to.
-- Checked only when an entry is created or moved to another project, so
-- historical entries stay valid after someone is unassigned.
create or replace function public.time_entry_daily_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s     public.daily_timesheets;
  today date := public.org_today();
  others int;
begin
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

  if new.project_id is null then raise exception 'Project is required.'; end if;
  if new.start_time is null or new.end_time is null then
    raise exception 'Start time and end time are required.';
  end if;
  if coalesce(btrim(new.task), '') = '' then raise exception 'Task is required.'; end if;
  if coalesce(btrim(new.description), '') = '' then raise exception 'Work description is required.'; end if;
  if new.break_min is null or new.break_min < 0 then raise exception 'Break must be 0 minutes or more.'; end if;

  if (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
     and not public._can_log_to_project(new.user_id, new.project_id) then
    raise exception 'You are not assigned to this project (or it is archived). Ask the project manager to add you to the project team.';
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
    null;
  elsif s.status = 'submitted' then
    if s.reviewed_at is not null then
      raise exception 'This timesheet has already been reviewed, so it can no longer be edited.';
    end if;
    if now() >= s.edit_until then
      raise exception 'The 30-minute editing period for this timesheet has ended.';
    end if;
  else
    raise exception 'This timesheet has already been reviewed and can no longer be changed.';
  end if;

  new.status := case s.status when 'draft' then 'draft' when 'changes' then 'changes' else 'submitted' end::public.entry_status;
  new.submitted_at := case when s.status = 'submitted' then s.submitted_at
                           when tg_op = 'UPDATE' then old.submitted_at else null end;
  if tg_op = 'UPDATE' then new.review_note := old.review_note; else new.review_note := null; end if;
  return new;
end $$;

-- =====================================================================
-- 7. Read access (RLS) for the new routing
-- =====================================================================
-- Unchanged: employees read their own rows; line managers read their direct
-- reports; HR (and leadership, read-only) read everyone. Added: an
-- administrator can read manager-route items of people with no active line
-- manager (the legacy case they may still decide).
drop policy if exists dts_read_admin on public.daily_timesheets;
create policy dts_read_admin on public.daily_timesheets for select to authenticated
  using (public.is_role('admin') and public._leave_manager(user_id) is null);
drop policy if exists te_read_admin on public.time_entries;
create policy te_read_admin on public.time_entries for select to authenticated
  using (public.is_role('admin') and public._leave_manager(user_id) is null);
drop policy if exists tr_read_admin on public.timesheet_reviews;
create policy tr_read_admin on public.timesheet_reviews for select to authenticated
  using (public.is_role('admin') and public._leave_manager(user_id) is null);

-- =====================================================================
-- 8. Approval queue + history (one function for both)
-- =====================================================================
-- Scope (enforced here, not by the caller):
--   HR            -> every employee (organisation-wide)
--   line manager  -> their direct reports
--   anyone        -> requests they decided themselves
--   administrator -> manager-route requests of people without an active line manager
-- Your OWN requests are never listed here (see My Timesheet / My Leave).
create or replace function public.approval_records(
  p_kind       text             default null,   -- 'leave' | 'timesheet'
  p_status     text             default null,   -- 'pending' | 'approved' | 'rejected' | 'changes' | 'cancelled'
  p_q          text             default null,   -- employee name or email
  p_department text             default null,
  p_role       public.app_role  default null,
  p_project    uuid             default null,   -- timesheets containing this project
  p_approver   uuid             default null,
  p_from       date             default null,
  p_to         date             default null,
  p_sort       text             default 'submitted',  -- submitted | decided | date | name
  p_dir        text             default 'desc',
  p_limit      int              default 25,
  p_offset     int              default 0,
  p_actionable boolean          default false   -- only items I can decide now
) returns table (
  kind text, request_id uuid, owner_id uuid, owner_name text, owner_department text,
  owner_position text, owner_role public.app_role, route text, status text, raw_status text,
  submitted_at timestamptz, last_submitted_at timestamptz, decided_at timestamptz,
  approver_id uuid, approver_name text, decision_note text,
  leave_type public.leave_type, start_date date, end_date date, days numeric, half text, reason text,
  work_date date, edit_until timestamptz, resubmissions int,
  total_minutes numeric, entry_count int, projects text,
  can_decide boolean, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  me       uuid    := auth.uid();
  is_hr    boolean := public.is_role('hr');
  is_admin boolean := public.is_role('admin');
  q        text    := nullif(btrim(coalesce(p_q, '')), '');
  dir_asc  boolean := lower(coalesce(p_dir, 'desc')) = 'asc';
begin
  if me is null or not public.is_member() then raise exception 'Not allowed.'; end if;
  p_limit  := least(greatest(coalesce(p_limit, 25), 1), 200);
  p_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  with base as (
    select 'leave'::text as k, l.id, l.user_id, l.approval_route as rt,
           l.status::text as raw, l.submitted_at as sub, l.last_submitted_at as lsub,
           l.decided_at as dec, l.decided_by as dby, l.decision_note as dnote,
           l.type as ltype, l.start_date as sd, l.end_date as ed, l.days as dd, l.half as hf, l.reason as rs,
           null::date as wd, null::timestamptz as eu, 0 as resub
    from public.leave_requests l
    where l.status <> 'draft' and l.submitted_at is not null
      and (p_kind is null or p_kind = 'leave')
      and p_project is null
      and (p_from is null or l.end_date >= p_from)
      and (p_to   is null or l.start_date <= p_to)
    union all
    select 'timesheet', s.id, s.user_id, s.approval_route,
           s.status::text, s.submitted_at, s.last_submitted_at,
           s.reviewed_at, s.reviewed_by, s.review_note,
           null, null, null, null, null, null,
           s.work_date, s.edit_until, s.resubmissions
    from public.daily_timesheets s
    where s.status <> 'draft'
      and (p_kind is null or p_kind = 'timesheet')
      and (p_project is null or exists (select 1 from public.time_entries t
                                        where t.user_id = s.user_id and t.work_date = s.work_date and t.project_id = p_project))
      and (p_from is null or s.work_date >= p_from)
      and (p_to   is null or s.work_date <= p_to)
  ),
  scoped as (
    select b.*, o.full_name as oname, o.department as odept, o.position as opos, o.role as orole,
           coalesce(b.rt, case when o.role in ('manager','pm','leadership') then 'hr' else 'manager' end) as eff_route,
           case b.raw when 'submitted' then 'pending' else b.raw end as st,
           not exists (select 1 from public.profiles mm where mm.id = o.manager_id and mm.active) as no_mgr,
           o.manager_id as omgr
    from base b
    join public.profiles o on o.id = b.user_id
    where b.user_id <> me
      and (q is null or o.full_name ilike '%' || q || '%' or o.email ilike '%' || q || '%')
      and (p_department is null or o.department = p_department)
      and (p_role is null or o.role = p_role)
      and (p_approver is null or b.dby = p_approver)
  ),
  decorated as (
    select sc.*,
           (sc.raw in ('pending', 'submitted') and (
                (sc.eff_route = 'hr' and is_hr)
             or (sc.eff_route = 'manager' and (sc.omgr = me or (is_admin and sc.no_mgr))))) as cd
    from scoped sc
    where (is_hr or sc.omgr = me or sc.dby = me or (is_admin and sc.no_mgr and sc.eff_route = 'manager'))
      and (p_status is null or sc.st = p_status)
  ),
  page as (
    select d.*, count(*) over () as total
    from decorated d
    where not p_actionable or d.cd
    order by
      case when dir_asc and p_sort = 'name' then d.oname end asc,
      case when not dir_asc and p_sort = 'name' then d.oname end desc,
      case when dir_asc then
        case p_sort when 'decided' then d.dec
                    when 'date'    then coalesce(d.wd, d.sd)::timestamptz
                    else d.sub end end asc nulls last,
      case when not dir_asc then
        case p_sort when 'decided' then d.dec
                    when 'date'    then coalesce(d.wd, d.sd)::timestamptz
                    else d.sub end end desc nulls last,
      d.id
    limit p_limit offset p_offset
  )
  select pg.k, pg.id, pg.user_id, pg.oname, pg.odept, pg.opos, pg.orole, pg.eff_route, pg.st, pg.raw,
         pg.sub, pg.lsub, pg.dec, pg.dby, a.full_name, pg.dnote,
         pg.ltype, pg.sd, pg.ed, pg.dd, pg.hf, pg.rs,
         pg.wd, pg.eu, pg.resub,
         agg.mins, coalesce(agg.n, 0)::int, agg.codes,
         pg.cd, pg.total
  from page pg
  left join public.profiles a on a.id = pg.dby
  left join lateral (
    select sum(extract(epoch from (t.end_time - t.start_time)) / 60 - t.break_min)::numeric as mins,
           count(*)::int as n,
           string_agg(distinct pj.code, ', ' order by pj.code) as codes
    from public.time_entries t
    join public.projects pj on pj.id = t.project_id
    where pg.k = 'timesheet' and t.user_id = pg.user_id and t.work_date = pg.wd
  ) agg on true
  order by
    case when dir_asc and p_sort = 'name' then pg.oname end asc,
    case when not dir_asc and p_sort = 'name' then pg.oname end desc,
    case when dir_asc then
      case p_sort when 'decided' then pg.dec when 'date' then coalesce(pg.wd, pg.sd)::timestamptz else pg.sub end end asc nulls last,
    case when not dir_asc then
      case p_sort when 'decided' then pg.dec when 'date' then coalesce(pg.wd, pg.sd)::timestamptz else pg.sub end end desc nulls last,
    pg.id;
end $$;

-- Number of items the logged-in user can decide right now (menu badge, dashboards).
create or replace function public.approval_counts()
returns table (leave_pending int, timesheet_pending int)
language sql stable security definer set search_path = '' as $$
  with me as (
    select auth.uid() as id, public.is_role('hr') as hr, public.is_role('admin') as adm
    where public.is_member()
  )
  select
    (select count(*)::int from public.leave_requests l
       join public.profiles o on o.id = l.user_id, me
      where l.status = 'pending' and l.user_id <> me.id
        and ((coalesce(l.approval_route, public._approval_route(l.user_id)) = 'hr' and me.hr)
          or (coalesce(l.approval_route, public._approval_route(l.user_id)) = 'manager'
              and (o.manager_id = me.id
                   or (me.adm and not exists (select 1 from public.profiles m where m.id = o.manager_id and m.active)))))),
    (select count(*)::int from public.daily_timesheets s
       join public.profiles o on o.id = s.user_id, me
      where s.status = 'submitted' and s.user_id <> me.id
        and ((coalesce(s.approval_route, public._approval_route(s.user_id)) = 'hr' and me.hr)
          or (coalesce(s.approval_route, public._approval_route(s.user_id)) = 'manager'
              and (o.manager_id = me.id
                   or (me.adm and not exists (select 1 from public.profiles m where m.id = o.manager_id and m.active))))))
$$;

-- =====================================================================
-- 9. Organisation overview (HR, leadership, administrators) — totals only,
--    no leave reasons or individual timesheet details.
-- =====================================================================
create or replace function public.org_overview(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  today date := public.org_today();
  res   jsonb;
begin
  if not public.is_role('hr', 'leadership', 'admin') then raise exception 'Not allowed.'; end if;
  with away as (
    select distinct l.user_id from public.leave_requests l
    where l.status = 'approved' and today between l.start_date and l.end_date
  ),
  hours as (
    select t.project_id,
           sum(extract(epoch from (t.end_time - t.start_time)) / 3600 - t.break_min / 60.0) as h
    from public.time_entries t where t.status = 'approved' group by t.project_id
  )
  select jsonb_build_object(
    'active_employees', (select count(*) from public.profiles where active),
    'away_today', (select count(*) from away a join public.profiles p on p.id = a.user_id and p.active),
    'by_department', coalesce((
      select jsonb_agg(jsonb_build_object('department', d, 'headcount', n, 'away_today', a) order by n desc, d)
      from (select coalesce(nullif(btrim(p.department), ''), 'Unassigned') as d, count(*) as n,
                   count(*) filter (where p.id in (select user_id from away)) as a
            from public.profiles p where p.active group by 1) x), '[]'::jsonb),
    'by_role', coalesce((
      select jsonb_object_agg(role, n) from (select role, count(*) as n from public.profiles where active group by role) r), '{}'::jsonb),
    'leave', (
      select jsonb_build_object(
        'pending',       count(*) filter (where status = 'pending'),
        'approved',      count(*) filter (where status = 'approved' and decided_at >= p_from and decided_at < p_to + 1),
        'rejected',      count(*) filter (where status = 'rejected' and decided_at >= p_from and decided_at < p_to + 1),
        'changes',       count(*) filter (where status = 'changes'  and decided_at >= p_from and decided_at < p_to + 1),
        'approved_days', coalesce(sum(days) filter (where status = 'approved' and start_date between p_from and p_to), 0))
      from public.leave_requests),
    'timesheets', (
      select jsonb_build_object(
        'pending',  count(*) filter (where status = 'submitted'),
        'approved', count(*) filter (where status = 'approved' and reviewed_at >= p_from and reviewed_at < p_to + 1),
        'rejected', count(*) filter (where status = 'rejected' and reviewed_at >= p_from and reviewed_at < p_to + 1),
        'changes',  count(*) filter (where status = 'changes'  and reviewed_at >= p_from and reviewed_at < p_to + 1))
      from public.daily_timesheets),
    'approved_hours', (
      select coalesce(round(sum(extract(epoch from (t.end_time - t.start_time)) / 3600 - t.break_min / 60.0)::numeric, 1), 0)
      from public.time_entries t where t.status = 'approved' and t.work_date between p_from and p_to),
    'projects', (
      select jsonb_build_object(
        'active',      count(*) filter (where p.status = 'active'),
        'archived',    count(*) filter (where p.status = 'archived'),
        'overdue',     count(*) filter (where p.status = 'active' and p.deadline < today),
        'over_budget', count(*) filter (where p.status = 'active' and p.planned_hours > 0
                                         and p.prior_hours + coalesce(h.h, 0) > p.planned_hours))
      from public.projects p left join hours h on h.project_id = p.id)
  ) into res;
  return res;
end $$;

-- =====================================================================
-- 10. Re-route requests that are already waiting
-- =====================================================================
-- Pending requests from managers / PMs / leadership were sent to their line
-- manager by the old rules. They are now HR's: tell HR once.
insert into public.notifications(user_id, type, text, link)
select h.id, 'approval',
       format('%s request(s) from managers, project managers or leadership were moved to HR for approval.', x.n),
       '/approvals'
from (select count(*) as n from (
        select 1 from public.leave_requests where status = 'pending' and approval_route = 'hr'
        union all
        select 1 from public.daily_timesheets where status = 'submitted' and approval_route = 'hr') y) x
cross join public.profiles h
where x.n > 0 and h.role = 'hr' and h.active
  and not exists (select 1 from public.notifications n
                  where n.user_id = h.id and n.text like '%were moved to HR for approval.');

-- =====================================================================
-- 11. Indexes for the new queries
-- =====================================================================
create index if not exists leave_requests_pending_idx      on public.leave_requests(approval_route) where status = 'pending';
create index if not exists daily_timesheets_submitted_idx  on public.daily_timesheets(approval_route) where status = 'submitted';
create index if not exists leave_requests_submitted_at_idx on public.leave_requests(submitted_at desc) where submitted_at is not null;
create index if not exists leave_requests_decided_by_idx   on public.leave_requests(decided_by) where decided_by is not null;
create index if not exists daily_timesheets_sub_at_idx     on public.daily_timesheets(submitted_at desc) where status <> 'draft';
create index if not exists daily_timesheets_reviewer_idx   on public.daily_timesheets(reviewed_by) where reviewed_by is not null;
create index if not exists time_entries_user_date_idx      on public.time_entries(user_id, work_date);
create index if not exists time_entries_status_date_idx    on public.time_entries(status, work_date);
create index if not exists timesheet_reviews_sheet_idx     on public.timesheet_reviews(timesheet_id, created_at);
create index if not exists leave_history_owner_idx         on public.leave_history(owner_id, created_at desc);
create index if not exists profiles_role_active_idx        on public.profiles(role) where active;
create index if not exists profiles_department_idx         on public.profiles(department) where active;
create index if not exists projects_pm_idx                 on public.projects(pm_id);

-- =====================================================================
-- 12. Function privileges
-- =====================================================================
revoke execute on function
  public._approval_route(uuid), public._route_approvers(uuid, text), public._require_approver(uuid, text),
  public._notify_route(uuid, text, text, text, text), public._history_immutable(),
  public._log_leave(uuid, uuid, text, text, text, text),
  public._log_timesheet(uuid, uuid, date, text, text, text, text),
  public._can_log_to_project(uuid, uuid)
from anon, authenticated, public;

grant execute on function
  public.can_decide_request(uuid, text),
  public.can_decide_leave(uuid),
  public.can_manage_project(uuid),
  public.my_loggable_projects(),
  public.assign_project_member(uuid, uuid),
  public.unassign_project_member(uuid, uuid),
  public.approval_records(text, text, text, text, public.app_role, uuid, uuid, date, date, text, text, int, int, boolean),
  public.approval_counts(),
  public.org_overview(date, date)
to authenticated;

commit;

notify pgrst, 'reload schema';
