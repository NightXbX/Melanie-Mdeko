import { describe, expect, it } from 'vitest'
import type { Element, Page } from '@shared/book'
import { bookHtml, exported } from './html'
import { buildBook, type BookArticle, type BookData } from './layout'

const img = { url: 'mdeko://media/x.jpg', path: '/x.jpg', width: 1600, height: 900 }
let nextId = 1
const article = (name: string, cents: number | null, summable = true): BookArticle => ({
  id: nextId++,
  name,
  price: cents === null ? 'Sur devis' : `${cents / 100} €`,
  priceCents: cents,
  summable,
  supplier: 'Sklum',
  url: `https://exemple.fr/${encodeURIComponent(name)}`,
  image: img,
  images: [img]
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
    { id: 1, image: img, inset: null, section: 'plans', caption: null },
    { id: 2, image: img, inset: img, section: 'plans', caption: 'Vue du salon' }
  ],
  needs: [
    { id: 1, title: 'Fauteuils', room: null, quantity: 1, choice: article('Fauteuil', 30000), alternatives: [article('Autre fauteuil', 25000)] },
    { id: 2, title: 'Papiers peints', room: null, quantity: 1, choice: article('Papier peint', 8900, false), alternatives: [] }
  ],
  paints: [{ brand: 'Bilbo Quet Deco', promoCode: 'CODE', items: [{ name: 'Marelle', reference: 'Réf. 12', hex: '#F4F2ED', brand: 'Bilbo Quet Deco' }] }],
  showPrices: true,
  groupSingleChoices: false,
  trend: [],
  artisans: [{ trade: 'Peintre', name: 'Atelier', city: 'Lille', phone: '01' }],
  notes: [],
  adjustments: {},
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
      '12-13.', 'Teintes et couleurs',
      '14.', 'Artisans',
      '15.', 'C’est à vous !'
    ])
    expect(textsOf(pages[7])).toEqual(['—  04  —', 'SHOPPING LIST'])
  })

  it('met les repères de page partout sauf couverture, intercalaires et 4e de couverture', () => {
    const pages = buildBook(data())
    const marked = pages.map((p) => textsOf(p).some((t) => t.startsWith('m·deko   ·')))
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
    const pages = buildBook(data({ needs: [{ id: 7, title: 'Tapis', room: null, quantity: 1, choice: article('Tapis', 50000), alternatives }] }))
    expect(textsOf(byKey(pages, 'need:7'))).toContain('Proposition 3')
    expect(textsOf(byKey(pages, 'need:7'))).not.toContain('Proposition 4')
    expect(textsOf(byKey(pages, 'need:7:2'))).toEqual(expect.arrayContaining(['Proposition 4', 'Proposition 11']))
    expect(textsOf(byKey(pages, 'need:7:3'))).toContain('Proposition 12')
  })

  it('range la shopping list par pièce, chacune avec son intercalaire', () => {
    const salon = { id: 3, name: 'Salon' }
    const pages = buildBook(
      data({
        needs: [
          { id: 1, title: 'Fauteuils', room: null, quantity: 1, choice: article('Fauteuil', 30000), alternatives: [] },
          { id: 2, title: 'Tapis', room: salon, quantity: 1, choice: article('Tapis', 9000), alternatives: [] },
          { id: 4, title: 'Suspensions', room: salon, quantity: 1, choice: article('Suspension', 9000), alternatives: [] }
        ]
      })
    )
    const keys = pages.map((p) => p.key)
    expect(keys.filter((k) => k.startsWith('room:'))).toEqual(['room:3'])
    expect(keys.indexOf('need:1')).toBeLessThan(keys.indexOf('room:3'))
    expect(keys.indexOf('room:3')).toBe(keys.indexOf('need:2') - 1)
    expect(textsOf(byKey(pages, 'room:3'))).toEqual(['—  Shopping list  —', 'SALON'])
    expect(textsOf(byKey(pages, 'need:4'))).toContain('SALON')
    expect(textsOf(byKey(pages, 'recap:1'))).toEqual(expect.arrayContaining(['SALON', 'Tapis', 'Suspension']))
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

  it('met m·deko en grand sur la couverture, le client et la date en bas', () => {
    const cover = buildBook(data())[0]
    const el = (id: string) => cover.elements.find((e) => e.id === id)!
    expect(textsOf(cover)).toEqual(['DESIGN BOOK', 'm·deko', 'Mme Durand', 'Octobre 2026'])
    expect(el('client').y).toBeGreaterThan(el('logo').y + el('logo').h)
    expect(el('date').y).toBeGreaterThan(el('client').y)
  })

  it('montre le rendu en grand et le cartouche m·deko suit le rendu ajusté', () => {
    const plain = byKey(buildBook(data()), 'render:1').elements[0]
    expect(plain.w).toBeCloseTo(280) // toujours en grand, sur toute la largeur
    const pages = buildBook(data({ adjustments: { 'render:1|render': { x: 50, y: 20, w: 160, h: 90 } } }))
    const [image, stamp] = byKey(pages, 'render:1').elements
    expect([image.x, image.y, image.w, image.h, image.adjusted]).toEqual([50, 20, 160, 90, true])
    expect(stamp.x + stamp.w).toBeCloseTo(210)
    expect(stamp.y + stamp.h).toBeCloseTo(110)
  })

  it('applique taille et texte ajustés, et rend les textes du book modifiables', () => {
    const base = data()
    const choiceId = base.needs[0].choice!.id
    const pages = buildBook({
      ...base,
      adjustments: { 'cover|client': { size: 30, text: 'Famille Durand' }, [`need:1|choice:${choiceId}:name`]: { text: 'Fauteuil velours' } }
    })
    const client = pages[0].elements.find((e): e is TextElement => e.id === 'client')!
    expect(client.runs[0].text).toBe('Famille Durand')
    expect(client.style.size).toBe(30)
    expect(client.edit).toBe('text:cover|client')
    expect(textsOf(byKey(pages, 'need:1'))).toContain('Fauteuil velours')
    // Le logo (plusieurs couleurs) se déplace mais ne se réécrit pas.
    expect(pages[0].elements.find((e): e is TextElement => e.id === 'logo')!.edit).toBeUndefined()
  })

  it('montre plusieurs photos pour « Mon choix »', () => {
    const photos = [img, { ...img, url: 'mdeko://media/y.jpg' }, { ...img, url: 'mdeko://media/z.jpg' }]
    const choice = { ...article('Canapé', 90000), images: photos }
    const page = byKey(buildBook(data({ needs: [{ id: 9, title: 'Canapés', room: null, quantity: 1, choice, alternatives: [] }] })), 'need:9')
    const shown = page.elements.filter((e) => e.type === 'image')
    expect(shown).toHaveLength(3)
    expect(new Set(shown.map((e) => e.id)).size).toBe(3)
  })

  it('accepte un « Mon choix » sans photo', () => {
    const choice = { ...article('Sur mesure', null), image: null, images: [] }
    const page = byKey(buildBook(data({ needs: [{ id: 9, title: 'Banquette', room: null, quantity: 1, choice, alternatives: [] }] })), 'need:9')
    expect(page.elements.filter((e) => e.type === 'image')).toHaveLength(0)
  })

  it('présente les teintes en nuancier, numérotées avec leur marque, sans code couleur', () => {
    const page = byKey(buildBook(data()), 'paints:1')
    expect(textsOf(page)).toEqual(expect.arrayContaining(['BILBO QUET DECO', 'NUANCIER', '01', 'MARELLE', 'Bilbo Quet Deco\nRéf. 12', 'CODE PROMO : CODE']))
    expect(textsOf(page).join(' ')).not.toContain('#F4F2ED')
    expect(page.elements.some((e) => e.type === 'rect' && e.fill === '#F4F2ED')).toBe(true)
  })

  it('compte les quantités dans les prix et le total', () => {
    const needs: BookData['needs'] = [{ id: 1, title: 'Chaises', room: null, quantity: 4, choice: article('Chaise', 5000), alternatives: [] }]
    const pages = buildBook(data({ needs }))
    expect(textsOf(byKey(pages, 'need:1'))).toContain('4 × 50 €')
    expect(textsOf(byKey(pages, 'recap:1'))).toEqual(expect.arrayContaining(['QTÉ', '4', '200 €']))
  })

  it('peut masquer les prix', () => {
    const needs: BookData['needs'] = [{ id: 1, title: 'Chaises', room: null, quantity: 2, choice: article('Chaise', 5000), alternatives: [article('Tabouret', 3000)] }]
    const pages = buildBook(data({ needs, showPrices: false }))
    const texts = pages.flatMap(textsOf).join(' | ')
    expect(texts).not.toContain('50 €')
    expect(texts).not.toContain('Total')
    expect(textsOf(byKey(pages, 'need:1'))).toContain('Quantité : 2')
  })

  it('peut réunir les choix sans autre proposition d’une pièce sur une même page', () => {
    const salon = { id: 3, name: 'Salon' }
    const needs: BookData['needs'] = [
      { id: 1, title: 'Fauteuils', room: salon, quantity: 1, choice: article('Fauteuil', 30000), alternatives: [article('Autre', 1000)] },
      ...[2, 4, 5, 6, 8].map((id) => ({ id, title: 'Luminaires', room: salon, quantity: 1, choice: article(`Lampe ${id}`, 9000), alternatives: [] }))
    ]
    const keys = buildBook(data({ needs, groupSingleChoices: true })).map((p) => p.key)
    expect(keys.filter((k) => k.startsWith('choices:'))).toEqual(['choices:2', 'choices:8'])
    expect(keys.some((k) => k === 'need:4')).toBe(false)
    expect(keys).toContain('need:1')
  })

  it('ajoute une planche tendance au début, en option', () => {
    const trend = Array.from({ length: 7 }, (_, i) => ({ id: 50 + i, image: img }))
    const pages = buildBook(data({ trend }))
    expect(pages.slice(2, 4).map((p) => p.key)).toEqual(['trend:1', 'trend:2'])
    expect(byKey(pages, 'trend:1').elements.filter((e) => e.type === 'image')).toHaveLength(6)
    expect(textsOf(pages[1]).slice(0, 2)).toEqual(['3-4.', 'Planche tendance'])
  })

  it('pose la 4e de couverture dans un grand disque taupe', () => {
    const back = buildBook(data({ reviewQr: img })).at(-1)!
    const disc = back.elements.find((e) => e.id === 'disc')!
    expect(disc.type).toBe('ellipse')
    expect(disc.h).toBeGreaterThan(150)
    expect(textsOf(back)).toEqual(expect.arrayContaining(['Mélanie Exemple', 'Laisser un avis :']))
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
