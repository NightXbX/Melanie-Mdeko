import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ArticleCard, ArticleInput, EditableImage, EditorChoices, ImageUpload } from '@shared/api'
import { cleanUrl } from '@shared/url'
import { CARD_COLUMNS, reindexArticle, toCard } from './articles'
import { mediaUrl, thumbnailPath } from './media-urls'

type Row = Record<string, unknown>

const IMAGE_EXTENSIONS = new Set(['jpg', 'png', 'webp', 'gif', 'avif'])
const MAX_IMAGE_BYTES = 40 * 1024 * 1024

export interface UndoEntry {
  label: string
  articleId: number
  undo(): void
}

// Pile d'annulation en mémoire (⌘Z) : chaque modification sait se défaire.
export class UndoStack {
  private entries: UndoEntry[] = []

  push(entry: UndoEntry): void {
    this.entries.push(entry)
    if (this.entries.length > 50) this.entries.shift()
  }

  pop(): UndoEntry | undefined {
    return this.entries.pop()
  }

  // Après une suppression définitive, ces articles ne peuvent plus être annulés.
  forget(articleIds: number[]): void {
    const gone = new Set(articleIds)
    this.entries = this.entries.filter((e) => !gone.has(e.articleId))
  }
}

const now = () => new Date().toISOString()

export function editorChoices(db: DatabaseSync): EditorChoices {
  const rows = db
    .prepare(
      `SELECT f.id AS fid, f.name AS fname, c.id AS cid, c.name AS cname
       FROM families f LEFT JOIN categories c ON c.family_id = f.id
       ORDER BY f.sort, sans_accents(c.name)`
    )
    .all() as Row[]
  const categories: EditorChoices['categories'] = []
  for (const r of rows) {
    let fam = categories.at(-1)
    if (!fam || fam.id !== r.fid) {
      fam = { id: r.fid as number, name: r.fname as string, categories: [] }
      categories.push(fam)
    }
    if (r.cid) fam.categories.push({ id: r.cid as number, name: r.cname as string })
  }
  const names = (sql: string) => (db.prepare(sql).all() as { name: string }[]).map((r) => r.name)
  return {
    categories,
    suppliers: names('SELECT name FROM suppliers ORDER BY sans_accents(name)'),
    tags: names('SELECT name FROM tags ORDER BY sans_accents(name)')
  }
}

export function getArticleInput(db: DatabaseSync, id: number): ArticleInput | null {
  const r = db
    .prepare(
      `SELECT a.*, s.name AS supplier FROM articles a LEFT JOIN suppliers s ON s.id = a.supplier_id
       WHERE a.id = ? AND a.deleted_at IS NULL`
    )
    .get(id) as Row | undefined
  if (!r) return null
  const images = db
    .prepare(
      `SELECT i.id, i.rel_path FROM article_images ai JOIN images i ON i.id = ai.image_id
       WHERE ai.article_id = ? ORDER BY ai.sort`
    )
    .all(id) as { id: number; rel_path: string }[]
  const tags = db
    .prepare('SELECT t.name FROM article_tags at JOIN tags t ON t.id = at.tag_id WHERE at.article_id = ? ORDER BY t.name')
    .all(id) as { name: string }[]
  return {
    id,
    name: r.name as string,
    priceCents: r.price_cents as number | null,
    priceKind: r.price_kind === 'unknown' ? 'fixed' : (r.price_kind as ArticleInput['priceKind']),
    supplier: (r.supplier as string | null) ?? '',
    url: (r.url as string | null) ?? '',
    categoryId: r.category_id as number | null,
    dimensions: (r.dimensions as string | null) ?? '',
    colorMaterial: (r.color_material as string | null) ?? '',
    tags: tags.map((t) => t.name),
    privateNote: (r.private_note as string | null) ?? '',
    images: images.map((i) => ({ id: i.id, url: mediaUrl(i.rel_path) }))
  }
}

function supplierId(db: DatabaseSync, name: string): number | null {
  const n = name.trim()
  if (!n) return null
  const found = db.prepare('SELECT id FROM suppliers WHERE name = ?').get(n) as { id: number } | undefined
  if (found) return found.id
  return Number(db.prepare('INSERT INTO suppliers (name) VALUES (?)').run(n).lastInsertRowid)
}

