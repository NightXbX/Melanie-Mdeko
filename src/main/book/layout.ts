import { COLORS, FOOTER, MARGIN, PAGE, RENDER, SECTION_TITLE, TEXT_BLOCK, WATERMARK, type Weight } from './charte'

// --- Modèle de page : des éléments positionnés en mm, rendus à l'identique en HTML/PDF et en PPTX ----

export interface ImageRef {
  url: string // mdeko:// pour l'aperçu et le PDF
  path: string // fichier, pour le PPTX
  width: number
  height: number
}

export interface TextStyle {
  size: number
  weight?: Weight
  color?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  valign?: 'top' | 'middle' | 'bottom'
  lineHeight?: number
  letterSpacing?: number // pt
}

export interface Run {
  text: string
  color?: string
  weight?: Weight
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type Element =
  | (Box & { type: 'text'; runs: Run[]; style: TextStyle; link?: string; rotate?: number })
  | (Box & { type: 'image'; image: ImageRef })
  | (Box & { type: 'rect'; fill?: string; line?: string })
  | (Box & { type: 'ellipse'; fill?: string; line?: string })

export interface Page {
  elements: Element[]
}

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
  renders: { image: ImageRef; inset: ImageRef | null; section: 'plans' | 'changes' }[]
  needs: { title: string; choice: BookArticle | null; alternatives: BookArticle[] }[]
  paints: { brand: string; promoCode: string | null; items: { name: string; reference: string | null; hex: string | null }[] }[]
  artisans: { trade: string; name: string; city: string | null; phone: string | null }[]
}

// --- Briques ---------------------------------------------------------------------------------------

const text = (box: Box, value: string | Run[], style: TextStyle, extra: Partial<Element> = {}): Element =>
  ({
    type: 'text',
    ...box,
    runs: typeof value === 'string' ? [{ text: value }] : value,
    style: { weight: 200, color: COLORS.text, align: 'left', valign: 'top', lineHeight: 1.3, ...style },
    ...extra
  }) as Element

