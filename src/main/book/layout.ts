import { textKey, type BookAdjustment, type Box, type Element, type ImageRef, type Page, type Run, type TextStyle } from '@shared/book'
import { BOTTOM, COLORS, MARGIN, PAGE, RENDER, TEXT_BLOCK, WATERMARK } from './charte'

export type { Element, ImageRef, Page }

// --- Données du book (assemblées depuis la base par data.ts) -------------------------------------

export interface BookArticle {
  id: number
  name: string
  price: string
  priceCents: number | null
  summable: boolean // prix additionnable dans le total (pas au m², au rouleau ni sur devis)
  supplier: string | null
  url: string | null
  image: ImageRef | null
  images: ImageRef[] // photos montrées dans le book (« Mon choix » peut en avoir plusieurs)
}

export interface BookNote {
  id: number
  pageKey: string
  x: number
  y: number
  w: number
  text: string
}

export interface BookData {
  clientLabel: string // « Mme Durand »
  dateLabel: string // « Septembre 2026 »
  designerName: string
  address: string
  phone: string
  email: string
  reviewQr: ImageRef | null
  intro: string
  wishes: string
  closing: string
  renders: { id: number; image: ImageRef; inset: ImageRef | null; section: 'plans' | 'changes'; caption: string | null }[]
  // Rangés par pièce (articles sans pièce en tête), dans l'ordre des pièces du projet.
  needs: { id: number; title: string; room: { id: number; name: string } | null; choice: BookArticle | null; alternatives: BookArticle[] }[]
  paints: { brand: string; promoCode: string | null; items: { name: string; reference: string | null; hex: string | null }[] }[]
  artisans: { trade: string; name: string; city: string | null; phone: string | null }[]
  notes: BookNote[]
  // Ajustements faits dans l'aperçu, par « <page>|<élément> ».
  adjustments: Record<string, BookAdjustment>
}

type TextElement = Extract<Element, { type: 'text' }>
type Adjust = (id: string) => BookAdjustment | undefined

// --- Briques ---------------------------------------------------------------------------------------

const text = (box: Box, value: string | Run[], style: TextStyle, extra: Partial<TextElement> = {}): Element => ({
  type: 'text',
  ...box,
  runs: typeof value === 'string' ? [{ text: value }] : value,
  style: { weight: 200, color: COLORS.text, align: 'left', valign: 'top', lineHeight: 1.3, ...style },
  ...extra
})

const line = (x: number, y: number, w: number, color = COLORS.taupeLight, thickness = 0.2): Element => ({
  type: 'rect',
  x,
  y,
  w,
  h: thickness,
  fill: color
})

// Image entière dans son cadre, centrée (équivalent de « contain »).
function fitted(image: ImageRef, box: Box, id?: string): Extract<Element, { type: 'image' }> {
  const scale = Math.min(box.w / image.width, box.h / image.height)
  const w = image.width * scale
  const h = image.height * scale
  return { type: 'image', image, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h, ...(id ? { id } : {}) }
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)
const two = (n: number) => String(n).padStart(2, '0')

function logo(box: Box, size: number, align: TextStyle['align'], id?: string, colors = { m: COLORS.taupe, deko: COLORS.text }, dekoWeight: 200 | 300 = 200): Element {
  return text(
    box,
    [{ text: 'm', color: colors.m }, { text: '·', color: colors.m }, { text: 'deko', color: colors.deko, weight: dekoWeight }],
    { size, align, valign: 'middle', lineHeight: 1 },
    id ? { id } : {}
  )
}

function articleLink(box: Box, url: string, size: number, id: string): Element {
  return text(box, 'Voir le produit ›', { size, weight: 400, color: COLORS.taupeDark }, { link: url, id })
}

function label(box: Box, value: string, size = 8.5, id?: string): Element {
  return text(box, value.toUpperCase(), { size, weight: 500, color: COLORS.taupeDark, letterSpacing: 2 }, id ? { id } : {})
}

