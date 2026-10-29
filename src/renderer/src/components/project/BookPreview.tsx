import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { PAGE_SIZE, type Element, type Page } from '@shared/book'
import { Icon } from '../Icon'

const CSS_PX_PER_MM = 96 / 25.4

// Les textes d'une seule ligne se valident avec Entrée ; les paragraphes acceptent les retours à la ligne.
const SINGLE_LINE = /^(caption|needLabel):/

interface Props {
  projectId: number
  version: unknown
  onChanged(): void
}

// Aperçu du book, page par page, modifiable sur place : clic sur un texte pour le changer,
// double-clic sur une page pour y poser une annotation, que l'on peut ensuite déplacer.
export function BookPreview({ projectId, version, onChanged }: Props) {
  const [pages, setPages] = useState<Page[]>([])
  const [scale, setScale] = useState(1) // px d'écran par mm
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  const load = () => window.mdeko.projects.pages(projectId).then(setPages)

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

  const save = async (key: string, text: string) => {
    await window.mdeko.projects.editText(projectId, key, text)
    onChanged()
  }

  const addNote = async (page: Page, e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-edit]')) return
    const box = e.currentTarget.getBoundingClientRect()
    const id = await window.mdeko.projects.addNote(projectId, page.key, (e.clientX - box.left) / scale, (e.clientY - box.top) / scale)
    setFocusKey(`note:${id}`)
    await load()
  }

  return (
    <div className="book-preview" ref={panel}>
      {pages.map((page) => (
        <div
          key={page.key}
          className="preview-page"
          style={{ width: PAGE_SIZE.width * scale, height: PAGE_SIZE.height * scale }}
          onDoubleClick={(e) => void addNote(page, e)}
        >
          <div className="preview-sheet" style={{ transform: `scale(${scale / CSS_PX_PER_MM})` }}>
            {page.elements.map((el, i) => (
              <PreviewElement
                key={el.type === 'text' && el.edit ? el.edit : i}
                element={el}
                scale={scale}
                onSave={save}
                onMoved={async (noteId, x, y) => {
                  await window.mdeko.projects.moveNote(noteId, x, y)
                  onChanged()
                }}
                onDelete={async (noteId) => {
                  await window.mdeko.projects.deleteNote(noteId)
                  onChanged()
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const mm = (v: number) => `${v.toFixed(2)}mm`
const box = (e: Element): CSSProperties => ({ left: mm(e.x), top: mm(e.y), width: mm(e.w), height: mm(e.h) })

interface ElementProps {
  element: Element
  scale: number
  onSave(key: string, text: string): void
  onMoved(noteId: number, x: number, y: number): void
  onDelete(noteId: number): void
}

// Même rendu que html.ts (qui sert au PDF), pour que l'aperçu soit fidèle.
function PreviewElement({ element: e, scale, onSave, onMoved, onDelete }: ElementProps) {
  if (e.type === 'image') return <img className="pv" src={e.image.url} alt="" style={box(e)} draggable={false} />
  if (e.type === 'rect' || e.type === 'ellipse') {
    return (
      <div
        className="pv"
        style={{
          ...box(e),
          background: e.fill,
          border: e.line ? `0.25mm solid ${e.line}` : undefined,
          borderRadius: e.type === 'ellipse' ? '50%' : undefined
        }}
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
  if (!e.edit) {
    return (
      <div className="pv pv-text" style={style}>
        <div className={e.link ? 'pv-link' : undefined}>{content}</div>
      </div>
    )
  }

  return <EditableText element={e} style={style} scale={scale} onSave={onSave} onMoved={onMoved} onDelete={onDelete} />
}

type TextElement = Extract<Element, { type: 'text' }>

// Texte modifiable : son contenu est géré par le navigateur pendant la frappe, et remis à jour ensuite.
function EditableText({
  element: e,
  style,
  scale,
  onSave,
  onMoved,
  onDelete
}: Omit<ElementProps, 'element'> & { element: TextElement; style: CSSProperties }) {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const key = e.edit!
  const value = e.runs.map((r) => r.text).join('')
  const noteId = key.startsWith('note:') ? Number(key.slice(5)) : null

  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.innerText = value
  }, [value])

  // Déplacement d'une annotation par sa poignée.
  const startDrag = (down: ReactMouseEvent) => {
    down.preventDefault()
    down.stopPropagation()
    const start = { x: down.clientX, y: down.clientY }
    const move = (ev: MouseEvent) => setOffset({ x: (ev.clientX - start.x) / scale, y: (ev.clientY - start.y) / scale })
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setOffset(null)
      const dx = (ev.clientX - start.x) / scale
      const dy = (ev.clientY - start.y) / scale
      if (noteId !== null && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) onMoved(noteId, e.x + dx, e.y + dy)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div
      className={`pv pv-text pv-editable${noteId !== null ? ' pv-note' : ''}`}
      style={{
        ...style,
        ...(offset ? { left: mm(e.x + offset.x), top: mm(e.y + offset.y) } : {}),
        ...(noteId !== null ? { height: 'auto', minHeight: mm(e.h) } : {})
      }}
    >
      <div
        ref={ref}
        data-edit={key}
        data-placeholder={e.placeholder ?? ''}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck
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
      {noteId !== null && (
        <>
          <button type="button" className="pv-handle" title="Déplacer" onMouseDown={startDrag}>
            <Icon name="move" size={10} />
          </button>
          <button
            type="button"
            className="pv-delete"
            title="Supprimer l’annotation"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onDelete(noteId)}
          >
            <Icon name="xmark" size={9} />
          </button>
        </>
      )}
    </div>
  )
}
