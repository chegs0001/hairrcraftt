import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { BackLink, inputCls, Screen } from '../components/ui'
import { useCatalogue } from '../lib/api'
import { rupees, toPaise } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Service } from '../lib/types'

export default function ServicesAdmin() {
  const { data } = useCatalogue()
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  return (
    <Screen title="Services and prices" back={<BackLink to="/more" />}>
      <input className={inputCls} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      {data?.categories.map((c) => {
        const items = data.services.filter((s) => s.category_id === c.id && (!term || s.name.toLowerCase().includes(term)))
        if (!items.length) return null
        return (
          <div key={c.id}>
            <h2 className="mb-1 text-sm font-semibold text-gray-500">{c.name}{c.gender !== 'both' && ` · ${c.gender}`}</h2>
            {items.map((s) => <Row key={s.id} s={s} />)}
          </div>
        )
      })}
    </Screen>
  )
}

function Row({ s }: { s: Service }) {
  const qc = useQueryClient()
  const [std, setStd] = useState(s.standard_price === null ? '' : String(s.standard_price / 100))
  const [prime, setPrime] = useState(s.prime_price === null ? '' : String(s.prime_price / 100))
  const save = useMutation({
    mutationFn: async (patch: Partial<Service>) => {
      const { error } = await supabase.from('services').update(patch).eq('id', s.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalogue'] }),
  })
  const dirty = std !== (s.standard_price === null ? '' : String(s.standard_price / 100)) || prime !== (s.prime_price === null ? '' : String(s.prime_price / 100))
  return (
    <div className={`border-b py-2 ${s.active ? '' : 'opacity-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{s.name}{s.gender !== 'both' && ` (${s.gender})`}</span>
        <button className="px-2 py-2 text-xs text-gray-500" onClick={() => save.mutate({ active: !s.active })}>{s.active ? 'Hide' : 'Show'}</button>
      </div>
      {s.standard_price === null && <div className="text-xs text-gray-500">Open price {s.price_hint && `· ${s.price_hint}`}</div>}
      <div className="mt-1 flex items-center gap-2">
        <input className={`${inputCls} min-h-10`} inputMode="numeric" placeholder="Standard ₹" value={std} onChange={(e) => setStd(e.target.value.replace(/\D/g, ''))} />
        <input className={`${inputCls} min-h-10`} inputMode="numeric" placeholder="Prime ₹" value={prime} onChange={(e) => setPrime(e.target.value.replace(/\D/g, ''))} />
        {dirty && (
          <button className="min-h-10 rounded-xl bg-violet-600 px-4 text-sm text-white"
            onClick={() => save.mutate({ standard_price: std === '' ? null : toPaise(Number(std)), prime_price: prime === '' ? null : toPaise(Number(prime)) })}>Save</button>
        )}
      </div>
      {s.standard_price !== null && !dirty && <div className="mt-1 text-xs text-gray-400">{rupees(s.standard_price)}{s.prime_price !== null && ` · prime ${rupees(s.prime_price)}`}</div>}
    </div>
  )
}
