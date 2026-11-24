import { requireContext } from '@/lib/auth'
import { navFor } from '@/lib/nav'
import { ROLE_LABEL } from '@/lib/types'
import AppShell from '@/components/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile, org, reports, isApprover } = await requireContext()

  const role = profile.role
  const showApprovals = isApprover

  const [notif, leave, weeks] = await Promise.all([
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false),
    showApprovals
      ? supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').neq('user_id', profile.id)
      : Promise.resolve({ count: 0 }),
    showApprovals
      ? supabase.from('time_entries').select('user_id, week_start').eq('status', 'submitted').neq('user_id', profile.id)
      : Promise.resolve({ data: [] as { user_id: string; week_start: string }[] }),
  ])
  const pendingWeeks = new Set(((weeks.data ?? []) as { user_id: string; week_start: string }[]).map((w) => `${w.user_id}|${w.week_start}`)).size

  return (
    <AppShell
      nav={navFor(role, profile.tracks_time, reports > 0)}
      counts={{ approvals: (leave.count ?? 0) + pendingWeeks, notifications: notif.count ?? 0 }}
      orgName={org.org_name}
      userName={profile.full_name}
      roleLabel={ROLE_LABEL[role]}
    >
      {children}
    </AppShell>
  )
}
