import type { DatabaseSync } from 'node:sqlite'
import type { ArticleCard } from '@shared/api'
import type {
  Artisan,
  DesignerSettings,
  Paint,
  Project,
  ProjectNeed,
  ProjectPatch,
  ProjectRender,
  ProjectSummary,
  RenderSection
} from '@shared/projects'
import { CARD_COLUMNS, toCard } from './articles'
import { mediaUrl, thumbnailUrl } from './media-urls'

type Row = Record<string, unknown>

const now = () => new Date().toISOString()
const touch = (db: DatabaseSync, projectId: number) =>
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId)

export const projectTitle = (title: string | null, name: string) => [title, name].filter(Boolean).join(' ')

// --- Projets --------------------------------------------------------------------------------------

export function listProjects(db: DatabaseSync): ProjectSummary[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.client_title, p.client_name, p.book_date, p.updated_at,
         (SELECT i.sha256 FROM renders r JOIN images i ON i.id = r.image_id
           WHERE r.project_id = p.id ORDER BY r.sort LIMIT 1) AS cover
       FROM projects p WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC`
    )
    .all() as Row[]
  return rows.map((r) => ({
    id: r.id as number,
    title: projectTitle(r.client_title as string | null, r.client_name as string),
    bookDate: r.book_date as string | null,
    coverUrl: r.cover ? thumbnailUrl(r.cover as string) : null,
    updatedAt: r.updated_at as string
  }))
}

export function createProject(db: DatabaseSync, clientTitle: string, clientName: string): number {
  if (!clientName.trim()) throw new Error('Le nom du client est obligatoire.')
  const month = now().slice(0, 7)
  return Number(
    db
      .prepare('INSERT INTO projects (client_title, client_name, book_date) VALUES (?, ?, ?)')
      .run(clientTitle.trim() || null, clientName.trim(), month).lastInsertRowid
  )
}

export function updateProject(db: DatabaseSync, id: number, patch: ProjectPatch): void {
  const columns: [string, unknown][] = []
  if (patch.clientTitle !== undefined) columns.push(['client_title', patch.clientTitle.trim() || null])
  if (patch.clientName !== undefined) columns.push(['client_name', patch.clientName.trim()])
  if (patch.address !== undefined) columns.push(['address', patch.address || null])
  if (patch.phone !== undefined) columns.push(['phone', patch.phone || null])
  if (patch.email !== undefined) columns.push(['email', patch.email || null])
  if (patch.bookDate !== undefined) columns.push(['book_date', patch.bookDate])
  if (patch.texts) {
    columns.push(['intro_text', patch.texts.intro], ['wishes_text', patch.texts.wishes], ['closing_text', patch.texts.closing])
  }
  if (!columns.length) return
  db.prepare(`UPDATE projects SET ${columns.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
    ...(columns.map(([, v]) => v) as (string | null)[]),
    now(),
    id
  )
}

export function setProjectDeleted(db: DatabaseSync, id: number, deleted: boolean): void {
  db.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?').run(deleted ? now() : null, id)
}

export function getProject(db: DatabaseSync, id: number): Project | null {
  const p = db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!p) return null
  const rooms = db.prepare('SELECT id, name FROM rooms WHERE project_id = ? ORDER BY sort, id').all(id) as {
    id: number
    name: string
  }[]
  const ids = (sql: string) => (db.prepare(sql).all(id) as { id: number }[]).map((r) => r.id)
  return {
    id,
    clientTitle: (p.client_title as string | null) ?? '',
    clientName: p.client_name as string,
    address: (p.address as string | null) ?? '',
    phone: (p.phone as string | null) ?? '',
    email: (p.email as string | null) ?? '',
    bookDate: p.book_date as string | null,
    rooms,
    texts: {
      intro: p.intro_text as string | null,
      wishes: p.wishes_text as string | null,
      closing: p.closing_text as string | null
    },
    renders: getRenders(db, id),
    needs: getNeeds(db, id),
    paintIds: ids('SELECT paint_id AS id FROM project_paints WHERE project_id = ? ORDER BY sort'),
    artisanIds: ids('SELECT artisan_id AS id FROM project_artisans WHERE project_id = ? ORDER BY sort')
  }
}

