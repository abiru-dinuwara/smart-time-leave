import Link from 'next/link'
import type { AppContext } from '@/lib/auth'
import { Bar, Card, Empty, Stat, Tag } from '@/components/ui'
import { addDays, entryMinutes, fmtDate, fmtDay, fmtMinutes, mondayOf, n1 } from '@/lib/dates'
import type { Project } from '@/lib/types'

type Proj = Pick<Project, 'id' | 'code' | 'name' | 'deadline' | 'planned_hours' | 'prior_hours'>
type Mem = { project_id: string; employee_id: string; active: boolean; assigned_at: string; unassigned_at: string | null; employee: { full_name: string } | null }

/** Project manager view: the projects they manage, team sizes, workload and recent team changes. */
export default async function PmSection({ ctx }: { ctx: AppContext }) {
  const { supabase, profile, org, today } = ctx
  const weekStart = mondayOf(today)

  const { data: pData } = await supabase.from('projects').select('id, code, name, deadline, planned_hours, prior_hours').eq('pm_id', profile.id).eq('status', 'active').order('code')
  const projects = (pData ?? []) as Proj[]
  const ids = projects.map((p) => p.id)

  const [hoursRes, memRes, entRes] = await Promise.all([
    supabase.rpc('project_hours'),
    ids.length ? supabase.from('project_members').select('project_id, employee_id, active, assigned_at, unassigned_at, employee:profiles!employee_id(full_name)').in('project_id', ids).order('assigned_at', { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from('time_entries').select('project_id, user_id, start_time, end_time, break_min').in('project_id', ids).gte('work_date', weekStart).lte('work_date', addDays(weekStart, 6)) : Promise.resolve({ data: [] }),
  ])
  const hours = new Map(((hoursRes.data ?? []) as { project_id: string; approved_hours: number; pending_hours: number }[]).map((h) => [h.project_id, h]))
  const members = (memRes.data ?? []) as unknown as Mem[]
  const active = members.filter((m) => m.active)
  const ents = (entRes.data ?? []) as { project_id: string; user_id: string; start_time: string; end_time: string; break_min: number }[]

  const teamSize = (id: string) => active.filter((m) => m.project_id === id).length
  const people = new Map(members.map((m) => [m.employee_id, m.employee?.full_name ?? 'Unknown']))
  const workload = new Map<string, number>()
  for (const e of ents) workload.set(e.user_id, (workload.get(e.user_id) ?? 0) + entryMinutes(e))
  const busiest = [...workload.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const maxLoad = busiest[0]?.[1] ?? 0
  const weekMin = ents.reduce((s, e) => s + entryMinutes(e), 0)
  const projCode = new Map(projects.map((p) => [p.id, p.code]))
  const changes = members
    .map((m) => ({ ...m, at: m.unassigned_at ?? m.assigned_at, kind: m.unassigned_at ? 'removed from' : 'added to' }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6)
  const distinctPeople = new Set(active.map((m) => m.employee_id)).size
  const approvedTotal = projects.reduce((s, p) => s + Number(hours.get(p.id)?.approved_hours ?? 0), 0)

  return (
    <>
      <h2 className="section-h">My projects</h2>
      <div className="stats">
        <Stat label="Active projects" value={projects.length} sub="that you manage" icon="folder" href="/projects" />
        <Stat label="People assigned" value={distinctPeople} sub="across your projects" icon="users" />
        <Stat label="Hours this week" value={fmtMinutes(weekMin)} sub="logged on your projects" icon="clock" />
        <Stat label="Approved hours" value={<>{n1(approvedTotal)}<small>h</small></>} sub="all time, your active projects" icon="trend" />
      </div>

      <div className="grid g2">
        <Card title="Project progress" flush action={<Link className="btn s ghost" href="/projects">Manage</Link>}>
          {projects.length === 0 ? (
            <Empty title="You don’t manage any active projects" icon="folder"><Link href="/projects">Create a project</Link></Empty>
          ) : (
            <div className="tw">
              <table className="compact">
                <thead><tr><th scope="col">Project</th><th scope="col" className="num">Team</th><th scope="col" style={{ minWidth: 160 }}>Effort</th><th scope="col">Deadline</th></tr></thead>
                <tbody>
                  {projects.map((p) => {
                    const h = hours.get(p.id)
                    const actual = Number(p.prior_hours) + Number(h?.approved_hours ?? 0)
                    const planned = Number(p.planned_hours)
                    const late = p.deadline && p.deadline < today
                    return (
                      <tr key={p.id}>
                        <td><Link href={`/projects/${p.id}`} className="plink"><Tag>{p.code}</Tag> {p.name}</Link></td>
                        <td className="num"><Link href={`/projects/${p.id}`}>{teamSize(p.id)}</Link></td>
                        <td>
                          <div className="xs">{n1(actual)}h{planned ? ` / ${n1(planned)}h` : ''}{h && Number(h.pending_hours) > 0 ? ` · +${n1(Number(h.pending_hours))}h pending` : ''}</div>
                          {planned ? <Bar value={actual / planned} tone={actual > planned ? 'r' : actual / planned > 0.85 ? 'a' : undefined} label={`${p.code} effort`} /> : null}
                        </td>
                        <td className={`nowrap sm${late ? ' text-bad' : ''}`}>{p.deadline ? fmtDate(p.deadline, { day: 'numeric', month: 'short' }) : '—'}{late ? ' · overdue' : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Team workload this week">
          {busiest.length === 0 ? (
            <Empty title="No time logged on your projects this week" icon="clock" />
          ) : (
            <ul className="hbars">
              {busiest.map(([uid, mins]) => (
                <li key={uid}>
                  <span className="nm">{people.get(uid) ?? (uid === profile.id ? profile.full_name : 'Team member')}</span>
                  <span className="hb"><i style={{ width: `${maxLoad ? (mins / maxLoad) * 100 : 0}%` }} /></span>
                  <span className="vl">{fmtMinutes(mins)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent team changes" className="mt">
        {changes.length === 0 ? (
          <Empty title="No assignments yet" icon="users">Open a project to assign the people who will log time on it.</Empty>
        ) : (
          <ul className="list">
            {changes.map((c, i) => (
              <li className="li" key={i}>
                <div className="grow sm">
                  <b>{c.employee?.full_name ?? 'Someone'}</b> was {c.kind} <Tag>{projCode.get(c.project_id)}</Tag>
                </div>
                <span className="muted xs">{fmtDay(c.at, org.timezone)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
