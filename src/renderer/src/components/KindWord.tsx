import { useEffect, useState } from 'react'
import { pickKindWord, type KindWordState } from '@shared/kind-word'

// Petit mot affectueux, de temps en temps à l'ouverture (voir shared/kind-word.ts). Se ferme d'un clic.
const STORAGE_KEY = 'mdeko.kindWord'

function readState(): KindWordState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<KindWordState> | null
    return { next: typeof saved?.next === 'number' ? saved.next : null, last: typeof saved?.last === 'number' ? saved.last : null }
  } catch {
    return { next: null, last: null }
  }
}

// Tiré une seule fois par ouverture (React peut monter le composant deux fois en développement).
let picked: { text: string | null } | null = null

export function KindWord() {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    if (!picked) {
      const result = pickKindWord(new Date(), readState())
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result.state))
      picked = { text: result.text }
    }
    if (!picked.text) return
    // Un peu après l'ouverture, le temps que la fenêtre s'affiche.
    const shown = picked.text
    const timer = setTimeout(() => setText(shown), 1500)
    return () => clearTimeout(timer)
  }, [])

  if (!text) return null
  return (
    <div className="kind-word" role="status">
      <p>{text}</p>
      <button type="button" className="button" onClick={() => setText(null)}>
        Merci !
      </button>
    </div>
  )
}
