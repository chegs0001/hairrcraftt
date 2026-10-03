import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import ClientCard from '../components/ClientCard'
import { BackLink, Button, Card, inputCls, Screen } from '../components/ui'
import { rpc } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rupees, shortDate, toPaise } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Client } from '../lib/types'

interface LedgerRow { id: string; created_at: string; type: string; amount: number; reason: string | null }

export default function ClientPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { isManager } = useAuth()
  const client = useQuery({
    queryKey: ['client', id],
    queryFn: async () => (await supabase.from('clients').select('*').eq('id', id!).single()).data as Client,
  })
  const ledger = useQuery({
    queryKey: ['ledger', id],
    queryFn: async () => (await supabase.from('client_ledger').select('id,created_at,type,amount,reason').eq('client_id', id!).order('created_at', { ascending: false }).limit(30)).data as LedgerRow[],
  })
  const [cash, setCash] = useState('')
  const [upi, setUpi] = useState('')
  const [adj, setAdj] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [primeEnd, setPrimeEnd] = useState('')
  const [msg, setMsg] = useState('')
  const [editName, setEditName] = useState<string | null>(null)
  const [editBday, setEditBday] = useState<string | null>(null)
  const saveDetails = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {}
      if (editName !== null) patch.name = editName.trim()
      if (editBday !== null) patch.birthday = editBday || null
      const { error } = await supabase.from('clients').update(patch).eq('id', id!)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { setEditName(null); setEditBday(null); setMsg('Details saved'); void qc.invalidateQueries({ queryKey: ['client', id] }); void qc.invalidateQueries({ queryKey: ['client-search'] }) },
    onError: (e: Error) => setMsg(e.message),
  })

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['ledger', id] }); void qc.invalidateQueries({ queryKey: ['client-card'] }) }
  const collect = useMutation({
    mutationFn: () => rpc('collect_dues', { p_client: id, p_cash: toPaise(Number(cash || 0)), p_upi: toPaise(Number(upi || 0)) }),
    onSuccess: () => { setCash(''); setUpi(''); setMsg('Payment recorded'); refresh() },
    onError: (e: Error) => setMsg(e.message),
  })
  const adjust = useMutation({
    mutationFn: () => rpc('adjust_due', { p_client: id, p_amount: toPaise(Number(adj)), p_reason: adjReason }),
    onSuccess: () => { setAdj(''); setAdjReason(''); setMsg('Adjustment saved'); refresh() },
    onError: (e: Error) => setMsg(e.message),
  })
  const addPrime = useMutation({
    mutationFn: async () => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const { error } = await supabase.from('memberships').insert({ client_id: id, start_date: today, end_date: primeEnd, source: 'manual' })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { setPrimeEnd(''); setMsg('Prime added'); refresh() },
    onError: (e: Error) => setMsg(e.message),
  })

  if (!client.data) return <Screen title="Client" back={<BackLink to="/" />}>{null}</Screen>
  return (
    <Screen title={client.data.name} back={<BackLink to="/" />}>
      <ClientCard client={client.data} />
      <Card className="space-y-3">
        <div className="font-semibold">Details</div>
        <label className="block text-sm">Name
          <input className={inputCls} value={editName ?? client.data.name} onChange={(e) => setEditName(e.target.value)} />
        </label>
        <label className="block text-sm">Birthday (optional): 20% off services on this day
          <input className={inputCls} type="date" value={editBday ?? client.data.birthday ?? ''} onChange={(e) => setEditBday(e.target.value)} />
        </label>
        {(editName !== null || editBday !== null) && <Button disabled={editName !== null && !editName.trim()} onClick={() => saveDetails.mutate()}>Save details</Button>}
      </Card>
      <Card className="space-y-3">
        <div className="font-semibold">Collect dues</div>
        <div className="grid grid-cols-2 gap-3">
          <input className={inputCls} inputMode="numeric" placeholder="Cash ₹" value={cash} onChange={(e) => setCash(e.target.value.replace(/\D/g, ''))} />
          <input className={inputCls} inputMode="numeric" placeholder="GPay ₹" value={upi} onChange={(e) => setUpi(e.target.value.replace(/\D/g, ''))} />
        </div>
        <Button disabled={collect.isPending || !(Number(cash) || Number(upi))} onClick={() => confirm(`Collect ${rupees(toPaise(Number(cash || 0) + Number(upi || 0)))}?`) && collect.mutate()}>Collect</Button>
      </Card>
      {isManager && (
        <Card className="space-y-3">
          <div className="font-semibold">Manager</div>
          <div className="grid grid-cols-2 gap-3">
            <input className={inputCls} inputMode="numeric" placeholder="Adjust ₹ (− to reduce due)" value={adj} onChange={(e) => setAdj(e.target.value.replace(/[^\d-]/g, ''))} />
            <input className={inputCls} placeholder="Reason" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
          </div>
          <Button disabled={!adj || !adjReason.trim()} onClick={() => adjust.mutate()}>Adjust due</Button>
          <div className="text-sm text-gray-500">Add existing Prime member (valid from today)</div>
          <input className={inputCls} type="date" value={primeEnd} onChange={(e) => setPrimeEnd(e.target.value)} />
          <Button disabled={!primeEnd} onClick={() => addPrime.mutate()}>Add Prime until this date</Button>
        </Card>
      )}
      {msg && <p className="text-sm text-gray-700">{msg}</p>}
      <div>
        <h2 className="mb-2 font-semibold">Dues ledger</h2>
        {ledger.data?.map((r) => (
          <div key={r.id} className="flex justify-between border-b py-2 text-sm">
            <span>{shortDate(r.created_at)} · {r.reason ?? r.type}</span>
            <span className={r.amount > 0 ? 'text-red-600' : 'text-green-700'}>{r.amount > 0 ? '+' : '−'}{rupees(Math.abs(r.amount))}</span>
          </div>
        ))}
      </div>
    </Screen>
  )
}
