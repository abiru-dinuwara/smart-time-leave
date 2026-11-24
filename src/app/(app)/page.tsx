import Link from 'next/link'
import { requireContext } from '@/lib/auth'
import { Icon } from '@/components/Icon'
import { Badge, Bar, Empty, PageHead, Stat } from '@/components/ui'
import { addDays, entryMinutes, fmtDateTime, fmtMinutes, fmtRange, mondayOf, n1 } from '@/lib/dates'
import { LEAVE_LABEL, LEAVE_STATUS_LABEL, type LeaveBalanceRow, type LeaveRequest, type TimeEntry } from '@/lib/types'

export const metadata = { title: 'Dashboard' }

export default async function Dashboard() {
  const { supabase, profile, org, today, isApprover, leaveApproveIds } = await requireContext()
  const weekStart = mondayOf(today)
  const weekEnd = addDays(weekStart, 6)
  const year = Number(today.slice(0, 4))

  const [entries, balance, upcoming, notifs, pendingLeave, submittedDays, todaySheet] = await Promise.all([
    profile.tracks_time
      ? supabase.from('time_entries').select('start_time,end_time,break_min,status').eq('user_id', profile.id).gte('work_date', weekStart).lte('work_date', weekEnd)
      : Promise.resolve({ data: [] }),
    supabase.rpc('leave_balance', { p_user: profile.id, p_year: year }),
    supabase.from('leave_requests').select('*').eq('user_id', profile.id).in('status', ['pending', 'approved', 'changes']).gte('end_date', today).order('start_date').limit(5),
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(5),
    isApprover && leaveApproveIds.length
      ? supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').in('user_id', leaveApproveIds)
      : Promise.resolve({ count: 0 }),
    isApprover
      ? supabase.from('daily_timesheets').select('id', { count: 'exact', head: true }).eq('status', 'submitted').neq('user_id', profile.id)
      : Promise.resolve({ count: 0 }),
    profile.tracks_time
      ? supabase.from('daily_timesheets').select('status').eq('user_id', profile.id).eq('work_date', today).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const weekEntries = (entries.data ?? []) as Pick<TimeEntry, 'start_time' | 'end_time' | 'break_min' | 'status'>[]
  const loggedMin = weekEntries.reduce((s, e) => s + entryMinutes(e), 0)
  const todayStatus = (todaySheet.data as { status: string } | null)?.status
  const toSubmit = todayStatus === 'draft' || todayStatus === 'changes'
  const bal = (balance.data ?? []) as LeaveBalanceRow[]
  const annual = bal.find((b) => b.type === 'annual')
  const sick = bal.find((b) => b.type === 'sick')
  const leaves = (upcoming.data ?? []) as LeaveRequest[]
  const pendingMine = leaves.filter((l) => l.status === 'pending').length
  const days = submittedDays.count ?? 0
  const targetMin = org.hours_per_day * 60 * 5
  const first = profile.full_name.split(' ')[0]

  return (
    <>
      <PageHead title={`Welcome, ${first}`} sub={`${org.org_name} · week of ${fmtRange(weekStart, weekEnd)}`} />

      <div className="quick">
        {profile.tracks_time && (
          <Link className="qa" href="/timesheet"><Icon name="plus" /> Add time entry</Link>
        )}
        <Link className="qa" href="/leave"><Icon name="leave" /> Request leave</Link>
        {isApprover && <Link className="qa" href="/approvals"><Icon name="check" /> Review approvals</Link>}
      </div>

      <div className="stats">
        {profile.tracks_time && (
          <Stat label="Hours this week" value={fmtMinutes(loggedMin)} sub={`Target ${n1(targetMin / 60)}h`} />
        )}
        {annual && <Stat label="Annual leave left" value={`${n1(annual.remaining ?? 0)} d`} sub={`of ${n1(annual.allocated ?? 0)} days`} />}
        {sick && <Stat label="Sick leave left" value={`${n1(sick.remaining ?? 0)} d`} sub={`of ${n1(sick.allocated ?? 0)} days`} />}
        <Stat label="My pending requests" value={pendingMine} sub="awaiting approval" />
        {isApprover && <Stat label="Leave to approve" value={pendingLeave.count ?? 0} tone={(pendingLeave.count ?? 0) > 0 ? 'warn' : undefined} sub="requests" />}
        {isApprover && <Stat label="Timesheets to approve" value={days} tone={days > 0 ? 'warn' : undefined} sub="daily timesheets" />}
      </div>

      {profile.tracks_time && toSubmit && (
        <div className="notice n-warn">
          <Icon name="clock" /> <span>Today&apos;s timesheet has not been submitted yet. <Link href="/timesheet">Open timesheet</Link></span>
        </div>
      )}

      {profile.tracks_time && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h2>This week</h2><span className="muted sm">{fmtMinutes(loggedMin)} of {n1(targetMin / 60)}h</span></div>
          <Bar value={targetMin ? loggedMin / targetMin : 0} tone={loggedMin >= targetMin ? 'g' : undefined} />
        </div>
      )}

      <div className="grid g2">
        <div className="card">
          <div className="ch"><h2>Upcoming leave</h2><Link className="btn s ghost" href="/leave">All requests</Link></div>
          {leaves.length === 0 ? (
            <Empty title="No upcoming leave">Plan time off from My Leave.</Empty>
          ) : (
            <div className="list">
              {leaves.map((l) => (
                <div className="li" key={l.id}>
                  <div className="grow">
                    <div className="t">{LEAVE_LABEL[l.type]}</div>
                    <div className="muted sm">{fmtRange(l.start_date, l.end_date)} · {n1(l.days)} day{l.days === 1 ? '' : 's'}</div>
                  </div>
                  <Badge label={LEAVE_STATUS_LABEL[l.status][0]} tone={LEAVE_STATUS_LABEL[l.status][1]} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="ch"><h2>Recent notifications</h2><Link className="btn s ghost" href="/notifications">See all</Link></div>
          {(notifs.data ?? []).length === 0 ? (
            <Empty title="You're all caught up" />
          ) : (
            <div className="list">
              {(notifs.data as { id: string; text: string; read: boolean; created_at: string }[]).map((n) => (
                <div className="li" key={n.id}>
                  <div className="grow">
                    <div className={n.read ? 'muted' : 't'}>{n.text}</div>
                    <div className="muted xs">{fmtDateTime(n.created_at, org.timezone)}</div>
                  </div>
                  {!n.read && <Badge label="New" tone="blue" />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
