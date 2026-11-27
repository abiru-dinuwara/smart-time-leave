import Link from 'next/link'
import { requireApprover } from '@/lib/auth'
import {
  HISTORY_PAGE_SIZE,
  fetchApprovalRecords,
  filtersToQuery,
  parseHistoryFilters,
  type HistoryFilters,
} from '@/lib/approval-records'
import ApprovalTable, { type SortKey } from '@/components/ApprovalTable'
import { Empty, Notice, PageHead, Pager, type SP } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { APPROVAL_STATUS_LABEL, ROLE_LABEL, type AppRole, type ApprovalStatus } from '@/lib/types'

export const metadata = { title: 'Approval History' }

export default async function ApprovalHistoryPage({ searchParams }: { searchParams: SP }) {
  const { supabase, profile, org } = await requireApprover()
  const f = parseHistoryFilters(await searchParams)
  const orgWide = profile.role === 'hr'
  const fullFilters = orgWide || profile.role === 'admin'

  // History rows (scope enforced in the database) + options for the filter dropdowns, in parallel.
  const [result, projRes, peopleRes] = await Promise.all([
    fetchApprovalRecords(supabase, f, { limit: HISTORY_PAGE_SIZE, offset: (f.page - 1) * HISTORY_PAGE_SIZE }),
    supabase.from('projects').select('id, code, name').order('code'),
    fullFilters
      ? supabase.from('profiles').select('id, full_name, role, department').eq('active', true).order('full_name')
      : Promise.resolve({ data: [] }),
  ])
  const projects = (projRes.data ?? []) as { id: string; code: string; name: string }[]
  const people = (peopleRes.data ?? []) as { id: string; full_name: string; role: AppRole; department: string | null }[]
  const departments = [...new Set(people.map((p) => p.department).filter((d): d is string => !!d))].sort()
  const approvers = people.filter((p) => p.role !== 'employee')

  const href = (patch: Partial<HistoryFilters>) => `/approvals/history${filtersToQuery({ ...f, ...patch })}`
  const sortHref = (key: SortKey) =>
    href({ sort: key, dir: f.sort === key && f.dir === 'desc' ? 'asc' : key === 'name' && f.sort !== key ? 'asc' : 'desc', page: 1 })
  const active = Boolean(f.q || f.kind || f.status || f.department || f.role || f.project || f.approver || f.from || f.to)

  return (
    <>
      <PageHead
        title="Approval History"
        sub={
          orgWide
            ? 'Every leave and timesheet decision across the organisation. Decisions are permanent and cannot be edited.'
            : 'Leave and timesheet requests from the people who report to you, and decisions you have made. Your own requests are under My Timesheet and My Leave.'
        }
      >
        <Link className="btn" href="/approvals"><Icon name="check" size={16} /> Pending approvals</Link>
      </PageHead>

      <form className="card filters" method="get" role="search" aria-label="Filter approval history">
        <div className="filter-grid">
          <div className="fld">
            <label htmlFor="f-q">Employee</label>
            <input id="f-q" name="q" defaultValue={f.q} placeholder="Name or email" />
          </div>
          <div className="fld">
            <label htmlFor="f-kind">Request type</label>
            <select id="f-kind" name="kind" defaultValue={f.kind}>
              <option value="">All requests</option>
              <option value="leave">Leave</option>
              <option value="timesheet">Timesheets</option>
            </select>
          </div>
          <div className="fld">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={f.status}>
              <option value="">Any status</option>
              {(Object.keys(APPROVAL_STATUS_LABEL) as ApprovalStatus[]).map((s) => (
                <option key={s} value={s}>{APPROVAL_STATUS_LABEL[s][0]}</option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label htmlFor="f-role">Role</label>
            <select id="f-role" name="role" defaultValue={f.role}>
              <option value="">Any role</option>
              {(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>
          {fullFilters && (
            <div className="fld">
              <label htmlFor="f-dept">Department</label>
              <select id="f-dept" name="department" defaultValue={f.department}>
                <option value="">All departments</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div className="fld">
            <label htmlFor="f-project">Project</label>
            <select id="f-project" name="project" defaultValue={f.project}>
              <option value="">Any project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          {fullFilters && (
            <div className="fld">
              <label htmlFor="f-approver">Approver</label>
              <select id="f-approver" name="approver" defaultValue={f.approver}>
                <option value="">Anyone</option>
                {approvers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          )}
          <div className="fld">
            <label htmlFor="f-from">From</label>
            <input id="f-from" type="date" name="from" defaultValue={f.from} />
          </div>
          <div className="fld">
            <label htmlFor="f-to">To</label>
            <input id="f-to" type="date" name="to" defaultValue={f.to} min={f.from || undefined} />
          </div>
        </div>
        <input type="hidden" name="sort" value={f.sort} />
        <input type="hidden" name="dir" value={f.dir} />
        <div className="row">
          <button className="btn primary" type="submit"><Icon name="filter" size={15} /> Apply filters</button>
          {active && <Link className="btn ghost" href="/approvals/history">Clear all</Link>}
          <span className="hint-line">The project filter shows timesheets that include that project. Dates match the leave period or the timesheet day.</span>
        </div>
      </form>

      {result.error && <Notice kind="bad">The history could not be loaded: {result.error}</Notice>}

      <section className="card flush">
        <div className="ch">
          <h2>{result.total} request{result.total === 1 ? '' : 's'}</h2>
          <span className="muted sm">Sorted by {({ submitted: 'submission date', decided: 'decision date', date: 'request date', name: 'employee' } as const)[f.sort]} ({f.dir === 'asc' ? 'oldest / A–Z first' : 'newest / Z–A first'})</span>
        </div>
        {result.rows.length === 0 ? (
          <Empty title={active ? 'No requests match these filters' : 'No approval history yet'} icon="history">
            {active ? 'Try removing a filter.' : 'Submitted requests and decisions will appear here.'}
          </Empty>
        ) : (
          <ApprovalTable rows={result.rows} tz={org.timezone} sort={{ key: f.sort, dir: f.dir }} sortHref={sortHref} />
        )}
        <Pager page={f.page} pageSize={HISTORY_PAGE_SIZE} total={result.total} hrefFor={(p) => href({ page: p })} />
      </section>
    </>
  )
}
