import { describe, expect, it } from 'vitest'
import type { Element, Page } from '@shared/book'
import { bookHtml, exported } from './html'
import { buildBook, exportedPages, reportLayout, type BookArticle, type BookData } from './layout'

const img = { url: 'mdeko://media/x.jpg', path: '/x.jpg', width: 1600, height: 900 }
let nextId = 1
const article = (name: string, cents: number | null, summable = true): BookArticle => ({
  id: nextId++,
  name,
  price: cents === null ? 'Sur devis' : `${cents / 100} €`,
  priceCents: cents,
  summable,
  supplier: 'Sklum',
  description: null,
  url: `https://exemple.fr/${encodeURIComponent(name)}`,
  image: img,
  images: [img]
})

const data = (over: Partial<BookData> = {}): BookData => ({
  kind: 'book',
  clientLabel: 'Mme Durand',
  clientAddress: '',
  dateLabel: 'Octobre 2026',
  designerName: 'Mélanie Exemple',
  address: '1 rue Exemple',
  phone: '00 00 00 00 00',
  email: 'contact@exemple.fr',
  reviewQr: null,
  intro: 'Avant-propos',
  wishes: 'Vos envies',
  report: '',
  closing: 'À vous',
  renders: [
    { id: 1, image: img, inset: null, section: 'plans', caption: null },
    { id: 2, image: img, inset: img, section: 'plans', caption: 'Vue du salon' }
  ],
  needs: [
    { id: 1, title: 'Fauteuils', room: null, quantity: 1, choice: article('Fauteuil', 30000), alternatives: [article('Autre fauteuil', 25000)] },
    { id: 2, title: 'Papiers peints', room: null, quantity: 1, choice: article('Papier peint', 8900, false), alternatives: [] }
  ],
  paints: [{ brand: 'Bilboquet Deco', promoCode: 'CODE', items: [{ name: 'Marelle', reference: 'Réf. 12', hex: '#F4F2ED', brand: 'Bilboquet Deco' }] }],
  showPrices: true,
  groupSingleChoices: false,
  trend: [],
  artisans: [{ trade: 'Peintre', name: 'Atelier', city: 'Lille', phone: '01' }],
  notes: [],
  adjustments: {},
  hiddenPages: [],
  ...over
})

