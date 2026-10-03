import { NavLink, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

const TABS = [
  { to: '/', label: 'Home', end: true },
  { to: '/visits', label: 'Visits' },
  { to: '/more', label: 'More' },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const showTabs = TABS.some((t) => t.to === pathname)
  return (
    <>
      {children}
      {showTabs && (
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-white pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex max-w-xl">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }) => `flex-1 py-4 text-center text-sm font-semibold ${isActive ? 'text-violet-700' : 'text-gray-500'}`}>
                {t.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </>
  )
}
