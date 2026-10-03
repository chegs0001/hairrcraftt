import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import SalonTabs from '../components/SalonTabs'
import { BackLink, Card, Screen } from '../components/ui'
import { rpc } from '../lib/api'
import { STATUS, timeOf } from '../lib/attendance'
import { useAuth } from '../lib/auth'
import { rupees, shortDate } from '../lib/format'

interface Today {
  date: string; services: number; products: number; memberships: number; net_sales: number; bills: number
  clients_new: number; clients_returning: number; cash: number; upi: number; dues_created: number; dues_collected: number
  expenses: number; advances: number; open_visits: number
  cash_status: { branch_id: string; code: string; closed: boolean; expected: number; counted: number | null; difference: number | null; open_visits: number }[]
  staff: { staff_id: string; name: string; status: string | null; in_at: string | null; services: number; credit: number }[]
}
interface Month {
  month: string; days_elapsed: number; days_in_month: number
  branches: { branch_id: string; code: string; name: string; net_sales: number; gate: number; projected: number
    staff: { staff_id: string; name: string; salary: number; credit: number; target: number; incentive: number; present: number; absent: number; half: number; short: number }[] }[]
  daily: { date: string; amount: number }[]
  categories: { category: string; amount: number }[]
  top_services: { name: string; count: number; amount: number }[]
}

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-xl border border-gray-200 p-3">
    <div className="text-xs text-gray-500">{label}</div>
    <div className="text-xl font-bold">{value}</div>
    {sub && <div className="text-xs text-gray-500">{sub}</div>}
  </div>
)

function Progress({ value, max, projected }: { value: number; max: number; projected?: number }) {
  const pct = (n: number) => `${Math.min(100, max > 0 ? (n / max) * 100 : 0)}%`
  return (
    <div className="relative h-3 overflow-hidden rounded-full bg-gray-100">
      {projected !== undefined && <div className="absolute inset-y-0 left-0 rounded-full bg-violet-200" style={{ width: pct(projected) }} />}
      <div className="absolute inset-y-0 left-0 rounded-full bg-violet-600" style={{ width: pct(value) }} />
    </div>
  )
}

function DailyBars({ rows }: { rows: Month['daily'] }) {
  const [table, setTable] = useState(false)
  const max = Math.max(1, ...rows.map((r) => r.amount))
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Daily sales</div>
        <button className="px-2 py-2 text-xs text-violet-700" onClick={() => setTable(!table)}>{table ? 'Show chart' : 'Show table'}</button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-y-auto text-sm">
          {rows.map((r) => <div key={r.date} className="flex justify-between border-b py-1"><span>{shortDate(r.date)}</span><span>{rupees(r.amount)}</span></div>)}
        </div>
      ) : (
        <div className="flex h-40 items-end gap-[2px] border-b border-gray-300">
          {rows.map((r) => (
            <div key={r.date} title={`${shortDate(r.date)}: ${rupees(r.amount)}`} className="flex h-full min-w-0 flex-1 items-end">
              <div className="w-full rounded-t-[4px] bg-violet-600" style={{ height: `${(r.amount / max) * 100}%`, minHeight: r.amount > 0 ? 2 : 0 }} />
            </div>
          ))}
        </div>
      )}
      {!table && rows.length > 0 && <div className="flex justify-between text-xs text-gray-500"><span>{shortDate(rows[0].date)}</span><span>Peak {rupees(max)}</span><span>{shortDate(rows[rows.length - 1].date)}</span></div>}
    </div>
  )
}

