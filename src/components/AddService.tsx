import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { rpc, useCatalogue } from '../lib/api'
import { rupees, shortDate, toPaise } from '../lib/format'
import { fuzzyFilter } from '../lib/search'
import { supabase } from '../lib/supabase'
import type { Service } from '../lib/types'
import { useAuth } from '../lib/auth'
import { Button, inputCls, Sheet } from './ui'

const REASONS = ['Regular client', 'Combo', 'Correction', 'Other']

interface Props { open: boolean; onClose: () => void; visitId: string; clientId: string; isPrime: boolean }

export default function AddService({ open, onClose, visitId, clientId, isPrime }: Props) {
  const qc = useQueryClient()
  const { staff } = useAuth()
  const cat = useCatalogue()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Service | null>(null)

  const favs = useQuery({
    queryKey: ['favourites', staff?.id],
    enabled: !!staff,
    queryFn: async () => ((await supabase.from('staff_favourites').select('service_id').eq('staff_id', staff!.id)).data ?? []).map((f) => f.service_id as string),
  })
  const toggleFav = useMutation({
    mutationFn: async (s: Service) => {
      if (favs.data?.includes(s.id)) await supabase.from('staff_favourites').delete().eq('staff_id', staff!.id).eq('service_id', s.id)
      else await supabase.from('staff_favourites').insert({ staff_id: staff!.id, service_id: s.id })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favourites'] }),
  })

  const catName = (id: string) => cat.data?.categories.find((c) => c.id === id)?.name ?? ''
  const searching = q.trim().length > 0
  // While typing: one list ranked by how well each service matches (typos allowed). Otherwise grouped by category.
  const ranked = useMemo(
    () => fuzzyFilter((cat.data?.services ?? []).filter((s) => s.active), q, (s) => [s.name, catName(s.category_id), s.price_hint ?? '']).slice(0, 40),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cat.data, q])
  const grouped = useMemo(() => {
    const services = (cat.data?.services ?? []).filter((s) => s.active)
    return (cat.data?.categories ?? [])
      .map((c) => ({ c, items: services.filter((s) => s.category_id === c.id) }))
      .filter((g) => g.items.length)
  }, [cat.data])
  const favServices = (cat.data?.services ?? []).filter((s) => s.active && favs.data?.includes(s.id))

  const close = () => { setPicked(null); setQ(''); onClose() }

  return (
    <Sheet open={open} onClose={close} title={picked ? picked.name : 'Add service'} full={!picked}>
      {picked ? (
        <PricePanel service={picked} visitId={visitId} clientId={clientId} isPrime={isPrime}
          onBack={() => setPicked(null)}
          onAdded={() => { void qc.invalidateQueries({ queryKey: ['visit', visitId] }); close() }} />
      ) : (
        <div className="space-y-4">
          <input className={inputCls} placeholder="Search services" autoComplete="off" autoCorrect="off" value={q} onChange={(e) => setQ(e.target.value)} />
          {!searching && favServices.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-500">Favourites</div>
              <div className="flex flex-wrap gap-2">
                {favServices.map((s) => (
                  <button key={s.id} onClick={() => setPicked(s)} className="min-h-12 rounded-full bg-violet-100 px-4 text-sm font-medium text-violet-800">{s.name}</button>
                ))}
              </div>
            </div>
          )}
          {searching && ranked.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No service matches "{q.trim()}". Check the spelling, or ask a manager to add it.</p>}
          {searching && ranked.map((s) => (
            <div key={s.id} className="flex items-center border-b">
              <button className="flex min-h-14 flex-1 items-center justify-between gap-2 py-2 text-left" onClick={() => setPicked(s)}>
                <span className="min-w-0"><span className="block truncate">{s.name}</span><span className="block truncate text-xs text-gray-500">{catName(s.category_id)}</span></span>
                <span className="shrink-0 text-sm text-gray-500">{s.standard_price !== null ? rupees(isPrime && s.prime_price !== null ? s.prime_price : s.standard_price) : s.price_hint ?? 'Open price'}</span>
              </button>
              <button className="px-3 py-3 text-xl" aria-label="Favourite" onClick={() => toggleFav.mutate(s)}>{favs.data?.includes(s.id) ? '★' : '☆'}</button>
            </div>
          ))}
          {!searching && grouped.map(({ c, items }) => (
            <div key={c.id}>
              <div className="mb-1 text-sm font-semibold text-gray-500">{c.name}{c.gender !== 'both' && ` · ${c.gender}`}</div>
              {items.map((s) => (
                <div key={s.id} className="flex items-center border-b">
                  <button className="flex min-h-12 flex-1 items-center justify-between gap-2 py-2 text-left" onClick={() => setPicked(s)}>
                    <span>{s.name}{s.gender !== 'both' && c.gender === 'both' ? ` (${s.gender})` : ''}</span>
                    <span className="text-sm text-gray-500">
                      {s.standard_price !== null ? rupees(isPrime && s.prime_price !== null ? s.prime_price : s.standard_price) : s.price_hint ?? 'Open price'}
                    </span>
                  </button>
                  <button className="px-3 py-3 text-xl" aria-label="Favourite" onClick={() => toggleFav.mutate(s)}>
                    {favs.data?.includes(s.id) ? '★' : '☆'}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}

function PricePanel({ service, visitId, clientId, isPrime, onBack, onAdded }: {
  service: Service; visitId: string; clientId: string; isPrime: boolean; onBack: () => void; onAdded: () => void
}) {
  const open = service.standard_price === null
  const listPaise = open ? 0 : isPrime && service.prime_price !== null ? service.prime_price : service.standard_price!
  const [price, setPrice] = useState(open ? '' : String(listPaise / 100))
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const last = useQuery({
    queryKey: ['last-charged', clientId, service.id],
    queryFn: async () => (await rpc<{ price: number; billed_on: string }[]>('last_charged', { p_client: clientId, p_service: service.id }))[0] ?? null,
  })
  const below = !open && price !== '' && toPaise(Number(price)) < listPaise
  const add = useMutation({
    mutationFn: () =>
      rpc('add_line', {
        p_visit: visitId, p_service: service.id, p_qty: Math.max(1, Number(qty) || 1),
        p_price: price === '' ? null : toPaise(Number(price)),
        p_reason: below ? (reason === 'Other' ? `Other: ${note}` : reason) : null,
      }),
    onSuccess: onAdded,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="space-y-4">
      <button className="text-sm text-violet-700" onClick={onBack}>‹ All services</button>
      {service.price_hint && <p className="text-sm text-gray-500">Price range: {service.price_hint}</p>}
      {last.data && <p className="text-sm text-amber-700">Last charged {rupees(last.data.price)} on {shortDate(last.data.billed_on)}</p>}
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">{service.unit_label ? `Price per ${service.unit_label} (₹)` : 'Price (₹)'}
          <input className={inputCls} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="block text-sm">{service.unit_label ? `No. of ${service.unit_label}s` : 'Quantity'}
          <input className={inputCls} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
        </label>
      </div>
      {below && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-red-700">Below list price ({rupees(listPaise)}). Pick a reason.</p>
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
      <Button disabled={add.isPending || (open && !price) || (below && (!reason || (reason === 'Other' && !note.trim())))} onClick={() => add.mutate()}>
        Add service
      </Button>
    </div>
  )
}
