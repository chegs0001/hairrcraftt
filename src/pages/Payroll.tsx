import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import SalonTabs from '../components/SalonTabs'
import { BackLink, Button, Card, GhostButton, inputCls, Screen, Sheet } from '../components/ui'
import { rpc } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rupees, shortDate } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { PayrollLine, PayrollRun, Staff } from '../lib/types'

type Line = PayrollLine & { staff: { name: string } | null }

export default function Payroll() {
  const qc = useQueryClient()
  const { staff } = useAuth()
  const [branch, setBranch] = useState(staff?.branch_id ?? '')
  const [month, setMonth] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7))
  const [error, setError] = useState('')
  const first = `${month}-01`

  const data = useQuery({
    queryKey: ['payroll', branch, first],
    enabled: !!branch,
    queryFn: async () => {
      const runs = (await supabase.from('payroll_runs').select('*').eq('branch_id', branch)
        .or(`month.eq.${first},status.eq.draft`).order('created_at')).data as PayrollRun[]
      const ids = runs.map((r) => r.id)
      const lines = ids.length
        ? ((await supabase.from('payroll_lines').select('*,staff:staff_id(name)').in('run_id', ids).eq('void', false)).data as unknown as Line[])
        : []
      return { runs, lines }
    },
  })
  const leaving = useQuery({
    queryKey: ['leaving', branch],
    enabled: !!branch,
    queryFn: async () => (await supabase.from('staff').select('*').eq('branch_id', branch).not('last_working_on', 'is', null)).data as Staff[],
  })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['payroll'] }); void qc.invalidateQueries({ queryKey: ['leaving'] }) }
  const run = useMutation({ mutationFn: () => rpc('run_payroll', { p_branch: branch, p_month: first }), onSuccess: () => { setError(''); refresh() }, onError: (e: Error) => setError(e.message) })
  const settle = useMutation({ mutationFn: (id: string) => rpc('settle_exit', { p_staff: id, p_through: null }), onSuccess: () => { setError(''); refresh() }, onError: (e: Error) => setError(e.message) })

  const runs = data.data?.runs ?? []
  const monthly = runs.find((r) => r.kind === 'monthly' && r.month === first)
  const exits = runs.filter((r) => r.kind === 'exit')
  const settledIds = new Set(exits.map((r) => r.staff_id))

  return (
    <Screen title="Payroll" back={<BackLink to="/more" />}>
      <SalonTabs value={branch} onChange={setBranch} allowAll={false} />
      <input className={inputCls} type="month" value={month} max={new Date().toISOString().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
      {error && <p className="text-sm text-red-600">{error}</p>}

      {(leaving.data ?? []).filter((s) => !settledIds.has(s.id)).map((s) => (
        <Card key={s.id} className="flex items-center justify-between gap-2 border-amber-300">
          <div className="min-w-0"><div className="font-medium">{s.name || s.email}</div><div className="text-xs text-gray-500">Last working day {shortDate(s.last_working_on!)}</div></div>
          <GhostButton className="shrink-0" disabled={settle.isPending} onClick={() => settle.mutate(s.id)}>Settle pay</GhostButton>
        </Card>
      ))}

      <h2 className="pt-2 font-semibold">Monthly payroll</h2>
      {monthly?.status === 'final' ? null : <Button disabled={run.isPending || !branch} onClick={() => run.mutate()}>{monthly ? 'Recalculate draft' : 'Run payroll'}</Button>}
      {monthly && <RunBlock run={monthly} lines={(data.data?.lines ?? []).filter((l) => l.run_id === monthly.id)} onChange={refresh} setError={setError} />}

      {exits.map((r) => (
        <div key={r.id} className="space-y-3 pt-2">
          <h2 className="font-semibold">Exit settlement · {(data.data?.lines ?? []).find((l) => l.run_id === r.id)?.staff?.name}</h2>
          <RunBlock run={r} lines={(data.data?.lines ?? []).filter((l) => l.run_id === r.id)} onChange={refresh} setError={setError} />
        </div>
      ))}
    </Screen>
  )
}

