import { describe, expect, it } from 'vitest'
import { parsePriceInput, priceInputText } from './format'
import { cleanUrl, normalizeUrlInput } from './url'

describe('cleanUrl', () => {
  it('retire le suivi et garde les variantes', () => {
    expect(cleanUrl('https://www.sklum.com/fr/x.html?id_c=508856&utm_source=g&gclid=abc')).toBe(
      'https://www.sklum.com/fr/x.html'
    )
    expect(cleanUrl('https://bobochicparis.com/fr/lit.html?utm_source=x#/7-couleur-beige')).toBe(
      'https://bobochicparis.com/fr/lit.html#/7-couleur-beige'
    )
    expect(cleanUrl('https://bonnuit-matelas.fr/products/lit?variant=43077388435624')).toBe(
      'https://bonnuit-matelas.fr/products/lit?variant=43077388435624'
    )
    expect(cleanUrl('pas un lien')).toBeNull()
  })

  it('complète un lien collé sans https://', () => {
    expect(normalizeUrlInput(' www.ikea.com/fr ')).toBe('https://www.ikea.com/fr')
    expect(normalizeUrlInput('')).toBe('')
  })
})

describe('saisie du prix', () => {
  it('accepte les écritures courantes', () => {
    expect(parsePriceInput('249,99')).toBe(24999)
    expect(parsePriceInput('1 449')).toBe(144900)
    expect(parsePriceInput('19.9 €')).toBe(1990)
    expect(parsePriceInput('')).toBeNull()
    expect(parsePriceInput('environ 20')).toBeNull()
  })

  it('réaffiche un prix dans le champ', () => {
    expect(priceInputText(24999)).toBe('249,99')
    expect(priceInputText(29900)).toBe('299')
    expect(priceInputText(null)).toBe('')
  })
})
