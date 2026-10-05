import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { GhostButton, Screen } from '../components/ui'

const Chevron = () => (
  <svg viewBox="0 0 20 20" className="size-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
  </svg>
)

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</h2>
      <div className="overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">{children}</div>
    </section>
  )
}
const Row = ({ to, label }: { to: string; label: string }) => (
  <Link to={to} className="flex min-h-14 items-center justify-between border-b px-4 text-base last:border-b-0 active:bg-gray-50">
    <span>{label}</span><Chevron />
  </Link>
)

export default function More() {
  const { isManager, isAdmin, signOut } = useAuth()
  return (
    <Screen title="More">
      <Group title="My work">
        <Row to="/clients" label="Clients" />
        <Row to="/expense" label="Expenses" />
        <Row to="/advance" label="Salary advance" />
        <Row to="/close-day" label="Close day" />
        <Row to="/attendance/me" label="My attendance" />
        <Row to="/payslips" label="My payslips" />
      </Group>
      {isManager && (
        <Group title="Manager">
          <Row to="/dashboard" label="Dashboard" />
          <Row to="/flags" label="Flags" />
          <Row to="/reports" label="Reports" />
          <Row to="/attendance" label="Attendance (all staff)" />
          <Row to="/services" label="Services and prices" />
          <Row to="/products" label="Products" />
          <Row to="/stock" label="Stock" />
          <Row to="/bills" label="Bills (void)" />
          <Row to="/staff" label="Staff" />
        </Group>
      )}
      {isAdmin && (
        <Group title="Admin">
          <Row to="/payroll" label="Payroll" />
          <Row to="/salons" label="Salons" />
          <Row to="/settings" label="Settings" />
        </Group>
      )}
      <GhostButton onClick={signOut} className="w-full text-red-600">Sign out</GhostButton>
    </Screen>
  )
}
