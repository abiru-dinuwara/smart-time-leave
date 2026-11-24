import { requireRole } from '@/lib/auth'
import { Empty, Field, Flash, PageHead, one, type SP } from '@/components/ui'
import { fmtDateY } from '@/lib/dates'
import { LEAVE_LABEL, type LeaveType } from '@/lib/types'
import { addHoliday, deleteHoliday, saveOrg, savePolicies } from './actions'

export const metadata = { title: 'Policies & Holidays' }

export default async function SettingsPage({ searchParams }: { searchParams: SP }) {
  const { supabase, profile, org, today } = await requireRole('admin', 'hr')
  const sp = await searchParams
  const isAdmin = profile.role === 'admin'
  const [polRes, holRes] = await Promise.all([
    supabase.from('leave_policies').select('*'),
    supabase.from('holidays').select('*').gte('holiday_date', `${Number(today.slice(0, 4)) - 1}-01-01`).order('holiday_date'),
  ])
  const policies = new Map(((polRes.data ?? []) as { type: LeaveType; days_per_year: number | null; note: string }[]).map((p) => [p.type, p]))
  const holidays = (holRes.data ?? []) as { id: string; holiday_date: string; name: string }[]

  return (
    <>
      <PageHead title="Policies & Holidays" sub="Rules used to calculate leave days and balances." />
      <Flash ok={one(sp.ok)} error={one(sp.error)} />

      <div className="grid g2" style={{ marginBottom: 16 }}>
        <form className="card" action={savePolicies}>
          <div className="ch"><h2>Leave allowances (days per year)</h2></div>
          {(Object.keys(LEAVE_LABEL) as LeaveType[]).map((t) => (
            <div className="frow" key={t}>
              <Field label={LEAVE_LABEL[t]} hint="Leave empty for no limit">
                <input type="number" step="0.5" min="0" max="365" name={`days_${t}`} defaultValue={policies.get(t)?.days_per_year ?? ''} />
              </Field>
              <Field label="Note"><input name={`note_${t}`} defaultValue={policies.get(t)?.note ?? ''} maxLength={300} /></Field>
            </div>
          ))}
          <button className="btn primary" type="submit">Save policies</button>
          <p className="hint-line" style={{ marginTop: 8 }}>Balances are counted per calendar year, by the first day of each request.</p>
        </form>

        <div className="card">
          <div className="ch"><h2>Company holidays</h2></div>
          <form action={addHoliday} className="inline-form" style={{ marginBottom: 12 }}>
            <Field label="Date"><input type="date" name="holiday_date" required /></Field>
            <Field label="Name"><input name="name" maxLength={120} required placeholder="e.g. National Day" /></Field>
            <div className="fld"><button className="btn primary" type="submit">Add</button></div>
          </form>
          {holidays.length === 0 ? (
            <Empty title="No holidays yet">Holidays are not counted as leave days.</Empty>
          ) : (
            <div className="list">
              {holidays.map((h) => (
                <div className="li" key={h.id}>
                  <div className="grow"><div className="t">{h.name}</div><div className="muted sm">{fmtDateY(h.holiday_date)}</div></div>
                  <form action={deleteHoliday}><input type="hidden" name="id" value={h.id} /><button className="btn s danger" type="submit">Remove</button></form>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isAdmin && (
        <form className="card" action={saveOrg}>
          <div className="ch"><h2>Organisation</h2></div>
          <div className="frow">
            <Field label="Company name"><input name="org_name" defaultValue={org.org_name} required /></Field>
            <Field label="Working hours per day"><input type="number" step="0.25" min="1" max="24" name="hours_per_day" defaultValue={org.hours_per_day} required /></Field>
            <Field label="Time zone" hint="e.g. Asia/Colombo, Europe/London"><input name="timezone" defaultValue={org.timezone} required /></Field>
            <Field label="Only allow sign-ups from this email domain" hint="e.g. mycompany.com — leave empty to allow any"><input name="allowed_email_domain" defaultValue={org.allowed_email_domain ?? ''} /></Field>
          </div>
          <button className="btn primary" type="submit">Save organisation</button>
        </form>
      )}
    </>
  )
}
