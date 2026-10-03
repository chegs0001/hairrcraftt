import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Button({ className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`min-h-12 w-full rounded-xl bg-violet-600 px-4 text-base font-semibold text-white active:bg-violet-700 disabled:opacity-50 ${className}`}
    />
  )
}

export function GhostButton({ className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`min-h-12 rounded-xl border border-gray-300 px-4 text-base font-medium text-gray-800 active:bg-gray-100 ${className}`}
    />
  )
}

export function Screen({ title, children, back }: { title: string; children: ReactNode; back?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-white px-4 py-3">
        {back}
        <h1 className="text-lg font-bold">{title}</h1>
      </header>
      <main className="flex-1 space-y-4 p-4 pb-28">{children}</main>
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-gray-200 p-4 ${className}`}>{children}</div>
}

export const inputCls = 'min-h-12 w-full rounded-xl border border-gray-300 px-3 text-base'

export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="px-3 py-2 text-gray-500" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function BackLink({ to }: { to: string }) {
  return <a href={to} className="px-2 py-2 text-xl" aria-label="Back">‹</a>
}
