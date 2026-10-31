import { describe, expect, it } from 'vitest'
import { overlay } from './markup'

describe('traits posés sur une image', () => {
  it('garde l’image là où il n’y a pas de trait et la recouvre sous un trait', () => {
    const base = { width: 2, height: 1, data: new Uint8Array([100, 100, 100, 255, 100, 100, 100, 255]) }
    // Premier pixel sans trait, second sous un trait rouge à moitié transparent (prémultiplié : 255 × 0,5).
    const layer = { width: 2, height: 1, data: new Uint8Array([0, 0, 0, 0, 0, 0, 128, 128]) }
    expect([...overlay(base, layer)]).toEqual([100, 100, 100, 255, 50, 50, 178, 255])
  })

  it('refuse un calque d’une autre taille', () => {
    const base = { width: 1, height: 1, data: new Uint8Array(4) }
    expect(() => overlay(base, { width: 2, height: 1, data: new Uint8Array(8) })).toThrow()
  })
})
