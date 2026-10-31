// Lecture d'un design book ou d'une shopping list PDF de Mélanie (même logique que
// tools/migration/extraire_shopping_list.py, avec MuPDF en WebAssembly).
import type * as Mupdf from 'mupdf'
import { DEFAULT_PAINT_BRAND } from '@shared/projects'
import { isMdekoBook, readMdekoBook } from './read-mdeko'
import { category, cle, paintName } from './rules'

export type MupdfModule = typeof Mupdf

export interface EncodedImage {
  bytes: Uint8Array // JPEG sur fond blanc
  width: number
  height: number
  thumbnail: Uint8Array // JPEG 360 px
  dhash: string // empreinte visuelle (comparaison de photos)
}

export interface RowDraft {
  section: string
  name: string
  priceText: string
  url: string | null
  supplier: string
  images: EncodedImage[]
  highlighted: boolean // surligné au fluo : « Mon choix »
  description?: string // book exporté par Mdeko
}

export interface Cover {
  title: string // Mme, M., Mme et M. ou vide
  name: string
  bookDate: string | null // AAAA-MM
}

export type ImportEvent =
  | { kind: 'start'; pages: number; cover: Cover | null }
  | { kind: 'progress'; page: number }
  | { kind: 'rows'; rows: RowDraft[] }
  | { kind: 'render'; image: EncodedImage; inset: EncodedImage | null; section: 'plans' | 'changes'; caption?: string }
  | { kind: 'wishes'; text: string }
  // Books exportés par Mdeko : besoins déjà formés, planche tendance, textes du projet.
  | { kind: 'need'; room: string | null; label: string; quantity: number; choice: RowDraft; alternatives: RowDraft[] }
  | { kind: 'trend'; image: EncodedImage }
  | { kind: 'texts'; intro?: string; closing?: string }
  | { kind: 'paints'; paints: { brand: string; name: string; reference: string | null; hex: string | null; promoCode: string | null }[] }
  | { kind: 'artisans'; artisans: { trade: string; name: string; city: string | null; phone: string | null }[] }

