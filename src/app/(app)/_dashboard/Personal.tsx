import Link from 'next/link'
import type { AppContext } from '@/lib/auth'
import { Badge, Bar, Card, Empty, Stat } from '@/components/ui'
import { Icon } from '@/components/Icon'
import { addDays, entryMinutes, fmtDate, fmtDateTime, fmtMinutes, fmtRange, fmtTime, mondayOf, n1 } from '@/lib/dates'
import { ENTRY_STATUS_LABEL, LEAVE_LABEL, LEAVE_STATUS_LABEL, type EntryStatus, type LeaveBalanceRow, type LeaveRequest } from '@/lib/types'

type Ent = { work_date: string; start_time: string; end_time: string; break_min: number }

/** Everyone's own work: today's timesheet, balances, recent history, pending actions, notifications. */
export default async function Personal({ ctx }: { ctx: AppContext }) {
  const { supabase, profile, org, today } = ctx
  const tracks = profile.tracks_time
  const weekStart = mondayOf(today)
  const year = Number(today.slice(0, 4))

  const [todaySheet, weekEnt, balance, leaves, sheets, changesTs, changesLv, drafts, notifs] = await Promise.all([
    tracks ? supabase.from('daily_timesheets').select('status, submitted_at, edit_until, reviewed_at').eq('user_id', profile.id).eq('work_date', today).maybeSingle() : Promise.resolve({ data: null }),
    tracks ? supabase.from('time_entries').select('work_date, start_time, end_time, break_min').eq('user_id', profile.id).gte('work_date', weekStart).lte('work_date', addDays(weekStart, 6)) : Promise.resolve({ data: [] }),
    supabase.rpc('leave_balance', { p_user: profile.id, p_year: year }),
    supabase.from('leave_requests').select('id, type, start_date, end_date, days, status').eq('user_id', profile.id).neq('status', 'draft').order('created_at', { ascending: false }).limit(5),
    tracks ? supabase.from('daily_timesheets').select('id, work_date, status, reviewed_at').eq('user_id', profile.id).neq('status', 'draft').order('work_date', { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
    tracks ? supabase.from('daily_timesheets').select('work_date').eq('user_id', profile.id).eq('status', 'changes').order('work_date') : Promise.resolve({ data: [] }),
    supabase.from('leave_requests').select('id, type, start_date, end_date').eq('user_id', profile.id).eq('status', 'changes'),
    supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).eq('status', 'draft'),
    supabase.from('notifications').select('id, text, link, read, created_at').order('created_at', { ascending: false }).limit(5),
  ])

  const sheet = todaySheet.data as { status: EntryStatus; submitted_at: string | null; edit_until: string | null; reviewed_at: string | null } | null
  const week = (weekEnt.data ?? []) as Ent[]
  const todayMin = week.filter((e) => e.work_date === today).reduce((s, e) => s + entryMinutes(e), 0)
  const weekMin = week.reduce((s, e) => s + entryMinutes(e), 0)
  const target = org.hours_per_day * 60
  const bal = (balance.data ?? []) as LeaveBalanceRow[]
  const annual = bal.find((b) => b.type === 'annual')
  const sick = bal.find((b) => b.type === 'sick')
  const recentLeave = (leaves.data ?? []) as Pick<LeaveRequest, 'id' | 'type' | 'start_date' | 'end_date' | 'days' | 'status'>[]
  const recentSheets = (sheets.data ?? []) as { id: string; work_date: string; status: EntryStatus; reviewed_at: string | null }[]
  const tsChanges = (changesTs.data ?? []) as { work_date: string }[]
  const lvChanges = (changesLv.data ?? []) as Pick<LeaveRequest, 'id' | 'type' | 'start_date' | 'end_date'>[]
  const notifList = (notifs.data ?? []) as { id: string; text: string; link: string | null; read: boolean; created_at: string }[]

  const todayStatus = sheet?.status
  const actions: { text: string; href: string; tone: 'warn' | 'info' }[] = []
  if (tracks && (!todayStatus || todayStatus === 'draft')) actions.push({ text: todayMin > 0 ? 'Submit today’s timesheet' : 'Log and submit today’s timesheet', href: '/timesheet', tone: 'warn' })
  for (const c of tsChanges) actions.push({ text: `Correct your timesheet for ${fmtDate(c.work_date)}`, href: `/timesheet?correct=${c.work_date}`, tone: 'warn' })
  for (const l of lvChanges) actions.push({ text: `Update your ${LEAVE_LABEL[l.type].toLowerCase()} request (${fmtRange(l.start_date, l.end_date)})`, href: `/leave?edit=${l.id}`, tone: 'warn' })
  if ((drafts.count ?? 0) > 0) actions.push({ text: `${drafts.count} leave draft${drafts.count === 1 ? '' : 's'} not yet submitted`, href: '/leave', tone: 'info' })

  const todayLabel = !tracks
    ? null
    : !todayStatus || todayStatus === 'draft'
      ? (['Not submitted', 'gray'] as const)
      : ENTRY_STATUS_LABEL[todayStatus]
  const windowOpen = todayStatus === 'submitted' && !sheet?.reviewed_at && sheet?.edit_until && new Date(sheet.edit_until).getTime() > Date.now()

  return (
    <>
      <h2 className="section-h">My work</h2>
      <div className="stats">
        {tracks && (
          <Stat
            label="Today's timesheet"
            value={todayLabel ? <Badge label={todayLabel[0]} tone={todayLabel[1]} /> : '—'}
            sub={sheet?.submitted_at ? `Submitted ${fmtTime(sheet.submitted_at, org.timezone)}${windowOpen && sheet.edit_until ? ` · editable until ${fmtTime(sheet.edit_until, org.timezone)}` : ''}` : 'Submit once at the end of the day'}
            icon="clock"
            href="/timesheet"
          />
        )}
        {tracks && (
          <Stat
            label="Hours today"
            value={fmtMinutes(todayMin)}
            sub={<><span>{fmtMinutes(weekMin)} this week · target {n1(target / 60)}h/day</span><Bar value={target ? todayMin / target : 0} tone={todayMin >= target ? 'g' : undefined} label="Today's hours against target" /></>}
            icon="trend"
          />
        )}
        {annual && (
          <Stat label="Annual leave left" value={<>{n1(annual.remaining ?? 0)}<small> days</small></>} sub={`${n1(annual.used)} used · ${n1(annual.pending)} pending · of ${n1(annual.allocated ?? 0)}`} icon="leave" href="/leave" />
        )}
        {sick && <Stat label="Sick leave left" value={<>{n1(sick.remaining ?? 0)}<small> days</small></>} sub={`of ${n1(sick.allocated ?? 0)} days`} icon="leave" href="/leave" />}
      </div>

      <div className="grid g2">
        <Card title="Pending actions" action={actions.length ? <span className="count-pill">{actions.length}</span> : undefined}>
          {actions.length === 0 ? (
            <Empty title="Nothing needs your attention" icon="check" />
          ) : (
            <ul className="action-list">
              {actions.map((a) => (
                <li key={a.href + a.text}>
                  <Link href={a.href} className={`action ${a.tone}`}>
                    <Icon name={a.tone === 'warn' ? 'alert' : 'info'} size={16} />
                    <span className="grow">{a.text}</span>
                    <Icon name="right" size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Notifications" action={<Link className="btn s ghost" href="/notifications">See all</Link>}>
          {notifList.length === 0 ? (
            <Empty title="You're all caught up" icon="bell" />
          ) : (
            <ul className="list">
              {notifList.map((n) => (
                <li className="li" key={n.id}>
                  {!n.read && <span className="unread-dot" aria-label="Unread" />}
                  <div className="grow">
                    <div className={n.read ? 'muted sm' : 'sm t'}>{n.text}</div>
                    <div className="muted xs">{fmtDateTime(n.created_at, org.timezone)}</div>
                  </div>
                  {n.link && <Link className="btn s ghost" href={n.link} aria-label="Open">Open</Link>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent leave requests" action={<Link className="btn s ghost" href="/leave?tab=history">History</Link>}>
          {recentLeave.length === 0 ? (
            <Empty title="No leave requests yet" icon="leave"><Link href="/leave">Request leave</Link></Empty>
          ) : (
            <ul className="list">
              {recentLeave.map((l) => (
                <li className="li" key={l.id}>
                  <div className="grow">
                    <div className="t">{LEAVE_LABEL[l.type]}</div>
                    <div className="muted xs">{fmtRange(l.start_date, l.end_date)} · {n1(l.days)} day{l.days === 1 ? '' : 's'}</div>
                  </div>
                  <Badge label={LEAVE_STATUS_LABEL[l.status][0]} tone={LEAVE_STATUS_LABEL[l.status][1]} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {tracks && (
          <Card title="Recent timesheets" action={<Link className="btn s ghost" href="/timesheet?tab=history">History</Link>}>
            {recentSheets.length === 0 ? (
              <Empty title="No submitted timesheets yet" icon="clock" />
            ) : (
              <ul className="list">
                {recentSheets.map((s) => (
                  <li className="li" key={s.id}>
                    <div className="grow">
                      <div className="t">{fmtDate(s.work_date, { weekday: 'long', day: 'numeric', month: 'short' })}</div>
                      {s.reviewed_at && <div className="muted xs">Reviewed {fmtDateTime(s.reviewed_at, org.timezone)}</div>}
                    </div>
                    <Badge label={ENTRY_STATUS_LABEL[s.status][0]} tone={ENTRY_STATUS_LABEL[s.status][1]} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  )
}
