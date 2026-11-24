import { redirect } from 'next/navigation'

/** Turn raw database errors into something a person can act on. */
export function friendly(message: string): string {
  if (/row-level security|permission denied/i.test(message)) return 'You are not allowed to do that.'
  if (/violates check constraint .*(end_time|break_min)/i.test(message)) return 'Check the times: the end must be after the start, and the break must be shorter than the entry.'
  if (/duplicate key/i.test(message)) return 'That already exists.'
  if (/invalid input syntax/i.test(message)) return 'One of the values is not valid.'
  return message
}

/** Redirect back to a page with a success or error message shown on it. */
export function back(path: string, kind: 'ok' | 'error', message: string): never {
  const sep = path.includes('?') ? '&' : '?'
  redirect(`${path}${sep}${kind}=${encodeURIComponent(kind === 'error' ? friendly(message) : message)}`)
}
