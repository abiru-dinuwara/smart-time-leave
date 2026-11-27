'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { UUID_RE } from '@/lib/approval-records'
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
  if (start && deadline && deadline < start) back('/projects', 'error', 'The deadline cannot be before the start date.')
  if (!Number.isFinite(planned) || planned < 0 || !Number.isFinite(prior) || prior < 0) back('/projects', 'error', 'Hours must be zero or more.')

  // Project managers own their own projects; administrators may pick the owner.
  const pmChoice = text(formData, 'pm_id')
  const pm_id = profile.role === 'admin' ? (UUID_RE.test(pmChoice) ? pmChoice : null) : profile.id

  const { data, error } = await supabase
    .from('projects')
    .insert({
      code,
      name: name.slice(0, 120),
      description: text(formData, 'description').slice(0, 1000),
      pm_id,
      start_date: start || null,
      deadline: deadline || null,
      planned_hours: planned,
      prior_hours: prior,
    })
    .select('id')
    .single()
  if (error) back('/projects', 'error', error.message)
  revalidatePath('/', 'layout')
  back(`/projects/${(data as { id: string }).id}`, 'ok', `Project ${code} created. Now assign the team members who will log time on it.`)
}

export async function setProjectStatus(formData: FormData) {
  const { supabase } = await requireRole('pm', 'admin')
  const id = text(formData, 'id')
  const ret = text(formData, 'return') === 'detail' ? `/projects/${id}` : '/projects'
  if (!UUID_RE.test(id)) back('/projects', 'error', 'Invalid project.')
  const status = text(formData, 'status') === 'archived' ? 'archived' : 'active'
  const { data, error } = await supabase.from('projects').update({ status }).eq('id', id).select('id')
  if (error) back(ret, 'error', error.message)
  if (!data?.length) back(ret, 'error', 'Only the project manager or an administrator can change this project.')
  revalidatePath('/', 'layout')
  back(ret, 'ok', status === 'archived' ? 'Project archived. It no longer appears in timesheets; past hours are kept.' : 'Project reactivated.')
}

/**
 * Assign / unassign a team member. Permission (own project for PMs; any project for
 * HR and administrators), duplicates, inactive people and archived projects are all
 * checked by the database functions — the browser's values are never trusted.
 */
export async function assignMember(formData: FormData) {
  const { supabase } = await requireRole('pm', 'hr', 'admin')
  const project = text(formData, 'project')
  const employee = text(formData, 'employee')
  const ret = `/projects/${project}${text(formData, 'qs')}`
  if (!UUID_RE.test(project) || !UUID_RE.test(employee)) back('/projects', 'error', 'Invalid request.')
  const { error } = await supabase.rpc('assign_project_member', { p_project: project, p_employee: employee })
  if (error) back(ret, 'error', error.message)
  revalidatePath('/', 'layout')
  back(ret, 'ok', `${text(formData, 'name') || 'Employee'} was added to the project team and notified.`)
}

export async function unassignMember(formData: FormData) {
  const { supabase } = await requireRole('pm', 'hr', 'admin')
  const project = text(formData, 'project')
  const employee = text(formData, 'employee')
  const ret = `/projects/${project}`
  if (!UUID_RE.test(project) || !UUID_RE.test(employee)) back('/projects', 'error', 'Invalid request.')
  const { error } = await supabase.rpc('unassign_project_member', { p_project: project, p_employee: employee })
  if (error) back(ret, 'error', error.message)
  revalidatePath('/', 'layout')
  back(ret, 'ok', `${text(formData, 'name') || 'Employee'} was removed from the team. Their past time entries are unchanged.`)
}
