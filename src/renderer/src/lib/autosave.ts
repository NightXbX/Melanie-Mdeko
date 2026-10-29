import { useEffect, useRef } from 'react'

// Enregistre automatiquement une saisie après une courte pause, et au plus tard en quittant l'écran.
export function useAutosave<T>(value: T, save: (value: T) => void, delay = 600): void {
  const saveRef = useRef(save)
  saveRef.current = save
  const pending = useRef<{ value: T } | null>(null)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    pending.current = { value }
    const t = setTimeout(() => {
      pending.current = null
      saveRef.current(value)
    }, delay)
    return () => clearTimeout(t)
  }, [value, delay])

  useEffect(
    () => () => {
      if (pending.current) saveRef.current(pending.current.value)
    },
    []
  )
}