export function setRooms(db: DatabaseSync, projectId: number, names: string[]): void {
  db.prepare('DELETE FROM rooms WHERE project_id = ?').run(projectId)
  names
    .map((n) => n.trim())
    .filter(Boolean)
    .forEach((name, sort) => db.prepare('INSERT INTO rooms (project_id, name, sort) VALUES (?, ?, ?)').run(projectId, name, sort))
  touch(db, projectId)
}

// --- Rendus 3D ------------------------------------------------------------------------------------

function getRenders(db: DatabaseSync, projectId: number): ProjectRender[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.section, r.image_id, i.rel_path, i.sha256, ins.rel_path AS inset
       FROM renders r JOIN images i ON i.id = r.image_id LEFT JOIN images ins ON ins.id = r.inset_image_id
       WHERE r.project_id = ? ORDER BY r.sort, r.id`
    )
    .all(projectId) as Row[]
  return rows.map((r) => ({
    id: r.id as number,
    imageId: r.image_id as number,
    imageUrl: mediaUrl(r.rel_path as string),
    thumbnailUrl: thumbnailUrl(r.sha256 as string),
    insetUrl: r.inset ? mediaUrl(r.inset as string) : null,
    section: r.section as RenderSection
  }))
}

export function addRenders(db: DatabaseSync, projectId: number, imageIds: number[], section: RenderSection): void {
  const next = (db.prepare('SELECT coalesce(max(sort), -1) + 1 AS n FROM renders WHERE project_id = ?').get(projectId) as {
    n: number
  }).n
  imageIds.forEach((imageId, i) =>
    db.prepare('INSERT INTO renders (project_id, image_id, section, sort) VALUES (?, ?, ?, ?)').run(projectId, imageId, section, next + i)
  )
  touch(db, projectId)
}

export function updateRender(
  db: DatabaseSync,
  renderId: number,
  patch: { section?: RenderSection; insetImageId?: number | null }
): void {
  if (patch.section) db.prepare('UPDATE renders SET section = ? WHERE id = ?').run(patch.section, renderId)
  if (patch.insetImageId !== undefined) db.prepare('UPDATE renders SET inset_image_id = ? WHERE id = ?').run(patch.insetImageId, renderId)
}

export function removeRender(db: DatabaseSync, renderId: number): void {
  db.prepare('DELETE FROM renders WHERE id = ?').run(renderId)
}

export function reorder(db: DatabaseSync, table: 'renders' | 'needs', ids: number[]): void {
  ids.forEach((id, sort) => db.prepare(`UPDATE ${table} SET sort = ? WHERE id = ?`).run(sort, id))
}

// --- Besoins : « Mon choix » + alternatives -------------------------------------------------------

function cards(db: DatabaseSync, needId: number, role: 'choice' | 'alternative'): ArticleCard[] {
  return (
    db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM need_articles na JOIN articles a ON a.id = na.article_id
         LEFT JOIN suppliers s ON s.id = a.supplier_id
         WHERE na.need_id = ? AND na.role = ? ORDER BY na.sort`
      )
      .all(needId, role) as Row[]
  ).map(toCard)
}

function getNeeds(db: DatabaseSync, projectId: number): ProjectNeed[] {
  const rows = db
    .prepare(
      `SELECT n.id, n.label, c.name AS category FROM needs n LEFT JOIN categories c ON c.id = n.category_id
       WHERE n.project_id = ? ORDER BY n.sort, n.id`
    )
    .all(projectId) as Row[]
  return rows.map((r) => ({
    id: r.id as number,
    label: r.label as string | null,
    category: r.category as string | null,
    choice: cards(db, r.id as number, 'choice')[0] ?? null,
    alternatives: cards(db, r.id as number, 'alternative')
  }))
}

