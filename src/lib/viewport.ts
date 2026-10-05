import { useEffect, useState } from 'react'

// How many pixels of the screen the on-screen keyboard covers (0 when it is closed).
// Bottom-anchored sheets and buttons lift by this much so they stay visible above the keyboard.
export function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop)
      setInset(covered > 80 ? covered : 0)        // ignore small changes such as a collapsing address bar
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])
  return inset
}
