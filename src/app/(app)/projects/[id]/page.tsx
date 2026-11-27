import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { UUID_RE } from '@/lib/approval-records'
import { Badge, Bar, Empty, Flash, Notice, PageHead, Person, Stat, Tag, one, type SP } from '@/components/ui'
import ConfirmButton from '@/components/ConfirmButton'
import SubmitButton from '@/components/SubmitButton'
import { Icon } from '@/components/Icon'
import { addDays, entryMinutes, fmtDate, fmtDay, fmtMinutes, mondayOf, n1 } from '@/lib/dates'
import { ROLE_LABEL, type AppRole, type Project } from '@/lib/types'
import { assignMember, setProjectStatus, unassignMember } from '../actions'

export const metadata = { title: 'Project team' }

type Member = {
  id: string
  employee_id: string
  assigned_at: string
  unassigned_at: string | null
  active: boolean
  employee: { full_name: string; department: string | null; role: AppRole; position: string | null; active: boolean } | null
  assigner: { full_name: string } | null
  unassigner: { full_name: string } | null
}
type Candidate = { id: string; full_name: string; email: string; department: string | null; role: AppRole; position: string | null }

/** Strip characters that have meaning in PostgREST filter syntax. */
const safeSearch = (s: string) => s.replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 60)
const CANDIDATE_LIMIT = 25

