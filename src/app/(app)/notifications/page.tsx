import Link from 'next/link'
import { requireContext } from '@/lib/auth'
import { Badge, Empty, Flash, PageHead, one, type SP } from '@/components/ui'
import { fmtDateTime } from '@/lib/dates'
import { markAllRead, markRead } from './actions'

export const metadata = { title: 'Notifications' }

interface N { id: string; text: string; link: string | null; read: boolean; created_at: string }

export default async function NotificationsPage({ searchParams }: { searchParams: SP }) {
  const { supabase, org } = await requireContext()
  const sp = await searchParams
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)
  const list = (data ?? []) as N[]
  const unread = list.filter((n) => !n.read).length

  return (
    <>
      <PageHead title="Notifications" sub={unread ? `${unread} unread` : 'You are all caught up.'}>
        {unread > 0 && (
          <form action={markAllRead}><button className="btn" type="submit">Mark all as read</button></form>
        )}
      </PageHead>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <div className="card">
        {list.length === 0 ? (
          <Empty title="No notifications yet">Approvals, decisions and reminders will show up here.</Empty>
        ) : (
          <div className="list">
            {list.map((n) => (
              <div className="li" key={n.id}>
                <div className="grow">
                  <div className={n.read ? 'muted' : 't'}>{n.text}</div>
                  <div className="muted xs">{fmtDateTime(n.created_at, org.timezone)}</div>
                </div>
                {!n.read && <Badge label="New" tone="blue" />}
                {n.link && <Link className="btn s" href={n.link}>Open</Link>}
                {!n.read && (
                  <form action={markRead}><input type="hidden" name="id" value={n.id} /><button className="btn s ghost" type="submit">Mark read</button></form>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
