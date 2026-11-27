import Link from 'next/link'
import { requireContext } from '@/lib/auth'
import { approverInfo } from '@/lib/routing'
import { Badge, Bar, Empty, Flash, Notice, PageHead, Tabs, one, type SP } from '@/components/ui'
import ConfirmButton from '@/components/ConfirmButton'
import { fmtDateTime, fmtRange, n1 } from '@/lib/dates'
import { LEAVE_LABEL, LEAVE_STATUS_LABEL, ROUTE_LABEL, type LeaveBalanceRow, type LeaveRequest } from '@/lib/types'
import { cancelLeave, deleteDraft } from './actions'
import LeaveForm from './LeaveForm'
import LeaveHistory from './LeaveHistory'

export const metadata = { title: 'My Leave' }

type Req = Pick<
  LeaveRequest,
  'id' | 'type' | 'start_date' | 'end_date' | 'half' | 'days' | 'reason' | 'status' | 'decided_at' | 'decision_note' | 'approval_route' | 'submitted_at' | 'last_submitted_at'
> & { decider: { full_name: string } | null }

export default async function LeavePage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext()
  const { supabase, profile, org, today } = ctx
  const sp = await searchParams
  const tab = one(sp.tab) === 'history' ? 'history' : 'overview'
  const editId = one(sp.edit)
  const year = Number(today.slice(0, 4))

  const tabs = (
    <Tabs
      current={tab}
      items={[
        { key: 'overview', label: 'Overview', href: '/leave' },
        { key: 'history', label: 'History', href: '/leave?tab=history' },
      ]}
    />
  )

  if (tab === 'history') {
    return (
      <>
        <PageHead title="My Leave" sub="All your leave requests, who decided them, when, and their comments." />
        <Flash ok={one(sp.ok)} error={one(sp.error)} />
        {tabs}
        <LeaveHistory ctx={ctx} sp={sp} />
      </>
    )
  }

  // Overview: balances + the requests that still need attention or are coming up.
  const [balRes, reqRes, approver] = await Promise.all([
    supabase.rpc('leave_balance', { p_user: profile.id, p_year: year }),
    supabase
      .from('leave_requests')
      .select('id, type, start_date, end_date, half, days, reason, status, decided_at, decision_note, approval_route, submitted_at, last_submitted_at, decider:profiles!decided_by(full_name)')
      .eq('user_id', profile.id)
      .or(`status.in.(draft,pending,changes),and(status.eq.approved,end_date.gte.${today})`)
      .order('start_date')
      .limit(50),
    approverInfo(ctx),
  ])
  const balances = (balRes.data ?? []) as LeaveBalanceRow[]
  const requests = (reqRes.data ?? []) as unknown as Req[]

  // An edit link may point at a request that is not in the overview list (e.g. from a notification).
  let editing: Req | undefined = editId ? requests.find((r) => r.id === editId) : undefined
  if (editId && !editing) {
    const { data } = await supabase
      .from('leave_requests')
      .select('id, type, start_date, end_date, half, days, reason, status, decided_at, decision_note, approval_route, submitted_at, last_submitted_at, decider:profiles!decided_by(full_name)')
      .eq('id', editId)
      .eq('user_id', profile.id)
      .maybeSingle()
    editing = (data as unknown as Req | null) ?? undefined
  }
  if (editing && !['draft', 'changes'].includes(editing.status)) editing = undefined

  const toForm = (r: Req) => ({ id: r.id, type: r.type, start_date: r.start_date, end_date: r.end_date, half: r.half, reason: r.reason })
  const needsChanges = requests.filter((r) => r.status === 'changes')
  const waitingFor = (r: Req) => (r.approval_route === 'hr' ? 'HR' : approver.managerName ?? ROUTE_LABEL.manager)

  return (
    <>
      <PageHead title="My Leave" sub={`Request time off and track your balance. ${approver.sentence}`}>
        <Link className="btn" href="/leave?tab=history">View full history</Link>
      </PageHead>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      {tabs}

      <div className="stats">
        {balances.filter((b) => b.type !== 'unpaid').map((b) => (
          <div className="stat" key={b.type}>
            <div className="stat-top"><span className="l">{LEAVE_LABEL[b.type]} · {year}</span></div>
            <div className="v">{b.remaining == null ? '—' : <>{n1(b.remaining)}<small> days left</small></>}</div>
            <div className="s">{b.allocated == null ? 'No limit' : `${n1(b.used)} used · ${n1(b.pending)} pending · of ${n1(b.allocated)}`}</div>
            {b.allocated ? <div style={{ marginTop: 8 }}><Bar value={(b.used + b.pending) / b.allocated} tone={(b.remaining ?? 0) <= 0 ? 'r' : undefined} label={`${LEAVE_LABEL[b.type]} used`} /></div> : null}
          </div>
        ))}
      </div>

      {needsChanges.length > 0 && !editing && (
        <Notice kind="warn" title="A request needs your changes">Use <b>Edit &amp; resubmit</b> below.</Notice>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        {editing ? (
          <>
            <div className="ch"><h2>Edit request</h2></div>
            {editing.decision_note && <Notice kind="info">{editing.decider?.full_name ?? 'Your approver'} said: “{editing.decision_note}”</Notice>}
            <LeaveForm today={today} req={toForm(editing)} approver={approver} />
          </>
        ) : (
          <details className="form" open={Boolean(one(sp.error))}>
            <summary className="btn primary">+ New leave request</summary>
            <LeaveForm today={today} approver={approver} />
          </details>
        )}
      </section>

      <section className="card flush">
        <div className="ch">
          <h2>Active &amp; upcoming requests</h2>
          <Link className="btn s ghost" href="/leave?tab=history">All history →</Link>
        </div>
        {requests.length === 0 ? (
          <Empty title="Nothing active" icon="leave">Drafts, pending and upcoming approved leave appear here. Use “New leave request” to get started.</Empty>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr><th scope="col">Dates</th><th scope="col">Type</th><th scope="col" className="num">Days</th><th scope="col">Status</th><th scope="col">Approval</th><th scope="col"><span className="sr">Actions</span></th></tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const [label, tone] = LEAVE_STATUS_LABEL[r.status]
                  // Approved leave can never be cancelled by the requester (enforced in the database).
                  const canCancel = r.status === 'pending' || r.status === 'changes'
                  return (
                    <tr key={r.id}>
                      <td className="nowrap"><b>{fmtRange(r.start_date, r.end_date)}</b>{r.half !== 'none' && <div className="muted xs">{r.half === 'AM' ? 'Morning' : 'Afternoon'}</div>}</td>
                      <td>{LEAVE_LABEL[r.type]}</td>
                      <td className="num">{n1(r.days)}</td>
                      <td><Badge label={label} tone={tone} /></td>
                      <td className="sm">
                        {r.status === 'pending' && (
                          <>Waiting for {waitingFor(r)}{r.last_submitted_at ? <span className="muted xs"> · sent {fmtDateTime(r.last_submitted_at, org.timezone)}</span> : null}</>
                        )}
                        {(r.status === 'approved' || r.status === 'changes') && r.decided_at && (
                          <>
                            {r.status === 'approved' ? 'Approved' : 'Changes requested'} by {r.decider?.full_name ?? 'your approver'}
                            <span className="muted xs"> · {fmtDateTime(r.decided_at, org.timezone)}</span>
                          </>
                        )}
                        {r.status === 'draft' && <span className="muted">Not submitted</span>}
                        {r.decision_note && <div>“{r.decision_note}”</div>}
                      </td>
                      <td className="right nowrap">
                        {(r.status === 'draft' || r.status === 'changes') && (
                          <Link className="btn s" href={`/leave?edit=${r.id}`}>{r.status === 'changes' ? 'Edit & resubmit' : 'Edit'}</Link>
                        )}
                        {r.status === 'draft' && !r.submitted_at && (
                          <form action={deleteDraft} className="inline">
                            <input type="hidden" name="id" value={r.id} />
                            <ConfirmButton className="btn s danger" confirmClassName="btn danger-solid" title="Delete this draft?" message={<p>The draft for {fmtRange(r.start_date, r.end_date)} will be removed.</p>} confirmLabel="Delete draft">Delete</ConfirmButton>
                          </form>
                        )}
                        {(canCancel || (r.status === 'draft' && r.submitted_at)) && (
                          <form action={cancelLeave} className="inline">
                            <input type="hidden" name="id" value={r.id} />
                            <ConfirmButton className="btn s danger" confirmClassName="btn danger-solid" title="Cancel this leave request?" message={<p>{LEAVE_LABEL[r.type]}, {fmtRange(r.start_date, r.end_date)}. {r.status === 'pending' ? 'Your approver will be told it was cancelled.' : ''} This cannot be undone.</p>} confirmLabel="Cancel request">Cancel</ConfirmButton>
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
