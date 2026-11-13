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
  articleIds?: number[] // annulation qui porte sur plusieurs articles
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
    this.entries = this.entries.filter((e) => !gone.has(e.articleId) && !e.articleIds?.some((id) => gone.has(id)))
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
    description: (r.description as string | null) ?? '',
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
    text(input.privateNote),
    text(input.description ?? '')
  ]
  let id = input.id
  if (id === null) {
    id = Number(
      db
        .prepare(
          `INSERT INTO articles (name, category_id, supplier_id, price_cents, price_kind, url, url_clean,
             dimensions, color_material, private_note, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(...values).lastInsertRowid
    )
  } else {
    const before = db.prepare('SELECT price_cents FROM articles WHERE id = ?').get(id) as { price_cents: number | null }
    db.prepare(
      `UPDATE articles SET name = ?, category_id = ?, supplier_id = ?, price_cents = ?, price_kind = ?, url = ?,
         url_clean = ?, dimensions = ?, color_material = ?, private_note = ?, description = ?, price_text = NULL, updated_at = ?,
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
  const previousImages = (db.prepare('SELECT image_id FROM article_images WHERE article_id = ?').all(id) as { image_id: number }[]).map((r) => r.image_id)
  db.prepare('DELETE FROM article_images WHERE article_id = ?').run(id)
  input.images.forEach((img, sort) =>
    db.prepare('INSERT OR IGNORE INTO article_images (article_id, image_id, sort) VALUES (?, ?, ?)').run(id, img.id, sort)
  )
  followCrops(db, id, previousImages, input.images.map((i) => i.id))
  db.prepare('DELETE FROM article_tags WHERE article_id = ?').run(id)
  for (const tag of new Set(input.tags.map((t) => t.trim()).filter(Boolean))) {
    db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)').run(id, tagId(db, tag))
  }
  reindexArticle(db, id)
  return id
}

export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
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

// Plusieurs articles à la corbeille d'un coup (écran Vérification) : un seul ⌘Z les fait tous revenir.
export function trashArticles(db: DatabaseSync, ids: number[], undo: UndoStack): void {
  const live = ids.filter((id) => db.prepare('SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL').get(id))
  if (!live.length) return
  if (live.length === 1) return trashArticle(db, live[0], undo)
  const at = now()
  inTransaction(db, () => live.forEach((id) => setDeleted(db, id, at)))
  undo.push({
    label: `${live.length} articles sont revenus dans la shopping list`,
    articleId: live[0],
    articleIds: live,
    undo: () => inTransaction(db, () => live.forEach((id) => setDeleted(db, id, null)))
  })
}

// Combien de ces articles sont proposés dans un projet (ils y restent même à la corbeille).
export function countInProjects(db: DatabaseSync, ids: number[]): number {
  if (!ids.length) return 0
  const list = ids.filter(Number.isInteger).join(', ')
  return (db.prepare(`SELECT count(DISTINCT article_id) AS n FROM need_articles WHERE article_id IN (${list})`).get() as { n: number }).n
}

// Lignes d'une table (colonnes lues en base), pour les remettre telles quelles à l'annulation.
function reinsert(db: DatabaseSync, table: string, rows: Row[]): void {
  for (const r of rows) {
    const cols = Object.keys(r)
    db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...(cols.map((c) => r[c]) as never[]))
  }
}

// Retire ces articles de tous les projets (écran Vérification) : un « Mon choix » retiré laisse la place
// à la première proposition ; un besoin resté vide disparaît ; les repères sur les plans 3D aussi.
// Un seul ⌘Z remet tout. Renvoie le nombre de projets touchés.
export function removeFromProjects(db: DatabaseSync, ids: number[], undo: UndoStack): number {
  const list = ids.filter(Number.isInteger)
  if (!list.length) return 0
  const inList = `(${list.join(', ')})`
  const needIds = (db.prepare(`SELECT DISTINCT need_id FROM need_articles WHERE article_id IN ${inList}`).all() as { need_id: number }[]).map((r) => r.need_id)
  const markers = db.prepare(`SELECT * FROM render_markers WHERE article_id IN ${inList}`).all() as Row[]
  if (!needIds.length && !markers.length) return 0
  const needList = `(${needIds.join(', ') || 'NULL'})`
  const before = {
    needs: db.prepare(`SELECT * FROM needs WHERE id IN ${needList}`).all() as Row[],
    articles: db.prepare(`SELECT * FROM need_articles WHERE need_id IN ${needList}`).all() as Row[],
    images: db.prepare(`SELECT * FROM need_images WHERE need_id IN ${needList}`).all() as Row[]
  }
  const projects = new Set([
    ...before.needs.map((n) => n.project_id as number),
    ...(db.prepare(`SELECT DISTINCT r.project_id FROM render_markers m JOIN renders r ON r.id = m.render_id WHERE m.article_id IN ${inList}`).all() as { project_id: number }[]).map((r) => r.project_id)
  ])
  inTransaction(db, () => {
    db.prepare(`DELETE FROM render_markers WHERE article_id IN ${inList}`).run()
    for (const needId of needIds) {
      const lostChoice = db.prepare(`SELECT 1 FROM need_articles WHERE need_id = ? AND role = 'choice' AND article_id IN ${inList}`).get(needId)
      db.prepare(`DELETE FROM need_articles WHERE need_id = ? AND article_id IN ${inList}`).run(needId)
      const rest = db.prepare('SELECT article_id FROM need_articles WHERE need_id = ? ORDER BY role = \'choice\' DESC, sort').all(needId) as { article_id: number }[]
      if (!rest.length) {
        db.prepare('DELETE FROM needs WHERE id = ?').run(needId)
      } else if (lostChoice) {
        db.prepare("UPDATE need_articles SET role = 'choice' WHERE need_id = ? AND article_id = ?").run(needId, rest[0].article_id)
        db.prepare('DELETE FROM need_images WHERE need_id = ?').run(needId)
      }
    }
    const at = now()
    for (const id of projects) db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(at, id)
  })
  undo.push({
    label: list.length === 1 ? 'L’article est revenu dans ses projets' : `${list.length} articles sont revenus dans leurs projets`,
    articleId: list[0],
    articleIds: list,
    undo: () =>
      inTransaction(db, () => {
        db.prepare(`DELETE FROM need_articles WHERE need_id IN ${needList}`).run()
        db.prepare(`DELETE FROM need_images WHERE need_id IN ${needList}`).run()
        reinsert(db, 'needs', before.needs)
        reinsert(db, 'need_articles', before.articles)
        reinsert(db, 'need_images', before.images)
        reinsert(db, 'render_markers', markers)
      })
  })
  return projects.size
}