// Pied de page discret : m·deko et le numéro de page.
function footer(page: number): Element[] {
  return [
    text({ x: 98.5, y: 198, w: 100, h: 6 }, [{ text: 'm', color: COLORS.taupe }, { text: '·deko' }, { text: `   ·   ${page}`, color: COLORS.textSoft }], {
      size: 9,
      weight: 300,
      align: 'center',
      valign: 'middle'
    })
  ]
}

// Intercalaire : titre horizontal, lisible, avec un sur-titre (numéro de section du sommaire, ou « Shopping list »
// au-dessus d'une pièce).
function dividerPage(title: string, n: string, key: string): Page {
  return {
    key,
    elements: [
      text({ x: 48.5, y: 80, w: 200, h: 7 }, `—  ${n}  —`, { size: 10, weight: 400, color: COLORS.taupeDark, align: 'center', letterSpacing: 3 }, { id: 'number' }),
      text({ x: 13.5, y: 90, w: 270, h: 18 }, title.toUpperCase(), { size: 26, align: 'center', valign: 'middle', letterSpacing: 6, lineHeight: 1 }, { id: 'title' }),
      line(138.5, 114, 20, COLORS.taupe, 0.3)
    ]
  }
}

// Couverture : m·deko en grand au centre, le client et la date en bas.
function coverPage(d: BookData): Page {
  return {
    key: 'cover',
    elements: [
      text({ x: 48.5, y: 66, w: 200, h: 7 }, 'DESIGN BOOK', { size: 11, weight: 400, color: COLORS.taupeDark, align: 'center', letterSpacing: 6 }, { id: 'title' }),
      logo({ x: 28.5, y: 78, w: 240, h: 36 }, 80, 'center', 'logo'),
      line(138.5, 160, 20, COLORS.taupe, 0.3),
      text({ x: 28.5, y: 166, w: 240, h: 10 }, d.clientLabel, { size: 18, align: 'center', valign: 'middle', lineHeight: 1 }, { id: 'client' }),
      text({ x: 48.5, y: 177, w: 200, h: 7 }, d.dateLabel, { size: 12, weight: 300, color: COLORS.textSoft, align: 'center', valign: 'middle' }, { id: 'date' })
    ]
  }
}

// 4e de couverture : grand disque taupe avec le logo et les coordonnées, QR code « avis » posé sur son bord.
function backCover(d: BookData): Page {
  const cx = 117.5
  const cy = 108.5
  const r = 83
  const column = { x: 56, w: 92 } // colonne de texte, un peu à gauche du centre du disque
  const lines = [d.address, d.phone, d.email].filter(Boolean).join('\n')
  const elements: Element[] = [
    { type: 'ellipse', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, fill: COLORS.disc, id: 'disc' },
    logo({ ...column, y: 66, h: 26 }, 58, 'center', 'logo', { m: COLORS.discLogo, deko: '#2E2E2E' }, 300),
    text({ ...column, y: 99, h: 9 }, d.designerName, { size: 17, weight: 300, color: '#2E2E2E', align: 'center', valign: 'middle' }, { id: 'name' }),
    text({ x: column.x - 4, w: column.w + 8, y: 109.5, h: 40 }, lines, { size: 13, weight: 300, color: '#2E2E2E', align: 'center', lineHeight: 1.7 }, { id: 'contact' })
  ]
  if (d.reviewQr) {
    elements.push(
      text({ x: 160, y: 74, w: 70, h: 8 }, 'Laisser un avis :', { size: 13, weight: 300, valign: 'middle' }, { id: 'review' }),
      { type: 'rect', x: 160, y: 85, w: 54.5, h: 57.5, fill: COLORS.white, id: 'qr-frame' },
      fitted(d.reviewQr, { x: 162.5, y: 87.5, w: 49.5, h: 52.5 }, 'qr')
    )
  }
  return { key: 'back', elements }
}

