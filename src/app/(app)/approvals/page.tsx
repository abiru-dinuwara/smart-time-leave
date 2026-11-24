import Link from 'next/link'
import { requireApprover } from '@/lib/auth'
import { Avatar, Badge, Empty, Flash, PageHead, one, type SP } from '@/components/ui'
import { entryMinutes, fmtDateLong, fmtDateTime, fmtMinutes, fmtRange, fmtTime, hhmm, n1 } from '@/lib/dates'
import { LEAVE_LABEL, type DailyTimesheet, type LeaveRequest, type TimeEntry } from '@/lib/types'
import { decideLeave, decideTimesheet } from './actions'

export const metadata = { title: 'Approvals' }
export const dynamic = 'force-dynamic'

type Req = LeaveRequest & { employee: { full_name: string; position: string | null } | null }
type Sheet = DailyTimesheet & { employee: { full_name: string; position: string | null } | null }
type Ent = TimeEntry & { project: { code: string; name: string } | null; employee: { full_name: string; position: string | null } | null }

function DecisionButtons({ label }: { label: string }) {
  return (
    <div className="row">
      <button className="btn primary" type="submit" name="decision" value="approved">Approve</button>
      <button className="btn" type="submit" name="decision" value="changes">Request changes</button>
      <button className="btn danger" type="submit" name="decision" value="rejected">Reject</button>
      <span className="hint-line">{label}</span>
    </div>
  )
}

