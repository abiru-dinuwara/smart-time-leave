import Link from 'next/link'
import { requireApprover } from '@/lib/auth'
import { fetchApprovalRecords } from '@/lib/approval-records'
import { Badge, Empty, Flash, KV, Notice, PageHead, Person, Tabs, Tag, one, type SP } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { entryMinutes, fmtDateLong, fmtDateTime, fmtMinutes, fmtRange, fmtTime, hhmm, n1 } from '@/lib/dates'
import { LEAVE_LABEL, ROLE_LABEL, type ApprovalRecord, type TimeEntry } from '@/lib/types'
import { decideLeave, decideTimesheet } from './actions'
import DecisionControls from './DecisionControls'

export const metadata = { title: 'Approvals' }

type Ent = Pick<TimeEntry, 'id' | 'user_id' | 'work_date' | 'task' | 'description' | 'start_time' | 'end_time' | 'break_min'> & {
  project: { code: string; name: string } | null
}

const QUEUE_LIMIT = 200

function RouteTag({ r }: { r: ApprovalRecord }) {
  return r.route === 'hr' ? (
    <Tag tone="primary">Routed to HR · {ROLE_LABEL[r.owner_role]}</Tag>
  ) : (
    <Tag>Direct report</Tag>
  )
}

export default async function ApprovalsPage({ searchParams }: { searchParams: SP }) {
  const { supabase, profile, org } = await requireApprover()
  const sp = await searchParams
  const tab = one(sp.tab) === 'timesheets' ? 'timesheets' : 'leave'

  // Only what I can decide right now, oldest first. The database applies the routing rules.
  const { rows, error } = await fetchApprovalRecords(supabase, { sort: 'submitted', dir: 'asc' }, { limit: QUEUE_LIMIT, actionable: true })
  const leave = rows.filter((r) => r.kind === 'leave')
  const sheets = rows.filter((r) => r.kind === 'timesheet')

  // One query for all entries of the timesheets shown (no per-card queries).
  let entries: Ent[] = []
  if (tab === 'timesheets' && sheets.length) {
    const users = [...new Set(sheets.map((s) => s.owner_id))]
    const dates = [...new Set(sheets.map((s) => s.work_date as string))]
    const { data } = await supabase
      .from('time_entries')
      .select('id, user_id, work_date, task, description, start_time, end_time, break_min, project:projects(code,name)')
      .in('user_id', users)
      .in('work_date', dates)
      .order('start_time')
    entries = (data ?? []) as unknown as Ent[]
  }
  const entriesOf = (r: ApprovalRecord) => entries.filter((e) => e.user_id === r.owner_id && e.work_date === r.work_date)
  const now = Date.now()

  const sub =
    profile.role === 'hr'
      ? 'Requests from managers, project managers and leadership come to HR. Employees’ requests go to their own line manager.'
      : profile.role === 'admin'
        ? 'Requests from your direct reports, and older requests from people who have no active line manager.'
        : 'Requests from the people who report to you. Your own requests are approved by HR.'

  return (
    <>
      <PageHead title="Approvals" sub={sub}>
        <Link className="btn" href="/approvals/history"><Icon name="history" size={16} /> Approval history</Link>
      </PageHead>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      {error && <Notice kind="bad">Approvals could not be loaded: {error}</Notice>}

      <Tabs
        current={tab}
        items={[
          { key: 'leave', label: 'Leave requests', href: '/approvals', count: leave.length },
          { key: 'timesheets', label: 'Daily timesheets', href: '/approvals?tab=timesheets', count: sheets.length },
        ]}
      />
      {rows.length >= QUEUE_LIMIT && <Notice kind="info">Showing the {QUEUE_LIMIT} oldest requests. Decide these first to see more.</Notice>}

      {tab === 'leave' &&
        (leave.length === 0 ? (
          <section className="card"><Empty title="You're all caught up" icon="check">New leave requests that need your decision will appear here.</Empty></section>
        ) : (
          <div className="stack">
            {leave.map((r) => (
              <section className="card appr" key={r.request_id} aria-label={`Leave request from ${r.owner_name}`}>
                <div className="appr-head">
                  <Person name={r.owner_name} sub={[r.owner_position ?? ROLE_LABEL[r.owner_role], r.owner_department].filter(Boolean).join(' · ')} />
                  <div className="row">
                    <RouteTag r={r} />
                    <Badge label="Pending" tone="amber" />
                  </div>
                </div>
                <KV
                  items={[
                    ['Leave type', r.leave_type ? LEAVE_LABEL[r.leave_type] : '—'],
                    ['Dates', <>{fmtRange(r.start_date as string, r.end_date as string)}{r.half && r.half !== 'none' ? ` (${r.half === 'AM' ? 'morning' : 'afternoon'})` : ''}</>],
                    ['Working days', n1(Number(r.days ?? 0))],
                    ['Reason', r.reason || <span className="muted">—</span>],
                    ['Submitted', r.last_submitted_at && r.last_submitted_at !== r.submitted_at
                      ? <>{fmtDateTime(r.last_submitted_at, org.timezone)} <span className="muted xs">(resubmitted)</span></>
                      : r.submitted_at ? fmtDateTime(r.submitted_at, org.timezone) : '—'],
                  ]}
                />
                <form action={decideLeave} className="decide">
                  <input type="hidden" name="id" value={r.request_id} />
                  <DecisionControls uid={r.request_id} what="leave request" who={r.owner_name} />
                </form>
              </section>
            ))}
          </div>
        ))}

      {tab === 'timesheets' &&
        (sheets.length === 0 ? (
          <section className="card"><Empty title="No timesheets waiting" icon="check">Submitted daily timesheets that need your review will appear here.</Empty></section>
        ) : (
          <div className="stack">
            {sheets.map((r) => {
              const list = entriesOf(r)
              const total = list.reduce((s, e) => s + entryMinutes(e), 0)
              const stillEditable = !!r.edit_until && new Date(r.edit_until).getTime() > now
              return (
                <section className="card appr" key={r.request_id} aria-label={`Timesheet from ${r.owner_name} for ${r.work_date}`}>
                  <div className="appr-head">
                    <Person name={r.owner_name} sub={fmtDateLong(r.work_date as string)} />
                    <div className="row">
                      <RouteTag r={r} />
                      <span className="hours">{fmtMinutes(total)}</span>
                      <Badge label={r.resubmissions > 0 ? 'Resubmitted' : 'Pending'} tone="amber" />
                    </div>
                  </div>
                  <p className="muted sm">
                    Submitted {r.submitted_at ? fmtDateTime(r.submitted_at, org.timezone) : '—'}
                    {r.resubmissions > 0 && r.last_submitted_at ? ` · resubmitted ${fmtDateTime(r.last_submitted_at, org.timezone)}` : ''}
                    {stillEditable && r.edit_until ? ` · the requester can still edit until ${fmtTime(r.edit_until, org.timezone)} (your decision ends that)` : ''}
                  </p>
                  <div className="tw bordered">
                    <table>
                      <caption className="sr">Time entries</caption>
                      <thead>
                        <tr><th scope="col">Time</th><th scope="col">Project &amp; task</th><th scope="col" className="num">Break</th><th scope="col" className="num">Hours</th></tr>
                      </thead>
                      <tbody>
                        {list.map((e) => (
                          <tr key={e.id}>
                            <td className="nowrap">{hhmm(e.start_time)}–{hhmm(e.end_time)}</td>
                            <td><Tag>{e.project?.code}</Tag> <b>{e.task}</b><div className="muted sm">{e.description}</div></td>
                            <td className="num nowrap">{e.break_min} min</td>
                            <td className="num">{fmtMinutes(entryMinutes(e))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <form action={decideTimesheet} className="decide">
                    <input type="hidden" name="user" value={r.owner_id} />
                    <input type="hidden" name="date" value={r.work_date as string} />
                    <DecisionControls uid={r.request_id} what="timesheet" who={r.owner_name} />
                  </form>
                </section>
              )
            })}
          </div>
        ))}
    </>
  )
}
