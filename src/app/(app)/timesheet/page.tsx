import Link from 'next/link'
import { requireContext } from '@/lib/auth'
import { Badge, Empty, Field, Flash, Notice, PageHead, Stat, one, type SP } from '@/components/ui'
import { addDays, entryMinutes, fmtDate, fmtDateTime, fmtMinutes, fmtRange, hhmm, isIsoDate, mondayOf, n1 } from '@/lib/dates'
import { ENTRY_STATUS_LABEL, type EntryStatus, type Project, type TimeEntry } from '@/lib/types'
import { deleteEntry, saveEntry, submitWeek } from './actions'

export const metadata = { title: 'My Timesheet' }

type Entry = TimeEntry & { project: { code: string; name: string } | null }
const EDITABLE: EntryStatus[] = ['draft', 'changes', 'rejected']

function weekStatus(list: Entry[]): EntryStatus | null {
  if (!list.length) return null
  const s = list.map((e) => e.status)
  for (const k of ['changes', 'rejected', 'submitted', 'draft'] as EntryStatus[]) if (s.includes(k)) return k
  return 'approved'
}

function EntryForm({ week, date, projects, entry }: { week: string; date: string; projects: Project[]; entry?: Entry }) {
  return (
    <form action={saveEntry}>
      {entry && <input type="hidden" name="id" value={entry.id} />}
      <div className="frow">
        <Field label="Date"><input type="date" name="work_date" defaultValue={entry?.work_date ?? date} required /></Field>
        <Field label="Project">
          <select name="project_id" defaultValue={entry?.project_id ?? ''} required>
            <option value="" disabled>Choose…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </Field>
        <Field label="Task"><input name="task" defaultValue={entry?.task ?? ''} maxLength={200} placeholder="e.g. Code review" /></Field>
      </div>
      <div className="frow">
        <Field label="Start"><input type="time" name="start_time" defaultValue={entry ? hhmm(entry.start_time) : '09:00'} required /></Field>
        <Field label="End"><input type="time" name="end_time" defaultValue={entry ? hhmm(entry.end_time) : '17:00'} required /></Field>
        <Field label="Break (minutes)"><input type="number" name="break_min" min={0} max={600} defaultValue={entry?.break_min ?? 0} /></Field>
      </div>
      <Field label="What did you work on?">
        <textarea name="description" defaultValue={entry?.description ?? ''} maxLength={1000} />
      </Field>
      <div className="row">
        <button className="btn primary" type="submit">{entry ? 'Save changes' : 'Add entry'}</button>
        {entry && <Link className="btn" href={`/timesheet?week=${week}`}>Cancel</Link>}
      </div>
    </form>
  )
}

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

  const wParam = one(sp.week)
  const week = isIsoDate(wParam) ? mondayOf(wParam) : mondayOf(today)
  const weekEnd = addDays(week, 6)
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const editId = one(sp.edit)

  const [entriesRes, projectsRes, reviewsRes, holRes, leaveRes] = await Promise.all([
    supabase.from('time_entries').select('*, project:projects(code,name)').eq('user_id', profile.id).eq('week_start', week).order('work_date').order('start_time'),
    supabase.from('projects').select('*').eq('status', 'active').order('code'),
    supabase.from('timesheet_reviews').select('*, actor:profiles!actor_id(full_name)').eq('user_id', profile.id).eq('week_start', week).order('created_at', { ascending: false }).limit(3),
    supabase.from('holidays').select('holiday_date,name').gte('holiday_date', week).lte('holiday_date', weekEnd),
    supabase.from('leave_requests').select('start_date,end_date,type,status').eq('user_id', profile.id).eq('status', 'approved').lte('start_date', weekEnd).gte('end_date', week),
  ])

  const entries = (entriesRes.data ?? []) as Entry[]
  const projects = (projectsRes.data ?? []) as Project[]
  const reviews = (reviewsRes.data ?? []) as { id: string; action: string; note: string; created_at: string; actor: { full_name: string } | null }[]
  const hols = new Map(((holRes.data ?? []) as { holiday_date: string; name: string }[]).map((h) => [h.holiday_date, h.name]))
  const leaves = (leaveRes.data ?? []) as { start_date: string; end_date: string }[]
  const onLeave = (d: string) => leaves.some((l) => l.start_date <= d && d <= l.end_date)

  const total = entries.reduce((s, e) => s + entryMinutes(e), 0)
  const weekdaysOff = days.slice(0, 5).filter((d) => hols.has(d) || onLeave(d)).length
  const target = org.hours_per_day * 60 * (5 - weekdaysOff)
  const status = weekStatus(entries)
  const editable = entries.filter((e) => EDITABLE.includes(e.status))
  const feedback = entries.find((e) => e.review_note && (e.status === 'changes' || e.status === 'rejected'))

  return (
    <>
      <PageHead title="My Timesheet" sub="Log what you worked on each day, then submit the week for approval.">
        <Link className="btn" href={`/timesheet?week=${addDays(week, -7)}`}>← Previous</Link>
        <Link className="btn" href="/timesheet">This week</Link>
        <Link className="btn" href={`/timesheet?week=${addDays(week, 7)}`}>Next →</Link>
      </PageHead>

      <Flash ok={one(sp.ok)} error={one(sp.error)} />

      <div className="stats">
        <Stat label="Week" value={fmtRange(week, weekEnd).split(' – ')[0]} sub={`to ${fmtDate(weekEnd, { day: 'numeric', month: 'short' })}`} />
        <Stat label="Logged" value={fmtMinutes(total)} sub={`Target ${n1(target / 60)}h`} />
        <div className="stat">
          <div className="l">Status</div>
          <div className="v" style={{ fontSize: 18, marginTop: 8 }}>
            {status ? <Badge label={ENTRY_STATUS_LABEL[status][0]} tone={ENTRY_STATUS_LABEL[status][1]} /> : <span className="muted">No entries</span>}
          </div>
        </div>
      </div>

      {feedback && (
        <Notice kind="warn">
          <span><b>Your manager asked for changes:</b> {feedback.review_note}</span>
        </Notice>
      )}

      {days.map((d) => {
        const list = entries.filter((e) => e.work_date === d)
        const dayMin = list.reduce((s, e) => s + entryMinutes(e), 0)
        const weekend = d > addDays(week, 4)
        return (
          <div className="card flush" key={d} style={{ marginBottom: 14 }}>
            <div className="ch">
              <div className="row">
                <h2>{fmtDate(d)}</h2>
                {d === today && <Badge label="Today" tone="blue" />}
                {hols.has(d) && <Badge label={hols.get(d)!} tone="red" />}
                {onLeave(d) && <Badge label="On approved leave" tone="green" />}
              </div>
              <span className="muted sm">{dayMin ? fmtMinutes(dayMin) : weekend ? 'Weekend' : 'Nothing logged'}</span>
            </div>
            {list.length > 0 && (
              <div className="tw">
                <table>
                  <tbody>
                    {list.map((e) =>
                      editId === e.id && EDITABLE.includes(e.status) ? (
                        <tr key={e.id}>
                          <td colSpan={6}><EntryForm week={week} date={d} projects={projects} entry={e} /></td>
                        </tr>
                      ) : (
                        <tr key={e.id}>
                          <td className="nowrap">{hhmm(e.start_time)}–{hhmm(e.end_time)}</td>
                          <td><b>{e.project?.code}</b> <span className="muted">{e.project?.name}</span></td>
                          <td>{e.task || <span className="muted">—</span>}<div className="muted sm">{e.description}</div></td>
                          <td className="num nowrap">{fmtMinutes(entryMinutes(e))}</td>
                          <td><Badge label={ENTRY_STATUS_LABEL[e.status][0]} tone={ENTRY_STATUS_LABEL[e.status][1]} /></td>
                          <td className="right nowrap">
                            {EDITABLE.includes(e.status) && (
                              <>
                                <Link className="btn s" href={`/timesheet?week=${week}&edit=${e.id}`}>Edit</Link>
                                <form action={deleteEntry} className="inline" style={{ marginLeft: 6 }}>
                                  <input type="hidden" name="id" value={e.id} />
                                  <input type="hidden" name="week" value={week} />
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
            <div style={{ padding: '10px 18px' }}>
              <details className="form">
                <summary className="btn s">+ Add entry</summary>
                {projects.length === 0 ? (
                  <Notice>There are no active projects yet. Ask a project manager or administrator to create one.</Notice>
                ) : (
                  <EntryForm week={week} date={d} projects={projects} />
                )}
              </details>
            </div>
          </div>
        )
      })}

      <div className="card">
        <div className="row between">
          <div>
            <b>Week total: {fmtMinutes(total)}</b> <span className="muted sm">of {n1(target / 60)}h</span>
          </div>
          <form action={submitWeek}>
            <input type="hidden" name="week" value={week} />
            <button className="btn primary" type="submit" disabled={editable.length === 0}>
              Submit week for approval{editable.length ? ` (${editable.length})` : ''}
            </button>
          </form>
        </div>
        {reviews.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="lab" style={{ marginBottom: 6 }}>Review history</div>
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
        {entries.length === 0 && <Empty title="Nothing logged this week yet">Use “Add entry” on any day.</Empty>}
      </div>
    </>
  )
}
