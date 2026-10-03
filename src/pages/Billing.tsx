import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ActionBar, BackLink, Button, Card, inputCls, Screen, Sheet } from '../components/ui'
import { rpc, useBranches, useCatalogue, useClientCard } from '../lib/api'
import { rupees, toPaise } from '../lib/format'
import { receiptText, whatsappLink } from '../lib/receipt'
import { supabase } from '../lib/supabase'
import type { Bill, Visit, VisitLine } from '../lib/types'

export default function Billing() {
  const { id } = useParams()
  const qc = useQueryClient()
  const cat = useCatalogue()
  const branches = useBranches()

  const { data } = useQuery({
    queryKey: ['visit', id],
    queryFn: async () => {
      const v = await supabase.from('visits').select('*,clients(*)').eq('id', id!).single()
      const l = await supabase.from('visit_lines').select('*,visit_line_staff(staff_id,share)').eq('visit_id', id!).eq('status', 'active').order('created_at')
      if (v.error) throw v.error
      return { visit: v.data as unknown as Visit, lines: (l.data ?? []) as VisitLine[] }
    },
  })
  const card = useClientCard(data?.visit.clients)
  const fee = useQuery({
    queryKey: ['prime-fee'],
    queryFn: async () => Number((await supabase.from('settings').select('value').eq('key', 'prime_fee_paise').single()).data?.value ?? 0),
  })

  const [discMode, setDiscMode] = useState<'amt' | 'pct'>('amt')
  const [discIn, setDiscIn] = useState('')
  const [discReason, setDiscReason] = useState('')
  const [sellPrime, setSellPrime] = useState(false)
  const [cash, setCash] = useState('')
  const [upi, setUpi] = useState('')
  const [upiRef, setUpiRef] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ bill: Bill; lines: VisitLine[] } | null>(null)

  const close = useMutation({
    mutationFn: async () => {
      const bill = await rpc<Bill>('close_bill', {
        p_visit: id, p_cash: toPaise(Number(cash || 0)), p_upi: toPaise(Number(upi || 0)),
        p_discount: discount, p_discount_reason: discount > 0 ? discReason : null,
        p_sell_prime: sellPrime, p_upi_ref: upiRef || null,
      })
      const l = await supabase.from('visit_lines').select('*,visit_line_staff(staff_id,share)').eq('visit_id', id!).eq('status', 'active').order('created_at')
      return { bill, lines: (l.data ?? []) as VisitLine[] }
    },
    onSuccess: (r) => { setDone(r); setConfirming(false); void qc.invalidateQueries({ queryKey: ['open-visits'] }); void qc.invalidateQueries({ queryKey: ['client-card'] }) },
    onError: (e: Error) => { setError(e.message); setConfirming(false) },
  })

  if (!data) return <Screen title="Billing">{null}</Screen>
  const { visit, lines } = data
  const client = visit.clients

  if (done) {
    const salon = branches.data?.find((b) => b.id === visit.branch_id)?.name ?? 'HairrCraftt'
    const text = receiptText({
      salon, billNo: done.bill.bill_no, date: new Date().toISOString(),
      lines: done.lines.filter((l) => l.kind === 'service').map((l) => ({ name: l.name, qty: l.qty, total: l.net_price ?? l.price * l.qty })),
      discount: done.bill.discount, membershipFee: done.bill.membership_fee, previousDue: done.bill.previous_due,
      paid: done.bill.paid, balanceDue: done.bill.new_due,
    })
    return (
      <Screen title="Bill closed">
        <Card className="space-y-1 text-center">
          <div className="text-sm text-gray-500">Bill number</div>
          <div className="text-2xl font-bold">{done.bill.bill_no}</div>
          <div>Paid {rupees(done.bill.paid)}</div>
          {done.bill.new_due > 0 && <div className="font-semibold text-red-600">Balance due {rupees(done.bill.new_due)}</div>}
        </Card>
        <a href={whatsappLink(client.phone, text)} target="_blank" rel="noreferrer"
          className="flex min-h-12 w-full items-center justify-center rounded-xl bg-green-600 font-semibold text-white">Send on WhatsApp</a>
        <Link to="/" className="flex min-h-12 w-full items-center justify-center rounded-xl border font-medium">Done</Link>
      </Screen>
    )
  }

  // Preview only. The server recalculates every number when the bill is closed.
  const primeNow = !!card.data?.card?.prime_until
  const priceOf = (l: VisitLine) => {
    const svc = cat.data?.services.find((s) => s.id === l.item_id)
    const repriced = sellPrime && svc?.prime_price != null && l.price === l.list_price && svc.prime_price < l.list_price
    return repriced ? svc!.prime_price! : l.price
  }
  const services = lines.filter((l) => l.kind === 'service')
  const subtotal = services.reduce((n, l) => n + priceOf(l) * l.qty, 0)
  const discount = Math.min(subtotal, discMode === 'pct' ? Math.round((subtotal * Number(discIn || 0)) / 100) : toPaise(Number(discIn || 0)))
  const feeNow = sellPrime ? fee.data ?? 0 : 0
  const balance = card.data?.card?.balance ?? 0
  const payable = Math.max(0, subtotal - discount + feeNow + balance)
  const paid = toPaise(Number(cash || 0)) + toPaise(Number(upi || 0))
  const remaining = payable - paid

  return (
    <Screen title="Billing" back={<BackLink to={`/visit/${visit.id}`} />}>
      <Card>
        <div className="font-semibold">{client.name}</div>
        <div className="mt-2 space-y-1 text-sm">
          {services.map((l) => (
            <div key={l.id} className="flex justify-between">
              <span>{l.name}{l.qty > 1 && ` ×${l.qty}`}{l.flagged && ' ⚑'}</span><span>{rupees(priceOf(l) * l.qty)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex gap-2">
          <input className={inputCls} inputMode="numeric" placeholder={discMode === 'amt' ? 'Discount ₹' : 'Discount %'} value={discIn}
            onChange={(e) => setDiscIn(e.target.value.replace(/\D/g, ''))} />
          <button className="min-h-12 shrink-0 rounded-xl border px-4" onClick={() => setDiscMode(discMode === 'amt' ? 'pct' : 'amt')}>{discMode === 'amt' ? '₹' : '%'}</button>
        </div>
        {discount > 0 && <input className={inputCls} placeholder="Discount reason (required)" value={discReason} onChange={(e) => setDiscReason(e.target.value)} />}
        {!primeNow && (fee.data ?? 0) > 0 && (
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" className="size-6" checked={sellPrime} onChange={(e) => setSellPrime(e.target.checked)} />
            Sell Prime membership ({rupees(fee.data ?? 0)}) and use prime prices now
          </label>
        )}
        {primeNow && (fee.data ?? 0) > 0 && (
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" className="size-6" checked={sellPrime} onChange={(e) => setSellPrime(e.target.checked)} />
            Renew Prime ({rupees(fee.data ?? 0)})
          </label>
        )}
      </Card>

      <Card className="space-y-1 text-sm">
        <Row l="Subtotal" v={rupees(subtotal)} />
        {discount > 0 && <Row l="Discount" v={`−${rupees(discount)}`} />}
        {feeNow > 0 && <Row l="Prime membership" v={rupees(feeNow)} />}
        {balance !== 0 && <Row l={balance > 0 ? 'Previous dues' : 'Credit applied'} v={rupees(balance)} />}
        <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total payable</span><span>{rupees(payable)}</span></div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">Cash (₹)
          <input className={inputCls} inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="block text-sm">GPay (₹)
          <input className={inputCls} inputMode="numeric" value={upi} onChange={(e) => setUpi(e.target.value.replace(/\D/g, ''))} />
        </label>
      </div>
      {Number(upi) > 0 && (
        <label className="block text-sm">GPay reference, last 4 digits (optional)
          <input className={inputCls} inputMode="numeric" maxLength={4} value={upiRef} onChange={(e) => setUpiRef(e.target.value.replace(/\D/g, ''))} />
        </label>
      )}
      <p className={`text-sm font-medium ${remaining > 0 ? 'text-red-600' : 'text-green-700'}`}>
        {remaining > 0 ? `Balance ${rupees(remaining)} will be added to the client's due` : remaining < 0 ? `${rupees(-remaining)} extra will be kept as credit` : 'Fully paid'}
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ActionBar>
        <Button disabled={discount > 0 && !discReason.trim()} onClick={() => { setError(''); setConfirming(true) }}>Close bill</Button>
      </ActionBar>

      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Confirm bill">
        <div className="space-y-1 text-center">
          <div className="text-sm text-gray-500">Total payable</div>
          <div className="text-4xl font-extrabold">{rupees(payable)}</div>
          <div className="text-gray-600">Cash {rupees(toPaise(Number(cash || 0)))} · GPay {rupees(toPaise(Number(upi || 0)))}</div>
          {remaining !== 0 && <div className={remaining > 0 ? 'font-semibold text-red-600' : 'text-green-700'}>
            {remaining > 0 ? `Due ${rupees(remaining)}` : `Credit ${rupees(-remaining)}`}</div>}
        </div>
        <Button className="mt-5" disabled={close.isPending} onClick={() => close.mutate()}>Confirm and close</Button>
      </Sheet>
    </Screen>
  )
}

const Row = ({ l, v }: { l: string; v: string }) => <div className="flex justify-between"><span>{l}</span><span>{v}</span></div>