export default async function ApprovalsPage({ searchParams }: { searchParams: SP }) {
  const { supabase, profile, org, leaveApproveIds } = await requireApprover()
  const sp = await searchParams
  const tab = one(sp.tab) === 'timesheets' ? 'timesheets' : 'leave'

  const [leaveRes, sheetRes, entRes] = await Promise.all([
    // Leave: ONLY requests from people who report directly to me. HR is not a leave approver.
    leaveApproveIds.length
      ? supabase.from('leave_requests').select('*, employee:profiles!user_id(full_name,position)').eq('status', 'pending').in('user_id', leaveApproveIds).order('start_date')
      : Promise.resolve({ data: [] }),
    // Timesheets: unchanged routing (line manager, HR for anyone) — one card per person-day.
    supabase.from('daily_timesheets').select('*, employee:profiles!user_id(full_name,position)').eq('status', 'submitted').neq('user_id', profile.id).order('work_date').order('submitted_at'),
    supabase.from('time_entries').select('*, project:projects(code,name)').eq('status', 'submitted').neq('user_id', profile.id).order('start_time'),
  ])
  const leave = (leaveRes.data ?? []) as Req[]
  const sheets = (sheetRes.data ?? []) as Sheet[]
  const entries = (entRes.data ?? []) as Ent[]
  const entriesOf = (s: Sheet) => entries.filter((e) => e.user_id === s.user_id && e.work_date === s.work_date)
  const now = Date.now()

  return (
    <>
      <PageHead
        title="Approvals"
        sub={
          profile.role === 'hr'
            ? 'Leave requests are approved by each employee’s line manager. As HR you can review any submitted timesheet.'
            : profile.role === 'admin'
              ? 'Leave from your direct reports and from anyone without an active line manager.'
              : 'Requests from the people who report to you.'
        }
      />
      <Flash ok={one(sp.ok)} error={one(sp.error)} />

      <div className="tabs">
        <Link href="/approvals" className={tab === 'leave' ? 'on' : ''}>Leave requests<span className="c">{leave.length}</span></Link>
        <Link href="/approvals?tab=timesheets" className={tab === 'timesheets' ? 'on' : ''}>Timesheets<span className="c">{sheets.length}</span></Link>
      </div>

      {tab === 'leave' &&
        (leave.length === 0 ? (
          <div className="card"><Empty title="Nothing to approve">Leave requests from people who report to you will appear here.</Empty></div>
        ) : (
          leave.map((r) => (
            <div className="card" key={r.id} style={{ marginBottom: 14 }}>
              <div className="row between">
                <div className="row">
                  <Avatar name={r.employee?.full_name ?? '?'} />
                  <div>
                    <b>{r.employee?.full_name}</b>
                    <div className="muted sm">{r.employee?.position}</div>
                  </div>
                </div>
                <Badge label="Pending" tone="amber" />
              </div>
              <dl className="kv" style={{ margin: '14px 0' }}>
                <dt>Type</dt><dd>{LEAVE_LABEL[r.type]}</dd>
                <dt>Dates</dt><dd>{fmtRange(r.start_date, r.end_date)}{r.half !== 'none' && ` (${r.half === 'AM' ? 'morning' : 'afternoon'})`}</dd>
                <dt>Working days</dt><dd>{n1(r.days)}</dd>
                <dt>Reason</dt><dd>{r.reason || <span className="muted">—</span>}</dd>
                <dt>Requested</dt><dd>{fmtDateTime(r.created_at, org.timezone)}</dd>
              </dl>
              <form action={decideLeave}>
                <input type="hidden" name="id" value={r.id} />
                <div className="fld">
                  <label htmlFor={`n-${r.id}`}>Note to the employee</label>
                  <input id={`n-${r.id}`} name="note" className="note-input" maxLength={500} placeholder="Required when rejecting or requesting changes" />
                </div>
                <DecisionButtons label="The employee is notified straight away." />
              </form>
            </div>
          ))
        ))}

      {tab === 'timesheets' &&
        (sheets.length === 0 ? (
          <div className="card"><Empty title="No timesheets waiting">Submitted daily timesheets will appear here.</Empty></div>
        ) : (
          sheets.map((g) => {
            const list = entriesOf(g)
            const total = list.reduce((s, e) => s + entryMinutes(e), 0)
            const key = `${g.user_id}-${g.work_date}`
            const stillEditable = !!g.edit_until && new Date(g.edit_until).getTime() > now
            return (
              <div className="card" key={key} style={{ marginBottom: 14 }}>
                <div className="row between">
                  <div className="row">
                    <Avatar name={g.employee?.full_name ?? '?'} />
                    <div>
                      <b>{g.employee?.full_name ?? 'Unknown'}</b>
                      <div className="muted sm">{fmtDateLong(g.work_date)}</div>
                    </div>
                  </div>
                  <div className="row">
                    <b>{fmtMinutes(total)}</b>
                    <Badge label={g.resubmissions > 0 ? 'Resubmitted' : 'Submitted'} tone="amber" />
                  </div>
                </div>
                <div className="muted sm" style={{ marginTop: 8 }}>
                  Submitted {g.submitted_at ? fmtDateTime(g.submitted_at, org.timezone) : '—'}
                  {g.resubmissions > 0 && g.last_submitted_at ? ` · resubmitted ${fmtDateTime(g.last_submitted_at, org.timezone)}` : ''}
                  {stillEditable && g.edit_until ? ` · the employee can still edit until ${fmtTime(g.edit_until, org.timezone)} (your decision ends that)` : ''}
                </div>
                <details style={{ margin: '12px 0' }} open>
                  <summary className="sm" style={{ cursor: 'pointer' }}>{list.length} entr{list.length === 1 ? 'y' : 'ies'}</summary>
                  <div className="tw">
                    <table>
                      <tbody>
                        {list.map((e) => (
                          <tr key={e.id}>
                            <td className="nowrap">{hhmm(e.start_time)}–{hhmm(e.end_time)}</td>
                            <td><b>{e.project?.code}</b> {e.task}<div className="muted sm">{e.description}</div></td>
                            <td className="num nowrap">{e.break_min} min break</td>
                            <td className="num">{fmtMinutes(entryMinutes(e))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <form action={decideTimesheet}>
                  <input type="hidden" name="user" value={g.user_id} />
                  <input type="hidden" name="date" value={g.work_date} />
                  <div className="fld">
                    <label htmlFor={`t-${key}`}>Note to the employee</label>
                    <input id={`t-${key}`} name="note" className="note-input" maxLength={500} placeholder="Required when rejecting or requesting changes" />
                  </div>
                  <DecisionButtons label="Approving adds these hours to the project totals." />
                </form>
              </div>
            )
          })
        ))}
    </>
  )
}
