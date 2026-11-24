'use server'

import { revalidatePath } from 'next/cache'
import { requireApprover } from '@/lib/auth'
import { back } from '@/lib/flash'
import { isIsoDate } from '@/lib/dates'

const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const DECISIONS = ['approved', 'rejected', 'changes']

/** Only the employee's line manager may decide leave; the database rejects anyone else (incl. HR). */
export async function decideLeave(formData: FormData) {
  const { supabase } = await requireApprover()
  const decision = text(formData, 'decision')
  if (!DECISIONS.includes(decision)) back('/approvals', 'error', 'Invalid decision.')
  const { error } = await supabase.rpc('decide_leave', { p_id: text(formData, 'id'), p_decision: decision, p_note: text(formData, 'note') })
  if (error) back('/approvals', 'error', error.message)
  revalidatePath('/', 'layout')
  back('/approvals', 'ok', 'Decision saved. The employee has been notified.')
}

/** Review one employee's daily timesheet (line manager, or HR — unchanged for timesheets). */
export async function decideTimesheet(formData: FormData) {
  const { supabase } = await requireApprover()
  const decision = text(formData, 'decision')
  const date = text(formData, 'date')
  const path = '/approvals?tab=timesheets'
  if (!DECISIONS.includes(decision) || !isIsoDate(date)) back(path, 'error', 'Invalid request.')
  const { error } = await supabase.rpc('decide_timesheet_day', {
    p_user: text(formData, 'user'),
    p_date: date,
    p_decision: decision,
    p_note: text(formData, 'note'),
  })
  if (error) back(path, 'error', error.message)
  revalidatePath('/', 'layout')
  back(path, 'ok', 'Decision saved. The employee has been notified.')
}
