import { requireRole } from '@/lib/auth'
import { Avatar, Badge, Field, Flash, Notice, PageHead, one, type SP } from '@/components/ui'
import { ROLE_LABEL, type AppRole, type Profile } from '@/lib/types'
import { updatePerson } from './actions'

export const metadata = { title: 'People' }

export default async function PeoplePage({ searchParams }: { searchParams: SP }) {
  const { supabase, profile } = await requireRole('admin', 'hr')
  const sp = await searchParams
  const isAdmin = profile.role === 'admin'
  const { data } = await supabase.from('profiles').select('*').order('active', { ascending: false }).order('full_name')
  const people = (data ?? []) as Profile[]
  const managers = people.filter((p) => p.active)
  const nameOf = new Map(people.map((p) => [p.id, p.full_name]))

  return (
    <>
      <PageHead title="People" sub="Set each person's role, manager and department. Managers decide leave and timesheets for the people who report to them." />
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <Notice>
        <span>
          <b>Adding someone new:</b> create their account in Supabase (Authentication → Users → Add user or Invite). They appear here
          automatically as an Employee; then set their manager and role below.
        </span>
      </Notice>

      {people.map((p) => (
        <div className="card" key={p.id} style={{ marginBottom: 12 }}>
          <details className="form">
            <summary>
              <div className="row between">
                <div className="row">
                  <Avatar name={p.full_name} />
                  <div>
                    <b>{p.full_name}</b> {p.id === profile.id && <span className="muted sm">(you)</span>}
                    <div className="muted sm">{p.email} · {p.position ?? 'No position'}{p.manager_id ? ` · reports to ${nameOf.get(p.manager_id) ?? '—'}` : ''}</div>
                  </div>
                </div>
                <div className="row">
                  <Badge label={ROLE_LABEL[p.role]} tone={p.role === 'admin' ? 'red' : p.role === 'employee' ? 'gray' : 'blue'} />
                  {!p.active && <Badge label="Deactivated" tone="red" />}
                </div>
              </div>
            </summary>
            <form action={updatePerson}>
              <input type="hidden" name="id" value={p.id} />
              <div className="frow">
                <Field label="Full name"><input name="full_name" defaultValue={p.full_name} required /></Field>
                <Field label="Employee number"><input name="emp_no" defaultValue={p.emp_no ?? ''} /></Field>
                <Field label="Position"><input name="position" defaultValue={p.position ?? ''} /></Field>
              </div>
              <div className="frow">
                <Field label="Department"><input name="department" defaultValue={p.department ?? ''} /></Field>
                <Field label="Team"><input name="team" defaultValue={p.team ?? ''} /></Field>
                <Field label="Line manager">
                  <select name="manager_id" defaultValue={p.manager_id ?? ''}>
                    <option value="">— none (HR approves) —</option>
                    {managers.filter((m) => m.id !== p.id).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </select>
                </Field>
                <Field label="Role" hint={isAdmin ? undefined : 'Only administrators change roles'}>
                  <select name="role" defaultValue={p.role} disabled={!isAdmin}>
                    {(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </Field>
              </div>
              <div className="row" style={{ marginBottom: 12, gap: 20 }}>
                <label className="row"><input type="checkbox" name="tracks_time" defaultChecked={p.tracks_time} /> Tracks time</label>
                <label className="row"><input type="checkbox" name="active" defaultChecked={p.active} /> Active (can sign in)</label>
              </div>
              <button className="btn primary" type="submit">Save</button>
            </form>
          </details>
        </div>
      ))}
    </>
  )
}
