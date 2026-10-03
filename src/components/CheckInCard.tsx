import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { rpc, useBranches } from '../lib/api'
import { istToday, timeOf } from '../lib/attendance'
import { useAuth } from '../lib/auth'
import { distanceM, usePosition } from '../lib/geo'
import { supabase } from '../lib/supabase'
import SelfieCapture from './SelfieCapture'
import { Card } from './ui'

interface Record { id: string; date: string; in_at: string; out_at: string | null; status: string }

export default function CheckInCard() {
  const qc = useQueryClient()
  const { staff } = useAuth()
  const salon = useBranches().data?.find((b) => b.id === staff?.branch_id)
  const { fix, error: gpsError } = usePosition()
  const [camera, setCamera] = useState(false)
  const [error, setError] = useState('')

  const rec = useQuery({
    queryKey: ['my-attendance-today', staff?.id],
    enabled: !!staff,
    queryFn: async () => {
      const today = istToday()
      const { data } = await supabase.from('attendance').select('id,date,in_at,out_at,status')
        .eq('staff_id', staff!.id).order('date', { ascending: false }).limit(1)
      const r = (data?.[0] ?? null) as Record | null
      return r && (r.date === today || !r.out_at) ? r : null
    },
  })

  const isOut = !!rec.data && !rec.data.out_at
  const finished = !!rec.data?.out_at

  let block = ''
  let dist: number | null = null
  if (!salon) block = 'No salon assigned. Ask the manager.'
  else if (salon.lat == null || salon.lng == null) block = 'The salon location is not set yet. Ask the manager to set it.'
  else if (gpsError) block = gpsError
  else if (!fix) block = 'Finding your location…'
  else {
    dist = distanceM(fix, { lat: salon.lat, lng: salon.lng })
    if (fix.accuracy > 150) block = `GPS is weak (${Math.round(fix.accuracy)} m). Move near a window or outside.`
    else if (dist > salon.geofence_radius_m) block = `Move closer to ${salon.name} (${Math.round(dist)} m away).`
  }

  const submit = useMutation({
    mutationFn: async (photo: Blob) => {
      if (!fix || !staff) throw new Error('Location not available')
      const path = `${staff.id}/${istToday()}-${isOut ? 'out' : 'in'}.jpg`
      const up = await supabase.storage.from('selfies').upload(path, photo, { contentType: 'image/jpeg', upsert: true })
      if (up.error) throw new Error(`Selfie upload failed: ${up.error.message}`)
      return rpc(isOut ? 'check_out' : 'check_in', { p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy, p_photo: path })
    },
    onSuccess: () => { setCamera(false); void qc.invalidateQueries({ queryKey: ['my-attendance-today'] }) },
    onError: (e: Error) => { setCamera(false); setError(e.message) },
  })

  if (rec.isLoading) return null
  return (
    <Card className="space-y-3">
      {finished ? (
        <div className="text-center">
          <div className="font-semibold text-green-700">Done for today</div>
          <div className="text-sm text-gray-500">In {timeOf(rec.data!.in_at)} · Out {timeOf(rec.data!.out_at)}</div>
        </div>
      ) : (
        <>
          {isOut && <div className="text-center text-sm text-gray-500">Checked in at {timeOf(rec.data!.in_at)}</div>}
          <button disabled={!!block || submit.isPending} onClick={() => { setError(''); setCamera(true) }}
            className={`min-h-20 w-full rounded-2xl text-xl font-bold text-white disabled:opacity-40 ${isOut ? 'bg-orange-500' : 'bg-green-600'}`}>
            {isOut ? 'Check out' : 'Check in'}
          </button>
          {block ? <p className="text-center text-sm text-amber-700">{block}</p>
            : <p className="text-center text-sm text-green-700">You are at the salon{dist !== null && ` (${Math.round(dist)} m)`}</p>}
        </>
      )}
      {error && <p className="text-center text-sm text-red-600">{error}</p>}
      <SelfieCapture open={camera} onClose={() => setCamera(false)} title={isOut ? 'Check-out selfie' : 'Check-in selfie'} onCapture={(b) => submit.mutate(b)} />
    </Card>
  )
}
