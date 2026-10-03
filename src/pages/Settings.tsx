import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, inputCls, Screen } from '../components/ui'
import { supabase } from '../lib/supabase'

const back = <Link to="/more" className="px-2 py-2 text-xl">‹</Link>

// key → label, and whether the stored value is paise (shown/edited in rupees).
const FIELDS: { key: string; label: string; paise?: boolean }[] = [
  { key: 'incentive_multiple', label: 'Incentive target (× monthly salary)' },
  { key: 'incentive_rate_pct', label: 'Incentive rate (%)' },
  { key: 'incentive_gate_paise', label: 'Salon sales gate (₹)', paise: true },
  { key: 'grace_minutes', label: 'Late / early grace (minutes per day)' },
  { key: 'required_hours', label: 'Required hours per day' },
  { key: 'half_day_pct', label: 'Half-day threshold (% of shift)' },
  { key: 'min_hours_for_half_day', label: 'Minimum hours for a half day' },
  { key: 'geofence_default_m', label: 'Default geo-fence radius (m)' },
  { key: 'geofence_max_accuracy_m', label: 'Worst GPS accuracy allowed (m)' },
  { key: 'prime_fee_paise', label: 'Prime membership fee (₹)', paise: true },
  { key: 'birthday_discount_pct', label: 'Birthday discount on services (%)' },
  { key: 'prime_validity_days', label: 'Prime validity (days)' },
  { key: 'selfie_retention_days', label: 'Selfie retention (days)' },
]

export default function Settings() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const rows = (await supabase.from('settings').select('key,value')).data ?? []
      return Object.fromEntries(rows.map((r) => [r.key, Number(r.value)])) as Record<string, number>
    },
  })
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      const rows = FIELDS.filter((f) => draft[f.key] !== undefined && draft[f.key] !== '').map((f) => ({
        key: f.key,
        value: f.paise ? Math.round(Number(draft[f.key]) * 100) : Number(draft[f.key]),
        updated_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('settings').upsert(rows)
      if (error) throw error
    },
    onSuccess: () => { setMsg('Saved'); setDraft({}); void qc.invalidateQueries({ queryKey: ['settings'] }) },
    onError: (e: Error) => setMsg(e.message),
  })

  const shown = (f: (typeof FIELDS)[number]) => {
    if (draft[f.key] !== undefined) return draft[f.key]
    const v = data?.[f.key]
    return v === undefined ? '' : String(f.paise ? v / 100 : v)
  }

  return (
    <Screen title="Settings" back={back}>
      {FIELDS.map((f) => (
        <label key={f.key} className="block text-sm">{f.label}
          <input className={inputCls} inputMode="decimal" value={shown(f)}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value.replace(/[^\d.]/g, '') })} />
        </label>
      ))}
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-4">
        <div className="mx-auto max-w-xl"><Button onClick={() => save.mutate()}>Save settings</Button></div>
      </div>
    </Screen>
  )
}
