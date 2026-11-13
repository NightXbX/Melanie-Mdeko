// Produit src/main/book/poppins-widths.ts : largeur de chaque lettre de Poppins Light (graisse 300), en
// millièmes de la taille du texte. Sert à couper un long texte en pages (compte-rendu) sans le mesurer
// dans un navigateur. Lecture des fichiers WOFF de @fontsource (tables zlib).
// Usage : node tools/largeurs-poppins.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

function tables(file) {
  const b = readFileSync(file)
  const out = {}
  const count = b.readUInt16BE(12)
  for (let i = 0; i < count; i++) {
    const d = 44 + i * 20
    const tag = b.toString('latin1', d, d + 4)
    const offset = b.readUInt32BE(d + 4)
    const comp = b.readUInt32BE(d + 8)
    const orig = b.readUInt32BE(d + 12)
    const raw = b.subarray(offset, offset + comp)
    out[tag] = comp < orig ? inflateSync(raw) : raw
  }
  return out
}

// Caractère → glyphe (cmap format 4, Unicode BMP).
function charToGlyph(cmap) {
  const n = cmap.readUInt16BE(2)
  for (let i = 0; i < n; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8)
    const encoding = cmap.readUInt16BE(6 + i * 8)
    const off = cmap.readUInt32BE(8 + i * 8)
    if (platform !== 3 || encoding !== 1 || cmap.readUInt16BE(off) !== 4) continue
    const segs = cmap.readUInt16BE(off + 6) / 2
    const ends = off + 14
    const starts = ends + segs * 2 + 2
    const deltas = starts + segs * 2
    const ranges = deltas + segs * 2
    const map = new Map()
    for (let s = 0; s < segs; s++) {
      const end = cmap.readUInt16BE(ends + s * 2)
      const start = cmap.readUInt16BE(starts + s * 2)
      const delta = cmap.readInt16BE(deltas + s * 2)
      const range = cmap.readUInt16BE(ranges + s * 2)
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g
        if (range === 0) g = (c + delta) & 0xffff
        else {
          const at = ranges + s * 2 + range + (c - start) * 2
          g = cmap.readUInt16BE(at)
          if (g) g = (g + delta) & 0xffff
        }
        if (g) map.set(c, g)
      }
    }
    return map
  }
  throw new Error('cmap introuvable')
}

const widths = {}
for (const subset of ['latin-ext', 'latin']) {
  const t = tables(`node_modules/@fontsource/poppins/files/poppins-${subset}-300-normal.woff`)
  const em = t.head.readUInt16BE(18)
  const metrics = t.hhea.readUInt16BE(34)
  const advance = (g) => t.hmtx.readUInt16BE(Math.min(g, metrics - 1) * 4)
  for (const [c, g] of charToGlyph(t.cmap)) {
    if (c < 0x20 || c > 0x2122) continue
    widths[c] = Math.round((advance(g) * 1000) / em)
  }
}

const entries = Object.entries(widths).sort((a, b) => a[0] - b[0])
const body = entries.map(([c, w]) => `${c}:${w}`).join(',')
writeFileSync(
  'src/main/book/poppins-widths.ts',
  `// Fichier produit par tools/largeurs-poppins.mjs : ne pas modifier à la main.\n` +
    `// Largeur des lettres de Poppins Light, en millièmes de la taille du texte (code du caractère : largeur).\n` +
    `export const POPPINS_LIGHT: Record<number, number> = {${body}}\n`
)
console.log(`${entries.length} caractères`)
