// Règles de classement des articles importés (traduction de tools/migration/regles.py).
// Les listes (sections, fournisseurs, matières) sont communes : src/shared/import-rules.json.
import type { PriceKind } from '@shared/api'
import RULES from '@shared/import-rules.json'

const SECTIONS = RULES.sections as unknown as Record<string, [string, string | null]>
const SUPPLIERS = RULES.fournisseurs as Record<string, string>

export const sansAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')

// Clé de comparaison : minuscules, sans accents ni ponctuation.
export const cle = (s: string) => sansAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '')

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())

function contains(name: string, ...words: string[]): boolean {
  const n = ` ${sansAccents(name).toLowerCase()} `
  return words.some((w) => new RegExp(`(^|[^a-z0-9])${w}`).test(n))
}

export function category(section: string, name: string): [string, string] {
  const s = cle(section)
  const [family, sub] = SECTIONS[s] ?? ['Décoration', 'Divers']
  if (sub !== null) return [family, sub]
  if (s === 'coussinsplaid') return contains(name, 'plaid') ? ['Textiles', 'Plaids'] : ['Textiles', 'Coussins']
  if (s === 'tableschaises') {
    if (contains(name, 'chaise', 'fauteuil')) return ['Assises', 'Chaises']
    if (contains(name, 'banc', 'banquette')) return ['Assises', 'Bancs']
    if (contains(name, 'tabouret')) return ['Assises', 'Tabourets']
    return ['Tables & bureaux', 'Tables à manger']
  }
  if (s === 'luminaires') {
    if (contains(name, 'suspension', 'plafonnier', 'lustre')) return ['Luminaires', 'Suspensions']
    if (contains(name, 'lampadaire')) return ['Luminaires', 'Lampadaires']
    if (contains(name, 'applique')) return ['Luminaires', 'Appliques']
    if (contains(name, 'spot', 'rail')) return ['Luminaires', 'Spots']
    if (contains(name, 'lampe', 'baladeuse')) return ['Luminaires', 'Lampes']
    return ['Luminaires', 'Luminaires divers']
  }
  if (s === 'literie') {
    if (contains(name, 'matelas', 'sommier', 'surmatelas')) return ['Chambre', 'Matelas & sommiers']
    if (contains(name, 'tete de lit')) return ['Chambre', 'Têtes de lit']
    if (contains(name, 'linge', 'housse', 'couette', 'drap', 'oreiller', 'parure')) return ['Textiles', 'Linge de lit']
    return ['Chambre', 'Lits']
  }
  return [family, 'Divers']
}

export function supplier(raw: string): string | null {
  const text = raw.split(/\s+/).filter(Boolean).join(' ')
  if (!text) return null
  return SUPPLIERS[cle(text)] ?? (text === text.toUpperCase() && /\p{L}/u.test(text) ? titleCase(text) : text)
}

export function domain(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www\d?|fr)\./, '') || null
  } catch {
    return null
  }
}

export interface ParsedPrice {
  cents: number | null
  kind: PriceKind
  text: string
}

export function price(raw: string): ParsedPrice {
  const text = raw.split(/\s+/).filter(Boolean).join(' ')
  const t = sansAccents(text).toLowerCase()
  if (!text) return { cents: null, kind: 'unknown', text }
  if (t.includes('devis') || t.includes('magasin')) return { cents: null, kind: 'on_quote', text }
  const m = /(\d[\d\s  .]*(?:[,.]\d{1,2})?)/.exec(t)
  if (!m) return { cents: null, kind: 'unknown', text }
  let n = m[1].replace(/[\s  ]/g, '')
  // « 1.449 » ou « 1 449 » = milliers ; « 19,90 » ou « 19.90 » = décimales.
  if (/^\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, '')
  const value = Number.parseFloat(n.replace(',', '.'))
  if (Number.isNaN(value)) return { cents: null, kind: 'unknown', text }
  const kind: PriceKind = /\/\s*m\s*[2²]|le\s*m\s*[2²]|(^|[^a-z0-9])m2([^a-z0-9]|$)|m²/.test(t)
    ? 'per_m2'
    : t.includes('rouleau')
      ? 'per_roll'
      : t.includes('partir') || t.includes('des ')
        ? 'from'
        : 'fixed'
  return { cents: Math.round(value * 100), kind, text }
}

// « ALL WHITE N° 2005 FORROW&BALL » -> [« All white », « N° 2005 »]
export function paintName(label: string): [string, string | null] {
  let t = label.replace(/f[ao]rrow\s*&?\s*ball/gi, ' ').split(/\s+/).filter(Boolean).join(' ')
  const ral = /^RAL\s*(\d{4})$/i.exec(t)
  if (ral) return [`RAL ${ral[1]}`, null]
  let reference: string | null = null
  const m = /(?:\bN\s*°?\s*)?\b(\d{1,4})$/.exec(t)
  if (m) {
    reference = `N° ${m[1]}`
    t = t.slice(0, m.index).trim()
  }
  t = t.replace(/\s+N\s*°?$/, '').trim()
  return [t === t.toUpperCase() ? capitalize(t) : t, reference]
}

const DIMENSIONS =
  /(?:(?:^|(?<=[^a-z0-9]))(?:diam(?:etre)?\.?|ø)\s*\d+(?:[.,]\d+)?\s*(?:cm|mm)?)|(?:\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm|m)?\b)|(?:\b[lhp]\.?\s*\d+(?:[.,]\d+)?\s*cm\b)|(?:\b\d+(?:[.,]\d+)?\s*cm\b)/gi

export function dimensions(name: string): string | null {
  const found: string[] = []
  for (const m of sansAccents(name).matchAll(DIMENSIONS)) {
    const d = m[0].trim().replace(/\s*[x×]\s*/gi, ' × ').replace(/^(diam(?:etre)?\.?|ø)\s*/i, 'Ø ')
    if (!found.includes(d)) found.push(d)
  }
  return found.join(' · ') || null
}

export function colorMaterial(name: string): string | null {
  const n = ` ${sansAccents(name).toLowerCase()} `
  const found = RULES.matieres.filter((m) => new RegExp(`(^|[^a-z0-9])${sansAccents(m)}s?([^a-z0-9]|$)`).test(n))
  return found.join(', ') || null
}
