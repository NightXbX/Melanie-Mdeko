import { describe, expect, it } from 'vitest'
import { bookHtml } from './html'
import { buildBook, type BookArticle, type BookData, type Element, type Page } from './layout'

const img = { url: 'mdeko://media/x.jpg', path: '/x.jpg', width: 1600, height: 900 }
const article = (name: string, cents: number | null, summable = true): BookArticle => ({
  name,
  price: cents === null ? 'Sur devis' : `${cents / 100} €`,
  priceCents: cents,
  summable,
  supplier: 'Sklum',
  url: `https://exemple.fr/${encodeURIComponent(name)}`,
  image: img
})

const data = (over: Partial<BookData> = {}): BookData => ({
  clientLabel: 'Mme Durand',
  dateLabel: 'Octobre 2026',
  designerName: 'Mélanie Exemple',
  address: '1 rue Exemple',
  phone: '00 00 00 00 00',
  email: 'contact@exemple.fr',
  reviewQr: null,
  intro: 'Avant-propos',
  wishes: 'Vos envies',
  closing: 'À vous',
  renders: [
    { image: img, inset: null, section: 'plans' },
    { image: img, inset: img, section: 'plans' }
  ],
  needs: [
    { title: 'Fauteuils', choice: article('Fauteuil', 30000), alternatives: [article('Autre fauteuil', 25000)] },
    { title: 'Papiers peints', choice: article('Papier peint', 8900, false), alternatives: [] }
  ],
  paints: [{ brand: 'Bilbo Quet Deco', promoCode: 'CODE', items: [{ name: 'Marelle', reference: null, hex: '#F4F2ED' }] }],
  artisans: [{ trade: 'Peintre', name: 'Atelier', city: 'Lille', phone: '01' }],
  ...over
})

const texts = (p: Page) => p.elements.filter((e): e is Extract<Element, { type: 'text' }> => e.type === 'text').map((e) => e.runs.map((r) => r.text).join(''))

describe('design book', () => {
  it('enchaîne les pages dans l’ordre de la charte et numérote le sommaire', () => {
    const pages = buildBook(data())
    // couverture, sommaire, avant-propos, envies, 2 plans, intercalaire + 2 besoins + récap, intercalaire + couleurs, artisans, à vous, 4e
    expect(pages).toHaveLength(15)
    expect(texts(pages[1]).slice(0, -1)).toEqual([
      '3.', 'Avant-Propos',
      '4.', 'Vos envies',
      '5-6.', 'Plans d’aménagement intérieur',
      '7-10.', 'Shopping list',
      '11-12.', 'Choix des couleurs',
      '13.', 'Artisans',
      '14.', 'C’est à vous !'
    ])
  })

  it('met le pied de page partout sauf couverture, intercalaires et 4e de couverture', () => {
    const pages = buildBook(data())
    const withFooter = pages.map((p) => texts(p).some((t) => t.startsWith('Design Book – Page')))
    expect(withFooter[0]).toBe(false)
    expect(withFooter[1]).toBe(true)
    expect(withFooter[6]).toBe(false) // intercalaire Shopping list
    expect(withFooter.at(-1)).toBe(false)
    expect(texts(pages[2])).toContain('Design Book – Page 3')
  })

  it('présente « Mon choix », les alternatives et des liens « Voir le produit »', () => {
    const page = buildBook(data())[7]
    expect(texts(page)).toEqual(expect.arrayContaining(['FAUTEUILS', 'MON CHOIX', 'Fauteuil', 'AUTRES PROPOSITIONS', 'Autre fauteuil']))
    const links = page.elements.filter((e) => e.type === 'text' && e.link).length
    expect(links).toBe(2)
  })

  it('totalise les choix additionnables dans le récapitulatif', () => {
    const recap = buildBook(data())[9]
    expect(texts(recap)).toEqual(expect.arrayContaining(['Total (hors prix au m², au rouleau ou sur devis)', '300 €']))
  })

  it('omet les sections vides', () => {
    const pages = buildBook(data({ renders: [], needs: [], paints: [], artisans: [] }))
    expect(pages).toHaveLength(6)
  })

  it('produit un HTML avec la police intégrée et une page par feuille', () => {
    const html = bookHtml(buildBook(data()))
    expect(html.match(/<section class="page">/g)).toHaveLength(15)
    expect(html).toContain('@font-face{font-family:Poppins;font-weight:200')
    expect(html).toContain('href="https://exemple.fr/Fauteuil"')
  })
})
