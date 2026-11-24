'use client'

import Link from 'next/link'
import { useActionState, useState, type FormEvent } from 'react'
import { Field, Notice } from '@/components/ui'
import type { Project } from '@/lib/types'
import {
  BREAK_MAX_MIN,
  DESCRIPTION_MAX,
  TASK_MAX,
  hasErrors,
  initialFormState,
  readTimeEntry,
  validateTimeEntry,
  type FieldErrors,
} from '@/lib/validation'
import { saveEntry } from './actions'

export interface EntryFormValues {
  id?: string
  project_id: string
  task: string
  description: string
  start_time: string
  end_time: string
  break_min: string
}

/**
 * Add / edit one time entry. The date is shown but cannot be chosen: the server
 * assigns it. Errors are shown under each field, both from the instant browser
 * check and from the server.
 */
export default function EntryForm({
  projects,
  dateLabel,
  sheetDate,
  entry,
  others,
  cancelHref,
}: {
  projects: Pick<Project, 'id' | 'code' | 'name'>[]
  dateLabel: string
  /** Only sent when correcting a day the manager sent back; otherwise the server uses today. */
  sheetDate?: string
  entry?: EntryFormValues
  /** Other entries of the same day, for the instant overlap check. */
  others: { start_time: string; end_time: string }[]
  cancelHref?: string
}) {
  const [state, action, pending] = useActionState(saveEntry, initialFormState)
  const [clientErrors, setClientErrors] = useState<FieldErrors>({})
  const errors: FieldErrors = hasErrors(clientErrors) ? clientErrors : state.errors
  const v = state.values ?? entry ?? { project_id: '', task: '', description: '', start_time: '', end_time: '', break_min: '0' }
  const uid = entry?.id ?? 'new'

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const { errors: found } = validateTimeEntry(readTimeEntry(new FormData(e.currentTarget)), others)
    setClientErrors(found)
    if (hasErrors(found)) e.preventDefault()
  }

  return (
    <form action={action} onSubmit={onSubmit} noValidate key={state.attempt}>
      {entry?.id && <input type="hidden" name="id" value={entry.id} />}
      {sheetDate && <input type="hidden" name="sheet_date" value={sheetDate} />}
      {state.message && !hasErrors(clientErrors) && <Notice kind="bad">{state.message}</Notice>}
      <div className="frow">
        <Field label="Work date" hint="Set automatically" required htmlFor={`d-${uid}`}>
          <input id={`d-${uid}`} value={dateLabel} readOnly aria-readonly="true" />
        </Field>
        <Field label="Project" required error={errors.project_id} htmlFor={`p-${uid}`}>
          <select id={`p-${uid}`} name="project_id" defaultValue={v.project_id} required aria-invalid={Boolean(errors.project_id)}>
            <option value="" disabled>Choose…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </Field>
        <Field label="Task" required error={errors.task} htmlFor={`t-${uid}`}>
          <input id={`t-${uid}`} name="task" defaultValue={v.task} maxLength={TASK_MAX} placeholder="e.g. Code review" required aria-invalid={Boolean(errors.task)} />
        </Field>
      </div>
      <div className="frow">
        <Field label="Start time" required error={errors.start_time} htmlFor={`s-${uid}`}>
          <input id={`s-${uid}`} type="time" name="start_time" defaultValue={v.start_time} required aria-invalid={Boolean(errors.start_time)} />
        </Field>
        <Field label="End time" required error={errors.end_time} htmlFor={`e-${uid}`}>
          <input id={`e-${uid}`} type="time" name="end_time" defaultValue={v.end_time} required aria-invalid={Boolean(errors.end_time)} />
        </Field>
        <Field label="Break (minutes)" required hint="Enter 0 if you took no break" error={errors.break_min} htmlFor={`b-${uid}`}>
          <input id={`b-${uid}`} type="number" name="break_min" min={0} max={BREAK_MAX_MIN} step={1} defaultValue={v.break_min} required aria-invalid={Boolean(errors.break_min)} />
        </Field>
      </div>
      <Field label="Work description" required error={errors.description} htmlFor={`w-${uid}`}>
        <textarea id={`w-${uid}`} name="description" defaultValue={v.description} maxLength={DESCRIPTION_MAX} placeholder="What did you work on?" required aria-invalid={Boolean(errors.description)} />
      </Field>
      <div className="row">
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : entry?.id ? 'Save changes' : 'Add entry'}
        </button>
        {cancelHref && <Link className="btn" href={cancelHref}>Cancel</Link>}
      </div>
    </form>
  )
}
