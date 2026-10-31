import { useEffect, useRef } from 'react'

// Demande à toutes les saisies en attente de s'enregistrer tout de suite (bouton « Enregistrer », ⌘S).
export const FLUSH_EVENT = 'mdeko:flush'

// Termine la saisie en cours (les champs qui s'enregistrent en quittant le champ le font alors)
// et enregistre les autres saisies en attente ; le curseur reste là où il était.
export async function flushEdits(): Promise<void> {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur()
    active.focus({ preventScroll: true })
  }
  window.dispatchEvent(new Event(FLUSH_EVENT))
  // Laisse le temps aux enregistrements de parvenir à la base.
  await new Promise((resolve) => setTimeout(resolve, 300))
}

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

  useEffect(() => {
    const flush = () => {
      if (!pending.current) return
      const { value } = pending.current
      pending.current = null
      saveRef.current(value)
    }
    window.addEventListener(FLUSH_EVENT, flush)
    return () => {
      window.removeEventListener(FLUSH_EVENT, flush)
      flush()
    }
  }, [])
}