// --- Pages de contenu ------------------------------------------------------------------------------

function textPage(key: string, body: string, edit: string, signature: string | null): Page {
  const { x, y, width, height, size, lineHeight } = TEXT_BLOCK
  const elements = [text({ x, y, w: width, h: height }, body, { size, lineHeight, align: 'justify' }, { edit, id: 'body' })]
  if (signature) elements.push(text({ x, y: y + height + 2, w: width, h: 10 }, signature, { size, align: 'right' }, { id: 'signature' }))
  return { key, elements }
}

function renderPage(r: BookData['renders'][number], adjust: Adjust): Page {
  const slot = { x: RENDER.x, y: RENDER.y, w: RENDER.width, h: RENDER.height }
  const a = adjust('render')
  const img = fitted(r.image, a ? { x: a.x ?? slot.x, y: a.y ?? slot.y, w: a.w ?? slot.w, h: a.h ?? slot.h } : slot, 'render')
  // Petit cartouche m·deko en bas à droite du rendu, comme sur ses planches : il suit le rendu.
  const wx = img.x + img.w - WATERMARK.width
  const wy = img.y + img.h - WATERMARK.height
  const elements: Element[] = [
    img,
    { type: 'rect', x: wx, y: wy, w: WATERMARK.width, h: WATERMARK.height, fill: COLORS.watermark },
    text({ x: wx, y: wy, w: WATERMARK.width, h: WATERMARK.height }, [{ text: 'm', color: COLORS.taupe }, { text: '·deko', color: COLORS.white }], {
      size: WATERMARK.size,
      align: 'center',
      valign: 'middle',
      lineHeight: 1
    })
  ]
  let y = img.y + img.h + 3
  elements.push(
    text({ x: img.x, y, w: img.w, h: 7 }, r.caption ?? '', { size: 11, weight: 300, color: COLORS.textSoft }, {
      edit: `caption:${r.id}`,
      placeholder: 'Ajouter une légende',
      id: 'caption'
    })
  )
  y += 9
  if (r.inset) {
    const h = Math.min(28, BOTTOM - y)
    if (h > 8) elements.push(fitted(r.inset, { x: img.x, y, w: 60, h }, 'inset'))
  }
  return { key: `render:${r.id}`, elements }
}

// Plusieurs photos d'un même article dans son cadre : 1 en grand, 2 côte à côte, 3 (une grande et deux
// petites), 4 en carré. Au-delà, les 4 premières.
export function photoGrid(box: Box, count: number, gap = 3): Box[] {
  const n = Math.min(count, 4)
  const half = (v: number) => (v - gap) / 2
  if (n <= 1) return [box]
  if (n === 2) return [0, 1].map((i) => ({ x: box.x + i * (half(box.w) + gap), y: box.y, w: half(box.w), h: box.h }))
  if (n === 3) {
    const big = box.w * 0.6
    const small = box.w - big - gap
    return [
      { x: box.x, y: box.y, w: big, h: box.h },
      { x: box.x + big + gap, y: box.y, w: small, h: half(box.h) },
      { x: box.x + big + gap, y: box.y + half(box.h) + gap, w: small, h: half(box.h) }
    ]
  }
  return [0, 1, 2, 3].map((i) => ({
    x: box.x + (i % 2) * (half(box.w) + gap),
    y: box.y + Math.floor(i / 2) * (half(box.h) + gap),
    w: half(box.w),
    h: half(box.h)
  }))
}

const FIRST_ALTERNATIVES = 3
const ALTERNATIVES_PER_PAGE = 8

