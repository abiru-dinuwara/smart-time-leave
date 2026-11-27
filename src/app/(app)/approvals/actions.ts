'use server'

import { revalidatePath } from 'next/cache'
import { requireApprover } from '@/lib/auth'
import { UUID_RE } from '@/lib/approval-records'
import { back } from '@/lib/flash'
import { isIsoDate } from '@/lib/dates'

const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const DECISIONS = ['approved', 'rejected', 'changes'] as const
const LABEL: Record<(typeof DECISIONS)[number], string> = { approved: 'approved', rejected: 'rejected', changes: 'sent back for changes' }

/**
 * Approve / reject / request changes on a leave request.
 * WHO may decide is checked by public.decide_leave() using the requester's role
 * from the database: line manager for employees, HR for managers, PMs and
 * leadership. Nobody can decide their own request.
 */
export async function decideLeave(formData: FormData) {
  const { supabase } = await requireApprover()
  const path = '/approvals'
  const id = text(formData, 'id')
  const decision = text(formData, 'decision') as (typeof DECISIONS)[number]
  if (!DECISIONS.includes(decision) || !UUID_RE.test(id)) back(path, 'error', 'Invalid request.')
  const note = text(formData, 'note').slice(0, 500)
  if (decision !== 'approved' && !note) back(path, 'error', 'Please add a comment so the requester knows why.')
  const { error } = await supabase.rpc('decide_leave', { p_id: id, p_decision: decision, p_note: note })
  if (error) back(path, 'error', error.message)
  revalidatePath('/', 'layout')
  back(path, 'ok', `Leave request ${LABEL[decision]}. The requester has been notified.`)
}

/** Review one daily timesheet. Same routing rules as leave (public.decide_timesheet_day). */
export async function decideTimesheet(formData: FormData) {
  const { supabase } = await requireApprover()
  const path = '/approvals?tab=timesheets'
  const decision = text(formData, 'decision') as (typeof DECISIONS)[number]
  const user = text(formData, 'user')
  const date = text(formData, 'date')
  if (!DECISIONS.includes(decision) || !isIsoDate(date) || !UUID_RE.test(user)) back(path, 'error', 'Invalid request.')
  const note = text(formData, 'note').slice(0, 500)
  if (decision !== 'approved' && !note) back(path, 'error', 'Please add a comment so the requester knows what to fix.')
  const { error } = await supabase.rpc('decide_timesheet_day', { p_user: user, p_date: date, p_decision: decision, p_note: note })
  if (error) back(path, 'error', error.message)
  revalidatePath('/', 'layout')
  back(path, 'ok', `Timesheet ${LABEL[decision]}. The requester has been notified.`)
}
