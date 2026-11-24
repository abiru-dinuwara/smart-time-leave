import Link from 'next/link'
import { requireApprover } from '@/lib/auth'
import { Avatar, Badge, Empty, Flash, PageHead, one, type SP } from '@/components/ui'
import { addDays, entryMinutes, fmtDate, fmtDateTime, fmtMinutes, fmtRange, hhmm, n1 } from '@/lib/dates'
import { LEAVE_LABEL, type LeaveRequest, type TimeEntry } from '@/lib/types'
import { decideLeave, decideTimesheet } from './actions'

export const metadata = { title: 'Approvals' }

type Req = LeaveRequest & { employee: { full_name: string; position: string | null } | null }
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
  const { supabase, profile, org } = await requireApprover()
  const sp = await searchParams
  const tab = one(sp.tab) === 'timesheets' ? 'timesheets' : 'leave'

  const [leaveRes, entRes] = await Promise.all([
    supabase.from('leave_requests').select('*, employee:profiles!user_id(full_name,position)').eq('status', 'pending').neq('user_id', profile.id).order('start_date'),
    supabase.from('time_entries').select('*, project:projects(code,name), employee:profiles!user_id(full_name,position)').eq('status', 'submitted').neq('user_id', profile.id).order('work_date').order('start_time'),
  ])
  const leave = (leaveRes.data ?? []) as Req[]
  const entries = (entRes.data ?? []) as Ent[]

  // group submitted entries into person-weeks
  const groups = new Map<string, { user: string; week: string; name: string; position: string | null; list: Ent[] }>()
  for (const e of entries) {
    const key = `${e.user_id}|${e.week_start}`
    if (!groups.has(key)) groups.set(key, { user: e.user_id, week: e.week_start, name: e.employee?.full_name ?? 'Unknown', position: e.employee?.position ?? null, list: [] })
    groups.get(key)!.list.push(e)
  }
  const weeks = [...groups.values()]

  return (
    <>
      <PageHead
        title="Approvals"
        sub={profile.role === 'hr' ? 'As HR you can decide any pending request, for example when a manager is away.' : 'Requests from the people who report to you.'}
      />
      <Flash ok={one(sp.ok)} error={one(sp.error)} />

      <div className="tabs">
        <Link href="/approvals" className={tab === 'leave' ? 'on' : ''}>Leave requests<span className="c">{leave.length}</span></Link>
        <Link href="/approvals?tab=timesheets" className={tab === 'timesheets' ? 'on' : ''}>Timesheets<span className="c">{weeks.length}</span></Link>
      </div>

      {tab === 'leave' &&
        (leave.length === 0 ? (
          <div className="card"><Empty title="Nothing to approve">New leave requests will appear here.</Empty></div>
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
        (weeks.length === 0 ? (
          <div className="card"><Empty title="No timesheets waiting">Submitted weeks will appear here.</Empty></div>
        ) : (
          weeks.map((g) => {
            const total = g.list.reduce((s, e) => s + entryMinutes(e), 0)
            return (
              <div className="card" key={`${g.user}|${g.week}`} style={{ marginBottom: 14 }}>
                <div className="row between">
                  <div className="row">
                    <Avatar name={g.name} />
                    <div>
                      <b>{g.name}</b>
                      <div className="muted sm">Week of {fmtRange(g.week, addDays(g.week, 6))}</div>
                    </div>
                  </div>
                  <div className="row"><b>{fmtMinutes(total)}</b><Badge label="Submitted" tone="amber" /></div>
                </div>
                <details style={{ margin: '12px 0' }}>
                  <summary className="sm" style={{ cursor: 'pointer' }}>View {g.list.length} entries</summary>
                  <div className="tw">
                    <table>
                      <tbody>
                        {g.list.map((e) => (
                          <tr key={e.id}>
                            <td className="nowrap">{fmtDate(e.work_date)}</td>
                            <td className="nowrap">{hhmm(e.start_time)}–{hhmm(e.end_time)}</td>
                            <td><b>{e.project?.code}</b> {e.task}<div className="muted sm">{e.description}</div></td>
                            <td className="num">{fmtMinutes(entryMinutes(e))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <form action={decideTimesheet}>
                  <input type="hidden" name="user" value={g.user} />
                  <input type="hidden" name="week" value={g.week} />
                  <div className="fld">
                    <label htmlFor={`t-${g.user}-${g.week}`}>Note to the employee</label>
                    <input id={`t-${g.user}-${g.week}`} name="note" className="note-input" maxLength={500} placeholder="Required when rejecting or requesting changes" />
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
