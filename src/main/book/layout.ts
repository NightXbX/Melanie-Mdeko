import type { Box, Element, ImageRef, Page, Run, TextStyle, ThemeId } from '@shared/book'
import { COLORS, MARGIN, PAGE, RENDER, TEXT_BLOCK, THEME_FRAME, WATERMARK } from './charte'

export type { Element, ImageRef, Page }

// --- Données du book (assemblées depuis la base par data.ts) -------------------------------------

export interface BookArticle {
  name: string
  price: string
  priceCents: number | null
  summable: boolean // prix additionnable dans le total (pas au m², au rouleau ni sur devis)
  supplier: string | null
  url: string | null
  image: ImageRef | null
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
  theme: ThemeId
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
  needs: { id: number; title: string; choice: BookArticle | null; alternatives: BookArticle[] }[]
  paints: { brand: string; promoCode: string | null; items: { name: string; reference: string | null; hex: string | null }[] }[]
  artisans: { trade: string; name: string; city: string | null; phone: string | null }[]
  notes: BookNote[]
}

// --- Briques ---------------------------------------------------------------------------------------

const text = (box: Box, value: string | Run[], style: TextStyle, extra: Partial<Extract<Element, { type: 'text' }>> = {}): Element => ({
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
function fitted(image: ImageRef, box: Box): Extract<Element, { type: 'image' }> {
  const scale = Math.min(box.w / image.width, box.h / image.height)
  const w = image.width * scale
  const h = image.height * scale
  return { type: 'image', image, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)
const two = (n: number) => String(n).padStart(2, '0')

function logo(box: Box, size: number, align: TextStyle['align']): Element {
  return text(box, [{ text: 'm', color: COLORS.taupe }, { text: '·', color: COLORS.taupe }, { text: 'deko' }], {
    size,
    align,
    valign: 'middle',
    lineHeight: 1
  })
}

function articleLink(box: Box, url: string, size: number): Element {
  return text(box, 'Voir le produit ›', { size, weight: 400, color: COLORS.taupeDark }, { link: url })
}

function label(box: Box, value: string, size = 8.5): Element {
  return text(box, value.toUpperCase(), { size, weight: 500, color: COLORS.taupeDark, letterSpacing: 2 })
}

// --- Habillage propre à chaque style ---------------------------------------------------------------

// Repères de page : pied de page (Classique, Contemporain) ou en-tête discret (Épuré).
function chrome(theme: ThemeId, page: number, section: string): Element[] {
  switch (theme) {
    case 'classique':
      return [
        text({ x: 185, y: 193, w: 90, h: 8 }, [{ text: 'Design Book', color: COLORS.taupe }, { text: ` – Page ${page}` }], {
          size: 12,
          align: 'right',
          valign: 'middle'
        })
      ]
    case 'epure':
      return [
        text({ x: MARGIN, y: 7, w: 180, h: 6 }, section.toUpperCase(), {
          size: 8.5,
          weight: 500,
          color: COLORS.taupeDark,
          letterSpacing: 2,
          valign: 'middle'
        }),
        text({ x: 237, y: 7, w: 40, h: 6 }, two(page), { size: 9, weight: 400, color: COLORS.textSoft, align: 'right', valign: 'middle' })
      ]
    case 'contemporain':
      return [
        text({ x: 98.5, y: 198, w: 100, h: 6 }, [{ text: 'm', color: COLORS.taupe }, { text: '·deko' }, { text: `   ·   ${page}`, color: COLORS.textSoft }], {
          size: 9,
          weight: 300,
          align: 'center',
          valign: 'middle'
        })
      ]
  }
}

// Intercalaire de section : titre horizontal, lisible, numéroté comme dans le sommaire.
function dividerPage(theme: ThemeId, title: string, number: number, key: string): Page {
  const n = two(number)
  switch (theme) {
    case 'classique':
      return {
        key,
        elements: [
          text({ x: 40, y: 82, w: 200, h: 8 }, n, { size: 13, weight: 400, color: COLORS.taupeDark, letterSpacing: 2 }),
          text({ x: 40, y: 92, w: 240, h: 22 }, title, { size: 40, valign: 'middle', lineHeight: 1 }),
          line(40, 120, 40, COLORS.taupe, 0.3)
        ]
      }
    case 'epure':
      return {
        key,
        elements: [
          text({ x: MARGIN, y: 52, w: 140, h: 38 }, n, { size: 90, color: COLORS.taupeLight, valign: 'bottom', lineHeight: 1 }),
          text({ x: MARGIN, y: 96, w: 250, h: 16 }, title, { size: 30, valign: 'middle', lineHeight: 1 })
        ]
      }
    case 'contemporain':
      return {
        key,
        elements: [
          text({ x: 48.5, y: 80, w: 200, h: 7 }, `—  ${n}  —`, { size: 10, weight: 400, color: COLORS.taupeDark, align: 'center', letterSpacing: 3 }),
          text({ x: 13.5, y: 90, w: 270, h: 18 }, title.toUpperCase(), { size: 26, align: 'center', valign: 'middle', letterSpacing: 6, lineHeight: 1 }),
          line(138.5, 114, 20, COLORS.taupe, 0.3)
        ]
      }
  }
}

function coverPage(theme: ThemeId, d: BookData): Page {
  switch (theme) {
    case 'classique':
      return {
        key: 'cover',
        elements: [
          logo({ x: 60, y: 82, w: 160, h: 30 }, 77, 'center'),
          text({ x: 175, y: 163, w: 100, h: 8 }, 'Design Book', { size: 19, color: COLORS.taupe, align: 'right' }),
          text({ x: 175, y: 173, w: 100, h: 8 }, d.clientLabel, { size: 17, align: 'right' }),
          text({ x: 175, y: 182, w: 100, h: 6 }, d.dateLabel, { size: 13, align: 'right' })
        ]
      }
    case 'epure':
      return {
        key: 'cover',
        elements: [
          logo({ x: MARGIN, y: 16, w: 80, h: 12 }, 26, 'left'),
          line(MARGIN, 112, 30, COLORS.taupe, 0.3),
          text({ x: MARGIN, y: 118, w: 250, h: 20 }, d.clientLabel, { size: 40, valign: 'middle', lineHeight: 1 }),
          text({ x: MARGIN, y: 142, w: 250, h: 7 }, `Design Book · ${d.dateLabel}`.toUpperCase(), {
            size: 10,
            weight: 400,
            color: COLORS.taupeDark,
            letterSpacing: 3
          })
        ]
      }
    case 'contemporain':
      return {
        key: 'cover',
        elements: [
          text({ x: 48.5, y: 70, w: 200, h: 7 }, 'DESIGN BOOK', { size: 11, weight: 400, color: COLORS.taupeDark, align: 'center', letterSpacing: 6 }),
          text({ x: 13.5, y: 82, w: 270, h: 22 }, d.clientLabel, { size: 44, align: 'center', valign: 'middle', lineHeight: 1 }),
          text({ x: 48.5, y: 108, w: 200, h: 7 }, d.dateLabel, { size: 13, align: 'center' }),
          logo({ x: 98.5, y: 176, w: 100, h: 12 }, 24, 'center')
        ]
      }
  }
}

function backCover(theme: ThemeId, d: BookData): Page {
  const lines = [d.address, d.phone, d.email].filter(Boolean).join('\n')
  const qr = (x: number, y: number): Element[] =>
    d.reviewQr ? [text({ x, y, w: 60, h: 7 }, 'Laisser un avis :', { size: 12 }), fitted(d.reviewQr, { x, y: y + 9, w: 40, h: 40 })] : []
  switch (theme) {
    case 'classique': {
      const cx = 100
      const cy = 95
      const r = 67
      return {
        key: 'back',
        elements: [
          { type: 'ellipse', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, fill: COLORS.disc },
          logo({ x: cx - r, y: cy - 34, w: 2 * r, h: 24 }, 58, 'center'),
          text({ x: cx - r, y: cy - 4, w: 2 * r, h: 9 }, d.designerName, { size: 17, align: 'center' }),
          text({ x: cx - r + 10, y: cy + 8, w: 2 * r - 20, h: 30 }, lines, { size: 12, align: 'center', lineHeight: 1.5 }),
          ...qr(178, 70)
        ]
      }
    }
    case 'epure':
      return {
        key: 'back',
        elements: [
          logo({ x: MARGIN, y: 70, w: 120, h: 18 }, 40, 'left'),
          line(MARGIN, 94, 30, COLORS.taupe, 0.3),
          text({ x: MARGIN, y: 100, w: 150, h: 9 }, d.designerName, { size: 16 }),
          text({ x: MARGIN, y: 111, w: 150, h: 30 }, lines, { size: 11, weight: 300, lineHeight: 1.6 }),
          ...qr(210, 70)
        ]
      }
    case 'contemporain':
      return {
        key: 'back',
        elements: [
          { type: 'ellipse', x: 108.5, y: 42, w: 80, h: 80, line: COLORS.taupe },
          logo({ x: 108.5, y: 72, w: 80, h: 20 }, 40, 'center'),
          text({ x: 48.5, y: 132, w: 200, h: 9 }, d.designerName, { size: 16, align: 'center' }),
          text({ x: 48.5, y: 143, w: 200, h: 26 }, lines, { size: 11, weight: 300, align: 'center', lineHeight: 1.6 }),
          ...qr(228, 140)
        ]
      }
  }
}

// --- Pages de contenu ------------------------------------------------------------------------------

function textPage(theme: ThemeId, key: string, body: string, edit: string, signature: string | null): Page {
  const { x, width, height, size, lineHeight } = TEXT_BLOCK
  const y = 34 + THEME_FRAME[theme].top
  const elements = [text({ x, y, w: width, h: height }, body, { size, lineHeight, align: 'justify' }, { edit })]
  if (signature) elements.push(text({ x, y: y + height + 2, w: width, h: 10 }, signature, { size, align: 'right' }))
  return { key, elements }
}

function renderPage(theme: ThemeId, r: BookData['renders'][number]): Page {
  const frame = THEME_FRAME[theme]
  const img = fitted(r.image, { x: RENDER.x, y: frame.renderTop, w: RENDER.width, h: RENDER.height })
  // Petit cartouche m·deko en bas à droite du rendu, comme sur ses planches.
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
      placeholder: 'Ajouter une légende'
    })
  )
  y += 9
  if (r.inset) {
    const h = Math.min(28, frame.bottom - y)
    if (h > 8) elements.push(fitted(r.inset, { x: img.x, y, w: 60, h }))
  }
  return { key: `render:${r.id}`, elements }
}

