import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, Card, GhostButton, inputCls, Screen } from '../components/ui'
import { DAYS, toPaise } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Branch, Staff, StaffTerms } from '../lib/types'

const back = <Link to="/more" className="px-2 py-2 text-xl">‹</Link>

export default function StaffPage() {
  const qc = useQueryClient()
  const { isAdmin } = useAuth()
  const [editing, setEditing] = useState<Staff | null>(null)
  const [adding, setAdding] = useState(false)

  const staff = useQuery({
    queryKey: ['staff'],
    queryFn: async () => (await supabase.from('staff').select('*').order('created_at')).data as Staff[],
  })
  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await supabase.from('branches').select('*').order('code')).data as Branch[],
  })
  const schedule = useQuery({
    queryKey: ['schedule'],
    queryFn: () => rpc<{ staff_id: string; weekly_off_day: number | null }[]>('staff_schedule'),
  })
  const terms = useQuery({    // salaries: admins only
    queryKey: ['terms'],
    enabled: isAdmin,
    queryFn: async () =>
      (await supabase.from('staff_terms').select('*').order('effective_from', { ascending: false })).data as StaffTerms[],
  })
  const currentTerms = (id: string) => terms.data?.find((t) => t.staff_id === id)
  const offDayOf = (id: string) => schedule.data?.find((s) => s.staff_id === id)?.weekly_off_day ?? null

  const deactivate = useMutation({
    mutationFn: async (s: Staff) => {
      const { error } = await supabase.from('staff').update({ status: 'inactive' }).eq('id', s.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  })

  if (editing || adding) {
    return (
      <StaffForm
        staff={editing}
        branches={branches.data ?? []}
        terms={editing ? currentTerms(editing.id) : undefined}
        offDay={editing ? offDayOf(editing.id) : null}
        isAdmin={isAdmin}
        onDone={() => {
          setEditing(null)
          setAdding(false)
          void qc.invalidateQueries({ queryKey: ['staff'] })
          void qc.invalidateQueries({ queryKey: ['terms'] })
          void qc.invalidateQueries({ queryKey: ['schedule'] })
        }}
      />
    )
  }

  const pending = staff.data?.filter((s) => s.status === 'pending') ?? []
  const rest = staff.data?.filter((s) => s.status !== 'pending') ?? []

  return (
    <Screen title="Staff" back={back}>
      {pending.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-amber-700">Waiting for approval</h2>
          {pending.map((s) => (
            <Card key={s.id} className="flex items-center justify-between gap-2 border-amber-300">
              <div className="min-w-0">
                <div className="truncate font-medium">{s.name || s.email}</div>
                <div className="truncate text-sm text-gray-500">{s.email}</div>
              </div>
              <GhostButton onClick={() => setEditing(s)}>Review</GhostButton>
            </Card>
          ))}
        </div>
      )}
      {[...(branches.data ?? []), null].map((b) => {
        const group = rest.filter((s) => (b ? s.branch_id === b.id : !s.branch_id || !branches.data?.some((x) => x.id === s.branch_id)))
        if (group.length === 0) return null
        return (
          <div key={b?.id ?? 'none'} className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500">
              <span className="rounded-md bg-violet-100 px-2 py-0.5 text-violet-800">{b?.code ?? '—'}</span>{b?.name ?? 'No salon assigned'}
            </h2>
            {group.map((s) => {
              const off = offDayOf(s.id)
              const roleLabel = s.is_admin ? 'admin' : s.role === 'manager' ? 'manager' : 'staff'
              return (
                <Card key={s.id} className={s.status === 'inactive' ? 'opacity-50' : ''}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{s.name || s.email}</div>
                      <div className="text-sm text-gray-500">
                        {roleLabel} · {s.status}{off !== null && ` · off ${DAYS[off]}`}{s.last_working_on && ` · last day ${s.last_working_on}`}
                      </div>
                    </div>
                    {(isAdmin || !s.is_admin) && <GhostButton onClick={() => setEditing(s)}>Edit</GhostButton>}
                  </div>
                  {isAdmin && s.status === 'active' && (
                    <button className="mt-2 text-sm text-red-600" onClick={() => confirm(`Deactivate ${s.name || s.email}?`) && deactivate.mutate(s)}>
                      Deactivate
                    </button>
                  )}
                </Card>
              )
            })}
          </div>
        )
      })}
      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-4">
        <div className="mx-auto max-w-xl"><Button onClick={() => setAdding(true)}>Add staff by Gmail</Button></div>
      </div>
    </Screen>
  )
}