// Une page par besoin : « Mon choix » en grand, 3 propositions à côté, les suivantes sur des pages « suite ».
function needPages(need: BookData['needs'][number]): Page[] {
  const title = (suffix = '') =>
    text({ x: MARGIN, y: 12, w: 200, h: 7 }, need.title.toUpperCase() + suffix, {
      size: 11,
      weight: 400,
      color: COLORS.taupeDark,
      letterSpacing: 2
    }, suffix ? {} : { edit: `needLabel:${need.id}`, id: 'title' })

  const room = () =>
    text({ x: 297 - MARGIN - 90, y: 12, w: 90, h: 7 }, need.room?.name.toUpperCase() ?? '', {
      size: 11,
      weight: 300,
      color: COLORS.taupeDark,
      letterSpacing: 2,
      align: 'right'
    })

  const el: Element[] = [title(), room()]
  const c = need.choice
  if (c) {
    const id = (part: string) => `choice:${c.id}:${part}`
    const photo = { x: MARGIN, y: 22, w: 128, h: 118 }
    el.push({ type: 'rect', ...photo, line: COLORS.taupeLight, id: id('frame') })
    const inner = { x: photo.x + 6, y: photo.y + 6, w: photo.w - 12, h: photo.h - 12 }
    const images = c.images.slice(0, 4)
    if (images.length) photoGrid(inner, images.length).forEach((cell, i) => el.push(fitted(images[i], cell, id(`photo${i + 1}`))))
    el.push(
      label({ x: MARGIN, y: 145, w: 128, h: 5 }, 'Mon choix', 8.5, id('label')),
      text({ x: MARGIN, y: 151, w: 128, h: 13 }, truncate(c.name, 90), { size: 14, weight: 300, lineHeight: 1.25 }, { id: id('name') }),
      text({ x: MARGIN, y: 165, w: 70, h: 9 }, c.price, { size: 18, weight: 400, valign: 'middle' }, { id: id('price') }),
      text({ x: MARGIN, y: 175, w: 128, h: 6 }, c.supplier ?? '', { size: 11, weight: 300, color: COLORS.textSoft }, { id: id('supplier') })
    )
    if (c.url) el.push(articleLink({ x: MARGIN, y: 182, w: 60, h: 6 }, c.url, 10, id('link')))
  }

  const first = need.alternatives.slice(0, FIRST_ALTERNATIVES)
  if (first.length) {
    const left = 165
    // Filet vertical entre « Mon choix » et les propositions.
    el.push(label({ x: left, y: 22, w: 112, h: 5 }, 'Autres propositions', 8.5, 'others'), {
      type: 'rect',
      x: 156,
      y: 22,
      w: 0.2,
      h: 160,
      fill: COLORS.taupeLight
    })
    first.forEach((a, i) => {
      const id = (part: string) => `alt:${a.id}:${part}`
      const y = 30 + i * 54
      const photo = { x: left, y, w: 46, h: 46 }
      el.push({ type: 'rect', ...photo, line: COLORS.taupeLight, id: id('frame') })
      if (a.image) el.push(fitted(a.image, { x: photo.x + 3, y: photo.y + 3, w: photo.w - 6, h: photo.h - 6 }, id('photo')))
      const tx = left + 51
      el.push(
        text({ x: tx, y: y + 1, w: 61, h: 15 }, truncate(a.name, 70), { size: 10, weight: 300, lineHeight: 1.25 }, { id: id('name') }),
        text({ x: tx, y: y + 17, w: 61, h: 7 }, a.price, { size: 13, weight: 400 }, { id: id('price') }),
        text({ x: tx, y: y + 25, w: 61, h: 5 }, a.supplier ?? '', { size: 9, weight: 300, color: COLORS.textSoft }, { id: id('supplier') })
      )
      if (a.url) el.push(articleLink({ x: tx, y: y + 31, w: 40, h: 5 }, a.url, 9, id('link')))
    })
  }
  const pages: Page[] = [{ key: `need:${need.id}`, elements: el }]

  // Propositions supplémentaires : grille de 4 × 2 par page.
  const rest = need.alternatives.slice(FIRST_ALTERNATIVES)
  for (let start = 0, n = 2; start < rest.length; start += ALTERNATIVES_PER_PAGE, n++) {
    const els: Element[] = [title('  ·  AUTRES PROPOSITIONS (SUITE)'), room()]
    rest.slice(start, start + ALTERNATIVES_PER_PAGE).forEach((a, i) => {
      const id = (part: string) => `alt:${a.id}:${part}`
      const x = MARGIN + (i % 4) * 65
      const y = 24 + Math.floor(i / 4) * 82
      const photo = { x, y, w: 60, h: 46 }
      els.push({ type: 'rect', ...photo, line: COLORS.taupeLight, id: id('frame') })
      if (a.image) els.push(fitted(a.image, { x: x + 3, y: y + 3, w: 54, h: 40 }, id('photo')))
      els.push(
        text({ x, y: y + 49, w: 60, h: 11 }, truncate(a.name, 60), { size: 10, weight: 300, lineHeight: 1.25 }, { id: id('name') }),
        text({ x, y: y + 61, w: 60, h: 6 }, a.price, { size: 12, weight: 400 }, { id: id('price') }),
        text({ x, y: y + 68, w: 60, h: 5 }, a.supplier ?? '', { size: 9, weight: 300, color: COLORS.textSoft }, { id: id('supplier') })
      )
      if (a.url) els.push(articleLink({ x, y: y + 74, w: 40, h: 5 }, a.url, 9, id('link')))
    })
    pages.push({ key: `need:${need.id}:${n}`, elements: els })
  }
  return pages
}

