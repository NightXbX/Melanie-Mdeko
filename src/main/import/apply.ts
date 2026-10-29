import type { DatabaseSync } from 'node:sqlite'
import type { ImportSummary } from '@shared/api'
import { cleanUrl } from '@shared/url'
import { uploadImage } from '../article-edit'
import { reindexArticle } from '../articles'
import { category, cle, colorMaterial, dimensions, domain, price, supplier } from './rules'
import { needLabel, type EncodedImage, type ImportEvent, type RowDraft } from './read-pdf'

const one = <T>(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): T | undefined =>
  db.prepare(sql).get(...params) as T | undefined

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
  private needs = new Map<string, number[]>()
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

  private categoryId(section: string, name: string): number {
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
          `SELECT a.id, a.name, i.phash FROM articles a JOIN article_images ai ON ai.article_id = a.id AND ai.sort = 0
           JOIN images i ON i.id = ai.image_id WHERE a.deleted_at IS NULL AND i.phash IS NOT NULL`
        )
        .all() as { id: number; name: string; phash: string }[]
      const same = candidates.find((c) => cle(c.name) === cle(row.name) && hamming(c.phash, photo.dhash) <= 10)
      if (same) {
        this.reused++
        return same.id
      }
    }
    const p = price(row.priceText)
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO articles (name, category_id, supplier_id, price_cents, price_kind, price_text, url, url_clean,
             dimensions, color_material) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.name || 'Sans nom',
          this.categoryId(row.section, row.name),
          this.supplierId(row.supplier, row.url),
          p.cents,
          p.kind,
          p.text || null,
          row.url,
          link,
          dimensions(row.name),
          colorMaterial(row.name)
        ).lastInsertRowid
    )
    row.images.forEach((img, sort) =>
      this.db.prepare('INSERT OR IGNORE INTO article_images (article_id, image_id, sort) VALUES (?, ?, ?)').run(id, this.image(img), sort)
    )
    this.touched.add(id)
    this.added++
    return id
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
      case 'rows':
        for (const row of e.rows) {
          const id = this.article(row)
          if (this.projectId === null) continue
          const label = needLabel(row)
          this.needs.set(label, [...(this.needs.get(label) ?? []), id])
        }
        return
      case 'render':
        if (this.projectId === null) return
        this.db
          .prepare('INSERT INTO renders (project_id, image_id, inset_image_id, section, sort) VALUES (?, ?, ?, ?, ?)')
          .run(this.projectId, this.image(e.image), e.inset ? this.image(e.inset) : null, e.section, this.renderCount++)
        return
      case 'wishes': {
        if (this.projectId === null || !e.text) return
        this.db.prepare('UPDATE projects SET wishes_text = ? WHERE id = ?').run(e.text, this.projectId)
        const rooms = /s[’']appliquerait sur votre ([^.]+)\./.exec(e.text)?.[1]
        rooms
          ?.split(/,| et /)
          .map((r) => r.trim())
          .filter(Boolean)
          .forEach((room, sort) =>
            this.db.prepare('INSERT INTO rooms (project_id, name, sort) VALUES (?, ?, ?)').run(this.projectId, room.charAt(0).toUpperCase() + room.slice(1), sort)
          )
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

  // Termine l'import : besoins (premier article = « Mon choix »), teintes, artisans, index de recherche.
  finish(): ImportSummary {
    const pid = this.projectId
    if (pid !== null) {
      let sort = 0
      for (const [label, ids] of this.needs) {
        const unique = [...new Set(ids)]
        const needId = Number(
          this.db
            .prepare('INSERT INTO needs (project_id, category_id, label, sort) SELECT ?, category_id, ?, ? FROM articles WHERE id = ?')
            .run(pid, label, sort++, unique[0]).lastInsertRowid
        )
        unique.forEach((articleId, i) =>
          this.db
            .prepare('INSERT INTO need_articles (need_id, article_id, role, sort) VALUES (?, ?, ?, ?)')
            .run(needId, articleId, i === 0 ? 'choice' : 'alternative', Math.max(0, i - 1))
        )
      }
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
      needs: pid === null ? 0 : this.needs.size
    }
  }
}
