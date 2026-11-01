import { describe, expect, it } from 'vitest'
import { FULL, cropPixels, fitRatio, isFull, movePoint, moveRect, parseCrop, resizeRect } from './crop'

const WIDE = 16 / 9

describe('cadre de rognage', () => {
  it('impose une proportion en gardant le plus grand cadre possible', () => {
    // Carré dans une image 16:9 : toute la hauteur, centré.
    const r = fitRatio(FULL, 1, WIDE)
    expect(r.h).toBe(1)
    expect(r.w).toBeCloseTo(9 / 16)
    expect(r.x).toBeCloseTo((1 - 9 / 16) / 2)
    // 16:9 dans une image 16:9 : l'image entière.
    expect(isFull(fitRatio({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, WIDE, WIDE))).toBe(true)
  })

  it('ne sort jamais de l’image', () => {
    expect(moveRect({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 0.5, -1)).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.4 })
    const r = resizeRect({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'nw', -0.3, 0.9, null, WIDE)
    expect(r.x).toBe(0)
    expect(r.y).toBeCloseTo(0.65)
    expect(r.h).toBeCloseTo(0.05)
  })

  it('garde la proportion quand on tire un coin', () => {
    const start = fitRatio(FULL, 1, WIDE)
    const r = resizeRect(start, 'se', 0.6, 0.5, 1, WIDE)
    // Le coin en haut à gauche reste en place, le cadre reste carré en pixels.
    expect(r.x).toBeCloseTo(start.x)
    expect(r.y).toBe(0)
    expect((r.w * 1600) / (r.h * 900)).toBeCloseTo(1)
  })

  it('donne la zone en pixels', () => {
    expect(cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 3840, 2160)).toEqual({ sx: 960, sy: 1080, sw: 1920, sh: 1080 })
  })

  it('reporte un repère d’un cadre à l’autre', () => {
    // Le centre de l'image entière, dans un cadre qui garde la moitié droite.
    expect(movePoint(0.5, 0.5, FULL, { x: 0.5, y: 0, w: 0.5, h: 1 })).toEqual({ x: 0, y: 0.5 })
    // Retour à l'image entière : on retrouve la position d'origine.
    expect(movePoint(0, 0.5, { x: 0.5, y: 0, w: 0.5, h: 1 }, FULL)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('lit un cadre enregistré', () => {
    expect(parseCrop('{"x":0.1,"y":0,"w":0.5,"h":1}')).toEqual({ x: 0.1, y: 0, w: 0.5, h: 1 })
    expect(parseCrop('pas du json')).toBeNull()
    expect(parseCrop(null)).toBeNull()
  })
})
