import { useEffect, useState } from 'react'

export interface Fix { lat: number; lng: number; accuracy: number }

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Live high-accuracy position. error is a plain-language fix for the person at the counter.
export function usePosition() {
  const [fix, setFix] = useState<Fix | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!navigator.geolocation) { setError('This phone cannot share its location.'); return }
    const id = navigator.geolocation.watchPosition(
      (p) => { setError(''); setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }) },
      (e) => setError(e.code === 1
        ? 'Location is blocked. Allow location for this site in your browser settings, then reload.'
        : 'Could not get your location. Turn on GPS and try again.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])
  return { fix, error }
}
