// Lecture d'un design book exporté par Mdeko lui-même (PDF imprimé par Chromium), par exemple pour
// reprendre sur le Mac un projet commencé sur un autre ordinateur. La mise en page est celle de
// src/main/book/layout.ts : on retrouve chaque élément à sa place (mesures en mm).
import type * as Mupdf from 'mupdf'
import { DEFAULT_PAINT_BRAND } from '@shared/projects'
import { encodeImage, paragraphs, readCover, readPage, type ImportEvent, type Line, type MupdfModule, type PageData, type RowDraft } from './read-pdf'
import { cle } from './rules'

const MM = 25.4 / 72
const FOOTER = /^(m·deko\s*·\s*\d+|Design Book\s*[–-]\s*Page\s+\d+)$/i

export const isMdekoBook = (doc: Mupdf.Document) => (doc.getMetaData('info:Title') ?? '').startsWith('mdeko-book')

// Page en mm, avec le texte espacé (« M O N   C H O I X ») ramené à ses mots (« MON CHOIX »).
interface MdekoPage {
  lines: Line[]
  images: PageData['images']
  links: PageData['links']
  fills: PageData['fills']
  raw: PageData
}

function spacedLines(page: Mupdf.Page): Line[] {
  const out: Line[] = []
  let chars: { c: string; x0: number; x1: number; y0: number; y1: number; size: number }[] = []
  page.toStructuredText('preserve-whitespace').walk({
    beginLine: () => {
      chars = []
    },
    onChar: (c, _origin, _font, size, quad) => {
      if (c.trim()) chars.push({ c, x0: Math.min(quad[0], quad[4]), x1: Math.max(quad[2], quad[6]), y0: Math.min(quad[1], quad[3]), y1: Math.max(quad[5], quad[7]), size })
    },
    endLine: () => {
      if (!chars.length) return
      // Écart ordinaire entre deux lettres (l'espacement du texte) ; nettement plus large : un espace entre deux mots.
      const gaps = chars.slice(1).map((ch, i) => ch.x0 - chars[i].x1)
      const usual = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 4)] ?? 0
      const size = Math.max(...chars.map((ch) => ch.size))
      const text = chars.map((ch, i) => (i > 0 && gaps[i - 1] > usual + 0.15 * size ? ' ' : '') + ch.c).join('')
      out.push({
        text,
        size,
        x0: Math.min(...chars.map((ch) => ch.x0)),
        y0: Math.min(...chars.map((ch) => ch.y0)),
        x1: Math.max(...chars.map((ch) => ch.x1)),
        y1: Math.max(...chars.map((ch) => ch.y1))
      })
    }
  })
  return out
}

function mdekoPage(mupdf: MupdfModule, page: Mupdf.Page): MdekoPage {
  const raw = readPage(mupdf, page)
  const box = <T extends { x0: number; y0: number; x1: number; y1: number }>(b: T): T => ({ ...b, x0: b.x0 * MM, y0: b.y0 * MM, x1: b.x1 * MM, y1: b.y1 * MM })
  return {
    lines: spacedLines(page)
      .filter((l) => !FOOTER.test(l.text.trim()))
      .map(box),
    images: raw.images.map(box),
    links: raw.links.map((l) => ({ ...l, x: l.x * MM, y: l.y * MM })),
    fills: raw.fills.map(box),
    raw: { ...raw, lines: spacedLines(page).filter((l) => !FOOTER.test(l.text.trim())) }
  }
}

// --- Articles -------------------------------------------------------------------------------------

