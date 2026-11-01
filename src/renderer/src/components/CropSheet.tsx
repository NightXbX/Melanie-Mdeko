import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CropSource, EditableImage } from '@shared/api'
import { FULL, cropPixels, fitRatio, isFull, moveRect, resizeRect, sameRect, type CropHandle, type CropRect } from '@shared/crop'
import { useUndoHandler } from '../app-context'
import { cropImage } from '../lib/images'

const HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const STAGE_PADDING = 28

interface RatioChoice {
  id: string
  label: string
  ratio: number | null // largeur / hauteur ; null : libre
}

const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Rognage façon Canva : l'image d'origine entière, un cadre qu'on déplace et qu'on tire par ses poignées,
// des formats tout prêts. L'image d'origine est toujours gardée : rogner à nouveau repart d'elle.
export function CropSheet({
  imageId,
  bookRatio = false,
  onDone,
  onCancel
}: {
  imageId: number
  bookRatio?: boolean // rendu 3D : le format 16:9 s'appelle « Page du book »
  onDone(image: EditableImage): void | Promise<void>
  onCancel(): void
}) {
  const [source, setSource] = useState<CropSource | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [rect, setRect] = useState<CropRect>(FULL)
  const [ratioId, setRatioId] = useState('free')
  const [history, setHistory] = useState<CropRect[]>([])
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ handle: CropHandle | 'move'; start: CropRect; px: number; py: number } | null>(null)
  const initial = useRef<CropRect>(FULL)

  const aspect = natural ? natural.w / natural.h : 16 / 9
  const ratios: RatioChoice[] = [
    { id: 'free', label: 'Libre', ratio: null },
    { id: 'original', label: 'Original', ratio: aspect },
    { id: '16:9', label: bookRatio ? 'Page du book' : '16:9', ratio: 16 / 9 },
    { id: '4:3', label: '4:3', ratio: 4 / 3 },
    { id: '1:1', label: 'Carré', ratio: 1 },
    { id: '3:4', label: 'Portrait', ratio: 3 / 4 }
  ]
  const ratio = ratios.find((r) => r.id === ratioId)?.ratio ?? null

  useEffect(() => {
    void window.mdeko.cropSource(imageId).then(setSource, (e) => setError(errorText(e)))
  }, [imageId])

  // Une fois l'image chargée : le cadre déjà choisi, sinon l'image entière (rien n'est rogné sans le vouloir).
  const onLoad = (w: number, h: number) => {
    setNatural({ w, h })
    const start = source?.crop ?? FULL
    initial.current = start
    setRect(start)
    const px = (start.w * w) / (start.h * h)
    const match = [
      ['16:9', 16 / 9],
      ['4:3', 4 / 3],
      ['1:1', 1],
      ['3:4', 3 / 4]
    ].find(([, r]) => Math.abs((r as number) - px) / px < 0.01)
    setRatioId(isFull(start) ? 'free' : ((match?.[0] as string) ?? 'free'))
  }

  // Taille de l'image affichée : la plus grande possible dans la zone de travail.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => setStage({ w: el.clientWidth - 2 * STAGE_PADDING, h: el.clientHeight - 2 * STAGE_PADDING })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const scale = natural ? Math.min(stage.w / natural.w, stage.h / natural.h) : 0
  const shown = natural ? { w: Math.max(1, natural.w * scale), h: Math.max(1, natural.h * scale) } : null

  const change = (next: CropRect) => {
    if (sameRect(next, rect)) return
    setHistory((h) => [...h.slice(-49), rect])
    setRect(next)
  }

  // ⌘Z revient au cadre précédent.
  useUndoHandler(() => {
    const previous = history.at(-1)
    if (!previous) return false
    setHistory((h) => h.slice(0, -1))
    setRect(previous)
    return true
  })

  const chooseRatio = (choice: RatioChoice) => {
    setRatioId(choice.id)
    if (choice.ratio !== null) change(fitRatio(rect, choice.ratio, aspect))
  }

  const reset = () => {
    setRatioId('free')
    change(FULL)
  }

  const apply = async () => {
    if (!source || busy) return
    if (sameRect(rect, initial.current)) return onCancel()
    setBusy(true)
    setError(null)
    try {
      await onDone(await cropImage(source.id, rect))
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  // Clavier : Entrée rogne, Échap annule, les flèches déplacent le cadre. Rien ne va à la fenêtre en dessous.
  const keys = useRef({ apply, onCancel, rect, change })
  keys.current = { apply, onCancel, rect, change }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      const step = e.shiftKey ? 0.05 : 0.01
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (e.key === 'Escape') k.onCancel()
      else if (e.key === 'Enter') void k.apply()
      else if (moves[e.key]) k.change(moveRect(k.rect, ...moves[e.key]))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const pointer = (e: ReactPointerEvent) => {
    const box = canvasRef.current!.getBoundingClientRect()
    return { px: (e.clientX - box.left) / box.width, py: (e.clientY - box.top) / box.height }
  }

  const startDrag = (e: ReactPointerEvent, handle: CropHandle | 'move') => {
    if (busy) return
    e.preventDefault()
    e.stopPropagation()
    canvasRef.current!.setPointerCapture(e.pointerId)
    drag.current = { handle, start: rect, ...pointer(e) }
    setDragging(true)
  }

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const { px, py } = pointer(e)
    setRect(
      d.handle === 'move'
        ? moveRect(d.start, px - d.px, py - d.py)
        : resizeRect(d.start, d.handle, px, py, ratio, aspect)
    )
  }

  const endDrag = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    setDragging(false)
    if (!sameRect(d.start, rect)) setHistory((h) => [...h.slice(-49), d.start])
  }

  const pixels = natural ? cropPixels(rect, natural.w, natural.h) : null

  return (
    <div className="sheet-backdrop crop-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="sheet sheet-large crop-sheet">
        <div className="sheet-head">
          <h2>Rogner l’image</h2>
          <div className="sheet-actions">
            <button type="button" className="button" disabled={busy} onClick={onCancel}>
              Annuler
            </button>
            <button type="button" className="button button-primary" disabled={busy || !natural} onClick={() => void apply()}>
              {busy ? 'Rognage…' : 'Rogner'}
            </button>
          </div>
        </div>

        <div ref={stageRef} className="crop-stage">
          {source && (
            <div
              ref={canvasRef}
              className={`crop-canvas${dragging ? ' is-dragging' : ''}`}
              style={shown ? { width: shown.w, height: shown.h } : { visibility: 'hidden' }}
              onPointerMove={onMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <img
                src={source.url}
                alt=""
                draggable={false}
                onLoad={(e) => onLoad(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
              />
              {natural && (
                <div
                  className="crop-frame"
                  style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
                  onPointerDown={(e) => startDrag(e, 'move')}
                >
                  <span className="crop-grid" />
                  {HANDLES.filter((h) => ratio === null || h.length === 2).map((h) => (
                    <span key={h} className={`crop-handle crop-handle-${h}`} onPointerDown={(e) => startDrag(e, h)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="crop-tools">
          <div className="crop-ratios" role="radiogroup" aria-label="Format">
            {ratios.map((r) => {
              const w = r.ratio === null ? 18 : r.ratio >= 1 ? 22 : 22 * r.ratio
              const h = r.ratio === null ? 18 : r.ratio >= 1 ? 22 / r.ratio : 22
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={ratioId === r.id}
                  className={`crop-ratio${ratioId === r.id ? ' is-selected' : ''}`}
                  disabled={busy || !natural}
                  onClick={() => chooseRatio(r)}
                >
                  <span className={`crop-ratio-shape${r.ratio === null ? ' is-free' : ''}`} style={{ width: w, height: h }} />
                  {r.label}
                </button>
              )
            })}
          </div>
          <div className="crop-info">
            {pixels && (
              <span className="crop-size">
                {pixels.sw.toLocaleString('fr-FR')} × {pixels.sh.toLocaleString('fr-FR')} pixels
              </span>
            )}
            <button type="button" className="button button-plain" disabled={busy || isFull(rect)} onClick={reset}>
              Revenir à l’image entière
            </button>
          </div>
        </div>
        {error && <p className="editor-error">{error}</p>}
        <p className="section-note crop-hint">
          Faites glisser le cadre pour le déplacer, ou tirez ses coins pour l’agrandir ou le réduire. L’image d’origine est gardée : vous pourrez
          toujours la rogner autrement.
        </p>
      </div>
    </div>
  )
}
