import type { AppContext } from '@/lib/auth'
import { routeForRole, type ApprovalRoute } from '@/lib/types'

export interface ApproverInfo {
  route: ApprovalRoute
  /** Line manager's name (manager route only). */
  managerName: string | null
  /** True when nobody could approve: submission is blocked (the database refuses it too). */
  blocked: boolean
  /** One sentence for forms: where the request goes. */
  sentence: string
}

/**
 * Who will receive this user's timesheets and leave requests. For display only;
 * public._approval_route() in the database is the authority.
 */
export async function approverInfo(ctx: Pick<AppContext, 'supabase' | 'profile'>): Promise<ApproverInfo> {
  const route = routeForRole(ctx.profile.role)
  if (route === 'hr') {
    return { route, managerName: null, blocked: false, sentence: 'Your requests are approved by HR.' }
  }
  if (!ctx.profile.manager_id) {
    return {
      route,
      managerName: null,
      blocked: true,
      sentence: 'You do not have a line manager yet, so requests cannot be submitted. Ask HR or an administrator to assign one on the People page.',
    }
  }
  const { data } = await ctx.supabase.from('profiles').select('full_name, active').eq('id', ctx.profile.manager_id).maybeSingle()
  const m = data as { full_name: string; active: boolean } | null
  if (!m?.active) {
    return {
      route,
      managerName: null,
      blocked: true,
      sentence: 'Your line manager’s account is inactive, so requests cannot be submitted. Ask HR or an administrator to assign a new line manager.',
    }
  }
  return { route, managerName: m.full_name, blocked: false, sentence: `Your requests are approved by your line manager, ${m.full_name}.` }
}
