'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { Avatar } from './ui'
import type { NavGroup, NavItem } from '@/lib/nav'

interface Props {
  nav: NavGroup[]
  counts: { approvals: number; notifications: number }
  orgName: string
  userName: string
  userEmail: string
  roleLabel: string
  children: ReactNode
}

export default function AppShell({ nav, counts, orgName, userName, userEmail, roleLabel, children }: Props) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDrawer(false)
    setMenu(false)
  }, [pathname])

  // Escape closes the drawer and the profile menu; clicking outside closes the menu.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDrawer(false)
        setMenu(false)
      }
    }
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [])

  // The most specific matching item is active (/approvals/history beats /approvals).
  const all = nav.flatMap((g) => g.items)
  const matches = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'))
  const active = all.filter((n) => matches(n.href)).sort((a, b) => b.href.length - a.href.length)[0]
  const badge = (n: NavItem) => (n.badge ? counts[n.badge] : 0)

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
      <a href="#main" className="skip">Skip to main content</a>
      <aside className="side" aria-label="Main navigation">
        <div className="brand">
          <span className="logo"><Icon name="logo" size={18} /></span>
          <span className="lbl">
            <b>Smart Time &amp; Leave</b>
            <span>{orgName}</span>
          </span>
        </div>
        <nav className="nav">
          {nav.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-h lbl">{g.label}</div>
              {g.items.map((n) => {
                const on = active?.href === n.href
                const b = badge(n)
                return (
                  <Link key={n.href} href={n.href} className={on ? 'active' : ''} title={n.label} aria-current={on ? 'page' : undefined}>
                    <Icon name={n.icon} />
                    <span className="lbl">{n.label}</span>
                    {b > 0 && (
                      <span className="cnt" aria-label={`${b} pending`}>
                        {b > 99 ? '99+' : b}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
        <button className="collapse-btn" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} aria-pressed={collapsed}>
          <Icon name="panel" />
          <span className="lbl">Collapse menu</span>
        </button>
      </aside>
      <div className="overlay" onClick={() => setDrawer(false)} aria-hidden="true" />
      <div className="mainwrap">
        <header className="top">
          <button className="icon-btn hamb" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}>
            <Icon name="menu" />
          </button>
          <div className="crumbs">
            <span>{orgName}</span>
            <Icon name="right" size={14} />
            <b>{active?.label ?? ''}</b>
          </div>
          <div className="sp" />
          <Link href="/notifications" className="icon-btn" aria-label={`Notifications${counts.notifications ? `, ${counts.notifications} unread` : ''}`}>
            <Icon name="bell" />
            {counts.notifications > 0 && <span className="dot">{counts.notifications > 99 ? '99+' : counts.notifications}</span>}
          </Link>
          <div className="profile" ref={menuRef}>
            <button className="pbtn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
              <Avatar name={userName} />
              <span className="pmeta">
                <span className="pname">{userName}</span>
                <span className="prole">{roleLabel}</span>
              </span>
            </button>
            {menu && (
              <div className="menu" role="menu">
                <div className="menu-head">
                  <b>{userName}</b>
                  <div className="muted xs">{userEmail}</div>
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
        <main id="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  )
}