export interface Line {
  text: string
  size: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface PageData {
  lines: Line[]
  images: { image: Mupdf.Image; x0: number; y0: number; x1: number; y1: number }[]
  links: { uri: string; x: number; y: number }[]
  fills: { x0: number; y0: number; x1: number; y1: number; hex: string }[] // formes pleines en couleur
  hCoverage: Map<number, number> // y arrondi -> longueur horizontale tracée
  verticals: number[] // x des traits verticaux et bords de rectangles hauts
  discs: { x0: number; y0: number; x1: number; y1: number; hex: string }[]
  highlights: { y0: number; y1: number }[] // surlignages fluo
}

const SECTION_TITLE_SIZE = 32 // intercalaires : 39 à 47 pt ; sommaire : 26 pt
const RENDER_MIN_WIDTH = 1000
const COLUMN = { width: 136, min: 110, max: 160 }
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
const FOOTER = /^(Design Book|[–-]?\s*Page\s+\d+|Design Book\s*[–-]\s*Page\s+\d+)\s*$/i

// Couleur de surligneur : vive et lumineuse (jaune, vert, rose fluo…), jamais le taupe ni le blanc.
function isFluo(cs: Mupdf.ColorSpace | null, color: number[]): boolean {
  const n = cs?.getNumberOfComponents()
  const rgb = n === 3 ? color : n === 4 ? color.slice(0, 3).map((c) => (1 - c) * (1 - color[3])) : null
  return !!rgb && Math.max(...rgb) > 0.85 && Math.max(...rgb) - Math.min(...rgb) > 0.5
}

// --- Lecture brute d'une page --------------------------------------------------------------------

export function readPage(mupdf: MupdfModule, page: Mupdf.PDFPage | Mupdf.Page): PageData {
  const data: PageData = { lines: [], images: [], links: [], fills: [], hCoverage: new Map(), verticals: [], discs: [], highlights: [] }
  const st = JSON.parse(page.toStructuredText('preserve-whitespace').asJSON()) as {
    blocks: { type: string; lines?: { text: string; font: { size: number }; bbox: { x: number; y: number; w: number; h: number } }[] }[]
  }
  for (const b of st.blocks) {
    for (const l of b.lines ?? []) {
      if (l.text.trim()) {
        data.lines.push({ text: l.text, size: l.font.size, x0: l.bbox.x, y0: l.bbox.y, x1: l.bbox.x + l.bbox.w, y1: l.bbox.y + l.bbox.h })
      }
    }
  }
  for (const link of page.getLinks()) {
    const uri = link.getURI()
    const [x0, y0, , y1] = link.getBounds()
    if (/^https?:/i.test(uri)) data.links.push({ uri, x: x0, y: (y0 + y1) / 2 })
  }

  const addH = (y: number, length: number) => data.hCoverage.set(Math.round(y), (data.hCoverage.get(Math.round(y)) ?? 0) + length)
  const walk = (path: Mupdf.Path, ctm: Mupdf.Matrix, fill: number[] | null, highlight = false) => {
    const pts: [number, number][] = []
    const at = (x: number, y: number): [number, number] => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]
    let last: [number, number] | null = null
    path.walk({
      moveTo: (x, y) => {
        last = at(x, y)
        pts.push(last)
      },
      lineTo: (x, y) => {
        const p = at(x, y)
        if (last) {
          if (Math.abs(p[1] - last[1]) < 1) addH(p[1], Math.abs(p[0] - last[0]))
          else if (Math.abs(p[0] - last[0]) < 1 && Math.abs(p[1] - last[1]) > 50) data.verticals.push(p[0])
        }
        last = p
        pts.push(p)
      },
      curveTo: (x1, y1, x2, y2, x3, y3) => {
        pts.push(at(x1, y1), at(x2, y2))
        last = at(x3, y3)
        pts.push(last)
      },
      closePath: () => {}
    })
    if (!pts.length) return
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
    // Pastille de couleur : forme pleine à peu près carrée (disque).
    const w = box.x1 - box.x0
    const h = box.y1 - box.y0
    if (highlight) data.highlights.push({ y0: box.y0, y1: box.y1 })
    if (fill) data.fills.push({ ...box, hex: '#' + fill.slice(0, 3).map((c) => Math.round(c * 255).toString(16).padStart(2, '0').toUpperCase()).join('') })
    if (fill && w > 25 && w < 120 && Math.abs(w - h) <= 4) {
      data.discs.push({ ...box, hex: '#' + fill.slice(0, 3).map((c) => Math.round(c * 255).toString(16).padStart(2, '0').toUpperCase()).join('') })
    }
  }
  const device = new mupdf.Device({
    fillPath: (path, _eo, ctm, cs, color) => walk(path, ctm, cs?.getNumberOfComponents() === 3 ? color : null, isFluo(cs, color)),
    strokePath: (path, _s, ctm) => walk(path, ctm, null),
    fillImage: (image, ctm) => {
      const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]]
      const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]]
      data.images.push({ image, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) })
    }
  })
  page.run(device, mupdf.Matrix.identity)
  device.close()
  return data
}

// --- Images ---------------------------------------------------------------------------------------

function draw(mupdf: MupdfModule, image: Mupdf.Image, w: number, h: number, colorspace: Mupdf.ColorSpace): Mupdf.Pixmap {
  const pix = new mupdf.Pixmap(colorspace, [0, 0, w, h], false)
  pix.clear(255)
  const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix)
  dev.fillImage(image, [w, 0, 0, h, 0, 0], 1)
  dev.close()
  return pix
}

// Photo sur fond blanc (transparences et CMJN réglés), miniature et empreinte visuelle.
export function encodeImage(mupdf: MupdfModule, image: Mupdf.Image): EncodedImage {
  const width = image.getWidth()
  const height = image.getHeight()
  const scale = Math.min(1, 360 / Math.max(width, height))
  const gray = draw(mupdf, image, 9, 8, mupdf.ColorSpace.DeviceGray).getPixels()
  let bits = 0n
  for (let i = 0; i < 64; i++) {
    const p = Math.floor(i / 8) * 9 + (i % 8)
    if (gray[p] > gray[p + 1]) bits |= 1n << BigInt(i)
  }
  return {
    bytes: draw(mupdf, image, width, height, mupdf.ColorSpace.DeviceRGB).asJPEG(90),
    width,
    height,
    thumbnail: draw(mupdf, image, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), mupdf.ColorSpace.DeviceRGB).asJPEG(80),
    dhash: bits.toString(16).padStart(16, '0')
  }
}

