import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type {
  ArticleCard,
  ArticleDetail,
  ArticleFacets,
  ArticleFilters,
  ArticlePage,
  ArticleQuery,
  ArticleSort,
  FamilyFacet,
  LinkStatus,
  PriceKind
} from '@shared/api'
import { mediaUrl, thumbnailUrl } from './media-urls'

type Row = Record<string, unknown>

// --- Index de recherche -------------------------------------------------------------------------

const INDEX_ROWS = `
  SELECT a.id, a.name, coalesce(s.name, ''), concat_ws(' ', f.name, c.name),
         concat_ws(' ', a.description, a.dimensions, a.color_material, a.private_note,
           (SELECT group_concat(t.name, ' ') FROM article_tags at JOIN tags t ON t.id = at.tag_id
             WHERE at.article_id = a.id))
  FROM articles a
  LEFT JOIN suppliers s ON s.id = a.supplier_id
  LEFT JOIN categories c ON c.id = a.category_id
  LEFT JOIN families f ON f.id = c.family_id
  WHERE a.deleted_at IS NULL`

export function rebuildSearchIndex(db: DatabaseSync): void {
  db.exec('BEGIN')
  db.exec('DELETE FROM articles_fts')
  db.exec(`INSERT INTO articles_fts (rowid, name, supplier, category, details) ${INDEX_ROWS}`)
  db.exec('COMMIT')
  vocabularies.delete(db)
}

// L'outil de migration remplit la base sans l'index : on le reconstruit s'il ne correspond pas.
export function ensureSearchIndex(db: DatabaseSync): void {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n
  if (count('SELECT count(*) AS n FROM articles WHERE deleted_at IS NULL') !== count('SELECT count(*) AS n FROM articles_fts')) {
    rebuildSearchIndex(db)
  }
}

export function reindexArticle(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM articles_fts WHERE rowid = ?').run(id)
  db.prepare(`INSERT INTO articles_fts (rowid, name, supplier, category, details) ${INDEX_ROWS} AND a.id = ?`).run(id)
  vocabularies.delete(db)
}

// --- Recherche tolérante ------------------------------------------------------------------------
// « Table a mangé », « tables à manger » ou « tabel a manger » trouvent les mêmes tables : on ignore les
// petits mots, le pluriel et les accents, et on accepte une faute de frappe (deux pour les mots longs),
// dans ce qui est tapé comme dans ce qui a été noté sur l'article.

export interface VocabTerm {
  term: string
  doc: number // nombre d'articles où le mot apparaît
}

// Mots de l'index (déjà sans accents ni majuscules), relus après chaque modification d'un article.
const vocabularies = new WeakMap<DatabaseSync, VocabTerm[]>()

export function vocabulary(db: DatabaseSync): VocabTerm[] {
  let terms = vocabularies.get(db)
  if (!terms) {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.articles_vocab USING fts5vocab(main, 'articles_fts', 'row')")
    terms = db.prepare('SELECT term, doc FROM temp.articles_vocab').all() as unknown as VocabTerm[]
    vocabularies.set(db, terms)
  }
  return terms
}

const STOP_WORDS = new Set(['a', 'au', 'aux', 'avec', 'd', 'de', 'des', 'du', 'en', 'et', 'l', 'la', 'le', 'les', 'pour', 'sur', 'un', 'une'])

const plain = (w: string) => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// Mots cherchés, au singulier (« bureaux » → « bureau », « tables » → « table »).
export function searchWords(text: string): string[] {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).map(plain)
  const useful = words.filter((w) => !STOP_WORDS.has(w))
  return (useful.length ? useful : words).map((w) => (w.length > 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w))
}

// Distance entre deux mots (lettre en trop, en moins, changée ou inversée), abandonnée au-delà de max.
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1)
      row.push(d)
      best = Math.min(best, d)
    }
    if (best > max) return max + 1
    prev2 = prev
    prev = row
  }
  return prev[b.length]
}

const MAX_VARIANTS = 20