export default function Dashboard() {
  const { staff } = useAuth()
  const [branch, setBranch] = useState(staff?.branch_id ?? '')
  const today = useQuery({ queryKey: ['dash-today', branch], refetchInterval: 30_000,
    queryFn: () => rpc<Today>('dashboard_today', { p_branch: branch || null }) })
  const month = useQuery({ queryKey: ['dash-month', branch], refetchInterval: 60_000,
    queryFn: () => rpc<Month>('dashboard_month', { p_branch: branch || null }) })
  const t = today.data
  const m = month.data

  return (
    <Screen title="Dashboard" back={<BackLink to="/" />}>
      <SalonTabs value={branch} onChange={setBranch} />
      <div className="flex gap-3 text-sm"><Link className="py-2 text-violet-700" to="/flags">Flags</Link><Link className="py-2 text-violet-700" to="/reports">Reports</Link></div>

      {t && (
        <>
          <h2 className="font-semibold">Today · {shortDate(t.date)}</h2>
          <Card className="space-y-1">
            <div className="text-sm text-gray-500">Net sales</div>
            <div className="text-3xl font-extrabold">{rupees(t.net_sales)}</div>
            <div className="text-sm text-gray-600">Services {rupees(t.services)} · Products {rupees(t.products)} · Prime {rupees(t.memberships)}</div>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Bills" value={String(t.bills)} sub={`${t.clients_new} new · ${t.clients_returning} returning`} />
            <Stat label="Open visits" value={String(t.open_visits)} />
            <Stat label="Cash" value={rupees(t.cash)} />
            <Stat label="GPay" value={rupees(t.upi)} />
            <Stat label="Dues created" value={rupees(t.dues_created)} />
            <Stat label="Dues collected" value={rupees(t.dues_collected)} />
            <Stat label="Expenses" value={rupees(t.expenses)} />
            <Stat label="Advances" value={rupees(t.advances)} />
          </div>
          <Card className="space-y-2">
            <div className="font-semibold">Cash status</div>
            {t.cash_status.map((c) => (
              <div key={c.branch_id} className="flex items-center justify-between text-sm">
                <span>{c.code} · {c.closed ? 'Closed' : 'Open'}</span>
                <span>
                  {c.closed
                    ? <>Counted {rupees(c.counted ?? 0)} <span className={(c.difference ?? 0) === 0 ? 'text-green-700' : 'text-red-600'}>({(c.difference ?? 0) === 0 ? 'matches' : `${(c.difference ?? 0) > 0 ? '+' : '−'}${rupees(Math.abs(c.difference ?? 0))}`})</span></>
                    : <>Expected {rupees(c.expected)}</>}
                </span>
              </div>
            ))}
          </Card>
          <Card className="space-y-2">
            <div className="font-semibold">Staff today</div>
            {t.staff.map((s) => {
              const st = STATUS[s.status ?? 'pending'] ?? { label: s.status ?? '—', cls: 'bg-gray-100' }
              return (
                <div key={s.staff_id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0"><div className="truncate font-medium">{s.name}</div><div className="text-xs text-gray-500">{s.in_at ? `In ${timeOf(s.in_at)} · ` : ''}{s.services} services · {rupees(s.credit)}</div></div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${st.cls}`}>{st.label}</span>
                </div>
              )
            })}
          </Card>
        </>
      )}

      {m && (
        <>
          <h2 className="pt-2 font-semibold">This month · {new Date(m.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
          {m.branches.map((b) => (
            <Card key={b.branch_id} className="space-y-3">
              <div className="flex items-baseline justify-between"><span className="font-semibold">{b.code} · {b.name}</span><span className="text-sm text-gray-500">Gate {rupees(b.gate)}</span></div>
              <Progress value={b.net_sales} max={Math.max(b.gate, b.projected)} projected={b.projected} />
              <div className="flex justify-between text-sm">
                <span>{rupees(b.net_sales)} so far {b.net_sales >= b.gate ? '✓ gate met' : ''}</span>
                <span className="text-gray-500">Projected {rupees(b.projected)}{b.projected >= b.gate ? '' : ' (below gate)'}</span>
              </div>
              {b.staff.map((s) => (
                <div key={s.staff_id} className="space-y-1 border-t pt-2 text-sm">
                  <div className="flex justify-between"><span className="font-medium">{s.name}</span><span>Incentive now {rupees(s.incentive)}</span></div>
                  <Progress value={s.credit} max={Math.max(s.target, s.credit)} />
                  <div className="flex justify-between text-xs text-gray-500"><span>Credit {rupees(s.credit)} of {rupees(s.target)} target</span><span>P {s.present} · A {s.absent} · ½ {s.half} · short {s.short}</span></div>
                </div>
              ))}
            </Card>
          ))}
          <Card><DailyBars rows={m.daily} /></Card>
          <Card className="space-y-1 text-sm">
            <div className="mb-1 font-semibold">Sales by category</div>
            {m.categories.slice(0, 8).map((c) => <div key={c.category} className="flex justify-between"><span>{c.category}</span><span>{rupees(c.amount)}</span></div>)}
            {m.categories.length === 0 && <p className="text-gray-500">No sales yet this month.</p>}
          </Card>
          <Card className="space-y-1 text-sm">
            <div className="mb-1 font-semibold">Top services</div>
            {m.top_services.map((s) => <div key={s.name} className="flex justify-between"><span>{s.name} <span className="text-gray-400">×{s.count}</span></span><span>{rupees(s.amount)}</span></div>)}
          </Card>
        </>
      )}
    </Screen>
  )
}
