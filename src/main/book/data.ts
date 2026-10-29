import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ArticleCard } from '@shared/api'
import { formatPrice } from '@shared/format'
import { getProject, getSettings, listArtisans, listPaints, projectTitle, wishesText } from '../projects'
import type { BookArticle, BookData, ImageRef } from './layout'

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

export function dateLabel(bookDate: string | null): string {
  const [y, m] = (bookDate ?? new Date().toISOString().slice(0, 7)).split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

type ImageRow = { rel_path: string; width: number | null; height: number | null }

function imageRef(db: DatabaseSync, dataRoot: string, where: string, value: number): ImageRef | null {
  const r = db.prepare(`SELECT rel_path, width, height FROM images WHERE ${where} = ?`).get(value) as ImageRow | undefined
  if (!r) return null
  return {
    url: `mdeko://media/${r.rel_path.split('/').map(encodeURIComponent).join('/')}`,
    path: join(dataRoot, r.rel_path),
    width: r.width ?? 1000,
    height: r.height ?? 1000
  }
}

function bookArticle(db: DatabaseSync, dataRoot: string, card: ArticleCard): BookArticle {
  const a = db.prepare('SELECT url FROM articles WHERE id = ?').get(card.id) as { url: string | null }
  const firstImage = db
    .prepare('SELECT image_id FROM article_images WHERE article_id = ? ORDER BY sort LIMIT 1')
    .get(card.id) as { image_id: number } | undefined
  return {
    name: card.name,
    price: formatPrice(card.price),
    priceCents: card.price.cents,
    summable: card.price.cents !== null && (card.price.kind === 'fixed' || card.price.kind === 'from' || card.price.kind === 'unknown'),
    supplier: card.supplier,
    url: a.url,
    image: firstImage ? imageRef(db, dataRoot, 'id', firstImage.image_id) : null
  }
}

export function bookData(db: DatabaseSync, dataRoot: string, projectId: number): BookData {
  const project = getProject(db, projectId)
  if (!project) throw new Error('Projet introuvable.')
  const settings = getSettings(db)
  const qrId = (db.prepare("SELECT value FROM settings WHERE key = 'review_qr_image_id'").get() as { value: string } | undefined)?.value

  const paintsById = new Map(listPaints(db).map((p) => [p.id, p]))
  const paints: BookData['paints'] = []
  for (const id of project.paintIds) {
    const p = paintsById.get(id)
    if (!p) continue
    let group = paints.find((g) => g.brand === p.brand)
    if (!group) {
      group = { brand: p.brand, promoCode: p.promoCode, items: [] }
      paints.push(group)
    }
    group.items.push({ name: p.name, reference: p.reference, hex: p.hex })
  }
  const artisansById = new Map(listArtisans(db).map((a) => [a.id, a]))

  return {
    clientLabel: projectTitle(project.clientTitle, project.clientName),
    dateLabel: dateLabel(project.bookDate),
    designerName: settings.designerName,
    address: settings.address,
    phone: settings.phone,
    email: settings.email,
    reviewQr: qrId ? imageRef(db, dataRoot, 'id', Number(qrId)) : null,
    intro: project.texts.intro ?? settings.introText,
    wishes: wishesText(project, settings),
    closing: project.texts.closing ?? settings.closingText,
    renders: project.renders.map((r) => {
      const inset = db.prepare('SELECT inset_image_id FROM renders WHERE id = ?').get(r.id) as { inset_image_id: number | null }
      return {
        image: imageRef(db, dataRoot, 'id', r.imageId)!,
        inset: inset.inset_image_id ? imageRef(db, dataRoot, 'id', inset.inset_image_id) : null,
        section: r.section
      }
    }),
    needs: project.needs.map((n) => ({
      title: n.label ?? n.category ?? 'Shopping list',
      choice: n.choice ? bookArticle(db, dataRoot, n.choice) : null,
      alternatives: n.alternatives.map((a) => bookArticle(db, dataRoot, a))
    })),
    paints,
    artisans: project.artisanIds
      .map((id) => artisansById.get(id))
      .filter((a) => a !== undefined)
      .map((a) => ({ trade: a.trade, name: a.name, city: a.city, phone: a.phone }))
  }
}
