import { describe, expect, it } from 'vitest'
import type { Element, Page } from '@shared/book'
import { bookHtml, exported } from './html'
import { buildBook, type BookArticle, type BookData } from './layout'

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
  theme: 'classique',
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
    { id: 1, image: img, inset: null, section: 'plans', caption: null },
    { id: 2, image: img, inset: img, section: 'plans', caption: 'Vue du salon' }
  ],
  needs: [
    { id: 1, title: 'Fauteuils', choice: article('Fauteuil', 30000), alternatives: [article('Autre fauteuil', 25000)] },
    { id: 2, title: 'Papiers peints', choice: article('Papier peint', 8900, false), alternatives: [] }
  ],
  paints: [{ brand: 'Bilbo Quet Deco', promoCode: 'CODE', items: [{ name: 'Marelle', reference: null, hex: '#F4F2ED' }] }],
  artisans: [{ trade: 'Peintre', name: 'Atelier', city: 'Lille', phone: '01' }],
  notes: [],
  ...over
})

type TextElement = Extract<Element, { type: 'text' }>
const textsOf = (p: Page) => p.elements.filter((e): e is TextElement => e.type === 'text').map((e) => e.runs.map((r) => r.text).join(''))
const byKey = (pages: Page[], key: string) => pages.find((p) => p.key === key)!

describe('design book', () => {
  it('enchaîne les pages, numérote le sommaire et les intercalaires', () => {
    const pages = buildBook(data())
    // couverture, sommaire, avant-propos, envies, intercalaire + 2 plans, intercalaire + 2 besoins + récap,
    // intercalaire + couleurs, artisans, à vous, 4e de couverture
    expect(pages).toHaveLength(16)
    expect(textsOf(pages[1]).slice(0, -1)).toEqual([
      '3.', 'Avant-propos',
      '4.', 'Vos envies',
      '5-7.', 'Plans d’aménagement intérieur',
      '8-11.', 'Shopping list',
      '12-13.', 'Choix des couleurs',
      '14.', 'Artisans',
      '15.', 'C’est à vous !'
    ])
    expect(textsOf(pages[7])).toEqual(['04', 'Shopping list'])
  })

  it('met les repères de page partout sauf couverture, intercalaires et 4e de couverture', () => {
    const pages = buildBook(data())
    const marked = pages.map((p) => textsOf(p).some((t) => t.startsWith('Design Book – Page')))
    expect(marked[0]).toBe(false)
    expect(marked[2]).toBe(true)
    expect(marked[7]).toBe(false)
    expect(marked.at(-1)).toBe(false)
  })

  it('présente « Mon choix », les propositions et des liens « Voir le produit »', () => {
    const page = byKey(buildBook(data()), 'need:1')
    expect(textsOf(page)).toEqual(expect.arrayContaining(['FAUTEUILS', 'MON CHOIX', 'Fauteuil', 'AUTRES PROPOSITIONS', 'Autre fauteuil']))
    expect(page.elements.filter((e) => e.type === 'text' && e.link)).toHaveLength(2)
  })

  it('accepte plus de 3 propositions, sur des pages « suite »', () => {
    const alternatives = Array.from({ length: 12 }, (_, i) => article(`Proposition ${i + 1}`, 1000 * (i + 1)))
    const pages = buildBook(data({ needs: [{ id: 7, title: 'Tapis', choice: article('Tapis', 50000), alternatives }] }))
    expect(textsOf(byKey(pages, 'need:7'))).toContain('Proposition 3')
    expect(textsOf(byKey(pages, 'need:7'))).not.toContain('Proposition 4')
    expect(textsOf(byKey(pages, 'need:7:2'))).toEqual(expect.arrayContaining(['Proposition 4', 'Proposition 11']))
    expect(textsOf(byKey(pages, 'need:7:3'))).toContain('Proposition 12')
  })

  it('totalise les choix additionnables dans le récapitulatif', () => {
    expect(textsOf(byKey(buildBook(data()), 'recap:1'))).toEqual(
      expect.arrayContaining(['Total (hors prix au m², au rouleau ou sur devis)', '300 €'])
    )
  })

  it('propose une légende sous chaque rendu, exportée seulement si elle est remplie', () => {
    const pages = buildBook(data())
    const empty = byKey(pages, 'render:1').elements.find((e): e is TextElement => e.type === 'text' && e.edit === 'caption:1')!
    expect(empty.placeholder).toBe('Ajouter une légende')
    expect(exported(byKey(pages, 'render:1'))).not.toContain(empty)
    expect(textsOf(byKey(pages, 'render:2'))).toContain('Vue du salon')
  })

  it('pose les annotations sur leur page, modifiables', () => {
    const pages = buildBook(data({ notes: [{ id: 5, pageKey: 'render:2', x: 30, y: 180, w: 90, text: 'Banquette sur mesure' }] }))
    const note = byKey(pages, 'render:2').elements.find((e): e is TextElement => e.type === 'text' && e.edit === 'note:5')!
    expect(note.runs[0].text).toBe('Banquette sur mesure')
    expect([note.x, note.y]).toEqual([30, 180])
  })

  it('garde les mêmes pages dans les trois styles, rendus compris', () => {
    for (const theme of ['classique', 'epure', 'contemporain'] as const) {
      const pages = buildBook(data({ theme }))
      expect(pages).toHaveLength(16)
      const render = byKey(pages, 'render:1').elements[0]
      expect(render.type).toBe('image')
      expect(render.w).toBeCloseTo(280) // toujours en grand, sur toute la largeur
    }
  })

  it('omet les sections vides', () => {
    expect(buildBook(data({ renders: [], needs: [], paints: [], artisans: [] }))).toHaveLength(6)
  })

  it('produit un HTML avec la police intégrée et une page par feuille', () => {
    const html = bookHtml(buildBook(data()))
    expect(html.match(/<section class="page">/g)).toHaveLength(16)
    expect(html).toContain('@font-face{font-family:Poppins;font-weight:200')
    expect(html).toContain('href="https://exemple.fr/Fauteuil"')
  })
})
