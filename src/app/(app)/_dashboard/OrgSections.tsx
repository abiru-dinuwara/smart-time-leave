import Link from 'next/link'
import type { AppContext } from '@/lib/auth'
import { fetchApprovalRecords } from '@/lib/approval-records'
import ApprovalTable from '@/components/ApprovalTable'
import { Badge, Bar, Card, Empty, Notice, Person, Stat } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { addDays, fmtDate, fmtRange, n1 } from '@/lib/dates'
import { LEAVE_LABEL, ROLE_LABEL, type AppRole, type LeaveType } from '@/lib/types'

/** Shape returned by public.org_overview() (migration 0005). Totals only — no reasons or entry details. */
export interface OrgOverview {
  active_employees: number
  away_today: number
  by_department: { department: string; headcount: number; away_today: number }[]
  by_role: Partial<Record<AppRole, number>>
  leave: { pending: number; approved: number; rejected: number; changes: number; approved_days: number }
  timesheets: { pending: number; approved: number; rejected: number; changes: number }
  approved_hours: number
  projects: { active: number; archived: number; overdue: number; over_budget: number }
}

async function overview(ctx: AppContext) {
  const monthStart = `${ctx.today.slice(0, 8)}01`
  const { data, error } = await ctx.supabase.rpc('org_overview', { p_from: monthStart, p_to: ctx.today })
  return { o: data as OrgOverview | null, error: error?.message ?? null }
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

/** HR: organisation-wide approvals and people overview. */
export async function HrSection({ ctx, counts }: { ctx: AppContext; counts: { leave: number; timesheets: number } }) {
  const { supabase, org, today } = ctx
  const [{ o, error }, awayRes, recent] = await Promise.all([
    overview(ctx),
    supabase
      .from('leave_requests')
      .select('id, type, start_date, end_date, employee:profiles!user_id(full_name, department)')
      .eq('status', 'approved')
      .lte('start_date', addDays(today, 7))
      .gte('end_date', today)
      .order('start_date')
      .limit(12),
    fetchApprovalRecords(supabase, { sort: 'decided', dir: 'desc' }, { limit: 12 }),
  ])
  if (!o) return <Notice kind="bad">The organisation overview could not be loaded{error ? `: ${error}` : ''}.</Notice>
  const away = (awayRes.data ?? []) as unknown as { id: string; type: LeaveType; start_date: string; end_date: string; employee: { full_name: string; department: string | null } | null }[]
  const decided = recent.rows.filter((r) => r.decided_at).slice(0, 6)
  const lvDecided = o.leave.approved + o.leave.rejected + o.leave.changes
  const tsDecided = o.timesheets.approved + o.timesheets.rejected + o.timesheets.changes

  return (
    <>
      <h2 className="section-h">HR overview <span className="muted sm">· {fmtDate(today, { month: 'long', year: 'numeric' })}</span></h2>
      <div className="stats">
        <Stat label="Active employees" value={o.active_employees} sub={`${o.away_today} on leave today`} icon="users" href="/team" />
        <Stat label="Leave for HR to approve" value={counts.leave} tone={counts.leave ? 'warn' : undefined} sub="from managers, PMs and leadership" icon="leave" href="/approvals" />
        <Stat label="Timesheets for HR to approve" value={counts.timesheets} tone={counts.timesheets ? 'warn' : undefined} sub="from managers, PMs and leadership" icon="clock" href="/approvals?tab=timesheets" />
        <Stat label="Pending org-wide" value={o.leave.pending + o.timesheets.pending} sub={`${o.leave.pending} leave · ${o.timesheets.pending} timesheets (all approvers)`} icon="hourglass" href="/approvals/history?status=pending" />
      </div>

      <div className="grid g2">
        <Card title="Decisions this month">
          <div className="split">
            <div>
              <div className="lab">Leave requests</div>
              <div className="big">{lvDecided}</div>
              <ul className="legend-list">
                <li><Badge label={`${o.leave.approved} approved`} tone="green" /></li>
                <li><Badge label={`${o.leave.rejected} rejected`} tone="red" /></li>
                <li><Badge label={`${o.leave.changes} sent back`} tone="blue" /></li>
              </ul>
              <Bar value={pct(o.leave.approved, lvDecided) / 100} tone="g" label="Leave approval rate" />
              <div className="muted xs">{pct(o.leave.approved, lvDecided)}% approved · {n1(Number(o.leave.approved_days))} leave days starting this month</div>
            </div>
            <div>
              <div className="lab">Daily timesheets</div>
              <div className="big">{tsDecided}</div>
              <ul className="legend-list">
                <li><Badge label={`${o.timesheets.approved} approved`} tone="green" /></li>
                <li><Badge label={`${o.timesheets.rejected} rejected`} tone="red" /></li>
                <li><Badge label={`${o.timesheets.changes} sent back`} tone="blue" /></li>
              </ul>
              <Bar value={pct(o.timesheets.approved, tsDecided) / 100} tone="g" label="Timesheet approval rate" />
              <div className="muted xs">{pct(o.timesheets.approved, tsDecided)}% approved · {n1(Number(o.approved_hours))}h approved this month</div>
            </div>
          </div>
        </Card>

        <Card title="Departments" flush>
          {o.by_department.length === 0 ? (
            <Empty title="No employees yet" icon="users" />
          ) : (
            <div className="tw">
              <table className="compact">
                <thead><tr><th scope="col">Department</th><th scope="col" className="num">People</th><th scope="col" className="num">On leave today</th><th scope="col" style={{ width: '35%' }}>Share</th></tr></thead>
                <tbody>
                  {o.by_department.map((d) => (
                    <tr key={d.department}>
                      <td><Link href={`/approvals/history?department=${encodeURIComponent(d.department)}`}>{d.department}</Link></td>
                      <td className="num">{d.headcount}</td>
                      <td className="num">{d.away_today}</td>
                      <td><Bar value={o.active_employees ? d.headcount / o.active_employees : 0} label={`${d.department} share of headcount`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid g2 mt">
        <Card title="On leave · today and next 7 days">
          {away.length === 0 ? (
            <Empty title="Nobody is on approved leave" icon="leave" />
          ) : (
            <ul className="list">
              {away.map((l) => (
                <li className="li" key={l.id}>
                  <Person name={l.employee?.full_name ?? 'Unknown'} sub={`${LEAVE_LABEL[l.type]} · ${fmtRange(l.start_date, l.end_date)}`} />
                  {l.start_date <= today ? <Badge label="Away now" tone="blue" /> : <span className="muted xs nowrap">from {fmtDate(l.start_date)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent approval decisions" flush action={<Link className="btn s ghost" href="/approvals/history">Full history</Link>}>
          {decided.length === 0 ? <Empty title="No decisions yet" icon="history" /> : <ApprovalTable rows={decided} tz={org.timezone} compact />}
        </Card>
      </div>
    </>
  )
}

/** Leadership (and administrators): high-level organisation insights. Totals only. */
export async function LeadershipSection({ ctx, title = 'Organisation overview' }: { ctx: AppContext; title?: string }) {
  const { supabase, today } = ctx
  const [{ o, error }, projRes, hoursRes] = await Promise.all([
    overview(ctx),
    supabase.from('projects').select('id, code, name, deadline, planned_hours, prior_hours').eq('status', 'active').order('code').limit(50),
    supabase.rpc('project_hours'),
  ])
  if (!o) return <Notice kind="bad">The organisation overview could not be loaded{error ? `: ${error}` : ''}.</Notice>
  const hours = new Map(((hoursRes.data ?? []) as { project_id: string; approved_hours: number }[]).map((h) => [h.project_id, Number(h.approved_hours)]))
  const projects = ((projRes.data ?? []) as { id: string; code: string; name: string; deadline: string | null; planned_hours: number; prior_hours: number }[])
    .map((p) => {
      const actual = Number(p.prior_hours) + (hours.get(p.id) ?? 0)
      const planned = Number(p.planned_hours)
      return { ...p, actual, planned, ratio: planned ? actual / planned : 0 }
    })
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 6)

  const insights: { tone: 'warn' | 'ok' | 'info'; text: string }[] = []
  if (o.projects.overdue) insights.push({ tone: 'warn', text: `${o.projects.overdue} active project${o.projects.overdue === 1 ? ' is' : 's are'} past the deadline.` })
  if (o.projects.over_budget) insights.push({ tone: 'warn', text: `${o.projects.over_budget} project${o.projects.over_budget === 1 ? ' has' : 's have'} used more hours than planned.` })
  const pending = o.leave.pending + o.timesheets.pending
  if (pending) insights.push({ tone: 'info', text: `${pending} request${pending === 1 ? ' is' : 's are'} waiting for approval (${o.leave.pending} leave, ${o.timesheets.pending} timesheets).` })
  const awayPct = pct(o.away_today, o.active_employees)
  insights.push({ tone: awayPct >= 20 ? 'warn' : 'ok', text: `${o.away_today} of ${o.active_employees} people (${awayPct}%) are on leave today.` })
  if (!o.projects.overdue && !o.projects.over_budget) insights.push({ tone: 'ok', text: 'All active projects are on schedule and within planned hours.' })
  const roles = (Object.entries(o.by_role) as [AppRole, number][]).sort((a, b) => b[1] - a[1])

  return (
    <>
      <h2 className="section-h">{title} <span className="muted sm">· {fmtDate(today, { month: 'long', year: 'numeric' })}</span></h2>
      <div className="stats">
        <Stat label="Employees" value={o.active_employees} sub={`${o.by_department.length} department${o.by_department.length === 1 ? '' : 's'}`} icon="users" />
        <Stat label="Active projects" value={o.projects.active} sub={`${o.projects.overdue} overdue · ${o.projects.over_budget} over plan`} tone={o.projects.overdue ? 'warn' : undefined} icon="folder" href="/projects" />
        <Stat label="Approved leave" value={<>{n1(Number(o.leave.approved_days))}<small> days</small></>} sub={`${o.leave.approved} request${o.leave.approved === 1 ? '' : 's'} approved this month`} icon="leave" />
        <Stat label="Approved hours" value={<>{n1(Number(o.approved_hours))}<small>h</small></>} sub={`${o.timesheets.approved} timesheets approved this month`} icon="clock" />
      </div>

      <div className="grid g2">
        <Card title="Operational insights">
          <ul className="insights">
            {insights.map((i, k) => (
              <li key={k} className={`ins ${i.tone}`}>
                <Icon name={i.tone === 'warn' ? 'alert' : i.tone === 'ok' ? 'tick' : 'info'} size={16} />
                <span>{i.text}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Projects by effort used" flush action={<Link className="btn s ghost" href="/projects">All projects</Link>}>
          {projects.length === 0 ? (
            <Empty title="No active projects" icon="folder" />
          ) : (
            <div className="tw">
              <table className="compact">
                <thead><tr><th scope="col">Project</th><th scope="col" style={{ minWidth: 150 }}>Effort</th><th scope="col">Deadline</th></tr></thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`/projects/${p.id}`} className="plink"><b>{p.code}</b> {p.name}</Link></td>
                      <td>
                        <div className="xs">{n1(p.actual)}h{p.planned ? ` / ${n1(p.planned)}h` : ' (no plan)'}</div>
                        {p.planned ? <Bar value={p.ratio} tone={p.ratio > 1 ? 'r' : p.ratio > 0.85 ? 'a' : undefined} label={`${p.code} effort`} /> : null}
                      </td>
                      <td className={`nowrap sm${p.deadline && p.deadline < today ? ' text-bad' : ''}`}>{p.deadline ? fmtDate(p.deadline, { day: 'numeric', month: 'short' }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid g2 mt">
        <Card title="People by department">
          <ul className="hbars">
            {o.by_department.map((d) => (
              <li key={d.department}>
                <span className="nm">{d.department}</span>
                <span className="hb"><i style={{ width: `${pct(d.headcount, o.by_department[0]?.headcount ?? 1)}%` }} /></span>
                <span className="vl">{d.headcount}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="People by role">
          <ul className="hbars">
            {roles.map(([r, n]) => (
              <li key={r}>
                <span className="nm">{ROLE_LABEL[r]}</span>
                <span className="hb"><i style={{ width: `${pct(n, roles[0]?.[1] ?? 1)}%` }} /></span>
                <span className="vl">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
