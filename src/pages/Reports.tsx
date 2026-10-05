import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import SalonTabs from '../components/SalonTabs'
import { BackLink, Button, inputCls, Screen } from '../components/ui'
import { rpc } from '../lib/api'
import { useAuth } from '../lib/auth'
import { downloadCsv } from '../lib/csv'
import { whatsappLink } from '../lib/receipt'

const REPORTS: [string, string][] = [
  ['sales', 'Sales'], ['staff_performance', 'Staff performance'], ['discounts', 'Discounts and flags'], ['dues', 'Dues'],
  ['prime', 'Prime members'], ['expenses', 'Expenses'], ['cash_closings', 'Cash closings'], ['attendance', 'Attendance'], ['audit', 'Audit log'],
]
const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

export default function Reports() {
  const { isAdmin } = useAuth()
  const [name, setName] = useState('sales')
  const [branch, setBranch] = useState('')
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000)))
  const [to, setTo] = useState(iso(new Date()))
  const [run, setRun] = useState(0)

  const { data, isFetching, error } = useQuery({
    queryKey: ['report', name, branch, from, to, run],
    queryFn: () => rpc<Record<string, unknown>[]>('report', { p_name: name, p_from: from, p_to: to, p_branch: branch || null }),
  })
  const cols = data && data.length ? Object.keys(data[0]) : []
  const fmt = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

  return (
    <Screen title="Reports" back={<BackLink to="/dashboard" />}>
      <select className={inputCls} value={name} onChange={(e) => setName(e.target.value)}>
        {REPORTS.filter(([k]) => isAdmin || k !== 'audit').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <SalonTabs value={branch} onChange={setBranch} />
      {!['dues', 'prime'].includes(name) && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-gray-500">From<input className={inputCls} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="block text-xs text-gray-500">To<input className={inputCls} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={() => setRun(run + 1)} disabled={isFetching}>{isFetching ? 'Loading…' : 'Refresh'}</Button>
        <Button className="bg-gray-900" disabled={!data?.length} onClick={() => downloadCsv(`${name}-${from}-to-${to}`, data!)}>Export CSV</Button>
      </div>
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      {data && <p className="text-sm text-gray-500">{data.length} rows{data.length >= 2000 ? ' (first 2,000)' : ''}</p>}
      {data && data.length > 0 && (
        <div className="-mx-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-gray-50"><tr>{cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-semibold">{c.replace(/_/g, ' ')}</th>)}{name === 'dues' && <th className="px-3 py-2">remind</th>}</tr></thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className="border-t">
                  {cols.map((c) => <td key={c} className="max-w-[16rem] truncate px-3 py-2" title={fmt(r[c])}>{fmt(r[c])}</td>)}
                  {name === 'dues' && <td className="px-3 py-2"><a className="text-green-700 underline" target="_blank" rel="noreferrer"
                    href={whatsappLink(String(r.phone), `Hello ${r.client}, a gentle reminder: ₹${r.due} is pending at HairrCraftt. Thank you!`)}>WhatsApp</a></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  )
}
