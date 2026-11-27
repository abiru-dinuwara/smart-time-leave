import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { Badge, Bar, Empty, Field, Flash, PageHead, Tabs, Tag, one, type SP } from '@/components/ui'
import ConfirmButton from '@/components/ConfirmButton'
import SubmitButton from '@/components/SubmitButton'
import { fmtDate, n1 } from '@/lib/dates'
import type { Profile, Project } from '@/lib/types'
import { createProject, setProjectStatus } from './actions'

export const metadata = { title: 'Projects' }

type Row = Pick<Project, 'id' | 'code' | 'name' | 'description' | 'pm_id' | 'deadline' | 'planned_hours' | 'prior_hours' | 'status'>

export default async function ProjectsPage({ searchParams }: { searchParams: SP }) {
  const { supabase, profile, today } = await requireRole('pm', 'hr', 'leadership', 'admin')
  const sp = await searchParams
  const role = profile.role
  const canCreate = role === 'pm' || role === 'admin'
  const view = one(sp.view) === 'archived' ? 'archived' : one(sp.view) === 'all' ? 'all' : 'active'

  // Project managers see the projects they manage; HR, leadership and administrators see all.
  let pq = supabase.from('projects').select('id, code, name, description, pm_id, deadline, planned_hours, prior_hours, status').order('code')
  if (role === 'pm') pq = pq.eq('pm_id', profile.id)
  if (view !== 'all') pq = pq.eq('status', view)

  const [projRes, hoursRes, pmRes] = await Promise.all([
    pq,
    supabase.rpc('project_hours'),
    role === 'admin' ? supabase.from('profiles').select('id, full_name').eq('active', true).eq('role', 'pm').order('full_name') : Promise.resolve({ data: [] }),
  ])
  const projects = (projRes.data ?? []) as Row[]
  const ids = projects.map((p) => p.id)
  const pmIds = [...new Set(projects.map((p) => p.pm_id).filter((x): x is string => !!x))]

  // Batched: team sizes and PM names for all listed projects at once.
  const [memRes, pmNameRes] = await Promise.all([
    ids.length ? supabase.from('project_members').select('project_id').eq('active', true).in('project_id', ids) : Promise.resolve({ data: [] }),
    pmIds.length ? supabase.from('profiles').select('id, full_name').in('id', pmIds) : Promise.resolve({ data: [] }),
  ])
  const teamSize = new Map<string, number>()
  for (const m of (memRes.data ?? []) as { project_id: string }[]) teamSize.set(m.project_id, (teamSize.get(m.project_id) ?? 0) + 1)
  const pmName = new Map(((pmNameRes.data ?? []) as Pick<Profile, 'id' | 'full_name'>[]).map((p) => [p.id, p.full_name]))
  const hours = new Map(((hoursRes.data ?? []) as { project_id: string; approved_hours: number; pending_hours: number }[]).map((h) => [h.project_id, h]))
  const pms = (pmRes.data ?? []) as Pick<Profile, 'id' | 'full_name'>[]

  const sub =
    role === 'pm'
      ? 'Projects you manage. Assign the employees who can log time on each project.'
      : role === 'leadership'
        ? 'Overview of all projects. Team changes are made by each project manager, HR or an administrator.'
        : 'All projects. Approved timesheet hours count toward each project’s effort.'

  return (
    <>
      <PageHead title="Projects" sub={sub} />
      <Flash ok={one(sp.ok)} error={one(sp.error)} />

      {canCreate && (
        <section className="card" style={{ marginBottom: 16 }}>
          <details className="form" open={Boolean(one(sp.error))}>
            <summary className="btn primary">+ New project</summary>
            <form action={createProject}>
              <div className="frow">
                <Field label="Code" hint="2–10 letters/numbers, e.g. WEB" required htmlFor="np-code"><input id="np-code" name="code" required maxLength={10} style={{ textTransform: 'uppercase' }} /></Field>
                <Field label="Name" required htmlFor="np-name"><input id="np-name" name="name" required maxLength={120} /></Field>
                {role === 'admin' && (
                  <Field label="Project manager" htmlFor="np-pm">
                    <select id="np-pm" name="pm_id" defaultValue="">
                      <option value="">— none —</option>
                      {pms.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              <div className="frow">
                <Field label="Start date" htmlFor="np-start"><input id="np-start" type="date" name="start_date" /></Field>
                <Field label="Deadline" htmlFor="np-dl"><input id="np-dl" type="date" name="deadline" /></Field>
                <Field label="Planned hours" htmlFor="np-plan"><input id="np-plan" type="number" name="planned_hours" min="0" step="0.5" defaultValue={0} /></Field>
                <Field label="Hours spent before this app" htmlFor="np-prior"><input id="np-prior" type="number" name="prior_hours" min="0" step="0.5" defaultValue={0} /></Field>
              </div>
              <Field label="Description" htmlFor="np-desc"><textarea id="np-desc" name="description" maxLength={1000} /></Field>
              <SubmitButton pendingLabel="Creating…">Create project</SubmitButton>
            </form>
          </details>
        </section>
      )}

      <Tabs
        current={view}
        items={[
          { key: 'active', label: 'Active', href: '/projects' },
          { key: 'archived', label: 'Archived', href: '/projects?view=archived' },
          { key: 'all', label: 'All', href: '/projects?view=all' },
        ]}
      />

      <section className="card flush">
        {projects.length === 0 ? (
          <Empty title={role === 'pm' ? 'You don’t manage any projects yet' : 'No projects here'} icon="folder">
            {canCreate ? 'Create a project above.' : 'Projects created by project managers will appear here.'}
          </Empty>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Project manager</th>
                  <th scope="col" className="num">Team</th>
                  <th scope="col" style={{ minWidth: 200 }}>Effort used</th>
                  <th scope="col">Deadline</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const h = hours.get(p.id)
                  const actual = Number(p.prior_hours) + Number(h?.approved_hours ?? 0)
                  const planned = Number(p.planned_hours)
                  const ratio = planned ? actual / planned : 0
                  const late = p.deadline && p.deadline < today && p.status === 'active'
                  const mine = (role === 'pm' && p.pm_id === profile.id) || role === 'admin'
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/projects/${p.id}`} className="plink"><Tag>{p.code}</Tag> <b>{p.name}</b></Link>
                        {p.description && <div className="muted xs clamp">{p.description}</div>}
                      </td>
                      <td className="sm">{p.pm_id ? pmName.get(p.pm_id) ?? '—' : <span className="muted">Not set</span>}</td>
                      <td className="num">{teamSize.get(p.id) ?? 0}</td>
                      <td>
                        <div className="sm">
                          {n1(actual)}h {planned ? `of ${n1(planned)}h` : ''}
                          {h && Number(h.pending_hours) > 0 ? <span className="muted"> · +{n1(Number(h.pending_hours))}h pending</span> : null}
                        </div>
                        {planned ? <Bar value={ratio} tone={ratio > 1 ? 'r' : ratio > 0.85 ? 'a' : undefined} label={`${p.code} effort`} /> : null}
                      </td>
                      <td className="nowrap sm">
                        {p.deadline ? fmtDate(p.deadline, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        {late && <> <Badge label="Overdue" tone="red" /></>}
                      </td>
                      <td><Badge label={p.status === 'active' ? 'Active' : 'Archived'} tone={p.status === 'active' ? 'green' : 'gray'} /></td>
                      <td className="right nowrap">
                        <Link className="btn s" href={`/projects/${p.id}`}>{role === 'leadership' ? 'View' : 'Team'}</Link>
                        {canCreate && mine && (
                          <form action={setProjectStatus} className="inline">
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="status" value={p.status === 'active' ? 'archived' : 'active'} />
                            <ConfirmButton
                              className="btn s ghost"
                              title={p.status === 'active' ? `Archive ${p.code}?` : `Reactivate ${p.code}?`}
                              message={<p>{p.status === 'active' ? 'Nobody will be able to log new time on it. Past hours and the team history are kept.' : 'Assigned team members will be able to log time on it again.'}</p>}
                              confirmLabel={p.status === 'active' ? 'Archive' : 'Reactivate'}
                              confirmClassName="btn primary"
                            >
                              {p.status === 'active' ? 'Archive' : 'Reactivate'}
                            </ConfirmButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
