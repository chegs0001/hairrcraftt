import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ActionBar, BackLink, Button, Card, inputCls, Screen, Sheet } from '../components/ui'
import { rpc, useTeam } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rupees, shortDate, toPaise } from '../lib/format'
import { supabase } from '../lib/supabase'

interface Row { id: string; staff_id: string; business_date: string; amount: number; paid_from: string; note: string | null }

export default function Advance() {
  const qc = useQueryClient()
  const { staff, isManager } = useAuth()
  const team = useTeam()
  const [who, setWho] = useState(staff?.id ?? '')
  const [amount, setAmount] = useState('')
  const [paidFrom, setPaidFrom] = useState('drawer')
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  const monthStart = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 8) + '01'
  const list = useQuery({
    queryKey: ['advances', monthStart],
    queryFn: async () =>
      (await supabase.from('salary_advances').select('*').gte('business_date', monthStart).eq('status', 'active').order('created_at', { ascending: false })).data as Row[],
  })
  const nameOf = (id: string) => team.data?.find((t) => t.id === id)?.name || 'Staff'

  const save = useMutation({
    mutationFn: () => rpc('add_advance', { p_staff: isManager ? who : staff!.id, p_amount: toPaise(Number(amount)), p_paid_from: paidFrom, p_note: note || null }),
    onSuccess: () => { setAmount(''); setNote(''); setConfirming(false); void qc.invalidateQueries({ queryKey: ['advances'] }) },
    onError: (e: Error) => { setError(e.message); setConfirming(false) },
  })

  return (
    <Screen title="Salary advance" back={<BackLink to="/more" />}>
      {isManager ? (
        <label className="block text-sm">Staff
          <select className={inputCls} value={who} onChange={(e) => setWho(e.target.value)}>
            {team.data?.map((t) => <option key={t.id} value={t.id}>{t.name || t.email}</option>)}
          </select>
        </label>
      ) : <p className="text-sm text-gray-600">Advance for {staff?.name || 'you'}</p>}
      <label className="block text-sm">Amount (₹)
        <input className={`${inputCls} text-2xl`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
      </label>
      <label className="block text-sm">Paid from
        <select className={inputCls} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>
          <option value="drawer">Drawer cash</option><option value="owner">Owner</option><option value="upi">GPay</option>
        </select>
      </label>
      <label className="block text-sm">Note
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ActionBar><Button disabled={!Number(amount)} onClick={() => { setError(''); setConfirming(true) }}>Save advance</Button></ActionBar>

      <div>
        <h2 className="mb-2 font-semibold">This month</h2>
        {list.data?.map((r) => (
          <Card key={r.id} className="mb-2 flex justify-between">
            <div><div className="font-medium">{nameOf(r.staff_id)}</div><div className="text-sm text-gray-500">{shortDate(r.business_date)} · {r.paid_from}{r.note && ` · ${r.note}`}</div></div>
            <div className="font-semibold">{rupees(r.amount)}</div>
          </Card>
        ))}
      </div>

      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Confirm advance">
        <div className="space-y-1 text-center">
          <div className="text-4xl font-extrabold">{rupees(toPaise(Number(amount || 0)))}</div>
          <div className="text-gray-600">to {isManager ? nameOf(who) : 'you'} · {paidFrom === 'drawer' ? 'from drawer cash' : paidFrom === 'upi' ? 'by GPay' : 'paid by owner'}</div>
        </div>
        <Button className="mt-5" disabled={save.isPending} onClick={() => save.mutate()}>Confirm</Button>
      </Sheet>
    </Screen>
  )
}