// --- Tableaux d'articles -------------------------------------------------------------------------

function columns(d: PageData): number[] | null {
  const xs = [...new Set(d.verticals.map((x) => Math.round(x * 10) / 10))].sort((a, b) => a - b)
  for (const start of xs) {
    const edges = [start]
    while (edges.length < 6) {
      const prev = edges[edges.length - 1]
      const next = xs.filter((x) => x - prev >= COLUMN.min && x - prev <= COLUMN.max)
      if (!next.length) break
      edges.push(next.reduce((best, x) => (Math.abs(x - prev - COLUMN.width) < Math.abs(best - prev - COLUMN.width) ? x : best)))
    }
    if (edges.length === 6) return edges.slice(0, 5)
  }
  return null
}

function bands(d: PageData): [number, number][] {
  const ys = [...d.hCoverage.entries()]
    .filter(([y, c]) => c > 600 && y > 15 && y < 580)
    .map(([y]) => y)
    .sort((a, b) => a - b)
  const merged: number[] = []
  for (const y of ys) if (!merged.length || y - merged[merged.length - 1] > 4) merged.push(y)
  return merged.slice(1).map((y, i) => [merged[i], y])
}

const column = (x: number, cols: number[]) => Math.max(0, cols.filter((c) => c <= x).length - 1)

function readTable(mupdf: MupdfModule, d: PageData, section: string, cols: number[], rows: [number, number][]): RowDraft[] {
  const out: RowDraft[] = []
  for (const [top, bottom] of rows) {
    const inside = (y0: number, y1: number) => (y0 + y1) / 2 >= top && (y0 + y1) / 2 < bottom
    const cells: Line[][] = [[], [], [], [], []]
    for (const l of d.lines) if (inside(l.y0, l.y1) && !FOOTER.test(l.text.trim())) cells[column((l.x0 + l.x1) / 2, cols)].push(l)
    // Texte d'une cellule dans l'ordre de lecture ; les liens coupés en plusieurs lignes sont recollés.
    const text = (c: Line[], glued = false) => {
      const parts = c.sort((a, b) => Math.round(a.y0) - Math.round(b.y0) || a.x0 - b.x0).map((l) => l.text.trim())
      return glued ? parts.join('') : parts.join(' ').replace(/\s+/g, ' ').trim()
    }
    const photos = d.images
      .filter((i) => inside(i.y0, i.y1) && column((i.x0 + i.x1) / 2, cols) === 0)
      .sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))
    const uris = new Map<string, number>()
    for (const l of d.links) if (l.y >= top && l.y < bottom) uris.set(l.uri, (uris.get(l.uri) ?? 0) + 1)
    let url: string | null = [...uris.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    if (!url) {
      const raw = text(cells[3], true)
      url = raw.startsWith('http') ? raw : null
    }
    const name = text(cells[1])
    const priceText = text(cells[2])
    if (!name && !priceText && !photos.length) continue
    const highlighted = d.highlights.some((h) => inside(h.y0, h.y1))
    out.push({ section, name, priceText, url, supplier: text(cells[4]), images: photos.map((p) => encodeImage(mupdf, p.image)), highlighted })
  }
  return out
}

// --- Autres pages du book ------------------------------------------------------------------------

