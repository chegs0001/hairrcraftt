import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, inputCls, Screen } from '../components/ui'
import { supabase } from '../lib/supabase'
import type { Branch } from '../lib/types'
import { useState } from 'react'

const back = <Link to="/more" className="px-2 py-2 text-xl">‹</Link>

export default function Salons() {
  const { data } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await supabase.from('branches').select('*').order('code')).data as Branch[],
  })
  return (
    <Screen title="Salons" back={back}>
      {data?.map((b) => <SalonCard key={b.id} branch={b} />)}
    </Screen>
  )
}

function SalonCard({ branch }: { branch: Branch }) {
  const qc = useQueryClient()
  const [name, setName] = useState(branch.name)
  const [address, setAddress] = useState(branch.address ?? '')
  const [radius, setRadius] = useState(String(branch.geofence_radius_m))
  const [msg, setMsg] = useState('')

  const save = useMutation({
    mutationFn: async (patch: Partial<Branch>) => {
      const { error } = await supabase.from('branches').update(patch).eq('id', branch.id)
      if (error) throw error
    },
    onSuccess: () => { setMsg('Saved'); void qc.invalidateQueries({ queryKey: ['branches'] }) },
    onError: (e: Error) => setMsg(e.message),
  })

  // The manager stands inside the salon and taps this to store the exact GPS fix.
  const setLocation = () =>
    navigator.geolocation.getCurrentPosition(
      (p) => save.mutate({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setMsg('Location is off or blocked. Allow location for this site and try again.'),
      { enableHighAccuracy: true, timeout: 15000 },
    )

  return (
    <Card className="space-y-3">
      <div className="font-bold">{branch.code}</div>
      <label className="block text-sm">Name
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block text-sm">Address
        <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="block text-sm">Geo-fence radius (m)
        <input className={inputCls} inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value.replace(/\D/g, ''))} />
      </label>
      <div className="text-sm text-gray-500">
        {branch.lat != null ? `Location set: ${branch.lat.toFixed(5)}, ${branch.lng?.toFixed(5)}` : 'Location not set'}
      </div>
      <Button onClick={setLocation}>Set location (stand inside the salon)</Button>
      <Button
        className="bg-gray-900"
        onClick={() => save.mutate({ name, address: address || null, geofence_radius_m: Number(radius) || 100 })}
      >Save</Button>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
    </Card>
  )
}