const FIRST_ALTERNATIVES = 3
const ALTERNATIVES_PER_PAGE = 8

// Une page par besoin : « Mon choix » en grand, 3 propositions à côté, les suivantes sur des pages « suite ».
function needPages(theme: ThemeId, need: BookData['needs'][number]): Page[] {
  const top = THEME_FRAME[theme].top
  const title = (suffix = '') =>
    text({ x: MARGIN, y: 12 + top, w: 200, h: 7 }, need.title.toUpperCase() + suffix, {
      size: 11,
      weight: 400,
      color: COLORS.taupeDark,
      letterSpacing: 2
    }, suffix ? {} : { edit: `needLabel:${need.id}` })

  const el: Element[] = [title()]
  const c = need.choice
  if (c) {
    const photo = { x: MARGIN, y: 22 + top, w: 128, h: 118 }
    el.push({ type: 'rect', ...photo, line: COLORS.taupeLight })
    if (c.image) el.push(fitted(c.image, { x: photo.x + 6, y: photo.y + 6, w: photo.w - 12, h: photo.h - 12 }))
    el.push(
      label({ x: MARGIN, y: 145 + top, w: 128, h: 5 }, 'Mon choix'),
      text({ x: MARGIN, y: 151 + top, w: 128, h: 13 }, truncate(c.name, 90), { size: 14, weight: 300, lineHeight: 1.25 }),
      text({ x: MARGIN, y: 165 + top, w: 70, h: 9 }, c.price, { size: 18, weight: 400, valign: 'middle' }),
      text({ x: MARGIN, y: 175 + top, w: 128, h: 6 }, c.supplier ?? '', { size: 11, weight: 300, color: COLORS.textSoft })
    )
    if (c.url) el.push(articleLink({ x: MARGIN, y: 182 + top, w: 60, h: 6 }, c.url, 10))
  }

  const first = need.alternatives.slice(0, FIRST_ALTERNATIVES)
  if (first.length) {
    const left = 165
    // Filet vertical entre « Mon choix » et les propositions.
    el.push(label({ x: left, y: 22 + top, w: 112, h: 5 }, 'Autres propositions'), {
      type: 'rect',
      x: 156,
      y: 22 + top,
      w: 0.2,
      h: 160,
      fill: COLORS.taupeLight
    })
    first.forEach((a, i) => {
      const y = 30 + top + i * 54
      const photo = { x: left, y, w: 46, h: 46 }
      el.push({ type: 'rect', ...photo, line: COLORS.taupeLight })
      if (a.image) el.push(fitted(a.image, { x: photo.x + 3, y: photo.y + 3, w: photo.w - 6, h: photo.h - 6 }))
      const tx = left + 51
      el.push(
        text({ x: tx, y: y + 1, w: 61, h: 15 }, truncate(a.name, 70), { size: 10, weight: 300, lineHeight: 1.25 }),
        text({ x: tx, y: y + 17, w: 61, h: 7 }, a.price, { size: 13, weight: 400 }),
        text({ x: tx, y: y + 25, w: 61, h: 5 }, a.supplier ?? '', { size: 9, weight: 300, color: COLORS.textSoft })
      )
      if (a.url) el.push(articleLink({ x: tx, y: y + 31, w: 40, h: 5 }, a.url, 9))
    })
  }
  const pages: Page[] = [{ key: `need:${need.id}`, elements: el }]

  // Propositions supplémentaires : grille de 4 × 2 par page.
  const rest = need.alternatives.slice(FIRST_ALTERNATIVES)
  for (let start = 0, n = 2; start < rest.length; start += ALTERNATIVES_PER_PAGE, n++) {
    const els: Element[] = [title('  ·  AUTRES PROPOSITIONS (SUITE)')]
    rest.slice(start, start + ALTERNATIVES_PER_PAGE).forEach((a, i) => {
      const x = MARGIN + (i % 4) * 65
      const y = 24 + top + Math.floor(i / 4) * 82
      const photo = { x, y, w: 60, h: 46 }
      els.push({ type: 'rect', ...photo, line: COLORS.taupeLight })
      if (a.image) els.push(fitted(a.image, { x: x + 3, y: y + 3, w: 54, h: 40 }))
      els.push(
        text({ x, y: y + 49, w: 60, h: 11 }, truncate(a.name, 60), { size: 10, weight: 300, lineHeight: 1.25 }),
        text({ x, y: y + 61, w: 60, h: 6 }, a.price, { size: 12, weight: 400 }),
        text({ x, y: y + 68, w: 60, h: 5 }, a.supplier ?? '', { size: 9, weight: 300, color: COLORS.textSoft })
      )
      if (a.url) els.push(articleLink({ x, y: y + 74, w: 40, h: 5 }, a.url, 9))
    })
    pages.push({ key: `need:${need.id}:${n}`, elements: els })
  }
  return pages
}