export function readCover(d: PageData): Cover | null {
  const texts = d.lines.map((l) => l.text.split(/\s+/).filter(Boolean).join(' '))
  if (!texts.some((t) => t.toLowerCase() === 'design book')) return null
  let bookDate: string | null = null
  for (const t of texts) {
    const m = /^(\p{L}+)\s+(\d{4})$/u.exec(t)
    const month = m ? MONTHS.indexOf(cle(m[1])) : -1
    if (m && month >= 0) bookDate = `${m[2]}-${String(month + 1).padStart(2, '0')}`
  }
  const client = texts.find((t) => t.toLowerCase() !== 'design book' && t.includes(' ') && !/\d{4}$/.test(t)) ?? ''
  const couple = /^(?:Mme\s*(?:&|et)\s*(?:M\.?|Mr)|(?:M\.?|Mr)\s*(?:&|et)\s*Mme)\s+/i.exec(client)
  const single = ['Mme', 'M.', 'Mr', 'Mlle'].find((c) => client.startsWith(`${c} `))
  const title = couple ? 'Mme et M.' : (single ?? '')
  const raw = couple ? client.slice(couple[0].length).trim() : single ? client.slice(single.length).trim() : client
  const name = raw === raw.toUpperCase() ? raw.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, s: string, c: string) => s + c.toUpperCase()) : raw
  return { title: title === 'Mr' ? 'M.' : title, name, bookDate }
}

// Lignes de texte de la page, de haut en bas (morceaux de même hauteur réunis).
function textLines(d: PageData): { y: number; text: string }[] {
  const sorted = d.lines
    .filter((l) => !FOOTER.test(l.text.trim()))
    .map((l) => ({ y: (l.y0 + l.y1) / 2, x: l.x0, text: l.text.trim() }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const out: { y: number; parts: { x: number; text: string }[] }[] = []
  for (const l of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.y - l.y) < 4) last.parts.push(l)
    else out.push({ y: l.y, parts: [l] })
  }
  return out.map((l) => ({ y: l.y, text: l.parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(' ').replace(/\s+/g, ' ') }))
}

// Paragraphes : un écart vertical nettement plus grand que d'habitude sépare deux paragraphes.
export function paragraphs(d: PageData): string {
  const lines = textLines(d)
  if (!lines.length) return ''
  const gaps = lines.slice(1).map((l, i) => l.y - lines[i].y).sort((a, b) => a - b)
  const normal = gaps[Math.floor(gaps.length / 4)] ?? 0
  const paras: string[][] = [[lines[0].text]]
  lines.slice(1).forEach((l, i) => {
    if (l.y - lines[i].y > normal * 1.5) paras.push([l.text])
    else paras[paras.length - 1].push(l.text)
  })
  return paras.map((p) => p.join(' ')).join('\n\n')
}

function readArtisans(d: PageData) {
  return textLines(d)
    .map((l) => l.text.split(':').map((m) => m.trim()).filter(Boolean))
    .filter((parts) => parts.length >= 2)
    .map(([trade, ...rest]) => {
      const phone = rest.find((m) => /^[\d .]{10,}$/.test(m)) ?? null
      const who = rest.filter((m) => m !== phone).join(' ')
      return { trade, name: who.replace(/\s*\([^)]*\)/g, '').trim(), city: /\(([^)]+)\)/.exec(who)?.[1].trim() ?? null, phone }
    })
}

function readPaints(mupdf: MupdfModule, d: PageData) {
  const all = d.lines.map((l) => l.text).join(' ')
  const promo = /code\s*promo\s*:\s*(\S+)/i.exec(all)?.[1] ?? null
  const key = cle(all)
  const brand = key.includes('farrow') || key.includes('forrow') ? 'Farrow & Ball' : promo || key.includes('bilboquet') ? 'Bilboquet Deco' : DEFAULT_PAINT_BRAND
  // Pastilles : disques dessinés, ou petites images carrées (couleur moyenne).
  const swatches: { x0: number; y0: number; x1: number; y1: number; hex: string }[] = [...d.discs]
  for (const i of d.images) {
    const w = i.x1 - i.x0
    const h = i.y1 - i.y0
    if (w > 30 && w < 160 && w / Math.max(h, 1) > 0.7 && w / Math.max(h, 1) < 1.4) {
      const px = draw(mupdf, i.image, 1, 1, mupdf.ColorSpace.DeviceRGB).getPixels()
      swatches.push({ ...i, hex: '#' + [px[0], px[1], px[2]].map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('') })
    }
  }
  const out = []
  for (const s of swatches) {
    const cy = (s.y0 + s.y1) / 2
    const near = d.lines
      .filter((l) => l.x0 >= s.x1 - 2 && l.x0 - s.x1 < 160 && l.size < 20 && Math.abs((l.y0 + l.y1) / 2 - cy) < (s.y1 - s.y0) / 2 + 12)
      .sort((a, b) => a.x0 - b.x0)
    if (!near.length) continue
    const left = near[0].x0
    const label = near
      .filter((l) => l.x0 - left < 30)
      .sort((a, b) => a.y0 - b.y0)
      .map((l) => l.text.trim())
      .join(' ')
    if (!label || /code\s*promo|https?:|\/\s*rouleau/i.test(label)) continue
    const [name, reference] = paintName(label)
    const ral = name.toUpperCase().startsWith('RAL')
    out.push({ brand: ral ? 'RAL' : brand, name, reference, hex: s.hex, promoCode: ral ? null : promo })
  }
  return out
}

