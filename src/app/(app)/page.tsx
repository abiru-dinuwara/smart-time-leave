import Link from 'next/link'
import { Suspense } from 'react'
import { getApprovalCounts, requireContext } from '@/lib/auth'
import { Icon } from '@/components/Icon'
import { CardSkeleton, PageHead } from '@/components/ui'
import { fmtDateLong } from '@/lib/dates'
import { ROLE_LABEL } from '@/lib/types'
import ManagerSection from './_dashboard/ManagerSection'
import { HrSection, LeadershipSection } from './_dashboard/OrgSections'
import Personal from './_dashboard/Personal'
import PmSection from './_dashboard/PmSection'

export const metadata = { title: 'Dashboard' }

function SectionFallback({ title }: { title: string }) {
  return (
    <>
      <h2 className="section-h">{title}</h2>
      <div className="grid g2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </>
  )
}

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/**
 * Role-based dashboard. Each section is an async server component that loads only
 * its own data; sections stream in independently (Suspense), so the page shell
 * appears immediately. Confidential details are only shown to roles allowed to see
 * them — org-wide sections use totals from org_overview().
 */
export default async function Dashboard() {
  const ctx = await requireContext()
  const { profile, org, today, reports, isApprover } = ctx
  const role = profile.role
  const counts = isApprover ? await getApprovalCounts() : { leave: 0, timesheets: 0 }
  const first = profile.full_name.split(' ')[0]
  const isLineManager = reports > 0 || role === 'manager'

  return (
    <>
      <PageHead title={`${greeting(org.timezone)}, ${first}`} sub={`${fmtDateLong(today)} · ${ROLE_LABEL[role]} · ${org.org_name}`}>
        {profile.tracks_time && <Link className="btn" href="/timesheet"><Icon name="plus" size={15} /> Log time</Link>}
        <Link className="btn" href="/leave"><Icon name="leave" size={15} /> Request leave</Link>
        {isApprover && counts.leave + counts.timesheets > 0 && (
          <Link className="btn primary" href="/approvals"><Icon name="check" size={15} /> Review {counts.leave + counts.timesheets} approval{counts.leave + counts.timesheets === 1 ? '' : 's'}</Link>
        )}
      </PageHead>

      {role === 'hr' && (
        <Suspense fallback={<SectionFallback title="HR overview" />}>
          <HrSection ctx={ctx} counts={counts} />
        </Suspense>
      )}
      {(role === 'leadership' || role === 'admin') && (
        <Suspense fallback={<SectionFallback title="Organisation overview" />}>
          <LeadershipSection ctx={ctx} />
        </Suspense>
      )}
      {role === 'pm' && (
        <Suspense fallback={<SectionFallback title="My projects" />}>
          <PmSection ctx={ctx} />
        </Suspense>
      )}
      {isLineManager && (
        <Suspense fallback={<SectionFallback title="My team" />}>
          <ManagerSection ctx={ctx} counts={counts} />
        </Suspense>
      )}
      <Suspense fallback={<SectionFallback title="My work" />}>
        <Personal ctx={ctx} />
      </Suspense>
    </>
  )
}
