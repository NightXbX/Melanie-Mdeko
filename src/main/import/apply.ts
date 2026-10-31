import type { DatabaseSync } from 'node:sqlite'
import type { ImportSummary } from '@shared/api'
import { cleanUrl } from '@shared/url'
import { uploadImage } from '../article-edit'
import { reindexArticle } from '../articles'
import { category, cle, colorMaterial, dimensions, domain, isKnownSection, isRoomSection, price, roomName, sansAccents, supplier } from './rules'
import { needLabel, type EncodedImage, type ImportEvent, type RowDraft } from './read-pdf'

const one = <T>(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): T | undefined =>
  db.prepare(sql).get(...params) as T | undefined

// Article placé sur une page du book, avant d'être rangé dans un besoin.
interface Placed {
  article: number
  category: number | null
  highlighted: boolean
  label: string
}

interface NeedDraft {
  room: number | null
  label: string | null
  quantity?: number
  choice: Placed
  alternatives: Placed[]
  fromHighlight: boolean
}

const words = (name: string) => sansAccents(name).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4)

const hamming = (a: string, b: string) => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

// Range un design book (ou une shopping list) lu par readBook dans la base de l'appli.
export class BookImporter {
  private projectId: number | null = null
  private projectTitle: string | null = null
  private pages: { room: number | null; rows: Placed[] }[] = []
  private formed: NeedDraft[] = [] // besoins d'un book exporté par Mdeko, tels quels
  private trendCount = 0
  private rooms: { key: string; id: number; claimed: boolean }[] = []
  private known: { words: string[]; category: number }[] | null = null
  private needCount = 0
  private renderCount = 0
  private paintIds: number[] = []
  private artisanIds: number[] = []
  private touched = new Set<number>()
  private added = 0
  private reused = 0

  constructor(
    private db: DatabaseSync,
    private dataRoot: string
  ) {}

  private image(img: EncodedImage): number {
    const { id } = uploadImage(this.db, this.dataRoot, { bytes: img.bytes, ext: 'jpg', width: img.width, height: img.height, thumbnail: img.thumbnail })
    this.db.prepare('UPDATE images SET phash = coalesce(phash, ?) WHERE id = ?').run(img.dhash, id)
    return id
  }

  // Catégorie la plus fréquente parmi les articles dont le nom commence pareil (« Tabouret… », « Table basse… »).
  private guessCategory(name: string): number | null {
    this.known ??= (
      this.db
        .prepare(
          `SELECT a.name, a.category_id FROM articles a JOIN categories c ON c.id = a.category_id
           WHERE a.deleted_at IS NULL AND c.name <> 'Divers'`
        )
        .all() as {
        name: string
        category_id: number
      }[]
    ).map((a) => ({ words: words(a.name), category: a.category_id }))
    const w = words(name)
    for (let i = 0; i < Math.min(w.length, 3); i++) {
      for (const prefix of [w.slice(i, i + 2), [w[i]]]) {
        const counts = new Map<number, number>()
        for (const k of this.known) if (prefix.every((p, j) => k.words[j]?.startsWith(p))) counts.set(k.category, (counts.get(k.category) ?? 0) + 1)
        const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
        if (best && best[1] >= 2) return best[0]
      }
    }
    return null
  }

  // Sous une section connue (« LUMINAIRES »), ses règles ; sous une pièce, d'après le nom de l'article.
  private categoryId(section: string, name: string): number {
    const guessed = isKnownSection(section) ? null : this.guessCategory(name)
    if (guessed) return guessed
    const [family, sub] = category(section, name)
    const fid = one<{ id: number }>(this.db, 'SELECT id FROM families WHERE name = ?', family)!.id
    return (
      one<{ id: number }>(this.db, 'SELECT id FROM categories WHERE family_id = ? AND name = ?', fid, sub)?.id ??
      Number(this.db.prepare('INSERT INTO categories (family_id, name) VALUES (?, ?)').run(fid, sub).lastInsertRowid)
    )
  }

  private supplierId(raw: string, url: string | null): number | null {
    const name = supplier(raw) ?? one<{ name: string }>(this.db, 'SELECT name FROM suppliers WHERE domain = ?', domain(url))?.name ?? null
    if (!name) return null
    return (
      one<{ id: number }>(this.db, 'SELECT id FROM suppliers WHERE name = ?', name)?.id ??
      Number(this.db.prepare('INSERT INTO suppliers (name, domain) VALUES (?, ?)').run(name, domain(url)).lastInsertRowid)
    )
  }

