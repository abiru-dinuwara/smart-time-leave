// Server-side helpers for the approval queue and approval history.
// Scope (who can see which requests) is enforced by public.approval_records()
// in the database (migration 0005); this file only validates and maps filters.

import type { AppContext } from '@/lib/auth'
import { isIsoDate } from '@/lib/dates'
import type { AppRole, ApprovalRecord, ApprovalStatus } from '@/lib/types'

type Params = Record<string, string | string[] | undefined>
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES: ApprovalStatus[] = ['pending', 'approved', 'rejected', 'changes', 'cancelled']
const ROLES: AppRole[] = ['employee', 'manager', 'pm', 'hr', 'leadership', 'admin']
export const SORTS = ['submitted', 'decided', 'date', 'name'] as const
export type HistorySort = (typeof SORTS)[number]

export interface HistoryFilters {
  kind: 'leave' | 'timesheet' | ''
  status: ApprovalStatus | ''
  q: string
  department: string
  role: AppRole | ''
  project: string
  approver: string
  from: string
  to: string
  sort: HistorySort
  dir: 'asc' | 'desc'
  page: number
}

export const HISTORY_PAGE_SIZE = 25

/** Read filters from the URL. Anything unexpected is ignored, never passed through. */
export function parseHistoryFilters(sp: Params): HistoryFilters {
  const kind = first(sp.kind)
  const status = first(sp.status) as ApprovalStatus
  const role = first(sp.role) as AppRole
  const project = first(sp.project)
  const approver = first(sp.approver)
  const from = first(sp.from)
  const to = first(sp.to)
  const sort = first(sp.sort) as HistorySort
  const page = Number.parseInt(first(sp.page), 10)
  return {
    kind: kind === 'leave' || kind === 'timesheet' ? kind : '',
    status: STATUSES.includes(status) ? status : '',
    q: first(sp.q).trim().slice(0, 80),
    department: first(sp.department).trim().slice(0, 80),
    role: ROLES.includes(role) ? role : '',
    project: UUID_RE.test(project) ? project : '',
    approver: UUID_RE.test(approver) ? approver : '',
    from: isIsoDate(from) ? from : '',
    to: isIsoDate(to) ? to : '',
    sort: (SORTS as readonly string[]).includes(sort) ? sort : 'submitted',
    dir: first(sp.dir) === 'asc' ? 'asc' : 'desc',
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10000) : 1,
  }
}

/** Build a query string from filters (used by pagination / sort links). */
export function filtersToQuery(f: Partial<HistoryFilters>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) {
    if (v === '' || v === undefined || v === null) continue
    if (k === 'page' && v === 1) continue
    if (k === 'sort' && v === 'submitted') continue
    if (k === 'dir' && v === 'desc') continue
    q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export async function fetchApprovalRecords(
  supabase: AppContext['supabase'],
  f: Partial<HistoryFilters>,
  opts: { limit: number; offset?: number; actionable?: boolean },
): Promise<{ rows: ApprovalRecord[]; total: number; error: string | null }> {
  const { data, error } = await supabase.rpc('approval_records', {
    p_kind: f.kind || null,
    p_status: f.status || null,
    p_q: f.q || null,
    p_department: f.department || null,
    p_role: f.role || null,
    p_project: f.project || null,
    p_approver: f.approver || null,
    p_from: f.from || null,
    p_to: f.to || null,
    p_sort: f.sort ?? 'submitted',
    p_dir: f.dir ?? 'desc',
    p_limit: opts.limit,
    p_offset: opts.offset ?? 0,
    p_actionable: opts.actionable ?? false,
  })
  if (error) return { rows: [], total: 0, error: error.message }
  const rows = (data ?? []) as ApprovalRecord[]
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0, error: null }
}