// --- Parcours du document -------------------------------------------------------------------------

// Lit le PDF page par page ; rend la main entre deux pages pour garder l'appli réactive.
export async function* readBook(mupdf: MupdfModule, pdf: Uint8Array): AsyncGenerator<ImportEvent> {
  const doc = mupdf.Document.openDocument(pdf, 'application/pdf')
  if (isMdekoBook(doc)) {
    yield* readMdekoBook(mupdf, doc)
    return
  }
  const count = doc.countPages()
  const cover = count ? readCover(readPage(mupdf, doc.loadPage(0))) : null
  yield { kind: 'start', pages: count, cover }

  let section = ''
  for (let n = 0; n < count; n++) {
    await new Promise((r) => setImmediate(r))
    yield { kind: 'progress', page: n + 1 }
    // Couverture et 4e de couverture : leur grand logo n'est pas un titre de section.
    if (cover && (n === 0 || n === count - 1)) continue
    const d = readPage(mupdf, doc.loadPage(n))
    const titles = d.lines.filter((l) => l.size >= SECTION_TITLE_SIZE).map((l) => l.text.trim())
    if (titles.length) {
      section = titles.join(' ').replace(/\s+/g, ' ')
      continue
    }
    const cols = columns(d)
    const rows = cols ? readTable(mupdf, d, section, cols, bands(d)) : []
    // Un plan coté peut ressembler à une grille : un vrai tableau d'articles a des liens ou des photos.
    if (rows.length && rows.filter((r) => r.url || r.images.length).length * 2 >= rows.length) {
      yield { kind: 'rows', rows }
      continue
    }
    if (!cover) continue
    if (n === 3) {
      yield { kind: 'wishes', text: paragraphs(d) }
      continue
    }
    if (textLines(d).some((l) => l.text.includes(':') && /\d{2} \d{2} \d{2}/.test(l.text))) {
      yield { kind: 'artisans', artisans: readArtisans(d) }
      continue
    }
    if (cle(section) === 'couleurs') {
      const paints = readPaints(mupdf, d)
      if (paints.length) yield { kind: 'paints', paints }
      continue
    }
    // Page de rendu : la plus grande image ; une autre image (hors cartouche m·deko, très allongé) devient la vignette.
    const images = [...d.images].sort((a, b) => b.image.getWidth() * b.image.getHeight() - a.image.getWidth() * a.image.getHeight())
    if (images[0] && images[0].image.getWidth() >= RENDER_MIN_WIDTH && ['', 'modifications'].includes(cle(section))) {
      const inset = images.slice(1).find((i) => i.image.getWidth() < 4 * i.image.getHeight())
      yield {
        kind: 'render',
        image: encodeImage(mupdf, images[0].image),
        inset: inset ? encodeImage(mupdf, inset.image) : null,
        section: cle(section) === 'modifications' ? 'changes' : 'plans'
      }
    }
  }
}

// Besoin d'un article dans le projet : sa sous-catégorie (« Suspensions », « Tapis »…).
export const needLabel = (row: RowDraft) => category(row.section, row.name)[1]