type Area = { x0: number; x1: number; y0: number; y1: number }
const inArea = (b: { x0: number; y0: number; x1: number; y1: number }, a: Area) => {
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  return cx >= a.x0 && cx < a.x1 && cy >= a.y0 && cy < a.y1
}
const textIn = (p: MdekoPage, a: Area) =>
  p.lines
    .filter((l) => inArea(l, a))
    .sort((x, y) => x.y0 - y.y0 || x.x0 - y.x0)
    .map((l) => l.text.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

// Prix tel qu'affiché : « 219 € », « 2 × 219 € » (quantité) ou « Quantité : 2 » (prix masqués).
function readPrice(text: string): { price: string; quantity: number } {
  const hidden = /^Quantité\s*:\s*(\d+)$/i.exec(text)
  if (hidden) return { price: '', quantity: Number(hidden[1]) }
  const many = /^(\d+)\s*×\s*(.+)$/.exec(text)
  return many ? { price: many[2], quantity: Number(many[1]) } : { price: text, quantity: 1 }
}

// Article dans un cadre : photo(s), nom, prix, fournisseur et lien, chacun dans sa bande.
interface Slot {
  photo: Area
  name: Area
  price: Area
  supplier: Area
  link: Area
  description?: Area
}

function readArticle(mupdf: MupdfModule, p: MdekoPage, s: Slot, section: string): { row: RowDraft; quantity: number } | null {
  const name = textIn(p, s.name).replace(/…$/, '')
  const { price, quantity } = readPrice(textIn(p, s.price))
  const photos = p.images.filter((i) => inArea(i, s.photo)).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  if (!name && !photos.length) return null
  const url = p.links.find((l) => l.x >= s.link.x0 - 2 && l.x < s.link.x1 && l.y >= s.link.y0 && l.y < s.link.y1)?.uri ?? null
  return {
    row: {
      section,
      name,
      priceText: price,
      url,
      supplier: textIn(p, s.supplier),
      images: photos.map((i) => encodeImage(mupdf, i.image)),
      highlighted: false,
      ...(s.description && textIn(p, s.description) ? { description: textIn(p, s.description).replace(/…$/, '') } : {})
    },
    quantity
  }
}

// Texte en haut de page : titre à gauche, pièce à droite.
// Le titre d'une page « suite » (« TAPIS · AUTRES PROPOSITIONS (SUITE) ») peut déborder à droite.
function header(p: MdekoPage): { title: string; room: string | null; suite: boolean } {
  const top = p.lines.filter((l) => l.y0 < 18).sort((a, b) => a.x0 - b.x0)
  const suite = cle(top.map((l) => l.text).join(' ')).includes('autresproposition')
  const isRoom = (l: Line) => l.x1 > 297 - 25 && !cle(l.text).includes('proposition') && !cle(l.text).includes('suite')
  const title = top
    .filter((l) => !isRoom(l))
    .map((l) => l.text.trim())
    .join(' ')
    .split('·')[0]
    .trim()
  const room = top.filter(isRoom).map((l) => l.text.trim()).join(' ')
  return { title, room: room || null, suite }
}

const label = (title: string) => title.charAt(0).toUpperCase() + title.slice(1).toLowerCase()

// --- Parcours du document -------------------------------------------------------------------------

interface Need {
  room: string | null
  label: string
  quantity: number
  choice: RowDraft
  alternatives: RowDraft[]
}

export async function* readMdekoBook(mupdf: MupdfModule, doc: Mupdf.Document): AsyncGenerator<ImportEvent> {
  const count = doc.countPages()
  const cover = count ? readCover({ ...readPage(mupdf, doc.loadPage(0)), lines: spacedLines(doc.loadPage(0)) }) : null
  yield { kind: 'start', pages: count, cover }

  // Sommaire : « 5-57. » + titre de section, sur la même ligne.
  const sections: { from: number; to: number; key: string }[] = []
  if (count > 1) {
    const toc = mdekoPage(mupdf, doc.loadPage(1))
    for (const l of toc.lines) {
      const m = /^(\d+)(?:-(\d+))?\.$/.exec(l.text.trim())
      const title = m && toc.lines.find((t) => t !== l && Math.abs(t.y0 - l.y0) < 4 && t.x0 > l.x0)
      if (m && title) sections.push({ from: Number(m[1]), to: Number(m[2] ?? m[1]), key: cle(title.text) })
    }
  }
  const sectionOf = (pageNumber: number) => sections.find((s) => pageNumber >= s.from && pageNumber <= s.to)?.key ?? ''

  let need: Need | null = null
  const flush = function* (): Generator<ImportEvent> {
    if (need) yield { kind: 'need', ...need }
    need = null
  }

  for (let n = 1; n < count - 1; n++) {
    await new Promise((r) => setImmediate(r))
    yield { kind: 'progress', page: n + 1 }
    const section = sectionOf(n + 1)
    if (!section) continue
    const p = mdekoPage(mupdf, doc.loadPage(n))
    const { title, room, suite } = header(p)
    const key = cle(title)

    if (section === 'avantpropos' || section === 'cestavous') {
      // La signature, à droite sous le texte, n'en fait pas partie.
      const body = paragraphs({ ...p.raw, lines: p.raw.lines.filter((l) => l.x0 * MM < 200 || l.text.trim().split(' ').length > 3) })
      yield { kind: 'texts', ...(section === 'avantpropos' ? { intro: body } : { closing: body }) }
    } else if (section === 'vosenvies') {
      yield { kind: 'wishes', text: paragraphs(p.raw) }
    } else if (section === 'planchetendance') {
      for (const i of p.images) yield { kind: 'trend', image: encodeImage(mupdf, i.image) }
    } else if (section.startsWith('plans') || section === 'modifications') {
      const images = [...p.images].sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))
      if (!images[0] || images[0].x1 - images[0].x0 < 100) continue
      const main = images[0]
      const caption = p.lines.filter((l) => l.y0 > main.y1 && l.y0 < main.y1 + 10 && l.text.trim() !== 'm·deko').map((l) => l.text.trim()).join(' ')
      yield {
        kind: 'render',
        image: encodeImage(mupdf, main.image),
        inset: images[1] ? encodeImage(mupdf, images[1].image) : null,
        section: section === 'modifications' ? 'changes' : 'plans',
        ...(caption ? { caption } : {})
      }
    } else if (section === 'shoppinglist') {
      if (suite && !p.lines.some((l) => cle(l.text) === 'monchoix')) {
        // Suite des propositions du besoin en cours : grille de 4 × 2.
        for (let i = 0; i < 8 && need; i++) {
          const x = 20 + (i % 4) * 65
          const y = 24 + Math.floor(i / 4) * 82
          const a = readArticle(mupdf, p, {
            photo: { x0: x, x1: x + 60, y0: y, y1: y + 47 },
            name: { x0: x, x1: x + 60, y0: y + 48, y1: y + 60.5 },
            price: { x0: x, x1: x + 60, y0: y + 60.5, y1: y + 67.5 },
            supplier: { x0: x, x1: x + 60, y0: y + 67.5, y1: y + 73.5 },
            link: { x0: x, x1: x + 60, y0: y + 73.5, y1: y + 80 }
          }, need.label)
          if (a) need.alternatives.push(a.row)
        }
      } else if (p.lines.some((l) => cle(l.text) === 'monchoix')) {
        yield* flush()
        const choice = readArticle(mupdf, p, {
          photo: { x0: 15, x1: 150, y0: 20, y1: 142 },
          name: { x0: 15, x1: 150, y0: 149, y1: 164 },
          price: { x0: 15, x1: 84, y0: 164, y1: 173.5 },
          supplier: { x0: 15, x1: 84, y0: 173.5, y1: 181 },
          link: { x0: 15, x1: 84, y0: 181, y1: 190 },
          description: { x0: 84, x1: 150, y0: 164, y1: 190 }
        }, label(title))
        if (!choice) continue
        need = { room, label: label(title), quantity: choice.quantity, choice: choice.row, alternatives: [] }
        for (let i = 0; i < 3; i++) {
          const y = 30 + i * 54
          const a = readArticle(mupdf, p, {
            photo: { x0: 160, x1: 214, y0: y - 2, y1: y + 48 },
            name: { x0: 214, x1: 290, y0: y - 1, y1: y + 16 },
            price: { x0: 214, x1: 290, y0: y + 16, y1: y + 24 },
            supplier: { x0: 214, x1: 290, y0: y + 24, y1: y + 30.5 },
            link: { x0: 214, x1: 290, y0: y + 30.5, y1: y + 38 },
            description: { x0: 214, x1: 290, y0: y + 38, y1: y + 52 }
          }, need.label)
          if (a) need.alternatives.push(a.row)
        }
      } else if (key === 'meschoix') {
        // Choix sans autre proposition réunis par 4 : chaque colonne est un besoin.
        yield* flush()
        const columns = p.lines.filter((l) => l.y0 > 22 && l.y0 < 31).sort((a, b) => a.x0 - b.x0)
        for (const c of columns) {
          const x = c.x0
          const a = readArticle(mupdf, p, {
            photo: { x0: x, x1: x + 60, y0: 31, y1: 113 },
            name: { x0: x, x1: x + 60, y0: 115, y1: 132.5 },
            price: { x0: x, x1: x + 60, y0: 132.5, y1: 141.5 },
            supplier: { x0: x, x1: x + 60, y0: 141.5, y1: 148.5 },
            link: { x0: x, x1: x + 60, y0: 148.5, y1: 156 },
            description: { x0: x, x1: x + 60, y0: 156, y1: 182 }
          }, label(c.text.trim()))
          if (a) yield { kind: 'need', room, label: label(c.text.trim()), quantity: a.quantity, choice: a.row, alternatives: [] }
        }
      } else {
        yield* flush()
      }
    } else if (section.includes('couleur') || section.includes('teinte')) {
      yield* flush()
      const paints = readMdekoPaints(p, title)
      if (paints.length) yield { kind: 'paints', paints }
    } else if (section === 'artisans') {
      yield* flush()
      yield { kind: 'artisans', artisans: readMdekoArtisans(p) }
    }
  }
  yield* flush()
}

