import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import SalonTabs from '../components/SalonTabs'
import { BackLink, Button, Card, GhostButton, inputCls, Screen, Sheet } from '../components/ui'
import { rpc, useBranches } from '../lib/api'
import { istToday, STATUS, timeOf, type GridRow } from '../lib/attendance'
import { supabase } from '../lib/supabase'

function Selfie({ path }: { path: string | null }) {
  const { data } = useQuery({
    queryKey: ['selfie', path], enabled: !!path, staleTime: 50 * 60_000,
    queryFn: async () => (await supabase.storage.from('selfies').createSignedUrl(path!, 3600)).data?.signedUrl ?? null,
  })
  if (!path) return <div className="size-12 rounded-lg bg-gray-100" />
  return data ? <img src={data} alt="" className="size-12 rounded-lg object-cover" /> : <div className="size-12 rounded-lg bg-gray-100" />
}

export default function Attendance() {
  const qc = useQueryClient()
  const branches = useBranches().data ?? []
  const [branch, setBranch] = useState('')
  const [date, setDate] = useState(istToday())
  const [fixing, setFixing] = useState<GridRow | null>(null)
  const [inT, setInT] = useState('11:00')
  const [outT, setOutT] = useState('20:00')
  const [reason, setReason] = useState('')
  const [holiday, setHoliday] = useState('')
  const [msg, setMsg] = useState('')

  const rows = useQuery({
    queryKey: ['att-day', branch, date],
    queryFn: () => rpc<GridRow[]>('attendance_grid', { p_from: date, p_to: date, p_branch: branch || null }),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['att-day'] })
  const fail = (e: Error) => setMsg(e.message)

  const correct = useMutation({
    mutationFn: () => rpc('correct_attendance', { p_staff: fixing!.staff_id, p_date: date, p_in: inT, p_out: outT || null, p_reason: reason }),
    onSuccess: () => { setFixing(null); setReason(''); void refresh() }, onError: fail,
  })
  const markLeave = useMutation({
    mutationFn: async (r: GridRow) => {
      const { error } = await supabase.from('leaves').upsert({ staff_id: r.staff_id, date, status: 'active' }, { onConflict: 'staff_id,date' })
      if (error) throw new Error(error.message)
    },
    onSuccess: refresh, onError: fail,
  })
  const addHoliday = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('holidays').upsert({ branch_id: branch, date, name: holiday.trim(), status: 'active' }, { onConflict: 'branch_id,date' })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { setHoliday(''); setMsg('Holiday saved'); void refresh() }, onError: fail,
  })

  return (
    <Screen title="Attendance" back={<BackLink to="/more" />}>
      <SalonTabs value={branch} onChange={setBranch} />
      <input type="date" className={inputCls} value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} />
      {rows.data?.length === 0 && <p className="text-gray-500">No staff to show.</p>}
      {rows.data?.map((r) => {
        const st = STATUS[r.status] ?? { label: r.status, cls: 'bg-gray-100' }
        const code = branches.find((b) => b.id === r.branch_id)?.code
        return (
          <Card key={r.staff_id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.name} {!branch && code && <span className="text-xs text-gray-400">{code}</span>}</div>
                <div className="text-sm text-gray-500">{r.in_at ? `${timeOf(r.in_at)} – ${timeOf(r.out_at)}` : 'No check-in'}{r.short_minutes > 0 && ` · short ${r.short_minutes} min`}</div>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${st.cls}`}>{st.label}</span>
            </div>
            {(r.auto_closed || r.corrected || (r.in_accuracy ?? 0) > 100) && (
              <div className="flex flex-wrap gap-2 text-xs">
                {r.auto_closed && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">Auto-closed</span>}
                {r.corrected && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">Corrected</span>}
                {(r.in_accuracy ?? 0) > 100 && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">Weak GPS</span>}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Selfie path={r.in_photo} /><Selfie path={r.out_photo} />
              <div className="flex-1" />
              {r.status === 'absent' && <GhostButton className="min-h-10 text-sm" onClick={() => markLeave.mutate(r)}>Paid leave</GhostButton>}
              <GhostButton className="min-h-10 text-sm" onClick={() => { setFixing(r); setInT(r.in_at ? new Date(r.in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '11:00'); setOutT(r.out_at ? new Date(r.out_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '20:00') }}>Correct</GhostButton>
            </div>
          </Card>
        )
      })}

      {branch && (
        <Card className="space-y-2">
          <div className="font-semibold">Salon holiday on this date</div>
          <input className={inputCls} placeholder="Name, e.g. Diwali" value={holiday} onChange={(e) => setHoliday(e.target.value)} />
          <Button disabled={!holiday.trim()} onClick={() => addHoliday.mutate()}>Save holiday</Button>
        </Card>
      )}
      {msg && <p className="text-sm text-gray-700">{msg}</p>}

      <Sheet open={!!fixing} onClose={() => setFixing(null)} title={`Correct ${fixing?.name ?? ''}`}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Check-in<input className={inputCls} type="time" value={inT} onChange={(e) => setInT(e.target.value)} /></label>
          <label className="block text-sm">Check-out<input className={inputCls} type="time" value={outT} onChange={(e) => setOutT(e.target.value)} /></label>
        </div>
        <input className={`${inputCls} mt-3`} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button className="mt-4" disabled={!reason.trim() || correct.isPending} onClick={() => correct.mutate()}>Save correction</Button>
      </Sheet>
    </Screen>
  )
}
