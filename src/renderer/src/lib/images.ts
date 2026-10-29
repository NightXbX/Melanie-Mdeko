import type { EditableImage, ImageUpload } from '@shared/api'

const THUMBNAIL_SIZE = 360

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif'
}

const TYPES_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif'
}

// Ce qu'on a lâché sur la fenêtre, lu tout de suite (le navigateur l'efface après l'événement).
export interface DropContent {
  files: Blob[]
  url: string | null
}

export function readDrop(dt: DataTransfer): DropContent {
  const files = [...dt.files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name))
  // Image glissée depuis une page web : on récupère son adresse.
  const html = dt.getData('text/html')
  const fromHtml = /<img[^>]+src="(https?:[^"]+)"/i.exec(html)?.[1]
  const fromUri = dt
    .getData('text/uri-list')
    .split(/\r?\n/)
    .find((l) => /^https?:\/\//.test(l.trim()))
  return { files, url: files.length ? null : (fromHtml ?? fromUri ?? null) }
}

export function hasImages(dt: DataTransfer): boolean {
  return [...dt.types].some((t) => t === 'Files' || t === 'text/uri-list' || t === 'text/html')
}

async function toUpload(blob: Blob, name = ''): Promise<ImageUpload> {
  const type = blob.type || TYPES_BY_EXTENSION[name.split('.').pop()?.toLowerCase() ?? ''] || ''
  const ext = EXTENSIONS[type]
  if (!ext) throw new Error('Ce format de photo n’est pas pris en charge. Utilisez une photo JPEG, PNG ou WebP.')
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  const thumbnail = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    ext,
    width: bitmap.width,
    height: bitmap.height,
    thumbnail: new Uint8Array(await thumbnail.arrayBuffer())
  }
}

// Enregistre les photos déposées dans le dossier de données et renvoie leurs références.
export async function uploadDrop(drop: DropContent): Promise<EditableImage[]> {
  const blobs: { blob: Blob; name: string }[] = drop.files.map((f) => ({ blob: f, name: f instanceof File ? f.name : '' }))
  if (!blobs.length && drop.url) {
    const d = await window.mdeko.downloadImage(drop.url)
    blobs.push({ blob: new Blob([d.bytes as BlobPart], { type: d.mimeType }), name: '' })
  }
  const uploaded: EditableImage[] = []
  for (const { blob, name } of blobs) {
    uploaded.push(await window.mdeko.uploadImage(await toUpload(blob, name)))
  }
  return uploaded
}