// Pages de la shopping list : les articles sans pièce, puis chaque pièce précédée de son intercalaire.
function shoppingPages(needs: BookData['needs']): Page[] {
  const pages: Page[] = []
  let room: number | null = null
  for (const need of needs) {
    if (need.room && need.room.id !== room) pages.push(dividerPage(need.room.name, 'Shopping list', `room:${need.room.id}`))
    room = need.room?.id ?? null
    pages.push(...needPages(need))
  }
  return pages
}

const RECAP_ROWS = 15

function formatEuros(cents: number): string {
  const v = cents / 100
  return `${v.toLocaleString('fr-FR', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')} €`
}

function recapPages(needs: BookData['needs'], dateLabel: string): Page[] {
  const rows = needs.filter((n) => n.choice)
  if (!rows.length) return []
  const pages: Page[] = []
  const total = rows.reduce((sum, n) => sum + (n.choice!.summable ? (n.choice!.priceCents ?? 0) : 0), 0)
  const partial = rows.some((n) => !n.choice!.summable)
  // Une ligne de titre au début de chaque pièce.
  const lines: (BookData['needs'][number] | string)[] = []
  rows.forEach((n, i) => {
    if (n.room && n.room.id !== rows[i - 1]?.room?.id) lines.push(n.room.name)
    lines.push(n)
  })
  const cols = [
    { x: MARGIN, w: 58, label: 'Catégorie' },
    { x: 80, w: 112, label: 'Article' },
    { x: 194, w: 46, label: 'Fournisseur' },
    { x: 240, w: 37, label: 'Prix' }
  ]
  // Pages de RECAP_ROWS lignes ; un titre de pièce ne reste jamais seul en bas de page.
  const chunks: (typeof lines)[] = [[]]
  for (const l of lines) {
    const last = chunks[chunks.length - 1]
    if (last.length === RECAP_ROWS || (typeof l === 'string' && last.length === RECAP_ROWS - 1)) chunks.push([l])
    else last.push(l)
  }
  for (const [c, slice] of chunks.entries()) {
    const head = 30
    const el: Element[] = [text({ x: MARGIN, y: 12, w: 200, h: 12 }, 'Récapitulatif de mes choix', { size: 22, valign: 'middle' }, { id: 'title' })]
    cols.forEach((c, i) =>
      el.push(
        text({ x: c.x, y: head, w: c.w, h: 6 }, c.label.toUpperCase(), {
          size: 8.5,
          weight: 500,
          color: COLORS.taupeDark,
          letterSpacing: 2,
          align: i === 3 ? 'right' : 'left'
        })
      )
    )
    slice.forEach((n, i) => {
      const y = head + 8 + i * 9.5
      if (typeof n === 'string') {
        el.push(text({ x: MARGIN, y, w: 200, h: 8 }, n.toUpperCase(), { size: 9, weight: 500, valign: 'bottom', color: COLORS.taupeDark, letterSpacing: 2 }))
        return
      }
      const a = n.choice!
      el.push(
        line(MARGIN, y - 1, 257),
        text({ x: cols[0].x, y, w: cols[0].w, h: 8 }, truncate(n.title, 30), { size: 10, weight: 300, valign: 'middle', color: COLORS.textSoft }),
        text({ x: cols[1].x, y, w: cols[1].w, h: 8 }, truncate(a.name, 60), { size: 10, weight: 300, valign: 'middle' }, a.url ? { link: a.url } : {}),
        text({ x: cols[2].x, y, w: cols[2].w, h: 8 }, truncate(a.supplier ?? '', 24), { size: 10, weight: 300, valign: 'middle' }),
        text({ x: cols[3].x, y, w: cols[3].w, h: 8 }, a.price, { size: 10, weight: 400, valign: 'middle', align: 'right' })
      )
    })
    if (c === chunks.length - 1) {
      const y = head + 8 + slice.length * 9.5 + 2
      el.push(
        line(MARGIN, y - 1, 257, COLORS.taupe, 0.3),
        text({ x: 150, y, w: 88, h: 9 }, partial ? 'Total (hors prix au m², au rouleau ou sur devis)' : 'Total', {
          size: 10,
          weight: 300,
          align: 'right',
          valign: 'middle'
        }),
        text({ x: 240, y, w: 37, h: 9 }, formatEuros(total), { size: 13, weight: 400, align: 'right', valign: 'middle' }),
        text({ x: MARGIN, y: y + 12, w: 200, h: 6 }, `Prix indicatifs relevés en ${dateLabel.toLowerCase()}, susceptibles d’évoluer.`, {
          size: 8,
          weight: 300,
          color: COLORS.textSoft
        }, { id: 'disclaimer' })
      )
    }
    pages.push({ key: `recap:${pages.length + 1}`, elements: el })
  }
  return pages
}

