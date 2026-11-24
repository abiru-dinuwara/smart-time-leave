'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Live "mm:ss" until the editing window closes. Display only — the server and
 * database decide whether an edit is still allowed. When it reaches zero the page
 * is refreshed so the Edit / Delete buttons disappear.
 */
export default function Countdown({ until }: { until: string }) {
  const router = useRouter()
  const end = new Date(until).getTime()
  const [left, setLeft] = useState(() => Math.max(0, end - Date.now()))

  useEffect(() => {
    const t = setInterval(() => {
      const l = Math.max(0, end - Date.now())
      setLeft(l)
      if (l === 0) {
        clearInterval(t)
        router.refresh()
      }
    }, 1000)
    return () => clearInterval(t)
  }, [end, router])

  const s = Math.ceil(left / 1000)
  return (
    <b suppressHydrationWarning>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </b>
  )
}
