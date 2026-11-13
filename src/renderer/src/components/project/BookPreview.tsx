import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { lineGeometry, PAGE_SIZE, type BookAdjustment, type Box, type Element, type ObjectKind, type ObjectStyle, type Page } from '@shared/book'
import { useApp, useUndoHandler } from '../../app-context'
import { hasImages, readDrop, uploadDrop } from '../../lib/images'
import { useViewActive } from '../../lib/keep-alive'
import { Icon } from '../Icon'

const CSS_PX_PER_MM = 96 / 25.4

// Les textes d'une seule ligne se valident avec Entrée ; les paragraphes acceptent les retours à la ligne.
const SINGLE_LINE = /^(caption|needLabel|text):/

// Couleurs proposées : celles de la charte d'abord, puis quelques couleurs franches pour signaler.
const PALETTE = [
  { hex: '#1F1F1F', name: 'Noir' },
  { hex: '#6B6660', name: 'Gris' },
  { hex: '#BFB6A3', name: 'Taupe' },
  { hex: '#9C927E', name: 'Taupe foncé' },
  { hex: '#CCC7B9', name: 'Gris clair' },
  { hex: '#2B3840', name: 'Bleu nuit' },
  { hex: '#5E4553', name: 'Prune' },
  { hex: '#FFFFFF', name: 'Blanc' },
  { hex: '#C0392B', name: 'Rouge' },
  { hex: '#D68910', name: 'Orange' },
  { hex: '#2E7D4F', name: 'Vert' },
  { hex: '#2563A8', name: 'Bleu' }
]

interface Props {
  projectId: number
  version: unknown
  onChanged(): void
}

type TextElement = Extract<Element, { type: 'text' }>
type LineElement = Extract<Element, { type: 'line' }>
type Selection = { pageKey: string; element: Element } | null
type Live = { key: string; box: Box } | null
type Undo = () => Promise<unknown>

const keyOf = (pageKey: string, e: Element) => `${pageKey}|${e.id}`
const noteId = (e: Element) => (e.id?.startsWith('note:') ? Number(e.id.slice(5)) : null)
const isShape = (e: Element | null) => e?.type === 'rect' || e?.type === 'ellipse' || e?.type === 'line'