function StaffForm({ staff, branches, terms, offDay: currentOff, isAdmin, onDone }: {
  staff: Staff | null; branches: Branch[]; terms?: StaffTerms; offDay: number | null; isAdmin: boolean; onDone: () => void
}) {
  const [email, setEmail] = useState(staff?.email ?? '')
  const [name, setName] = useState(staff?.name ?? '')
  const [phone, setPhone] = useState(staff?.phone ?? '')
  const [level, setLevel] = useState<'member' | 'manager' | 'admin'>(staff?.is_admin ? 'admin' : staff?.role ?? 'member')
  const [branchId, setBranchId] = useState(staff?.branch_id ?? '')
  const [shiftStart, setShiftStart] = useState((staff?.shift_start ?? '11:00').slice(0, 5))
  const [shiftEnd, setShiftEnd] = useState((staff?.shift_end ?? '20:00').slice(0, 5))
  const [salary, setSalary] = useState(terms ? String(terms.monthly_salary / 100) : '')
  const [offDay, setOffDay] = useState(terms?.weekly_off_day ?? currentOff ?? 1)
  const [joinedOn, setJoinedOn] = useState(staff?.joined_on ?? '')
  const [lastOn, setLastOn] = useState(staff?.last_working_on ?? '')
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      // Managers approve and schedule. Roles, dates and deactivation belong to admins (the database enforces it too).
      const row = {
        email: email.trim().toLowerCase(), name: name.trim(), phone: phone.trim() || null,
        branch_id: branchId || null, shift_start: shiftStart, shift_end: shiftEnd,
        status: isAdmin ? ('active' as const) : staff && staff.status !== 'pending' ? staff.status : ('active' as const),
        ...(isAdmin ? {
          role: level === 'member' ? 'member' : 'manager', is_admin: level === 'admin',
          ...(joinedOn ? { joined_on: joinedOn } : {}), last_working_on: lastOn || null,
        } : {}),
      }
      let id = staff?.id
      if (staff) {
        const { error } = await supabase.from('staff').update(row).eq('id', staff.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('staff').insert(row).select('id').single()
        if (error) throw error
        id = data.id
      }
      if (!isAdmin) {
        if (id && offDay !== currentOff) await rpc('set_weekly_off', { p_staff: id, p_day: offDay })
        return
      }
      const paise = toPaise(Number(salary || 0))
      const changed = !terms || terms.monthly_salary !== paise || terms.weekly_off_day !== offDay
      if (changed && id) {
        const { error } = await supabase.from('staff_terms').upsert(
          { staff_id: id, monthly_salary: paise, weekly_off_day: offDay,
            effective_from: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) },
          { onConflict: 'staff_id,effective_from' })
        if (error) throw error
      }
    },
    onSuccess: onDone,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <Screen title={staff ? 'Edit staff' : 'Add staff'} back={<button className="px-2 py-2 text-xl" onClick={onDone}>‹</button>}>
      <label className="block text-sm">Gmail
        <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!staff} />
      </label>
      <label className="block text-sm">Name
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block text-sm">Phone
        <input className={inputCls} inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      {!branchId && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Choose which salon this person works in. They can only see and bill for that salon.</p>}
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">Role
          <select className={inputCls} value={level} disabled={!isAdmin} onChange={(e) => setLevel(e.target.value as typeof level)}>
            <option value="member">Staff</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="block text-sm">Home salon
          <select className={inputCls} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="" disabled>Choose salon…</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">Shift start
          <input className={inputCls} type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
        </label>
        <label className="block text-sm">Shift end
          <input className={inputCls} type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
        </label>
        {isAdmin && (
          <label className="block text-sm">Monthly salary (₹)
            <input className={inputCls} inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value.replace(/\D/g, ''))} />
          </label>
        )}
        <label className="block text-sm">Weekly off
          <select className={inputCls} value={offDay} onChange={(e) => setOffDay(Number(e.target.value))}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
      </div>
      {isAdmin && (
        <>
      <label className="block text-sm">Joining date: pay starts from this day
        <input className={inputCls} type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} />
        <span className="text-xs text-gray-500">You can move it later, but only to a date after the last month already paid.</span>
      </label>
      <label className="block text-sm">Last working date (optional)
        <input className={inputCls} type="date" value={lastOn} onChange={(e) => setLastOn(e.target.value)} />
        <span className="text-xs text-gray-500">After this date they can no longer sign in. Settle their remaining pay from Payroll, whenever you like.</span>
      </label>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-4">
        <div className="mx-auto max-w-xl">
          <Button disabled={save.isPending || !email || !branchId} onClick={() => save.mutate()}>
            {staff?.status === 'pending' ? 'Approve' : 'Save'}
          </Button>
        </div>
      </div>
    </Screen>
  )
}
