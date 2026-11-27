import Link from 'next/link'
import type { AppContext } from '@/lib/auth'
import { fetchApprovalRecords } from '@/lib/approval-records'
import ApprovalTable from '@/components/ApprovalTable'
import { Badge, Card, Empty, Person, Stat } from '@/components/ui'
import { addDays, entryMinutes, fmtDate, fmtMinutes, fmtRange, mondayOf, n1 } from '@/lib/dates'
import { ENTRY_STATUS_LABEL, LEAVE_LABEL, type EntryStatus, type LeaveRequest } from '@/lib/types'

type Report = { id: string; full_name: string; position: string | null; tracks_time: boolean }

/** Line manager view: direct reports only. */
export default async function ManagerSection({ ctx, counts }: { ctx: AppContext; counts: { leave: number; timesheets: number } }) {
  const { supabase, profile, org, today } = ctx
  const weekStart = mondayOf(today)
  const weekEnd = addDays(weekStart, 6)

  const { data: repData } = await supabase.from('profiles').select('id, full_name, position, tracks_time').eq('manager_id', profile.id).eq('active', true).order('full_name')
  const reports = (repData ?? []) as Report[]
  const ids = reports.map((r) => r.id)

  const [leaveRes, entRes, todayRes, recent] = await Promise.all([
    ids.length
      ? supabase.from('leave_requests').select('user_id, type, start_date, end_date, status').in('user_id', ids).in('status', ['approved', 'pending']).gte('end_date', today).lte('start_date', addDays(today, 14)).order('start_date')
      : Promise.resolve({ data: [] }),
    ids.length ? supabase.from('time_entries').select('user_id, start_time, end_time, break_min, status').in('user_id', ids).gte('work_date', weekStart).lte('work_date', weekEnd) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from('daily_timesheets').select('user_id, status').in('user_id', ids).eq('work_date', today) : Promise.resolve({ data: [] }),
    fetchApprovalRecords(supabase, { sort: 'decided', dir: 'desc' }, { limit: 8 }),
  ])
  const leaves = (leaveRes.data ?? []) as Pick<LeaveRequest, 'user_id' | 'type' | 'start_date' | 'end_date' | 'status'>[]
  const ents = (entRes.data ?? []) as { user_id: string; start_time: string; end_time: string; break_min: number; status: EntryStatus }[]
  const todaySheets = new Map(((todayRes.data ?? []) as { user_id: string; status: EntryStatus }[]).map((s) => [s.user_id, s.status]))
  const decisions = recent.rows.filter((r) => r.decided_at && r.approver_id === profile.id).slice(0, 5)

  const awayToday = (id: string) => leaves.find((l) => l.user_id === id && l.status === 'approved' && l.start_date <= today && today <= l.end_date)
  const away = reports.filter((r) => awayToday(r.id))
  const upcoming = leaves.filter((l) => l.start_date > today)
  const name = new Map(reports.map((r) => [r.id, r.full_name]))
  const weekTarget = org.hours_per_day * 60 * 5
  const minsFor = (id: string) => ents.filter((e) => e.user_id === id).reduce((s, e) => s + entryMinutes(e), 0)
  const approvedFor = (id: string) => ents.filter((e) => e.user_id === id && e.status === 'approved').reduce((s, e) => s + entryMinutes(e), 0)
  const submittedToday = reports.filter((r) => r.tracks_time && ['submitted', 'approved'].includes(todaySheets.get(r.id) ?? '')).length
  const trackers = reports.filter((r) => r.tracks_time)

  return (
    <>
      <h2 className="section-h">My team</h2>
      <div className="stats">
        <Stat label="Direct reports" value={reports.length} sub={`${reports.length - away.length} available today`} icon="users" href="/team" />
        {profile.role !== 'hr' && (
          <>
            <Stat label="Leave to approve" value={counts.leave} tone={counts.leave ? 'warn' : undefined} sub="from your direct reports" icon="leave" href="/approvals" />
            <Stat label="Timesheets to approve" value={counts.timesheets} tone={counts.timesheets ? 'warn' : undefined} sub="daily timesheets" icon="clock" href="/approvals?tab=timesheets" />
          </>
        )}
        <Stat label="Submitted today" value={`${submittedToday}/${trackers.length}`} sub="team timesheets for today" icon="check" />
      </div>

      <div className="grid g2">
        <Card title="Team time this week" flush action={<span className="muted sm">target {n1(weekTarget / 60)}h each</span>}>
          {trackers.length === 0 ? (
            <Empty title="No one on your team tracks time" icon="clock" />
          ) : (
            <div className="tw">
              <table className="compact">
                <thead>
                  <tr><th scope="col">Employee</th><th scope="col">Today</th><th scope="col" className="num">Logged</th><th scope="col" className="num">Approved</th></tr>
                </thead>
                <tbody>
                  {trackers.map((r) => {
                    const st = todaySheets.get(r.id)
                    const a = awayToday(r.id)
                    return (
                      <tr key={r.id}>
                        <td><Person name={r.full_name} sub={r.position ?? undefined} /></td>
                        <td>{a ? <Badge label="On leave" tone="blue" /> : st && st !== 'draft' ? <Badge label={ENTRY_STATUS_LABEL[st][0]} tone={ENTRY_STATUS_LABEL[st][1]} /> : <Badge label="Not submitted" tone="gray" />}</td>
                        <td className="num">{fmtMinutes(minsFor(r.id))}</td>
                        <td className="num">{fmtMinutes(approvedFor(r.id))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Team availability" action={<Link className="btn s ghost" href="/team">Details</Link>}>
          <div className="lab">Away today ({away.length})</div>
          {away.length === 0 ? (
            <p className="muted sm" style={{ margin: '4px 0 12px' }}>Everyone is available.</p>
          ) : (
            <ul className="list" style={{ marginBottom: 12 }}>
              {away.map((r) => {
                const l = awayToday(r.id)!
                return (
                  <li className="li" key={r.id}>
                    <Person name={r.full_name} sub={`${LEAVE_LABEL[l.type]} · back after ${fmtDate(l.end_date)}`} />
                  </li>
                )
              })}
            </ul>
          )}
          <div className="lab">Next 14 days</div>
          {upcoming.length === 0 ? (
            <p className="muted sm" style={{ marginTop: 4 }}>No upcoming leave.</p>
          ) : (
            <ul className="list">
              {upcoming.slice(0, 6).map((l, i) => (
                <li className="li" key={i}>
                  <div className="grow">
                    <div className="t sm">{name.get(l.user_id)}</div>
                    <div className="muted xs">{LEAVE_LABEL[l.type]} · {fmtRange(l.start_date, l.end_date)}</div>
                  </div>
                  <Badge label={l.status === 'approved' ? 'Approved' : 'Pending'} tone={l.status === 'approved' ? 'green' : 'amber'} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="My recent approval decisions" flush className="mt" action={<Link className="btn s ghost" href="/approvals/history">Full history</Link>}>
        {decisions.length === 0 ? <Empty title="No decisions yet" icon="history" /> : <ApprovalTable rows={decisions} tz={org.timezone} compact />}
      </Card>
    </>
  )
}
