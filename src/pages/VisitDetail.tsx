import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AddService from '../components/AddService'
import ClientCard from '../components/ClientCard'
import { ActionBar, BackLink, Button, Card, GhostButton, inputCls, Screen, Sheet } from '../components/ui'
import { rpc, useClientCard, useTeam } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rupees } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Visit, VisitLine } from '../lib/types'

export const visitKey = (id?: string) => ['visit', id]

export default function VisitDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { staff, isManager } = useAuth()
  const team = useTeam()
  const [adding, setAdding] = useState(false)
  const [helperFor, setHelperFor] = useState<VisitLine | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')

  const { data } = useQuery({
    queryKey: visitKey(id),
    queryFn: async () => {
      const v = await supabase.from('visits').select('*,clients(*)').eq('id', id!).single()
      const l = await supabase.from('visit_lines').select('*,visit_line_staff(staff_id,share)').eq('visit_id', id!).eq('status', 'active').order('created_at')
      if (v.error) throw v.error
      return { visit: v.data as unknown as Visit, lines: (l.data ?? []) as VisitLine[] }
    },
  })
  const card = useClientCard(data?.visit.clients)
  const refresh = () => qc.invalidateQueries({ queryKey: visitKey(id) })
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  })

  if (!data) return <Screen title="Visit" back={<BackLink to="/visits" />}>{null}</Screen>
  const { visit, lines } = data
  const services = lines.filter((l) => l.kind === 'service')
  const allDone = services.length > 0 && services.every((l) => l.done_at)
  const open = visit.status === 'open'
  const nameOf = (sid: string) => team.data?.find((t) => t.id === sid)?.name || 'Staff'

  // group lines under the first staff member credited on them
  const groups = new Map<string, VisitLine[]>()
  for (const l of services) {
    const k = l.visit_line_staff[0]?.staff_id ?? 'none'
    groups.set(k, [...(groups.get(k) ?? []), l])
  }

  return (
    <Screen title={visit.clients.name} back={<BackLink to="/visits" />}>
      <ClientCard client={visit.clients} link />
      {!open && <p className="rounded-xl bg-gray-100 p-3 text-sm">This visit is {visit.status}.</p>}

      {[...groups.entries()].map(([sid, ls]) => (
        <div key={sid} className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500">{nameOf(sid)}{sid === staff?.id && ' (you)'}</h2>
          {ls.map((l) => {
            const mine = isManager || l.created_by === (staff?.auth_user_id ?? '')
            const onLine = isManager || l.visit_line_staff.some((s) => s.staff_id === staff?.id)
            return (
              <Card key={l.id} className={l.done_at ? 'border-green-300 bg-green-50' : ''}>
                <div className="flex items-start gap-3">
                  <button disabled={!open || !onLine || run.isPending} aria-label="Mark completed"
                    onClick={() => run.mutate(() => rpc('set_line_done', { p_line: l.id, p_done: !l.done_at }))}
                    className={`mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-xl border-2 text-2xl ${l.done_at ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300'}`}>
                    {l.done_at ? '✓' : ''}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{l.name}{l.qty > 1 && ` ×${l.qty}`}</div>
                    <div className="text-sm text-gray-600">
                      {rupees(l.price * l.qty)}{l.flagged && <span className="ml-2 text-red-600">⚑ below list ({l.flag_reason})</span>}
                    </div>
                    {l.visit_line_staff.length > 1 && (
                      <div className="text-xs text-gray-500">{l.visit_line_staff.map((s) => nameOf(s.staff_id)).join(' + ')}</div>
                    )}
                    {open && (
                      <div className="mt-1 flex gap-4 text-sm">
                        {onLine && <button className="py-2 text-violet-700" onClick={() => setHelperFor(l)}>+ Helper</button>}
                        {mine && <button className="py-2 text-red-600" onClick={() => confirm('Remove this service?') && run.mutate(() => rpc('remove_line', { p_line: l.id }))}>Remove</button>}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      ))}
      {services.length === 0 && <p className="text-gray-500">No services yet.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {open && (
        <>
          <GhostButton className="w-full" onClick={() => setAdding(true)}>+ Add service</GhostButton>
          <button className="py-3 text-sm text-red-600" onClick={() => setCancelling(true)}>Cancel visit</button>
          <ActionBar>
            <Link to={allDone ? `/visit/${visit.id}/bill` : '#'} aria-disabled={!allDone}
              className={`flex min-h-12 w-full items-center justify-center rounded-xl font-semibold text-white ${allDone ? 'bg-violet-600' : 'bg-gray-300'}`}>
              {allDone ? 'Go to billing' : 'Tick every service as done to bill'}
            </Link>
          </ActionBar>
        </>
      )}

      <AddService open={adding} onClose={() => setAdding(false)} visitId={visit.id} clientId={visit.client_id} isPrime={!!card.data?.card?.prime_until} />

      <HelperSheet line={helperFor} onClose={() => setHelperFor(null)}
        team={(team.data ?? []).filter((t) => t.branch_id === visit.branch_id)}
        onSave={(ids) => { run.mutate(() => rpc('set_line_helpers', { p_line: helperFor!.id, p_staff: ids })); setHelperFor(null) }} />

      <CancelSheet open={cancelling} onClose={() => setCancelling(false)}
        onConfirm={async (reason) => {
          try { await rpc('cancel_visit', { p_visit: visit.id, p_reason: reason }); void qc.invalidateQueries({ queryKey: ['open-visits'] }); nav('/visits', { replace: true }) }
          catch (e) { setError((e as Error).message); setCancelling(false) }
        }} />
    </Screen>
  )
}

function HelperSheet({ line, onClose, team, onSave }: {
  line: VisitLine | null; onClose: () => void; team: { id: string; name: string; email: string }[]; onSave: (ids: string[]) => void
}) {
  const [sel, setSel] = useState<string[] | null>(null)
  const current = sel ?? line?.visit_line_staff.map((s) => s.staff_id) ?? []
  const toggle = (id: string) => setSel(current.includes(id) ? current.filter((x) => x !== id) : [...current, id])
  return (
    <Sheet open={!!line} onClose={() => { setSel(null); onClose() }} title="Who worked on this?">
      <p className="mb-3 text-sm text-gray-500">The value is split equally between everyone ticked.</p>
      {team.map((t) => (
        <label key={t.id} className="flex min-h-12 items-center gap-3 border-b">
          <input type="checkbox" className="size-6" checked={current.includes(t.id)} onChange={() => toggle(t.id)} />
          {t.name || t.email}
        </label>
      ))}
      <Button className="mt-4" disabled={current.length === 0} onClick={() => { onSave(current); setSel(null) }}>Save</Button>
    </Sheet>
  )
}

function CancelSheet({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  return (
    <Sheet open={open} onClose={onClose} title="Cancel this visit?">
      <input className={inputCls} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button className="mt-4 bg-red-600" disabled={!reason.trim()} onClick={() => onConfirm(reason)}>Cancel visit</Button>
    </Sheet>
  )
}