// Mots de l'index proches d'un mot cherché. S'il n'existe pas tel quel, c'est sans doute une faute de frappe :
// on prend tous les mots proches. S'il existe, on ajoute seulement les mots proches beaucoup plus rares,
// qui sont sans doute des fautes dans les fiches (« tabel » pour « table »), pas d'autres mots (« poste » pour « porte »).
function variants(word: string, vocab: VocabTerm[]): string[] {
  if (word.length < 4 || /\d/.test(word)) return []
  const max = word.length >= 9 ? 2 : 1
  const exact = vocab.filter((t) => t.term.startsWith(word)).reduce((n, t) => n + t.doc, 0)
  const found: { term: string; d: number; doc: number }[] = []
  for (const t of vocab) {
    if (t.term.startsWith(word) || t.term.length < 4) continue
    if (exact > 0 && (t.term[0] !== word[0] || t.doc * 3 > exact)) continue
    let d = editDistance(word, t.term, max)
    // Mot tapé à moitié avec une faute : on le compare au début des mots de l'index.
    if (d > max && !exact && t.term.length > word.length) d = editDistance(word, t.term.slice(0, word.length), max)
    if (d <= max) found.push({ term: t.term, d, doc: t.doc })
  }
  found.sort((a, b) => a.d - b.d || b.doc - a.doc)
  // Faute de frappe : on garde les corrections les plus probables (« chaisse » → « chaise », pas « caisse »).
  if (!exact && found.length) {
    const best = found[0]
    return found.filter((f) => f.d === best.d && f.doc * 10 >= best.doc).slice(0, MAX_VARIANTS).map((f) => f.term)
  }
  return found.slice(0, MAX_VARIANTS).map((f) => f.term)
}

// « Fauteuil chêne » -> "fauteuil"* AND "chene"* : chaque mot doit apparaître, en début de mot ;
// avec le vocabulaire de l'index, chaque mot accepte aussi ses variantes proches.
export function ftsQuery(text: string, vocab: VocabTerm[] = []): string | null {
  const words = searchWords(text)
  if (!words.length) return null
  return words
    .map((w) => {
      const others = variants(w, vocab)
      return others.length ? `("${w}"* OR ${others.map((t) => `"${t}"`).join(' OR ')})` : `"${w}"*`
    })
    .join(' AND ')
}

// --- Filtres ------------------------------------------------------------------------------------

interface Where {
  sql: string
  params: SQLInputValue[]
}

function where(fts: string | null, filters: ArticleFilters, ignore?: 'category' | 'supplier'): Where {
  const clauses = ['a.deleted_at IS NULL']
  const params: SQLInputValue[] = []
  if (fts) {
    clauses.push('a.id IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?)')
    params.push(fts)
  }
  if (ignore !== 'category') {
    if (filters.categoryId) {
      clauses.push('a.category_id = ?')
      params.push(filters.categoryId)
    } else if (filters.familyId) {
      clauses.push('c.family_id = ?')
      params.push(filters.familyId)
    }
  }
  if (ignore !== 'supplier' && filters.supplierIds?.length) {
    clauses.push(`a.supplier_id IN (${filters.supplierIds.map(() => '?').join(', ')})`)
    params.push(...filters.supplierIds)
  }
  if (filters.priceMinCents !== undefined) {
    clauses.push('a.price_cents >= ?')
    params.push(filters.priceMinCents)
  }
  if (filters.priceMaxCents !== undefined) {
    clauses.push('a.price_cents <= ?')
    params.push(filters.priceMaxCents)
  }
  return { sql: clauses.join(' AND '), params }
}

const FROM = `
  FROM articles a
  LEFT JOIN categories c ON c.id = a.category_id
  LEFT JOIN families f ON f.id = c.family_id
  LEFT JOIN suppliers s ON s.id = a.supplier_id`

const ORDER: Record<Exclude<ArticleSort, 'relevance'>, string> = {
  // Comme un catalogue : familles dans l'ordre, sous-catégories par nom, puis l'ordre de la shopping list.
  category: 'f.sort IS NULL, f.sort, sans_accents(c.name), a.id',
  recent: 'a.created_at DESC, a.id DESC',
  price_asc: 'a.price_cents IS NULL, a.price_cents ASC, a.id',
  price_desc: 'a.price_cents IS NULL, a.price_cents DESC, a.id',
  name: 'sans_accents(a.name), a.id'
}

// --- Lecture ------------------------------------------------------------------------------------

export function toCard(r: Row): ArticleCard {
  return {
    id: r.id as number,
    name: r.name as string,
    price: { cents: r.price_cents as number | null, kind: r.price_kind as PriceKind, text: r.price_text as string | null },
    supplier: r.supplier as string | null,
    thumbnailUrl: r.sha ? thumbnailUrl(r.sha as string) : null,
    description: (r.description as string | null) ?? null
  }
}