// Aperçu du book, page par page, modifiable sur place comme dans PowerPoint : barre d'outils en haut (insérer
// un texte, une image, une forme ; mettre en forme l'élément choisi), clic sur un texte pour le changer, glisser
// pour déplacer, poignée pour la taille, double-clic pour une annotation. Tout se retrouve à l'identique dans
// le PDF et le PowerPoint ; ⌘Z annule chaque geste.
export function BookPreview({ projectId, version, onChanged }: Props) {
  const { notify } = useApp()
  const [pages, setPages] = useState<Page[]>([])
  const [scale, setScale] = useState(1) // px d'écran par mm
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [selected, setSelected] = useState<Selection>(null)
  const [live, setLive] = useState<Live>(null) // position pendant un déplacement, jusqu'au rechargement
  const undo = useRef<Undo[]>([])
  const panel = useRef<HTMLDivElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const active = useViewActive()
  const api = window.mdeko.projects

  const load = async (select?: { pageKey: string; id: string }) => {
    const next = await api.pages(projectId)
    setPages(next)
    setLive(null)
    // La sélection suit l'élément rechargé (nouvelle position, nouvelle taille), ou l'objet qu'on vient d'insérer.
    setSelected((s) => {
      const target = select ?? (s ? { pageKey: s.pageKey, id: s.element.id } : null)
      if (!target) return null
      const element = next.find((p) => p.key === target.pageKey)?.elements.find((e) => e.id === target.id)
      return element ? { pageKey: target.pageKey, element } : null
    })
  }

  useEffect(() => {
    const t = setTimeout(() => void load(), 200)
    return () => clearTimeout(t)
  }, [projectId, version])

  useEffect(() => {
    const el = panel.current
    if (!el) return
    const observer = new ResizeObserver(() => setScale(Math.max(0.5, (el.clientWidth - 64) / PAGE_SIZE.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Nouveau texte : on place le curseur dedans dès qu'il apparaît.
  useEffect(() => {
    if (!focusKey) return
    const el = panel.current?.querySelector<HTMLElement>(`[data-edit="${focusKey}"]`)
    if (el) {
      el.focus()
      setFocusKey(null)
    }
  }, [pages, focusKey])

  const changed = async (select?: { pageKey: string; id: string }) => {
    await load(select)
    onChanged()
  }

  // Chaque geste enregistre de quoi le défaire (⌘Z), dans l'ordre inverse.
  const remember = (fn: Undo) => {
    undo.current.push(fn)
    if (undo.current.length > 100) undo.current.shift()
  }

  useUndoHandler(() => {
    const last = undo.current.pop()
    if (!last) return false
    void last().then(() => changed())
    return true
  }, active)

  // Suppr / ⌫ retire l'objet inséré choisi ; les flèches le déplacent (Maj : de 5 mm) ; Échap le désélectionne.
  useEffect(() => {
    if (!active) return
    const onKey = (ev: KeyboardEvent) => {
      const target = document.activeElement as HTMLElement | null
      if (target?.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (ev.key === 'Escape') setSelected(null)
      if (!selected || document.querySelector('.sheet-backdrop')) return
      const e = selected.element
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && noteId(e) !== null) {
        ev.preventDefault()
        void remove(e)
      }
      const step = ev.shiftKey ? 5 : 1
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      const move = moves[ev.key]
      if (move) {
        ev.preventDefault()
        void saveBox(selected.pageKey, e, { x: e.x + move[0], y: e.y + move[1], w: e.w, h: e.h })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, selected])

  const saveText = async (key: string, text: string) => {
    await api.editText(projectId, key, text)
    await changed()
  }

  // Position ou taille changée : un objet inséré garde sa place dans ses données, le reste devient un ajustement du book.
  const saveBox = async (pageKey: string, e: Element, box: Box) => {
    const note = noteId(e)
    if (note !== null) {
      const keepsHeight = e.type !== 'text'
      await api.moveNote(note, box.x, box.y, box.w, keepsHeight ? box.h : undefined)
      remember(() => api.moveNote(note, e.x, e.y, e.w, keepsHeight ? e.h : undefined))
    } else {
      await adjust(pageKey, e, { x: box.x, y: box.y, w: box.w, h: box.h }, false)
    }
    await changed()
  }

  // Ajustement d'un élément du book (position, taille, mise en forme), annulable.
  const adjust = async (pageKey: string, e: Element, patch: BookAdjustment | null, reload = true) => {
    const before = await api.adjust(projectId, pageKey, e.id!, patch)
    remember(() => api.restoreAdjustment(projectId, pageKey, e.id!, before))
    if (reload) await changed()
  }

  // Mise en forme de l'élément choisi : un objet inséré la garde avec lui, un élément du book en ajustement.
  const applyStyle = async (patch: ObjectStyle) => {
    if (!selected) return
    const { pageKey, element: e } = selected
    const note = noteId(e)
    if (note === null) return adjust(pageKey, e, { style: patch })
    const before = await api.styleNote(note, patch)
    remember(() => api.styleNote(note, before, true))
    await changed()
  }

  const changeSize = (delta: number) => {
    if (!selected || selected.element.type !== 'text') return
    const size = Math.max(5, Math.min(120, selected.element.style.size + delta))
    if (noteId(selected.element) !== null) void applyStyle({ size })
    else void adjust(selected.pageKey, selected.element, { size })
  }

  const remove = async (e: Element) => {
    const note = noteId(e)
    if (note === null) return
    const row = await api.deleteNote(note)
    if (row) remember(() => api.restoreNote(row))
    setSelected(null)
    await changed()
  }

  // Retirer une page ne supprime rien : elle reste grisée dans l'aperçu et se remet d'un clic (ou ⌘Z).
  const setHidden = async (pageKey: string, hidden: boolean) => {
    setSelected(null)
    await api.setPageHidden(projectId, pageKey, hidden)
    remember(() => api.setPageHidden(projectId, pageKey, !hidden))
    await changed()
  }

  // Page où insérer : celle de l'élément choisi, sinon celle qui occupe le milieu de l'aperçu.
  const targetPage = (): string | null => {
    if (selected) return selected.pageKey
    const el = panel.current
    if (!el) return null
    const middle = el.getBoundingClientRect().top + el.clientHeight / 2
    let best: { key: string; distance: number } | null = null
    for (const node of el.querySelectorAll<HTMLElement>('[data-page]')) {
      if (node.classList.contains('is-hidden')) continue
      const r = node.getBoundingClientRect()
      const distance = middle < r.top ? r.top - middle : middle > r.bottom ? middle - r.bottom : 0
      if (!best || distance < best.distance) best = { key: node.dataset.page!, distance }
    }
    return best?.key ?? null
  }

  const insert = async (kind: ObjectKind, at: { x?: number; y?: number; imageId?: number; ratio?: number } = {}, pageKey = targetPage()) => {
    if (!pageKey) return
    const id = await api.addObject(projectId, pageKey, kind, at)
    remember(() => api.deleteNote(id))
    if (kind === 'text') setFocusKey(`note:${id}`)
    await changed({ pageKey, id: `note:${id}` })
  }

  const insertImages = async (files: Blob[], pageKey = targetPage(), at: { x?: number; y?: number } = {}) => {
    try {
      const uploaded = await uploadDrop({ files, url: null })
      for (const [i, image] of uploaded.entries()) {
        const bitmap = await createImageBitmap(files[i])
        await insert('image', { ...at, imageId: image.id, ratio: bitmap.width / Math.max(1, bitmap.height) }, pageKey)
      }
    } catch (err) {
      notify((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  // Déplacement (« move ») ou redimensionnement (poignée) à la souris.
  const startDrag = (down: ReactMouseEvent, pageKey: string, e: Element, mode: 'move' | 'resize') => {
    down.preventDefault()
    down.stopPropagation()
    setSelected({ pageKey, element: e })
    const start = { x: down.clientX, y: down.clientY }
    const key = keyOf(pageKey, e)
    const ratio = e.h / Math.max(e.w, 0.1)
    const boxAt = (ev: MouseEvent): Box => {
      const dx = (ev.clientX - start.x) / scale
      const dy = (ev.clientY - start.y) / scale
      if (mode === 'move') return { x: e.x + dx, y: e.y + dy, w: e.w, h: e.h }
      if (e.type === 'line') {
        // Un trait s'allonge dans sa direction, son point de départ ne bouge pas.
        const angle = ((e.rotate ?? 0) * Math.PI) / 180
        const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
        const w = Math.max(5, e.w + dx * cos + dy * sin)
        const startX = e.x + e.w / 2 - (e.w / 2) * cos
        const startY = e.y + e.h / 2 - (e.w / 2) * sin
        return { x: startX + (w / 2) * cos - w / 2, y: startY + (w / 2) * sin - e.h / 2, w, h: e.h }
      }
      const w = Math.max(5, e.w + dx)
      // Une image garde ses proportions ; un texte ou une forme s'élargit ou s'allonge librement.
      return { x: e.x, y: e.y, w, h: e.type === 'image' ? w * ratio : Math.max(3, e.h + dy) }
    }
    const move = (ev: MouseEvent) => setLive({ key, box: boxAt(ev) })
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const box = boxAt(ev)
      if (Math.abs(box.x - e.x) + Math.abs(box.y - e.y) + Math.abs(box.w - e.w) + Math.abs(box.h - e.h) < 0.5) {
        setLive(null)
        return
      }
      setLive({ key, box })
      void saveBox(pageKey, e, box)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const addNote = async (page: Page, e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-edit], [data-el], .pv-frame')) return
    const box = e.currentTarget.getBoundingClientRect()
    const id = await api.addNote(projectId, page.key, (e.clientX - box.left) / scale, (e.clientY - box.top) / scale)
    remember(() => api.deleteNote(id))
    setFocusKey(`note:${id}`)
    await load({ pageKey: page.key, id: `note:${id}` })
  }

  const handle = 10 / scale // poignées de 10 px quelle que soit la taille de l'aperçu
  const sel = selected?.element ?? null

  return (
    <div className="book-preview" ref={panel}>
      <Ribbon
        selected={sel}
        onInsert={(kind) => (kind === 'image' ? imageInput.current?.click() : void insert(kind))}
        onStyle={(patch) => void applyStyle(patch)}
        onSize={changeSize}
        onReset={selected && sel?.adjusted && noteId(sel) === null ? () => void adjust(selected.pageKey, sel, null) : null}
        onDelete={sel && noteId(sel) !== null ? () => void remove(sel) : null}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) void insertImages(files)
        }}
      />
      {pages.map((page) => {
        if (page.hidden) {
          return (
            <div key={page.key} data-page={page.key} className="preview-page is-hidden" style={{ width: PAGE_SIZE.width * scale, height: PAGE_SIZE.height * scale }}>
              <div className="preview-sheet" style={{ transform: `scale(${scale / CSS_PX_PER_MM})` }}>
                {page.elements.map((el, i) => (
                  <PreviewElement key={el.id ?? i} element={el} readOnly onSave={() => undefined} />
                ))}
              </div>
              <div className="pv-hidden-banner">
                <span>Page retirée : elle ne sera pas dans le document.</span>
                <button type="button" className="button" onClick={() => void setHidden(page.key, false)}>
                  Remettre la page
                </button>
              </div>
            </div>
          )
        }
        const pageSel = selected?.pageKey === page.key ? selected.element : null
        const selBox = pageSel && (live?.key === keyOf(page.key, pageSel) ? live.box : pageSel)
        const hasAdjustments = page.elements.some((e) => e.adjusted)
        const lineTurn = pageSel?.type === 'line' && pageSel.rotate ? `rotate(${pageSel.rotate}deg)` : undefined
        return (
          <div
            key={page.key}
            data-page={page.key}
            className="preview-page"
            style={{ width: PAGE_SIZE.width * scale, height: PAGE_SIZE.height * scale }}
            onMouseDown={(e) => !(e.target as HTMLElement).closest('[data-el], .pv-frame') && setSelected(null)}
            onDoubleClick={(e) => void addNote(page, e)}
            onDragOver={(e) => {
              if (!hasImages(e.dataTransfer)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(e) => {
              const drop = readDrop(e.dataTransfer)
              if (!drop.files.length && !drop.url) return
              e.preventDefault()
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              const at = { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
              if (drop.files.length) void insertImages(drop.files, page.key, at)
              else
                void uploadDrop(drop)
                  .then(async ([image]) => {
                    if (!image) return
                    const img = new Image()
                    img.src = image.url
                    await img.decode().catch(() => undefined)
                    await insert('image', { ...at, imageId: image.id, ratio: img.naturalWidth / Math.max(1, img.naturalHeight) }, page.key)
                  })
                  .catch((err: Error) => notify(err.message))
            }}
          >
            <div className="preview-sheet" style={{ transform: `scale(${scale / CSS_PX_PER_MM})` }}>
              {page.elements.map((el, i) => {
                const key = el.id ? keyOf(page.key, el) : null
                const shown = key && live?.key === key ? { ...el, ...live.box } : el
                return (
                  <PreviewElement
                    key={el.type === 'text' && el.edit ? el.edit : (el.id ?? i)}
                    element={shown}
                    onSave={saveText}
                    onGrab={el.id ? (down) => startDrag(down, page.key, el, 'move') : undefined}
                    onFocus={el.id ? () => setSelected({ pageKey: page.key, element: el }) : undefined}
                  />
                )
              })}
              {pageSel && selBox && (
                <div
                  className="pv-frame"
                  style={{
                    left: mm(selBox.x),
                    top: mm(selBox.y),
                    width: mm(selBox.w),
                    height: mm(selBox.h),
                    borderWidth: 1.5 / scale + 'mm',
                    transform: lineTurn
                  }}
                >
                  {pageSel.type === 'text' && (
                    <button
                      type="button"
                      className="pv-grab"
                      title="Faire glisser pour déplacer"
                      style={{ width: mm(handle * 1.8), height: mm(handle * 1.8), left: mm(-handle * 2.2), top: mm(-handle * 0.4) }}
                      onMouseDown={(down) => startDrag(down, page.key, pageSel, 'move')}
                    >
                      <Icon name="move" size={11} />
                    </button>
                  )}
                  <span
                    className="pv-resize"
                    title="Faire glisser pour changer la taille"
                    style={
                      pageSel.type === 'line'
                        ? { width: mm(handle), height: mm(handle), right: mm(-handle / 2), top: `calc(50% - ${mm(handle / 2)})`, cursor: 'ew-resize' }
                        : { width: mm(handle), height: mm(handle), right: mm(-handle / 2), bottom: mm(-handle / 2) }
                    }
                    onMouseDown={(down) => startDrag(down, page.key, pageSel, 'resize')}
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              className="pv-remove-page"
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={() => void setHidden(page.key, true)}
            >
              <Icon name="trash" size={12} />
              Retirer la page
            </button>
            {hasAdjustments && (
              <button
                type="button"
                className="pv-reset-page"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={async () => {
                  const ok = await window.mdeko.confirm(
                    'Remettre toute la page en place ?',
                    'Les images et les textes déplacés, agrandis ou mis en forme sur cette page reprennent leur place et leur aspect d’origine. Les textes écrits et les objets ajoutés sont conservés.',
                    'Remettre en place'
                  )
                  if (!ok) return
                  await api.resetPage(projectId, page.key)
                  setSelected(null)
                  await changed()
                }}
              >
                Remettre la page en place
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// --- Barre d'outils façon PowerPoint ------------------------------------------------------------------

interface RibbonProps {
  selected: Element | null
  onInsert(kind: ObjectKind): void
  onStyle(patch: ObjectStyle): void
  onSize(delta: number): void
  onReset: (() => void) | null
  onDelete: (() => void) | null
}

function Ribbon({ selected: e, onInsert, onStyle, onSize, onReset, onDelete }: RibbonProps) {
  const text = e?.type === 'text' ? e : null
  const shape = isShape(e) ? e : null
  const weight = text ? Math.min(...[text.style.weight ?? 200, ...text.runs.map((r) => r.weight ?? text.style.weight ?? 200)]) : 200
  const bold = weight >= 500
  const italic = !!text?.style.italic
  const underline = !!text?.style.underline
  const align = text?.style.align ?? 'left'
  const fill = shape && shape.type !== 'line' ? (shape.fill ?? '') : ''
  const line = shape ? (shape.line ?? '') : ''
  const lineWidth = shape ? (shape.lineWidth ?? (shape.type === 'line' ? 1.5 : 1)) : 1

  // Les boutons ne prennent pas le focus : le texte en cours de frappe reste sélectionné.
  return (
    <div className="pv-ribbon" onMouseDown={(ev) => !(ev.target as HTMLElement).closest('input') && ev.preventDefault()}>
      <RibbonGroup label="Insérer">
        <ToolButton label="Texte" onClick={() => onInsert('text')}>
          <span className="pv-tool-letter">T</span>
        </ToolButton>
        <ToolButton label="Image…" onClick={() => onInsert('image')}>
          <Icon name="photo" size={15} />
        </ToolButton>
        <ToolButton label="Rectangle" onClick={() => onInsert('rect')}>
          <svg viewBox="0 0 18 18" width="17" height="17">
            <rect x="2.5" y="4.5" width="13" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </ToolButton>
        <ToolButton label="Rond" onClick={() => onInsert('ellipse')}>
          <svg viewBox="0 0 18 18" width="17" height="17">
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </ToolButton>
        <ToolButton label="Ligne" onClick={() => onInsert('line')}>
          <svg viewBox="0 0 18 18" width="17" height="17">
            <line x1="2" y1="15" x2="16" y2="3" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </ToolButton>
        <ToolButton label="Flèche" onClick={() => onInsert('arrow')}>
          <svg viewBox="0 0 18 18" width="17" height="17">
            <line x1="2" y1="15" x2="13.5" y2="5.5" stroke="currentColor" strokeWidth="1.4" />
            <polygon points="16,3 10.5,4.6 13.4,8.1" fill="currentColor" />
          </svg>
        </ToolButton>
      </RibbonGroup>

      <RibbonGroup label="Texte" disabled={!text}>
        <ToolButton label="Plus petit" compact onClick={() => onSize(-1)}>
          <span className="pv-tool-letter small">A−</span>
        </ToolButton>
        <ToolButton label="Plus grand" compact onClick={() => onSize(1)}>
          <span className="pv-tool-letter">A+</span>
        </ToolButton>
        <ToolButton label="Gras" compact pressed={bold} onClick={() => onStyle({ bold: !bold })}>
          <b className="pv-tool-letter">G</b>
        </ToolButton>
        <ToolButton label="Italique" compact pressed={italic} onClick={() => onStyle({ italic: !italic })}>
          <i className="pv-tool-letter">I</i>
        </ToolButton>
        <ToolButton label="Souligné" compact pressed={underline} onClick={() => onStyle({ underline: !underline })}>
          <u className="pv-tool-letter">S</u>
        </ToolButton>
        <ColorButton label="Couleur" value={text?.style.color ?? '#1F1F1F'} onPick={(color) => onStyle({ color })}>
          <span className="pv-tool-letter">A</span>
        </ColorButton>
        {(['left', 'center', 'right'] as const).map((a) => (
          <ToolButton key={a} label={{ left: 'À gauche', center: 'Centré', right: 'À droite' }[a]} compact pressed={align === a} onClick={() => onStyle({ align: a })}>
            <AlignIcon align={a} />
          </ToolButton>
        ))}
      </RibbonGroup>

      <RibbonGroup label="Forme" disabled={!shape}>
        {shape?.type !== 'line' && (
          <ColorButton label="Fond" value={fill} allowNone onPick={(color) => onStyle({ fill: color })}>
            <svg viewBox="0 0 18 18" width="17" height="17">
              <rect x="3" y="3" width="12" height="12" rx="2" fill="currentColor" opacity="0.35" stroke="currentColor" />
            </svg>
          </ColorButton>
        )}
        <ColorButton label="Trait" value={line} onPick={(color) => onStyle({ line: color })}>
          <svg viewBox="0 0 18 18" width="17" height="17">
            <rect x="3" y="3" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </ColorButton>
        <ToolButton label="Trait plus fin" compact onClick={() => onStyle({ lineWidth: Math.max(0.25, lineWidth - 0.5) })}>
          <svg viewBox="0 0 18 18" width="17" height="17">
            <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="0.8" />
          </svg>
        </ToolButton>
        <ToolButton label="Trait plus épais" compact onClick={() => onStyle({ lineWidth: Math.min(20, lineWidth + 0.5) })}>
          <svg viewBox="0 0 18 18" width="17" height="17">
            <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="3" />
          </svg>
        </ToolButton>
        {shape?.type === 'line' && (
          <>
            <ToolButton label="Tourner à gauche" compact onClick={() => onStyle({ rotate: ((shape as LineElement).rotate ?? 0) - 15 })}>
              <span className="pv-tool-letter">↺</span>
            </ToolButton>
            <ToolButton label="Tourner à droite" compact onClick={() => onStyle({ rotate: ((shape as LineElement).rotate ?? 0) + 15 })}>
              <span className="pv-tool-letter">↻</span>
            </ToolButton>
          </>
        )}
      </RibbonGroup>

      <RibbonGroup label="Élément" disabled={!onReset && !onDelete}>
        {onReset && (
          <ToolButton label="Remettre à sa place" onClick={onReset}>
            <Icon name="undo" size={15} />
          </ToolButton>
        )}
        <ToolButton label="Supprimer" onClick={() => onDelete?.()} disabled={!onDelete}>
          <Icon name="trash" size={15} />
        </ToolButton>
      </RibbonGroup>
    </div>
  )
}

function RibbonGroup({ label, disabled, children }: { label: string; disabled?: boolean; children: ReactNode }) {
  return (
    <div className={`pv-group${disabled ? ' is-disabled' : ''}`}>
      <div className="pv-group-tools">{children}</div>
      <span className="pv-group-label">{label}</span>
    </div>
  )
}

function ToolButton({
  label,
  compact,
  pressed,
  disabled,
  onClick,
  children
}: {
  label: string
  compact?: boolean
  pressed?: boolean
  disabled?: boolean
  onClick(): void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`pv-tool${compact ? ' is-compact' : ''}${pressed ? ' is-pressed' : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      title={compact ? label : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      {!compact && <span className="pv-tool-label">{label}</span>}
    </button>
  )
}

// Choix d'une couleur : celles de la charte, « Sans » pour un fond transparent, ou n'importe laquelle (sélecteur du Mac).
function ColorButton({
  label,
  value,
  allowNone,
  onPick,
  children
}: {
  label: string
  value: string
  allowNone?: boolean
  onPick(color: string): void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (ev: MouseEvent) => !ref.current?.contains(ev.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const pick = (color: string) => {
    onPick(color)
    setOpen(false)
  }

  return (
    <div className="pv-color" ref={ref}>
      <button type="button" className="pv-tool is-compact" title={label} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="pv-color-icon">
          {children}
          <span className="pv-color-bar" style={{ background: value || 'transparent', borderColor: value ? 'transparent' : undefined }} />
        </span>
        <Icon name="chevronDown" size={9} />
      </button>
      {open && (
        <div className="pv-color-menu">
          <span className="pv-color-title">{label}</span>
          <div className="pv-swatches">
            {PALETTE.map((c) => (
              <button
                key={c.hex}
                type="button"
                className={`pv-swatch${value.toUpperCase() === c.hex ? ' is-active' : ''}`}
                style={{ background: c.hex }}
                aria-label={c.name}
                title={c.name}
                onClick={() => pick(c.hex)}
              />
            ))}
          </div>
          {allowNone && (
            <button type="button" className={`button pv-color-none${value === '' ? ' is-active' : ''}`} onClick={() => pick('')}>
              Sans fond
            </button>
          )}
          <label className="button pv-color-other">
            Autre couleur…
            <input type="color" value={value || '#1F1F1F'} onChange={(ev) => onPick(ev.target.value.toUpperCase())} />
          </label>
        </div>
      )}
    </div>
  )
}

function AlignIcon({ align }: { align: 'left' | 'center' | 'right' }) {
  const lines = [14, 9, 12, 7]
  return (
    <svg viewBox="0 0 18 18" width="16" height="16">
      {lines.map((w, i) => {
        const x = align === 'left' ? 2 : align === 'right' ? 16 - w : 9 - w / 2
        return <line key={i} x1={x} x2={x + w} y1={3.5 + i * 3.7} y2={3.5 + i * 3.7} stroke="currentColor" strokeWidth="1.4" />
      })}
    </svg>
  )
}

// Page en lecture seule (diaporama) : même rendu, sans rien de modifiable ; les liens s'ouvrent dans le navigateur.
export function BookPage({ page, scale }: { page: Page; scale: number }) {
  return (
    <div className="preview-page slide-page" style={{ width: PAGE_SIZE.width * scale, height: PAGE_SIZE.height * scale }}>
      <div className="preview-sheet" style={{ transform: `scale(${scale / CSS_PX_PER_MM})` }}>
        {page.elements.map((el, i) => (
          <PreviewElement key={el.id ?? i} element={el} readOnly onSave={() => undefined} />
        ))}
      </div>
    </div>
  )
}

const mm = (v: number) => `${v.toFixed(2)}mm`
const box = (e: Box): CSSProperties => ({ left: mm(e.x), top: mm(e.y), width: mm(e.w), height: mm(e.h) })

interface ElementProps {
  element: Element
  onSave(key: string, text: string): void
  onGrab?(down: ReactMouseEvent): void // élément déplaçable
  onFocus?(): void
  readOnly?: boolean
}

// Même rendu que html.ts (qui sert au PDF), pour que l'aperçu soit fidèle.
function PreviewElement({ element: e, onSave, onGrab, onFocus, readOnly }: ElementProps) {
  const grab = onGrab ? { 'data-el': '', onMouseDown: onGrab } : {}
  const movable = onGrab ? ' pv-movable' : ''
  if (e.type === 'image') return <img className={`pv${movable}`} src={e.image.url} alt="" style={box(e)} draggable={false} {...grab} />
  if (e.type === 'rect' || e.type === 'ellipse') {
    return (
      <div
        className={`pv${movable}`}
        style={{
          ...box(e),
          background: e.fill,
          border: e.line ? `${e.lineWidth ? (e.lineWidth * 0.3528).toFixed(2) : '0.25'}mm solid ${e.line}` : undefined,
          borderRadius: e.type === 'ellipse' ? '50%' : undefined
        }}
        {...grab}
      />
    )
  }
  if (e.type === 'line') {
    const g = lineGeometry(e)
    const color = e.line ?? '#1F1F1F'
    return (
      <svg
        className={`pv${movable}`}
        viewBox={`0 0 ${e.w} ${e.h}`}
        style={{ ...box(e), overflow: 'visible', transform: e.rotate ? `rotate(${e.rotate}deg)` : undefined }}
        {...grab}
      >
        <line x1={0} y1={g.y} x2={g.end} y2={g.y} stroke={color} strokeWidth={g.width} />
        {e.arrow && <polygon points={`${e.w - g.head},${g.y - g.head / 2} ${e.w},${g.y} ${e.w - g.head},${g.y + g.head / 2}`} fill={color} />}
      </svg>
    )
  }

  const s = e.style
  const style: CSSProperties = {
    ...box(e),
    fontSize: `${s.size}pt`,
    fontWeight: s.weight ?? 200,
    fontStyle: s.italic ? 'italic' : undefined,
    textDecoration: s.underline ? 'underline' : undefined,
    color: s.color,
    textAlign: s.align,
    justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[s.valign ?? 'top'],
    lineHeight: s.lineHeight ?? 1.3,
    letterSpacing: s.letterSpacing ? `${s.letterSpacing}pt` : undefined,
    transform: e.rotate ? `rotate(-${360 - e.rotate}deg)` : undefined
  }
  const content = e.runs.map((r, i) => (
    <span
      key={i}
      style={{
        color: r.color,
        fontWeight: r.weight,
        fontStyle: r.italic === undefined ? undefined : r.italic ? 'italic' : 'normal',
        textDecoration: r.underline === undefined ? undefined : r.underline ? 'underline' : 'none'
      }}
    >
      {r.text}
    </span>
  ))
  if (!e.edit || readOnly) {
    // Texte fixe (logo, lien) : on le déplace en le faisant glisser. En diaporama, un clic sur le lien ouvre le produit.
    const link = e.link
    const open = readOnly && link ? { onClick: (ev: ReactMouseEvent) => (ev.stopPropagation(), void window.mdeko.openExternal(link)) } : {}
    return (
      <div className={`pv pv-text${movable}`} style={style} {...grab}>
        <div className={link ? 'pv-link' : undefined} {...open}>
          {content}
        </div>
      </div>
    )
  }
  return <EditableText element={e} style={style} onSave={onSave} onFocus={onFocus} />
}

// Texte modifiable : son contenu est géré par le navigateur pendant la frappe, et remis à jour ensuite.
function EditableText({ element: e, style, onSave, onFocus }: Omit<ElementProps, 'element' | 'onGrab'> & { element: TextElement; style: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const key = e.edit!
  const value = e.runs.map((r) => r.text).join('')
  const note = noteId(e)

  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.innerText = value
  }, [value])

  return (
    <div
      className={`pv pv-text pv-editable${note !== null ? ' pv-note' : ''}`}
      style={{ ...style, ...(note !== null ? { height: 'auto', minHeight: mm(e.h) } : {}) }}
    >
      <div
        ref={ref}
        data-edit={key}
        data-placeholder={e.placeholder ?? ''}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck
        onFocus={onFocus}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            ev.currentTarget.innerText = value
            ev.currentTarget.blur()
          } else if (ev.key === 'Enter' && SINGLE_LINE.test(key)) {
            ev.preventDefault()
            ev.currentTarget.blur()
          }
        }}
        onBlur={(ev) => {
          const text = ev.currentTarget.innerText
          if (text !== value) onSave(key, text)
        }}
      />
    </div>
  )
}