type TextElement = Extract<Element, { type: 'text' }>
const textsOf = (p: Page) => p.elements.filter((e): e is TextElement => e.type === 'text').map((e) => e.runs.map((r) => r.text).join(''))
const NL = String.fromCharCode(10)
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
    expect(textsOf(page)).toEqual(expect.arrayContaining(['BILBOQUET DECO', 'NUANCIER', '01', 'MARELLE', 'Bilboquet Deco\nRéf. 12', 'CODE PROMO : CODE']))
    expect(textsOf(page).join(' ')).not.toContain('#F4F2ED')
    expect(page.elements.some((e) => e.type === 'rect' && e.fill === '#F4F2ED')).toBe(true)
  })

  it('montre la description des articles', () => {
    const choice = { ...article('Canapé', 90000), description: 'Velours côtelé, assise profonde' }
    const other = { ...article('Canapé droit', 70000), description: 'Lin lavé' }
    const page = byKey(buildBook(data({ needs: [{ id: 9, title: 'Canapés', room: null, quantity: 1, choice, alternatives: [other] }] })), 'need:9')
    expect(textsOf(page)).toEqual(expect.arrayContaining(['Velours côtelé, assise profonde', 'Lin lavé']))
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
    // 7 photos : réparties en 4 + 3, pas 6 + 1.
    expect(byKey(pages, 'trend:1').elements.filter((e) => e.type === 'image')).toHaveLength(4)
    expect(byKey(pages, 'trend:2').elements.filter((e) => e.type === 'image')).toHaveLength(3)
    expect(textsOf(pages[1]).slice(0, 2)).toEqual(['3-4.', 'Planche tendance'])
  })

  it('accepte autant de photos que voulu sur la planche tendance, sans en perdre', () => {
    for (const n of [1, 5, 6, 13, 25]) {
      const trend = Array.from({ length: n }, (_, i) => ({ id: 100 + i, image: img }))
      const pages = buildBook(data({ trend })).filter((p) => p.key.startsWith('trend:'))
      const ids = pages.flatMap((p) => p.elements.filter((e) => e.type === 'image').map((e) => e.id))
      expect(ids).toEqual(trend.map((t) => `trend:${t.id}`))
      expect(pages).toHaveLength(Math.ceil(n / 6))
      for (const p of pages) {
        for (const e of p.elements) {
          if (e.type !== 'image') continue
          expect(e.x).toBeGreaterThanOrEqual(19.9)
          expect(e.x + e.w).toBeLessThanOrEqual(277.1)
          expect(e.y + e.h).toBeLessThanOrEqual(188.1)
        }
      }
    }
  })

  it('pose la 4e de couverture : coordonnées étiquetées et QR code sur un bandeau taupe', () => {
    const back = buildBook(data({ reviewQr: img })).at(-1)!
    const panel = back.elements.find((e) => e.id === 'panel')!
    expect(panel.type).toBe('rect')
    expect(panel.h).toBe(210)
    const qr = back.elements.find((e) => e.id === 'qr')!
    expect(qr.x).toBeGreaterThan(panel.x)
    expect(textsOf(back)).toEqual(expect.arrayContaining(['Mélanie Exemple', 'ADRESSE', '1 rue Exemple', 'E-MAIL', 'VOTRE AVIS COMPTE']))
    // Sans QR code, le bandeau garde le logo.
    expect(buildBook(data()).at(-1)!.elements.some((e) => e.id === 'panel-logo')).toBe(true)
  })

  it('montre l’adresse du client sur la couverture, en option', () => {
    const cover = buildBook(data({ clientAddress: '12 rue des Lilas\n59000 Lille' }))[0]
    expect(textsOf(cover)).toEqual(['DESIGN BOOK', 'm·deko', 'Mme Durand', '12 rue des Lilas\n59000 Lille', 'Octobre 2026'])
    const date = cover.elements.find((e) => e.id === 'date')!
    expect(date.y + date.h).toBeLessThan(200)
  })

  it('titre un devis « DEVIS »', () => {
    expect(textsOf(buildBook(data({ kind: 'quote' }))[0])[0]).toBe('DEVIS')
  })

  it('garde les pages retirées hors de l’export, de la numérotation et du sommaire', () => {
    const all = buildBook(data({ hiddenPages: ['intro', 'wishes', 'artisans', 'closing'] }))
    expect(all).toHaveLength(16)
    expect(all.filter((p) => p.hidden).map((p) => p.key)).toEqual(['intro', 'wishes', 'artisans', 'closing'])
    const pages = exportedPages(all)
    expect(pages).toHaveLength(12)
    // Plans dès la page 3, intercalaires renumérotés.
    expect(textsOf(pages[1]).slice(0, -1)).toEqual(['3-5.', 'Plans d’aménagement intérieur', '6-9.', 'Shopping list', '10-11.', 'Teintes et couleurs'])
    expect(textsOf(byKey(pages, 'section:3'))[0]).toBe('—  01  —')
    expect(textsOf(pages[3]).at(-1)).toContain('4')
  })

  it('sans sommaire, numérote à partir de la couverture ; une section toute retirée perd son intercalaire', () => {
    const pages = exportedPages(buildBook(data({ hiddenPages: ['toc', 'paints:1'] })))
    expect(pages.map((p) => p.key)).not.toContain('toc')
    expect(pages.some((p) => textsOf(p).includes('TEINTES ET COULEURS'))).toBe(false)
    expect(textsOf(byKey(pages, 'intro')).at(-1)).toContain('2')
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

  it('place le compte-rendu après « Vos envies », sans multiplier les pages', () => {
    const short = buildBook(data({ report: 'Points abordés :' + NL + '- peinture du salon' + NL + '- devis du menuisier' }))
    expect(short.map((p) => p.key).slice(2, 6)).toEqual(['intro', 'wishes', 'report:1', 'section:3'])
    expect(textsOf(short[1])).toContain('Compte-rendu')
    // Les intercalaires gardent leur clé, mais leur numéro suit le sommaire.
    expect(textsOf(short[5])[0]).toBe('—  04  —')

    const paragraph = 'Nous avons fait le tour des pièces et validé les grandes orientations du projet avec le client. '
    const sizeOf = (n: number) => reportLayout(Array.from({ length: n }, () => paragraph.repeat(3)).join(NL + NL))
    // Peu de texte : une colonne en grand. Plus : la taille baisse, puis deux colonnes, toujours sur une page.
    expect(sizeOf(1)).toMatchObject({ columns: 1, size: 15 })
    expect(sizeOf(6).pages).toHaveLength(1)
    expect(sizeOf(8)).toMatchObject({ columns: 2 })
    expect(sizeOf(10).pages).toHaveLength(1)
    // Un peu plus long : deux pages, en reprenant une taille confortable.
    expect(sizeOf(12)).toMatchObject({ columns: 2, size: 12 })
    expect(sizeOf(12).pages).toHaveLength(2)
    // Très long (environ 3 000 mots, 500 par page) : quelques pages seulement.
    expect(sizeOf(60).pages.length).toBeLessThanOrEqual(6)
  })

  it('découpe le compte-rendu en colonnes qui reprennent tout le texte, dans l’ordre', () => {
    const body = Array.from({ length: 40 }, (_, i) => `Point ${i + 1} : décision prise sur le mobilier et les finitions de la pièce.`).join(NL)
    const { pages } = reportLayout(body)
    const parts = pages.flat()
    // Rien n'est perdu : entre deux colonnes, seulement des espaces ou des retours à la ligne.
    expect(parts[0].start).toBe(0)
    expect(parts.at(-1)!.end).toBe(body.length)
    parts.slice(1).forEach((c, i) => expect(body.slice(parts[i].end, c.start).trim()).toBe(''))
    const book = buildBook(data({ report: body }))
    const edits = book.filter((p) => p.key.startsWith('report:')).flatMap((p) => p.elements.filter((e) => e.type === 'text' && e.edit?.startsWith('report:')))
    expect(edits).toHaveLength(parts.length)
  })
})
