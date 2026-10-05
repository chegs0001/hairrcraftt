import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ActionBar, BackLink, Button, Card, inputCls, Screen, Sheet } from '../components/ui'
import { rpc, useBranches } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rupees, toPaise } from '../lib/format'

interface Summary {
  branch_id: string; business_date: string; opening: number; cash_bills: number; cash_dues: number; float_added: number
  cash_expenses: number; cash_advances: number; owner_taken: number; expected: number; upi_expected: number
  open_visits: number; closed: boolean
}

export default function CloseDay() {
  const qc = useQueryClient()
  const { staff, isManager, isAdmin } = useAuth()
  const branches = useBranches()
  const [branch, setBranch] = useState(staff?.branch_id ?? '')
  const [countedIn, setCountedIn] = useState('')
  const [verified, setVerified] = useState(false)
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [moveType, setMoveType] = useState<'owner_withdrawal' | 'float_added'>('owner_withdrawal')
  const [moveAmt, setMoveAmt] = useState('')

  const sum = useQuery({
    queryKey: ['day-summary', branch],
    enabled: !!branch,
    queryFn: async () => (await rpc<Summary[]>('day_summary', { p_branch: branch }))[0],
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['day-summary'] })

  const counted = Number(countedIn || 0)
  const s = sum.data
  const diff = s ? toPaise(counted) - s.expected : 0

  const close = useMutation({
    mutationFn: () => rpc('close_day', {
      p_counted: toPaise(counted), p_note: note || null, p_branch: branch,
    }),
    onSuccess: () => { setConfirming(false); void refresh() },
    onError: (e: Error) => { setError(e.message); setConfirming(false) },
  })
  const move = useMutation({
    mutationFn: () => rpc('add_cash_movement', { p_type: moveType, p_amount: toPaise(Number(moveAmt)), p_branch: branch }),
    onSuccess: () => { setMoveAmt(''); void refresh() },
    onError: (e: Error) => setError(e.message),
  })
  const reopen = useMutation({
    mutationFn: () => rpc('reopen_day', { p_branch: branch, p_date: s!.business_date, p_reason: prompt('Reason for reopening this day') ?? '' }),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  })

  const line = (l: string, v: number, sign = '') => (
    <div className="flex justify-between"><span>{l}</span><span>{sign}{rupees(v)}</span></div>
  )

  return (
    <Screen title="Close day" back={<BackLink to="/more" />}>
      {isManager && (
        <select className={inputCls} value={branch} onChange={(e) => setBranch(e.target.value)}>
          {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
        </select>
      )}
      {s && (
        <>
          <Card className="space-y-1 text-sm">
            {line('Opening cash', s.opening)}
            {line('+ Cash from bills', s.cash_bills)}
            {line('+ Cash dues collected', s.cash_dues)}
            {line('+ Float added', s.float_added)}
            {line('− Cash expenses', s.cash_expenses)}
            {line('− Cash advances', s.cash_advances)}
            {line('− Cash taken by owner', s.owner_taken)}
            <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Expected cash</span><span>{rupees(s.expected)}</span></div>
            <div className="flex justify-between text-gray-600"><span>Expected GPay today</span><span>{rupees(s.upi_expected)}</span></div>
          </Card>

          {isAdmin && !s.closed && (
            <Card className="space-y-2">
              <div className="font-semibold">Owner cash</div>
              <div className="grid gap-2">
                <select className={inputCls} value={moveType} onChange={(e) => setMoveType(e.target.value as typeof moveType)}>
                  <option value="owner_withdrawal">Cash taken by owner</option><option value="float_added">Float added</option>
                </select>
                <input className={inputCls} inputMode="numeric" placeholder="₹" value={moveAmt} onChange={(e) => setMoveAmt(e.target.value.replace(/\D/g, ''))} />
              </div>
              <Button disabled={!Number(moveAmt)} onClick={() => move.mutate()}>Record</Button>
            </Card>
          )}

          {s.closed ? (
            <Card className="space-y-2">
              <div className="font-semibold text-green-700">Day closed</div>
              {isManager && <Button className="bg-gray-900" onClick={() => reopen.mutate()}>Reopen day</Button>}
            </Card>
          ) : (
            <>
              {s.open_visits > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{s.open_visits} visit(s) still open. Bill or cancel them first.</p>}
              <Card className="space-y-2">
                <div className="font-semibold">Cash in the drawer</div>
                <label className="block text-sm">Counted cash (₹)
                  <input className={`${inputCls} text-2xl`} inputMode="numeric" value={countedIn} onChange={(e) => setCountedIn(e.target.value.replace(/\D/g, ''))} />
                </label>
                <div className={`text-lg font-bold ${diff === 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {diff === 0 ? 'Matches' : diff < 0 ? `Short ${rupees(-diff)}` : `Extra ${rupees(diff)}`}
                </div>
                {diff !== 0 && <input className={inputCls} placeholder="Note explaining the difference (required)" value={note} onChange={(e) => setNote(e.target.value)} />}
              </Card>
            </>
          )}
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {s && !s.closed && (
        <ActionBar>
          <Button disabled={countedIn === '' || s.open_visits > 0 || (diff !== 0 && !note.trim())} onClick={() => { setError(''); setVerified(false); setConfirming(true) }}>Close day</Button>
        </ActionBar>
      )}
      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Close the day?">
        <div className="space-y-1 text-center">
          <div className="text-sm text-gray-500">Counted cash</div>
          <div className="text-4xl font-extrabold">{rupees(toPaise(counted))}</div>
          <div className={diff === 0 ? 'text-green-700' : 'font-semibold text-red-600'}>{diff === 0 ? 'Matches the system' : diff < 0 ? `Short ${rupees(-diff)}` : `Extra ${rupees(diff)}`}</div>
          <p className="pt-2 text-sm text-gray-500">No more bills, expenses or advances can be added to today after closing.</p>
        </div>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-6 shrink-0" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
          I have counted the cash in the drawer and {rupees(toPaise(counted))} is correct.
        </label>
        <Button className="mt-5" disabled={close.isPending || !verified} onClick={() => close.mutate()}>Confirm and close day</Button>
      </Sheet>
    </Screen>
  )
}
