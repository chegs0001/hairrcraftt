import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BackLink, Card, GhostButton, Screen } from '../components/ui'
import { rpc, useBranches, useTeam } from '../lib/api'
import { rupees, shortDate } from '../lib/format'
import { supabase } from '../lib/supabase'

interface Flag { id: string; created_at: string; type: string; branch_id: string | null; staff_id: string | null; amount: number | null
  ref_table: string | null; ref_id: string | null; note: string | null; seen_at: string | null }

export const FLAG_LABEL: Record<string, string> = {
  price_below_list: 'Price below list', bill_discount: 'Bill discount', visit_cancelled: 'Visit cancelled with services',
  cash_difference: 'Cash difference at closing', due_adjusted: 'Due adjusted or written off', closed_day_edited: 'Closed day edited',
  day_reopened: 'Day reopened', day_not_closed: 'Day not closed by 23:00', poor_gps: 'Weak GPS accuracy',
  auto_closed_checkout: 'Auto-closed check-out', attendance_corrected: 'Attendance corrected',
}

const linkFor = (f: Flag) =>
  f.ref_table === 'visits' && f.ref_id ? `/visit/${f.ref_id}`
  : f.ref_table === 'clients' && f.ref_id ? `/client/${f.ref_id}`
  : f.ref_table === 'attendance' ? '/attendance'
  : f.ref_table === 'day_closings' || f.type.startsWith('day_') ? '/close-day' : null

export default function Flags() {
  const qc = useQueryClient()
  const branches = useBranches().data ?? []
  const team = useTeam().data ?? []
  const [onlyNew, setOnlyNew] = useState(true)
  const list = useQuery({
    queryKey: ['flags'],
    queryFn: async () => (await supabase.from('flags').select('*').order('created_at', { ascending: false }).limit(300)).data as Flag[],
  })
  const see = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => rpc('see_flag', { p_id: id, p_note: note }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['flags'] }); void qc.invalidateQueries({ queryKey: ['flag-count'] }) },
  })
  const rows = (list.data ?? []).filter((f) => !onlyNew || !f.seen_at)

  return (
    <Screen title="Flags" back={<BackLink to="/dashboard" />}>
      <div className="flex gap-2">
        {[true, false].map((v) => (
          <button key={String(v)} onClick={() => setOnlyNew(v)}
            className={`min-h-12 flex-1 rounded-xl border text-sm font-semibold ${onlyNew === v ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300'}`}>{v ? 'Not seen' : 'All'}</button>
        ))}
      </div>
      {rows.length === 0 && <p className="text-gray-500">Nothing here.</p>}
      {rows.map((f) => {
        const link = linkFor(f)
        return (
          <Card key={f.id} className={`space-y-1 ${f.seen_at ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{FLAG_LABEL[f.type] ?? f.type}</div>
              {f.amount !== null && <div className="shrink-0 font-semibold">{f.amount < 0 ? '−' : ''}{rupees(Math.abs(f.amount))}</div>}
            </div>
            <div className="text-xs text-gray-500">
              {shortDate(f.created_at)} · {branches.find((b) => b.id === f.branch_id)?.code ?? '—'}
              {f.staff_id && ` · ${team.find((s) => s.id === f.staff_id)?.name || 'Staff'}`}
            </div>
            {f.note && <div className="whitespace-pre-line text-sm text-gray-700">{f.note}</div>}
            <div className="flex gap-2 pt-1">
              {link && <Link to={link} className="flex min-h-10 items-center rounded-xl border px-4 text-sm">Open</Link>}
              {!f.seen_at && <GhostButton className="min-h-10 text-sm" onClick={() => see.mutate({ id: f.id, note: '' })}>Mark seen</GhostButton>}
              <GhostButton className="min-h-10 text-sm" onClick={() => { const n = prompt('Add a note'); if (n) see.mutate({ id: f.id, note: n }) }}>Add note</GhostButton>
            </div>
          </Card>
        )
      })}
    </Screen>
  )
}
