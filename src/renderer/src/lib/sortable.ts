import { useState, type DragEvent, type HTMLAttributes } from 'react'

// Glisser-déposer pour ranger des listes (articles, pièces, teintes…) : on attrape un élément et on le
// lâche avant ou après un autre, ou dans une zone (une pièce vide, « Mon choix »).
// Un seul déplacement à la fois dans toute l'appli : on retient ce qui est en train d'être déplacé.
let dragged: { kind: string; id: number; zone?: string } | null = null

const TYPE = 'application/x-mdeko-move'

// Défilement automatique pendant un déplacement : près du haut ou du bas d'une liste qui défile, elle défile
// toute seule (plus vite près du bord), pour amener un élément loin sans lâcher la souris.
const EDGE = 80
function scrollableParent(el: Element | null): HTMLElement | null {
  for (let n = el; n; n = n.parentElement) {
    if (n instanceof HTMLElement && n.scrollHeight > n.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n
  }
  return null
}
if (typeof document !== 'undefined') {
  document.addEventListener('dragover', (e) => {
    if (!dragged) return
    const box = scrollableParent(e.target as Element)
    if (!box) return
    const r = box.getBoundingClientRect()
    const top = e.clientY - r.top
    const bottom = r.bottom - e.clientY
    if (top < EDGE) box.scrollBy(0, -Math.ceil(((EDGE - top) / EDGE) * 24))
    else if (bottom < EDGE) box.scrollBy(0, Math.ceil(((EDGE - bottom) / EDGE) * 24))
  })
}

export interface Drop {
  id: number // élément déplacé
  target: number | null // élément sur lequel on le lâche (null : la zone elle-même)
  after: boolean // à placer après la cible plutôt qu'avant
  zone?: string // zone d'arrivée
  from?: string // zone de départ (pour passer d'une liste à une autre)
}

interface Options {
  axis?: 'vertical' | 'horizontal'
  onDrop(drop: Drop): void
}

export function useSortable(kind: string, { axis = 'vertical', onDrop }: Options) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<{ key: string; after: boolean } | null>(null)

  const accepts = () => dragged?.kind === kind
  const half = (e: DragEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return axis === 'vertical' ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2
  }
  // Dans une zone, l'élément le plus proche du pointeur : on place avant celui dont le milieu est plus bas
  // (ou plus à droite), sinon après le dernier. Lâcher dans un espace vide, sur le titre d'une pièce ou entre
  // deux cartes place donc l'élément là où l'on pointe.
  const nearest = (e: DragEvent<HTMLElement>): { id: number; after: boolean } | null => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(`[data-sort-kind="${kind}"]`)].filter(
      (el) => el.closest('[data-sort-zone]') === e.currentTarget
    )
    if (!items.length) return null
    for (const el of items) {
      const r = el.getBoundingClientRect()
      const middle = axis === 'vertical' ? r.top + r.height / 2 : r.left + r.width / 2
      if ((axis === 'vertical' ? e.clientY : e.clientX) < middle) return { id: Number(el.dataset.sortId), after: false }
    }
    return { id: Number(items[items.length - 1].dataset.sortId), after: true }
  }
  const end = () => {
    dragged = null
    setDragging(null)
    setOver(null)
  }

  // Élément que l'on peut attraper et devant lequel on peut en lâcher un autre.
  function item(id: number, zone?: string): HTMLAttributes<HTMLElement> & { draggable: boolean; 'data-drop'?: string } {
    const key = `item:${id}`
    return {
      draggable: true,
      ...({ 'data-sort-kind': kind, 'data-sort-id': String(id) } as object),
      'data-drop': dragging === id ? 'dragging' : over?.key === key ? (over.after ? 'after' : 'before') : undefined,
      onDragStart: (e) => {
        e.stopPropagation()
        dragged = { kind, id, zone }
        e.dataTransfer.effectAllowed = 'copyMove'
        e.dataTransfer.setData(TYPE, String(id))
        setDragging(id)
      },
      onDragOver: (e) => {
        if (!accepts()) return
        e.preventDefault()
        e.stopPropagation()
        const after = half(e)
        if (over?.key !== key || over.after !== after) setOver({ key, after })
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node) && over?.key === key) setOver(null)
      },
      onDrop: (e) => {
        if (!accepts()) return
        e.preventDefault()
        e.stopPropagation()
        const { id: moved, zone: from } = dragged!
        const after = half(e)
        end()
        if (moved !== id || from !== zone) onDrop({ id: moved, target: id, after, zone, from })
      },
      onDragEnd: end
    }
  }

  // Zone qui reçoit un élément lâché à côté des autres (fin de liste, pièce vide, « Mon choix »).
  function zone(name: string, options: { nearest?: boolean } = {}): HTMLAttributes<HTMLElement> & { 'data-drop'?: string } {
    const key = `zone:${name}`
    const near = options.nearest ?? true
    return {
      ...({ 'data-sort-zone': name } as object),
      'data-drop': over?.key === key ? 'inside' : undefined,
      onDragOver: (e) => {
        if (!accepts()) return
        e.preventDefault()
        const n = near ? nearest(e) : null
        const next = n && n.id !== dragged!.id ? { key: `item:${n.id}`, after: n.after } : { key, after: true }
        if (over?.key !== next.key || over.after !== next.after) setOver(next)
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node) && over) setOver(null)
      },
      onDrop: (e) => {
        if (!accepts()) return
        e.preventDefault()
        e.stopPropagation()
        const { id: moved, zone: from } = dragged!
        const n = near ? nearest(e) : null
        end()
        if (n && n.id === moved) return
        onDrop({ id: moved, target: n?.id ?? null, after: n?.after ?? true, zone: name, from })
      }
    }
  }

  return { item, zone, dragging }
}

// Nouvel ordre d'une liste d'identifiants après un dépôt.
export function moved(ids: number[], drop: Drop): number[] {
  const rest = ids.filter((id) => id !== drop.id)
  if (drop.target === null) return [...rest, drop.id]
  const at = rest.indexOf(drop.target)
  if (at < 0) return [...rest, drop.id]
  rest.splice(drop.after ? at + 1 : at, 0, drop.id)
  return rest
}

// Le passage d'un fichier depuis le Finder ne doit pas être pris pour un rangement.
export const isMove = (e: DragEvent) => e.dataTransfer.types.includes(TYPE)
