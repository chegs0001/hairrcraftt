import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { BackLink, Button, Card, Screen } from '../components/ui'
import { useAuth } from '../lib/auth'
import { rupees, shortDate } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { PayrollLine } from '../lib/types'

type Full = PayrollLine & { payroll_runs: { month: string; branches: { name: string } | null } | null; staff: { name: string } | null }

export default function Payslip() {
  const { id } = useParams()
  const { isManager } = useAuth()
  const { data: l } = useQuery({
    queryKey: ['payslip', id],
    queryFn: async () => (await supabase.from('payroll_lines').select('*,staff:staff_id(name),payroll_runs(month,branches:branch_id(name))').eq('id', id!).single()).data as unknown as Full,
  })
  if (!l) return <Screen title="Payslip" back={<BackLink to={isManager ? '/payroll' : '/payslips'} />}>{null}</Screen>

  const month = l.payroll_runs ? new Date(l.payroll_runs.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : ''
  const rows: [string, string][] = [
    ['Monthly salary', rupees(l.salary)],
    ['Working days / day rate', `${l.expected_days} / ${rupees(l.day_rate)}`],
    ['Present / absent / half', `${l.present_days} / ${l.absent_days} / ${l.half_days}`],
    ['Extra days / leave', `${l.extra_days} / ${l.leave_days}`],
    ['Absent and half-day deduction', `− ${rupees(l.absent_deduction)}`],
    ['Extra-day pay', `+ ${rupees(l.extra_pay)}`],
    [`Short time (${l.short_minutes} min)`, `− ${rupees(l.short_deduction)}`],
    ['Base pay', rupees(l.base_pay)],
    [`Credit ${rupees(l.credit)} vs target ${rupees(l.target)}`, ''],
    ['Incentive', `+ ${rupees(l.incentive)}`],
    ['Advances this month', `− ${rupees(l.advances)}`],
    ['Advance carried from last month', `− ${rupees(l.carry_in)}`],
    ...(l.makeup_days > 0 ? ([['Absence days still to cover', `${l.makeup_days}`]] as [string, string][]) : []),
  ]

  // Draw the payslip to a canvas so it can be shared as an image (WhatsApp etc.)
  const share = async () => {
    const W = 720, pad = 36, rowH = 44, H = pad * 2 + 150 + rows.length * rowH + 120
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#6d28d9'; g.font = 'bold 34px sans-serif'; g.fillText('HairrCraftt', pad, pad + 34)
    g.fillStyle = '#111827'; g.font = '24px sans-serif'
    g.fillText(`${l.staff?.name ?? ''} · Payslip ${month}`, pad, pad + 78)
    g.fillStyle = '#6b7280'; g.font = '20px sans-serif'; g.fillText(l.payroll_runs?.branches?.name ?? '', pad, pad + 108)
    let y = pad + 150
    rows.forEach(([a, b]) => {
      g.fillStyle = '#374151'; g.font = '22px sans-serif'; g.fillText(a, pad, y)
      g.textAlign = 'right'; g.fillStyle = '#111827'; g.fillText(b, W - pad, y); g.textAlign = 'left'
      g.strokeStyle = '#e5e7eb'; g.beginPath(); g.moveTo(pad, y + 14); g.lineTo(W - pad, y + 14); g.stroke()
      y += rowH
    })
    g.fillStyle = '#111827'; g.font = 'bold 30px sans-serif'; g.fillText('Net pay', pad, y + 40)
    g.textAlign = 'right'; g.fillText(rupees(l.net_pay), W - pad, y + 40); g.textAlign = 'left'
    if (l.paid_at) { g.fillStyle = '#15803d'; g.font = '20px sans-serif'; g.fillText(`Paid ${shortDate(l.paid_at)} · ${l.paid_mode === 'upi' ? 'GPay' : 'Cash'}`, pad, y + 80) }
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'))
    const file = new File([blob], `payslip-${month.replace(' ', '-')}.png`, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Payslip' }).catch(() => {}) }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click() }
  }

  return (
    <Screen title={`Payslip · ${month}`} back={<BackLink to={isManager ? '/payroll' : '/payslips'} />}>
      <Card className="space-y-1">
        <div className="font-semibold">{l.staff?.name}</div>
        <div className="text-sm text-gray-500">{l.payroll_runs?.branches?.name}</div>
      </Card>
      <Card className="space-y-2 text-sm">
        {rows.map(([a, b]) => <div key={a} className="flex justify-between gap-3"><span className="text-gray-600">{a}</span><span>{b}</span></div>)}
        <div className="flex justify-between border-t pt-3 text-xl font-bold"><span>Net pay</span><span>{rupees(l.net_pay)}</span></div>
        {l.carry_out > 0 && <p className="text-sm text-red-600">{rupees(l.carry_out)} of advance carries to next month.</p>}
        {l.paid_at && <p className="text-sm text-green-700">Paid {shortDate(l.paid_at)} · {l.paid_mode === 'upi' ? 'GPay' : 'Cash'}</p>}
      </Card>
      <Button onClick={share}>Share as image</Button>
    </Screen>
  )
}
