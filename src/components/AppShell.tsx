'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { Avatar } from './ui'
import type { NavItem } from '@/lib/nav'

interface Props {
  nav: NavItem[]
  counts: { approvals: number; notifications: number }
  orgName: string
  userName: string
  roleLabel: string
  children: ReactNode
}

export default function AppShell({ nav, counts, orgName, userName, roleLabel, children }: Props) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    setDrawer(false)
    setMenu(false)
  }, [pathname])

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'))
  const current = nav.find((n) => isActive(n.href))?.label ?? ''
  const badge = (n: NavItem) => (n.badge ? counts[n.badge] : 0)

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''} ${drawer ? 'drawer-open' : ''}`}>
      <aside className="side" aria-label="Main navigation">
        <div className="brand">
          <span className="logo"><Icon name="logo" size={20} /></span>
          <span className="lbl">Smart Time &amp;<br />Leave Assistant</span>
        </div>
        <nav className="nav">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={isActive(n.href) ? 'active' : ''} title={n.label} aria-current={isActive(n.href) ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span className="lbl">{n.label}</span>
              {badge(n) > 0 && <span className="cnt">{badge(n)}</span>}
            </Link>
          ))}
        </nav>
        <button className="collapse-btn" onClick={() => setCollapsed((c) => !c)} aria-label="Collapse menu">
          <Icon name="panel" />
          <span className="lbl">Collapse menu</span>
        </button>
      </aside>
      <div className="overlay" onClick={() => setDrawer(false)} />
      <div className="mainwrap">
        <header className="top">
          <button className="icon-btn hamb" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="crumbs">{orgName} / <b>{current}</b></div>
          <div className="sp" />
          <Link href="/notifications" className="icon-btn" aria-label={`Notifications${counts.notifications ? `, ${counts.notifications} unread` : ''}`}>
            <Icon name="bell" />
            {counts.notifications > 0 && <span className="dot">{counts.notifications > 99 ? '99+' : counts.notifications}</span>}
          </Link>
          <div className="profile">
            <button className="pbtn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
              <Avatar name={userName} />
              <span className="pname">{userName}</span>
              <span className="rolechip">{roleLabel}</span>
            </button>
            {menu && (
              <div className="menu" role="menu">
                <div style={{ padding: '6px 10px' }}>
                  <b>{userName}</b>
                  <div className="muted xs">{roleLabel}</div>
                </div>
                <hr />
                <form action="/auth/signout" method="post" className="signout">
                  <button type="submit" role="menuitem"><Icon name="lock" /> Sign out</button>
                </form>
              </div>
            )}
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  )
}