const RECAP_ROWS = 15

function formatEuros(cents: number): string {
  const v = cents / 100
  return `${v.toLocaleString('fr-FR', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')} €`
}

function recapPages(theme: ThemeId, needs: BookData['needs'], dateLabel: string): Page[] {
  const top = THEME_FRAME[theme].top
  const rows = needs.filter((n) => n.choice)
  if (!rows.length) return []
  const pages: Page[] = []
  const total = rows.reduce((sum, n) => sum + (n.choice!.summable ? (n.choice!.priceCents ?? 0) : 0), 0)
  const partial = rows.some((n) => !n.choice!.summable)
  const cols = [
    { x: MARGIN, w: 58, label: 'Catégorie' },
    { x: 80, w: 112, label: 'Article' },
    { x: 194, w: 46, label: 'Fournisseur' },
    { x: 240, w: 37, label: 'Prix' }
  ]
  for (let start = 0; start < rows.length; start += RECAP_ROWS) {
    const head = 30 + top
    const el: Element[] = [text({ x: MARGIN, y: 12 + top, w: 200, h: 12 }, 'Récapitulatif de mes choix', { size: 22, valign: 'middle' })]
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
    const slice = rows.slice(start, start + RECAP_ROWS)
    slice.forEach((n, i) => {
      const y = head + 8 + i * 9.5
      const a = n.choice!
      el.push(
        line(MARGIN, y - 1, 257),
        text({ x: cols[0].x, y, w: cols[0].w, h: 8 }, truncate(n.title, 30), { size: 10, weight: 300, valign: 'middle', color: COLORS.textSoft }),
        text({ x: cols[1].x, y, w: cols[1].w, h: 8 }, truncate(a.name, 60), { size: 10, weight: 300, valign: 'middle' }, a.url ? { link: a.url } : {}),
        text({ x: cols[2].x, y, w: cols[2].w, h: 8 }, truncate(a.supplier ?? '', 24), { size: 10, weight: 300, valign: 'middle' }),
        text({ x: cols[3].x, y, w: cols[3].w, h: 8 }, a.price, { size: 10, weight: 400, valign: 'middle', align: 'right' })
      )
    })
    if (start + RECAP_ROWS >= rows.length) {
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
        })
      )
    }
    pages.push({ key: `recap:${pages.length + 1}`, elements: el })
  }
  return pages
}