export default async function ProjectDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { supabase, profile, org, today } = await requireRole('pm', 'hr', 'leadership', 'admin')
  const { id } = await params
  const sp = await searchParams
  if (!UUID_RE.test(id)) notFound()

  const { data: pData } = await supabase
    .from('projects')
    .select('id, code, name, description, pm_id, start_date, deadline, planned_hours, prior_hours, status')
    .eq('id', id)
    .maybeSingle()
  const project = pData as Project | null
  if (!project) notFound()
  const role = profile.role
  // Project managers work only with their own projects.
  if (role === 'pm' && project.pm_id !== profile.id) redirect('/projects?error=' + encodeURIComponent('You can only open projects you manage.'))
  // Mirrors public.can_manage_project(): HR and admins any project, PMs their own. Leadership: read-only.
  const canManage = role === 'admin' || role === 'hr' || (role === 'pm' && project.pm_id === profile.id)
  const canArchive = role === 'admin' || (role === 'pm' && project.pm_id === profile.id)

  const q = safeSearch(one(sp.q) ?? '')
  const dept = (one(sp.department) ?? '').slice(0, 80)
  const roleFilter = (Object.keys(ROLE_LABEL) as AppRole[]).find((r) => r === one(sp.role)) ?? ''
  const searching = Boolean(q || dept || roleFilter)
  const weekStart = mondayOf(today)
  const weekEnd = addDays(weekStart, 6)

  let cq = supabase.from('profiles').select('id, full_name, email, department, role, position').eq('active', true).order('full_name').limit(CANDIDATE_LIMIT * 3)
  // values are double-quoted so dots in e-mail addresses are safe in PostgREST filter syntax
  if (q) cq = cq.or(`full_name.ilike."%${q}%",email.ilike."%${q}%"`)
  if (dept) cq = cq.eq('department', dept)
  if (roleFilter) cq = cq.eq('role', roleFilter)

  const [memRes, hoursRes, pmRes, weekRes, candRes, deptRes] = await Promise.all([
    supabase
      .from('project_members')
      .select('id, employee_id, assigned_at, unassigned_at, active, employee:profiles!employee_id(full_name, department, role, position, active), assigner:profiles!assigned_by(full_name), unassigner:profiles!unassigned_by(full_name)')
      .eq('project_id', id)
      .order('assigned_at', { ascending: false }),
    supabase.rpc('project_hours'),
    project.pm_id ? supabase.from('profiles').select('full_name').eq('id', project.pm_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('time_entries').select('user_id, start_time, end_time, break_min').eq('project_id', id).gte('work_date', weekStart).lte('work_date', weekEnd),
    canManage && project.status === 'active' ? cq : Promise.resolve({ data: [] }),
    canManage ? supabase.from('profiles').select('department').eq('active', true).not('department', 'is', null) : Promise.resolve({ data: [] }),
  ])
  const members = (memRes.data ?? []) as unknown as Member[]
  const current = members.filter((m) => m.active)
  const currentIds = new Set(current.map((m) => m.employee_id))
  const h = ((hoursRes.data ?? []) as { project_id: string; approved_hours: number; pending_hours: number }[]).find((x) => x.project_id === id)
  const pmName = (pmRes.data as { full_name: string } | null)?.full_name ?? null
  const weekly = new Map<string, number>()
  for (const e of (weekRes.data ?? []) as { user_id: string; start_time: string; end_time: string; break_min: number }[])
    weekly.set(e.user_id, (weekly.get(e.user_id) ?? 0) + entryMinutes(e))
  const candidates = ((candRes.data ?? []) as Candidate[]).filter((c) => !currentIds.has(c.id)).slice(0, CANDIDATE_LIMIT)
  const departments = [...new Set(((deptRes.data ?? []) as { department: string }[]).map((d) => d.department))].sort()

  const actual = Number(project.prior_hours) + Number(h?.approved_hours ?? 0)
  const planned = Number(project.planned_hours)
  const late = project.deadline && project.deadline < today && project.status === 'active'
  const weekTotal = [...weekly.values()].reduce((a, b) => a + b, 0)
  const qs = searching ? `?${new URLSearchParams({ ...(q && { q }), ...(dept && { department: dept }), ...(roleFilter && { role: roleFilter }) }).toString()}` : ''

  return (
    <>
      <PageHead
        title={`${project.code} — ${project.name}`}
        sub={project.description || (pmName ? `Managed by ${pmName}` : 'No project manager set')}
      >
        <Link className="btn" href="/projects"><Icon name="left" size={15} /> All projects</Link>
        {canArchive && (
          <form action={setProjectStatus}>
            <input type="hidden" name="id" value={project.id} />
            <input type="hidden" name="return" value="detail" />
            <input type="hidden" name="status" value={project.status === 'active' ? 'archived' : 'active'} />
            <ConfirmButton
              className="btn"
              confirmClassName="btn primary"
              title={project.status === 'active' ? `Archive ${project.code}?` : `Reactivate ${project.code}?`}
              message={<p>{project.status === 'active' ? 'Nobody will be able to log new time on it, and no one can be assigned. Past hours and team history are kept.' : 'Assigned team members will be able to log time on it again.'}</p>}
              confirmLabel={project.status === 'active' ? 'Archive project' : 'Reactivate project'}
            >
              {project.status === 'active' ? 'Archive' : 'Reactivate'}
            </ConfirmButton>
          </form>
        )}
      </PageHead>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      {project.status === 'archived' && <Notice kind="info" title="This project is archived">Nobody can log time on it or be assigned to it. The history below is kept.</Notice>}
      {!canManage && <Notice kind="info">You have read-only access to this project’s team.</Notice>}

      <div className="stats">
        <Stat label="Team size" value={current.length} sub={`${members.length - current.length} past assignment${members.length - current.length === 1 ? '' : 's'}`} icon="users" />
        <Stat
          label="Effort (approved)"
          value={<>{n1(actual)}<small>h</small></>}
          sub={planned ? <><span>of {n1(planned)}h planned</span><Bar value={planned ? actual / planned : 0} tone={actual > planned ? 'r' : undefined} label="Effort used" /></> : 'No plan set'}
          icon="trend"
          tone={planned && actual > planned ? 'bad' : undefined}
        />
        <Stat label="Awaiting approval" value={<>{n1(Number(h?.pending_hours ?? 0))}<small>h</small></>} sub="submitted, not yet approved" icon="hourglass" />
        <Stat label="This week" value={fmtMinutes(weekTotal)} sub="logged on this project" icon="clock" />
        <Stat
          label="Deadline"
          value={project.deadline ? fmtDate(project.deadline, { day: 'numeric', month: 'short' }) : '—'}
          sub={late ? 'Overdue' : project.deadline ? fmtDate(project.deadline, { year: 'numeric' }) : 'Not set'}
          tone={late ? 'bad' : undefined}
          icon="calendar"
        />
      </div>

      <div className="grid gmain">
        <section className="card flush">
          <div className="ch">
            <h2>Team members <span className="muted">({current.length})</span></h2>
            {pmName && <span className="muted sm">Project manager: <b>{pmName}</b> (can always log time)</span>}
          </div>
          {current.length === 0 ? (
            <Empty title="No one is assigned yet" icon="users">{canManage ? 'Use “Assign employees” to add the people who will log time on this project.' : 'The project manager has not assigned anyone yet.'}</Empty>
          ) : (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col">Department</th>
                    <th scope="col">Assigned</th>
                    <th scope="col" className="num">This week</th>
                    {canManage && <th scope="col"><span className="sr">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {current.map((m) => (
                    <tr key={m.id}>
                      <td><Person name={m.employee?.full_name ?? 'Unknown'} sub={m.employee ? m.employee.position ?? ROLE_LABEL[m.employee.role] : undefined} /></td>
                      <td className="sm">{m.employee?.department ?? <span className="muted">—</span>}</td>
                      <td className="sm nowrap">
                        {fmtDay(m.assigned_at, org.timezone)}
                        <div className="muted xs">{m.assigner?.full_name ? `by ${m.assigner.full_name}` : 'from earlier time entries'}</div>
                      </td>
                      <td className="num">{fmtMinutes(weekly.get(m.employee_id) ?? 0)}</td>
                      {canManage && (
                        <td className="right">
                          <form action={unassignMember}>
                            <input type="hidden" name="project" value={project.id} />
                            <input type="hidden" name="employee" value={m.employee_id} />
                            <input type="hidden" name="name" value={m.employee?.full_name ?? ''} />
                            <ConfirmButton
                              className="btn s danger"
                              confirmClassName="btn danger-solid"
                              title={`Remove ${m.employee?.full_name ?? 'this person'} from ${project.code}?`}
                              message={
                                <p>
                                  They will no longer be able to log new time on this project and will be notified. Their existing time entries stay as they are, and
                                  the assignment stays in the history.
                                </p>
                              }
                              confirmLabel="Unassign"
                            >
                              <Icon name="userminus" size={14} /> Unassign
                            </ConfirmButton>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {canManage && (
          <section className="card">
            <div className="ch"><h2>Assign employees</h2></div>
            {project.status !== 'active' ? (
              <Notice kind="info">Reactivate the project to assign people.</Notice>
            ) : (
              <>
                <form method="get" className="assign-search" role="search" aria-label="Find employees">
                  <div className="fld">
                    <label htmlFor="as-q">Search</label>
                    <input id="as-q" name="q" defaultValue={q} placeholder="Name or email" />
                  </div>
                  <div className="frow">
                    <div className="fld">
                      <label htmlFor="as-dept">Department</label>
                      <select id="as-dept" name="department" defaultValue={dept}>
                        <option value="">All</option>
                        {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div className="fld">
                      <label htmlFor="as-role">Role</label>
                      <select id="as-role" name="role" defaultValue={roleFilter}>
                        <option value="">All</option>
                        {(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="row">
                    <button className="btn" type="submit"><Icon name="search" size={15} /> Find</button>
                    {searching && <Link className="btn ghost" href={`/projects/${project.id}`}>Clear</Link>}
                  </div>
                </form>
                {candidates.length === 0 ? (
                  <Empty title={searching ? 'No matching employees' : 'Everyone is already on the team'} icon="search">
                    {searching ? 'Only active employees who are not on the team are listed.' : null}
                  </Empty>
                ) : (
                  <ul className="pick-list" aria-label="Employees you can assign">
                    {candidates.map((c) => (
                      <li key={c.id}>
                        <Person name={c.full_name} sub={[c.position ?? ROLE_LABEL[c.role], c.department].filter(Boolean).join(' · ')} />
                        <form action={assignMember}>
                          <input type="hidden" name="project" value={project.id} />
                          <input type="hidden" name="employee" value={c.id} />
                          <input type="hidden" name="name" value={c.full_name} />
                          <input type="hidden" name="qs" value={qs} />
                          <SubmitButton className="btn s primary" pendingLabel="Adding…">
                            <Icon name="userplus" size={14} /> Assign
                          </SubmitButton>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                {candidates.length === CANDIDATE_LIMIT && <p className="hint-line">Showing the first {CANDIDATE_LIMIT}. Search to narrow the list.</p>}
              </>
            )}
          </section>
        )}
      </div>

      <section className="card flush" style={{ marginTop: 16 }}>
        <div className="ch">
          <h2>Assignment history</h2>
          <span className="muted sm">Every assignment is kept, including people who have left the team.</span>
        </div>
        {members.length === 0 ? (
          <Empty title="No assignments yet" icon="history" />
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Assigned</th>
                  <th scope="col">Unassigned</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td><b>{m.employee?.full_name ?? 'Unknown'}</b>{m.employee && !m.employee.active && <div className="muted xs">Account deactivated</div>}</td>
                    <td className="sm">{fmtDay(m.assigned_at, org.timezone)} <span className="muted xs">{m.assigner?.full_name ? `by ${m.assigner.full_name}` : '(from earlier time entries)'}</span></td>
                    <td className="sm">{m.unassigned_at ? <>{fmtDay(m.unassigned_at, org.timezone)} <span className="muted xs">{m.unassigner?.full_name ? `by ${m.unassigner.full_name}` : ''}</span></> : <span className="muted">—</span>}</td>
                    <td>{m.active ? <Badge label="Current" tone="green" /> : <Badge label="Ended" tone="gray" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canManage && <p className="hint-line" style={{ marginTop: 10 }}><Tag>Tip</Tag> Only team members (and the project manager) can choose this project in their timesheet.</p>}
    </>
  )
}
