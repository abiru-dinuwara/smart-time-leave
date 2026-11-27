import { CardSkeleton, Skeleton } from '@/components/ui'

/** Shown instantly while a page's data loads (route-level streaming). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="phead">
        <div className="grow">
          <Skeleton lines={1} height={22} />
        </div>
      </div>
      <div className="stats">
        {[0, 1, 2, 3].map((i) => (
          <div className="stat" key={i}>
            <Skeleton lines={2} />
          </div>
        ))}
      </div>
      <CardSkeleton />
      <span className="sr">Loading…</span>
    </div>
  )
}
