import { requireRole } from '@/lib/auth'
import { Empty, PageHead } from '@/components/ui'
import { fmtDateTime } from '@/lib/dates'

export const metadata = { title: 'Audit Log' }

export default async function AuditPage() {
  const { supabase, org } = await requireRole('admin')
  const { data } = await supabase.from('audit_logs').select('*').order('at', { ascending: false }).limit(200)
  const logs = (data ?? []) as { id: number; at: string; actor_name: string | null; action: string; detail: string }[]
  return (
    <>
      <PageHead title="Audit Log" sub="A permanent record of who did what. The latest 200 entries are shown. Nobody can edit or delete these." />
      <div className="card flush">
        {logs.length === 0 ? (
          <Empty title="Nothing recorded yet" />
        ) : (
          <div className="tw">
            <table>
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="nowrap">{fmtDateTime(l.at, org.timezone)}</td>
                    <td>{l.actor_name ?? 'System'}</td>
                    <td><b>{l.action}</b></td>
                    <td className="muted">{l.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