const CHIPS_PER_PAGE = 8

// Nuancier façon planche d'architecte : grands échantillons rectangulaires, numérotés, avec nom,
// référence et code couleur sous chacun ; une marque par page, son nom en cartouche au-dessus d'un filet.
function paintPages(paints: BookData['paints']): Page[] {
  const pages: Page[] = []
  let n = 0
  for (const group of paints) {
    for (let start = 0; start < group.items.length; start += CHIPS_PER_PAGE) {
      const items = group.items.slice(start, start + CHIPS_PER_PAGE)
      const rows = items.length > 4 ? 2 : 1
      const perRow = Math.min(items.length, 4)
      const gap = 12
      const w = (257 - 3 * gap) / 4
      const h = rows === 2 ? 50 : 72
      const legend = 24
      const top = 34 + (152 - rows * (h + legend) - (rows - 1) * 8) / 2
      const left = MARGIN + ((4 - perRow) * (w + gap)) / 2 // rangée centrée s'il y a moins de 4 teintes
      const el: Element[] = [
        text({ x: MARGIN, y: 12, w: 170, h: 8 }, group.brand.toUpperCase(), { size: 11, weight: 400, color: COLORS.taupeDark, letterSpacing: 3, valign: 'middle' }, { id: 'brand' }),
        text({ x: 297 - MARGIN - 80, y: 12, w: 80, h: 8 }, 'NUANCIER', { size: 8.5, weight: 400, color: COLORS.textSoft, letterSpacing: 3, align: 'right', valign: 'middle' }),
        line(MARGIN, 22, 257, COLORS.text, 0.15)
      ]
      items.forEach((p, i) => {
        n++
        const id = (part: string) => `paint:${start + i}:${part}`
        const x = left + (i % 4) * (w + gap)
        const y = top + Math.floor(i / 4) * (h + legend + 8)
        el.push(
          { type: 'rect', x, y, w, h, fill: p.hex ?? COLORS.white, line: p.hex ? undefined : COLORS.taupeLight, id: id('chip') },
          line(x, y + h + 3, w, COLORS.text, 0.15),
          text({ x, y: y + h + 5, w: 12, h: 5 }, two(n), { size: 8, weight: 500, color: COLORS.taupeDark, letterSpacing: 1 }),
          text({ x: x + 12, y: y + h + 5, w: w - 12, h: 5 }, p.name.toUpperCase(), { size: 9, weight: 400, letterSpacing: 1.5 }, { id: id('name') }),
          text({ x: x + 12, y: y + h + 11, w: w - 12, h: 10 }, [p.reference, p.hex?.toUpperCase()].filter(Boolean).join('\n'), {
            size: 8,
            weight: 300,
            color: COLORS.textSoft,
            lineHeight: 1.35
          }, { id: id('ref') })
        )
      })
      if (group.promoCode) {
        el.push(text({ x: 177, y: 186, w: 100, h: 6 }, `CODE PROMO : ${group.promoCode}`, { size: 9, weight: 300, align: 'right', letterSpacing: 1 }, { id: 'promo' }))
      }
      pages.push({ key: `paints:${pages.length + 1}`, elements: el })
    }
  }
  return pages
}

