'use client'

import Link from 'next/link'
import { useActionState, useState, type ChangeEvent, type FormEvent } from 'react'
import { Field, Notice } from '@/components/ui'
import { LEAVE_LABEL, type LeaveType } from '@/lib/types'
import { REASON_MAX, hasErrors, initialFormState, readLeave, validateLeave, type FieldErrors } from '@/lib/validation'
import { saveLeave } from './actions'

export interface LeaveFormValues {
  id?: string
  type: string
  start_date: string
  end_date: string
  half: string
  reason: string
}

/**
 * New / edit leave request. `today` is the company's date, supplied by the server.
 * The Last Day picker's minimum follows the First Day, and both refuse past dates.
 */
export default function LeaveForm({
  today,
  req,
  managerName,
}: {
  today: string
  req?: LeaveFormValues
  /** Active line manager; null = the request goes to an administrator. */
  managerName: string | null
}) {
  const [state, action, pending] = useActionState(saveLeave, initialFormState)
  const v = state.values ?? req ?? { type: '', start_date: '', end_date: '', half: 'none', reason: '' }
  return (
    // remount with the submitted values after a server-side error
    <Inner key={state.attempt} today={today} id={req?.id} v={v} serverErrors={state.errors} message={state.message} action={action} pending={pending} managerName={managerName} />
  )
}

function Inner({
  today,
  id,
  v,
  serverErrors,
  message,
  action,
  pending,
  managerName,
}: {
  today: string
  id?: string
  v: Record<string, string> | LeaveFormValues
  serverErrors: FieldErrors
  message?: string
  action: (fd: FormData) => void
  pending: boolean
  managerName: string | null
}) {
  const [start, setStart] = useState(v.start_date ?? '')
  const [end, setEnd] = useState(v.end_date ?? '')
  const [half, setHalf] = useState(v.half || 'none')
  const [clientErrors, setClientErrors] = useState<FieldErrors>({})
  const [checked, setChecked] = useState(false)
  const [lastIntent, setLastIntent] = useState<'draft' | 'pending'>('pending')
  const errors: FieldErrors = checked ? clientErrors : serverErrors
  const uid = id ?? 'new'

  function changeStart(value: string) {
    setStart(value)
    // keep the range valid: Last Day can never be before First Day
    if (value && (!end || end < value || half !== 'none')) setEnd(value)
  }
  function changeHalf(value: string) {
    setHalf(value)
    if (value !== 'none' && start) setEnd(start)
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const intent = submitter?.value === 'draft' ? 'draft' : 'pending'
    const found = validateLeave(readLeave(new FormData(e.currentTarget)), { today, intent })
    setLastIntent(intent)
    setClientErrors(found)
    setChecked(true)
    if (hasErrors(found)) e.preventDefault()
  }

  function onChange(e: FormEvent<HTMLFormElement>) {
    if (checked || hasErrors(serverErrors)) {
      setClientErrors(validateLeave(readLeave(new FormData(e.currentTarget)), { today, intent: lastIntent }))
      setChecked(true)
    }
  }

  return (
    <form action={action} onSubmit={onSubmit} onChange={onChange} noValidate>
      {id && <input type="hidden" name="id" value={id} />}
      {message && !checked && <Notice kind="bad">{message}</Notice>}
      <div className="frow">
        <Field label="Leave type" required error={errors.type} htmlFor={`lt-${uid}`}>
          <select id={`lt-${uid}`} name="type" defaultValue={v.type} required aria-invalid={Boolean(errors.type)}>
            <option value="" disabled>Choose…</option>
            {(Object.keys(LEAVE_LABEL) as LeaveType[]).map((t) => <option key={t} value={t}>{LEAVE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="First day" required error={errors.start_date} hint="Today or later" htmlFor={`ls-${uid}`}>
          <input
            id={`ls-${uid}`}
            type="date"
            name="start_date"
            min={today}
            value={start}
            onChange={(e: ChangeEvent<HTMLInputElement>) => changeStart(e.target.value)}
            required
            aria-invalid={Boolean(errors.start_date)}
          />
        </Field>
        <Field label="Last day" required error={errors.end_date} hint={half !== 'none' ? 'Same as first day for half-day leave' : 'Same day for single-day leave'} htmlFor={`le-${uid}`}>
          <input
            id={`le-${uid}`}
            type="date"
            name="end_date"
            min={start || today}
            value={end}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEnd(e.target.value)}
            readOnly={half !== 'none'}
            required
            aria-invalid={Boolean(errors.end_date)}
          />
        </Field>
        <Field label="Half day?" required error={errors.half} htmlFor={`lh-${uid}`}>
          <select id={`lh-${uid}`} name="half" value={half} onChange={(e: ChangeEvent<HTMLSelectElement>) => changeHalf(e.target.value)} required aria-invalid={Boolean(errors.half)}>
            <option value="none">Full day(s)</option>
            <option value="AM">Morning only</option>
            <option value="PM">Afternoon only</option>
          </select>
        </Field>
      </div>
      <Field label="Reason for leave" required error={errors.reason} htmlFor={`lr-${uid}`}>
        <textarea id={`lr-${uid}`} name="reason" defaultValue={v.reason} maxLength={REASON_MAX} required aria-invalid={Boolean(errors.reason)} />
      </Field>
      <p className="hint-line" style={{ marginBottom: 10 }}>
        Weekends and company holidays are not counted. Your balance and overlapping requests are checked when you submit.
        {managerName ? <> Your request goes to <b>{managerName}</b>, your line manager, for approval.</> : <> Your request goes to an administrator for approval.</>}
      </p>
      <div className="row">
        <button className="btn primary" type="submit" name="intent" value="pending" disabled={pending}>
          {pending ? 'Sending…' : id ? 'Resubmit for approval' : 'Submit request'}
        </button>
        <button className="btn" type="submit" name="intent" value="draft" disabled={pending}>Save as draft</button>
        {id && <Link className="btn" href="/leave">Cancel</Link>}
      </div>
    </form>
  )
}
