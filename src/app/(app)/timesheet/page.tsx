import Link from 'next/link'
import { requireContext } from '@/lib/auth'
import { Badge, Empty, Flash, Notice, PageHead, Stat, one, type SP } from '@/components/ui'
import { entryMinutes, fmtDate, fmtDateLong, fmtDateTime, fmtMinutes, fmtStamp, fmtTime, hhmm, isIsoDate, n1 } from '@/lib/dates'
import { ENTRY_STATUS_LABEL, TIMESHEET_EDIT_WINDOW_MIN, type DailyTimesheet, type Project, type TimeEntry } from '@/lib/types'
import { deleteEntry, submitDay } from './actions'
import Countdown from './Countdown'
import EntryForm from './EntryForm'

export const metadata = { title: 'My Timesheet' }
// The editing window depends on the current time, so never cache this page.
export const dynamic = 'force-dynamic'

type Entry = TimeEntry & { project: { code: string; name: string } | null }
type Sheet = DailyTimesheet & { reviewer: { full_name: string } | null }

export default async function TimesheetPage({ searchParams }: { searchParams: SP }) {
  const { supabase, profile, org, today } = await requireContext()
  const sp = await searchParams

  if (!profile.tracks_time) {
    return (
      <>
        <PageHead title="My Timesheet" />
        <Notice>Time tracking is not switched on for your account. Ask HR if you need it.</Notice>
      </>
    )
  }

  // Days a manager sent back for changes are the ONLY earlier days that can be opened.
  const [changesRes, staleRes, projectsRes] = await Promise.all([
    supabase.from('daily_timesheets').select('work_date, review_note').eq('user_id', profile.id).eq('status', 'changes').order('work_date'),
    supabase.from('daily_timesheets').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).eq('status', 'draft').lt('work_date', today),
    supabase.from('projects').select('id, code, name').eq('status', 'active').order('code'),
  ])
  const corrections = (changesRes.data ?? []) as { work_date: string; review_note: string | null }[]
  const projects = (projectsRes.data ?? []) as Pick<Project, 'id' | 'code' | 'name'>[]

  const correctParam = one(sp.correct)
  const correcting = isIsoDate(correctParam) && correctParam !== today && corrections.some((c) => c.work_date === correctParam)
  const date = correcting ? (correctParam as string) : today
  const selfPath = correcting ? `/timesheet?correct=${date}` : '/timesheet'
  const editId = one(sp.edit)

  const [sheetRes, entriesRes, reviewsRes, holRes, leaveRes] = await Promise.all([
    supabase.from('daily_timesheets').select('*, reviewer:profiles!reviewed_by(full_name)').eq('user_id', profile.id).eq('work_date', date).maybeSingle(),
    supabase.from('time_entries').select('*, project:projects(code,name)').eq('user_id', profile.id).eq('work_date', date).order('start_time'),
    supabase.from('timesheet_reviews').select('*, actor:profiles!actor_id(full_name)').eq('user_id', profile.id).eq('work_date', date).order('created_at', { ascending: false }),
    supabase.from('holidays').select('name').eq('holiday_date', date).maybeSingle(),
    supabase.from('leave_requests').select('id').eq('user_id', profile.id).eq('status', 'approved').lte('start_date', date).gte('end_date', date).limit(1),
  ])

  const sheet = sheetRes.data as Sheet | null
  const entries = (entriesRes.data ?? []) as Entry[]
  const reviews = (reviewsRes.data ?? []) as { id: string; action: string; note: string; created_at: string; actor: { full_name: string } | null }[]
  const holiday = (holRes.data as { name: string } | null)?.name
  const onLeave = (leaveRes.data ?? []).length > 0

  const status = sheet?.status ?? 'draft'
  const now = Date.now()
  const windowOpen = status === 'submitted' && !sheet?.reviewed_at && !!sheet?.edit_until && new Date(sheet.edit_until).getTime() > now
  const editable = correcting ? status === 'changes' : status === 'draft' || status === 'changes' || windowOpen
  const canSubmit = entries.length > 0 && ((status === 'draft' && date === today) || status === 'changes')
  const total = entries.reduce((s, e) => s + entryMinutes(e), 0)
  const target = org.hours_per_day * 60
  const toForm = (e: Entry) => ({
    id: e.id,
    project_id: e.project_id,
    task: e.task,
    description: e.description,
    start_time: hhmm(e.start_time),
    end_time: hhmm(e.end_time),
    break_min: String(e.break_min),
  })
  const dateLabel = fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <>
      <PageHead
        title="My Timesheet"
        sub={correcting ? 'Your manager asked for changes to this day. Correct it and resubmit.' : "Log today's work, then submit it once for approval."}
      >
        {correcting && <Link className="btn" href="/timesheet">← Back to today</Link>}
      </PageHead>

      <Flash ok={one(sp.ok)} error={one(sp.error)} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row between">
          <div>
            <div className="lab">{correcting ? 'Correcting' : 'Today'}</div>
            <h2 style={{ margin: '2px 0 0' }}>{fmtDateLong(date)}</h2>
          </div>
          <div className="row">
            {holiday && <Badge label={holiday} tone="red" />}
            {onLeave && <Badge label="On approved leave" tone="green" />}
            <Badge label={sheet ? ENTRY_STATUS_LABEL[status][0] : 'Not started'} tone={sheet ? ENTRY_STATUS_LABEL[status][1] : 'gray'} />
          </div>
        </div>
      </div>

      <div className="stats">
        <Stat label="Hours worked" value={fmtMinutes(total)} sub={`Daily target ${n1(target / 60)}h`} />
        <Stat label="Entries" value={entries.length} sub={entries.length === 1 ? 'project / task' : 'projects / tasks'} />
        <Stat
          label="Submitted"
          value={sheet?.submitted_at ? fmtTime(sheet.submitted_at, org.timezone) : '—'}
          sub={sheet?.submitted_at ? fmtStamp(sheet.submitted_at, org.timezone) : 'Not submitted yet'}
        />
        <Stat
          label="Editing"
          value={windowOpen && sheet?.edit_until ? <Countdown until={sheet.edit_until} /> : editable ? 'Open' : 'Locked'}
          sub={
            windowOpen && sheet?.edit_until
              ? `left · until ${fmtTime(sheet.edit_until, org.timezone)}`
              : status === 'submitted'
                ? 'Editing period ended'
                : status === 'approved' || status === 'rejected'
                  ? 'Reviewed by your manager'
                  : 'Until you submit'
          }
        />
      </div>

      {!correcting && corrections.length > 0 && (
        <Notice kind="warn">
          <span>
            <b>Your manager asked for changes</b> on{' '}
            {corrections.map((c, i) => (
              <span key={c.work_date}>
                {i > 0 && ', '}
                <Link href={`/timesheet?correct=${c.work_date}`}>{fmtDate(c.work_date)}</Link>
              </span>
            ))}
            . Open the day, correct it and resubmit.
          </span>
        </Notice>
      )}

      {status === 'changes' && sheet?.review_note && (
        <Notice kind="warn">
          <span><b>{sheet.reviewer?.full_name ?? 'Your manager'} asked for changes:</b> {sheet.review_note}</span>
        </Notice>
      )}
      {windowOpen && sheet?.edit_until && (
        <Notice kind="info">
          <span>
            Submitted at {fmtTime(sheet.last_submitted_at ?? sheet.submitted_at ?? sheet.edit_until, org.timezone)}. You can still edit or add entries for{' '}
            {TIMESHEET_EDIT_WINDOW_MIN} minutes after submitting — until <b>{fmtTime(sheet.edit_until, org.timezone)}</b>, or until your manager reviews it.
          </span>
        </Notice>
      )}
      {status === 'submitted' && !windowOpen && (
        <Notice kind="info">
          <span>
            The {TIMESHEET_EDIT_WINDOW_MIN}-minute editing period
            {sheet?.edit_until && !sheet.reviewed_at ? ` ended at ${fmtTime(sheet.edit_until, org.timezone)}` : ' has ended'}. Your timesheet can no longer be
            changed and is waiting for your manager&apos;s review.
          </span>
        </Notice>
      )}
      {(status === 'approved' || status === 'rejected') && (
        <Notice kind={status === 'approved' ? 'ok' : 'bad'}>
          <span>
            {sheet?.reviewer?.full_name ?? 'Your manager'} {status === 'approved' ? 'approved' : 'rejected'} this timesheet
            {sheet?.reviewed_at ? ` on ${fmtDateTime(sheet.reviewed_at, org.timezone)}` : ''}. It can no longer be changed.
            {sheet?.review_note ? ` “${sheet.review_note}”` : ''}
          </span>
        </Notice>
      )}
      {!correcting && (staleRes.count ?? 0) > 0 && (
        <Notice kind="info">
          {staleRes.count} earlier day{staleRes.count === 1 ? ' was' : 's were'} never submitted. Only today&apos;s timesheet can be submitted, so those days are closed.
        </Notice>
      )}

      <div className="card flush" style={{ marginBottom: 16 }}>
        <div className="ch">
          <h2>{correcting ? 'Entries' : "Today's entries"}</h2>
          <span className="muted sm">{fmtMinutes(total)} of {n1(target / 60)}h</span>
        </div>
        {entries.length === 0 ? (
          <Empty title="Nothing logged yet">Add an entry for each project or task you worked on.</Empty>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Task &amp; description</th>
                  <th>Start – End</th>
                  <th className="num">Break</th>
                  <th className="num">Hours</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) =>
                  editId === e.id && editable ? (
                    <tr key={e.id}>
                      <td colSpan={6}>
                        <EntryForm
                          projects={projects}
                          dateLabel={dateLabel}
                          sheetDate={correcting ? date : undefined}
                          entry={toForm(e)}
                          others={entries.filter((o) => o.id !== e.id)}
                          cancelHref={selfPath}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={e.id}>
                      <td><b>{e.project?.code}</b> <span className="muted">{e.project?.name}</span></td>
                      <td>{e.task || <span className="muted">—</span>}<div className="muted sm">{e.description}</div></td>
                      <td className="nowrap">{hhmm(e.start_time)}–{hhmm(e.end_time)}</td>
                      <td className="num nowrap">{e.break_min} min</td>
                      <td className="num nowrap">{fmtMinutes(entryMinutes(e))}</td>
                      <td className="right nowrap">
                        {editable && (
                          <>
                            <Link className="btn s" href={`${selfPath}${selfPath.includes('?') ? '&' : '?'}edit=${e.id}`}>Edit</Link>
                            <form action={deleteEntry} className="inline" style={{ marginLeft: 6 }}>
                              <input type="hidden" name="id" value={e.id} />
                              <button className="btn s danger" type="submit">Delete</button>
                            </form>
                          </>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
        {editable && !editId && (
          <div style={{ padding: '10px 18px' }}>
            <details className="form" open={entries.length === 0}>
              <summary className="btn s">+ Add entry</summary>
              {projects.length === 0 ? (
                <Notice>There are no active projects yet. Ask a project manager or administrator to create one.</Notice>
              ) : (
                <EntryForm projects={projects} dateLabel={dateLabel} sheetDate={correcting ? date : undefined} others={entries} />
              )}
            </details>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row between">
          <div>
            <b>Total: {fmtMinutes(total)}</b> <span className="muted sm">of {n1(target / 60)}h</span>
            {sheet?.submitted_at && (
              <div className="muted sm">
                First submitted {fmtStamp(sheet.submitted_at, org.timezone)}
                {sheet.resubmissions > 0 && sheet.last_submitted_at ? ` · resubmitted ${fmtStamp(sheet.last_submitted_at, org.timezone)}` : ''}
              </div>
            )}
          </div>
          {(status === 'draft' || status === 'changes') && (
            <form action={submitDay}>
              {correcting && <input type="hidden" name="date" value={date} />}
              <button className="btn primary" type="submit" disabled={!canSubmit}>
                {status === 'changes' ? 'Resubmit timesheet' : 'Submit daily timesheet'}
              </button>
            </form>
          )}
        </div>
        {(status === 'draft' || status === 'changes') && (
          <p className="hint-line" style={{ marginTop: 8 }}>
            {entries.length === 0
              ? 'Add at least one entry before submitting.'
              : `You can submit once per day. After submitting you have ${TIMESHEET_EDIT_WINDOW_MIN} minutes to make corrections.`}
          </p>
        )}
        {reviews.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="lab" style={{ marginBottom: 6 }}>Submission &amp; review history</div>
            <div className="tline">
              {reviews.map((r) => (
                <div key={r.id}>
                  <b>{r.action}</b> by {r.actor?.full_name ?? 'someone'} <span className="muted xs">· {fmtDateTime(r.created_at, org.timezone)}</span>
                  {r.note && <div className="muted sm">“{r.note}”</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