function artisansPage(artisans: BookData['artisans']): Page {
  const list = artisans.slice(0, 12)
  const top = 30 + (150 - list.length * 13) / 2
  const el: Element[] = [text({ x: MARGIN, y: 14, w: 200, h: 12 }, 'Artisans', { size: 22, valign: 'middle' }, { id: 'title' })]
  list.forEach((a, i) => {
    const y = top + i * 13
    el.push(
      text({ x: 40, y, w: 60, h: 10 }, a.trade.toUpperCase(), { size: 9, weight: 500, color: COLORS.taupeDark, letterSpacing: 2, valign: 'middle' }),
      text({ x: 100, y, w: 110, h: 10 }, a.city ? `${a.name} (${a.city})` : a.name, { size: 14, valign: 'middle' }),
      text({ x: 210, y, w: 50, h: 10 }, a.phone ?? '', { size: 14, valign: 'middle', align: 'right' }),
      line(40, y + 11.5, 220)
    )
  })
  return { key: 'artisans', elements: el }
}

// Annotation libre posée par Mélanie sur une page (hauteur estimée d'après la longueur du texte).
function note(n: BookNote): Element {
  const perLine = Math.max(8, n.w * 0.47)
  const lines = n.text.split('\n').reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / perLine)), 0)
  return text({ x: n.x, y: n.y, w: n.w, h: Math.max(7, lines * 5.4 + 2) }, n.text, { size: 11, weight: 300 }, {
    edit: `note:${n.id}`,
    placeholder: 'Votre texte',
    id: `note:${n.id}`
  })
}

