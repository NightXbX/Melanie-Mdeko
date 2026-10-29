import { join } from 'node:path'

// Les images sont servies par le protocole interne mdeko:// (voir media.ts), jamais par file://.
export const MEDIA_SCHEME = 'mdeko'

export function mediaUrl(relPath: string): string {
  return `${MEDIA_SCHEME}://media/${relPath.split('/').map(encodeURIComponent).join('/')}`
}

export function thumbnailUrl(sha256: string): string {
  return `${MEDIA_SCHEME}://miniature/${sha256}`
}

// Même règle que l'outil de migration : images/miniatures/ab/abcdef….jpg
export function thumbnailPath(dataRoot: string, sha256: string): string {
  return join(dataRoot, 'images', 'miniatures', sha256.slice(0, 2), `${sha256}.jpg`)
}
