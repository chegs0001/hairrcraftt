import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { BackLink, Screen } from '../components/ui'
import { rpc } from '../lib/api'
import { STATUS, timeOf, type GridRow } from '../lib/attendance'
import { shortDate } from '../lib/format'

export default function MyAttendance() {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const from = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-01`
  const to = new Date(ym.y, ym.m + 1, 0).toLocaleDateString('en-CA')
  const { data } = useQuery({
    queryKey: ['my-grid', from],
    queryFn: () => rpc<GridRow[]>('attendance_grid', { p_from: from, p_to: to }),
  })
  const count = (s: string) => data?.filter((r) => r.status === s).length ?? 0
  const shift = (d: number) => setYm(({ y, m }) => { const n = new Date(y, m + d, 1); return { y: n.getFullYear(), m: n.getMonth() } })

  return (
    <Screen title="My attendance" back={<BackLink to="/more" />}>
      <div className="flex items-center justify-between">
        <button className="px-4 py-3 text-xl" onClick={() => shift(-1)}>‹</button>
        <div className="font-semibold">{new Date(ym.y, ym.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
        <button className="px-4 py-3 text-xl" onClick={() => shift(1)}>›</button>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center text-sm">
        {[['Present', count('present') + count('present_short')], ['Absent', count('absent')], ['Half', count('half_day')], ['Extra', count('extra_day') + count('extra_half')]].map(([l, n]) => (
          <div key={l} className="rounded-xl border p-2"><div className="text-lg font-bold">{n}</div><div className="text-xs text-gray-500">{l}</div></div>
        ))}
      </div>
      {data?.map((r) => {
        const st = STATUS[r.status] ?? { label: r.status, cls: 'bg-gray-100' }
        return (
          <div key={r.date} className="flex items-center justify-between border-b py-2 text-sm">
            <div>
              <div className="font-medium">{shortDate(r.date)}</div>
              <div className="text-xs text-gray-500">{r.in_at ? `${timeOf(r.in_at)} – ${timeOf(r.out_at)}` : ''}{r.short_minutes > 0 && ` · short ${r.short_minutes} min`}</div>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${st.cls}`}>{st.label}</span>
          </div>
        )
      })}
    </Screen>
  )
}
