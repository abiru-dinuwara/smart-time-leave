'use server'

import { revalidatePath } from 'next/cache'
import { requireApprover } from '@/lib/auth'
import { back } from '@/lib/flash'
import { isIsoDate } from '@/lib/dates'

const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const DECISIONS = ['approved', 'rejected', 'changes']

export async function decideLeave(formData: FormData) {
  const { supabase } = await requireApprover()
  const decision = text(formData, 'decision')
  if (!DECISIONS.includes(decision)) back('/approvals', 'error', 'Invalid decision.')
  const { error } = await supabase.rpc('decide_leave', { p_id: text(formData, 'id'), p_decision: decision, p_note: text(formData, 'note') })
  if (error) back('/approvals', 'error', error.message)
  revalidatePath('/', 'layout')
  back('/approvals', 'ok', 'Decision saved. The employee has been notified.')
}

export async function decideTimesheet(formData: FormData) {
  const { supabase } = await requireApprover()
  const decision = text(formData, 'decision')
  const week = text(formData, 'week')
  const path = '/approvals?tab=timesheets'
  if (!DECISIONS.includes(decision) || !isIsoDate(week)) back(path, 'error', 'Invalid request.')
  const { error } = await supabase.rpc('decide_timesheet_week', {
    p_user: text(formData, 'user'),
    p_week: week,
    p_decision: decision,
    p_note: text(formData, 'note'),
  })
  if (error) back(path, 'error', error.message)
  revalidatePath('/', 'layout')
  back(path, 'ok', 'Decision saved. The employee has been notified.')
}
