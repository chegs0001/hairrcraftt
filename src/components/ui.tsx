import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function Button({ className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`min-h-12 w-full rounded-xl bg-violet-600 px-4 text-base font-semibold text-white shadow-sm transition-colors active:bg-violet-700 disabled:opacity-50 ${className}`}
    />
  )
}

export function GhostButton({ className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`min-h-12 rounded-xl border border-gray-300 bg-white px-4 text-base font-medium leading-tight text-gray-800 transition-colors active:bg-gray-100 disabled:opacity-50 ${className}`}
    />
  )
}

export function Screen({ title, children, back }: { title: string; children: ReactNode; back?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-1 border-b bg-white/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
        {back}
        <h1 className="truncate text-lg font-bold tracking-tight">{title}</h1>
      </header>
      <main className="flex-1 space-y-4 p-4 pb-32">{children}</main>
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}>{children}</div>
}

export const inputCls = 'min-h-12 w-full rounded-xl border border-gray-300 px-3 text-base'

export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-6px_16px_rgba(16,24,40,0.05)]">
      <div className="mx-auto flex max-w-xl gap-2">{children}</div>
    </div>
  )
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onClose}>
      <div className="mx-auto max-h-[90%] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-gray-200" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="truncate text-lg font-bold tracking-tight">{title}</h2>
          <button className="-mr-2 rounded-full px-3 py-2 text-sm font-medium text-gray-500 active:bg-gray-100" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const Chevron = () => (
  <svg viewBox="0 0 20 20" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
  </svg>
)
const backCls = '-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-gray-700 active:bg-gray-100'

// In-app navigation (no page reload)
export function BackLink({ to }: { to: string }) {
  return <Link to={to} aria-label="Back" className={backCls}><Chevron /></Link>
}
export function BackButton({ onClick }: { onClick: () => void }) {
  return <button aria-label="Back" className={backCls} onClick={onClick}><Chevron /></button>
}