function paintPages(theme: ThemeId, paints: BookData['paints']): Page[] {
  const pages: Page[] = []
  for (const group of paints) {
    for (let start = 0; start < group.items.length; start += 12) {
      const items = group.items.slice(start, start + 12)
      // Pastilles centrées verticalement dans la page, comme sur ses planches de couleurs.
      const rows = Math.ceil(items.length / 3)
      const top = 22 + THEME_FRAME[theme].top + (160 - rows * 40) / 2
      const el: Element[] = [
        text({ x: MARGIN, y: top - 14, w: 200, h: 7 }, group.brand.toUpperCase(), { size: 11, weight: 400, color: COLORS.taupeDark, letterSpacing: 3 })
      ]
      items.forEach((p, i) => {
        const x = MARGIN + 10 + (i % 3) * 85
        const y = top + Math.floor(i / 3) * 40
        el.push(
          { type: 'ellipse', x, y, w: 26, h: 26, fill: p.hex ?? COLORS.white, line: COLORS.taupeLight },
          text({ x: x + 32, y: y + 7, w: 50, h: 12 }, [p.name.toUpperCase(), p.reference].filter(Boolean).join('\n'), {
            size: 9,
            weight: 300,
            valign: 'middle',
            letterSpacing: 1
          })
        )
      })
      if (group.promoCode) {
        el.push(text({ x: 177, y: 180, w: 100, h: 7 }, `CODE PROMO : ${group.promoCode}`, { size: 9, weight: 300, align: 'right', letterSpacing: 1 }))
      }
      pages.push({ key: `paints:${pages.length + 1}`, elements: el })
    }
  }
  return pages
}

