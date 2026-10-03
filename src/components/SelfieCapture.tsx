import { useEffect, useRef, useState } from 'react'
import { Button, Sheet } from './ui'

// Live camera only (no gallery). Returns a ~640 px JPEG.
export default function SelfieCapture({ open, onClose, onCapture, title }: {
  open: boolean; onClose: () => void; onCapture: (b: Blob) => void; title: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let stream: MediaStream | undefined
    setError('')
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false })
      .then((s) => { stream = s; if (video.current) { video.current.srcObject = s; void video.current.play() } })
      .catch(() => setError('Camera is blocked. Allow camera access for this site in your browser settings, then try again.'))
    return () => stream?.getTracks().forEach((t) => t.stop())
  }, [open])

  const snap = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(v.videoWidth * scale)
    c.height = Math.round(v.videoHeight * scale)
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
    c.toBlob((b) => b && onCapture(b), 'image/jpeg', 0.6)
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {error ? <p className="text-sm text-red-600">{error}</p> : (
        <>
          <video ref={video} playsInline muted className="aspect-[3/4] w-full -scale-x-100 rounded-2xl bg-black object-cover" />
          <Button className="mt-4" onClick={snap}>Take selfie</Button>
        </>
      )}
    </Sheet>
  )
}
