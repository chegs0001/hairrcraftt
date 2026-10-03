import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import SalonTabs from '../components/SalonTabs'
import { BackLink, Button, Card, GhostButton, inputCls, Screen, Sheet } from '../components/ui'
import { rpc } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rupees, shortDate } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { PayrollLine, PayrollRun } from '../lib/types'

type Line = PayrollLine & { staff: { name: string } | null }

export default function Payroll() {
  const qc = useQueryClient()
  const { staff } = useAuth()
  const [branch, setBranch] = useState(staff?.branch_id ?? '')
  const [month, setMonth] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7))
  const [open, setOpen] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const first = `${month}-01`

  const data = useQuery({
    queryKey: ['payroll', branch, first],
    enabled: !!branch,
    queryFn: async () => {
      const run = (await supabase.from('payroll_runs').select('*').eq('branch_id', branch).eq('month', first).maybeSingle()).data as PayrollRun | null
      if (!run) return { run: null, lines: [] as Line[] }
      const lines = (await supabase.from('payroll_lines').select('*,staff:staff_id(name)').eq('run_id', run.id)).data as unknown as Line[]
      return { run, lines: lines.sort((a, b) => (a.staff?.name ?? '').localeCompare(b.staff?.name ?? '')) }
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['payroll'] })
  const fail = (e: Error) => { setError(e.message); setConfirming(false) }
  const run = useMutation({ mutationFn: () => rpc('run_payroll', { p_branch: branch, p_month: first }), onSuccess: () => { setError(''); void refresh() }, onError: fail })
  const finalize = useMutation({ mutationFn: () => rpc('finalize_payroll', { p_run: data.data!.run!.id }), onSuccess: () => { setConfirming(false); void refresh() }, onError: fail })
  const pay = useMutation({ mutationFn: ({ id, mode }: { id: string; mode: string }) => rpc('mark_payslip_paid', { p_line: id, p_mode: mode }), onSuccess: refresh, onError: fail })

  const r = data.data?.run
  const lines = data.data?.lines ?? []
  const total = lines.reduce((n, l) => n + l.net_pay, 0)

  return (
    <Screen title="Payroll" back={<BackLink to="/more" />}>
      <SalonTabs value={branch} onChange={setBranch} allowAll={false} />
      <input className={inputCls} type="month" value={month} max={new Date().toISOString().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
      {r?.status === 'final'
        ? <p className="rounded-xl bg-green-50 p-3 text-sm font-medium text-green-800">Final and locked. Payslips are visible to staff.</p>
        : <Button disabled={run.isPending || !branch} onClick={() => run.mutate()}>{r ? 'Recalculate draft' : 'Run payroll'}</Button>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {r && <p className="text-sm text-gray-600">{lines.length} staff · total net pay <b>{rupees(total)}</b> · {r.status === 'draft' ? 'Draft: review, then finalise' : 'Final'}</p>}

      {lines.map((l) => (
        <Card key={l.id} className="space-y-2">
          <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(open === l.id ? null : l.id)}>
            <div><div className="font-semibold">{l.staff?.name || 'Staff'}</div><div className="text-xs text-gray-500">Salary {rupees(l.salary)} · incentive {rupees(l.incentive)}</div></div>
            <div className="text-right"><div className="text-lg font-bold">{rupees(l.net_pay)}</div>{l.carry_out > 0 && <div className="text-xs text-red-600">carry {rupees(l.carry_out)}</div>}</div>
          </button>
          {open === l.id && (
            <div className="space-y-1 border-t pt-2 text-sm">
              <Row a={`Working days ${l.expected_days} (month ${l.expected_days_full})`} b={`Day rate ${rupees(l.day_rate)}`} />
              <Row a={`Present ${l.present_days} · Absent ${l.absent_days} · Half ${l.half_days}`} b={`Extra ${l.extra_days} · Leave ${l.leave_days}`} />
              <Row a="Absent / half-day deduction" b={`−${rupees(l.absent_deduction)}`} />
              <Row a="Extra-day pay" b={`+${rupees(l.extra_pay)}`} />
              <Row a={`Short time ${l.short_minutes} min`} b={`−${rupees(l.short_deduction)}`} />
              <Row a="Base pay" b={rupees(l.base_pay)} />
              <Row a={`Credit ${rupees(l.credit)} vs target ${rupees(l.target)} · salon ${rupees(l.salon_sales)}`} b={`+${rupees(l.incentive)}`} />
              <Row a="Advances this month" b={`−${rupees(l.advances)}`} />
              <Row a="Advance carried from last month" b={`−${rupees(l.carry_in)}`} />
              {r?.status === 'final' && (
                <div className="flex items-center gap-2 pt-2">
                  <Link to={`/payslip/${l.id}`} className="flex min-h-10 items-center rounded-xl border px-4 text-sm">Payslip</Link>
                  {l.paid_at ? <span className="text-sm text-green-700">Paid {shortDate(l.paid_at)} · {l.paid_mode === 'upi' ? 'GPay' : 'Cash'}</span> : (
                    <>
                      <GhostButton className="min-h-10 text-sm" onClick={() => confirm(`Mark ${l.staff?.name} paid ${rupees(l.net_pay)} in cash?`) && pay.mutate({ id: l.id, mode: 'cash' })}>Paid cash</GhostButton>
                      <GhostButton className="min-h-10 text-sm" onClick={() => confirm(`Mark ${l.staff?.name} paid ${rupees(l.net_pay)} by GPay?`) && pay.mutate({ id: l.id, mode: 'upi' })}>Paid GPay</GhostButton>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      ))}

      {r?.status === 'draft' && lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-xl"><Button onClick={() => setConfirming(true)}>Finalise payroll</Button></div>
        </div>
      )}
      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Finalise payroll?">
        <div className="space-y-1 text-center">
          <div className="text-sm text-gray-500">Total net pay</div>
          <div className="text-4xl font-extrabold">{rupees(total)}</div>
          <p className="pt-2 text-sm text-gray-500">This locks every number and shows payslips to staff. It cannot be undone.</p>
        </div>
        <Button className="mt-5" disabled={finalize.isPending} onClick={() => finalize.mutate()}>Confirm and lock</Button>
      </Sheet>
    </Screen>
  )
}

const Row = ({ a, b }: { a: string; b: string }) => <div className="flex justify-between gap-3"><span className="text-gray-600">{a}</span><span className="shrink-0">{b}</span></div>
