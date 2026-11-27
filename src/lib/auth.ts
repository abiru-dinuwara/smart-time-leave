import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { AppRole, OrgSettings, Profile } from '@/lib/types'
import { todayIn } from '@/lib/dates'

const PROFILE_COLS = 'id, email, full_name, emp_no, department, team, position, manager_id, role, tracks_time, active'
const DEFAULT_ORG: OrgSettings = { org_name: 'My Company', hours_per_day: 8, timezone: 'UTC', allowed_email_domain: null }

/**
 * Everything a page needs to know about the logged-in person.
 * Cached per request (React cache), so the layout and the page share one set of queries.
 * Nothing here is cached across requests or users.
 */
export const getContext = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const [profileRes, settingsRes, reportsRes] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLS).eq('id', user.id).maybeSingle(),
    supabase.from('org_settings').select('org_name, hours_per_day, timezone, allowed_email_domain').maybeSingle(),
    // head-only count: no rows are transferred
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('manager_id', user.id).eq('active', true),
  ])
  const profile = profileRes.data as Profile | null
  if (!profile) return null

  const org = (settingsRes.data as OrgSettings | null) ?? DEFAULT_ORG
  /** Active people whose line manager is this user. */
  const reports = reportsRes.count ?? 0
  const role = profile.role
  /**
   * Sees the Approvals area: line managers (anyone with direct reports), HR (requests
   * from managers, project managers and leadership), and administrators (legacy
   * requests from people without an active line manager). The database decides
   * what each person may actually approve.
   */
  const isApprover = reports > 0 || role === 'manager' || role === 'hr' || role === 'admin'
  return { supabase, user, profile, org, reports, isApprover, today: todayIn(org.timezone) }
})

export type AppContext = NonNullable<Awaited<ReturnType<typeof getContext>>>

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

/** Line managers, HR and administrators. */
export async function requireApprover() {
  const ctx = await requireContext()
  if (!ctx.isApprover) redirect('/')
  return ctx
}

/**
 * What the logged-in user can decide right now (leave + timesheets), using the same
 * routing rules as the approve functions. Cached per request: the layout badge and
 * the dashboard share one database call.
 */
export const getApprovalCounts = cache(async () => {
  const ctx = await getContext()
  if (!ctx || !ctx.isApprover) return { leave: 0, timesheets: 0 }
  const { data } = await ctx.supabase.rpc('approval_counts').maybeSingle()
  const c = data as { leave_pending: number; timesheet_pending: number } | null
  return { leave: c?.leave_pending ?? 0, timesheets: c?.timesheet_pending ?? 0 }
})
