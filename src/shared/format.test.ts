import { describe, expect, it } from 'vitest'
import { formatPrice } from './format'

describe('formatPrice', () => {
  it('affiche les prix comme sur la shopping list', () => {
    expect(formatPrice({ cents: 24999, kind: 'fixed', text: '249,99' })).toBe('249,99 €')
    expect(formatPrice({ cents: 29900, kind: 'fixed', text: '299' })).toBe('299 €')
    expect(formatPrice({ cents: 144900, kind: 'fixed', text: '1449' })).toBe('1 449 €')
    expect(formatPrice({ cents: 1990, kind: 'from', text: 'à partir de 19,90' })).toBe('À partir de 19,90 €')
    expect(formatPrice({ cents: 2790, kind: 'per_m2', text: '27,90/m2' })).toBe('27,90 € / m²')
    expect(formatPrice({ cents: null, kind: 'on_quote', text: 'sur devis' })).toBe('Sur devis')
    expect(formatPrice({ cents: null, kind: 'unknown', text: 'no' })).toBe('no')
  })
})
