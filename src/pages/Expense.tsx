import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ActionBar, BackLink, Button, Card, inputCls, Screen, Sheet } from '../components/ui'
import { rpc } from '../lib/api'
import { rupees, toPaise } from '../lib/format'
import { compressImage } from '../lib/image'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const CATEGORIES = ['Tea/snacks', 'Cleaning', 'Salon supplies', 'Repairs', 'Transport', 'Other']

interface Expense { id: string; amount: number; category: string; title: string; paid_from: string; receipt_path: string | null; created_by: string }

export default function ExpensePage() {
  const qc = useQueryClient()
  const { staff, isManager } = useAuth()
  const [editing, setEditing] = useState<Expense | null>(null)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [title, setTitle] = useState('')
  const [paidFrom, setPaidFrom] = useState('drawer')
  const [photo, setPhoto] = useState<File | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const list = useQuery({
    queryKey: ['expenses', today],
    queryFn: async () =>
      (await supabase.from('expenses').select('*').eq('business_date', today).eq('status', 'active').order('created_at', { ascending: false })).data as Expense[],
  })

  const reset = () => { setEditing(null); setAmount(''); setCategory(''); setTitle(''); setPhoto(null); setPaidFrom('drawer') }
  const save = useMutation({
    mutationFn: async () => {
      const paise = toPaise(Number(amount))
      if (editing) {
        const reason = isManager ? prompt('Reason for the change (needed only if the day is closed)') ?? '' : null
        return rpc('edit_expense', { p_id: editing.id, p_amount: paise, p_category: category, p_title: title, p_paid_from: paidFrom, p_reason: reason })
      }
      let path: string | null = null
      if (photo) {
        path = `${staff?.branch_id}/${crypto.randomUUID()}.jpg`
        const { error } = await supabase.storage.from('receipts').upload(path, await compressImage(photo), { contentType: 'image/jpeg' })
        if (error) throw new Error(`Receipt upload failed: ${error.message}`)
      }
      return rpc('add_expense', { p_amount: paise, p_category: category, p_title: title, p_receipt: path, p_paid_from: paidFrom })
    },
    onSuccess: () => { reset(); setConfirming(false); void qc.invalidateQueries({ queryKey: ['expenses'] }) },
    onError: (e: Error) => { setError(e.message); setConfirming(false) },
  })
  const remove = useMutation({
    mutationFn: (e: Expense) => rpc('void_expense', { p_id: e.id, p_reason: isManager ? prompt('Reason (needed only if the day is closed)') ?? '' : null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
    onError: (e: Error) => setError(e.message),
  })

  const valid = Number(amount) > 0 && category && title.trim()
  return (
    <Screen title={editing ? 'Edit expense' : 'Expense'} back={<BackLink to="/more" />}>
      <label className="block text-sm">Amount (₹)
        <input className={`${inputCls} text-2xl`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
      </label>
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCategory(c)}
            className={`min-h-12 rounded-full border px-4 text-sm ${category === c ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300'}`}>{c}</button>
        ))}
      </div>
      <label className="block text-sm">What was it for?
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block text-sm">Paid from
        <select className={inputCls} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>
          <option value="drawer">Drawer cash</option><option value="owner">Owner</option>
        </select>
      </label>
      {!editing && (
        <label className="block text-sm">Receipt photo (optional)
          <input className={inputCls} type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ActionBar>
        {editing && <button className="min-h-12 rounded-xl border px-4" onClick={reset}>Cancel</button>}
        <Button disabled={!valid || save.isPending} onClick={() => { setError(''); setConfirming(true) }}>{editing ? 'Save changes' : 'Save expense'}</Button>
      </ActionBar>

      <div>
        <h2 className="mb-2 font-semibold">Today</h2>
        {list.data?.length === 0 && <p className="text-sm text-gray-500">No expenses yet.</p>}
        {list.data?.map((e) => (
          <Card key={e.id} className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{e.title}</div>
              <div className="text-sm text-gray-500">{e.category} · {e.paid_from === 'drawer' ? 'Drawer' : 'Owner'}{e.receipt_path && ' · 📎'}</div>
            </div>
            <div className="text-right">
              <div className="font-semibold">{rupees(e.amount)}</div>
              {(isManager || e.created_by === staff?.auth_user_id) && (
                <div className="flex gap-3 text-sm">
                  <button className="py-1 text-violet-700" onClick={() => { setEditing(e); setAmount(String(e.amount / 100)); setCategory(e.category); setTitle(e.title); setPaidFrom(e.paid_from) }}>Edit</button>
                  <button className="py-1 text-red-600" onClick={() => confirm('Remove this expense?') && remove.mutate(e)}>Remove</button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Sheet open={confirming} onClose={() => setConfirming(false)} title="Confirm expense">
        <div className="space-y-1 text-center">
          <div className="text-4xl font-extrabold">{rupees(toPaise(Number(amount || 0)))}</div>
          <div className="text-gray-600">{title} · {paidFrom === 'drawer' ? 'from drawer cash' : 'paid by owner'}</div>
        </div>
        <Button className="mt-5" disabled={save.isPending} onClick={() => save.mutate()}>Confirm</Button>
      </Sheet>
    </Screen>
  )
}
