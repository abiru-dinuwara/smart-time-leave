import Link from 'next/link'
import { requireContext } from '@/lib/auth'
import { Badge, Bar, Empty, Field, Flash, PageHead, Stat, one, type SP } from '@/components/ui'
import { fmtDateTime, fmtRange, n1 } from '@/lib/dates'
import { LEAVE_LABEL, LEAVE_STATUS_LABEL, type LeaveBalanceRow, type LeaveRequest, type LeaveType } from '@/lib/types'
import { cancelLeave, deleteDraft, saveLeave } from './actions'

export const metadata = { title: 'My Leave' }

type Req = LeaveRequest & { decider: { full_name: string } | null }
type Hist = { id: string; leave_id: string; action: string; note: string; created_at: string; actor: { full_name: string } | null }

function LeaveForm({ req }: { req?: Req }) {
  return (
    <form action={saveLeave}>
      {req && <input type="hidden" name="id" value={req.id} />}
      <div className="frow">
        <Field label="Leave type">
          <select name="type" defaultValue={req?.type ?? 'annual'} required>
            {(Object.keys(LEAVE_LABEL) as LeaveType[]).map((t) => <option key={t} value={t}>{LEAVE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="First day"><input type="date" name="start_date" defaultValue={req?.start_date} required /></Field>
        <Field label="Last day" hint="Leave empty for a single day"><input type="date" name="end_date" defaultValue={req && req.end_date !== req.start_date ? req.end_date : ''} /></Field>
        <Field label="Half day?" hint="Single day only">
          <select name="half" defaultValue={req?.half ?? 'none'}>
            <option value="none">Full day(s)</option>
            <option value="AM">Morning only</option>
            <option value="PM">Afternoon only</option>
          </select>
        </Field>
      </div>
      <Field label="Reason (optional)"><textarea name="reason" defaultValue={req?.reason ?? ''} maxLength={1000} /></Field>
      <p className="hint-line" style={{ marginBottom: 10 }}>
        Weekends and company holidays are not counted. Your balance and overlapping requests are checked when you submit.
      </p>
      <div className="row">
        <button className="btn primary" type="submit" name="intent" value="pending">{req ? 'Resubmit for approval' : 'Submit request'}</button>
        <button className="btn" type="submit" name="intent" value="draft">Save as draft</button>
        {req && <Link className="btn" href="/leave">Cancel</Link>}
      </div>
    </form>
  )
}

export default async function LeavePage({ searchParams }: { searchParams: SP }) {
  const { supabase, profile, org, today } = await requireContext()
  const sp = await searchParams
  const editId = one(sp.edit)
  const year = Number(today.slice(0, 4))

  const [balRes, reqRes] = await Promise.all([
    supabase.rpc('leave_balance', { p_user: profile.id, p_year: year }),
    supabase.from('leave_requests').select('*, decider:profiles!decided_by(full_name)').eq('user_id', profile.id).order('start_date', { ascending: false }).limit(100),
  ])
  const balances = (balRes.data ?? []) as LeaveBalanceRow[]
  const requests = (reqRes.data ?? []) as Req[]

  const ids = requests.map((r) => r.id)
  const histRes = ids.length
    ? await supabase.from('leave_history').select('*, actor:profiles!actor_id(full_name)').in('leave_id', ids).order('created_at')
    : { data: [] }
  const history = (histRes.data ?? []) as Hist[]

  const editing = editId ? requests.find((r) => r.id === editId && ['draft', 'changes'].includes(r.status)) : undefined
  const needsChanges = requests.filter((r) => r.status === 'changes')

  return (
    <>
      <PageHead title="My Leave" sub="Request time off and follow its approval." />
      <Flash ok={one(sp.ok)} error={one(sp.error)} />

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
            <LeaveForm req={editing} />
          </>
        ) : (
          <details className="form" open={Boolean(one(sp.error))}>
            <summary className="btn primary">+ New leave request</summary>
            <LeaveForm />
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
                <tr><th>Dates</th><th>Type</th><th className="num">Days</th><th>Status</th><th>Details</th><th /></tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const [label, tone] = LEAVE_STATUS_LABEL[r.status]
                  const h = history.filter((x) => x.leave_id === r.id)
                  const canCancel = r.status === 'pending' || r.status === 'changes' || (r.status === 'approved' && r.start_date > today)
                  return (
                    <tr key={r.id}>
                      <td className="nowrap"><b>{fmtRange(r.start_date, r.end_date)}</b>{r.half !== 'none' && <div className="muted xs">{r.half === 'AM' ? 'Morning' : 'Afternoon'}</div>}</td>
                      <td>{LEAVE_LABEL[r.type]}</td>
                      <td className="num">{n1(r.days)}</td>
                      <td><Badge label={label} tone={tone} /></td>
                      <td>
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
