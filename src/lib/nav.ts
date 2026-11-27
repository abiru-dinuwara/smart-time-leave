import type { AppRole } from '@/lib/types'

export interface NavItem {
  href: string
  label: string
  icon: string
  badge?: 'approvals' | 'notifications'
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/** Menu for each role, grouped. Everyone gets their own timesheet (if they track time), leave and history. */
export function navFor(role: AppRole, tracksTime: boolean, hasReports: boolean): NavGroup[] {
  const mine: NavItem[] = [{ href: '/', label: 'Dashboard', icon: 'dashboard' }]
  if (tracksTime) mine.push({ href: '/timesheet', label: 'My Timesheet', icon: 'clock' })
  mine.push({ href: '/leave', label: 'My Leave', icon: 'leave' })
  mine.push({ href: '/notifications', label: 'Notifications', icon: 'bell', badge: 'notifications' })

  const team: NavItem[] = []
  const approver = role === 'manager' || role === 'hr' || role === 'admin' || hasReports
  if (approver) {
    team.push({ href: '/approvals', label: 'Approvals', icon: 'check', badge: 'approvals' })
    team.push({ href: '/approvals/history', label: 'Approval History', icon: 'history' })
  }
  if (role === 'hr' || role === 'leadership') team.push({ href: '/team', label: 'Employee Overview', icon: 'users' })
  else if (role === 'manager' || hasReports) team.push({ href: '/team', label: 'Team Availability', icon: 'users' })
  if (role === 'pm' || role === 'hr' || role === 'leadership' || role === 'admin') team.push({ href: '/projects', label: 'Projects', icon: 'folder' })

  const admin: NavItem[] = []
  if (role === 'hr' || role === 'admin') admin.push({ href: '/people', label: 'People', icon: 'idcard' })
  if (role === 'hr' || role === 'admin') admin.push({ href: '/settings', label: 'Policies & Holidays', icon: 'settings' })
  if (role === 'admin') admin.push({ href: '/audit', label: 'Audit Log', icon: 'shield' })

  return [
    { label: 'My work', items: mine },
    ...(team.length ? [{ label: role === 'hr' || role === 'leadership' || role === 'admin' ? 'Organisation' : 'Team', items: team }] : []),
    ...(admin.length ? [{ label: 'Administration', items: admin }] : []),
  ]
}
