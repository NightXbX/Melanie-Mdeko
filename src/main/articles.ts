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
         concat_ws(' ', a.dimensions, a.color_material, a.private_note,
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
}

// « Fauteuil chêne » -> "fauteuil"* "chene"* : chaque mot doit apparaître, en début de mot.
export function ftsQuery(text: string): string | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return words.length ? words.map((w) => `"${w}"*`).join(' ') : null
}

// --- Filtres ------------------------------------------------------------------------------------

interface Where {
  sql: string
  params: SQLInputValue[]
}

function where(text: string, filters: ArticleFilters, ignore?: 'category' | 'supplier'): Where {
  const clauses = ['a.deleted_at IS NULL']
  const params: SQLInputValue[] = []
  const fts = ftsQuery(text)
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

function toCard(r: Row): ArticleCard {
  return {
    id: r.id as number,
    name: r.name as string,
    price: { cents: r.price_cents as number | null, kind: r.price_kind as PriceKind, text: r.price_text as string | null },
    supplier: r.supplier as string | null,
    thumbnailUrl: r.sha ? thumbnailUrl(r.sha as string) : null
  }
}

const CARD_COLUMNS = `
  a.id, a.name, a.price_cents, a.price_kind, a.price_text, s.name AS supplier,
  (SELECT i.sha256 FROM article_images ai JOIN images i ON i.id = ai.image_id
    WHERE ai.article_id = a.id ORDER BY ai.sort LIMIT 1) AS sha`

export function searchArticles(db: DatabaseSync, q: ArticleQuery): ArticlePage {
  const w = where(q.text, q.filters)
  const total = (db.prepare(`SELECT count(*) AS n ${FROM} WHERE ${w.sql}`).get(...w.params) as { n: number }).n

  const fts = ftsQuery(q.text)
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
  const wc = where(text, filters, 'category')
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

  const ws = where(text, filters, 'supplier')
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
