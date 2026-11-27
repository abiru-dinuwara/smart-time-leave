'use client'

import { useEffect } from 'react'

/** Friendly fallback when a page fails to load (e.g. the database is unreachable). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <section className="card" role="alert">
      <div className="empty">
        <b>Something went wrong while loading this page.</b>
        <div>Please try again. If it keeps happening, contact your administrator{error.digest ? ` (reference ${error.digest})` : ''}.</div>
        <div style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={reset}>Try again</button>
        </div>
      </div>
    </section>
  )
}
