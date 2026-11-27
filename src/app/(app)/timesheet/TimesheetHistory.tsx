import Link from 'next/link'
import type { AppContext } from '@/lib/auth'
import { Badge, Empty, Pager, Tag } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { entryMinutes, fmtDate, fmtDateTime, fmtMinutes, isIsoDate } from '@/lib/dates'
import { ENTRY_STATUS_LABEL, ROLE_LABEL, ROUTE_LABEL, type ApprovalRoute, type AppRole, type EntryStatus } from '@/lib/types'

const PAGE_SIZE = 20
const STATUSES: EntryStatus[] = ['submitted', 'approved', 'rejected', 'changes', 'draft']

type Sheet = {
  id: string
  work_date: string
  status: EntryStatus
  submitted_at: string | null
  last_submitted_at: string | null
  resubmissions: number
  reviewed_at: string | null
  review_note: string | null
  approval_route: ApprovalRoute | null
  reviewer: { full_name: string } | null
}
type Ent = { work_date: string; task: string; start_time: string; end_time: string; break_min: number; project: { code: string; name: string } | null }
type Review = { id: string; timesheet_id: string; action: string; note: string; created_at: string; actor_role: AppRole | null; actor: { full_name: string } | null }

/**
 * The logged-in user's OWN daily timesheet history (any role). Rows are filtered
 * to user_id = me here and by row-level security in the database.
 */
