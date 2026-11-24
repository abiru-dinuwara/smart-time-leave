'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { back } from '@/lib/flash'
import type { AppRole } from '@/lib/types'

const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const ROLES: AppRole[] = ['employee', 'manager', 'pm', 'hr', 'leadership', 'admin']

export async function updatePerson(formData: FormData) {
  const { supabase, profile } = await requireRole('admin', 'hr')
  const id = text(formData, 'id')
  const patch: Record<string, unknown> = {
    full_name: text(formData, 'full_name'),
    emp_no: text(formData, 'emp_no') || null,
    department: text(formData, 'department') || null,
    team: text(formData, 'team') || null,
    position: text(formData, 'position') || null,
    manager_id: text(formData, 'manager_id') || null,
    tracks_time: formData.get('tracks_time') === 'on',
    active: formData.get('active') === 'on',
  }
  if (!patch.full_name) back('/people', 'error', 'A name is required.')
  if (patch.manager_id === id) back('/people', 'error', 'Nobody can be their own manager.')

  // Only administrators send a role; the database enforces this too.
  if (profile.role === 'admin') {
    const role = text(formData, 'role') as AppRole
    if (!ROLES.includes(role)) back('/people', 'error', 'Invalid role.')
    patch.role = role
  }

  const { data, error } = await supabase.from('profiles').update(patch).eq('id', id).select('id')
  if (error) back('/people', 'error', error.message)
  if (!data?.length) back('/people', 'error', 'Nothing was changed.')
  revalidatePath('/', 'layout')
  back('/people', 'ok', 'Person updated.')
}
