import Link from 'next/link'
import type { AppContext } from '@/lib/auth'
import { Badge, Empty, Pager } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { fmtDate, fmtDateTime, n1 } from '@/lib/dates'
import { LEAVE_LABEL, LEAVE_STATUS_LABEL, ROLE_LABEL, ROUTE_LABEL, type AppRole, type LeaveRequest, type LeaveStatus, type LeaveType } from '@/lib/types'

const PAGE_SIZE = 20
const STATUSES: LeaveStatus[] = ['pending', 'approved', 'rejected', 'changes', 'cancelled', 'draft']

type Req = Pick<
  LeaveRequest,
  'id' | 'type' | 'start_date' | 'end_date' | 'half' | 'days' | 'reason' | 'status' | 'decided_at' | 'decision_note' | 'approval_route' | 'submitted_at' | 'last_submitted_at' | 'created_at'
> & { decider: { full_name: string } | null }
type Hist = { id: string; leave_id: string; action: string; note: string; created_at: string; actor_role: AppRole | null; actor: { full_name: string } | null }

/** The logged-in user's OWN leave history (any role). Filtered to user_id = me and by row-level security. */
export default async function LeaveHistory({
  ctx,
  sp,
}: {
  ctx: Pick<AppContext, 'supabase' | 'profile' | 'org' | 'today'>
  sp: Record<string, string | string[] | undefined>
}) {
  const { supabase, profile, org, today } = ctx
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : (sp[k] as string | undefined)) ?? ''
  const status = STATUSES.includes(get('status') as LeaveStatus) ? (get('status') as LeaveStatus) : ''
  const type = get('type') in LEAVE_LABEL ? (get('type') as LeaveType) : ''
  const yearNow = Number(today.slice(0, 4))
  const year = /^\d{4}$/.test(get('year')) ? Number(get('year')) : 0
  const page = Math.max(1, Number.parseInt(get('page'), 10) || 1)

  let q = supabase
    .from('leave_requests')
    .select('id, type, start_date, end_date, half, days, reason, status, decided_at, decision_note, approval_route, submitted_at, last_submitted_at, created_at, decider:profiles!decided_by(full_name)', { count: 'exact' })
    .eq('user_id', profile.id)
    .order('start_date', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  if (status) q = q.eq('status', status)
  if (type) q = q.eq('type', type)
  if (year) q = q.gte('start_date', `${year}-01-01`).lte('start_date', `${year}-12-31`)
  const { data, count } = await q
  const rows = (data ?? []) as unknown as Req[]

  const ids = rows.map((r) => r.id)
  const histRes = ids.length
    ? await supabase.from('leave_history').select('id, leave_id, action, note, created_at, actor_role, actor:profiles!actor_id(full_name)').in('leave_id', ids).order('created_at')
    : { data: [] }
  const history = (histRes.data ?? []) as unknown as Hist[]

  const qs = (p: Record<string, string | number>) => {
    const u = new URLSearchParams({ tab: 'history' })
    const all: Record<string, string | number> = { status, type, year: year || '', ...p }
    for (const [k, v] of Object.entries(all)) if (v !== '' && !(k === 'page' && v === 1)) u.set(k, String(v))
    return `/leave?${u.toString()}`
  }

  return (
    <>
      <form className="card filters" method="get" aria-label="Filter leave history">
        <input type="hidden" name="tab" value="history" />
        <div className="filter-grid">
          <div className="fld">
            <label htmlFor="lh-status">Status</label>
            <select id="lh-status" name="status" defaultValue={status}>
              <option value="">Any status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{LEAVE_STATUS_LABEL[s][0]}</option>)}
            </select>
          </div>
          <div className="fld">
            <label htmlFor="lh-type">Leave type</label>
            <select id="lh-type" name="type" defaultValue={type}>
              <option value="">All types</option>
              {(Object.keys(LEAVE_LABEL) as LeaveType[]).map((t) => <option key={t} value={t}>{LEAVE_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="fld">
            <label htmlFor="lh-year">Year</label>
            <select id="lh-year" name="year" defaultValue={year ? String(year) : ''}>
              <option value="">All years</option>
              {[yearNow + 1, yearNow, yearNow - 1, yearNow - 2].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <button className="btn primary" type="submit"><Icon name="filter" size={15} /> Apply</button>
          {(status || type || year) && <Link className="btn ghost" href="/leave?tab=history">Clear</Link>}
        </div>
      </form>

      <section className="card flush">
        <div className="ch">
          <h2>My leave history</h2>
          <span className="muted sm">{count ?? 0} request{count === 1 ? '' : 's'}</span>
        </div>
        {rows.length === 0 ? (
          <Empty title="No leave requests found" icon="leave">Your leave requests and every approval decision will appear here.</Empty>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th scope="col">Leave type</th>
                  <th scope="col">First day</th>
                  <th scope="col">Last day</th>
                  <th scope="col" className="num">Days</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Status</th>
                  <th scope="col">Decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const [label, tone] = LEAVE_STATUS_LABEL[r.status]
                  const h = history.filter((x) => x.leave_id === r.id)
                  const decided = r.status === 'approved' || r.status === 'rejected' || r.status === 'changes'
                  return (
                    <tr key={r.id}>
                      <td><b>{LEAVE_LABEL[r.type]}</b>{r.half !== 'none' && <div className="muted xs">{r.half === 'AM' ? 'Morning' : 'Afternoon'} only</div>}</td>
                      <td className="nowrap">{fmtDate(r.start_date, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td className="nowrap">{fmtDate(r.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td className="num">{n1(r.days)}</td>
                      <td className="sm cell-wide">{r.reason || <span className="muted">—</span>}</td>
                      <td className="nowrap sm">{r.submitted_at ? fmtDateTime(r.submitted_at, org.timezone) : <span className="muted">Not submitted</span>}</td>
                      <td>
                        <Badge label={label} tone={tone} />
                        {r.status === 'pending' && r.approval_route && <div className="muted xs">With {ROUTE_LABEL[r.approval_route]}</div>}
                      </td>
                      <td className="sm cell-wide">
                        {decided && r.decided_at ? (
                          <>
                            <div>{r.decider?.full_name ?? 'Approver'} <span className="muted xs">· {fmtDateTime(r.decided_at, org.timezone)}</span></div>
                            {r.decision_note && <div>“{r.decision_note}”</div>}
                            {r.status === 'changes' && <Link href={`/leave?edit=${r.id}`}>Edit &amp; resubmit →</Link>}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                        {h.length > 0 && (
                          <details className="mini-details">
                            <summary>Full history ({h.length})</summary>
                            <ol className="tline">
                              {h.map((x) => (
                                <li key={x.id}>
                                  <b>{x.action}</b> · {x.actor?.full_name ?? '—'}
                                  {x.actor_role && !['Submitted', 'Resubmitted', 'Cancelled'].includes(x.action) ? ` (${ROLE_LABEL[x.actor_role]})` : ''}
                                  <span className="muted xs"> · {fmtDateTime(x.created_at, org.timezone)}</span>
                                  {x.note && <div className="muted">“{x.note}”</div>}
                                </li>
                              ))}
                            </ol>
                          </details>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => qs({ page: p })} />
      </section>
    </>
  )
}
