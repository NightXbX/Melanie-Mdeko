import latin200 from '@fontsource/poppins/files/poppins-latin-200-normal.woff2?inline'
import latin300 from '@fontsource/poppins/files/poppins-latin-300-normal.woff2?inline'
import latin400 from '@fontsource/poppins/files/poppins-latin-400-normal.woff2?inline'
import latin500 from '@fontsource/poppins/files/poppins-latin-500-normal.woff2?inline'
import ext200 from '@fontsource/poppins/files/poppins-latin-ext-200-normal.woff2?inline'
import ext300 from '@fontsource/poppins/files/poppins-latin-ext-300-normal.woff2?inline'
import ext400 from '@fontsource/poppins/files/poppins-latin-ext-400-normal.woff2?inline'
import ext500 from '@fontsource/poppins/files/poppins-latin-ext-500-normal.woff2?inline'
import { COLORS, PAGE } from './charte'
import type { Element, Page, Run } from './layout'

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
  .join('')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const box = (e: { x: number; y: number; w: number; h: number }) =>
  `left:${e.x.toFixed(2)}mm;top:${e.y.toFixed(2)}mm;width:${e.w.toFixed(2)}mm;height:${e.h.toFixed(2)}mm`

function run(r: Run): string {
  const style = [r.color && `color:${r.color}`, r.weight && `font-weight:${r.weight}`].filter(Boolean).join(';')
  const content = esc(r.text).replace(/\n/g, '<br>')
  return style ? `<span style="${style}">${content}</span>` : content
}

function element(e: Element): string {
  switch (e.type) {
    case 'image':
      return `<img class="el" src="${esc(e.image.url)}" style="${box(e)}">`
    case 'rect':
    case 'ellipse':
      return `<div class="el" style="${box(e)};${e.fill ? `background:${e.fill};` : ''}${e.line ? `border:0.25mm solid ${e.line};` : ''}${e.type === 'ellipse' ? 'border-radius:50%;' : ''}"></div>`
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
        e.rotate ? `transform:rotate(-${360 - e.rotate}deg)` : ''
      ]
        .filter(Boolean)
        .join(';')
      const content = e.runs.map(run).join('')
      const inner = e.link ? `<a href="${esc(e.link)}">${content}</a>` : content
      return `<div class="el text" style="${css}"><div>${inner}</div></div>`
    }
  }
}

// Document HTML du book : pages A4 paysage, police Poppins intégrée.
// `screen` ajoute la présentation d'aperçu (fond gris, pages espacées) ; sans lui, c'est la version PDF.
export function bookHtml(pages: Page[], screen = false): string {
  const css = `${FONTS}
@page{size:${PAGE.width}mm ${PAGE.height}mm;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:Poppins,sans-serif;-webkit-font-smoothing:antialiased}
.page{position:relative;width:${PAGE.width}mm;height:${PAGE.height}mm;overflow:hidden;background:#fff;break-after:page}
.el{position:absolute;margin:0}
.text{display:flex;flex-direction:column;white-space:pre-wrap;overflow:hidden;transform-origin:center}
.text a{color:inherit;text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:0.5px}
img.el{object-fit:contain}
${screen ? `body{background:#e8e6e3;padding:24px 0}.page{margin:0 auto 24px;box-shadow:0 2px 12px rgba(0,0,0,.12)}a{pointer-events:none}` : ''}`
  const body = pages.map((p) => `<section class="page">${p.elements.map(element).join('')}</section>`).join('\n')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`
}
