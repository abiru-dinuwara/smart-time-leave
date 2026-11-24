-- =====================================================================
-- 0004 — Employees can request leave even without an active line manager
--
-- Run AFTER 0003. Safe on a live database (functions/policies only, no data changes).
--
-- Who decides a leave request:
--   * the employee's ACTIVE line manager (unchanged), otherwise
--   * the System Administrator(s).
-- HR is still not a leave approver.
-- =====================================================================

begin;

-- Who should approve p_emp's leave: active line manager, or every active admin.
create or replace function public._leave_approvers(p_emp uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m from (select public._leave_manager(p_emp) as m) x where m is not null
  union all
  select p.id from public.profiles p
  where public._leave_manager(p_emp) is null
    and p.role = 'admin' and p.active and p.id <> p_emp
$$;

-- May the logged-in user decide p_emp's leave?
create or replace function public.can_decide_leave(p_emp uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_emp <> auth.uid() and (
         public.manages(p_emp)
      or (public._leave_manager(p_emp) is null and public.is_role('admin'))),
    false)
$$;

-- Notifications go to the approvers above (never to HR).
create or replace function public._notify_leave_manager(p_emp uuid, p_type text, p_text text, p_link text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, type, text, link)
  select a, p_type, p_text, p_link from public._leave_approvers(p_emp) a;
end $$;

-- Validation: same as 0003 but WITHOUT the "must have a line manager" block.
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
    if submitting and coalesce(btrim(new.reason), '') = '' then
      raise exception 'Please enter a reason for your leave.';
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

-- decide_leave: line manager, or admin when there is no active line manager.
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
  if not public.can_decide_leave(r.user_id) then
    raise exception 'Only the employee''s line manager (or an administrator when there is no line manager) can decide this leave request.';
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

-- Admins must be able to read the requests they now approve.
drop policy if exists lr_read_admin on public.leave_requests;
create policy lr_read_admin on public.leave_requests for select to authenticated
  using (public.is_role('admin') and public._leave_manager(user_id) is null);

revoke execute on function public._leave_approvers(uuid) from anon, authenticated, public;
grant execute on function public.can_decide_leave(uuid), public._leave_manager(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
