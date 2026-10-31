import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react'

const ViewActive = createContext(true)

// Vrai si l'écran est celui affiché (les autres restent ouverts en arrière-plan).
export const useViewActive = () => useContext(ViewActive)

// Écran gardé ouvert quand on en change : en y revenant, on retrouve tout comme on l'avait laissé
// (projet ouvert, étape, recherche, position dans la page). Les positions de défilement sont notées au fil
// de l'eau, car un élément masqué perd la sienne.
export function KeepAlive({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const scrolls = useRef(new Map<Element, number>())

  useLayoutEffect(() => {
    if (!active) return
    for (const [el, top] of scrolls.current) {
      if (el.isConnected) el.scrollTop = top
      else scrolls.current.delete(el)
    }
  }, [active])

  return (
    <div
      ref={ref}
      className="view"
      hidden={!active}
      onScrollCapture={(e) => {
        if (active && e.target instanceof Element) scrolls.current.set(e.target, e.target.scrollTop)
      }}
    >
      <ViewActive.Provider value={active}>{children}</ViewActive.Provider>
    </div>
  )
}