// Articles ressemblants : même sous-catégorie, prix le plus proche, avec photo de préférence.
// (La ressemblance visuelle viendra en v0.2.)
export function suggestAlternatives(db: DatabaseSync, articleId: number, count = 3, exclude: number[] = []): number[] {
  const a = db.prepare('SELECT category_id, price_cents, url_clean FROM articles WHERE id = ?').get(articleId) as Row | undefined
  if (!a?.category_id) return []
  const excluded = [articleId, ...exclude]
  const rows = db
    .prepare(
      `SELECT a.id, a.url_clean FROM articles a
       WHERE a.deleted_at IS NULL AND a.category_id = ?
         AND a.id NOT IN (${excluded.map(() => '?').join(', ')})
       ORDER BY
         EXISTS (SELECT 1 FROM article_images ai WHERE ai.article_id = a.id) DESC,
         CASE WHEN ? IS NULL OR a.price_cents IS NULL THEN 99 ELSE abs(a.price_cents - ?) * 1.0 / ? END,
         a.id`
    )
    .all(a.category_id as number, ...excluded, a.price_cents as number | null, a.price_cents as number | null, (a.price_cents as number | null) || 1) as {
    id: number
    url_clean: string | null
  }[]
  // Pas deux fois le même produit (même lien, autre couleur) ni le produit choisi lui-même.
  const seen = new Set([a.url_clean].filter(Boolean))
  const picked: number[] = []
  for (const r of rows) {
    if (r.url_clean && seen.has(r.url_clean)) continue
    if (r.url_clean) seen.add(r.url_clean)
    picked.push(r.id)
    if (picked.length === count) break
  }
  return picked
}

function setNeedArticles(db: DatabaseSync, needId: number, choiceId: number | null, alternativeIds: number[], auto: boolean): void {
  db.prepare('DELETE FROM need_articles WHERE need_id = ?').run(needId)
  if (choiceId) db.prepare("INSERT INTO need_articles (need_id, article_id, role) VALUES (?, ?, 'choice')").run(needId, choiceId)
  alternativeIds
    .filter((id) => id !== choiceId)
    .forEach((id, sort) =>
      db
        .prepare("INSERT OR IGNORE INTO need_articles (need_id, article_id, role, auto_suggested, sort) VALUES (?, ?, 'alternative', ?, ?)")
        .run(needId, id, auto ? 1 : 0, sort)
    )
}

export function addNeed(db: DatabaseSync, projectId: number, articleId: number): number {
  const cat = db.prepare('SELECT category_id FROM articles WHERE id = ?').get(articleId) as { category_id: number | null }
  const next = (db.prepare('SELECT coalesce(max(sort), -1) + 1 AS n FROM needs WHERE project_id = ?').get(projectId) as { n: number }).n
  const needId = Number(
    db.prepare('INSERT INTO needs (project_id, category_id, sort) VALUES (?, ?, ?)').run(projectId, cat.category_id, next).lastInsertRowid
  )
  setNeedArticles(db, needId, articleId, suggestAlternatives(db, articleId), true)
  touch(db, projectId)
  return needId
}

export function setNeedChoice(db: DatabaseSync, needId: number, articleId: number): void {
  const alternatives = cards(db, needId, 'alternative').map((c) => c.id)
  const previous = cards(db, needId, 'choice')[0]?.id
  // Une alternative promue « Mon choix » échange sa place avec l'ancien choix.
  const nextAlternatives = alternatives.includes(articleId)
    ? alternatives.map((id) => (id === articleId ? previous : id)).filter((id): id is number => Boolean(id))
    : suggestAlternatives(db, articleId)
  setNeedArticles(db, needId, articleId, nextAlternatives, !alternatives.includes(articleId))
  const cat = db.prepare('SELECT category_id FROM articles WHERE id = ?').get(articleId) as { category_id: number | null }
  db.prepare('UPDATE needs SET category_id = ? WHERE id = ?').run(cat.category_id, needId)
}

export function setNeedAlternatives(db: DatabaseSync, needId: number, articleIds: number[]): void {
  const choice = cards(db, needId, 'choice')[0]?.id ?? null
  setNeedArticles(db, needId, choice, articleIds, false)
}

export function removeNeed(db: DatabaseSync, needId: number): void {
  db.prepare('DELETE FROM needs WHERE id = ?').run(needId)
}

// --- Teintes, artisans ------------------------------------------------------------------------------

export function listPaints(db: DatabaseSync): Paint[] {
  return (
    db
      .prepare(
        `SELECT p.id, b.name AS brand, p.name, p.reference, p.hex, b.promo_code
         FROM paints p JOIN paint_brands b ON b.id = p.brand_id ORDER BY sans_accents(b.name), sans_accents(p.name)`
      )
      .all() as Row[]
  ).map((r) => ({
    id: r.id as number,
    brand: r.brand as string,
    name: r.name as string,
    reference: r.reference as string | null,
    hex: r.hex as string | null,
    promoCode: r.promo_code as string | null
  }))
}

