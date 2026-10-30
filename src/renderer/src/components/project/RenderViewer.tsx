import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ArticleCard as Card } from '@shared/api'
import { formatPrice } from '@shared/format'
import type { Project, RenderMarker } from '@shared/projects'
import { useApp } from '../../app-context'
import { hasImages, readDrop, uploadDrop, type DropContent } from '../../lib/images'
import { ArticleEditorSheet } from '../ArticleEditorSheet'
import { Icon } from '../Icon'
import { ArticlePicker } from './ArticlePicker'

const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Rendu en grand : remplacer son image, et repérer dessus les objets de la shopping list.
// Un clic sur l'image (en mode « Repérer un objet ») pose un repère et demande l'article correspondant ;
// un article qui n'est pas encore dans le projet y est ajouté.
export function RenderViewer({
  project,
  index,
  onIndex,
  onRetouch,
  onClose,
  reload
}: {
  project: Project
  index: number
  onIndex(index: number): void
  onRetouch(renderId: number): void
  onClose(): void
  reload(): Promise<void>
}) {
  const { notify } = useApp()
  const render = project.renders[index]
  const [marking, setMarking] = useState(false)
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSelected(null)
    setPending(null)
  }, [render?.id])

  // ← et → passent d'un rendu à l'autre, Échap ferme (sauf pendant le choix d'un article).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pending || creating || (e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'Escape') {
        if (marking) setMarking(false)
        else onClose()
      } else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      else if (e.key === 'ArrowRight' && index < project.renders.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, marking, pending, creating, project.renders.length, onClose, onIndex])

  if (!render) return null

  const replace = async (drop: DropContent) => {
    const ok = await window.mdeko.confirm(
      'Remplacer l’image de ce rendu ?',
      render.edited
        ? 'Le rendu garde sa place, sa vignette et ses repères. La retouche faite par l’assistant ne sera plus montrée.'
        : 'Le rendu garde sa place, sa vignette et ses repères.',
      'Remplacer l’image'
    )
    if (!ok) return
    setBusy(true)
    try {
      const [image] = await uploadDrop(drop)
      if (image) await window.mdeko.projects.replaceRenderImage(render.id, image.id)
      await reload()
    } catch (e) {
      notify(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const place = async (articleId: number) => {
    const at = pending
    setPending(null)
    setCreating(false)
    if (!at) return
    try {
      const id = await window.mdeko.projects.addMarker(render.id, articleId, at.x, at.y)
      await reload()
      setSelected(id)
    } catch (e) {
      notify(errorText(e))
    }
  }

  const removeMarker = async (m: RenderMarker) => {
    const ok = await window.mdeko.confirm(
      `Retirer le repère « ${m.article.name} » ?`,
      'L’article reste dans la shopping list du projet.',
      'Retirer le repère'
    )
    if (!ok) return
    await window.mdeko.projects.removeMarker(m.id)
    setSelected(null)
    await reload()
  }

  // Articles déjà dans le projet (choix puis propositions), sans doublon.
  const projectArticles: Card[] = []
  for (const n of project.needs) {
    for (const a of [n.choice, ...n.alternatives]) if (a && !projectArticles.some((x) => x.id === a.id)) projectArticles.push(a)
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`sheet viewer${dragging ? ' is-dragging' : ''}`}
        onDragOver={(e) => {
          if (!hasImages(e.dataTransfer)) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
        onDrop={(e) => {
          if (!hasImages(e.dataTransfer)) return
          e.preventDefault()
          setDragging(false)
          void replace(readDrop(e.dataTransfer))
        }}
      >
        <div className="sheet-head">
          <div className="viewer-nav">
            <button type="button" className="button" aria-label="Rendu précédent" disabled={index === 0} onClick={() => onIndex(index - 1)}>
              <Icon name="chevronLeft" size={14} />
            </button>
            <h2>
              Rendu {index + 1} sur {project.renders.length}
            </h2>
            <button
              type="button"
              className="button"
              aria-label="Rendu suivant"
              disabled={index === project.renders.length - 1}
              onClick={() => onIndex(index + 1)}
            >
              <Icon name="chevronRight" size={14} />
            </button>
          </div>
          <div className="sheet-actions">
            {busy && <span className="editor-status">Remplacement…</span>}
            <button type="button" className="button" onClick={() => fileInput.current?.click()}>
              Remplacer l’image…
            </button>
            <button type="button" className="button" onClick={() => onRetouch(render.id)}>
              Retoucher avec l’IA
            </button>
            <button type="button" className="button button-primary" onClick={onClose}>
              Terminé
            </button>
          </div>
        </div>

        <div className="viewer-body">
          <div className="viewer-stage-wrap">
            <div
              className={`viewer-stage${marking ? ' is-marking' : ''}`}
              onClick={(e) => {
                if (!marking) return setSelected(null)
                const box = e.currentTarget.getBoundingClientRect()
                setPending({ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height })
              }}
            >
              <img src={render.imageUrl} alt="" draggable={false} />
              {render.markers.map((m, i) => (
                <MarkerDot
                  key={m.id}
                  marker={m}
                  number={i + 1}
                  selected={selected === m.id}
                  onSelect={() => setSelected(m.id)}
                  onMoved={async (x, y) => {
                    await window.mdeko.projects.moveMarker(m.id, x, y)
                    await reload()
                  }}
                />
              ))}
              {pending && <span className="marker is-pending" style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }} />}
            </div>
            <p className="section-note viewer-hint">
              {marking
                ? 'Cliquez sur un objet de l’image pour le repérer.'
                : 'Glissez une nouvelle image ici pour remplacer ce rendu. Les flèches ← → passent au rendu suivant.'}
            </p>
          </div>

          <aside className="viewer-side">
            <button
              type="button"
              className={`button${marking ? ' button-primary' : ''} viewer-mark`}
              aria-pressed={marking}
              onClick={() => setMarking(!marking)}
            >
              <Icon name="plus" size={14} />
              {marking ? 'Terminer le repérage' : 'Repérer un objet'}
            </button>
            {render.markers.length === 0 ? (
              <p className="section-note">
                Repérez sur l’image les meubles et objets de la shopping list. Un objet qui n’y est pas encore peut être créé et ajouté au projet.
              </p>
            ) : (
              <ol className="marker-list">
                {render.markers.map((m, i) => (
                  <li key={m.id} className={selected === m.id ? 'is-selected' : ''}>
                    <button type="button" className="marker-item" onClick={() => setSelected(m.id)}>
                      <span className="marker-number">{i + 1}</span>
                      <span className="marker-photo">
                        {m.article.thumbnailUrl ? <img src={m.article.thumbnailUrl} alt="" /> : <Icon name="photo" size={18} />}
                      </span>
                      <span className="marker-text">
                        <span className="card-name">{m.article.name}</span>
                        <span className="card-price">{formatPrice(m.article.price)}</span>
                        {m.article.supplier && <span className="card-supplier">{m.article.supplier}</span>}
                      </span>
                    </button>
                    {selected === m.id && (
                      <button type="button" className="button button-plain button-danger" onClick={() => void removeMarker(m)}>
                        Retirer le repère
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      </div>

      {pending && !creating && (
        <ArticlePicker
          title="Quel est cet objet ?"
          featured={{ title: 'Déjà dans ce projet', items: projectArticles }}
          onPick={(id) => void place(id)}
          onCreate={() => setCreating(true)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending && creating && (
        <ArticleEditorSheet
          articleId={null}
          onClose={(savedId) => {
            if (savedId === undefined) {
              setCreating(false)
              setPending(null)
            } else void place(savedId)
          }}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void replace({ files: [file], url: null })
        }}
      />
    </div>
  )
}

// Repère numéroté : un clic le sélectionne, on le fait glisser pour le déplacer.
function MarkerDot({
  marker,
  number,
  selected,
  onSelect,
  onMoved
}: {
  marker: RenderMarker
  number: number
  selected: boolean
  onSelect(): void
  onMoved(x: number, y: number): Promise<void>
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const start = useRef<{ px: number; py: number; moved: boolean } | null>(null)

  const at = (e: ReactPointerEvent) => {
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))
    }
  }
  const shown = pos ?? marker

  return (
    <button
      type="button"
      className={`marker${selected ? ' is-selected' : ''}`}
      style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%` }}
      aria-label={`${number}. ${marker.article.name}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { px: e.clientX, py: e.clientY, moved: false }
        onSelect()
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s) return
        if (!s.moved && Math.hypot(e.clientX - s.px, e.clientY - s.py) < 4) return
        s.moved = true
        setPos(at(e))
      }}
      onPointerUp={(e) => {
        const s = start.current
        start.current = null
        if (s?.moved) void onMoved(at(e).x, at(e).y).then(() => setPos(null))
      }}
    >
      {number}
      {selected && <span className="marker-label">{marker.article.name}</span>}
    </button>
  )
}