export default async function TimesheetHistory({
  ctx,
  sp,
}: {
  ctx: Pick<AppContext, 'supabase' | 'profile' | 'org' | 'today'>
  sp: Record<string, string | string[] | undefined>
}) {
  const { supabase, profile, org, today } = ctx
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : (sp[k] as string | undefined)) ?? ''
  const status = STATUSES.includes(get('status') as EntryStatus) ? (get('status') as EntryStatus) : ''
  const from = isIsoDate(get('from')) ? get('from') : ''
  const to = isIsoDate(get('to')) ? get('to') : ''
  const page = Math.max(1, Number.parseInt(get('page'), 10) || 1)

  let q = supabase
    .from('daily_timesheets')
    .select('id, work_date, status, submitted_at, last_submitted_at, resubmissions, reviewed_at, review_note, approval_route, reviewer:profiles!reviewed_by(full_name)', { count: 'exact' })
    .eq('user_id', profile.id)
    .order('work_date', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  // today's unsubmitted draft lives on the Today tab
  q = status ? q.eq('status', status) : q.or(`status.neq.draft,work_date.lt.${today}`)
  if (from) q = q.gte('work_date', from)
  if (to) q = q.lte('work_date', to)
  const { data, count } = await q
  const sheets = (data ?? []) as unknown as Sheet[]

  // Two batched queries for the whole page (entries + review timeline), never one per row.
  const dates = sheets.map((s) => s.work_date)
  const ids = sheets.map((s) => s.id)
  const [entRes, revRes] = await Promise.all([
    dates.length
      ? supabase.from('time_entries').select('work_date, task, start_time, end_time, break_min, project:projects(code,name)').eq('user_id', profile.id).in('work_date', dates).order('start_time')
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from('timesheet_reviews').select('id, timesheet_id, action, note, created_at, actor_role, actor:profiles!actor_id(full_name)').in('timesheet_id', ids).order('created_at')
      : Promise.resolve({ data: [] }),
  ])
  const entries = (entRes.data ?? []) as unknown as Ent[]
  const reviews = (revRes.data ?? []) as unknown as Review[]

  const qs = (p: Record<string, string | number>) => {
    const u = new URLSearchParams({ tab: 'history' })
    const all: Record<string, string | number> = { status, from, to, ...p }
    for (const [k, v] of Object.entries(all)) if (v !== '' && !(k === 'page' && v === 1)) u.set(k, String(v))
    return `/timesheet?${u.toString()}`
  }

  return (
    <>
      <form className="card filters" method="get" aria-label="Filter timesheet history">
        <input type="hidden" name="tab" value="history" />
        <div className="filter-grid">
          <div className="fld">
            <label htmlFor="th-status">Status</label>
            <select id="th-status" name="status" defaultValue={status}>
              <option value="">All submitted days</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'draft' ? 'Never submitted' : ENTRY_STATUS_LABEL[s][0]}</option>)}
            </select>
          </div>
          <div className="fld">
            <label htmlFor="th-from">From</label>
            <input id="th-from" type="date" name="from" defaultValue={from} max={today} />
          </div>
          <div className="fld">
            <label htmlFor="th-to">To</label>
            <input id="th-to" type="date" name="to" defaultValue={to} max={today} />
          </div>
        </div>
        <div className="row">
          <button className="btn primary" type="submit"><Icon name="filter" size={15} /> Apply</button>
          {(status || from || to) && <Link className="btn ghost" href="/timesheet?tab=history">Clear</Link>}
        </div>
      </form>

      <section className="card flush">
        <div className="ch">
          <h2>My timesheet history</h2>
          <span className="muted sm">{count ?? 0} day{count === 1 ? '' : 's'}</span>
        </div>
        {sheets.length === 0 ? (
          <Empty title="No timesheets yet" icon="clock">Submitted daily timesheets and their approval decisions will appear here.</Empty>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th scope="col">Work date</th>
                  <th scope="col">Projects &amp; tasks</th>
                  <th scope="col" className="num">Hours</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Status</th>
                  <th scope="col">Decision</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((s) => {
                  const list = entries.filter((e) => e.work_date === s.work_date)
                  const mins = list.reduce((t, e) => t + entryMinutes(e), 0)
                  const codes = [...new Set(list.map((e) => e.project?.code).filter(Boolean))] as string[]
                  const [label, tone] = ENTRY_STATUS_LABEL[s.status]
                  const timeline = reviews.filter((r) => r.timesheet_id === s.id)
                  const decided = s.status === 'approved' || s.status === 'rejected' || s.status === 'changes'
                  return (
                    <tr key={s.id}>
                      <td className="nowrap"><b>{fmtDate(s.work_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b></td>
                      <td>
                        <div className="row tight">{codes.map((c) => <Tag key={c}>{c}</Tag>)}</div>
                        <div className="muted xs">{list.map((e) => e.task).filter(Boolean).join(' · ') || '—'}</div>
                      </td>
                      <td className="num nowrap">{fmtMinutes(mins)}</td>
                      <td className="nowrap sm">
                        {s.submitted_at ? fmtDateTime(s.submitted_at, org.timezone) : <span className="muted">Not submitted</span>}
                        {s.resubmissions > 0 && s.last_submitted_at && <div className="muted xs">Resubmitted {fmtDateTime(s.last_submitted_at, org.timezone)}</div>}
                      </td>
                      <td>
                        <Badge label={s.status === 'draft' ? 'Not submitted' : label} tone={tone} />
                        {s.status === 'submitted' && s.approval_route && <div className="muted xs">With {ROUTE_LABEL[s.approval_route]}</div>}
                      </td>
                      <td className="sm cell-wide">
                        {decided ? (
                          <>
                            <div>
                              {s.reviewer?.full_name ?? 'Approver'}
                              {s.reviewed_at && <span className="muted xs"> · {fmtDateTime(s.reviewed_at, org.timezone)}</span>}
                            </div>
                            {s.review_note && <div>“{s.review_note}”</div>}
                            {s.status === 'changes' && <Link href={`/timesheet?correct=${s.work_date}`} className="sm">Correct and resubmit →</Link>}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                        {timeline.length > 0 && (
                          <details className="mini-details">
                            <summary>Full history ({timeline.length})</summary>
                            <ol className="tline">
                              {timeline.map((r) => (
                                <li key={r.id}>
                                  <b>{r.action}</b> · {r.actor?.full_name ?? '—'}
                                  {r.actor_role && r.actor?.full_name && r.action !== 'Submitted' && r.action !== 'Resubmitted' ? ` (${ROLE_LABEL[r.actor_role]})` : ''}
                                  <span className="muted xs"> · {fmtDateTime(r.created_at, org.timezone)}</span>
                                  {r.note && <div className="muted">“{r.note}”</div>}
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
