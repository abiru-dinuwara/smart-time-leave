'use server'

import { revalidatePath } from 'next/cache'
import { requireContext } from '@/lib/auth'
import { back } from '@/lib/flash'
import { isIsoDate } from '@/lib/dates'
import { LEAVE_LABEL, type LeaveType } from '@/lib/types'

const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

export async function saveLeave(formData: FormData) {
  const { supabase, profile } = await requireContext()
  const id = text(formData, 'id')
  const intent = text(formData, 'intent') === 'draft' ? 'draft' : 'pending'
  const type = text(formData, 'type') as LeaveType
  const start_date = text(formData, 'start_date')
  const end_date = text(formData, 'end_date') || start_date
  const half = ['AM', 'PM'].includes(text(formData, 'half')) ? text(formData, 'half') : 'none'

  if (!(type in LEAVE_LABEL)) back('/leave', 'error', 'Choose a leave type.')
  if (!isIsoDate(start_date) || !isIsoDate(end_date)) back('/leave', 'error', 'Choose a start and end date.')
  if (end_date < start_date) back('/leave', 'error', 'The end date is before the start date.')

  const row = { type, start_date, end_date, half, reason: text(formData, 'reason').slice(0, 1000), status: intent }

  if (id) {
    const { data, error } = await supabase.from('leave_requests').update(row).eq('id', id).select('id')
    if (error) back('/leave', 'error', error.message)
    if (!data?.length) back('/leave', 'error', 'This request can no longer be edited.')
  } else {
    const { error } = await supabase.from('leave_requests').insert({ ...row, user_id: profile.id })
    if (error) back('/leave', 'error', error.message)
  }
  revalidatePath('/', 'layout')
  back('/leave', 'ok', intent === 'draft' ? 'Draft saved.' : 'Leave request sent for approval.')
}

export async function cancelLeave(formData: FormData) {
  const { supabase } = await requireContext()
  const { error } = await supabase.rpc('cancel_leave', { p_id: text(formData, 'id') })
  if (error) back('/leave', 'error', error.message)
  revalidatePath('/', 'layout')
  back('/leave', 'ok', 'Leave request cancelled.')
}

export async function deleteDraft(formData: FormData) {
  const { supabase } = await requireContext()
  const { data, error } = await supabase.from('leave_requests').delete().eq('id', text(formData, 'id')).select('id')
  if (error) back('/leave', 'error', error.message)
  if (!data?.length) back('/leave', 'error', 'Only drafts can be deleted.')
  revalidatePath('/', 'layout')
  back('/leave', 'ok', 'Draft deleted.')
}
