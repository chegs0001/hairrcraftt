import { useEffect, useState } from 'react'
import { Card } from './ui'

interface InstallEvent extends Event { prompt: () => Promise<void> }
const KEY = 'install-prompt-dismissed'

// "Add to Home Screen": a button on Android, step-by-step instructions on iPhone.
export default function InstallPrompt() {
  const [evt, setEvt] = useState<InstallEvent | null>(null)
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  if (hidden || standalone || (!evt && !ios)) return null
  const dismiss = () => { setHidden(true); try { localStorage.setItem(KEY, '1') } catch { /* private mode */ } }
  return (
    <Card className="space-y-2 border-violet-200 bg-violet-50 text-sm">
      <div className="font-semibold">Install HairrCraftt on your phone</div>
      {evt
        ? <button className="min-h-12 w-full rounded-xl bg-violet-600 font-semibold text-white" onClick={() => { void evt.prompt(); dismiss() }}>Add to Home Screen</button>
        : <p>Tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>.</p>}
      <button className="py-1 text-gray-500" onClick={dismiss}>Not now</button>
    </Card>
  )
}
