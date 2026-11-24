'use server'

import { revalidatePath } from 'next/cache'
import { requireContext } from '@/lib/auth'
import { back } from '@/lib/flash'

export async function markAllRead() {
  const { supabase } = await requireContext()
  const { error } = await supabase.from('notifications').update({ read: true }).eq('read', false)
  if (error) back('/notifications', 'error', error.message)
  revalidatePath('/', 'layout')
  back('/notifications', 'ok', 'All notifications marked as read.')
}

export async function markRead(formData: FormData) {
  const { supabase } = await requireContext()
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', String(formData.get('id') ?? ''))
  if (error) back('/notifications', 'error', error.message)
  revalidatePath('/', 'layout')
  back('/notifications', 'ok', 'Marked as read.')
}
