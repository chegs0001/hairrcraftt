import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { BackLink, Button, Card, GhostButton, inputCls, Screen, Sheet } from '../components/ui'
import { useCatalogue } from '../lib/api'
import { rupees, toPaise } from '../lib/format'
import { fuzzyFilter } from '../lib/search'
import { parseServiceRows, TEMPLATE_CSV, type Gender } from '../lib/serviceImport'
import { supabase } from '../lib/supabase'
import type { Category, Service } from '../lib/types'

const NEW = '__new__'
const GENDERS: { v: Gender; label: string }[] = [{ v: 'both', label: 'Everyone' }, { v: 'women', label: 'Women' }, { v: 'men', label: 'Men' }]

export default function ServicesAdmin() {
  const { data } = useCatalogue()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Service | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [showHidden, setShowHidden] = useState(true)
  const matches = useMemo(() => new Set(fuzzyFilter(data?.services ?? [], q, (s) => [s.name, s.price_hint ?? '']).map((s) => s.id)), [data, q])

  return (
    <Screen title="Services and prices" back={<BackLink to="/more" />}>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => setEditing('new')}>+ Add service</Button>
        <GhostButton onClick={() => setImporting(true)}>Import from sheet</GhostButton>
      </div>
      <input className={inputCls} placeholder="Search services" value={q} onChange={(e) => setQ(e.target.value)} />
      <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />Show hidden services</label>

      {data?.categories.map((c) => {
        const items = data.services.filter((s) => s.category_id === c.id && (showHidden || s.active) && matches.has(s.id))
        if (!items.length) return null
        return (
          <section key={c.id} className="space-y-2">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{c.name}{c.gender !== 'both' && ` · ${c.gender}`}</h2>
            <div className="overflow-hidden rounded-2xl border bg-white">
              {items.map((s) => (
                <button key={s.id} onClick={() => setEditing(s)} className={`flex min-h-14 w-full items-center justify-between gap-3 border-b px-4 py-2 text-left last:border-b-0 active:bg-gray-50 ${s.active ? '' : 'opacity-50'}`}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.name}{s.gender !== 'both' && c.gender === 'both' ? ` (${s.gender})` : ''}{!s.active && ' · hidden'}</span>
                    {s.is_package && <span className="text-xs text-violet-700">Package</span>}
                  </span>
                  <span className="shrink-0 text-right text-sm">
                    {s.standard_price !== null
                      ? <>{rupees(s.standard_price)}{s.unit_label && <span className="text-gray-400"> /{s.unit_label}</span>}{s.prime_price !== null && <span className="block text-xs text-violet-700">Prime {rupees(s.prime_price)}</span>}</>
                      : <span className="text-gray-500">{s.price_hint ?? 'Open price'}</span>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
      {data && data.services.length === 0 && <Card className="text-center text-gray-500">No services yet. Add one, or import a sheet.</Card>}

      <ServiceSheet target={editing} categories={data?.categories ?? []} onClose={() => setEditing(null)} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} categories={data?.categories ?? []} services={data?.services ?? []} />
    </Screen>
  )
}

function ServiceSheet({ target, categories, onClose }: { target: Service | 'new' | null; categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient()
  const s = target && target !== 'new' ? target : null
  // Sheet content is remounted per target so fields always start from that service.
  return (
    <Sheet open={!!target} onClose={onClose} title={s ? 'Edit service' : 'Add service'}>
      {target && <ServiceForm key={s?.id ?? 'new'} service={s} categories={categories} onDone={() => { void qc.invalidateQueries({ queryKey: ['catalogue'] }); onClose() }} />}
    </Sheet>
  )
}

function ServiceForm({ service, categories, onDone }: { service: Service | null; categories: Category[]; onDone: () => void }) {
  const [name, setName] = useState(service?.name ?? '')
  const [categoryId, setCategoryId] = useState(service?.category_id ?? categories[0]?.id ?? NEW)
  const [newCategory, setNewCategory] = useState('')
  const [gender, setGender] = useState<Gender>(service?.gender ?? 'both')
  const [open, setOpen] = useState(service ? service.standard_price === null : false)
  const [price, setPrice] = useState(service?.standard_price != null ? String(service.standard_price / 100) : '')
  const [prime, setPrime] = useState(service?.prime_price != null ? String(service.prime_price / 100) : '')
  const [hint, setHint] = useState(service?.price_hint ?? '')
  const [unit, setUnit] = useState(service?.unit_label ?? '')
  const [active, setActive] = useState(service?.active ?? true)
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      let cat = categoryId
      if (cat === NEW) {
        const catName = newCategory.trim()
        const found = categories.find((c) => c.name.toLowerCase() === catName.toLowerCase())
        if (found) cat = found.id
        else {
          const { data, error } = await supabase.from('service_categories')
            .insert({ name: catName, gender, sort: Math.max(0, ...categories.map((c) => c.sort)) + 1 }).select('id').single()
          if (error) throw new Error(error.message)
          cat = data.id
        }
      }
      const row = {
        category_id: cat, name: name.trim(), gender, active,
        standard_price: open ? null : toPaise(Number(price)),
        prime_price: open || prime === '' ? null : toPaise(Number(prime)),
        price_hint: hint.trim() || null, unit_label: unit.trim() || null,
      }
      const { error } = service
        ? await supabase.from('services').update(row).eq('id', service.id)
        : await supabase.from('services').insert(row)
      if (error) throw new Error(error.message)
    },
    onSuccess: onDone,
    onError: (e: Error) => setError(e.message),
  })

  const primeBad = !open && prime !== '' && Number(prime) > Number(price)
  const valid = name.trim() && (categoryId !== NEW || newCategory.trim()) && (open || price !== '') && !primeBad

  return (
    <div className="space-y-3">
      <label className="block text-sm">Service name
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block text-sm">Category
        <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.gender !== 'both' ? ` · ${c.gender}` : ''}</option>)}
          <option value={NEW}>+ New category…</option>
        </select>
      </label>
      {categoryId === NEW && (
        <input className={inputCls} placeholder="New category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
      )}
      <div>
        <div className="mb-1.5 text-sm font-medium text-gray-700">For</div>
        <div className="flex gap-2">
          {GENDERS.map((g) => (
            <button key={g.v} onClick={() => setGender(g.v)} className={`min-h-12 flex-1 rounded-xl border text-sm font-semibold ${gender === g.v ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300'}`}>{g.label}</button>
          ))}
        </div>
      </div>
      <label className="flex min-h-12 items-center gap-3 text-sm">
        <input type="checkbox" className="size-6" checked={open} onChange={(e) => setOpen(e.target.checked)} />
        No fixed price: staff type the amount when billing
      </label>
      {!open && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Price (₹)
            <input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
          <label className="block text-sm">Prime price (₹)
            <input className={inputCls} inputMode="decimal" placeholder="Optional" value={prime} onChange={(e) => setPrime(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
        </div>
      )}
      {primeBad && <p className="text-sm text-red-600">Prime price can't be higher than the normal price.</p>}
      <label className="block text-sm">Note shown to staff (optional)
        <input className={inputCls} placeholder={open ? 'e.g. ₹5,000–5,500' : 'e.g. per finger'} value={hint} onChange={(e) => setHint(e.target.value)} />
      </label>
      <label className="block text-sm">Charged per unit (optional)
        <input className={inputCls} placeholder="e.g. finger: staff enter how many" value={unit} onChange={(e) => setUnit(e.target.value)} />
      </label>
      {service && (
        <label className="flex min-h-12 items-center gap-3 text-sm">
          <input type="checkbox" className="size-6" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Available for billing (untick to hide it)
        </label>
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : service ? 'Save changes' : 'Add service'}</Button>
    </div>
  )
}

function ImportSheet({ open, onClose, categories, services }: { open: boolean; onClose: () => void; categories: Category[]; services: Service[] }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const parsed = useMemo(() => parseServiceRows(text), [text])

  const plan = useMemo(() => {
    const catByName = new Map<string, Category[]>()
    categories.forEach((c) => catByName.set(c.name.toLowerCase(), [...(catByName.get(c.name.toLowerCase()) ?? []), c]))
    let added = 0, updated = 0
    const newCats = new Set<string>()
    for (const r of parsed.rows) {
      const cats = catByName.get(r.category.toLowerCase())
      if (!cats) newCats.add(r.category.toLowerCase())
      const cat = cats?.find((c) => c.gender === r.gender) ?? cats?.[0]
      const exists = cat && services.some((s) => s.category_id === cat.id && s.name.toLowerCase() === r.name.toLowerCase())
      if (exists) updated++; else added++
    }
    return { added, updated, newCats: newCats.size }
  }, [parsed, categories, services])

  const run = useMutation({
    mutationFn: async () => {
      const cats = [...categories]
      const findCat = (name: string, g: Gender) => {
        const same = cats.filter((c) => c.name.toLowerCase() === name.toLowerCase())
        return same.find((c) => c.gender === g) ?? same[0]
      }
      // 1. missing categories
      let nextCatSort = Math.max(0, ...cats.map((c) => c.sort)) + 1
      const toCreate = new Map<string, { name: string; gender: Gender; sort: number }>()
      for (const r of parsed.rows) {
        if (!findCat(r.category, r.gender) && !toCreate.has(r.category.toLowerCase())) toCreate.set(r.category.toLowerCase(), { name: r.category, gender: r.gender, sort: nextCatSort++ })
      }
      if (toCreate.size) {
        const { data, error } = await supabase.from('service_categories').insert([...toCreate.values()]).select('*')
        if (error) throw new Error(error.message)
        cats.push(...(data as Category[]))
      }
      // 2. services: update matches, insert the rest
      let nextSort = Math.max(0, ...services.map((s) => s.sort)) + 1
      const inserts: Record<string, unknown>[] = []
      for (const r of parsed.rows) {
        const cat = findCat(r.category, r.gender)!
        const existing = services.find((s) => s.category_id === cat.id && s.name.toLowerCase() === r.name.toLowerCase())
        const fields = { standard_price: r.price, prime_price: r.prime, price_hint: r.hint, gender: r.gender, active: true }
        if (existing) {
          const { error } = await supabase.from('services').update(fields).eq('id', existing.id)
          if (error) throw new Error(`Line ${r.line}: ${error.message}`)
        } else inserts.push({ ...fields, category_id: cat.id, name: r.name, sort: nextSort++ })
      }
      if (inserts.length) {
        const { error } = await supabase.from('services').insert(inserts)
        if (error) throw new Error(error.message)
      }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['catalogue'] }); setMsg(`Done: ${plan.added} added, ${plan.updated} updated.`); setText('') },
    onError: (e: Error) => setMsg(e.message),
  })

  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' }))
    a.download = 'services-template.csv'
    a.click()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Import services">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Paste rows from Excel or Google Sheets, one service per line:</p>
        <div className="rounded-xl bg-gray-50 p-3 font-mono text-xs leading-relaxed">Category · Service · For · Price · Prime price · Note</div>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-gray-500">
          <li>For is men, women or both. Leave Price empty for an open price.</li>
          <li>A service that already exists in that category is updated, not duplicated.</li>
          <li>New categories are created automatically.</li>
        </ul>
        <button className="text-sm text-violet-700" onClick={download}>Download a template</button>
        <textarea className="min-h-40 w-full rounded-xl border border-gray-300 p-3 font-mono text-sm" placeholder={'Hair Treatment\tScalp Detox\tboth\t1200\t1080'} value={text} onChange={(e) => { setText(e.target.value); setMsg('') }} />
        {text.trim() && (
          <div className="space-y-1 text-sm">
            <div><b>{parsed.rows.length}</b> rows ready · {plan.added} new · {plan.updated} {plan.updated === 1 ? 'update' : 'updates'}{plan.newCats > 0 && ` · ${plan.newCats} new ${plan.newCats === 1 ? 'category' : 'categories'}`}</div>
            {parsed.errors.slice(0, 6).map((e) => <div key={e.line} className="text-red-600">Line {e.line}: {e.message}</div>)}
            {parsed.errors.length > 6 && <div className="text-red-600">…and {parsed.errors.length - 6} more problems</div>}
          </div>
        )}
        {msg && <p className={`rounded-xl p-3 text-sm ${msg.startsWith('Done') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg}</p>}
        <Button disabled={parsed.rows.length === 0 || parsed.errors.length > 0 || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Importing…' : `Import ${parsed.rows.length || ''} services`}
        </Button>
        {parsed.errors.length > 0 && <p className="text-xs text-gray-500">Fix the lines above to enable the import. Nothing is saved until every line is valid.</p>}
      </div>
    </Sheet>
  )
}
