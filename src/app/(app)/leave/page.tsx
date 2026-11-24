import Link from 'next/link'
import { requireContext } from '@/lib/auth'
import { Badge, Bar, Empty, Flash, PageHead, one, type SP } from '@/components/ui'
import { fmtDateTime, fmtRange, n1 } from '@/lib/dates'
import { LEAVE_LABEL, LEAVE_STATUS_LABEL, type LeaveBalanceRow, type LeaveRequest } from '@/lib/types'
import { cancelLeave, deleteDraft } from './actions'
import LeaveForm from './LeaveForm'

export const metadata = { title: 'My Leave' }

type Req = LeaveRequest & { decider: { full_name: string } | null }
type Hist = { id: string; leave_id: string; action: string; note: string; created_at: string; actor: { full_name: string } | null }

export default async function LeavePage({ searchParams }: { searchParams: SP }) {
  const { supabase, profile, org, today } = await requireContext()
  const sp = await searchParams
  const editId = one(sp.edit)
  const year = Number(today.slice(0, 4))

  const [balRes, reqRes, mgrRes] = await Promise.all([
    supabase.rpc('leave_balance', { p_user: profile.id, p_year: year }),
    supabase.from('leave_requests').select('*, decider:profiles!decided_by(full_name)').eq('user_id', profile.id).order('start_date', { ascending: false }).limit(100),
    profile.manager_id
      ? supabase.from('profiles').select('full_name, active').eq('id', profile.manager_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const mgr = mgrRes.data as { full_name: string; active: boolean } | null
  /** Leave is approved only by the line manager; without an active one, submission is blocked. */
  const managerName = mgr?.active ? mgr.full_name : null
  const balances = (balRes.data ?? []) as LeaveBalanceRow[]
  const requests = (reqRes.data ?? []) as Req[]

  const ids = requests.map((r) => r.id)
  const histRes = ids.length
    ? await supabase.from('leave_history').select('*, actor:profiles!actor_id(full_name)').in('leave_id', ids).order('created_at')
    : { data: [] }
  const history = (histRes.data ?? []) as Hist[]

  const editing = editId ? requests.find((r) => r.id === editId && ['draft', 'changes'].includes(r.status)) : undefined
  const toForm = (r: Req) => ({ id: r.id, type: r.type, start_date: r.start_date, end_date: r.end_date, half: r.half, reason: r.reason })
  const needsChanges = requests.filter((r) => r.status === 'changes')

  return (
    <>
      <PageHead
        title="My Leave"
        sub={managerName ? `Request time off. Requests are approved by your line manager, ${managerName}.` : 'Request time off and follow its approval.'}
      />
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      {!managerName && (
        <div className="notice n-warn">
          You do not have an active line manager assigned. Leave requests can only be approved by your line manager, so you cannot submit a request until HR or an administrator assigns one on the People page.
        </div>
      )}

      <div className="stats">
        {balances.filter((b) => b.type !== 'unpaid').map((b) => (
          <div className="stat" key={b.type}>
            <div className="l">{LEAVE_LABEL[b.type]} · {year}</div>
            <div className="v">{b.remaining == null ? '—' : `${n1(b.remaining)} d`}</div>
            <div className="s">{b.allocated == null ? 'No limit' : `${n1(b.used)} used · ${n1(b.pending)} pending · of ${n1(b.allocated)}`}</div>
            {b.allocated ? <div style={{ marginTop: 8 }}><Bar value={(b.used + b.pending) / b.allocated} /></div> : null}
          </div>
        ))}
      </div>

      {needsChanges.length > 0 && !editing && (
        <div className="notice n-warn">A request needs your changes — use <b>Edit &amp; resubmit</b> below.</div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        {editing ? (
          <>
            <div className="ch"><h2>Edit request</h2></div>
            {editing.decision_note && <div className="notice n-info">{editing.decider?.full_name ?? 'Your approver'} said: “{editing.decision_note}”</div>}
            <LeaveForm today={today} req={toForm(editing)} managerName={managerName} />
          </>
        ) : (
          <details className="form" open={Boolean(one(sp.error))}>
            <summary className="btn primary">+ New leave request</summary>
            <LeaveForm today={today} managerName={managerName} />
          </details>
        )}
      </div>

      <div className="card flush">
        <div className="ch"><h2>My requests</h2></div>
        {requests.length === 0 ? (
          <Empty title="No leave requests yet">Use “New leave request” to get started.</Empty>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr><th>Dates</th><th>Type</th><th className="num">Days</th><th>Status</th><th>Approval &amp; history</th><th /></tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const [label, tone] = LEAVE_STATUS_LABEL[r.status]
                  const h = history.filter((x) => x.leave_id === r.id)
                  // Approved leave can never be cancelled by the employee (also enforced by the database).
                  const canCancel = r.status === 'pending' || r.status === 'changes'
                  const submitted = h.filter((x) => x.action === 'Submitted' || x.action === 'Resubmitted').at(-1)
                  return (
                    <tr key={r.id}>
                      <td className="nowrap"><b>{fmtRange(r.start_date, r.end_date)}</b>{r.half !== 'none' && <div className="muted xs">{r.half === 'AM' ? 'Morning' : 'Afternoon'}</div>}</td>
                      <td>{LEAVE_LABEL[r.type]}</td>
                      <td className="num">{n1(r.days)}</td>
                      <td><Badge label={label} tone={tone} /></td>
                      <td>
                        {r.status === 'pending' && (
                          <div className="sm">Waiting for {managerName ?? 'your line manager'}{submitted ? <span className="muted xs"> · sent {fmtDateTime(submitted.created_at, org.timezone)}</span> : null}</div>
                        )}
                        {['approved', 'rejected', 'changes'].includes(r.status) && r.decided_at && (
                          <div className="sm">
                            {r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Changes requested'} by {r.decider?.full_name ?? 'your manager'}
                            <span className="muted xs"> · {fmtDateTime(r.decided_at, org.timezone)}</span>
                          </div>
                        )}
                        {r.decision_note && <div className="sm">“{r.decision_note}”</div>}
                        <details>
                          <summary className="muted sm" style={{ cursor: 'pointer' }}>History</summary>
                          <div className="tline" style={{ marginTop: 6 }}>
                            {h.map((x) => (
                              <div key={x.id}>
                                <b>{x.action}</b> <span className="muted xs">{x.actor?.full_name} · {fmtDateTime(x.created_at, org.timezone)}</span>
                                {x.note && <div className="muted sm">“{x.note}”</div>}
                              </div>
                            ))}
                          </div>
                        </details>
                      </td>
                      <td className="right nowrap">
                        {(r.status === 'draft' || r.status === 'changes') && (
                          <Link className="btn s" href={`/leave?edit=${r.id}`}>{r.status === 'changes' ? 'Edit & resubmit' : 'Edit'}</Link>
                        )}
                        {r.status === 'draft' && (
                          <form action={deleteDraft} className="inline"><input type="hidden" name="id" value={r.id} /><button className="btn s danger" type="submit">Delete</button></form>
                        )}
                        {canCancel && (
                          <form action={cancelLeave} className="inline"><input type="hidden" name="id" value={r.id} /><button className="btn s danger" type="submit">Cancel</button></form>
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
