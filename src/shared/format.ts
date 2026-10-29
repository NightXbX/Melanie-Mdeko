import type { Price } from './api'

const sansCentimes = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const avecCentimes = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

// 299 € pour un prix rond, 249,99 € et 19,90 € sinon.
function montant(cents: number): string {
  const format = cents % 100 === 0 ? sansCentimes : avecCentimes
  return format.format(cents / 100).replace(/[  ]/g, ' ')
}

// Saisie d'un prix : « 249,99 », « 1 449 », « 1449 € » -> centimes ; null si vide ou illisible.
export function parsePriceInput(text: string): number | null {
  const t = text.replace(/[\s  €]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number.parseFloat(t) * 100)
}

// Centimes -> texte du champ de saisie : 24999 -> « 249,99 », 29900 -> « 299 ».
export function priceInputText(cents: number | null): string {
  if (cents === null) return ''
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ',')
}

// Prix tel qu'il doit apparaître pour Mélanie et dans les design books.
export function formatPrice(price: Price): string {
  if (price.kind === 'on_quote') return 'Sur devis'
  if (price.cents === null) return price.text ?? ''
  const m = montant(price.cents)
  switch (price.kind) {
    case 'from':
      return `À partir de ${m}`
    case 'per_m2':
      return `${m} / m²`
    case 'per_roll':
      return `${m} / rouleau`
    default:
      return m
  }
}
