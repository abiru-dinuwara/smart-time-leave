'use client'

import { useId, useRef, useState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

/**
 * A button that asks for confirmation in an accessible modal dialog before
 * submitting its parent <form>. The confirm button carries `name`/`value`, so
 * the server action receives exactly which choice was made.
 *
 * `requireField`: name of a form field that must be filled in first (e.g. the
 * note when rejecting). The server checks this again.
 */
export default function ConfirmButton({
  children,
  name,
  value,
  className = 'btn',
  confirmClassName,
  title,
  message,
  confirmLabel,
  requireField,
  requireMessage,
}: {
  children: ReactNode
  name?: string
  value?: string
  className?: string
  confirmClassName?: string
  title: string
  message: ReactNode
  confirmLabel: string
  requireField?: string
  requireMessage?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState<string | null>(null)
  const { pending } = useFormStatus()
  const id = useId()

  function open() {
    const form = trigger.current?.form
    if (requireField && form) {
      const el = form.elements.namedItem(requireField) as HTMLInputElement | HTMLTextAreaElement | null
      if (el && !el.value.trim()) {
        setError(requireMessage ?? 'Please fill in this field first.')
        el.setAttribute('aria-invalid', 'true')
        el.focus()
        return
      }
      el?.removeAttribute('aria-invalid')
    }
    setError(null)
    dialog.current?.showModal()
  }

  return (
    <>
      <button ref={trigger} type="button" className={className} onClick={open} disabled={pending} aria-haspopup="dialog">
        {children}
      </button>
      {error && (
        <span className="ferr inline-err" role="alert">
          {error}
        </span>
      )}
      <dialog ref={dialog} className="dlg" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
        <h2 id={`${id}-t`}>{title}</h2>
        <div id={`${id}-d`} className="dlg-body">{message}</div>
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={() => dialog.current?.close()} autoFocus>
            Cancel
          </button>
          <button
            type="submit"
            name={name}
            value={value}
            className={confirmClassName ?? className}
            onClick={() => dialog.current?.close()}
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  )
}
