'use server'

import { revalidatePath } from 'next/cache'
import { requireContext } from '@/lib/auth'
import { back, friendly } from '@/lib/flash'
import { isIsoDate } from '@/lib/dates'
import type { DailyTimesheet } from '@/lib/types'
import { field, hasErrors, readTimeEntry, validateTimeEntry, type FormState } from '@/lib/validation'

/** Where to send the employee back to: today's sheet, or a sheet being corrected. */
const pathFor = (date: string, today: string) => (date && date !== today ? `/timesheet?correct=${date}` : '/timesheet')

const failed = (prev: FormState, values: Record<string, string>, message: string, errors: FormState['errors'] = {}): FormState => ({
  errors,
  message,
  values,
  attempt: prev.attempt + 1,
})

/**
 * Add or edit one entry of a daily timesheet.
 * The work date is never taken from the browser: it is today (company time zone)
 * or, for an existing entry, that entry's own date. A different date is only
 * accepted for a timesheet a manager sent back for changes. The database checks
 * all of this again (migration 0003).
 */
export async function saveEntry(prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, profile, today } = await requireContext()
  const input = readTimeEntry(formData)
  const values = { ...input }
  if (!profile.tracks_time) return failed(prev, values, 'Time tracking is not switched on for your account.')

  const id = field(formData, 'id')
  const sheetDate = field(formData, 'sheet_date')
  let workDate = today

  if (id) {
    const { data: existing } = await supabase.from('time_entries').select('id, work_date').eq('id', id).eq('user_id', profile.id).maybeSingle()
    if (!existing) return failed(prev, values, 'This entry no longer exists.')
    workDate = (existing as { work_date: string }).work_date
  } else if (sheetDate && sheetDate !== today) {
    if (!isIsoDate(sheetDate)) return failed(prev, values, 'Time can only be logged for today.')
    const { data: sheet } = await supabase.from('daily_timesheets').select('status').eq('user_id', profile.id).eq('work_date', sheetDate).maybeSingle()
    if ((sheet as Pick<DailyTimesheet, 'status'> | null)?.status !== 'changes')
      return failed(prev, values, 'Time can only be logged for today. Past and future dates are not allowed.')
    workDate = sheetDate
  }

  const { data: editable, error: editErr } = await supabase.rpc('timesheet_day_editable', { p_user: profile.id, p_date: workDate })
  if (editErr) return failed(prev, values, friendly(editErr.message))
  if (!editable)
    return failed(prev, values, 'This timesheet can no longer be edited: the 30-minute editing period has ended or it has already been reviewed.')

  // Project access is checked on the server (never trust the project id from the browser).
  // Keeping an entry's existing project is always allowed, so history stays editable after unassignment.
  const [{ data: sameDay }, { data: allowed }, { data: current }] = await Promise.all([
    supabase.from('time_entries').select('id, start_time, end_time').eq('user_id', profile.id).eq('work_date', workDate),
    supabase.rpc('my_loggable_projects'),
    id ? supabase.from('time_entries').select('project_id').eq('id', id).eq('user_id', profile.id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const keepsProject = (current as { project_id: string } | null)?.project_id === input.project_id
  if (input.project_id && !keepsProject && !((allowed ?? []) as { id: string }[]).some((p) => p.id === input.project_id)) {
    return failed(prev, values, 'Please fix the highlighted fields.', { project_id: 'You are not assigned to this project. Ask the project manager to add you to the team.' })
  }
  const others = ((sameDay ?? []) as { id: string; start_time: string; end_time: string }[]).filter((e) => e.id !== id)
  const { errors, breakMin } = validateTimeEntry(input, others)
  if (hasErrors(errors)) return failed(prev, values, 'Please fix the highlighted fields.', errors)

  const row = {
    project_id: input.project_id,
    task: input.task,
    description: input.description,
    start_time: input.start_time,
    end_time: input.end_time,
    break_min: breakMin,
  }

  if (id) {
    const { data, error } = await supabase.from('time_entries').update(row).eq('id', id).eq('user_id', profile.id).select('id')
    if (error) return failed(prev, values, friendly(error.message))
    if (!data?.length) return failed(prev, values, 'This entry can no longer be edited.')
  } else {
    const { error } = await supabase.from('time_entries').insert({ ...row, user_id: profile.id, work_date: workDate })
    if (error) return failed(prev, values, friendly(error.message))
  }
  revalidatePath('/', 'layout')
  back(pathFor(workDate, today), 'ok', id ? 'Entry updated.' : 'Entry added.')
}

export async function deleteEntry(formData: FormData) {
  const { supabase, profile, today } = await requireContext()
  const id = field(formData, 'id')
  const { data: existing } = await supabase.from('time_entries').select('work_date').eq('id', id).eq('user_id', profile.id).maybeSingle()
  const date = (existing as { work_date: string } | null)?.work_date ?? today
  const path = pathFor(date, today)
  const { data, error } = await supabase.from('time_entries').delete().eq('id', id).eq('user_id', profile.id).select('id')
  if (error) back(path, 'error', error.message)
  if (!data?.length) back(path, 'error', 'This entry can no longer be deleted.')
  revalidatePath('/', 'layout')
  back(path, 'ok', 'Entry deleted.')
}

/**
 * Submit today's timesheet (or resubmit a day the manager sent back).
 * The submission time is set by the database, never by the browser.
 */
export async function submitDay(formData: FormData) {
  const { supabase, today } = await requireContext()
  const date = field(formData, 'date')
  if (date && !isIsoDate(date)) back('/timesheet', 'error', 'Invalid date.')
  const path = pathFor(date, today)
  const { data, error } = await supabase.rpc('submit_timesheet_day', { p_date: date && date !== today ? date : null })
  if (error) back(path, 'error', error.message)
  revalidatePath('/', 'layout')
  back(path, 'ok', `Timesheet submitted (${data} entr${data === 1 ? 'y' : 'ies'}). Your approver has been notified. You can still edit it for 30 minutes.`)
}
