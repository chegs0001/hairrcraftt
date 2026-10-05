import { NavLink, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
)
const TABS = [
  { to: '/', label: 'Home', end: true, icon: icon(<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />) },
  { to: '/visits', label: 'Visits', icon: icon(<><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>) },
  { to: '/more', label: 'More', icon: icon(<><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>) },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const showTabs = TABS.some((t) => t.to === pathname)
  return (
    <>
      {children}
      {showTabs && (
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto flex max-w-xl">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-semibold ${isActive ? 'text-violet-700' : 'text-gray-500'}`}>
                {t.icon}
                {t.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </>
  )
}
