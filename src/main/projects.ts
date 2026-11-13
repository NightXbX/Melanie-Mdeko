import type { DatabaseSync } from 'node:sqlite'
import { cleanMarkdown } from '@shared/markdown'
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
import { DEFAULT_MAIL_BODY, DEFAULT_MAIL_SUBJECT, DEFAULT_PAINT_BRAND, QUOTE_HIDDEN_PAGES, type DocumentKind } from '@shared/projects'
import { cleanStyle, OBJECT_KINDS, type BookAdjustment, type DeletedNote, type ObjectKind, type ObjectStyle } from '@shared/book'
import { FULL, movePoint } from '@shared/crop'
import { inTransaction } from './article-edit'
import { CARD_COLUMNS, toCard } from './articles'
import { cropInfo } from './crop'
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
      `SELECT p.id, p.client_title, p.client_name, p.book_date, p.updated_at, p.kind,
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
    updatedAt: r.updated_at as string,
    kind: r.kind as DocumentKind
  }))
}

// Un devis montre l'adresse du client en couverture et commence sans sommaire ni pages de présentation.
export function createProject(db: DatabaseSync, clientTitle: string, clientName: string, kind: DocumentKind = 'book'): number {
  if (!clientName.trim()) throw new Error('Le nom du client est obligatoire.')
  const month = now().slice(0, 7)
  const id = Number(
    db
      .prepare('INSERT INTO projects (client_title, client_name, book_date, kind, cover_address) VALUES (?, ?, ?, ?, ?)')
      .run(clientTitle.trim() || null, clientName.trim(), month, kind, kind === 'quote' ? 1 : 0).lastInsertRowid
  )
  if (kind === 'quote') for (const key of QUOTE_HIDDEN_PAGES) setPageHidden(db, id, key, true)
  return id
}

export function updateProject(db: DatabaseSync, id: number, patch: ProjectPatch): void {
  const columns: [string, unknown][] = []
  if (patch.clientTitle !== undefined) columns.push(['client_title', patch.clientTitle.trim() || null])
  if (patch.clientName !== undefined) columns.push(['client_name', patch.clientName.trim()])
  if (patch.address !== undefined) columns.push(['address', patch.address || null])
  if (patch.phone !== undefined) columns.push(['phone', patch.phone || null])
  if (patch.email !== undefined) columns.push(['email', patch.email || null])
  if (patch.bookDate !== undefined) columns.push(['book_date', patch.bookDate])
  if (patch.showPrices !== undefined) columns.push(['show_prices', patch.showPrices ? 1 : 0])
  if (patch.groupSingleChoices !== undefined) columns.push(['group_single_choices', patch.groupSingleChoices ? 1 : 0])
  if (patch.coverAddress !== undefined) columns.push(['cover_address', patch.coverAddress ? 1 : 0])
  if (patch.kind !== undefined) {
    // Passer en devis retire les pages de présentation ; revenir au design book les remet.
    columns.push(['kind', patch.kind])
    for (const key of QUOTE_HIDDEN_PAGES) setPageHidden(db, id, key, patch.kind === 'quote')
  }
  if (patch.report !== undefined) columns.push(['report_text', patch.report.replace(/\r\n?/g, '\n') || null])
  if (patch.texts) {
    columns.push(['intro_text', patch.texts.intro], ['wishes_text', patch.texts.wishes], ['closing_text', patch.texts.closing])
  }
  if (!columns.length) return
  db.prepare(`UPDATE projects SET ${columns.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
    ...(columns.map(([, v]) => v) as (string | number | null)[]),
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
    report: (p.report_text as string | null) ?? '',
    renders: getRenders(db, id),
    needs: getNeeds(db, id),
    paintIds: ids('SELECT paint_id AS id FROM project_paints WHERE project_id = ? ORDER BY sort'),
    artisanIds: ids('SELECT artisan_id AS id FROM project_artisans WHERE project_id = ? ORDER BY sort'),
    showPrices: p.show_prices !== 0,
    groupSingleChoices: p.group_single_choices === 1,
    kind: p.kind as DocumentKind,
    coverAddress: p.cover_address === 1,
    trendImages: (
      db
        .prepare('SELECT i.id, i.rel_path FROM project_trend_images t JOIN images i ON i.id = t.image_id WHERE t.project_id = ? ORDER BY t.sort')
        .all(id) as { id: number; rel_path: string }[]
    ).map((i) => ({ id: i.id, url: mediaUrl(i.rel_path) })),
    homebymeUrl: (p.homebyme_url as string | null) ?? null,
    mailedAt: (p.mailed_at as string | null) ?? null
  }
}

