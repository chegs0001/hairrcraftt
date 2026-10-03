export interface GridRow {
  staff_id: string; name: string; branch_id: string; date: string; status: string
  in_at: string | null; out_at: string | null; worked_minutes: number | null; short_minutes: number
  auto_closed: boolean; corrected: boolean; in_photo: string | null; out_photo: string | null; in_accuracy: number | null
}

export const STATUS: Record<string, { label: string; cls: string }> = {
  present: { label: 'Present', cls: 'bg-green-100 text-green-800' },
  present_short: { label: 'Present (short)', cls: 'bg-lime-100 text-lime-800' },
  half_day: { label: 'Half day', cls: 'bg-amber-100 text-amber-800' },
  absent: { label: 'Absent', cls: 'bg-red-100 text-red-700' },
  extra_day: { label: 'Extra day', cls: 'bg-blue-100 text-blue-800' },
  extra_half: { label: 'Extra half', cls: 'bg-sky-100 text-sky-800' },
  leave: { label: 'Leave', cls: 'bg-purple-100 text-purple-800' },
  holiday: { label: 'Holiday', cls: 'bg-purple-100 text-purple-800' },
  off: { label: 'Weekly off', cls: 'bg-gray-100 text-gray-600' },
  open: { label: 'Working', cls: 'bg-emerald-100 text-emerald-800' },
  pending: { label: 'Not in yet', cls: 'bg-gray-100 text-gray-600' },
}

export const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '—'

export const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
