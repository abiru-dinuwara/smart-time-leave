import type { AppRole } from '@/lib/types'

export interface NavItem {
  href: string
  label: string
  icon: string
  badge?: 'approvals' | 'notifications'
}

/** Menu for each role. Everyone who tracks time gets My Timesheet and My Leave. */
export function navFor(role: AppRole, tracksTime: boolean, hasReports: boolean): NavItem[] {
  const items: NavItem[] = [{ href: '/', label: 'Dashboard', icon: 'dashboard' }]
  if (tracksTime) items.push({ href: '/timesheet', label: 'My Timesheet', icon: 'clock' })
  items.push({ href: '/leave', label: 'My Leave', icon: 'leave' })

  if (role === 'manager' || role === 'hr' || role === 'admin' || hasReports) items.push({ href: '/approvals', label: 'Approvals', icon: 'check', badge: 'approvals' })
  if (role === 'hr' || role === 'leadership') items.push({ href: '/team', label: 'Employee Overview', icon: 'users' })
  else if (role === 'manager' || hasReports) items.push({ href: '/team', label: 'Team Availability', icon: 'users' })
  if (role === 'pm' || role === 'hr' || role === 'leadership' || role === 'admin') items.push({ href: '/projects', label: 'Projects', icon: 'folder' })
  if (role === 'hr' || role === 'admin') items.push({ href: '/people', label: 'People', icon: 'users' })
  if (role === 'hr' || role === 'admin') items.push({ href: '/settings', label: 'Policies & Holidays', icon: 'settings' })
  if (role === 'admin') items.push({ href: '/audit', label: 'Audit Log', icon: 'shield' })
  items.push({ href: '/notifications', label: 'Notifications', icon: 'bell', badge: 'notifications' })
  return items
}