export function createPaint(db: DatabaseSync, paint: Omit<Paint, 'id' | 'promoCode'>): number {
  const brand = paint.brand.trim() || 'Autre'
  const found = db.prepare('SELECT id FROM paint_brands WHERE name = ?').get(brand) as { id: number } | undefined
  const brandId = found?.id ?? Number(db.prepare('INSERT INTO paint_brands (name) VALUES (?)').run(brand).lastInsertRowid)
  return Number(
    db
      .prepare('INSERT INTO paints (brand_id, name, reference, hex) VALUES (?, ?, ?, ?)')
      .run(brandId, paint.name.trim(), paint.reference?.trim() || null, paint.hex).lastInsertRowid
  )
}

export function listArtisans(db: DatabaseSync): Artisan[] {
  return db
    .prepare('SELECT id, trade, name, city, phone, email FROM artisans ORDER BY sans_accents(trade), sans_accents(name)')
    .all() as unknown as Artisan[]
}

export function saveArtisan(db: DatabaseSync, a: Omit<Artisan, 'id'> & { id: number | null }): number {
  const values = [a.trade.trim(), a.name.trim(), a.city || null, a.phone || null, a.email || null]
  if (a.id === null) {
    return Number(db.prepare('INSERT INTO artisans (trade, name, city, phone, email) VALUES (?, ?, ?, ?, ?)').run(...values).lastInsertRowid)
  }
  db.prepare('UPDATE artisans SET trade = ?, name = ?, city = ?, phone = ?, email = ? WHERE id = ?').run(...values, a.id)
  return a.id
}

export function setProjectLinks(db: DatabaseSync, projectId: number, table: 'project_paints' | 'project_artisans', ids: number[]): void {
  const column = table === 'project_paints' ? 'paint_id' : 'artisan_id'
  db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId)
  ids.forEach((id, sort) => db.prepare(`INSERT INTO ${table} (project_id, ${column}, sort) VALUES (?, ?, ?)`).run(projectId, id, sort))
  touch(db, projectId)
}

// --- Réglages de Mélanie ----------------------------------------------------------------------------

const SETTING_KEYS = {
  designerName: 'designer_name',
  address: 'designer_address',
  phone: 'designer_phone',
  email: 'designer_email',
  introText: 'text_intro',
  wishesText: 'text_wishes',
  closingText: 'text_closing'
} as const

export function getSettings(db: DatabaseSync): DesignerSettings {
  const rows = new Map(
    (db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string | null }[]).map((r) => [r.key, r.value])
  )
  const qr = rows.get('review_qr_image_id')
  const qrPath = qr
    ? (db.prepare('SELECT rel_path FROM images WHERE id = ?').get(Number(qr)) as { rel_path: string } | undefined)
    : undefined
  const get = (k: keyof typeof SETTING_KEYS) => rows.get(SETTING_KEYS[k]) ?? ''
  return {
    designerName: get('designerName'),
    address: get('address'),
    phone: get('phone'),
    email: get('email'),
    reviewQrUrl: qrPath ? mediaUrl(qrPath.rel_path) : null,
    introText: get('introText'),
    wishesText: get('wishesText'),
    closingText: get('closingText')
  }
}

export function saveSettings(db: DatabaseSync, settings: Partial<Omit<DesignerSettings, 'reviewQrUrl'>> & { reviewQrImageId?: number }): void {
  const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  for (const [k, key] of Object.entries(SETTING_KEYS)) {
    const value = settings[k as keyof typeof SETTING_KEYS]
    if (value !== undefined) set.run(key, value)
  }
  if (settings.reviewQrImageId !== undefined) set.run('review_qr_image_id', String(settings.reviewQrImageId))
}

// Texte « Vos envies » du projet : celui de Mélanie, sinon le modèle avec les pièces du projet.
export function wishesText(project: Project, settings: DesignerSettings): string {
  if (project.texts.wishes !== null) return project.texts.wishes
  const names = project.rooms.map((r) => r.name.toLowerCase())
  const pieces = names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : (names[0] ?? '')
  return settings.wishesText.replaceAll('{pieces}', pieces)
}
