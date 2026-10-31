// Lecture d'une page produit pour préremplir la fiche d'un article : nom, prix, photos, description.
// Les sites marchands décrivent presque tous leurs produits pour les moteurs de recherche (données
// JSON-LD « Product », balises Open Graph) : on lit ces informations, sans dépendre de la mise en page.

export interface ProductInfo {
  name: string | null
  priceCents: number | null
  siteName: string | null
  description: string | null
  imageUrls: string[]
}

const MAX_IMAGES = 4
const MAX_DESCRIPTION = 300

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

const clean = (s: unknown): string | null => {
  if (typeof s !== 'string') return null
  const text = decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

// « 1 249,00 € », « 1249.00 », 1249 → 124900.
export function priceToCents(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null
  if (typeof value !== 'string') return null
  let s = value.replace(/[^\d.,]/g, '')
  if (!s) return null
  const decimal = /[.,](\d{1,2})$/.exec(s)
  const whole = (decimal ? s.slice(0, decimal.index) : s).replace(/[.,]/g, '')
  s = decimal ? `${whole}.${decimal[1]}` : whole
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

// Tous les objets JSON-LD de la page, y compris ceux rangés dans un « @graph » ou une liste.
function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = []
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      nodes.push(o)
      if (o['@graph']) visit(o['@graph'])
    }
  }
  for (const m of html.matchAll(/<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1].trim()))
    } catch {
      // Bloc mal formé : on passe au suivant.
    }
  }
  return nodes
}

const isType = (o: Record<string, unknown>, type: string) => {
  const t = o['@type']
  return Array.isArray(t) ? t.includes(type) : t === type
}

function imageUrls(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(imageUrls)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return imageUrls(o.contentUrl ?? o.url)
  }
  return []
}

function offerPrice(v: unknown): number | null {
  if (Array.isArray(v)) {
    const prices = v.map(offerPrice).filter((p): p is number => p !== null)
    return prices.length ? Math.min(...prices) : null
  }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const spec = o.priceSpecification as Record<string, unknown> | Record<string, unknown>[] | undefined
  return priceToCents(o.price) ?? priceToCents(o.lowPrice) ?? (spec ? offerPrice(Array.isArray(spec) ? spec : [spec]) : null) ?? offerPrice(o.offers)
}

// Contenu des balises <meta property|name|itemprop="…" content="…">, quel que soit l'ordre des attributs.
function metaTags(html: string): Map<string, string> {
  const metas = new Map<string, string>()
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0]
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
    const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag)
    if (key && content && !metas.has(key)) metas.set(key, decodeEntities(content[1] ?? content[2] ?? ''))
  }
  return metas
}

const absolute = (url: string, base: string): string | null => {
  try {
    const u = new URL(decodeEntities(url.trim()), base)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

export function parseProductPage(html: string, pageUrl: string): ProductInfo | null {
  const nodes = jsonLdNodes(html)
  const product = nodes.find((o) => isType(o, 'Product')) ?? nodes.find((o) => isType(o, 'ProductGroup'))
  const variant = product && Array.isArray(product.hasVariant) ? (product.hasVariant[0] as Record<string, unknown>) : undefined
  const meta = metaTags(html)
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1])

  const name =
    clean(product?.name) ??
    clean(meta.get('og:title')) ??
    clean(meta.get('twitter:title')) ??
    // Titre de l'onglet sans le nom du site (« Fauteuil Ulit | Kave Home »).
    (title ? title.split(/\s+[|–—]\s+/)[0] : null)

  const priceCents =
    (product ? (offerPrice(product.offers) ?? (variant ? offerPrice(variant.offers) : null)) : null) ??
    priceToCents(meta.get('product:price:amount')) ??
    priceToCents(meta.get('og:price:amount')) ??
    priceToCents(meta.get('price'))

  const description = clean(product?.description) ?? clean(meta.get('og:description')) ?? clean(meta.get('description'))

  const images: string[] = []
  for (const raw of [...imageUrls(product?.image), ...imageUrls(variant?.image), meta.get('og:image') ?? '', meta.get('og:image:secure_url') ?? '']) {
    const url = raw && absolute(raw, pageUrl)
    if (url && !images.includes(url)) images.push(url)
    if (images.length >= MAX_IMAGES) break
  }

  // Ni prix ni photo : ce n'est pas une page produit (page anti-robots, configurateur, accueil du site).
  if (!images.length && priceCents === null) return null
  return {
    name,
    priceCents,
    siteName: clean(meta.get('og:site_name')),
    description: description && description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1).replace(/\s+\S*$/, '')}…` : description,
    imageUrls: images
  }
}
