import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { CropSource, EditableImage, ImageUpload } from '@shared/api'
import { isFull, parseCrop, type CropRect } from '@shared/crop'
import { uploadImage } from './article-edit'
import { mediaUrl } from './media-urls'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif'
}

interface ImageRow {
  id: number
  rel_path: string
  crop_of: number | null
  crop: string | null
}

const row = (db: DatabaseSync, id: number) =>
  db.prepare('SELECT id, rel_path, crop_of, crop FROM images WHERE id = ?').get(id) as ImageRow | undefined

// Image d'origine d'une image rognée (elle-même si elle ne l'est pas) et cadre choisi.
export function cropInfo(db: DatabaseSync, imageId: number): { rootId: number; rect: CropRect | null } {
  const r = row(db, imageId)
  if (!r) throw new Error('Cette image n’existe plus.')
  return r.crop_of === null ? { rootId: r.id, rect: null } : { rootId: r.crop_of, rect: parseCrop(r.crop) }
}

// Ce que l'outil de rognage affiche : toujours l'image d'origine entière, avec le cadre déjà choisi.
export function cropSource(db: DatabaseSync, imageId: number): CropSource {
  const { rootId, rect } = cropInfo(db, imageId)
  const root = row(db, rootId)
  if (!root) throw new Error('L’image d’origine est introuvable.')
  return { id: root.id, url: mediaUrl(root.rel_path), crop: rect }
}

export function readImage(db: DatabaseSync, dataRoot: string, imageId: number): { bytes: Uint8Array; mimeType: string } {
  const r = row(db, imageId)
  if (!r) throw new Error('Cette image n’existe plus.')
  return { bytes: readFileSync(join(dataRoot, r.rel_path)), mimeType: MIME[extname(r.rel_path).toLowerCase()] ?? 'image/jpeg' }
}

// Enregistre l'image rognée (découpée par l'interface) comme une nouvelle image liée à son origine.
// Le cadre entier redonne simplement l'image d'origine.
export function saveCrop(db: DatabaseSync, dataRoot: string, sourceId: number, rect: CropRect, upload: ImageUpload | null): EditableImage {
  const { rootId } = cropInfo(db, sourceId)
  const root = row(db, rootId)!
  if (isFull(rect) || !upload) return { id: root.id, url: mediaUrl(root.rel_path) }
  const image = uploadImage(db, dataRoot, upload)
  if (image.id !== rootId) {
    db.prepare('UPDATE images SET crop_of = ?, crop = ? WHERE id = ? AND id <> ?').run(rootId, JSON.stringify(rect), image.id, rootId)
  }
  return image
}