function RunBlock({ run, lines, onChange, setError }: { run: PayrollRun; lines: Line[]; onChange: () => void; setError: (m: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const fail = (e: Error) => { setError(e.message); setConfirming(false) }
  const finalize = useMutation({ mutationFn: () => rpc('finalize_payroll', { p_run: run.id }), onSuccess: () => { setConfirming(false); onChange() }, onError: fail })
  const pay = useMutation({ mutationFn: ({ id, mode }: { id: string; mode: string }) => rpc('mark_payslip_paid', { p_line: id, p_mode: mode }), onSuccess: onChange, onError: fail })
  const total = lines.reduce((n, l) => n + l.net_pay, 0)

  return (
    <div className="space-y-3">
      {run.status === 'final'
        ? <p className="rounded-xl bg-green-50 p-3 text-sm font-medium text-green-800">Final and locked. Payslips are visible to staff.</p>
        : <p className="text-sm text-gray-600">Draft · {lines.length} staff · total net pay <b>{rupees(total)}</b></p>}
      {lines.map((l) => (
        <Card key={l.id} className="space-y-2">
          <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(open === l.id ? null : l.id)}>
            <div><div className="font-semibold">{l.staff?.name || 'Staff'}</div><div className="text-xs text-gray-500">Salary {rupees(l.salary)} · incentive {rupees(l.incentive)}</div></div>
            <div className="text-right"><div className="text-lg font-bold">{rupees(l.net_pay)}</div>{l.carry_out > 0 && <div className="text-xs text-red-600">owes {rupees(l.carry_out)}</div>}</div>
          </button>
          {open === l.id && (
            <div className="space-y-1 border-t pt-2 text-sm">
              <Row a={`Working days ${l.expected_days} (month ${l.expected_days_full})${l.window_end ? ` · to ${shortDate(l.window_end)}` : ''}`} b={`Day rate ${rupees(l.day_rate)}`} />
              <Row a={`Present ${l.present_days} · Absent ${l.absent_days} · Half ${l.half_days}`} b={`Extra ${l.extra_days} · Leave ${l.leave_days}`} />
              <Row a="Absent / half-day deduction" b={`−${rupees(l.absent_deduction)}`} />
              <Row a="Extra-day pay" b={`+${rupees(l.extra_pay)}`} />
              <Row a={`Short time ${l.short_minutes} min`} b={`−${rupees(l.short_deduction)}`} />
              <Row a="Base pay" b={rupees(l.base_pay)} />
              <Row a={`Credit ${rupees(l.credit)} vs target ${rupees(l.target)} · salon ${rupees(l.salon_sales)}`} b={`+${rupees(l.incentive)}`} />
              <Row a="Advances this month" b={`−${rupees(l.advances)}`} />
              <Row a="Advance carried from last month" b={`−${rupees(l.carry_in)}`} />
              {l.makeup_days > 0 && <Row a="Absence days still to cover" b={`${l.makeup_days} day(s)`} />}
              {run.status === 'final' && (
                <div className="flex flex-wrap items-center gap-2 pt-2">
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
      {run.status === 'draft' && lines.length > 0 && <Button onClick={() => setConfirming(true)}>Finalise {run.kind === 'exit' ? 'settlement' : 'payroll'}</Button>}
      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Finalise and lock?">
        <div className="space-y-1 text-center">
          <div className="text-sm text-gray-500">Total net pay</div>
          <div className="text-4xl font-extrabold">{rupees(total)}</div>
          <p className="pt-2 text-sm text-gray-500">This locks every number and shows payslips to staff. It cannot be undone.</p>
        </div>
        <Button className="mt-5" disabled={finalize.isPending} onClick={() => finalize.mutate()}>Confirm and lock</Button>
      </Sheet>
    </div>
  )
}

const Row = ({ a, b }: { a: string; b: string }) => <div className="flex justify-between gap-3"><span className="text-gray-600">{a}</span><span className="shrink-0">{b}</span></div>
