'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { back } from '@/lib/flash'
import { isIsoDate } from '@/lib/dates'

const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const num = (v: string) => (v === '' ? 0 : Number(v))

export async function createProject(formData: FormData) {
  const { supabase, profile } = await requireRole('pm', 'admin')
  const code = text(formData, 'code').toUpperCase()
  const name = text(formData, 'name')
  const start = text(formData, 'start_date')
  const deadline = text(formData, 'deadline')
  const planned = num(text(formData, 'planned_hours'))
  const prior = num(text(formData, 'prior_hours'))

  if (!/^[A-Z0-9_-]{2,10}$/.test(code)) back('/projects', 'error', 'The code must be 2–10 letters or numbers, e.g. WEB.')
  if (!name) back('/projects', 'error', 'Enter a project name.')
  if ((start && !isIsoDate(start)) || (deadline && !isIsoDate(deadline))) back('/projects', 'error', 'Check the dates.')
  if (!Number.isFinite(planned) || planned < 0 || !Number.isFinite(prior) || prior < 0) back('/projects', 'error', 'Hours must be zero or more.')

  // Project managers own their own projects; administrators may pick the owner.
  const pm_id = profile.role === 'admin' ? text(formData, 'pm_id') || null : profile.id

  const { error } = await supabase.from('projects').insert({
    code,
    name: name.slice(0, 120),
    description: text(formData, 'description').slice(0, 1000),
    pm_id,
    start_date: start || null,
    deadline: deadline || null,
    planned_hours: planned,
    prior_hours: prior,
  })
  if (error) back('/projects', 'error', error.message)
  revalidatePath('/', 'layout')
  back('/projects', 'ok', `Project ${code} created.`)
}

export async function setProjectStatus(formData: FormData) {
  const { supabase } = await requireRole('pm', 'admin')
  const status = text(formData, 'status') === 'archived' ? 'archived' : 'active'
  const { data, error } = await supabase.from('projects').update({ status }).eq('id', text(formData, 'id')).select('id')
  if (error) back('/projects', 'error', error.message)
  if (!data?.length) back('/projects', 'error', 'Only the project manager or an administrator can change this project.')
  revalidatePath('/', 'layout')
  back('/projects', 'ok', status === 'archived' ? 'Project archived. It no longer appears in timesheets.' : 'Project reactivated.')
}
