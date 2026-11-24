import { requireContext } from '@/lib/auth'
import { navFor } from '@/lib/nav'
import { ROLE_LABEL } from '@/lib/types'
import AppShell from '@/components/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile, org, reports, reportIds, isApprover } = await requireContext()

  const role = profile.role
  const showApprovals = isApprover

  const [notif, leave, days] = await Promise.all([
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false),
    // leave is approved only by the line manager -> count my direct reports' pending requests
    showApprovals && reportIds.length
      ? supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').in('user_id', reportIds)
      : Promise.resolve({ count: 0 }),
    showApprovals
      ? supabase.from('daily_timesheets').select('id', { count: 'exact', head: true }).eq('status', 'submitted').neq('user_id', profile.id)
      : Promise.resolve({ count: 0 }),
  ])

  return (
    <AppShell
      nav={navFor(role, profile.tracks_time, reports > 0)}
      counts={{ approvals: (leave.count ?? 0) + (days.count ?? 0), notifications: notif.count ?? 0 }}
      orgName={org.org_name}
      userName={profile.full_name}
      roleLabel={ROLE_LABEL[role]}
    >
      {children}
    </AppShell>
  )
}
