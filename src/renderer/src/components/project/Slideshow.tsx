import { useCallback, useEffect, useRef, useState } from 'react'
import { PAGE_SIZE, type Page } from '@shared/book'
import { Icon } from '../Icon'
import { BookPage } from './BookPreview'

const CONTROLS_DELAY = 2500

// Diaporama du design book, en plein écran, comme une présentation (F5) : une page à la fois.
// Flèches, espace ou clic pour avancer ; Échap pour sortir.
export function Slideshow({ projectId, onClose }: { projectId: number; onClose(): void }) {
  const [pages, setPages] = useState<Page[]>([])
  const [index, setIndex] = useState(0)
  const [scale, setScale] = useState(1)
  const [controls, setControls] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    void window.mdeko.projects.pages(projectId).then(setPages)
  }, [projectId])

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => onClose())
    else onClose()
  }, [onClose])

  // Plein écran dès l'ouverture ; quitter le plein écran (Échap) ferme le diaporama.
  useEffect(() => {
    const el = ref.current
    void el?.requestFullscreen().catch(() => undefined)
    const onChange = () => !document.fullscreenElement && onClose()
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [onClose])

  // La page occupe tout l'écran sans être déformée.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setScale(Math.min(el.clientWidth / PAGE_SIZE.width, el.clientHeight / PAGE_SIZE.height)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const go = useCallback((delta: number) => setIndex((i) => Math.max(0, Math.min(pages.length - 1, i + delta))), [pages.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) go(1)
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) go(-1)
      else if (e.key === 'Home') setIndex(0)
      else if (e.key === 'End') setIndex(pages.length - 1)
      else if (e.key === 'Escape') close()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, close, pages.length])

  // Les boutons apparaissent quand on bouge la souris, puis s'effacent.
  const showControls = () => {
    setControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControls(false), CONTROLS_DELAY)
  }
  useEffect(() => {
    showControls()
    return () => clearTimeout(hideTimer.current)
  }, [])

  const page = pages[index]
  return (
    <div ref={ref} className={`slideshow${controls ? '' : ' is-idle'}`} onMouseMove={showControls} onClick={() => go(1)}>
      {page && <BookPage key={page.key} page={page} scale={scale} />}
      <div className="slideshow-controls" onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Page précédente" disabled={index === 0} onClick={() => go(-1)}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <span>{pages.length ? `${index + 1} / ${pages.length}` : ''}</span>
        <button type="button" aria-label="Page suivante" disabled={index >= pages.length - 1} onClick={() => go(1)}>
          <Icon name="chevronRight" size={16} />
        </button>
        <button type="button" className="slideshow-quit" onClick={close}>
          Quitter le diaporama
        </button>
      </div>
    </div>
  )
}
