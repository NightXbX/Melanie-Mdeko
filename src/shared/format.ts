import type { Price } from './api'

const sansCentimes = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const avecCentimes = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

// 299 € pour un prix rond, 249,99 € et 19,90 € sinon.
function montant(cents: number): string {
  const format = cents % 100 === 0 ? sansCentimes : avecCentimes
  return format.format(cents / 100).replace(/[  ]/g, ' ')
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
