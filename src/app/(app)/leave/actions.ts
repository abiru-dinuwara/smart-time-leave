'use server'

import { revalidatePath } from 'next/cache'
import { requireContext } from '@/lib/auth'
import { back, friendly } from '@/lib/flash'
import { field, hasErrors, readLeave, validateLeave, type FormState } from '@/lib/validation'

/**
 * Create / edit a leave request, either as a draft or submitted to the line manager.
 * "Today" comes from the company time zone on the server, never from the browser.
 * The database repeats every critical check (migration 0003).
 */
export async function saveLeave(prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, profile, today } = await requireContext()
  const id = field(formData, 'id')
  const intent = field(formData, 'intent') === 'draft' ? 'draft' : 'pending'
  const input = readLeave(formData)
  const values: Record<string, string> = { ...input }
  const fail = (message: string, errors: FormState['errors'] = {}): FormState => ({ errors, message, values, attempt: prev.attempt + 1 })

  const errors = validateLeave(input, { today, intent })
  if (hasErrors(errors)) return fail('Please fix the highlighted fields.', errors)

  const row = {
    type: input.type,
    start_date: input.start_date,
    end_date: input.end_date,
    half: input.half,
    reason: input.reason,
    status: intent,
  }

  if (id) {
    const { data, error } = await supabase.from('leave_requests').update(row).eq('id', id).eq('user_id', profile.id).select('id')
    if (error) return fail(friendly(error.message))
    if (!data?.length) return fail('This request can no longer be edited.')
  } else {
    const { error } = await supabase.from('leave_requests').insert({ ...row, user_id: profile.id })
    if (error) return fail(friendly(error.message))
  }
  revalidatePath('/', 'layout')
  back('/leave', 'ok', intent === 'draft' ? 'Draft saved.' : 'Leave request sent for approval.')
}

/** Cancel a draft, pending or changes-requested request. Approved leave cannot be cancelled (enforced in the database). */
export async function cancelLeave(formData: FormData) {
  const { supabase } = await requireContext()
  const { error } = await supabase.rpc('cancel_leave', { p_id: field(formData, 'id') })
  if (error) back('/leave', 'error', error.message)
  revalidatePath('/', 'layout')
  back('/leave', 'ok', 'Leave request cancelled.')
}

export async function deleteDraft(formData: FormData) {
  const { supabase } = await requireContext()
  const { data, error } = await supabase.from('leave_requests').delete().eq('id', field(formData, 'id')).select('id')
  if (error) back('/leave', 'error', error.message)
  if (!data?.length) back('/leave', 'error', 'Only drafts can be deleted.')
  revalidatePath('/', 'layout')
  back('/leave', 'ok', 'Draft deleted.')
}
