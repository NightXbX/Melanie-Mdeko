// Cadre de rognage, en fractions de l'image d'origine (0,0 = en haut à gauche, 1,1 = en bas à droite).
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 }
export const MIN_SIZE = 0.05

// Poignées du cadre : coins et milieux des côtés.
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const round = (v: number) => Math.round(v * 1e6) / 1e6
const tidy = (r: CropRect): CropRect => ({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) })

export function isFull(r: CropRect): boolean {
  return r.x <= 0.001 && r.y <= 0.001 && r.w >= 0.999 && r.h >= 0.999
}

export function sameRect(a: CropRect, b: CropRect): boolean {
  return Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.w - b.w) < 1e-4 && Math.abs(a.h - b.h) < 1e-4
}

// Proportion (largeur / hauteur en pixels) exprimée en fractions de l'image : w / h du cadre.
const fractionRatio = (ratio: number, imageAspect: number) => ratio / imageAspect

// Le plus grand cadre de cette proportion qui tient dans l'image, centré sur le cadre actuel.
export function fitRatio(r: CropRect, ratio: number | null, imageAspect: number): CropRect {
  if (ratio === null) return r
  const k = fractionRatio(ratio, imageAspect)
  let w = 1
  let h = w / k
  if (h > 1) {
    h = 1
    w = k
  }
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  return tidy({ x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h })
}

// Déplace le cadre sans le faire sortir de l'image.
export function moveRect(r: CropRect, dx: number, dy: number): CropRect {
  return tidy({ ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) })
}

// Nouveau cadre quand on tire une poignée jusqu'au point (px, py). Avec une proportion imposée,
// seuls les coins servent : le coin opposé reste en place.
export function resizeRect(r: CropRect, handle: CropHandle, px: number, py: number, ratio: number | null, imageAspect: number): CropRect {
  let left = r.x
  let top = r.y
  let right = r.x + r.w
  let bottom = r.y + r.h

  if (ratio === null || handle.length === 1) {
    if (handle.includes('w')) left = clamp(px, 0, right - MIN_SIZE)
    if (handle.includes('e')) right = clamp(px, left + MIN_SIZE, 1)
    if (handle.includes('n')) top = clamp(py, 0, bottom - MIN_SIZE)
    if (handle.includes('s')) bottom = clamp(py, top + MIN_SIZE, 1)
    return tidy({ x: left, y: top, w: right - left, h: bottom - top })
  }

  const k = fractionRatio(ratio, imageAspect)
  const east = handle.includes('e')
  const south = handle.includes('s')
  const ax = east ? left : right
  const ay = south ? top : bottom
  const maxW = Math.min(east ? 1 - ax : ax, (south ? 1 - ay : ay) * k)
  const minW = Math.max(MIN_SIZE, MIN_SIZE * k)
  // La poignée suit le pointeur dans la direction où il est allé le plus loin.
  const wanted = Math.max((px - ax) * (east ? 1 : -1), (py - ay) * (south ? 1 : -1) * k)
  const w = clamp(wanted, Math.min(minW, maxW), maxW)
  const h = w / k
  return tidy({ x: east ? ax : ax - w, y: south ? ay : ay - h, w, h })
}

// Zone à découper, en pixels entiers, pour une image de largeur × hauteur donnée.
export function cropPixels(r: CropRect, width: number, height: number): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.round(r.x * width)
  const sy = Math.round(r.y * height)
  return {
    sx,
    sy,
    sw: Math.max(1, Math.min(width - sx, Math.round(r.w * width))),
    sh: Math.max(1, Math.min(height - sy, Math.round(r.h * height)))
  }
}

// Position d'un point (repère, trait) d'une image rognée à l'autre, quand elles viennent de la même image d'origine.
// Le point peut sortir de 0–1 : il est hors du nouveau cadre.
export function movePoint(x: number, y: number, from: CropRect, to: CropRect): { x: number; y: number } {
  return { x: round((from.x + x * from.w - to.x) / to.w), y: round((from.y + y * from.h - to.y) / to.h) }
}

export function parseCrop(text: string | null | undefined): CropRect | null {
  if (!text) return null
  try {
    const r = JSON.parse(text) as CropRect
    return [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && Number.isFinite(v)) ? r : null
  } catch {
    return null
  }
}
