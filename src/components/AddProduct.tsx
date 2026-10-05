import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { rpc, useProducts, useStock } from '../lib/api'
import { rupees, toPaise } from '../lib/format'
import { fuzzyFilter } from '../lib/search'
import type { Product } from '../lib/types'
import { Button, inputCls, Sheet } from './ui'

const REASONS = ['Regular client', 'Combo', 'Damaged pack', 'Other']

export default function AddProduct({ open, onClose, visitId, branchId, isPrime }: {
  open: boolean; onClose: () => void; visitId: string; branchId: string; isPrime: boolean
}) {
  const qc = useQueryClient()
  const products = useProducts()
  const stock = useStock(branchId)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Product | null>(null)
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const listOf = (p: Product) => (isPrime && p.prime_price !== null ? p.prime_price : p.selling_price)
  const qtyOf = (p: Product) => stock.data?.find((s) => s.product_id === p.id)?.qty ?? 0
  const below = !!picked && price !== '' && toPaise(Number(price)) < listOf(picked)
  const close = () => { setPicked(null); setQ(''); setError(''); onClose() }

  const add = useMutation({
    mutationFn: () => rpc('add_product_line', {
      p_visit: visitId, p_product: picked!.id, p_qty: Math.max(1, Number(qty) || 1),
      p_price: toPaise(Number(price)), p_reason: below ? (reason === 'Other' ? `Other: ${note}` : reason) : null,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['visit', visitId] }); close() },
    onError: (e: Error) => setError(e.message),
  })

  const list = fuzzyFilter((products.data ?? []).filter((p) => p.active), q, (p) => [p.name, p.sku ?? ''])

  return (
    <Sheet open={open} onClose={close} title={picked ? picked.name : 'Add product'} full={!picked}>
      {picked ? (
        <div className="space-y-4">
          <button className="text-sm text-violet-700" onClick={() => setPicked(null)}>‹ All products</button>
          <p className={`text-sm ${qtyOf(picked) <= 0 ? 'font-medium text-red-600' : 'text-gray-500'}`}>In stock here: {qtyOf(picked)}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Price (₹)
              <input className={inputCls} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label className="block text-sm">Quantity
              <input className={inputCls} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
            </label>
          </div>
          {below && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-red-700">Below list price ({rupees(listOf(picked))}). Pick a reason.</p>
              <div className="flex flex-wrap gap-2">
                {REASONS.map((r) => (
                  <button key={r} onClick={() => setReason(r)}
                    className={`min-h-12 rounded-full border px-4 text-sm ${reason === r ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300'}`}>{r}</button>
                ))}
              </div>
              {reason === 'Other' && <input className={inputCls} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />}
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button disabled={add.isPending || price === '' || (below && (!reason || (reason === 'Other' && !note.trim())))} onClick={() => add.mutate()}>Add product</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <input className={inputCls} placeholder="Search products" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
          {list.length === 0 && <p className="text-sm text-gray-500">No products found.</p>}
          {list.map((p) => (
            <button key={p.id} className="flex min-h-12 w-full items-center justify-between gap-2 border-b py-2 text-left"
              onClick={() => { setPicked(p); setPrice(String(listOf(p) / 100)); setQty('1'); setReason('') }}>
              <span>{p.name}<span className={`ml-2 text-xs ${qtyOf(p) <= 0 ? 'text-red-600' : 'text-gray-400'}`}>{qtyOf(p)} left</span></span>
              <span className="text-sm text-gray-500">{rupees(listOf(p))}</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}
