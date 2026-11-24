// Form validation shared by the browser (instant field-level feedback) and the
// server actions (the authoritative check before anything reaches the database).
// The database enforces the same business rules again in migration 0003.
// Keep this file free of server-only imports so client components can use it.

import { isIsoDate, toMin } from '@/lib/dates'
import { LEAVE_LABEL } from '@/lib/types'

export type FieldErrors = Partial<Record<string, string>>

/** State returned by form server actions used with React's useActionState. */
export interface FormState {
  errors: FieldErrors
  message?: string
  values?: Record<string, string>
  /** Increases on every failed attempt so the form remounts with the submitted values. */
  attempt: number
}

export const initialFormState: FormState = { errors: {}, attempt: 0 }

export const hasErrors = (e: FieldErrors) => Object.values(e).some(Boolean)

/** Read a trimmed string field from FormData. */
export const field = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

// ---------------------------------------------------------------- timesheet

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const BREAK_MAX_MIN = 600
export const TASK_MAX = 200
export const DESCRIPTION_MAX = 1000

/** "13:05" -> "1:05 PM" (12:xx PM is noon, 12:xx AM is midnight). */
export function fmt12(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export interface TimeEntryInput {
  project_id: string
  task: string
  description: string
  start_time: string
  end_time: string
  break_min: string
}

export const TIME_ENTRY_FIELDS: (keyof TimeEntryInput)[] = ['project_id', 'task', 'description', 'start_time', 'end_time', 'break_min']

export function readTimeEntry(f: FormData): TimeEntryInput {
  return {
    project_id: field(f, 'project_id'),
    task: field(f, 'task'),
    description: field(f, 'description'),
    start_time: field(f, 'start_time'),
    end_time: field(f, 'end_time'),
    break_min: field(f, 'break_min'),
  }
}

/**
 * Validates one time entry. `others` are the other entries on the same day
 * (used to catch overlaps). Returns field errors and the parsed break.
 */
export function validateTimeEntry(
  v: TimeEntryInput,
  others: { start_time: string; end_time: string }[] = [],
): { errors: FieldErrors; breakMin: number } {
  const errors: FieldErrors = {}

  if (!v.project_id) errors.project_id = 'Choose a project.'
  if (!v.task) errors.task = 'Enter the task you worked on.'
  else if (v.task.length > TASK_MAX) errors.task = `Keep the task under ${TASK_MAX} characters.`
  if (!v.description) errors.description = 'Describe the work you did.'
  else if (v.description.length > DESCRIPTION_MAX) errors.description = `Keep the description under ${DESCRIPTION_MAX} characters.`

  if (!v.start_time) errors.start_time = 'Enter a start time.'
  else if (!TIME_RE.test(v.start_time)) errors.start_time = 'Enter a valid start time (HH:MM).'
  if (!v.end_time) errors.end_time = 'Enter an end time.'
  else if (!TIME_RE.test(v.end_time)) errors.end_time = 'Enter a valid end time (HH:MM).'

  const timesOk = !errors.start_time && !errors.end_time
  const worked = timesOk ? toMin(v.end_time) - toMin(v.start_time) : 0
  if (timesOk && worked <= 0)
    errors.end_time = `The end time (${fmt12(v.end_time)}) must be later than the start time (${fmt12(v.start_time)}). Entries cannot run past midnight.`

  let breakMin = NaN
  if (v.break_min === '') errors.break_min = 'Enter the break in minutes (0 if you took none).'
  else if (!/^\d{1,3}$/.test(v.break_min)) errors.break_min = 'The break must be a whole number of minutes.'
  else {
    breakMin = Number(v.break_min)
    if (breakMin > BREAK_MAX_MIN) errors.break_min = `The break cannot be more than ${BREAK_MAX_MIN} minutes.`
    else if (timesOk && worked > 0 && breakMin >= worked) errors.break_min = 'The break must be shorter than the time between start and end.'
  }

  if (timesOk && worked > 0) {
    const clash = others.find((o) => toMin(o.start_time) < toMin(v.end_time) && toMin(o.end_time) > toMin(v.start_time))
    if (clash) errors.start_time = `This overlaps another entry (${clash.start_time.slice(0, 5)}–${clash.end_time.slice(0, 5)}).`
  }

  return { errors, breakMin }
}

// -------------------------------------------------------------------- leave

export const REASON_MAX = 1000
export const HALF_VALUES = ['none', 'AM', 'PM'] as const

export interface LeaveInput {
  type: string
  start_date: string
  end_date: string
  half: string
  reason: string
}

export const LEAVE_FIELDS: (keyof LeaveInput)[] = ['type', 'start_date', 'end_date', 'half', 'reason']

export function readLeave(f: FormData): LeaveInput {
  return {
    type: field(f, 'type'),
    start_date: field(f, 'start_date'),
    end_date: field(f, 'end_date'),
    half: field(f, 'half'),
    reason: field(f, 'reason'),
  }
}

/**
 * Validates a leave request. `today` must be the company's date (server side:
 * from the company time zone). Drafts may leave the reason empty; everything
 * is required when submitting for manager approval.
 */
export function validateLeave(v: LeaveInput, opts: { today: string; intent: 'draft' | 'pending' }): FieldErrors {
  const errors: FieldErrors = {}

  if (!v.type) errors.type = 'Choose a leave type.'
  else if (!(v.type in LEAVE_LABEL)) errors.type = 'Choose a valid leave type.'

  if (!v.start_date) errors.start_date = 'Choose the first day of your leave.'
  else if (!isIsoDate(v.start_date)) errors.start_date = 'Choose a valid date.'
  else if (v.start_date < opts.today) errors.start_date = 'Leave cannot start in the past. Choose today or a later date.'

  if (!v.end_date) errors.end_date = 'Choose the last day of your leave.'
  else if (!isIsoDate(v.end_date)) errors.end_date = 'Choose a valid date.'
  else if (!errors.start_date && v.end_date < v.start_date) errors.end_date = 'The last day cannot be earlier than the first day.'

  if (!(HALF_VALUES as readonly string[]).includes(v.half)) errors.half = 'Choose full day(s), morning or afternoon.'
  else if (v.half !== 'none' && !errors.start_date && !errors.end_date && v.start_date !== v.end_date)
    errors.half = 'Half-day leave must be a single day (first day and last day the same).'

  if (opts.intent === 'pending' && !v.reason) errors.reason = 'Enter a reason for your leave.'
  else if (v.reason.length > REASON_MAX) errors.reason = `Keep the reason under ${REASON_MAX} characters.`

  return errors
}
