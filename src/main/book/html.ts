import latin200 from '@fontsource/poppins/files/poppins-latin-200-normal.woff2?inline'
import latin300 from '@fontsource/poppins/files/poppins-latin-300-normal.woff2?inline'
import latin400 from '@fontsource/poppins/files/poppins-latin-400-normal.woff2?inline'
import latin500 from '@fontsource/poppins/files/poppins-latin-500-normal.woff2?inline'
import ext200 from '@fontsource/poppins/files/poppins-latin-ext-200-normal.woff2?inline'
import ext300 from '@fontsource/poppins/files/poppins-latin-ext-300-normal.woff2?inline'
import ext400 from '@fontsource/poppins/files/poppins-latin-ext-400-normal.woff2?inline'
import ext500 from '@fontsource/poppins/files/poppins-latin-ext-500-normal.woff2?inline'
import italic200 from '@fontsource/poppins/files/poppins-latin-200-italic.woff2?inline'
import italic300 from '@fontsource/poppins/files/poppins-latin-300-italic.woff2?inline'
import italic400 from '@fontsource/poppins/files/poppins-latin-400-italic.woff2?inline'
import italic500 from '@fontsource/poppins/files/poppins-latin-500-italic.woff2?inline'
import { COLORS, PAGE } from './charte'
import { lineGeometry, type Element, type Page, type Run } from '@shared/book'

// Plages Unicode de Fontsource : latin (dont œ, €) et latin étendu.
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'

const FONTS = (
  [
    [200, latin200, ext200],
    [300, latin300, ext300],
    [400, latin400, ext400],
    [500, latin500, ext500]
  ] as const
)
  .map(
    ([w, latin, ext]) =>
      `@font-face{font-family:Poppins;font-weight:${w};src:url(${latin}) format('woff2');unicode-range:${LATIN}}` +
      `@font-face{font-family:Poppins;font-weight:${w};src:url(${ext}) format('woff2');unicode-range:${LATIN_EXT}}`
  )
  .join('') +
  // Italiques (bouton I de l'aperçu) : vraies italiques de Poppins, pour les lettres latines.
  ([
    [200, italic200],
    [300, italic300],
    [400, italic400],
    [500, italic500]
  ] as const)
    .map(([w, file]) => `@font-face{font-family:Poppins;font-style:italic;font-weight:${w};src:url(${file}) format('woff2');unicode-range:${LATIN}}`)
    .join('')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const box = (e: { x: number; y: number; w: number; h: number }) =>
  `left:${e.x.toFixed(2)}mm;top:${e.y.toFixed(2)}mm;width:${e.w.toFixed(2)}mm;height:${e.h.toFixed(2)}mm`

function run(r: Run): string {
  const style = [
    r.color && `color:${r.color}`,
    r.weight && `font-weight:${r.weight}`,
    r.italic !== undefined && `font-style:${r.italic ? 'italic' : 'normal'}`,
    r.underline !== undefined && `text-decoration:${r.underline ? 'underline' : 'none'}`
  ]
    .filter(Boolean)
    .join(';')
  const content = esc(r.text).replace(/\n/g, '<br>')
  return style ? `<span style="${style}">${content}</span>` : content
}

function element(e: Element): string {
  switch (e.type) {
    case 'image':
      return `<img class="el" src="${esc(e.image.url)}" style="${box(e)}">`
    case 'rect':
    case 'ellipse':
      return `<div class="el" style="${box(e)};${e.fill ? `background:${e.fill};` : ''}${e.line ? `border:${lineMm(e.lineWidth)}mm solid ${e.line};` : ''}${e.type === 'ellipse' ? 'border-radius:50%;' : ''}"></div>`
    case 'line':
      return lineSvg(e)
    case 'text': {
      const s = e.style
      const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[s.valign ?? 'top']
      const css = [
        box(e),
        `font-size:${s.size}pt`,
        `font-weight:${s.weight ?? 200}`,
        `color:${s.color ?? COLORS.text}`,
        `text-align:${s.align ?? 'left'}`,
        `justify-content:${justify}`,
        `line-height:${s.lineHeight ?? 1.3}`,
        s.letterSpacing ? `letter-spacing:${s.letterSpacing}pt` : '',
        e.rotate ? `transform:rotate(-${360 - e.rotate}deg)` : '',
        s.italic ? 'font-style:italic' : '',
        s.underline ? 'text-decoration:underline' : ''
      ]
        .filter(Boolean)
        .join(';')
      const content = e.runs.map(run).join('')
      const inner = e.link ? `<a href="${esc(e.link)}">${content}</a>` : content
      return `<div class="el text" style="${css}"><div>${inner}</div></div>`
    }
  }
}

// Épaisseur d'un trait : pt → mm (0,25 mm pour les cadres de la charte).
const lineMm = (pt: number | undefined) => (pt ? pt * 0.3528 : 0.25).toFixed(2)

// Trait ou flèche : SVG à la taille de la boîte, tourné autour de son centre (même dessin que l'aperçu).
function lineSvg(e: Extract<Element, { type: 'line' }>): string {
  const g = lineGeometry(e)
  const color = e.line ?? COLORS.text
  const head = e.arrow
    ? `<polygon points="${(e.w - g.head).toFixed(2)},${(g.y - g.head / 2).toFixed(2)} ${e.w.toFixed(2)},${g.y.toFixed(2)} ${(e.w - g.head).toFixed(2)},${(g.y + g.head / 2).toFixed(2)}" fill="${color}"/>`
    : ''
  const rotate = e.rotate ? `transform:rotate(${e.rotate}deg);` : ''
  return `<svg class="el" viewBox="0 0 ${e.w.toFixed(2)} ${e.h.toFixed(2)}" style="${box(e)};overflow:visible;${rotate}"><line x1="0" y1="${g.y.toFixed(2)}" x2="${g.end.toFixed(2)}" y2="${g.y.toFixed(2)}" stroke="${color}" stroke-width="${g.width.toFixed(2)}"/>${head}</svg>`
}

// Les textes vides proposés à la saisie (légende, annotation) n'apparaissent pas dans le book exporté.
export function exported(page: Page): Element[] {
  return page.elements.filter((e) => e.type !== 'text' || !e.placeholder || e.runs.some((r) => r.text.trim()))
}

// Document HTML du book : pages A4 paysage, police Poppins intégrée.
export function bookHtml(pages: Page[]): string {
  const css = `${FONTS}
@page{size:${PAGE.width}mm ${PAGE.height}mm;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:Poppins,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:${PAGE.width}mm;height:${PAGE.height}mm;overflow:hidden;background:#fff;break-after:page}
.el{position:absolute;margin:0}
.text{display:flex;flex-direction:column;white-space:pre-wrap;overflow:hidden;transform-origin:center}
.text a{color:inherit;text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:0.5px}
img.el{object-fit:contain}`
  const body = pages.map((p) => `<section class="page">${exported(p).map(element).join('')}</section>`).join('\n')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`
}
