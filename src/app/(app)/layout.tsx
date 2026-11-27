import { getApprovalCounts, requireContext } from '@/lib/auth'
import { navFor } from '@/lib/nav'
import { ROLE_LABEL } from '@/lib/types'
import AppShell from '@/components/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile, org, reports } = await requireContext()

  // Two small queries for the badges: unread notifications, and what I can decide right now
  // (approval_counts applies the same routing rules as the approve functions).
  const [notif, c] = await Promise.all([
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false),
    getApprovalCounts(),
  ])

  return (
    <AppShell
      nav={navFor(profile.role, profile.tracks_time, reports > 0)}
      counts={{ approvals: c.leave + c.timesheets, notifications: notif.count ?? 0 }}
      orgName={org.org_name}
      userName={profile.full_name}
      userEmail={profile.email}
      roleLabel={ROLE_LABEL[profile.role]}
    >
      {children}
    </AppShell>
  )
}
