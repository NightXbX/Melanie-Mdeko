import { describe, expect, it } from 'vitest'
import { parseProductPage, priceToCents } from './product-page'

describe('lecture d’une page produit', () => {
  it('lit les données JSON-LD « Product »', () => {
    const html = `<html><head><title>Fauteuil | Boutique</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},
        {"@type":"Product","name":"Fauteuil Ulit","description":"<p>Fauteuil enveloppant &amp; doux</p>",
         "image":["/img/ulit-1.jpg",{"@type":"ImageObject","url":"https://cdn.exemple.fr/ulit-2.jpg"}],
         "offers":[{"@type":"Offer","price":"379.00"},{"@type":"Offer","price":"399.00"}]}]}</script>
      </head><body></body></html>`
    expect(parseProductPage(html, 'https://www.exemple.fr/p/ulit')).toEqual({
      name: 'Fauteuil Ulit',
      priceCents: 37900,
      siteName: null,
      description: 'Fauteuil enveloppant & doux',
      imageUrls: ['https://www.exemple.fr/img/ulit-1.jpg', 'https://cdn.exemple.fr/ulit-2.jpg']
    })
  })

  it('se rabat sur les balises Open Graph et le titre', () => {
    const html = `<head>
      <meta content="Table à manger Oslo" property="og:title">
      <meta property="og:image" content="https://cdn.exemple.fr/oslo.jpg?w=800&amp;h=800">
      <meta property="product:price:amount" content="1 249,90">
      <meta property="og:site_name" content="Maison Exemple">
      </head>`
    const info = parseProductPage(html, 'https://exemple.fr/oslo')
    expect(info?.name).toBe('Table à manger Oslo')
    expect(info?.priceCents).toBe(124990)
    expect(info?.siteName).toBe('Maison Exemple')
    expect(info?.imageUrls).toEqual(['https://cdn.exemple.fr/oslo.jpg?w=800&h=800'])
    const titled = '<title>Lampe Nuage – Boutique</title><meta property="og:image" content="https://cdn.exemple.fr/nuage.jpg">'
    expect(parseProductPage(titled, 'https://exemple.fr')?.name).toBe('Lampe Nuage')
  })

  it('ne trouve rien sur une page sans produit', () => {
    expect(parseProductPage('<html><body>Accès refusé</body></html>', 'https://exemple.fr')).toBeNull()
    expect(parseProductPage('<title>maisonsdumonde.com</title>', 'https://www.maisonsdumonde.com/p/x')).toBeNull()
  })

  it('lit les prix écrits de toutes les façons', () => {
    expect(priceToCents('1249.00')).toBe(124900)
    expect(priceToCents('1.249,00 €')).toBe(124900)
    expect(priceToCents('1 249 €')).toBe(124900)
    expect(priceToCents(89.9)).toBe(8990)
    expect(priceToCents('0')).toBeNull()
  })
})
