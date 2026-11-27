export type AppRole = 'employee' | 'manager' | 'pm' | 'hr' | 'leadership' | 'admin'
export type LeaveType = 'annual' | 'sick' | 'casual' | 'unpaid' | 'compassionate'
export type LeaveStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'changes' | 'cancelled'
export type EntryStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'changes'
/** Who receives a request: the requester's line manager, or HR (migration 0005). */
export type ApprovalRoute = 'manager' | 'hr'
/** Status as shown in approval lists (timesheet "submitted" is shown as "pending"). */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'changes' | 'cancelled'
export type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'red'

export interface Profile {
  id: string
  email: string
  full_name: string
  emp_no: string | null
  department: string | null
  team: string | null
  position: string | null
  manager_id: string | null
  role: AppRole
  tracks_time: boolean
  active: boolean
}

export interface OrgSettings {
  org_name: string
  hours_per_day: number
  timezone: string
  allowed_email_domain: string | null
}

export interface Project {
  id: string
  code: string
  name: string
  description: string
  pm_id: string | null
  start_date: string | null
  deadline: string | null
  planned_hours: number
  prior_hours: number
  status: 'active' | 'archived'
}

export interface TimeEntry {
  id: string
  user_id: string
  work_date: string
  week_start: string
  project_id: string
  task: string
  description: string
  start_time: string
  end_time: string
  break_min: number
  status: EntryStatus
  review_note: string | null
  submitted_at: string | null
}

/** One daily submission per employee per date (table daily_timesheets, migration 0003). */
export interface DailyTimesheet {
  id: string
  user_id: string
  work_date: string
  status: EntryStatus
  /** First submission time, assigned by the database. Never changes. */
  submitted_at: string | null
  /** Latest (re)submission time. */
  last_submitted_at: string | null
  /** End of the employee's editing window (last_submitted_at + 30 minutes). */
  edit_until: string | null
  resubmissions: number
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  approval_route: ApprovalRoute | null
  created_at: string
}

/** Must match the interval in submit_timesheet_day() (migration 0003). */
export const TIMESHEET_EDIT_WINDOW_MIN = 30

export interface LeaveRequest {
  id: string
  user_id: string
  type: LeaveType
  start_date: string
  end_date: string
  half: 'none' | 'AM' | 'PM'
  days: number
  reason: string
  status: LeaveStatus
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  approval_route: ApprovalRoute | null
  submitted_at: string | null
  last_submitted_at: string | null
  created_at: string
}

export interface LeaveBalanceRow {
  type: LeaveType
  allocated: number | null
  used: number
  pending: number
  remaining: number | null
}

export const ROLE_LABEL: Record<AppRole, string> = {
  employee: 'Employee',
  manager: 'Manager',
  pm: 'Project Manager',
  hr: 'HR Administrator',
  leadership: 'Leadership',
  admin: 'System Administrator',
}

export const LEAVE_LABEL: Record<LeaveType, string> = {
  annual: 'Annual leave',
  sick: 'Sick leave',
  casual: 'Casual leave',
  unpaid: 'Unpaid leave',
  compassionate: 'Compassionate leave',
}

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, [string, Tone]> = {
  draft: ['Draft', 'gray'],
  pending: ['Pending approval', 'amber'],
  approved: ['Approved', 'green'],
  rejected: ['Rejected', 'red'],
  changes: ['Changes requested', 'blue'],
  cancelled: ['Cancelled', 'gray'],
}

export const ENTRY_STATUS_LABEL: Record<EntryStatus, [string, Tone]> = {
  draft: ['Draft', 'gray'],
  submitted: ['Pending approval', 'amber'],
  approved: ['Approved', 'green'],
  rejected: ['Rejected', 'red'],
  changes: ['Changes requested', 'blue'],
}

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, [string, Tone]> = {
  pending: ['Pending', 'amber'],
  approved: ['Approved', 'green'],
  rejected: ['Rejected', 'red'],
  changes: ['Changes requested', 'blue'],
  cancelled: ['Cancelled', 'gray'],
}

export const ROUTE_LABEL: Record<ApprovalRoute, string> = { manager: 'Line manager', hr: 'HR' }

/** Mirrors public._approval_route() in migration 0005. Display only — the database decides. */
export const routeForRole = (role: AppRole): ApprovalRoute => (role === 'manager' || role === 'pm' || role === 'leadership' ? 'hr' : 'manager')

/** One row of public.approval_records() (migration 0005). */
export interface ApprovalRecord {
  kind: 'leave' | 'timesheet'
  request_id: string
  owner_id: string
  owner_name: string
  owner_department: string | null
  owner_position: string | null
  owner_role: AppRole
  route: ApprovalRoute
  status: ApprovalStatus
  raw_status: string
  submitted_at: string | null
  last_submitted_at: string | null
  decided_at: string | null
  approver_id: string | null
  approver_name: string | null
  decision_note: string | null
  leave_type: LeaveType | null
  start_date: string | null
  end_date: string | null
  days: number | null
  half: 'none' | 'AM' | 'PM' | null
  reason: string | null
  work_date: string | null
  edit_until: string | null
  resubmissions: number
  total_minutes: number | null
  entry_count: number
  projects: string | null
  can_decide: boolean
  total_count: number
}

export interface ProjectMember {
  id: string
  project_id: string
  employee_id: string
  assigned_by: string | null
  assigned_at: string
  unassigned_by: string | null
  unassigned_at: string | null
  active: boolean
}
