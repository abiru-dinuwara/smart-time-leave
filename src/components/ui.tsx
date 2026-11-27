import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { Tone } from '@/lib/types'

const AVC = ['#1D3A8A', '#0E7466', '#7A3E9D', '#9A4A06', '#1F6F8B', '#A33A55', '#3D5A80']

export function Avatar({ name, large }: { name: string; large?: boolean }) {
  const initials = name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span className={`av${large ? ' l' : ''}`} style={{ background: AVC[h % AVC.length] }} aria-hidden="true">
      {initials}
    </span>
  )
}

/** Person with avatar, name and a secondary line. */
export function Person({ name, sub }: { name: string; sub?: ReactNode }) {
  return (
    <div className="person">
      <Avatar name={name} />
      <div className="grow">
        <div className="pn">{name}</div>
        {sub && <div className="muted xs">{sub}</div>}
      </div>
    </div>
  )
}

const TONE_ICON: Record<Tone, string> = { green: 'tick', red: 'xmark', amber: 'hourglass', blue: 'undo', gray: 'dash' }

/**
 * Status badge. Always shows a text label AND a shape icon, so status is never
 * communicated by colour alone.
 */
export function Badge({ label, tone, icon = true }: { label: string; tone: Tone | string; icon?: boolean }) {
  const t = (tone in TONE_ICON ? tone : 'gray') as Tone
  return (
    <span className={`badge b-${t}`}>
      {icon && <Icon name={TONE_ICON[t]} size={12} />}
      {label}
    </span>
  )
}

/** Small neutral tag (roles, project codes, routes). */
export function Tag({ children, tone }: { children: ReactNode; tone?: 'primary' }) {
  return <span className={`tag${tone ? ` tag-${tone}` : ''}`}>{children}</span>
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="phead">
      <div className="grow">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="pact">{children}</div>}
    </div>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone,
  icon,
  href,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'warn' | 'bad' | 'ok'
  icon?: string
  href?: string
}) {
  const body = (
    <>
      <div className="stat-top">
        <span className="l">{label}</span>
        {icon && <span className="stat-ic"><Icon name={icon} size={16} /></span>}
      </div>
      <div className="v">{value}</div>
      {sub && <div className="s">{sub}</div>}
    </>
  )
  return href ? (
    <Link href={href} className={`stat link ${tone ?? ''}`}>{body}</Link>
  ) : (
    <div className={`stat ${tone ?? ''}`}>{body}</div>
  )
}

export function Notice({ kind = 'info', children, title }: { kind?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode; title?: string }) {
  const icon = { info: 'info', warn: 'alert', bad: 'alert', ok: 'tick' }[kind]
  return (
    <div className={`notice n-${kind}`} role={kind === 'bad' ? 'alert' : kind === 'ok' ? 'status' : undefined}>
      <Icon name={icon} size={18} />
      <div className="grow">
        {title && <b className="nt">{title}</b>}
        {children}
      </div>
    </div>
  )
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

export function Empty({ title, children, icon = 'inbox' }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <span className="empty-ic"><Icon name={icon} size={22} /></span>
      <b>{title}</b>
      {children && <div>{children}</div>}
    </div>
  )
}

export function Bar({ value, tone, label }: { value: number; tone?: 'g' | 'r' | 'a'; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className={`bar ${tone ?? ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <i style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Card({ title, action, children, flush, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`card${flush ? ' flush' : ''}${className ? ` ${className}` : ''}`}>
      {(title || action) && (
        <div className="ch">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Tabs({ items, current }: { items: { key: string; label: string; href: string; count?: number }[]; current: string }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {items.map((t) => (
        <Link key={t.key} href={t.href} className={t.key === current ? 'on' : ''} aria-current={t.key === current ? 'page' : undefined}>
          {t.label}
          {t.count !== undefined && <span className="c">{t.count}</span>}
        </Link>
      ))}
    </nav>
  )
}

/** Server-rendered pagination. `hrefFor(page)` builds each link so all filters are kept. */
export function Pager({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="muted sm">
        {from}–{to} of {total}
      </span>
      <div className="row">
        {page > 1 ? (
          <Link className="btn s" href={hrefFor(page - 1)} rel="prev"><Icon name="left" size={14} /> Previous</Link>
        ) : (
          <span className="btn s" aria-disabled="true"><Icon name="left" size={14} /> Previous</span>
        )}
        <span className="sm">Page {Math.min(page, pages)} of {pages}</span>
        {page < pages ? (
          <Link className="btn s" href={hrefFor(page + 1)} rel="next">Next <Icon name="right" size={14} /></Link>
        ) : (
          <span className="btn s" aria-disabled="true">Next <Icon name="right" size={14} /></span>
        )}
      </div>
    </nav>
  )
}

export function Skeleton({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <div className="skel" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <i key={i} style={{ height: height ?? 12, width: `${90 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  )
}

export function CardSkeleton({ title }: { title?: string }) {
  return (
    <section className="card" aria-busy="true">
      {title && <div className="ch"><h2>{title}</h2></div>}
      <Skeleton lines={4} />
      <span className="sr">Loading…</span>
    </section>
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
        {required && <span className="sr"> (required)</span>}
      </label>
      {children}
      {error ? (
        <span className="ferr" role="alert"><Icon name="alert" size={13} /> {error}</span>
      ) : (
        hint && <span className="hint">{hint}</span>
      )}
    </div>
  )
}

/** Key/value list used in approval and detail cards. */
export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export type SP = Promise<Record<string, string | string[] | undefined>>
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
