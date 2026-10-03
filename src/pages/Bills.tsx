import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import SalonTabs from '../components/SalonTabs'
import { BackLink, Button, Card, inputCls, Screen, Sheet } from '../components/ui'
import { rpc } from '../lib/api'
import { rupees, shortDate } from '../lib/format'
import { supabase } from '../lib/supabase'

interface BillRow { id: string; bill_no: string; business_date: string; total_payable: number; paid: number; new_due: number; status: 'final' | 'void'; void_reason: string | null; clients: { name: string } | null }

export default function Bills() {
  const qc = useQueryClient()
  const [branch, setBranch] = useState('')
  const [target, setTarget] = useState<BillRow | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const { data } = useQuery({
    queryKey: ['bills', branch],
    queryFn: async () => {
      let q = supabase.from('bills').select('id,bill_no,business_date,total_payable,paid,new_due,status,void_reason,clients(name)').order('created_at', { ascending: false }).limit(100)
      if (branch) q = q.eq('branch_id', branch)
      return (await q).data as unknown as BillRow[]
    },
  })
  const voidIt = useMutation({
    mutationFn: () => rpc('void_bill', { p_bill: target!.id, p_reason: reason }),
    onSuccess: () => { setTarget(null); setReason(''); setError(''); void qc.invalidateQueries({ queryKey: ['bills'] }) },
    onError: (e: Error) => setError(e.message),
  })
  return (
    <Screen title="Bills" back={<BackLink to="/more" />}>
      <SalonTabs value={branch} onChange={setBranch} />
      {data?.map((b) => (
        <Card key={b.id} className={`flex items-center justify-between gap-2 ${b.status === 'void' ? 'opacity-60' : ''}`}>
          <div className="min-w-0">
            <div className="font-medium">{b.bill_no} {b.status === 'void' && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">VOID</span>}</div>
            <div className="truncate text-xs text-gray-500">{shortDate(b.business_date)} · {b.clients?.name}{b.void_reason && ` · ${b.void_reason}`}</div>
          </div>
          <div className="text-right">
            <div className="font-semibold">{rupees(b.total_payable)}</div>
            {b.status === 'final' && <button className="py-1 text-sm text-red-600" onClick={() => { setTarget(b); setReason(''); setError('') }}>Void</button>}
          </div>
        </Card>
      ))}
      <Sheet open={!!target} onClose={() => setTarget(null)} title={`Void ${target?.bill_no ?? ''}?`}>
        <p className="mb-3 text-sm text-gray-600">Paid money is refunded in the day's cash, the client's due goes back to what it was, and any products return to stock. The bill number stays on record.</p>
        <input className={inputCls} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <Button className="mt-4 bg-red-600" disabled={!reason.trim() || voidIt.isPending} onClick={() => voidIt.mutate()}>Void bill</Button>
      </Sheet>
    </Screen>
  )
}
