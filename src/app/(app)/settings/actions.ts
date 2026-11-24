'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { back } from '@/lib/flash'
import { isIsoDate } from '@/lib/dates'
import { LEAVE_LABEL, type LeaveType } from '@/lib/types'

const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

export async function savePolicies(formData: FormData) {
  const { supabase } = await requireRole('admin', 'hr')
  for (const type of Object.keys(LEAVE_LABEL) as LeaveType[]) {
    const raw = text(formData, `days_${type}`)
    const days = raw === '' ? null : Number(raw)
    if (days !== null && (!Number.isFinite(days) || days < 0 || days > 365)) back('/settings', 'error', `Enter a number of days for ${LEAVE_LABEL[type]}.`)
    const { error } = await supabase.from('leave_policies').update({ days_per_year: days, note: text(formData, `note_${type}`).slice(0, 300) }).eq('type', type)
    if (error) back('/settings', 'error', error.message)
  }
  revalidatePath('/', 'layout')
  back('/settings', 'ok', 'Leave policies saved.')
}

export async function addHoliday(formData: FormData) {
  const { supabase } = await requireRole('admin', 'hr')
  const date = text(formData, 'holiday_date')
  const name = text(formData, 'name')
  if (!isIsoDate(date) || !name) back('/settings', 'error', 'Enter a date and a name.')
  const { error } = await supabase.from('holidays').insert({ holiday_date: date, name: name.slice(0, 120) })
  if (error) back('/settings', 'error', error.message)
  revalidatePath('/', 'layout')
  back('/settings', 'ok', 'Holiday added.')
}

export async function deleteHoliday(formData: FormData) {
  const { supabase } = await requireRole('admin', 'hr')
  const { error } = await supabase.from('holidays').delete().eq('id', text(formData, 'id'))
  if (error) back('/settings', 'error', error.message)
  revalidatePath('/', 'layout')
  back('/settings', 'ok', 'Holiday removed.')
}

export async function saveOrg(formData: FormData) {
  const { supabase } = await requireRole('admin')
  const tz = text(formData, 'timezone')
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
  } catch {
    back('/settings', 'error', 'That time zone is not valid. Example: Asia/Colombo')
  }
  const hours = Number(text(formData, 'hours_per_day'))
  if (!Number.isFinite(hours) || hours < 1 || hours > 24) back('/settings', 'error', 'Hours per day must be between 1 and 24.')
  const domain = text(formData, 'allowed_email_domain').replace(/^@/, '').toLowerCase()
  const { error } = await supabase
    .from('org_settings')
    .update({ org_name: text(formData, 'org_name') || 'My Company', hours_per_day: hours, timezone: tz, allowed_email_domain: domain || null })
    .eq('id', true)
  if (error) back('/settings', 'error', error.message)
  revalidatePath('/', 'layout')
  back('/settings', 'ok', 'Organisation settings saved.')
}