function artisansPage(theme: ThemeId, artisans: BookData['artisans']): Page {
  const list = artisans.slice(0, 12)
  const top = 30 + THEME_FRAME[theme].top + (150 - list.length * 13) / 2
  const el: Element[] = [text({ x: MARGIN, y: 14 + THEME_FRAME[theme].top, w: 200, h: 12 }, 'Artisans', { size: 22, valign: 'middle' })]
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
    placeholder: 'Votre texte'
  })
}

// --- Assemblage du book ------------------------------------------------------------------------------

interface Section {
  title: string
  pages: Page[]
  divider: boolean
}

export function buildBook(d: BookData): Page[] {
  const t = d.theme
  const plans = d.renders.filter((r) => r.section === 'plans')
  const changes = d.renders.filter((r) => r.section === 'changes')
  const sections: Section[] = [
    { title: 'Avant-propos', pages: [textPage(t, 'intro', d.intro, 'intro', d.designerName)], divider: false },
    { title: 'Vos envies', pages: [textPage(t, 'wishes', d.wishes, 'wishes', null)], divider: false }
  ]
  if (plans.length) sections.push({ title: 'Plans d’aménagement intérieur', pages: plans.map((r) => renderPage(t, r)), divider: true })
  if (changes.length) sections.push({ title: 'Modifications', pages: changes.map((r) => renderPage(t, r)), divider: true })
  if (d.needs.length) {
    sections.push({
      title: 'Shopping list',
      pages: [...d.needs.flatMap((n) => needPages(t, n)), ...recapPages(t, d.needs, d.dateLabel)],
      divider: true
    })
  }
  if (d.paints.length) sections.push({ title: 'Choix des couleurs', pages: paintPages(t, d.paints), divider: true })
  if (d.artisans.length) sections.push({ title: 'Artisans', pages: [artisansPage(t, d.artisans)], divider: false })
  sections.push({
    title: 'C’est à vous !',
    pages: [textPage(t, 'closing', d.closing, 'closing', d.designerName.split(' ')[0] || null)],
    divider: false
  })

  // Intercalaires numérotés comme le sommaire, puis numérotation : couverture = 1, sommaire = 2.
  sections.forEach((s, i) => {
    if (s.divider) s.pages.unshift(dividerPage(t, s.title, i + 1, `section:${i + 1}`))
  })
  let page = 3
  const toc: { range: string; title: string }[] = []
  const sectionOf: string[] = ['', 'Sommaire']
  for (const s of sections) {
    const first = page
    page += s.pages.length
    toc.push({ range: s.pages.length > 1 ? `${first}-${page - 1}.` : `${first}.`, title: s.title })
    s.pages.forEach(() => sectionOf.push(s.title))
  }

  const tocPage: Page = {
    key: 'toc',
    elements: toc.flatMap((entry, i) => {
      const y = 30 + THEME_FRAME[t].top + i * (150 / Math.max(toc.length, 7))
      return [
        text({ x: 40, y, w: 50, h: 12 }, entry.range, { size: 24, valign: 'middle' }),
        text({ x: 92, y, w: 180, h: 12 }, entry.title, { size: 24, valign: 'middle' })
      ]
    })
  }

  const pages: Page[] = [coverPage(t, d), tocPage, ...sections.flatMap((s) => s.pages), backCover(t, d)]
  return pages.map((p, i) => {
    const plain = i === 0 || i === pages.length - 1 || p.key.startsWith('section:')
    const notes = d.notes.filter((n) => n.pageKey === p.key).map(note)
    return { key: p.key, elements: [...p.elements, ...(plain ? [] : chrome(t, i + 1, sectionOf[i])), ...notes] }
  })
}

export { PAGE }
