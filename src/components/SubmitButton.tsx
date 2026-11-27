'use client'

import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

/** Submit button that disables itself while its form's server action runs (prevents double submits). */
export default function SubmitButton({
  children,
  pendingLabel,
  className = 'btn primary',
  name,
  value,
  disabled,
}: {
  children: ReactNode
  pendingLabel?: string
  className?: string
  name?: string
  value?: string
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} name={name} value={value} disabled={pending || disabled} aria-busy={pending || undefined}>
      {pending ? pendingLabel ?? 'Working…' : children}
    </button>
  )
}