// Vérifié à la main (écran Vérification) : le lien existe bien, ou le prix est le bon. L'article ne revient
// plus dans « Liens à vérifier à la main » ni dans « Prix à revoir ». Un seul ⌘Z pour tous.
export function markVerified(db: DatabaseSync, ids: number[], what: 'link' | 'price', undo: UndoStack): void {
  const list = ids.filter(Number.isInteger)
  if (!list.length) return
  const before = db.prepare(`SELECT id, link_status, link_checked_at, link_manual_at, updated_at FROM articles WHERE id IN (${list.join(', ')})`).all() as Row[]
  const at = now()
  inTransaction(db, () => {
    for (const id of list) {
      if (what === 'link') db.prepare("UPDATE articles SET link_status = 'ok', link_checked_at = ?, link_manual_at = ? WHERE id = ?").run(at, at, id)
      else db.prepare("UPDATE articles SET updated_at = ?, link_status = CASE WHEN link_status = 'gone' THEN link_status ELSE 'ok' END, link_manual_at = ? WHERE id = ?").run(at, at, id)
    }
  })
  undo.push({
    label: list.length === 1 ? 'Vérification annulée' : `Vérification de ${list.length} articles annulée`,
    articleId: list[0],
    articleIds: list,
    undo: () =>
      inTransaction(db, () => {
        for (const r of before) {
          db.prepare('UPDATE articles SET link_status = ?, link_checked_at = ?, link_manual_at = ?, updated_at = ? WHERE id = ?').run(
            r.link_status as string,
            r.link_checked_at as string | null,
            r.link_manual_at as string | null,
            r.updated_at as string,
            r.id as number
          )
        }
      })
  })
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
    (db.prepare('SELECT article_id AS id FROM need_articles UNION SELECT article_id FROM render_markers').all() as { id: number }[]).map((r) => r.id)
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

// Une photo rognée remplace l'ancienne dans la fiche : les photos retenues pour « Mon choix » la suivent.
function followCrops(db: DatabaseSync, articleId: number, before: number[], after: number[]): void {
  const rootOf = (id: number) => (db.prepare('SELECT coalesce(crop_of, id) AS r FROM images WHERE id = ?').get(id) as { r: number } | undefined)?.r
  for (const old of before.filter((id) => !after.includes(id))) {
    const next = after.find((id) => !before.includes(id) && rootOf(id) === rootOf(old))
    if (next === undefined) continue
    db.prepare(
      `UPDATE OR IGNORE need_images SET image_id = ? WHERE image_id = ?
         AND need_id IN (SELECT need_id FROM need_articles WHERE article_id = ? AND role = 'choice')`
    ).run(next, old, articleId)
  }
}

// Supprime les photos que plus rien n'utilise (fichier, miniature et ligne).
// Toute nouvelle table qui référence images doit être ajoutée ici. Une image d'origine reste tant qu'une
// image rognée à partir d'elle est utilisée : on recommence donc jusqu'à ce qu'il n'y ait plus rien à supprimer.
export function purgeOrphanImages(db: DatabaseSync, dataRoot: string): number {
  let total = 0
  for (let n = purgeOnce(db, dataRoot); n > 0; n = purgeOnce(db, dataRoot)) total += n
  return total
}

function purgeOnce(db: DatabaseSync, dataRoot: string): number {
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
         AND NOT EXISTS (SELECT 1 FROM book_notes x WHERE x.image_id = i.id)
         AND NOT EXISTS (SELECT 1 FROM chat_messages x, json_each(x.images) j WHERE j.value = i.id)
         AND NOT EXISTS (SELECT 1 FROM images x WHERE x.crop_of = i.id)
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
