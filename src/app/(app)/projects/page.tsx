import { requireRole } from '@/lib/auth'
import { Badge, Bar, Empty, Field, Flash, PageHead, one, type SP } from '@/components/ui'
import { fmtDate, n1 } from '@/lib/dates'
import type { Profile, Project } from '@/lib/types'
import { createProject, setProjectStatus } from './actions'

export const metadata = { title: 'Projects' }

export default async function ProjectsPage({ searchParams }: { searchParams: SP }) {
  const { supabase, profile, today } = await requireRole('pm', 'hr', 'leadership', 'admin')
  const sp = await searchParams
  const canCreate = profile.role === 'pm' || profile.role === 'admin'

  const [projRes, hoursRes, pmRes] = await Promise.all([
    supabase.from('projects').select('*').order('status').order('code'),
    supabase.rpc('project_hours'),
    supabase.from('profiles').select('id, full_name').eq('active', true).eq('role', 'pm').order('full_name'),
  ])
  const projects = (projRes.data ?? []) as Project[]
  const hours = new Map(((hoursRes.data ?? []) as { project_id: string; approved_hours: number; pending_hours: number }[]).map((h) => [h.project_id, h]))
  const pms = (pmRes.data ?? []) as Pick<Profile, 'id' | 'full_name'>[]
  const pmName = new Map(pms.map((p) => [p.id, p.full_name]))
  if (profile.role === 'pm') pmName.set(profile.id, profile.full_name)

  return (
    <>
      <PageHead title="Projects" sub="Approved timesheet hours are added to each project's actual effort." />
      <Flash ok={one(sp.ok)} error={one(sp.error)} />

      {canCreate && (
        <div className="card" style={{ marginBottom: 16 }}>
          <details className="form" open={Boolean(one(sp.error))}>
            <summary className="btn primary">+ New project</summary>
            <form action={createProject}>
              <div className="frow">
                <Field label="Code" hint="2–10 letters/numbers, e.g. WEB"><input name="code" required maxLength={10} style={{ textTransform: 'uppercase' }} /></Field>
                <Field label="Name"><input name="name" required maxLength={120} /></Field>
                {profile.role === 'admin' && (
                  <Field label="Project manager">
                    <select name="pm_id" defaultValue="">
                      <option value="">— none —</option>
                      {pms.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              <div className="frow">
                <Field label="Start date"><input type="date" name="start_date" /></Field>
                <Field label="Deadline"><input type="date" name="deadline" /></Field>
                <Field label="Planned hours"><input type="number" name="planned_hours" min="0" step="0.5" defaultValue={0} /></Field>
                <Field label="Hours already spent before using this app"><input type="number" name="prior_hours" min="0" step="0.5" defaultValue={0} /></Field>
              </div>
              <Field label="Description"><textarea name="description" maxLength={1000} /></Field>
              <button className="btn primary" type="submit">Create project</button>
            </form>
          </details>
        </div>
      )}

      <div className="card flush">
        {projects.length === 0 ? (
          <Empty title="No projects yet">{canCreate ? 'Create the first project above.' : 'A project manager or administrator can create projects.'}</Empty>
        ) : (
          <div className="tw">
            <table>
              <thead><tr><th>Project</th><th>Manager</th><th>Deadline</th><th style={{ minWidth: 200 }}>Effort used</th><th>Status</th><th /></tr></thead>
              <tbody>
                {projects.map((p) => {
                  const h = hours.get(p.id)
                  const actual = Number(p.prior_hours) + Number(h?.approved_hours ?? 0)
                  const planned = Number(p.planned_hours)
                  const ratio = planned ? actual / planned : 0
                  const late = p.deadline && p.deadline < today && p.status === 'active'
                  const mine = p.pm_id === profile.id || profile.role === 'admin'
                  return (
                    <tr key={p.id}>
                      <td><b>{p.code}</b> {p.name}<div className="muted sm">{p.description}</div></td>
                      <td>{p.pm_id ? pmName.get(p.pm_id) ?? '—' : '—'}</td>
                      <td className="nowrap">{p.deadline ? fmtDate(p.deadline, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}{late && <> <Badge label="Overdue" tone="red" /></>}</td>
                      <td>
                        <div className="sm">{n1(actual)}h {planned ? `of ${n1(planned)}h` : ''}{h && Number(h.pending_hours) > 0 ? <span className="muted"> · +{n1(Number(h.pending_hours))}h awaiting approval</span> : null}</div>
                        {planned ? <Bar value={ratio} tone={ratio > 1 ? 'r' : undefined} /> : null}
                      </td>
                      <td><Badge label={p.status === 'active' ? 'Active' : 'Archived'} tone={p.status === 'active' ? 'green' : 'gray'} /></td>
                      <td className="right">
                        {canCreate && mine && (
                          <form action={setProjectStatus}>
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="status" value={p.status === 'active' ? 'archived' : 'active'} />
                            <button className="btn s" type="submit">{p.status === 'active' ? 'Archive' : 'Reactivate'}</button>
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
      </div>
    </>
  )
}
