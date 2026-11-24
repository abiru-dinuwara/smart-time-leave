import { redirect } from 'next/navigation'
import { requireContext } from '@/lib/auth'
import { Avatar, Badge, Empty, PageHead, Stat } from '@/components/ui'
import { fmtRange } from '@/lib/dates'
import { LEAVE_LABEL, ROLE_LABEL, type LeaveRequest, type Profile } from '@/lib/types'

export const metadata = { title: 'Team' }

export default async function TeamPage() {
  const { supabase, profile, today, isApprover } = await requireContext()
  // HR and leadership see everyone; other managers see their direct reports.
  const seesAll = profile.role === 'hr' || profile.role === 'leadership'
  if (!seesAll && !isApprover) redirect('/')
  const isManager = !seesAll

  let q = supabase.from('profiles').select('*').eq('active', true).order('full_name')
  if (isManager) q = q.eq('manager_id', profile.id)
  const { data } = await q
  const people = ((data ?? []) as Profile[]).filter((p) => p.tracks_time || !isManager)
  const ids = people.map((p) => p.id)

  const { data: lv } = ids.length
    ? await supabase.from('leave_requests').select('*').in('user_id', ids).in('status', ['approved', 'pending']).gte('end_date', today).order('start_date')
    : { data: [] }
  const leaves = (lv ?? []) as LeaveRequest[]
  const out = (id: string) => leaves.find((l) => l.user_id === id && l.status === 'approved' && l.start_date <= today && today <= l.end_date)
  const next = (id: string) => leaves.find((l) => l.user_id === id && l.start_date > today)
  const names = new Map(people.map((p) => [p.id, p.full_name]))
  const manager = (p: Profile) => (p.manager_id ? names.get(p.manager_id) ?? '—' : '—')
  const outCount = people.filter((p) => out(p.id)).length

  return (
    <>
      <PageHead title={isManager ? 'Team Availability' : 'Employee Overview'} sub={isManager ? 'The people who report to you.' : 'Everyone in the company.'} />
      <div className="stats">
        <Stat label="People" value={people.length} />
        <Stat label="Away today" value={outCount} sub="on approved leave" />
        <Stat label="Pending requests" value={leaves.filter((l) => l.status === 'pending').length} />
      </div>
      <div className="card flush">
        {people.length === 0 ? (
          <Empty title="No one to show yet">{isManager ? 'People appear here once an administrator sets you as their manager.' : 'Add people from the People page.'}</Empty>
        ) : (
          <div className="tw">
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Department</th>{!isManager && <th>Manager</th>}<th>Today</th><th>Next leave</th></tr></thead>
              <tbody>
                {people.map((p) => {
                  const o = out(p.id)
                  const n = next(p.id)
                  return (
                    <tr key={p.id}>
                      <td><div className="row"><Avatar name={p.full_name} /><div><b>{p.full_name}</b><div className="muted xs">{p.position ?? ROLE_LABEL[p.role]}</div></div></div></td>
                      <td>{ROLE_LABEL[p.role]}</td>
                      <td>{p.department ?? '—'}</td>
                      {!isManager && <td>{manager(p)}</td>}
                      <td>{o ? <Badge label={`Away (${LEAVE_LABEL[o.type]})`} tone="green" /> : <Badge label="Available" tone="gray" />}</td>
                      <td className="sm">{n ? `${fmtRange(n.start_date, n.end_date)} · ${n.status}` : <span className="muted">—</span>}</td>
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
