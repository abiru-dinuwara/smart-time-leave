import type { ReactNode } from 'react'

const AVC = ['#17233B', '#2B7550', '#245FA6', '#8F5B00', '#6B4A8E', '#A83F55', '#2E7482']

export function Avatar({ name, large }: { name: string; large?: boolean }) {
  const initials = name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span className={`av ${large ? 'l' : ''}`} style={{ background: AVC[h % AVC.length] }} aria-hidden="true">
      {initials}
    </span>
  )
}

export function Badge({ label, tone }: { label: string; tone: string }) {
  return <span className={`badge b-${tone}`}>{label}</span>
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="phead">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="pact">{children}</div>}
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  )
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  return <div className={`notice n-${kind}`} role={kind === 'bad' ? 'alert' : undefined}>{children}</div>
}

/** Shows the ?ok= / ?error= message that server actions redirect with. */
export function Flash({ ok, error }: { ok?: string; error?: string }) {
  return (
    <>
      {ok && <Notice kind="ok">{ok}</Notice>}
      {error && <Notice kind="bad">{error}</Notice>}
    </>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  )
}

export function Bar({ value, tone }: { value: number; tone?: 'g' | 'r' }) {
  return (
    <div className={`bar ${tone ?? ''}`}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className={`fld${error ? ' has-err' : ''}`}>
      <label htmlFor={htmlFor}>
        {label}
        {required && <span className="req" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <span className="ferr" role="alert">{error}</span>
      ) : (
        hint && <span className="hint">{hint}</span>
      )}
    </div>
  )
}

export type SP = Promise<Record<string, string | string[] | undefined>>
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
