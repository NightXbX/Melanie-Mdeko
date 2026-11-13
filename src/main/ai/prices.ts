import type { DatabaseSync } from 'node:sqlite'
import type { PriceCheckProgress, PriceCheckRow, PriceCheckScope } from '@shared/assistant'
import { decodeEntities } from '../product-page'
import { chatCompletion, type Fetch } from './openrouter'
import { checkCap, recordUsage } from './versions'

// Vérification des prix par l'IA : la page du produit est lue (texte visible et données structurées), puis
// le modèle de l'assistant dit le prix affiché. Rien n'est changé tout seul : les écarts sont proposés à
// Mélanie, qui les applique (ou non) ; chaque changement de prix va dans l'historique.

type PriceKind = 'fixed' | 'from' | 'per_m2' | 'per_roll' | 'on_quote'
const KINDS: PriceKind[] = ['fixed', 'from', 'per_m2', 'per_roll', 'on_quote']
const MAX_TEXT = 9000
export const PRICE_CHECK_ESTIMATE_CENTS = 0.5 // par article avec un modèle « mini », marge comprise

// Texte utile d'une page : données structurées (JSON-LD, balises meta de prix) puis texte visible.
export function pageDigest(html: string): string {
  const parts: string[] = []
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (/"(Product|Offer|AggregateOffer)"/.test(m[1])) parts.push(m[1].replace(/\s+/g, ' ').slice(0, 3000))
  }
  for (const m of html.matchAll(/<meta[^>]+(?:property|name|itemprop)=["']([^"']*(?:price|title|availability)[^"']*)["'][^>]*>/gi)) {
    const content = m[0].match(/content=["']([^"']*)["']/i)?.[1]
    if (content) parts.push(`${m[1]} = ${decodeEntities(content)}`)
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(header|footer|nav)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return [title ? `Titre : ${decodeEntities(title).trim()}` : '', ...parts, 'Texte de la page :', text].join('\n').slice(0, MAX_TEXT)
}

interface Answer {
  status: 'found' | 'unavailable' | 'not_product' | 'unknown'
  price_eur?: number | null
  price_kind?: string
  same_product?: boolean
  note?: string
}

export async function askPrice(
  key: string,
  model: string,
  fetch: Fetch,
  article: { name: string; supplier: string | null; priceCents: number | null },
  digest: string,
  signal?: AbortSignal
): Promise<{ answer: Answer; costCents: number }> {
  const out = await chatCompletion(
    key,
    fetch,
    {
      model,
      json: true,
      messages: [
        {
          role: 'system',
          content:
            'Tu lis la page d’un site marchand pour vérifier le prix d’un article. Réponds uniquement en JSON : ' +
            '{"status": "found" | "unavailable" | "not_product" | "unknown", "price_eur": nombre ou null, ' +
            '"price_kind": "fixed" | "from" | "per_m2" | "per_roll" | "on_quote", "same_product": true/false, "note": "courte explication en français"}. ' +
            'Prix = prix de vente actuel TTC en euros de cet article (prix soldé s’il y en a un, jamais le prix barré, jamais la livraison ni un autre produit suggéré). ' +
            '« from » si la page indique « à partir de » ou plusieurs tailles à des prix différents ; « per_m2 » / « per_roll » pour un prix au m² ou au rouleau. ' +
            '« unavailable » si le produit n’est plus vendu ou en rupture définitive ; « not_product » si la page n’est pas celle d’un produit (accueil, liste, erreur) ; ' +
            '« unknown » si le prix n’apparaît pas dans le texte. N’invente jamais un prix.'
        },
        {
          role: 'user',
          content: `Article attendu : ${article.name}${article.supplier ? ` (${article.supplier})` : ''}\n\n${digest}`
        }
      ]
    },
    signal
  )
  let answer: Answer = { status: 'unknown' }
  try {
    answer = JSON.parse(out.text.replace(/^```(?:json)?|```$/g, '').trim()) as Answer
  } catch {
    // réponse illisible : prix inconnu
  }
  return { answer, costCents: out.costCents }
}

// Articles à vérifier selon le choix de Mélanie.
export function priceCheckTargets(db: DatabaseSync, scope: PriceCheckScope): { id: number; name: string; supplier: string | null; url: string; price_cents: number | null; price_kind: string }[] {
  const base = `SELECT a.id, a.name, s.name AS supplier, a.url, a.price_cents, a.price_kind FROM articles a
    LEFT JOIN suppliers s ON s.id = a.supplier_id WHERE a.deleted_at IS NULL AND a.url IS NOT NULL`
  if (scope === 'projects') {
    return db
      .prepare(
        `${base} AND a.id IN (SELECT na.article_id FROM need_articles na JOIN needs n ON n.id = na.need_id
          JOIN projects p ON p.id = n.project_id WHERE p.deleted_at IS NULL) ORDER BY a.id`
      )
      .all() as never
  }
  if (scope === 'stale') {
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString()
    return db.prepare(`${base} AND a.price_cents IS NOT NULL AND a.updated_at < ? ORDER BY a.updated_at`).all(yearAgo) as never
  }
  const ids = scope.filter((n) => Number.isInteger(n))
  if (!ids.length) return []
  return db.prepare(`${base} AND a.id IN (${ids.map(() => '?').join(',')}) ORDER BY a.id`).all(...ids) as never
}

export async function checkPrices(
  db: DatabaseSync,
  key: string,
  model: string,
  fetch: Fetch,
  scope: PriceCheckScope,
  readPage: (url: string) => Promise<string | null>,
  onProgress: (p: PriceCheckProgress) => void,
  signal: AbortSignal
): Promise<PriceCheckRow[]> {
  const targets = priceCheckTargets(db, scope)
  checkCap(db, targets.length * PRICE_CHECK_ESTIMATE_CENTS)
  const rows: PriceCheckRow[] = []
  const progress: PriceCheckProgress = { done: 0, total: targets.length, differences: 0 }
  let next = 0
  let cost = 0
  const worker = async () => {
    while (next < targets.length && !signal.aborted) {
      const a = targets[next++]
      const row: PriceCheckRow = {
        articleId: a.id,
        name: a.name,
        supplier: a.supplier,
        url: a.url,
        currentCents: a.price_cents,
        currentKind: a.price_kind,
        foundCents: null,
        foundKind: null,
        status: 'unknown',
        note: ''
      }
      try {
        const html = await readPage(a.url)
        if (!html) {
          row.note = 'Le site n’a pas laissé lire la page : à vérifier à la main.'
        } else {
          const { answer, costCents } = await askPrice(key, model, fetch, { name: a.name, supplier: a.supplier, priceCents: a.price_cents }, pageDigest(html), signal)
          cost += costCents
          row.note = answer.note ?? ''
          if (answer.status === 'found' && typeof answer.price_eur === 'number' && answer.price_eur > 0 && answer.same_product !== false) {
            row.status = 'found'
            row.foundCents = Math.round(answer.price_eur * 100)
            row.foundKind = KINDS.includes(answer.price_kind as PriceKind) ? (answer.price_kind as PriceKind) : 'fixed'
          } else if (answer.status === 'found' && answer.same_product === false) {
            row.status = 'unknown'
            row.note = `La page semble montrer un autre produit. ${row.note}`.trim()
          } else row.status = answer.status === 'found' ? 'unknown' : answer.status
        }
      } catch (e) {
        if (signal.aborted) break
        row.note = (e as Error).message
      }
      const differs =
        (row.status === 'found' && (row.foundCents !== row.currentCents || (row.foundKind !== row.currentKind && row.currentKind !== 'unknown'))) ||
        row.status === 'unavailable' ||
        row.status === 'not_product'
      // La lecture de la page par l'IA vaut vérification du lien (même pour les sites qui refusent les robots).
      const link = row.status === 'found' ? 'ok' : row.status === 'unavailable' || row.status === 'not_product' ? 'gone' : null
      if (link) db.prepare('UPDATE articles SET link_status = ?, link_checked_at = ? WHERE id = ?').run(link, new Date().toISOString(), a.id)
      if (row.status === 'found' && !differs) db.prepare('UPDATE articles SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), a.id)
      if (differs || row.status === 'unknown') rows.push(row)
      if (differs) progress.differences++
      progress.done++
      onProgress({ ...progress })
    }
  }
  try {
    await Promise.all(Array.from({ length: 4 }, worker))
  } finally {
    recordUsage(db, 'check', model, cost)
  }
  return rows
}

// Applique un prix trouvé (avec l'historique des prix).
export function applyFoundPrice(db: DatabaseSync, articleId: number, cents: number, kind: string): void {
  const before = db.prepare('SELECT price_cents FROM articles WHERE id = ?').get(articleId) as { price_cents: number | null } | undefined
  if (!before) return
  db.prepare('UPDATE articles SET price_cents = ?, price_kind = ?, price_text = NULL, updated_at = ? WHERE id = ?').run(
    cents,
    KINDS.includes(kind as PriceKind) ? kind : 'fixed',
    new Date().toISOString(),
    articleId
  )
  if (before.price_cents !== cents) {
    db.prepare('INSERT INTO price_history (article_id, old_cents, new_cents, origin) VALUES (?, ?, ?, ?)').run(articleId, before.price_cents, cents, 'verification-ia')
  }
}