export const CARD_COLUMNS = `
  a.id, a.name, a.price_cents, a.price_kind, a.price_text, a.description, s.name AS supplier,
  (SELECT i.sha256 FROM article_images ai JOIN images i ON i.id = ai.image_id
    WHERE ai.article_id = a.id ORDER BY ai.sort LIMIT 1) AS sha`

export function searchArticles(db: DatabaseSync, q: ArticleQuery): ArticlePage {
  const fts = ftsQuery(q.text, vocabulary(db))
  const w = where(fts, q.filters)
  const total = (db.prepare(`SELECT count(*) AS n ${FROM} WHERE ${w.sql}`).get(...w.params) as { n: number }).n

  let sql: string
  let params: SQLInputValue[]
  if (q.sort === 'relevance' && fts) {
    // bm25 : le nom compte le plus, puis le fournisseur et la catégorie.
    sql = `SELECT ${CARD_COLUMNS} ${FROM}
      JOIN (SELECT rowid AS id, bm25(articles_fts, 10.0, 3.0, 3.0, 1.0) AS score
            FROM articles_fts WHERE articles_fts MATCH ?) m ON m.id = a.id
      WHERE ${w.sql} ORDER BY m.score, a.id LIMIT ? OFFSET ?`
    params = [fts, ...w.params, q.limit, q.offset]
  } else {
    const order = ORDER[q.sort === 'relevance' ? 'category' : q.sort]
    sql = `SELECT ${CARD_COLUMNS} ${FROM} WHERE ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`
    params = [...w.params, q.limit, q.offset]
  }
  const items = (db.prepare(sql).all(...params) as Row[]).map(toCard)
  return { items, total }
}

// Comptes affichés à côté de chaque filtre, calculés sans le filtre lui-même (comme sur un site marchand).
export function articleFacets(db: DatabaseSync, text: string, filters: ArticleFilters): ArticleFacets {
  const fts = ftsQuery(text, vocabulary(db))
  const wc = where(fts, filters, 'category')
  const rows = db
    .prepare(
      `SELECT f.id AS fid, f.name AS fname, c.id AS cid, c.name AS cname, count(*) AS n
       ${FROM}
       WHERE ${wc.sql} AND c.id IS NOT NULL GROUP BY c.id ORDER BY f.sort, sans_accents(c.name)`
    )
    .all(...wc.params) as Row[]
  const families: FamilyFacet[] = []
  for (const r of rows) {
    let fam = families.at(-1)
    if (!fam || fam.id !== r.fid) {
      fam = { id: r.fid as number, name: r.fname as string, count: 0, categories: [] }
      families.push(fam)
    }
    fam.count += r.n as number
    fam.categories.push({ id: r.cid as number, name: r.cname as string, count: r.n as number })
  }

  const ws = where(fts, filters, 'supplier')
  const suppliers = (
    db
      .prepare(
        `SELECT s.id, s.name, count(*) AS n ${FROM}
         WHERE ${ws.sql} AND s.id IS NOT NULL GROUP BY s.id ORDER BY n DESC, sans_accents(s.name)`
      )
      .all(...ws.params) as Row[]
  ).map((r) => ({ id: r.id as number, name: r.name as string, count: r.n as number }))

  return { families, suppliers }
}

export function getArticle(db: DatabaseSync, id: number): ArticleDetail | null {
  const r = db
    .prepare(
      `SELECT ${CARD_COLUMNS}, a.url, a.dimensions, a.color_material, a.private_note, a.link_status,
              c.name AS category, f.name AS family
       ${FROM}
       WHERE a.id = ? AND a.deleted_at IS NULL`
    )
    .get(id) as Row | undefined
  if (!r) return null
  const images = db
    .prepare(
      `SELECT i.rel_path FROM article_images ai JOIN images i ON i.id = ai.image_id
       WHERE ai.article_id = ? ORDER BY ai.sort`
    )
    .all(id) as { rel_path: string }[]
  const tags = db
    .prepare('SELECT t.name FROM article_tags at JOIN tags t ON t.id = at.tag_id WHERE at.article_id = ? ORDER BY t.name')
    .all(id) as { name: string }[]
  return {
    ...toCard(r),
    family: r.family as string | null,
    category: r.category as string | null,
    url: r.url as string | null,
    dimensions: r.dimensions as string | null,
    colorMaterial: r.color_material as string | null,
    privateNote: r.private_note as string | null,
    linkStatus: r.link_status as LinkStatus,
    imageUrls: images.map((i) => mediaUrl(i.rel_path)),
    tags: tags.map((t) => t.name)
  }
}
