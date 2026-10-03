import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { BackLink, Button, Card, inputCls, Screen, Sheet } from '../components/ui'
import { rpc, useBranches, useProducts } from '../lib/api'
import { rupees, toPaise } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'

export default function Products() {
  const qc = useQueryClient()
  const { data } = useProducts()
  const branches = useBranches().data ?? []
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [price, setPrice] = useState('')
  const [prime, setPrime] = useState('')
  const [low, setLow] = useState('2')
  const [opening, setOpening] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const open = (p: Product | 'new') => {
    setEditing(p); setError(''); setOpening({})
    const x = p === 'new' ? null : p
    setName(x?.name ?? ''); setSku(x?.sku ?? ''); setPrice(x ? String(x.selling_price / 100) : '')
    setPrime(x?.prime_price != null ? String(x.prime_price / 100) : ''); setLow(String(x?.low_stock_at ?? 2))
  }
  const save = useMutation({
    mutationFn: async () => {
      const row = { name: name.trim(), sku: sku.trim() || null, selling_price: toPaise(Number(price)), prime_price: prime === '' ? null : toPaise(Number(prime)), low_stock_at: Number(low) || 0 }
      if (editing === 'new') {
        const { data: made, error } = await supabase.from('products').insert(row).select('id').single()
        if (error) throw new Error(error.message)
        for (const b of branches) {
          const n = Number(opening[b.id] || 0)
          if (n > 0) await rpc('add_stock', { p_branch: b.id, p_product: made.id, p_qty: n, p_type: 'purchase', p_note: 'Opening stock' })
        }
      } else if (editing) {
        const { error } = await supabase.from('products').update(row).eq('id', editing.id)
        if (error) throw new Error(error.message)
      }
    },
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: ['products'] }); void qc.invalidateQueries({ queryKey: ['stock'] }) },
    onError: (e: Error) => setError(e.message),
  })
  const toggle = useMutation({
    mutationFn: async (p: Product) => { await supabase.from('products').update({ active: !p.active }).eq('id', p.id) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })

  return (
    <Screen title="Products" back={<BackLink to="/more" />}>
      <Button onClick={() => open('new')}>Add product</Button>
      {data?.map((p) => (
        <Card key={p.id} className={`flex items-center justify-between gap-2 ${p.active ? '' : 'opacity-50'}`}>
          <button className="min-w-0 flex-1 text-left" onClick={() => open(p)}>
            <div className="truncate font-medium">{p.name}</div>
            <div className="text-xs text-gray-500">{rupees(p.selling_price)}{p.prime_price != null && ` · prime ${rupees(p.prime_price)}`}{p.sku && ` · ${p.sku}`}</div>
          </button>
          <button className="px-2 py-2 text-xs text-gray-500" onClick={() => toggle.mutate(p)}>{p.active ? 'Hide' : 'Show'}</button>
        </Card>
      ))}
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New product' : 'Edit product'}>
        <div className="space-y-3">
          <label className="block text-sm">Name<input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Selling price (₹)<input className={inputCls} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} /></label>
            <label className="block text-sm">Prime price (₹)<input className={inputCls} inputMode="numeric" value={prime} onChange={(e) => setPrime(e.target.value.replace(/\D/g, ''))} /></label>
            <label className="block text-sm">SKU (optional)<input className={inputCls} value={sku} onChange={(e) => setSku(e.target.value)} /></label>
            <label className="block text-sm">Low stock at<input className={inputCls} inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value.replace(/\D/g, ''))} /></label>
          </div>
          {editing === 'new' && (
            <div className="grid grid-cols-2 gap-3">
              {branches.map((b) => (
                <label key={b.id} className="block text-sm">Opening stock {b.code}
                  <input className={inputCls} inputMode="numeric" value={opening[b.id] ?? ''} onChange={(e) => setOpening({ ...opening, [b.id]: e.target.value.replace(/\D/g, '') })} />
                </label>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button disabled={save.isPending || !name.trim() || price === ''} onClick={() => save.mutate()}>Save</Button>
        </div>
      </Sheet>
    </Screen>
  )
}
