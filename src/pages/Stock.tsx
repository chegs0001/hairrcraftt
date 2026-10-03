import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import SalonTabs from '../components/SalonTabs'
import { BackLink, Button, Card, GhostButton, inputCls, Screen, Sheet } from '../components/ui'
import { rpc, useBranches, useStock } from '../lib/api'
import { useAuth } from '../lib/auth'
import { shortDate } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { StockRow } from '../lib/types'

type Mode = 'purchase' | 'adjustment' | 'transfer'

export default function Stock() {
  const qc = useQueryClient()
  const { staff } = useAuth()
  const branches = useBranches().data ?? []
  const [branch, setBranch] = useState(staff?.branch_id ?? '')
  const [lowOnly, setLowOnly] = useState(false)
  const [target, setTarget] = useState<{ row: StockRow; mode: Mode } | null>(null)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [to, setTo] = useState('')
  const [dir, setDir] = useState<'down' | 'up'>('down')
  const [error, setError] = useState('')

  const stock = useStock(branch || null)
  const moves = useQuery({
    queryKey: ['movements', branch],
    queryFn: async () => {
      let q = supabase.from('stock_movements').select('id,created_at,branch_id,type,qty,note,products(name)').order('created_at', { ascending: false }).limit(40)
      if (branch) q = q.eq('branch_id', branch)
      return (await q).data as unknown as { id: string; created_at: string; branch_id: string; type: string; qty: number; note: string | null; products: { name: string } | null }[]
    },
  })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['stock'] }); void qc.invalidateQueries({ queryKey: ['movements'] }) }
  const submit = useMutation({
    mutationFn: async () => {
      const n = Number(qty)
      if (!target) return
      if (target.mode === 'transfer') return rpc('transfer_stock', { p_from: target.row.branch_id, p_to: to, p_product: target.row.product_id, p_qty: n, p_note: note || null })
      return rpc('add_stock', { p_branch: target.row.branch_id, p_product: target.row.product_id, p_qty: target.mode === 'adjustment' && dir === 'down' ? -n : n, p_type: target.mode, p_note: note || null })
    },
    onSuccess: () => { setTarget(null); setQty(''); setNote(''); setError(''); refresh() },
    onError: (e: Error) => setError(e.message),
  })

  const rows = (stock.data ?? []).filter((r) => !lowOnly || r.low)
  const code = (id: string) => branches.find((b) => b.id === id)?.code ?? ''
  const open = (row: StockRow, mode: Mode) => { setTarget({ row, mode }); setQty(''); setNote(''); setError(''); setDir('down'); setTo(branches.find((b) => b.id !== row.branch_id)?.id ?? '') }

  return (
    <Screen title="Stock" back={<BackLink to="/more" />}>
      <SalonTabs value={branch} onChange={setBranch} />
      <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" className="size-6" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />Low stock only</label>
      {rows.length === 0 && <p className="text-gray-500">{lowOnly ? 'Nothing is low.' : 'No products yet. Add them under Products.'}</p>}
      {rows.map((r) => (
        <Card key={r.branch_id + r.product_id} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0"><div className="truncate font-medium">{r.name}</div><div className="text-xs text-gray-500">{code(r.branch_id)}{r.sku && ` · ${r.sku}`} · low at {r.low_at}</div></div>
            <div className={`text-2xl font-bold ${r.qty < 0 ? 'text-red-600' : r.low ? 'text-amber-600' : ''}`}>{r.qty}</div>
          </div>
          <div className="flex gap-2">
            <GhostButton className="min-h-10 flex-1 text-sm" onClick={() => open(r, 'purchase')}>+ Purchase</GhostButton>
            <GhostButton className="min-h-10 flex-1 text-sm" onClick={() => open(r, 'adjustment')}>Adjust</GhostButton>
            <GhostButton className="min-h-10 flex-1 text-sm" onClick={() => open(r, 'transfer')}>Transfer</GhostButton>
          </div>
        </Card>
      ))}
      <h2 className="pt-2 font-semibold">Recent movements</h2>
      {moves.data?.map((m) => (
        <div key={m.id} className="flex justify-between border-b py-2 text-sm">
          <span>{shortDate(m.created_at)} · {m.products?.name} <span className="text-gray-400">{code(m.branch_id)} · {m.type.replace('_', ' ')}{m.note && ` · ${m.note}`}</span></span>
          <span className={m.qty < 0 ? 'text-red-600' : 'text-green-700'}>{m.qty > 0 ? '+' : ''}{m.qty}</span>
        </div>
      ))}

      <Sheet open={!!target} onClose={() => setTarget(null)} title={target ? `${target.mode === 'purchase' ? 'Add stock' : target.mode === 'adjustment' ? 'Adjust stock' : 'Transfer'} · ${target.row.name}` : ''}>
        <div className="space-y-3">
          <label className="block text-sm">Quantity<input className={inputCls} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} /></label>
          {target?.mode === 'adjustment' && (
            <div className="flex gap-2">
              {(['down', 'up'] as const).map((d) => (
                <button key={d} onClick={() => setDir(d)} className={`min-h-12 flex-1 rounded-xl border text-sm font-semibold ${dir === d ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300'}`}>{d === 'down' ? 'Remove from stock' : 'Add to stock'}</button>
              ))}
            </div>
          )}
          {target?.mode === 'transfer' && (
            <label className="block text-sm">To salon
              <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
                {branches.filter((b) => b.id !== target.row.branch_id).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </label>
          )}
          {target?.mode !== 'purchase' && <label className="block text-sm">{target?.mode === 'adjustment' ? 'Reason (required)' : 'Note'}
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={target?.mode === 'adjustment' ? 'Broken, expired, count correction…' : ''} /></label>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button disabled={!Number(qty) || submit.isPending || (target?.mode === 'adjustment' && !note.trim())} onClick={() => submit.mutate()}>Confirm</Button>
        </div>
      </Sheet>
    </Screen>
  )
}
