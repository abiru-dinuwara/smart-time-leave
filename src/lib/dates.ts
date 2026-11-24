// Date helpers. All dates in the app are plain "YYYY-MM-DD" strings so that
// time zones can never shift a leave day or a timesheet day.

const pad = (n: number) => String(n).padStart(2, '0')

export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(parseIso(s)) === s
export const addDays = (s: string, n: number) => {
  const d = parseIso(s)
  d.setDate(d.getDate() + n)
  return isoOf(d)
}
/** 0 = Monday … 6 = Sunday */
export const dow = (s: string) => (parseIso(s).getDay() + 6) % 7
export const mondayOf = (s: string) => addDays(s, -dow(s))

/** Today's date in the company's time zone, e.g. "Asia/Colombo". */
export function todayIn(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return isoOf(new Date())
  }
}

export const fmtDate = (s: string, o?: Intl.DateTimeFormatOptions) =>
  parseIso(s).toLocaleDateString('en-GB', o ?? { weekday: 'short', day: 'numeric', month: 'short' })
export const fmtDateY = (s: string) => fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
export const fmtRange = (a: string, b: string) =>
  a === b ? fmtDate(a) : `${fmtDate(a, { day: 'numeric', month: 'short' })} – ${fmtDate(b, { day: 'numeric', month: 'short', year: 'numeric' })}`
export const fmtDateTime = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
/** "Tuesday, 24 November 2026" */
export const fmtDateLong = (s: string) => fmtDate(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
/** Clock time of a timestamp in the company time zone, e.g. "14:35". */
export const fmtTime = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
/** Full timestamp with seconds, e.g. "24 Nov 2026, 14:05:09". */
export const fmtStamp = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

// ----- times: Postgres returns "09:00:00" -----
export const hhmm = (t: string) => t.slice(0, 5)
export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
export const entryMinutes = (e: { start_time: string; end_time: string; break_min: number }) =>
  toMin(e.end_time) - toMin(e.start_time) - e.break_min
export const fmtMinutes = (m: number) => {
  const h = Math.floor(m / 60)
  const mm = Math.round(m % 60)
  return mm ? `${h}h ${mm}m` : `${h}h`
}
export const n1 = (v: number) => String(Math.round(v * 10) / 10)