// Applique les ajustements de l'aperçu (position, taille, texte) aux éléments identifiés de la page.
// Les textes à une seule couleur sans équivalent dans la base deviennent modifiables pour ce book.
function applyAdjustments(page: Page, adjustments: Record<string, BookAdjustment>): Page {
  return {
    key: page.key,
    elements: page.elements.map((e): Element => {
      if (!e.id || e.id.startsWith('note:')) return e
      let out: Element = e
      if (out.type === 'text' && !out.edit && !out.link && out.runs.length === 1) out = { ...out, edit: textKey(page.key, e.id) }
      const a = adjustments[`${page.key}|${e.id}`]
      if (!a) return out
      const box = { x: a.x ?? e.x, y: a.y ?? e.y, w: a.w ?? e.w, h: a.h ?? e.h }
      const adjusted = [a.x, a.y, a.w, a.h, a.size].some((v) => v !== undefined)
      if (out.type === 'image') return { ...fitted(out.image, box, e.id), adjusted }
      out = { ...out, ...box, adjusted }
      if (out.type === 'text') {
        if (a.size) out = { ...out, style: { ...out.style, size: a.size } }
        if (a.text !== undefined && out.edit?.startsWith('text:')) out = { ...out, runs: [{ ...out.runs[0], text: a.text }] }
      }
      return out
    })
  }
}

// --- Assemblage du book ------------------------------------------------------------------------------

interface Section {
  title: string
  pages: Page[]
  divider: boolean
}

export function buildBook(d: BookData): Page[] {
  const adjust = (pageKey: string): Adjust => (id) => d.adjustments[`${pageKey}|${id}`]
  const plans = d.renders.filter((r) => r.section === 'plans')
  const changes = d.renders.filter((r) => r.section === 'changes')
  const sections: Section[] = [
    { title: 'Avant-propos', pages: [textPage('intro', d.intro, 'intro', d.designerName)], divider: false },
    { title: 'Vos envies', pages: [textPage('wishes', d.wishes, 'wishes', null)], divider: false }
  ]
  const renderPages = (list: typeof plans) => list.map((r) => renderPage(r, adjust(`render:${r.id}`)))
  if (plans.length) sections.push({ title: 'Plans d’aménagement intérieur', pages: renderPages(plans), divider: true })
  if (changes.length) sections.push({ title: 'Modifications', pages: renderPages(changes), divider: true })
  if (d.needs.length) {
    sections.push({
      title: 'Shopping list',
      pages: [...shoppingPages(d.needs), ...recapPages(d.needs, d.dateLabel)],
      divider: true
    })
  }
  if (d.paints.length) sections.push({ title: 'Teintes et couleurs', pages: paintPages(d.paints), divider: true })
  if (d.artisans.length) sections.push({ title: 'Artisans', pages: [artisansPage(d.artisans)], divider: false })
  sections.push({
    title: 'C’est à vous !',
    pages: [textPage('closing', d.closing, 'closing', d.designerName.split(' ')[0] || null)],
    divider: false
  })

  // Intercalaires numérotés comme le sommaire, puis numérotation : couverture = 1, sommaire = 2.
  sections.forEach((s, i) => {
    if (s.divider) s.pages.unshift(dividerPage(s.title, two(i + 1), `section:${i + 1}`))
  })
  let page = 3
  const toc: { range: string; title: string }[] = []
  for (const s of sections) {
    const first = page
    page += s.pages.length
    toc.push({ range: s.pages.length > 1 ? `${first}-${page - 1}.` : `${first}.`, title: s.title })
  }

  const tocPage: Page = {
    key: 'toc',
    elements: toc.flatMap((entry, i) => {
      const y = 30 + i * (150 / Math.max(toc.length, 7))
      return [
        text({ x: 40, y, w: 50, h: 12 }, entry.range, { size: 24, valign: 'middle' }),
        text({ x: 92, y, w: 180, h: 12 }, entry.title, { size: 24, valign: 'middle' })
      ]
    })
  }

  const pages: Page[] = [coverPage(d), tocPage, ...sections.flatMap((s) => s.pages), backCover(d)]
  return pages.map((p, i) => {
    const plain = i === 0 || i === pages.length - 1 || p.key.startsWith('section:') || p.key.startsWith('room:')
    const notes = d.notes.filter((n) => n.pageKey === p.key).map(note)
    const adjusted = applyAdjustments(p, d.adjustments)
    return { key: p.key, elements: [...adjusted.elements, ...(plain ? [] : footer(i + 1)), ...notes] }
  })
}

export { PAGE }