// Les pièces gardées conservent leur identifiant : les articles de la shopping list y restent rangés.
export function setRooms(db: DatabaseSync, projectId: number, names: string[]): void {
  const existing = db.prepare('SELECT id, name FROM rooms WHERE project_id = ?').all(projectId) as { id: number; name: string }[]
  const wanted = names.map((n) => n.trim()).filter(Boolean)
  const key = (n: string) => n.toLocaleLowerCase('fr')
  for (const r of existing) if (!wanted.some((n) => key(n) === key(r.name))) db.prepare('DELETE FROM rooms WHERE id = ?').run(r.id)
  wanted.forEach((name, sort) => {
    const kept = existing.find((r) => key(r.name) === key(name))
    if (kept) db.prepare('UPDATE rooms SET name = ?, sort = ? WHERE id = ?').run(name, sort, kept.id)
    else db.prepare('INSERT INTO rooms (project_id, name, sort) VALUES (?, ?, ?)').run(projectId, name, sort)
  })
  touch(db, projectId)
}

// --- Rendus 3D -----------------------------------------------------------------------------------

// Image montrée : la version retouchée gardée, sinon l'original.
function getRenders(db: DatabaseSync, projectId: number): ProjectRender[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.section, r.caption, i.id AS image_id, i.rel_path, i.sha256, ins.rel_path AS inset, r.inset_image_id, v.id AS version
       FROM renders r LEFT JOIN render_versions v ON v.id = r.active_version_id
       JOIN images i ON i.id = coalesce(v.image_id, r.image_id) LEFT JOIN images ins ON ins.id = r.inset_image_id
       WHERE r.project_id = ? ORDER BY r.sort, r.id`
    )
    .all(projectId) as Row[]
  const markers = db
    .prepare(
      `SELECT m.id AS marker_id, m.render_id, m.x, m.y, ${CARD_COLUMNS}
       FROM render_markers m JOIN renders r ON r.id = m.render_id JOIN articles a ON a.id = m.article_id
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       WHERE r.project_id = ? AND m.x BETWEEN 0 AND 1 AND m.y BETWEEN 0 AND 1 ORDER BY m.id`
    )
    .all(projectId) as Row[]
  return rows.map((r) => ({
    id: r.id as number,
    imageId: r.image_id as number,
    imageUrl: mediaUrl(r.rel_path as string),
    thumbnailUrl: thumbnailUrl(r.sha256 as string),
    insetUrl: r.inset ? mediaUrl(r.inset as string) : null,
    insetImageId: (r.inset_image_id as number | null) ?? null,
    section: r.section as RenderSection,
    caption: r.caption as string | null,
    edited: r.version !== null,
    markers: markers
      .filter((m) => m.render_id === r.id)
      .map((m) => ({ id: m.marker_id as number, x: m.x as number, y: m.y as number, article: toCard(m) }))
  }))
}

// Nouvelle image pour un rendu (rendu HomeByMe refait) : il garde sa place, sa vignette et ses repères.
// La retouche IA portait sur l'ancienne image : on revient à la nouvelle image d'origine.
export function replaceRenderImage(db: DatabaseSync, renderId: number, imageId: number): void {
  db.prepare('UPDATE renders SET image_id = ?, active_version_id = NULL WHERE id = ?').run(imageId, renderId)
  const r = db.prepare('SELECT project_id FROM renders WHERE id = ?').get(renderId) as { project_id: number } | undefined
  if (r) touch(db, r.project_id)
}

// Rendu rogné : l'image rognée remplace l'image montrée (la version retouchée gardée, sinon l'original).
// Les repères suivent le cadre ; ceux qui en sortent sont cachés, et reviennent si on élargit le cadre.
export function cropRender(db: DatabaseSync, renderId: number, imageId: number): void {
  const r = db
    .prepare(
      `SELECT r.project_id, r.active_version_id, coalesce(v.image_id, r.image_id) AS shown
       FROM renders r LEFT JOIN render_versions v ON v.id = r.active_version_id WHERE r.id = ?`
    )
    .get(renderId) as { project_id: number; active_version_id: number | null; shown: number } | undefined
  if (!r || r.shown === imageId) return
  const from = cropInfo(db, r.shown)
  const to = cropInfo(db, imageId)
  if (from.rootId !== to.rootId) throw new Error('Cette image ne vient pas de ce rendu.')
  inTransaction(db, () => {
    if (r.active_version_id !== null) db.prepare('UPDATE render_versions SET image_id = ? WHERE id = ?').run(imageId, r.active_version_id)
    else db.prepare('UPDATE renders SET image_id = ? WHERE id = ?').run(imageId, renderId)
    const markers = db.prepare('SELECT id, x, y FROM render_markers WHERE render_id = ?').all(renderId) as { id: number; x: number; y: number }[]
    for (const m of markers) {
      const p = movePoint(m.x, m.y, from.rect ?? FULL, to.rect ?? FULL)
      db.prepare('UPDATE render_markers SET x = ?, y = ? WHERE id = ?').run(p.x, p.y, m.id)
    }
  })
  touch(db, r.project_id)
}

// Repère d'un objet sur un rendu. Un article qui n'est pas encore dans le projet y devient un nouveau choix,
// dans la pièce du rendu si on la connaît.
export function addMarker(db: DatabaseSync, renderId: number, articleId: number, x: number, y: number): number {
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const r = db.prepare('SELECT project_id, room_id FROM renders WHERE id = ?').get(renderId) as
    | { project_id: number; room_id: number | null }
    | undefined
  if (!r) throw new Error('Ce rendu n’existe plus.')
  const inProject = db
    .prepare('SELECT 1 FROM need_articles na JOIN needs n ON n.id = na.need_id WHERE n.project_id = ? AND na.article_id = ?')
    .get(r.project_id, articleId)
  if (!inProject) addNeed(db, r.project_id, articleId, r.room_id)
  const id = Number(
    db.prepare('INSERT INTO render_markers (render_id, article_id, x, y) VALUES (?, ?, ?, ?)').run(renderId, articleId, clamp(x), clamp(y))
      .lastInsertRowid
  )
  touch(db, r.project_id)
  return id
}

export function moveMarker(db: DatabaseSync, markerId: number, x: number, y: number): void {
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  db.prepare('UPDATE render_markers SET x = ?, y = ? WHERE id = ?').run(clamp(x), clamp(y), markerId)
}

// Retirer un repère ne retire pas l'article de la shopping list du projet.
export function removeMarker(db: DatabaseSync, markerId: number): void {
  db.prepare('DELETE FROM render_markers WHERE id = ?').run(markerId)
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
  patch: { section?: RenderSection; insetImageId?: number | null; caption?: string | null }
): void {
  if (patch.caption !== undefined) db.prepare('UPDATE renders SET caption = ? WHERE id = ?').run(patch.caption?.trim() || null, renderId)
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
      `SELECT n.id, n.room_id, n.label, n.quantity, c.name AS category FROM needs n LEFT JOIN categories c ON c.id = n.category_id
       WHERE n.project_id = ? ORDER BY n.sort, n.id`
    )
    .all(projectId) as Row[]
  return rows.map((r) => {
    const choice = cards(db, r.id as number, 'choice')[0] ?? null
    const choiceImages = choice
      ? (
          db
            .prepare('SELECT i.id, i.rel_path FROM article_images ai JOIN images i ON i.id = ai.image_id WHERE ai.article_id = ? ORDER BY ai.sort')
            .all(choice.id) as { id: number; rel_path: string }[]
        ).map((i) => ({ id: i.id, url: mediaUrl(i.rel_path) }))
      : []
    const bookImageIds = (db.prepare('SELECT image_id FROM need_images WHERE need_id = ? ORDER BY sort').all(r.id as number) as { image_id: number }[])
      .map((i) => i.image_id)
      .filter((id) => choiceImages.some((i) => i.id === id))
    return {
      id: r.id as number,
      roomId: r.room_id as number | null,
      label: r.label as string | null,
      category: r.category as string | null,
      choice,
      alternatives: cards(db, r.id as number, 'alternative'),
      quantity: r.quantity as number,
      choiceImages,
      bookImageIds
    }
  })
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

export function addNeed(db: DatabaseSync, projectId: number, articleId: number, roomId: number | null = null): number {
  const cat = db.prepare('SELECT category_id FROM articles WHERE id = ?').get(articleId) as { category_id: number | null }
  const next = (db.prepare('SELECT coalesce(max(sort), -1) + 1 AS n FROM needs WHERE project_id = ?').get(projectId) as { n: number }).n
  const needId = Number(
    db.prepare('INSERT INTO needs (project_id, room_id, category_id, sort) VALUES (?, ?, ?, ?)').run(projectId, roomId, cat.category_id, next).lastInsertRowid
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
  if (previous !== articleId) db.prepare('DELETE FROM need_images WHERE need_id = ?').run(needId)
  const cat = db.prepare('SELECT category_id FROM articles WHERE id = ?').get(articleId) as { category_id: number | null }
  db.prepare('UPDATE needs SET category_id = ? WHERE id = ?').run(cat.category_id, needId)
}

export function setNeedAlternatives(db: DatabaseSync, needId: number, articleIds: number[]): void {
  const choice = cards(db, needId, 'choice')[0]?.id ?? null
  setNeedArticles(db, needId, choice, articleIds, false)
}

// Photos de « Mon choix » à montrer dans le book, dans l'ordre (aucune : la première photo de l'article).
export function setNeedImages(db: DatabaseSync, needId: number, imageIds: number[]): void {
  db.prepare('DELETE FROM need_images WHERE need_id = ?').run(needId)
  imageIds.forEach((id, sort) => db.prepare('INSERT OR IGNORE INTO need_images (need_id, image_id, sort) VALUES (?, ?, ?)').run(needId, id, sort))
}

export function setNeedRoom(db: DatabaseSync, needId: number, roomId: number | null): void {
  db.prepare('UPDATE needs SET room_id = ? WHERE id = ?').run(roomId, needId)
}

export function setNeedQuantity(db: DatabaseSync, needId: number, quantity: number): void {
  db.prepare('UPDATE needs SET quantity = ? WHERE id = ?').run(Math.max(1, Math.min(999, Math.round(quantity) || 1)), needId)
}

export function removeNeed(db: DatabaseSync, needId: number): void {
  db.prepare('DELETE FROM needs WHERE id = ?').run(needId)
}

// --- Planche tendance -----------------------------------------------------------------------------

export function setTrendImages(db: DatabaseSync, projectId: number, imageIds: number[]): void {
  db.prepare('DELETE FROM project_trend_images WHERE project_id = ?').run(projectId)
  imageIds.forEach((id, sort) =>
    db.prepare('INSERT OR IGNORE INTO project_trend_images (project_id, image_id, sort) VALUES (?, ?, ?)').run(projectId, id, sort)
  )
  touch(db, projectId)
}

// Photos des inspirations (planches d'ambiance de l'ancienne shopping list), pour composer une planche tendance.
export function listInspirationImages(db: DatabaseSync): { id: number; url: string; title: string }[] {
  return (
    db
      .prepare(
        `SELECT i.id, i.sha256, i.rel_path, n.title FROM inspirations n JOIN inspiration_images ii ON ii.inspiration_id = n.id
         JOIN images i ON i.id = ii.image_id WHERE n.deleted_at IS NULL ORDER BY sans_accents(n.title), n.id, ii.sort`
      )
      .all() as { id: number; sha256: string | null; rel_path: string; title: string }[]
  ).map((r) => ({ id: r.id, url: r.sha256 ? thumbnailUrl(r.sha256) : mediaUrl(r.rel_path), title: r.title }))
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

function brandId(db: DatabaseSync, name: string): number {
  const brand = name.trim() || DEFAULT_PAINT_BRAND
  const found = db.prepare('SELECT id FROM paint_brands WHERE name = ?').get(brand) as { id: number } | undefined
  return found?.id ?? Number(db.prepare('INSERT INTO paint_brands (name) VALUES (?)').run(brand).lastInsertRowid)
}

// Code couleur écrit à la main : « #e8e2d6 », « E8E2D6 » ou « #abc ». Invalide ou vide : pas de couleur.
export function normalizeHex(hex: string | null): string | null {
  const v = hex?.trim().replace(/^#/, '') ?? ''
  if (/^[0-9a-f]{3}$/i.test(v)) return `#${[...v].map((c) => c + c).join('')}`.toUpperCase()
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v}`.toUpperCase() : null
}

export function createPaint(db: DatabaseSync, paint: Omit<Paint, 'id' | 'promoCode'>): number {
  if (!paint.name.trim()) throw new Error('Donnez un nom à la teinte.')
  return Number(
    db
      .prepare('INSERT INTO paints (brand_id, name, reference, hex) VALUES (?, ?, ?, ?)')
      .run(brandId(db, paint.brand), paint.name.trim(), paint.reference?.trim() || null, normalizeHex(paint.hex)).lastInsertRowid
  )
}

export function updatePaint(db: DatabaseSync, id: number, paint: Omit<Paint, 'id' | 'promoCode'>): void {
  if (!paint.name.trim()) throw new Error('Donnez un nom à la teinte.')
  db.prepare('UPDATE paints SET brand_id = ?, name = ?, reference = ?, hex = ? WHERE id = ?').run(
    brandId(db, paint.brand),
    paint.name.trim(),
    paint.reference?.trim() || null,
    normalizeHex(paint.hex),
    id
  )
}

// La teinte disparaît aussi des projets où elle figurait (l'interface le demande avant).
export function deletePaint(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM project_paints WHERE paint_id = ?').run(id)
  db.prepare('DELETE FROM paints WHERE id = ?').run(id)
}

export function countPaintProjects(db: DatabaseSync, id: number): number {
  return (
    db
      .prepare('SELECT count(*) AS n FROM project_paints pp JOIN projects p ON p.id = pp.project_id WHERE pp.paint_id = ? AND p.deleted_at IS NULL')
      .get(id) as { n: number }
  ).n
}

// Renommer une marque (et son code promo) ; un nom déjà pris réunit les deux marques.
export function updatePaintBrand(db: DatabaseSync, from: string, to: { name: string; promoCode: string | null }): void {
  const old = db.prepare('SELECT id, promo_code FROM paint_brands WHERE name = ?').get(from) as { id: number; promo_code: string | null } | undefined
  if (!old) return
  const name = to.name.trim() || DEFAULT_PAINT_BRAND
  const promo = to.promoCode?.trim() || null
  const target = db.prepare('SELECT id FROM paint_brands WHERE name = ? AND id <> ?').get(name, old.id) as { id: number } | undefined
  if (target) {
    db.prepare('UPDATE paints SET brand_id = ? WHERE brand_id = ?').run(target.id, old.id)
    db.prepare('UPDATE paint_brands SET promo_code = coalesce(?, promo_code) WHERE id = ?').run(promo, target.id)
    db.prepare('DELETE FROM paint_brands WHERE id = ?').run(old.id)
  } else {
    db.prepare('UPDATE paint_brands SET name = ?, promo_code = ? WHERE id = ?').run(name, promo, old.id)
  }
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
  website: 'designer_website',
  facebook: 'designer_facebook',
  instagram: 'designer_instagram',
  introText: 'text_intro',
  wishesText: 'text_wishes',
  closingText: 'text_closing',
  mailSubject: 'mail_subject',
  mailBody: 'mail_body'
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
    website: get('website'),
    facebook: get('facebook'),
    instagram: get('instagram'),
    reviewQrUrl: qrPath ? mediaUrl(qrPath.rel_path) : null,
    introText: get('introText'),
    wishesText: get('wishesText'),
    closingText: get('closingText'),
    mailSubject: get('mailSubject') || DEFAULT_MAIL_SUBJECT,
    mailBody: get('mailBody') || DEFAULT_MAIL_BODY
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

// --- Modifications faites directement dans l'aperçu du book ------------------------------------------

// Texte modifié dans l'aperçu : la clé indique ce qu'il faut mettre à jour (voir EditKey).
export function editBookText(db: DatabaseSync, projectId: number, key: string, value: string): void {
  const kind = key.slice(0, key.indexOf(':') < 0 ? key.length : key.indexOf(':'))
  const rest = key.slice(kind.length + 1)
  const id = Number(rest)
  const text = value.replace(/ /g, ' ').replace(/\s+$/, '')
  if (kind === 'text') {
    // Texte propre à ce book : « text:<page>|<élément> ».
    const [pageKey, elementId] = rest.split('|')
    adjustElement(db, projectId, pageKey, elementId, { text })
    return
  }
  if (kind === 'intro' || kind === 'wishes' || kind === 'closing') {
    const project = getProject(db, projectId)
    if (project) updateProject(db, projectId, { texts: { ...project.texts, [kind]: text } })
  } else if (kind === 'report') {
    // Morceau d'un paragraphe du compte-rendu : « report:<début>:<fin> » dans le texte nettoyé (comme le book).
    const [start, end] = rest.split(':').map(Number)
    const project = getProject(db, projectId)
    const report = project ? cleanMarkdown(project.report) : ''
    if (project && end <= report.length) {
      updateProject(db, projectId, { report: report.slice(0, start) + text.replace(/\s*\n\s*/g, ' ') + report.slice(end) })
    }
  } else if (kind === 'caption') {
    db.prepare('UPDATE renders SET caption = ? WHERE id = ? AND project_id = ?').run(text.trim() || null, id, projectId)
  } else if (kind === 'needLabel') {
    db.prepare('UPDATE needs SET label = ? WHERE id = ? AND project_id = ?').run(text.trim() || null, id, projectId)
  } else if (kind === 'note') {
    // Une annotation vidée disparaît (pas une forme, dont le texte est facultatif).
    if (text.trim()) db.prepare('UPDATE book_notes SET text = ? WHERE id = ? AND project_id = ?').run(text, id, projectId)
    else db.prepare("DELETE FROM book_notes WHERE id = ? AND project_id = ? AND kind = 'text'").run(id, projectId)
  }
  touch(db, projectId)
}

export function addNote(db: DatabaseSync, projectId: number, pageKey: string, x: number, y: number): number {
  return Number(
    db
      .prepare('INSERT INTO book_notes (project_id, page_key, x, y) VALUES (?, ?, ?, ?)')
      .run(projectId, pageKey, Math.max(0, Math.min(x, 200)), Math.max(0, Math.min(y, 195))).lastInsertRowid
  )
}

// Taille par défaut d'un objet inséré depuis la barre d'outils (mm) ; une image garde ses proportions.
const OBJECT_SIZES: Record<ObjectKind, { w: number; h: number }> = {
  text: { w: 90, h: 10 },
  image: { w: 90, h: 60 },
  rect: { w: 60, h: 40 },
  ellipse: { w: 40, h: 40 },
  line: { w: 60, h: 6 },
  arrow: { w: 60, h: 6 }
}

// Objet inséré depuis la barre d'outils de l'aperçu, au milieu de la page (ou à l'endroit donné).
export function addObject(
  db: DatabaseSync,
  projectId: number,
  pageKey: string,
  kind: ObjectKind,
  at: { x?: number; y?: number; imageId?: number; ratio?: number } = {}
): number {
  if (!OBJECT_KINDS.includes(kind)) throw new Error('Objet inconnu')
  let { w, h } = OBJECT_SIZES[kind]
  if (kind === 'image') {
    if (!at.imageId) throw new Error('Image manquante')
    const ratio = at.ratio && at.ratio > 0 ? at.ratio : 1.5
    // Grande image : la moitié de la largeur de la page, sans dépasser la hauteur.
    w = Math.min(140, 120 * ratio)
    h = w / ratio
  }
  // Au milieu de la page, décalé en escalier pour ne pas recouvrir l'objet inséré juste avant.
  const { n } = db.prepare('SELECT count(*) AS n FROM book_notes WHERE project_id = ? AND page_key = ?').get(projectId, pageKey) as { n: number }
  const shift = (n % 6) * 8
  const x = at.x ?? (297 - w) / 2 + shift
  const y = at.y ?? (210 - h) / 2 + shift
  const id = Number(
    db
      .prepare('INSERT INTO book_notes (project_id, page_key, kind, x, y, w, h, image_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(projectId, pageKey, kind, Math.max(0, Math.min(x, 280)), Math.max(0, Math.min(y, 200)), w, kind === 'text' ? null : h, at.imageId ?? null).lastInsertRowid
  )
  touch(db, projectId)
  return id
}

export function moveNote(db: DatabaseSync, noteId: number, x: number, y: number, w?: number, h?: number): void {
  db.prepare('UPDATE book_notes SET x = ?, y = ?, w = coalesce(?, w), h = coalesce(?, h) WHERE id = ?').run(
    Math.max(-280, Math.min(x, 290)),
    Math.max(-200, Math.min(y, 205)),
    w === undefined ? null : Math.max(2, Math.min(w, 400)),
    h === undefined ? null : Math.max(0.5, Math.min(h, 300)),
    noteId
  )
}

// Mise en forme d'un objet inséré (complète la précédente, ou la remplace) ; renvoie la précédente (⌘Z).
export function styleNote(db: DatabaseSync, noteId: number, patch: ObjectStyle, replace = false): ObjectStyle {
  const row = db.prepare('SELECT style FROM book_notes WHERE id = ?').get(noteId) as { style: string | null } | undefined
  if (!row) return {}
  const before = parseStyle(row.style)
  const style = cleanStyle(replace ? patch : { ...before, ...cleanStyle(patch) })
  db.prepare('UPDATE book_notes SET style = ? WHERE id = ?').run(JSON.stringify(style), noteId)
  return before
}

function parseStyle(json: unknown): ObjectStyle {
  if (typeof json !== 'string') return {}
  try {
    return cleanStyle(JSON.parse(json))
  } catch {
    return {}
  }
}

// Renvoie l'annotation supprimée, pour la remettre (⌘Z).
export function deleteNote(db: DatabaseSync, noteId: number): DeletedNote | null {
  const row = db.prepare('SELECT * FROM book_notes WHERE id = ?').get(noteId) as DeletedNote | undefined
  db.prepare('DELETE FROM book_notes WHERE id = ?').run(noteId)
  return row ?? null
}

const NOTE_COLUMNS = ['id', 'project_id', 'page_key', 'kind', 'x', 'y', 'w', 'h', 'image_id', 'style', 'text', 'created_at'] as const

export function restoreNote(db: DatabaseSync, row: DeletedNote): void {
  const values = NOTE_COLUMNS.map((c) => {
    const v = row[c]
    return typeof v === 'string' || typeof v === 'number' ? v : null
  })
  db.prepare(`INSERT OR REPLACE INTO book_notes (${NOTE_COLUMNS.join(', ')}) VALUES (${NOTE_COLUMNS.map(() => '?').join(', ')})`).run(...values)
}

export function listNotes(db: DatabaseSync, projectId: number) {
  return (db.prepare('SELECT id, page_key, kind, x, y, w, h, image_id, style, text FROM book_notes WHERE project_id = ? ORDER BY id').all(projectId) as Row[]).map((r) => ({
    id: r.id as number,
    pageKey: r.page_key as string,
    kind: (OBJECT_KINDS.includes(r.kind as ObjectKind) ? r.kind : 'text') as ObjectKind,
    x: r.x as number,
    y: r.y as number,
    w: r.w as number,
    h: (r.h as number | null) ?? null,
    imageId: (r.image_id as number | null) ?? null,
    style: parseStyle(r.style),
    text: r.text as string
  }))
}

// --- Ajustements faits dans l'aperçu : position, taille, taille du texte, texte ---------------------------

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clamp = (v: unknown, min: number, max: number) => {
  const n = finite(v)
  return n === null ? null : Math.max(min, Math.min(n, max))
}

const RESET = 'UPDATE book_adjustments SET x = NULL, y = NULL, w = NULL, h = NULL, size = NULL, style = NULL'

// Complète l'ajustement d'un élément (null : il revient à sa place et à sa taille d'origine, son texte est gardé).
// Renvoie l'ajustement d'avant (null : aucun), pour l'annuler avec restoreAdjustment (⌘Z).
export function adjustElement(db: DatabaseSync, projectId: number, pageKey: string, elementId: string, patch: BookAdjustment | null): BookAdjustment | null {
  if (!pageKey || !elementId) return null
  const where = [projectId, pageKey, elementId] as const
  const previous = db.prepare('SELECT * FROM book_adjustments WHERE project_id = ? AND page_key = ? AND element_id = ?').get(...where) as Row | undefined
  if (patch === null) {
    db.prepare(`${RESET} WHERE project_id = ? AND page_key = ? AND element_id = ?`).run(...where)
    db.prepare('DELETE FROM book_adjustments WHERE project_id = ? AND page_key = ? AND element_id = ? AND text IS NULL').run(...where)
  } else {
    const cur = (db.prepare('SELECT * FROM book_adjustments WHERE project_id = ? AND page_key = ? AND element_id = ?').get(...where) ?? {}) as Row
    const value = (k: keyof BookAdjustment) => (patch[k] !== undefined ? patch[k] : cur[k])
    const text = value('text')
    const style = patch.style ? cleanStyle({ ...parseStyle(cur.style), ...cleanStyle(patch.style) }) : parseStyle(cur.style)
    db.prepare(
      `INSERT INTO book_adjustments (project_id, page_key, element_id, x, y, w, h, size, text, style) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, page_key, element_id) DO UPDATE SET
         x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h, size = excluded.size, text = excluded.text, style = excluded.style`
    ).run(
      ...where,
      clamp(value('x'), -280, 290),
      clamp(value('y'), -200, 205),
      clamp(value('w'), 2, 400),
      clamp(value('h'), 1, 300),
      clamp(value('size'), 5, 120),
      typeof text === 'string' ? text : null,
      Object.keys(style).length ? JSON.stringify(style) : null
    )
  }
  touch(db, projectId)
  return previous ? adjustmentOf(previous) : null
}

export function restoreAdjustment(db: DatabaseSync, projectId: number, pageKey: string, elementId: string, adjustment: BookAdjustment | null): void {
  db.prepare('DELETE FROM book_adjustments WHERE project_id = ? AND page_key = ? AND element_id = ?').run(projectId, pageKey, elementId)
  if (adjustment) adjustElement(db, projectId, pageKey, elementId, adjustment)
  else touch(db, projectId)
}

function adjustmentOf(r: Row): BookAdjustment {
  const a: BookAdjustment = {}
  for (const k of ['x', 'y', 'w', 'h', 'size'] as const) {
    const v = finite(r[k])
    if (v !== null) a[k] = v
  }
  if (typeof r.text === 'string') a.text = r.text
  const style = parseStyle(r.style)
  if (Object.keys(style).length) a.style = style
  return a
}

export function listAdjustments(db: DatabaseSync, projectId: number): Record<string, BookAdjustment> {
  const out: Record<string, BookAdjustment> = {}
  for (const r of db.prepare('SELECT * FROM book_adjustments WHERE project_id = ?').all(projectId) as Row[]) {
    const a = adjustmentOf(r)
    out[`${r.page_key as string}|${r.element_id as string}`] = a
  }
  return out
}

// Toute la page revient à la mise en page d'origine (les textes écrits sont gardés).
export function resetPageAdjustments(db: DatabaseSync, projectId: number, pageKey: string): void {
  db.prepare(`${RESET} WHERE project_id = ? AND page_key = ?`).run(projectId, pageKey)
  db.prepare('DELETE FROM book_adjustments WHERE project_id = ? AND page_key = ? AND text IS NULL').run(projectId, pageKey)
  touch(db, projectId)
}

// Page retirée du book (ou remise) : ses textes et ajustements sont gardés.
export function setPageHidden(db: DatabaseSync, projectId: number, pageKey: string, hidden: boolean): void {
  if (hidden) db.prepare('INSERT OR IGNORE INTO book_hidden_pages (project_id, page_key) VALUES (?, ?)').run(projectId, pageKey)
  else db.prepare('DELETE FROM book_hidden_pages WHERE project_id = ? AND page_key = ?').run(projectId, pageKey)
  touch(db, projectId)
}

export function listHiddenPages(db: DatabaseSync, projectId: number): string[] {
  return (db.prepare('SELECT page_key FROM book_hidden_pages WHERE project_id = ?').all(projectId) as { page_key: string }[]).map((r) => r.page_key)
}

// --- Duplication ------------------------------------------------------------------------------------

// Copie complète d'un projet (pièces, rendus et leurs versions, repères, shopping list, teintes, artisans,
// planche tendance, pages libres, textes, réglages de l'aperçu) pour un autre client ou un autre document.
// Les discussions et les vocaux de l'assistant restent dans le projet d'origine. Une seule transaction.
export function duplicateProject(
  db: DatabaseSync,
  sourceId: number,
  target: { clientTitle: string; clientName: string; kind: DocumentKind }
): number {
  if (!target.clientName.trim()) throw new Error('Le nom du client est obligatoire.')
  const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
  const rows = (table: string, where: string, ...params: (number | string)[]) =>
    db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...params) as Record<string, unknown>[]
  // Insère une copie de la ligne (sans son id), avec les valeurs remplacées ; renvoie le nouvel id.
  const insert = (table: string, row: Record<string, unknown>, changes: Record<string, unknown>) => {
    const names = columns(table).filter((c) => c !== 'id')
    const values = names.map((c) => (c in changes ? changes[c] : row[c])) as (string | number | null)[]
    return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...values).lastInsertRowid)
  }

  const source = db.prepare('SELECT * FROM projects WHERE id = ?').get(sourceId) as Record<string, unknown> | undefined
  if (!source) throw new Error('Ce projet n’existe plus.')
  const stamp = now()
  db.exec('BEGIN')
  try {
    const id = insert('projects', source, {
      client_title: target.clientTitle.trim() || null,
      client_name: target.clientName.trim(),
      created_at: stamp,
      updated_at: stamp,
      deleted_at: null,
      mailed_at: null
    })
    const rooms = new Map<number, number>()
    for (const r of rows('rooms', 'project_id = ?', sourceId)) rooms.set(r.id as number, insert('rooms', r, { project_id: id }))
    const room = (v: unknown) => (v === null ? null : (rooms.get(v as number) ?? null))

    const renders = new Map<number, number>()
    for (const r of rows('renders', 'project_id = ?', sourceId)) {
      renders.set(r.id as number, insert('renders', r, { project_id: id, room_id: room(r.room_id), active_version_id: null }))
    }
    const versions = new Map<number, number>()
    for (const [oldRender, newRender] of renders) {
      for (const v of rows('render_versions', 'render_id = ? ORDER BY id', oldRender)) {
        versions.set(v.id as number, insert('render_versions', v, { render_id: newRender, parent_id: v.parent_id === null ? null : (versions.get(v.parent_id as number) ?? null) }))
      }
      for (const m of rows('render_markers', 'render_id = ?', oldRender)) insert('render_markers', m, { render_id: newRender })
      const active = (db.prepare('SELECT active_version_id FROM renders WHERE id = ?').get(oldRender) as { active_version_id: number | null }).active_version_id
      if (active !== null) db.prepare('UPDATE renders SET active_version_id = ? WHERE id = ?').run(versions.get(active) ?? null, newRender)
    }

    const needs = new Map<number, number>()
    for (const n of rows('needs', 'project_id = ?', sourceId)) {
      const newNeed = insert('needs', n, { project_id: id, room_id: room(n.room_id) })
      needs.set(n.id as number, newNeed)
      for (const a of rows('need_articles', 'need_id = ?', n.id as number)) insert('need_articles', a, { need_id: newNeed })
      for (const i of rows('need_images', 'need_id = ?', n.id as number)) insert('need_images', i, { need_id: newNeed })
    }
    for (const table of ['free_pages', 'project_paints', 'project_artisans', 'project_trend_images']) {
      for (const r of rows(table, 'project_id = ?', sourceId)) insert(table, r, { project_id: id })
    }

    // Réglages de l'aperçu : leurs clés citent des besoins, des rendus ou des annotations, renumérotés ici.
    const notes = new Map<number, number>()
    const maps: Record<string, Map<number, number>> = { need: needs, choices: needs, needLabel: needs, render: renders, caption: renders, note: notes }
    const remap = (key: unknown) =>
      String(key).replace(/\b(need|choices|needLabel|render|caption|note):(\d+)/g, (all, kind: string, n: string) => {
        const next = maps[kind]?.get(Number(n))
        return next === undefined ? all : `${kind}:${next}`
      })
    for (const n of rows('book_notes', 'project_id = ?', sourceId)) {
      notes.set(n.id as number, insert('book_notes', n, { project_id: id, page_key: remap(n.page_key) }))
    }
    for (const a of rows('book_adjustments', 'project_id = ?', sourceId)) {
      insert('book_adjustments', a, { project_id: id, page_key: remap(a.page_key), element_id: remap(a.element_id) })
    }
    for (const h of rows('book_hidden_pages', 'project_id = ?', sourceId)) insert('book_hidden_pages', h, { project_id: id, page_key: remap(h.page_key) })
    db.exec('COMMIT')

    // Autre document (design book ↔ devis) : mêmes règles que le choix dans l'étape Client.
    if (target.kind !== source.kind) updateProject(db, id, { kind: target.kind })
    return id
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
