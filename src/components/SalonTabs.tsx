import { useBranches } from '../lib/api'

// '' = both salons. Used wherever a manager can switch salon.
export default function SalonTabs({ value, onChange, allowAll = true }: { value: string; onChange: (id: string) => void; allowAll?: boolean }) {
  const branches = useBranches().data ?? []
  const tabs = [...branches.map((b) => ({ id: b.id, label: b.code })), ...(allowAll ? [{ id: '', label: 'Both' }] : [])]
  return (
    <div className="flex gap-2">
      {tabs.map((t) => (
        <button key={t.id || 'all'} onClick={() => onChange(t.id)}
          className={`min-h-12 flex-1 rounded-xl border text-sm font-semibold ${value === t.id ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300'}`}>{t.label}</button>
      ))}
    </div>
  )
}
