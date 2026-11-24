'use server'

import { revalidatePath } from 'next/cache'
import { requireContext } from '@/lib/auth'
import { back } from '@/lib/flash'
import { isIsoDate, mondayOf } from '@/lib/dates'

const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const TIME = /^\d{2}:\d{2}$/

export async function saveEntry(formData: FormData) {
  const { supabase, profile, today } = await requireContext()
  const id = text(formData, 'id')
  const work_date = text(formData, 'work_date')
  const weekPath = `/timesheet?week=${isIsoDate(work_date) ? mondayOf(work_date) : mondayOf(today)}`

  const row = {
    work_date,
    project_id: text(formData, 'project_id'),
    task: text(formData, 'task').slice(0, 200),
    description: text(formData, 'description').slice(0, 1000),
    start_time: text(formData, 'start_time'),
    end_time: text(formData, 'end_time'),
    break_min: Math.max(0, parseInt(text(formData, 'break_min') || '0', 10) || 0),
  }

  if (!isIsoDate(row.work_date)) back(weekPath, 'error', 'Choose a valid date.')
  if (!row.project_id) back(weekPath, 'error', 'Choose a project.')
  if (!TIME.test(row.start_time) || !TIME.test(row.end_time)) back(weekPath, 'error', 'Enter a start and an end time.')
  if (row.end_time <= row.start_time) back(weekPath, 'error', 'The end time must be after the start time.')

  if (id) {
    const { data, error } = await supabase.from('time_entries').update(row).eq('id', id).select('id')
    if (error) back(weekPath, 'error', error.message)
    if (!data?.length) back(weekPath, 'error', 'This entry can no longer be edited.')
  } else {
    const { error } = await supabase.from('time_entries').insert({ ...row, user_id: profile.id, status: 'draft' })
    if (error) back(weekPath, 'error', error.message)
  }
  revalidatePath('/', 'layout')
  back(weekPath, 'ok', 'Entry saved.')
}

export async function deleteEntry(formData: FormData) {
  const { supabase } = await requireContext()
  const id = text(formData, 'id')
  const week = text(formData, 'week')
  const path = `/timesheet?week=${isIsoDate(week) ? week : ''}`
  const { data, error } = await supabase.from('time_entries').delete().eq('id', id).select('id')
  if (error) back(path, 'error', error.message)
  if (!data?.length) back(path, 'error', 'This entry can no longer be deleted.')
  revalidatePath('/', 'layout')
  back(path, 'ok', 'Entry deleted.')
}

export async function submitWeek(formData: FormData) {
  const { supabase } = await requireContext()
  const week = text(formData, 'week')
  if (!isIsoDate(week)) back('/timesheet', 'error', 'Invalid week.')
  const path = `/timesheet?week=${week}`
  const { data, error } = await supabase.rpc('submit_week', { p_week: week })
  if (error) back(path, 'error', error.message)
  revalidatePath('/', 'layout')
  back(path, 'ok', `Timesheet submitted (${data} entr${data === 1 ? 'y' : 'ies'}). Your manager has been notified.`)
}