  // Article déjà dans la shopping list (même lien, ou même nom et photo proche), sinon nouvel article.
  private article(row: RowDraft): number {
    const link = row.url ? cleanUrl(row.url) : null
    if (link) {
      const found = one<{ id: number }>(this.db, 'SELECT id FROM articles WHERE url_clean = ? AND deleted_at IS NULL ORDER BY id LIMIT 1', link)
      if (found) {
        this.reused++
        return found.id
      }
    }
    const photo = row.images[0]
    if (photo) {
      const candidates = this.db
        .prepare(
          `SELECT a.id, a.name, a.url_clean, i.phash FROM articles a JOIN article_images ai ON ai.article_id = a.id AND ai.sort = 0
           JOIN images i ON i.id = ai.image_id WHERE a.deleted_at IS NULL AND i.phash IS NOT NULL`
        )
        .all() as { id: number; name: string; url_clean: string | null; phash: string }[]
      // Même nom et photo proche, mais deux liens différents : deux variantes du produit, gardées toutes les deux.
      const same = candidates.find((c) => cle(c.name) === cle(row.name) && hamming(c.phash, photo.dhash) <= 10 && !(link && c.url_clean))
      if (same) {
        this.reused++
        return same.id
      }
    }
    const p = price(row.priceText)
    const categoryId = this.categoryId(row.section, row.name)
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO articles (name, category_id, supplier_id, price_cents, price_kind, price_text, url, url_clean,
             dimensions, color_material, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.name || 'Sans nom',
          categoryId,
          this.supplierId(row.supplier, row.url),
          p.cents,
          p.kind,
          p.text || null,
          row.url,
          link,
          dimensions(row.name),
          colorMaterial(row.name),
          row.description ?? null
        ).lastInsertRowid
    )
    row.images.forEach((img, sort) =>
      this.db.prepare('INSERT OR IGNORE INTO article_images (article_id, image_id, sort) VALUES (?, ?, ?)').run(id, this.image(img), sort)
    )
    this.touched.add(id)
    if (one<{ name: string }>(this.db, 'SELECT name FROM categories WHERE id = ?', categoryId)?.name !== 'Divers') {
      this.known?.push({ words: words(row.name), category: categoryId })
    }
    this.added++
    return id
  }

  // Catégorie de l'article ; s'il n'est rangé que dans « Divers », on le reclasse d'après son nom.
  private reclassify(article: number, name: string): number | null {
    const a = one<{ category_id: number | null; sub: string | null }>(
      this.db,
      'SELECT a.category_id, c.name AS sub FROM articles a LEFT JOIN categories c ON c.id = a.category_id WHERE a.id = ?',
      article
    )!
    if (a.category_id !== null && a.sub !== 'Divers') return a.category_id
    const guessed = this.guessCategory(name)
    if (!guessed || guessed === a.category_id) return a.category_id
    this.db.prepare('UPDATE articles SET category_id = ?, updated_at = ? WHERE id = ?').run(guessed, new Date().toISOString(), article)
    this.touched.add(article)
    return guessed
  }

  private addRoom(name: string, claimed: boolean): number {
    const id = Number(
      this.db.prepare('INSERT INTO rooms (project_id, name, sort) VALUES (?, ?, ?)').run(this.projectId, name, this.rooms.length).lastInsertRowid
    )
    this.rooms.push({ key: cle(name), id, claimed })
    return id
  }

  // Pièce d'un intercalaire (« CHAMBRE PARENTALE »…). Une pièce citée dans « Vos envies » (« chambre ») prend le
  // nom complet du premier intercalaire qui lui correspond ; une deuxième chambre devient une autre pièce.
  // Dans un book exporté par Mdeko, la pièce est écrite en haut de page : c'en est forcément une.
  private room(section: string, sure = false): number | null {
    if (!sure && !isRoomSection(section)) return null
    const key = cle(section)
    const same = this.rooms.find((r) => r.key === key)
    if (same) return same.id
    const cited = this.rooms.find((r) => !r.claimed && key.startsWith(r.key))
    if (!cited) return this.addRoom(roomName(section), true)
    this.db.prepare('UPDATE rooms SET name = ? WHERE id = ?').run(roomName(section), cited.id)
    Object.assign(cited, { key, claimed: true })
    return cited.id
  }

  handle(e: ImportEvent): void {
    switch (e.kind) {
      case 'start':
        if (e.cover) {
          this.projectTitle = [e.cover.title, e.cover.name].filter(Boolean).join(' ')
          this.projectId = Number(
            this.db
              .prepare('INSERT INTO projects (client_title, client_name, book_date) VALUES (?, ?, ?)')
              .run(e.cover.title || null, e.cover.name || 'Projet importé', e.cover.bookDate).lastInsertRowid
          )
        }
        return
      case 'rows': {
        const rows = e.rows.map((row) => {
          const article = this.article(row)
          return { article, category: this.reclassify(article, row.name), highlighted: row.highlighted, label: needLabel(row) }
        })
        if (this.projectId !== null && rows.length) this.pages.push({ room: this.room(e.rows[0].section), rows })
        return
      }
      case 'render':
        if (this.projectId === null) return
        this.db
          .prepare('INSERT INTO renders (project_id, image_id, inset_image_id, section, caption, sort) VALUES (?, ?, ?, ?, ?, ?)')
          .run(this.projectId, this.image(e.image), e.inset ? this.image(e.inset) : null, e.section, e.caption ?? null, this.renderCount++)
        return
      case 'need': {
        if (this.projectId === null) return
        const place = (row: RowDraft): Placed => {
          const article = this.article(row)
          return { article, category: this.reclassify(article, row.name), highlighted: false, label: e.label }
        }
        const choice = place(e.choice)
        // Titre du besoin : gardé seulement s'il diffère du nom de la sous-catégorie.
        const sub = choice.category === null ? null : one<{ name: string }>(this.db, 'SELECT name FROM categories WHERE id = ?', choice.category)?.name
        this.formed.push({
          room: e.room ? this.room(e.room, true) : null,
          label: sub && cle(sub) === cle(e.label) ? null : e.label,
          quantity: e.quantity,
          choice,
          alternatives: e.alternatives.map(place),
          fromHighlight: false
        })
        return
      }
      case 'trend':
        if (this.projectId === null) return
        this.db
          .prepare('INSERT OR IGNORE INTO project_trend_images (project_id, image_id, sort) VALUES (?, ?, ?)')
          .run(this.projectId, this.image(e.image), this.trendCount++)
        return
      case 'texts': {
        if (this.projectId === null) return
        // Un texte identique au modèle des réglages reste « modèle » (il suivra ses changements).
        const template = (key: string) => one<{ value: string | null }>(this.db, 'SELECT value FROM settings WHERE key = ?', key)?.value ?? ''
        if (e.intro && cle(e.intro) !== cle(template('text_intro'))) this.db.prepare('UPDATE projects SET intro_text = ? WHERE id = ?').run(e.intro, this.projectId)
        if (e.closing && cle(e.closing) !== cle(template('text_closing'))) {
          this.db.prepare('UPDATE projects SET closing_text = ? WHERE id = ?').run(e.closing, this.projectId)
        }
        return
      }
      case 'wishes': {
        if (this.projectId === null || !e.text) return
        this.db.prepare('UPDATE projects SET wishes_text = ? WHERE id = ?').run(e.text, this.projectId)
        const rooms = /s[’']appliquerait sur votre ([^.]+)\./.exec(e.text)?.[1]
        rooms
          ?.split(/,| et /)
          .map((r) => r.trim())
          .filter((r) => r && cle(r) !== 'habitation' && cle(r) !== 'maison' && cle(r) !== 'appartement')
          .forEach((room) => this.addRoom(room.charAt(0).toUpperCase() + room.slice(1), false))
        return
      }
      case 'paints':
        for (const p of e.paints) {
          const brand =
            one<{ id: number }>(this.db, 'SELECT id FROM paint_brands WHERE name = ?', p.brand)?.id ??
            Number(this.db.prepare('INSERT INTO paint_brands (name, promo_code) VALUES (?, ?)').run(p.brand, p.promoCode).lastInsertRowid)
          const paint =
            one<{ id: number }>(this.db, 'SELECT id FROM paints WHERE brand_id = ? AND name = ? COLLATE NOCASE', brand, p.name)?.id ??
            Number(this.db.prepare('INSERT INTO paints (brand_id, name, reference, hex) VALUES (?, ?, ?, ?)').run(brand, p.name, p.reference, p.hex).lastInsertRowid)
          if (!this.paintIds.includes(paint)) this.paintIds.push(paint)
        }
        return
      case 'artisans':
        for (const a of e.artisans) {
          const id =
            one<{ id: number }>(this.db, 'SELECT id FROM artisans WHERE name = ? COLLATE NOCASE', a.name)?.id ??
            Number(this.db.prepare('INSERT INTO artisans (trade, name, city, phone) VALUES (?, ?, ?, ?)').run(a.trade, a.name, a.city, a.phone).lastInsertRowid)
          if (!this.artisanIds.includes(id)) this.artisanIds.push(id)
        }
        return
    }
  }

  // Book surligné : chaque article au fluo est « Mon choix », les autres articles de sa page sont ses
  // propositions. Une page sans fluo prolonge le choix du même genre déjà fait dans la pièce (suite des
  // propositions) ; sinon, chacun de ses articles est un choix.
  private highlightedNeeds(): NeedDraft[] {
    const needs: NeedDraft[] = []
    for (const page of this.pages) {
      const own = page.rows
        .filter((r) => r.highlighted)
        .map((choice): NeedDraft => ({ room: page.room, label: null, choice, alternatives: [], fromHighlight: true }))
      const earlier = (r: Placed) => needs.filter((n) => n.fromHighlight && n.room === page.room && n.choice.category === r.category).at(-1)
      const position = (n: NeedDraft) => page.rows.indexOf(n.choice)
      for (const [i, r] of page.rows.entries()) {
        if (r.highlighted) continue
        if (!own.length) {
          const target = earlier(r)
          if (target) target.alternatives.push(r)
          else needs.push({ room: page.room, label: null, choice: r, alternatives: [], fromHighlight: false })
          continue
        }
        const nearest = own.reduce((best, n) => (Math.abs(position(n) - i) < Math.abs(position(best) - i) ? n : best))
        ;(own.find((n) => n.choice.category === r.category) ?? earlier(r) ?? nearest).alternatives.push(r)
      }
      needs.push(...own)
    }
    return needs
  }

  // Book sans surlignage : un besoin par pièce et sous-catégorie, le premier article est « Mon choix ».
  private groupedNeeds(): NeedDraft[] {
    const groups = new Map<string, NeedDraft>()
    for (const page of this.pages) {
      for (const r of page.rows) {
        const key = `${page.room}|${r.label}`
        const need = groups.get(key)
        if (need) need.alternatives.push(r)
        else groups.set(key, { room: page.room, label: r.label, choice: r, alternatives: [], fromHighlight: false })
      }
    }
    return [...groups.values()]
  }

  // Termine l'import : besoins, teintes, artisans, index de recherche.
  finish(): ImportSummary {
    const pid = this.projectId
    if (pid !== null) {
      const highlighted = this.pages.some((p) => p.rows.some((r) => r.highlighted))
      const needs = this.formed.length ? this.formed : highlighted ? this.highlightedNeeds() : this.groupedNeeds()
      needs.forEach((n, sort) => {
        const needId = Number(
          this.db
            .prepare('INSERT INTO needs (project_id, room_id, category_id, label, quantity, sort) VALUES (?, ?, ?, ?, ?, ?)')
            .run(pid, n.room, n.choice.category, n.label, n.quantity ?? 1, sort).lastInsertRowid
        )
        this.db.prepare("INSERT INTO need_articles (need_id, article_id, role) VALUES (?, ?, 'choice')").run(needId, n.choice.article)
        const alternatives = [...new Set(n.alternatives.map((a) => a.article))].filter((id) => id !== n.choice.article)
        alternatives.forEach((articleId, i) =>
          this.db.prepare("INSERT INTO need_articles (need_id, article_id, role, sort) VALUES (?, ?, 'alternative', ?)").run(needId, articleId, i)
        )
      })
      this.needCount = needs.length
      this.paintIds.forEach((id, i) => this.db.prepare('INSERT INTO project_paints (project_id, paint_id, sort) VALUES (?, ?, ?)').run(pid, id, i))
      this.artisanIds.forEach((id, i) => this.db.prepare('INSERT INTO project_artisans (project_id, artisan_id, sort) VALUES (?, ?, ?)').run(pid, id, i))
    }
    for (const id of this.touched) reindexArticle(this.db, id)
    return {
      projectId: pid,
      projectTitle: this.projectTitle,
      added: this.added,
      reused: this.reused,
      renders: this.renderCount,
      needs: this.needCount
    }
  }
}
