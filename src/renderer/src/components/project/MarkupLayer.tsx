import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

// Trait dessiné par Mélanie : points de 0 à 1 sur l'image (0,0 = en haut à gauche).
export type Stroke = [number, number][]

const COLOR = '#E5322D'

function draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, strokes: Stroke[], w: number, h: number, width: number) {
  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = COLOR
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokes) {
    if (!s.length) continue
    ctx.beginPath()
    ctx.moveTo(s[0][0] * w, s[0][1] * h)
    for (const [x, y] of s.length > 1 ? s.slice(1) : s) ctx.lineTo(x * w, y * h)
    ctx.stroke()
  }
}

// Calque transparent avec les seuls traits (PNG), à la largeur voulue : le processus principal le pose sur l'image.
export async function strokesToPng(strokes: Stroke[], width: number, ratio: number): Promise<Uint8Array> {
  const w = Math.round(width)
  const h = Math.max(1, Math.round(width * ratio))
  const canvas = new OffscreenCanvas(w, h)
  draw(canvas.getContext('2d')!, strokes, w, h, Math.max(4, w * 0.006))
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
}

// Calque de dessin posé exactement sur une image affichée : on entoure, on souligne, au doigt ou à la souris.
export function MarkupLayer({
  image,
  strokes,
  active,
  onChange
}: {
  image: RefObject<HTMLImageElement | null>
  strokes: Stroke[]
  active: boolean
  onChange(strokes: Stroke[]): void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 })
  const current = useRef<Stroke | null>(null)

  // Suit la place de l'image (taille de la fenêtre, image chargée).
  useLayoutEffect(() => {
    const img = image.current
    if (!img) return
    const update = () => setBox({ left: img.offsetLeft, top: img.offsetTop, width: img.offsetWidth, height: img.offsetHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(img)
    img.addEventListener('load', update)
    return () => {
      observer.disconnect()
      img.removeEventListener('load', update)
    }
  }, [image])

  const redraw = (extra?: Stroke) => {
    const c = canvas.current
    if (!c) return
    const ratio = window.devicePixelRatio || 1
    c.width = Math.round(box.width * ratio)
    c.height = Math.round(box.height * ratio)
    draw(c.getContext('2d')!, extra ? [...strokes, extra] : strokes, c.width, c.height, 3 * ratio)
  }
  useEffect(() => redraw(), [strokes, box])

  const point = (e: React.PointerEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }

  return (
    <canvas
      ref={canvas}
      className={`markup-layer${active ? ' is-active' : ''}`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={(e) => {
        if (!active) return
        e.currentTarget.setPointerCapture(e.pointerId)
        current.current = [point(e)]
        redraw(current.current)
      }}
      onPointerMove={(e) => {
        if (!current.current) return
        current.current.push(point(e))
        redraw(current.current)
      }}
      onPointerUp={() => {
        if (!current.current) return
        const done = current.current
        current.current = null
        onChange([...strokes, done])
      }}
    />
  )
}