// --- Teintes et artisans ----------------------------------------------------------------------------

// Échantillons : formes de couleur, avec le nom dessous (ou à droite), puis la marque et la référence.
function readMdekoPaints(p: MdekoPage, title: string) {
  const all = p.lines.map((l) => l.text).join(' ')
  const promo = /code\s*promo\s*:\s*(\S+)/i.exec(all)?.[1] ?? null
  const header = p.lines.find((l) => l.y0 < 32 && l.x0 < 150)?.text.trim() ?? title
  const headerKey = cle(header)
  const defaultBrand = !headerKey || headerKey === 'autre' || headerKey === 'teintesetcouleurs'
  const chips = p.fills.filter((f) => f.x1 - f.x0 > 15 && f.y1 - f.y0 > 15 && f.x1 - f.x0 < 150 && f.hex !== '#FFFFFF')
  const out = []
  for (const chip of chips) {
    const below = p.lines
      .filter((l) => l.y0 >= chip.y1 && l.y0 < chip.y1 + 22 && l.x0 >= chip.x0 - 1 && l.x0 < chip.x1)
      .filter((l) => !/^\d{2}$/.test(l.text.trim()))
    const beside = p.lines.filter((l) => l.x0 >= chip.x1 && l.x0 < chip.x1 + 12 && l.y0 >= chip.y0 - 2 && l.y0 < chip.y1)
    const legend = (below.length ? below : beside).sort((a, b) => a.y0 - b.y0).map((l) => l.text.trim())
    if (!legend.length) continue
    const [rawName, ...rest] = legend
    let brand = defaultBrand ? DEFAULT_PAINT_BRAND : header
    const details = rest.filter((t) => {
      if (/^#[0-9A-F]{6}$/i.test(t)) return false
      if (!defaultBrand && cle(t) === headerKey) {
        brand = t // la marque telle qu'elle est écrite, sous l'échantillon
        return false
      }
      return true
    })
    out.push({ brand, name: label(rawName), reference: details.join(' ') || null, hex: chip.hex, promoCode: promo })
  }
  return out
}

// Une ligne par artisan : métier à gauche, nom (ville) au milieu, téléphone à droite.
function readMdekoArtisans(p: MdekoPage) {
  const trades = p.lines.filter((l) => l.x0 < 60 && l.y0 > 25)
  return trades.map((t) => {
    const row = p.lines.filter((l) => l !== t && Math.abs((l.y0 + l.y1) / 2 - (t.y0 + t.y1) / 2) < 4)
    const who = row.find((l) => l.x0 >= 60 && l.x0 < 200)?.text.trim() ?? ''
    const phone = row.find((l) => l.x0 >= 200)?.text.trim() ?? null
    return {
      trade: label(t.text.trim()),
      name: who.replace(/\s*\([^)]*\)\s*$/, '').trim() || who,
      city: /\(([^)]+)\)\s*$/.exec(who)?.[1].trim() ?? null,
      phone
    }
  })
}
