import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { AppRole, OrgSettings, Profile } from '@/lib/types'
import { todayIn } from '@/lib/dates'

/**
 * Everything a page needs to know about the logged-in person.
 * Cached per request, so calling it in the layout AND the page costs one query.
 */
export const getContext = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const [profileRes, settingsRes, reportsRes, allRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('org_settings').select('*').maybeSingle(),
    supabase.from('profiles').select('id, active').eq('manager_id', user.id),
    supabase.from('profiles').select('id, manager_id, active, role'),
  ])
  const profile = profileRes.data as Profile | null
  if (!profile) return null

  const org: OrgSettings = (settingsRes.data as OrgSettings | null) ?? { org_name: 'My Company', hours_per_day: 8, timezone: 'UTC', allowed_email_domain: null }
  const reportRows = (reportsRes.data ?? []) as { id: string; active: boolean }[]
  /** Everyone whose line manager is this user (leave requests are approved ONLY by the line manager). */
  const reportIds = reportRows.map((r) => r.id)
  const reports = reportRows.filter((r) => r.active).length
  // Anyone with direct reports approves for them, whatever their role.
  // HR additionally reviews timesheets for anyone, but no longer approves leave.
  // People without an active line manager: their leave is decided by administrators.
  const everyone = (allRes.data ?? []) as { id: string; manager_id: string | null; active: boolean; role: string }[]
  const activeIds = new Set(everyone.filter((p) => p.active).map((p) => p.id))
  const noManagerIds = everyone.filter((p) => !p.manager_id || !activeIds.has(p.manager_id)).map((p) => p.id)
  /** Whose leave requests this user may decide. */
  const leaveApproveIds = profile.role === 'admin' ? [...new Set([...reportIds, ...noManagerIds.filter((id) => id !== user.id)])] : reportIds
  const isApprover = profile.role === 'hr' || profile.role === 'manager' || profile.role === 'admin' || reports > 0
  return { supabase, user, profile, org, reports, reportIds, leaveApproveIds, isApprover, today: todayIn(org.timezone) }
})

/** Use at the top of every page and server action that needs a logged-in user. */
export async function requireContext() {
  const ctx = await getContext()
  if (!ctx) redirect('/login')
  if (!ctx.profile.active) redirect('/auth/signout?reason=inactive')
  return ctx
}

/** Same, but only for some roles. Others are sent to the dashboard. */
export async function requireRole(...roles: AppRole[]) {
  const ctx = await requireContext()
  if (!roles.includes(ctx.profile.role)) redirect('/')
  return ctx
}

/** Managers, HR, and anyone who has people reporting to them. */
export async function requireApprover() {
  const ctx = await requireContext()
  if (!ctx.isApprover) redirect('/')
  return ctx
}