function tagId(db: DatabaseSync, name: string): number {
  const found = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | undefined
  if (found) return found.id
  return Number(db.prepare('INSERT INTO tags (name) VALUES (?)').run(name).lastInsertRowid)
}

// Écrit l'article tel que saisi (création si id est null) et renvoie son identifiant.
function writeArticle(db: DatabaseSync, input: ArticleInput): number {
  const text = (v: string) => v.trim() || null
  const url = text(input.url)
  const values = [
    input.name.trim(),
    input.categoryId,
    supplierId(db, input.supplier),
    input.priceKind === 'on_quote' ? null : input.priceCents,
    input.priceKind,
    url,
    url ? cleanUrl(url) : null,
    text(input.dimensions),
    text(input.colorMaterial),
    text(input.privateNote)
  ]
  let id = input.id
  if (id === null) {
    id = Number(
      db
        .prepare(
          `INSERT INTO articles (name, category_id, supplier_id, price_cents, price_kind, url, url_clean,
             dimensions, color_material, private_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(...values).lastInsertRowid
    )
  } else {
    const before = db.prepare('SELECT price_cents FROM articles WHERE id = ?').get(id) as { price_cents: number | null }
    db.prepare(
      `UPDATE articles SET name = ?, category_id = ?, supplier_id = ?, price_cents = ?, price_kind = ?, url = ?,
         url_clean = ?, dimensions = ?, color_material = ?, private_note = ?, price_text = NULL, updated_at = ?,
         link_status = CASE WHEN url IS ? THEN link_status ELSE 'unchecked' END
       WHERE id = ?`
    ).run(...values, now(), url, id)
    if (before.price_cents !== values[3]) {
      db.prepare('INSERT INTO price_history (article_id, old_cents, new_cents, origin) VALUES (?, ?, ?, ?)').run(
        id,
        before.price_cents,
        values[3] as number | null,
        'modification'
      )
    }
  }
  db.prepare('DELETE FROM article_images WHERE article_id = ?').run(id)
  input.images.forEach((img, sort) =>
    db.prepare('INSERT OR IGNORE INTO article_images (article_id, image_id, sort) VALUES (?, ?, ?)').run(id, img.id, sort)
  )
  db.prepare('DELETE FROM article_tags WHERE article_id = ?').run(id)
  for (const tag of new Set(input.tags.map((t) => t.trim()).filter(Boolean))) {
    db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)').run(id, tagId(db, tag))
  }
  reindexArticle(db, id)
  return id
}

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function setDeleted(db: DatabaseSync, id: number, deletedAt: string | null): void {
  db.prepare('UPDATE articles SET deleted_at = ? WHERE id = ?').run(deletedAt, id)
  reindexArticle(db, id)
}

export function saveArticle(db: DatabaseSync, input: ArticleInput, undo: UndoStack): number {
  if (!input.name.trim()) throw new Error("Le nom de l'article est obligatoire.")
  const before = input.id === null ? null : getArticleInput(db, input.id)
  const id = inTransaction(db, () => writeArticle(db, input))
  undo.push(
    before
      ? {
          label: `Modification de « ${before.name} » annulée`,
          articleId: id,
          undo: () => inTransaction(db, () => writeArticle(db, before))
        }
      : {
          label: `Ajout de « ${input.name.trim()} » annulé`,
          articleId: id,
          undo: () => setDeleted(db, id, now())
        }
  )
  return id
}

export function trashArticle(db: DatabaseSync, id: number, undo: UndoStack): void {
  const name = (db.prepare('SELECT name FROM articles WHERE id = ?').get(id) as { name: string }).name
  setDeleted(db, id, now())
  undo.push({ label: `« ${name} » est revenu dans la shopping list`, articleId: id, undo: () => setDeleted(db, id, null) })
}

export function restoreArticle(db: DatabaseSync, id: number, undo: UndoStack): void {
  const r = db.prepare('SELECT name, deleted_at FROM articles WHERE id = ?').get(id) as { name: string; deleted_at: string }
  setDeleted(db, id, null)
  undo.push({ label: `« ${r.name} » est retourné à la corbeille`, articleId: id, undo: () => setDeleted(db, id, r.deleted_at) })
}

export function listTrash(db: DatabaseSync): ArticleCard[] {
  return (
    db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM articles a LEFT JOIN suppliers s ON s.id = a.supplier_id
         WHERE a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC`
      )
      .all() as Row[]
  ).map(toCard)
}

export interface EmptyTrashResult {
  deleted: number
  keptInProjects: number
}

// Suppression définitive des articles de la corbeille, sauf ceux encore utilisés dans un projet.
export function emptyTrash(db: DatabaseSync, dataRoot: string, undo: UndoStack): EmptyTrashResult {
  const trashed = db.prepare('SELECT id FROM articles WHERE deleted_at IS NOT NULL').all() as { id: number }[]
  const used = new Set(
    (db.prepare('SELECT DISTINCT article_id AS id FROM need_articles').all() as { id: number }[]).map((r) => r.id)
  )
  const ids = trashed.map((r) => r.id).filter((id) => !used.has(id))
  inTransaction(db, () => {
    for (const id of ids) {
      db.prepare('DELETE FROM articles_fts WHERE rowid = ?').run(id)
      db.prepare('DELETE FROM articles WHERE id = ?').run(id)
    }
  })
  undo.forget(ids)
  purgeOrphanImages(db, dataRoot)
  return { deleted: ids.length, keptInProjects: trashed.length - ids.length }
}

// Supprime les photos que plus rien n'utilise (fichier, miniature et ligne).
// Toute nouvelle table qui référence images doit être ajoutée ici.
export function purgeOrphanImages(db: DatabaseSync, dataRoot: string): number {
  const orphans = db
    .prepare(
      `SELECT i.id, i.rel_path, i.sha256 FROM images i
       WHERE NOT EXISTS (SELECT 1 FROM article_images x WHERE x.image_id = i.id)
         AND NOT EXISTS (SELECT 1 FROM inspiration_images x WHERE x.image_id = i.id)
         AND NOT EXISTS (SELECT 1 FROM renders x WHERE x.image_id = i.id OR x.inset_image_id = i.id)
         AND NOT EXISTS (SELECT 1 FROM render_versions x WHERE x.image_id = i.id)
         AND NOT EXISTS (SELECT 1 FROM free_page_images x WHERE x.image_id = i.id)
         AND NOT EXISTS (SELECT 1 FROM paints x WHERE x.image_id = i.id)
         AND NOT EXISTS (SELECT 1 FROM need_images x WHERE x.image_id = i.id)
         AND NOT EXISTS (SELECT 1 FROM project_trend_images x WHERE x.image_id = i.id)
         AND i.id NOT IN (SELECT CAST(value AS INTEGER) FROM settings WHERE key LIKE '%image_id')`
    )
    .all() as { id: number; rel_path: string; sha256: string | null }[]
  for (const img of orphans) {
    db.prepare('DELETE FROM images WHERE id = ?').run(img.id)
    rmSync(join(dataRoot, img.rel_path), { force: true })
    if (img.sha256) rmSync(thumbnailPath(dataRoot, img.sha256), { force: true })
  }
  return orphans.length
}

// Enregistre une photo dans le dossier de données (une seule copie par contenu) et sa miniature.
export function uploadImage(db: DatabaseSync, dataRoot: string, image: ImageUpload): EditableImage {
  const ext = image.ext.toLowerCase().replace('jpeg', 'jpg')
  if (!IMAGE_EXTENSIONS.has(ext)) throw new Error("Ce format de photo n'est pas pris en charge.")
  if (image.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Cette photo est trop lourde (plus de 40 Mo).')
  const sha = createHash('sha256').update(image.bytes).digest('hex')
  const existing = db.prepare('SELECT id, rel_path FROM images WHERE sha256 = ?').get(sha) as
    | { id: number; rel_path: string }
    | undefined
  if (existing) return { id: existing.id, url: mediaUrl(existing.rel_path) }

  const rel = `images/articles/${sha.slice(0, 2)}/${sha}.${ext}`
  const file = join(dataRoot, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, image.bytes)
  const thumb = thumbnailPath(dataRoot, sha)
  if (!existsSync(thumb)) {
    mkdirSync(dirname(thumb), { recursive: true })
    writeFileSync(thumb, image.thumbnail)
  }
  const id = Number(
    db
      .prepare('INSERT INTO images (rel_path, width, height, sha256) VALUES (?, ?, ?, ?)')
      .run(rel, image.width, image.height, sha).lastInsertRowid
  )
  return { id, url: mediaUrl(rel) }
}
