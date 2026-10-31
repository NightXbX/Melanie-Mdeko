import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { PAGE_SIZE, type BookAdjustment, type Box, type Element, type Page } from '@shared/book'
import { Icon } from '../Icon'

const CSS_PX_PER_MM = 96 / 25.4

// Les textes d'une seule ligne se valident avec Entrée ; les paragraphes acceptent les retours à la ligne.
const SINGLE_LINE = /^(caption|needLabel|text):/

interface Props {
  projectId: number
  version: unknown
  onChanged(): void
}

type TextElement = Extract<Element, { type: 'text' }>
type Selection = { pageKey: string; element: Element } | null
type Live = { key: string; box: Box } | null

const keyOf = (pageKey: string, e: Element) => `${pageKey}|${e.id}`
const noteId = (e: Element) => (e.id?.startsWith('note:') ? Number(e.id.slice(5)) : null)

// Aperçu du book, page par page, modifiable sur place : clic sur un texte pour le changer, clic sur une image
// ou un texte pour le déplacer (en le faisant glisser) et changer sa taille (poignée en bas à droite),
// double-clic sur une page pour y poser une annotation. Tout se retrouve à l'identique dans le PDF et le PowerPoint.
export function BookPreview({ projectId, version, onChanged }: Props) {
  const [pages, setPages] = useState<Page[]>([])
  const [scale, setScale] = useState(1) // px d'écran par mm
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [selected, setSelected] = useState<Selection>(null)
  const [live, setLive] = useState<Live>(null) // position pendant un déplacement, jusqu'au rechargement
  const panel = useRef<HTMLDivElement>(null)

  const load = async () => {
    const next = await window.mdeko.projects.pages(projectId)
    setPages(next)
    setLive(null)
    // La sélection suit l'élément rechargé (nouvelle position, nouvelle taille).
    setSelected((s) => {
      if (!s) return s
      const element = next.find((p) => p.key === s.pageKey)?.elements.find((e) => e.id === s.element.id)
      return element ? { pageKey: s.pageKey, element } : null
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

  // Nouvelle annotation : on place le curseur dedans dès qu'elle apparaît.
  useEffect(() => {
    if (!focusKey) return
    const el = panel.current?.querySelector<HTMLElement>(`[data-edit="${focusKey}"]`)
    if (el) {
      el.focus()
      setFocusKey(null)
    }
  }, [pages, focusKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !(document.activeElement as HTMLElement)?.isContentEditable && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const changed = async () => {
    await load()
    onChanged()
  }

  const saveText = async (key: string, text: string) => {
    await window.mdeko.projects.editText(projectId, key, text)
    await changed()
  }

  // Position ou taille changée : une annotation garde sa place dans ses données, le reste devient un ajustement du book.
  const saveBox = async (pageKey: string, e: Element, box: Box) => {
    const note = noteId(e)
    if (note !== null) await window.mdeko.projects.moveNote(note, box.x, box.y, box.w)
    else await window.mdeko.projects.adjust(projectId, pageKey, e.id!, { x: box.x, y: box.y, w: box.w, h: box.h })
    await changed()
  }

  const adjust = async (pageKey: string, e: Element, patch: BookAdjustment | null) => {
    await window.mdeko.projects.adjust(projectId, pageKey, e.id!, patch)
    await changed()
  }

  // Déplacement (mode « move ») ou redimensionnement (poignée) à la souris.
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
      const w = Math.max(5, e.w + dx)
      // Une image garde ses proportions ; un texte s'élargit ou s'allonge librement.
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
    const id = await window.mdeko.projects.addNote(projectId, page.key, (e.clientX - box.left) / scale, (e.clientY - box.top) / scale)
    setFocusKey(`note:${id}`)
    await load()
  }

  const handle = 10 / scale // poignées de 10 px quelle que soit la taille de l'aperçu

  return (
    <div className="book-preview" ref={panel}>
      <p className="preview-help">Cliquez sur un texte pour l’écrire, faites glisser une image ou un texte pour le déplacer.</p>
      {pages.map((page) => {
        const sel = selected?.pageKey === page.key ? selected.element : null
        const selBox = sel && (live?.key === keyOf(page.key, sel) ? live.box : sel)
        const hasAdjustments = page.elements.some((e) => e.adjusted)
        return (
          <div
            key={page.key}
            className="preview-page"
            style={{ width: PAGE_SIZE.width * scale, height: PAGE_SIZE.height * scale }}
            onMouseDown={(e) => !(e.target as HTMLElement).closest('[data-el], .pv-frame, .pv-toolbar') && setSelected(null)}
            onDoubleClick={(e) => void addNote(page, e)}
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
                    onDeleteNote={async (id) => {
                      await window.mdeko.projects.deleteNote(id)
                      setSelected(null)
                      await changed()
                    }}
                  />
                )
              })}
              {sel && selBox && (
                <div
                  className="pv-frame"
                  style={{ left: mm(selBox.x), top: mm(selBox.y), width: mm(selBox.w), height: mm(selBox.h), borderWidth: 1.5 / scale + 'mm' }}
                >
                  {sel.type === 'text' && (
                    <button
                      type="button"
                      className="pv-grab"
                      title="Faire glisser pour déplacer"
                      style={{ width: mm(handle * 1.8), height: mm(handle * 1.8), left: mm(-handle * 2.2), top: mm(-handle * 0.4) }}
                      onMouseDown={(down) => startDrag(down, page.key, sel, 'move')}
                    >
                      <Icon name="move" size={11} />
                    </button>
                  )}
                  <span
                    className="pv-resize"
                    title="Faire glisser pour changer la taille"
                    style={{ width: mm(handle), height: mm(handle), right: mm(-handle / 2), bottom: mm(-handle / 2) }}
                    onMouseDown={(down) => startDrag(down, page.key, sel, 'resize')}
                  />
                </div>
              )}
            </div>
            {sel && selBox && (
              <div className="pv-toolbar" style={{ left: selBox.x * scale, top: Math.max(4, selBox.y * scale - 38) }} onMouseDown={(e) => e.preventDefault()}>
                {sel.type === 'text' && noteId(sel) === null && (
                  <>
                    <button type="button" title="Texte plus petit" onClick={() => void adjust(page.key, sel, { size: Math.max(5, (sel as TextElement).style.size - 1) })}>
                      A−
                    </button>
                    <button type="button" title="Texte plus grand" className="pv-toolbar-big" onClick={() => void adjust(page.key, sel, { size: (sel as TextElement).style.size + 1 })}>
                      A+
                    </button>
                  </>
                )}
                {sel.adjusted && noteId(sel) === null && (
                  <button type="button" onClick={() => void adjust(page.key, sel, null)}>
                    Remettre à sa place
                  </button>
                )}
              </div>
            )}
            {hasAdjustments && (
              <button
                type="button"
                className="pv-reset-page"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={async () => {
                  const ok = await window.mdeko.confirm(
                    'Remettre toute la page en place ?',
                    'Les images et les textes déplacés ou agrandis sur cette page reprennent leur place et leur taille d’origine. Les textes écrits sont conservés.',
                    'Remettre en place'
                  )
                  if (!ok) return
                  await window.mdeko.projects.resetPage(projectId, page.key)
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

// Page en lecture seule (diaporama) : même rendu, sans rien de modifiable ; les liens s'ouvrent dans le navigateur.
export function BookPage({ page, scale }: { page: Page; scale: number }) {
  return (
    <div className="preview-page slide-page" style={{ width: PAGE_SIZE.width * scale, height: PAGE_SIZE.height * scale }}>
      <div className="preview-sheet" style={{ transform: `scale(${scale / CSS_PX_PER_MM})` }}>
        {page.elements.map((el, i) => (
          <PreviewElement key={el.id ?? i} element={el} readOnly onSave={() => undefined} onDeleteNote={() => undefined} />
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
  onDeleteNote(noteId: number): void
  readOnly?: boolean
}

// Même rendu que html.ts (qui sert au PDF), pour que l'aperçu soit fidèle.
function PreviewElement({ element: e, onSave, onGrab, onFocus, onDeleteNote, readOnly }: ElementProps) {
  const grab = onGrab ? { 'data-el': '', onMouseDown: onGrab } : {}
  if (e.type === 'image') return <img className={`pv${onGrab ? ' pv-movable' : ''}`} src={e.image.url} alt="" style={box(e)} draggable={false} {...grab} />
  if (e.type === 'rect' || e.type === 'ellipse') {
    return (
      <div
        className={`pv${onGrab ? ' pv-movable' : ''}`}
        style={{
          ...box(e),
          background: e.fill,
          border: e.line ? `0.25mm solid ${e.line}` : undefined,
          borderRadius: e.type === 'ellipse' ? '50%' : undefined
        }}
        {...grab}
      />
    )
  }

  const s = e.style
  const style: CSSProperties = {
    ...box(e),
    fontSize: `${s.size}pt`,
    fontWeight: s.weight ?? 200,
    color: s.color,
    textAlign: s.align,
    justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[s.valign ?? 'top'],
    lineHeight: s.lineHeight ?? 1.3,
    letterSpacing: s.letterSpacing ? `${s.letterSpacing}pt` : undefined,
    transform: e.rotate ? `rotate(-${360 - e.rotate}deg)` : undefined
  }
  const content = e.runs.map((r, i) => (
    <span key={i} style={{ color: r.color, fontWeight: r.weight }}>
      {r.text}
    </span>
  ))
  if (!e.edit || readOnly) {
    // Texte fixe (logo, lien) : on le déplace en le faisant glisser. En diaporama, un clic sur le lien ouvre le produit.
    const link = e.link
    const open = readOnly && link ? { onClick: (ev: ReactMouseEvent) => (ev.stopPropagation(), void window.mdeko.openExternal(link)) } : {}
    return (
      <div className={`pv pv-text${onGrab ? ' pv-movable' : ''}`} style={style} {...grab}>
        <div className={link ? 'pv-link' : undefined} {...open}>
          {content}
        </div>
      </div>
    )
  }
  return <EditableText element={e} style={style} onSave={onSave} onFocus={onFocus} onDeleteNote={onDeleteNote} />
}

// Texte modifiable : son contenu est géré par le navigateur pendant la frappe, et remis à jour ensuite.
function EditableText({
  element: e,
  style,
  onSave,
  onFocus,
  onDeleteNote
}: Omit<ElementProps, 'element' | 'onGrab'> & { element: TextElement; style: CSSProperties }) {
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
      {note !== null && (
        <button
          type="button"
          className="pv-delete"
          title="Supprimer l’annotation"
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => onDeleteNote(note)}
        >
          <Icon name="xmark" size={9} />
        </button>
      )}
    </div>
  )
}