// Image entière dans son cadre, centrée (équivalent de « contain »).
function fitted(image: ImageRef, box: Box): Element {
  const scale = Math.min(box.w / image.width, box.h / image.height)
  const w = image.width * scale
  const h = image.height * scale
  return { type: 'image', image, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

function footer(page: number): Element {
  return text(
    { x: FOOTER.right - 90, y: FOOTER.y, w: 90, h: FOOTER.height },
    [{ text: 'Design Book', color: COLORS.taupe }, { text: ` – Page ${page}` }],
    { size: FOOTER.size, align: 'right', valign: 'middle' }
  )
}

function logo(box: Box, size: number, align: TextStyle['align']): Element {
  return text(box, [{ text: 'm', color: COLORS.taupe }, { text: '·', color: COLORS.taupe }, { text: 'deko' }], {
    size,
    align,
    valign: 'middle',
    lineHeight: 1
  })
}

// Titre de section vertical, en bas à droite (« SHOPPING LIST », « COULEURS »…).
function sectionPage(title: string): Page {
  const { length, thickness, right, bottom, size } = SECTION_TITLE
  const cx = right - thickness / 2
  const cy = bottom - length / 2
  return {
    elements: [
      text({ x: cx - length / 2, y: cy - thickness / 2, w: length, h: thickness }, title.toUpperCase(), {
        size,
        color: COLORS.taupeLight,
        valign: 'middle',
        lineHeight: 1,
        letterSpacing: 2
      }, { rotate: 270 } as Partial<Element>)
    ]
  }
}

function textPage(body: string, signature: string | null): Page {
  const { x, y, width, height, size, lineHeight } = TEXT_BLOCK
  const elements = [text({ x, y, w: width, h: height }, body, { size, lineHeight, align: 'justify' })]
  if (signature) {
    elements.push(text({ x, y: y + height + 2, w: width, h: 10 }, signature, { size, align: 'right' }))
  }
  return { elements }
}

function renderPage(r: BookData['renders'][number]): Page {
  const elements = [fitted(r.image, { x: RENDER.x, y: RENDER.y, w: RENDER.width, h: RENDER.height })]
  const img = elements[0]
  // Petit cartouche m·deko en bas à droite du rendu, comme sur ses planches.
  const wx = img.x + img.w - WATERMARK.width
  const wy = img.y + img.h - WATERMARK.height
  elements.push(
    { type: 'rect', x: wx, y: wy, w: WATERMARK.width, h: WATERMARK.height, fill: COLORS.watermark },
    text({ x: wx, y: wy, w: WATERMARK.width, h: WATERMARK.height }, [{ text: 'm', color: COLORS.taupe }, { text: '·deko', color: COLORS.white }], {
      size: WATERMARK.size,
      align: 'center',
      valign: 'middle',
      lineHeight: 1
    })
  )
  if (r.inset) {
    elements.push(fitted(r.inset, { x: RENDER.x + 60, y: RENDER.insetY, w: 60, h: RENDER.insetHeight }))
  }
  return { elements }
}

// --- Shopping list : une page par besoin, « Mon choix » en grand et les alternatives à côté ----------

function articleLink(box: Box, url: string, size: number): Element {
  return text(box, 'Voir le produit  →', { size, weight: 300, color: COLORS.taupe }, { link: url })
}

function needPage(need: BookData['needs'][number]): Page {
  const el: Element[] = [
    text({ x: MARGIN, y: 12, w: 200, h: 7 }, need.title.toUpperCase(), { size: 10, weight: 300, color: COLORS.taupe, letterSpacing: 2 })
  ]
  const c = need.choice
  if (c) {
    const photo = { x: MARGIN, y: 22, w: 128, h: 118 }
    el.push({ type: 'rect', ...photo, line: COLORS.taupeLight })
    if (c.image) el.push(fitted(c.image, { x: photo.x + 6, y: photo.y + 6, w: photo.w - 12, h: photo.h - 12 }))
    el.push(
      text({ x: MARGIN, y: 145, w: 128, h: 5 }, 'MON CHOIX', { size: 8, weight: 400, color: COLORS.taupe, letterSpacing: 2 }),
      text({ x: MARGIN, y: 151, w: 128, h: 13 }, truncate(c.name, 90), { size: 14, weight: 300, lineHeight: 1.25 }),
      text({ x: MARGIN, y: 165, w: 70, h: 9 }, c.price, { size: 18, weight: 400, valign: 'middle' }),
      text({ x: MARGIN, y: 175, w: 128, h: 6 }, c.supplier ?? '', { size: 11, weight: 300, color: COLORS.textSoft })
    )
    if (c.url) el.push(articleLink({ x: MARGIN, y: 182, w: 60, h: 6 }, c.url, 10))
  }

  if (need.alternatives.length) {
    const left = 165
    el.push(
      text({ x: left, y: 22, w: 112, h: 5 }, 'AUTRES PROPOSITIONS', { size: 8, weight: 400, color: COLORS.taupe, letterSpacing: 2 })
    )
    need.alternatives.slice(0, 3).forEach((a, i) => {
      const top = 30 + i * 54
      const photo = { x: left, y: top, w: 46, h: 46 }
      el.push({ type: 'rect', ...photo, line: COLORS.taupeLight })
      if (a.image) el.push(fitted(a.image, { x: photo.x + 3, y: photo.y + 3, w: photo.w - 6, h: photo.h - 6 }))
      const tx = left + 51
      el.push(
        text({ x: tx, y: top + 1, w: 61, h: 15 }, truncate(a.name, 70), { size: 10, weight: 300, lineHeight: 1.25 }),
        text({ x: tx, y: top + 17, w: 61, h: 7 }, a.price, { size: 13, weight: 400 }),
        text({ x: tx, y: top + 25, w: 61, h: 5 }, a.supplier ?? '', { size: 9, weight: 300, color: COLORS.textSoft })
      )
      if (a.url) el.push(articleLink({ x: tx, y: top + 31, w: 40, h: 5 }, a.url, 9))
    })
    // Filet vertical entre « Mon choix » et les alternatives.
    el.push({ type: 'rect', x: 156, y: 22, w: 0.2, h: 160, fill: COLORS.taupeLight })
  }
  return { elements: el }
}

const RECAP_ROWS = 15

function recapPages(needs: BookData['needs'], dateLabel: string): Page[] {
  const rows = needs.filter((n) => n.choice)
  if (!rows.length) return []
  const pages: Page[] = []
  const total = rows.reduce((sum, n) => sum + (n.choice!.summable ? (n.choice!.priceCents ?? 0) : 0), 0)
  const partial = rows.some((n) => !n.choice!.summable)
  for (let start = 0; start < rows.length; start += RECAP_ROWS) {
    const el: Element[] = [
      text({ x: MARGIN, y: 12, w: 200, h: 12 }, 'Récapitulatif de mes choix', { size: 22, valign: 'middle' })
    ]
    const head = 30
    const cols = [
      { x: MARGIN, w: 58, label: 'CATÉGORIE' },
      { x: 80, w: 112, label: 'ARTICLE' },
      { x: 194, w: 46, label: 'FOURNISSEUR' },
      { x: 240, w: 37, label: 'PRIX' }
    ]
    cols.forEach((c, i) =>
      el.push(
        text({ x: c.x, y: head, w: c.w, h: 6 }, c.label, {
          size: 8,
          weight: 400,
          color: COLORS.taupe,
          letterSpacing: 2,
          align: i === 3 ? 'right' : 'left'
        })
      )
    )
    rows.slice(start, start + RECAP_ROWS).forEach((n, i) => {
      const y = head + 8 + i * 9.5
      const a = n.choice!
      el.push(
        { type: 'rect', x: MARGIN, y: y - 1, w: 257, h: 0.2, fill: COLORS.taupeLight },
        text({ x: cols[0].x, y, w: cols[0].w, h: 8 }, truncate(n.title, 30), { size: 10, weight: 300, valign: 'middle', color: COLORS.textSoft }),
        text({ x: cols[1].x, y, w: cols[1].w, h: 8 }, truncate(a.name, 60), { size: 10, weight: 300, valign: 'middle' }, a.url ? { link: a.url } : {}),
        text({ x: cols[2].x, y, w: cols[2].w, h: 8 }, truncate(a.supplier ?? '', 24), { size: 10, weight: 300, valign: 'middle' }),
        text({ x: cols[3].x, y, w: cols[3].w, h: 8 }, a.price, { size: 10, weight: 400, valign: 'middle', align: 'right' })
      )
    })
    if (start + RECAP_ROWS >= rows.length) {
      const y = head + 8 + Math.min(rows.length - start, RECAP_ROWS) * 9.5 + 2
      el.push(
        { type: 'rect', x: MARGIN, y: y - 1, w: 257, h: 0.3, fill: COLORS.taupe },
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
    pages.push({ elements: el })
  }
  return pages
}

function formatEuros(cents: number): string {
  const v = cents / 100
  return `${v.toLocaleString('fr-FR', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')} €`
}

// --- Couleurs, artisans, couvertures ----------------------------------------------------------------

function paintPages(paints: BookData['paints']): Page[] {
  const pages: Page[] = []
  for (const group of paints) {
    for (let start = 0; start < group.items.length; start += 12) {
      const el: Element[] = [
        text({ x: MARGIN, y: 14, w: 200, h: 7 }, group.brand.toUpperCase(), { size: 11, weight: 300, color: COLORS.taupe, letterSpacing: 3 })
      ]
      group.items.slice(start, start + 12).forEach((p, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = MARGIN + 10 + col * 85
        const y = 32 + row * 40
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
        el.push(text({ x: 177, y: 178, w: 100, h: 7 }, `CODE PROMO : ${group.promoCode}`, { size: 9, weight: 300, align: 'right', letterSpacing: 1 }))
      }
      pages.push({ elements: el })
    }
  }
  return pages
}

function artisansPage(artisans: BookData['artisans']): Page {
  const el: Element[] = [text({ x: MARGIN, y: 14, w: 200, h: 12 }, 'Artisans', { size: 22, valign: 'middle' })]
  artisans.slice(0, 12).forEach((a, i) => {
    const y = 36 + i * 13
    el.push(
      text({ x: 40, y, w: 60, h: 10 }, a.trade.toUpperCase(), { size: 9, weight: 400, color: COLORS.taupe, letterSpacing: 2, valign: 'middle' }),
      text({ x: 100, y, w: 110, h: 10 }, a.city ? `${a.name} (${a.city})` : a.name, { size: 14, valign: 'middle' }),
      text({ x: 210, y, w: 50, h: 10 }, a.phone ?? '', { size: 14, valign: 'middle', align: 'right' }),
      { type: 'rect', x: 40, y: y + 11.5, w: 220, h: 0.2, fill: COLORS.taupeLight }
    )
  })
  return { elements: el }
}

function coverPage(d: BookData): Page {
  return {
    elements: [
      logo({ x: 60, y: 82, w: 160, h: 30 }, 77, 'center'),
      text({ x: 175, y: 163, w: 100, h: 8 }, 'Design Book', { size: 19, color: COLORS.taupe, align: 'right' }),
      text({ x: 175, y: 173, w: 100, h: 8 }, d.clientLabel, { size: 17, align: 'right' }),
      text({ x: 175, y: 182, w: 100, h: 6 }, d.dateLabel, { size: 13, align: 'right' })
    ]
  }
}

function backCover(d: BookData): Page {
  const cx = 100
  const cy = 95
  const r = 67
  const lines = [d.address, d.phone, d.email].filter(Boolean)
  const el: Element[] = [
    { type: 'ellipse', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, fill: COLORS.disc },
    logo({ x: cx - r, y: cy - 34, w: 2 * r, h: 24 }, 58, 'center'),
    text({ x: cx - r, y: cy - 4, w: 2 * r, h: 9 }, d.designerName, { size: 17, align: 'center' }),
    text({ x: cx - r + 10, y: cy + 8, w: 2 * r - 20, h: 30 }, lines.join('\n'), { size: 12, align: 'center', lineHeight: 1.5 })
  ]
  if (d.reviewQr) {
    el.push(
      text({ x: 175, y: 70, w: 60, h: 7 }, 'Laisser un avis :', { size: 13 }),
      fitted(d.reviewQr, { x: 175, y: 79, w: 42, h: 42 })
    )
  }
  return { elements: el }
}

// --- Assemblage du book ------------------------------------------------------------------------------

interface Section {
  title: string
  pages: Page[]
  withFooter: boolean
}

export function buildBook(d: BookData): Page[] {
  const plans = d.renders.filter((r) => r.section === 'plans')
  const changes = d.renders.filter((r) => r.section === 'changes')
  const sections: Section[] = [
    { title: 'Avant-Propos', pages: [textPage(d.intro, d.designerName)], withFooter: true },
    { title: 'Vos envies', pages: [textPage(d.wishes, null)], withFooter: true }
  ]
  if (plans.length) sections.push({ title: 'Plans d’aménagement intérieur', pages: plans.map(renderPage), withFooter: true })
  if (changes.length) {
    sections.push({ title: 'Modifications', pages: [sectionPage('Modifications'), ...changes.map(renderPage)], withFooter: true })
  }
  if (d.needs.length) {
    sections.push({
      title: 'Shopping list',
      pages: [sectionPage('Shopping list'), ...d.needs.map(needPage), ...recapPages(d.needs, d.dateLabel)],
      withFooter: true
    })
  }
  if (d.paints.length) sections.push({ title: 'Choix des couleurs', pages: [sectionPage('Couleurs'), ...paintPages(d.paints)], withFooter: true })
  if (d.artisans.length) sections.push({ title: 'Artisans', pages: [artisansPage(d.artisans)], withFooter: true })
  sections.push({ title: 'C’est à vous !', pages: [textPage(d.closing, d.designerName.split(' ')[0] || null)], withFooter: true })

  // Numérotation : couverture = 1, sommaire = 2, puis les sections dans l'ordre.
  let page = 3
  const toc: { range: string; title: string }[] = []
  for (const s of sections) {
    const first = page
    page += s.pages.length
    toc.push({ range: s.pages.length > 1 ? `${first}-${page - 1}.` : `${first}.`, title: s.title })
  }

  const tocPage: Page = {
    elements: toc.flatMap((t, i) => {
      const y = 30 + i * (150 / Math.max(toc.length, 7))
      return [
        text({ x: 40, y, w: 50, h: 12 }, t.range, { size: 24, valign: 'middle' }),
        text({ x: 92, y, w: 180, h: 12 }, t.title, { size: 24, valign: 'middle' })
      ]
    })
  }

  const pages: Page[] = [coverPage(d), tocPage]
  for (const s of sections) pages.push(...s.pages)
  pages.push(backCover(d))

  // Pied de page partout sauf couverture, intercalaires et 4e de couverture.
  return pages.map((p, i) => {
    const isDivider = p.elements.length === 1 && p.elements[0].type === 'text' && (p.elements[0] as { rotate?: number }).rotate === 270
    return i === 0 || i === pages.length - 1 || isDivider ? p : { elements: [...p.elements, footer(i + 1)] }
  })
}

export { PAGE }
