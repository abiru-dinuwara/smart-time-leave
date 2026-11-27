import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge } from './ui'
import { Icon } from './Icon'
import { fmtDate, fmtDateTime, fmtMinutes, fmtRange, n1 } from '@/lib/dates'
import { APPROVAL_STATUS_LABEL, LEAVE_LABEL, ROLE_LABEL, ROUTE_LABEL, type ApprovalRecord } from '@/lib/types'

/** What the request is about, in one line. */
export function requestSummary(r: ApprovalRecord): ReactNode {
  if (r.kind === 'leave') {
    return (
      <>
        <b>{r.leave_type ? LEAVE_LABEL[r.leave_type] : 'Leave'}</b>
        <div className="muted xs">
          {r.start_date && r.end_date ? fmtRange(r.start_date, r.end_date) : ''} · {n1(Number(r.days ?? 0))} day{Number(r.days) === 1 ? '' : 's'}
        </div>
      </>
    )
  }
  return (
    <>
      <b>Timesheet · {r.work_date ? fmtDate(r.work_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ''}</b>
      <div className="muted xs">
        {r.total_minutes != null ? fmtMinutes(Number(r.total_minutes)) : '—'} · {r.projects ?? 'no entries'}
      </div>
    </>
  )
}

export type SortKey = 'submitted' | 'decided' | 'date' | 'name'

/**
 * Approval records as a table. `sortHref` makes column headers sortable links.
 * Leave reasons are only included for the rows the database returned, which
 * are already limited to what this user may see.
 */
export default function ApprovalTable({
  rows,
  tz,
  showEmployee = true,
  sort,
  sortHref,
  compact,
}: {
  rows: ApprovalRecord[]
  tz: string
  showEmployee?: boolean
  sort?: { key: SortKey; dir: 'asc' | 'desc' }
  sortHref?: (key: SortKey) => string
  compact?: boolean
}) {
  const H = ({ k, children, className }: { k: SortKey; children: ReactNode; className?: string }) => {
    if (!sortHref || !sort) return <th scope="col" className={className}>{children}</th>
    const on = sort.key === k
    return (
      <th scope="col" className={className} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <Link href={sortHref(k)} className="th-sort">
          {children}
          <Icon name={on ? (sort.dir === 'asc' ? 'up' : 'down') : 'sort'} size={12} />
        </Link>
      </th>
    )
  }
  return (
    <div className="tw">
      <table className={compact ? 'compact' : undefined}>
        <thead>
          <tr>
            {showEmployee && <H k="name">Employee</H>}
            <H k="date">Request</H>
            {!compact && <H k="submitted">Submitted</H>}
            <th scope="col">Status</th>
            <th scope="col">Approver</th>
            <H k="decided">Decided</H>
            {!compact && <th scope="col">Comment &amp; details</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const [label, tone] = APPROVAL_STATUS_LABEL[r.status]
            return (
              <tr key={`${r.kind}-${r.request_id}`}>
                {showEmployee && (
                  <td>
                    <b>{r.owner_name}</b>
                    <div className="muted xs">{[ROLE_LABEL[r.owner_role], r.owner_department].filter(Boolean).join(' · ')}</div>
                  </td>
                )}
                <td>{requestSummary(r)}</td>
                {!compact && <td className="nowrap sm">{r.submitted_at ? fmtDateTime(r.submitted_at, tz) : '—'}</td>}
                <td>
                  <Badge label={label} tone={tone} />
                  {r.status === 'pending' && <div className="muted xs">Waiting for {r.route === 'hr' ? 'HR' : 'line manager'}</div>}
                </td>
                <td className="sm">
                  {r.approver_name ?? <span className="muted">—</span>}
                  <div className="muted xs">via {ROUTE_LABEL[r.route]}</div>
                </td>
                <td className="nowrap sm">{r.decided_at ? fmtDateTime(r.decided_at, tz) : <span className="muted">—</span>}</td>
                {!compact && (
                  <td className="sm cell-wide">
                    {r.decision_note ? <span>“{r.decision_note}”</span> : <span className="muted">No comment</span>}
                    {r.kind === 'leave' && r.reason && (
                      <details className="mini-details">
                        <summary>Leave reason</summary>
                        <p>{r.reason}</p>
                      </details>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
